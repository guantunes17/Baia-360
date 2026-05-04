import importlib
import importlib.util
import json
import os
import re
import tempfile
import threading
import time
import traceback
import uuid
import msal
import pandas as pd
import requests as http_requests

from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required,
    get_jwt_identity, decode_token, set_access_cookies, unset_jwt_cookies
)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sqlalchemy import SQLAlchemy
from openai import OpenAI
from sqlalchemy import func
from pathlib import Path
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from zoneinfo import ZoneInfo


def _deletar_temp(path: str):
    """Remove arquivo temporário com tolerância ao PermissionError do Windows."""
    for _ in range(5):
        try:
            os.unlink(path)
            return
        except PermissionError:
            time.sleep(0.2)
        except FileNotFoundError:
            return
        except Exception:
            return


_env_path = Path(__file__).resolve().parent / '.env'
load_dotenv(dotenv_path=_env_path, override=True)

app = Flask(__name__)
_is_prod = os.getenv('FLASK_ENV', 'development') == 'production'

app.config['SECRET_KEY']                     = os.getenv('SECRET_KEY')
app.config['JWT_SECRET_KEY']                 = os.getenv('JWT_SECRET_KEY')
app.config['SQLALCHEMY_DATABASE_URI']        = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH']             = 50 * 1024 * 1024  # 50 MB

# JWT via httpOnly cookie
app.config['JWT_TOKEN_LOCATION']             = ['cookies']
app.config['JWT_COOKIE_SECURE']              = _is_prod        # True em prod (HTTPS), False em dev (HTTP)
app.config['JWT_COOKIE_SAMESITE']            = 'Lax'           # Proteção CSRF básica
app.config['JWT_COOKIE_CSRF_PROTECT']        = False           # CSRF desabilitado — SPA no mesmo domínio
app.config['JWT_ACCESS_COOKIE_NAME']         = 'access_token_cookie'
app.config['JWT_COOKIE_DOMAIN']              = None            # Usa o domínio atual automaticamente

# CORS — em produção usa apenas FRONTEND_URL; em dev também aceita localhost
_prod_url = os.getenv("FRONTEND_URL", "").strip()
if _is_prod and _prod_url:
    _frontend_origins = [_prod_url]
elif _prod_url:
    _frontend_origins = ["http://localhost:5173", "http://localhost:3000", _prod_url]
else:
    _frontend_origins = ["http://localhost:5173", "http://localhost:3000"]
CORS(app, origins=_frontend_origins, supports_credentials=True)
db      = SQLAlchemy(app)
jwt     = JWTManager(app)
limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri="memory://")


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options']        = 'DENY'
    response.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    if _is_prod:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


# ── Model ─────────────────────────────────────────────────────────────────────
class AtlasLog(db.Model):
    __tablename__ = 'atlas_logs'
    id          = db.Column(db.Integer, primary_key=True)
    usuario_id  = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=False)
    primeira_msg = db.Column(db.String(200), nullable=True)
    total_msgs  = db.Column(db.Integer, default=0)
    criado_em   = db.Column(db.DateTime, default=datetime.utcnow)

class AtlasProjeto(db.Model):
    __tablename__ = 'atlas_projetos'
    id          = db.Column(db.Integer, primary_key=True)
    usuario_id  = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=False)
    nome        = db.Column(db.String(200), nullable=False)
    descricao   = db.Column(db.Text, default='')
    criado_em   = db.Column(db.DateTime, default=datetime.utcnow)
    atualizado_em = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    conversas = db.relationship('AtlasConversa', backref='projeto', lazy=True)

    def to_dict(self):
        return {
            'id':          self.id,
            'nome':        self.nome,
            'descricao':   self.descricao,
            'criadoEm':    self.criado_em.isoformat(),
            'atualizadoEm': self.atualizado_em.isoformat() if self.atualizado_em else self.criado_em.isoformat()
        }

class AtlasConversa(db.Model):
    __tablename__ = 'atlas_conversas'
    id          = db.Column(db.Integer, primary_key=True)
    usuario_id  = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=False)
    conv_id     = db.Column(db.String(20), nullable=False)       # id gerado no frontend
    titulo      = db.Column(db.String(200), default='Nova conversa')
    msgs_json   = db.Column(db.Text, nullable=False, default='[]')
    history_json = db.Column(db.Text, nullable=False, default='[]')
    atualizada_em = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    pinada        = db.Column(db.Boolean, default=False)
    criada_em     = db.Column(db.DateTime, default=datetime.utcnow)
    projeto_id    = db.Column(db.Integer, db.ForeignKey('atlas_projetos.id'), nullable=True)

    def to_dict(self):
        return {
            'id':           self.id,
            'conv_id':      self.conv_id,
            'titulo':       self.titulo,
            'pinada':       self.pinada,
            'msgs':         json.loads(self.msgs_json),
            'history':      json.loads(self.history_json),
            'criadaEm':     self.criada_em.isoformat(),
            'atualizadaEm': self.atualizada_em.isoformat() if self.atualizada_em else self.criada_em.isoformat(),
            'projetoId':    self.projeto_id,
            'projetoNome':  self.projeto.nome if self.projeto else None
        }

class AtlasMemoria(db.Model):
    __tablename__ = 'atlas_memoria'
    id            = db.Column(db.Integer, primary_key=True)
    usuario_id    = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=False)
    conteudo      = db.Column(db.Text, nullable=False)
    criada_em     = db.Column(db.DateTime, default=datetime.utcnow)
    atualizada_em = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('User', backref='memorias_atlas')

# ── Atlas: configurações server-side (imutáveis pelo cliente) ────────────────
ATLAS_MODEL            = 'gpt-5.4-mini'
ATLAS_TEMPERATURE      = 1.0
ATLAS_REASONING_EFFORT = 'medium'

ATLAS_MODO_SUFFIXES: dict = {
    'Resumido':  '\n\nIMPORTANTE: Seja extremamente conciso, máximo 3 linhas por resposta.',
    'Analítico': '\n\nIMPORTANTE: Forneça análise detalhada com dados, contexto e implicações.',
    'Detalhado': '\n\nIMPORTANTE: Seja completo e didático, explique cada ponto com exemplos.',
}

ATLAS_SYSTEM_PROMPT_BASE = """Você é o Atlas, assistente de inteligência artificial da Baia 4 Logística e Transportes.

Você está conversando com {nome_usuario}.

Personalidade e estilo de resposta:
- Você tem personalidade própria — é direto, inteligente e ocasionalmente usa humor leve quando o contexto permite
- Use o nome {nome_usuario} naturalmente nas respostas, como um colega faria — não em toda mensagem, apenas quando fizer sentido
- Escreva em texto corrido, como uma pessoa escreveria — evite listas com marcadores a menos que o conteúdo realmente exija
- Respostas curtas para perguntas simples, mais detalhadas apenas quando necessário
- Nunca comece respostas com "Com certeza!", "Claro!", "Ótimo!" ou variações robóticas
- Não repita o que o usuário acabou de dizer antes de responder
- Quando não souber algo, diga diretamente — sem rodeios
- Use dados antes de especular
- Responda sempre em português brasileiro informal mas profissional

Capacidades:
- Consulta e análise de KPIs e relatórios operacionais via ferramentas
- Geração de relatórios (requer upload do arquivo Excel correspondente)
- Consulta, criação e exclusão de eventos na agenda do Outlook
- Leitura e envio de e-mails via Outlook
- Integração com Microsoft Teams: listar times e canais, enviar mensagens em canais, criar reuniões online e enviar mensagens diretas entre usuários
- Interpretação de arquivos enviados pelo usuário (Excel, PDF, Word, imagens)
- Geração de documentos formais para download em .docx ou .pdf
- Responder perguntas gerais sobre logística, operações ou qualquer outro assunto
- Buscar informações atuais na internet quando necessário (cotações, notícias, dados externos)
- Briefing diário com agenda, e-mails prioritários e notícias do setor

Contexto da empresa:
- Baia 4 é um operador logístico focado em distribuição farmacêutica
- Clientes: ADITUS, BIOGEN, EPHARMA, BHC-Xofigo, CSL BEHRING, IPSEN, CELLTRION, YELUM, CM HOSPITALAR, GSK, PINT PHARMA, FUNCIONAL
- Módulos: Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem

Sobre consulta de dados operacionais:
- Use get_dashboard quando o usuário perguntar sobre KPIs, desempenho, faturamento, SLA, estoque, picos ou qualquer dado operacional histórico — essa ferramenta retorna os dados do último relatório gerado por módulo
- Prefira get_dashboard para consultas sobre dados já processados. Use gerar_relatorio apenas quando o usuário explicitamente pedir para GERAR um novo relatório com upload de arquivo

Sobre arquivos enviados pelo usuário:
- Quando o usuário enviar qualquer arquivo (Excel, PDF, Word, imagem), analise o conteúdo e responda o que foi pedido
- Para arquivos Excel, PDF, Word e imagens, leia os dados e forneça insights, resumos, análises ou responda perguntas sobre o conteúdo
- Nunca diga que não consegue ler ou interpretar um arquivo — você tem essa capacidade
- A geração de relatórios é um fluxo separado que usa arquivos de entrada específicos da operação. Não confunda com arquivos enviados para análise
- Quando receber um arquivo, você TEM acesso ao conteúdo real dele — leia e analise de verdade, nunca diga que não consegue ler

Sobre geração de relatórios operacionais:
- Quando o usuário pedir para GERAR um relatório operacional (Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem), use IMEDIATAMENTE a ferramenta gerar_relatorio — nunca diga que não consegue gerar
- Após usar a ferramenta, informe que um botão aparecerá na tela para o usuário enviar o arquivo Excel correspondente
- Gerar relatório e analisar um arquivo são coisas distintas: gerar usa a ferramenta gerar_relatorio; analisar lê um arquivo enviado pelo usuário

Sobre agenda e eventos:
- Use get_agenda para consultar eventos do calendário Outlook do usuário
- Use criar_evento para criar eventos no calendário Outlook
- Use deletar_evento para cancelar ou remover eventos — sempre busque o ID do evento via get_agenda antes de deletar
- Sempre que criar uma reunião no Teams (teams_criar_reuniao), obrigatoriamente também crie o evento na agenda (criar_evento) com o link da reunião na descrição no formato: "🔗 Link da reunião Teams: {link}". Nunca crie reunião Teams sem registrar na agenda

Sobre Microsoft Teams:
- Use teams_listar_times para listar os times do usuário no Teams
- Use teams_listar_canais para listar os canais de um time específico (requer o ID do time obtido via teams_listar_times)
- Use teams_enviar_mensagem para enviar mensagens em canais do Teams (requer team_id e channel_id)
- Use teams_criar_reuniao para criar reuniões online com link do Teams — sempre registre também na agenda via criar_evento
- Use teams_chat_enviar para enviar mensagens diretas a outros usuários pelo Teams

Sobre e-mails:
- Use buscar_emails para consultar e-mails do usuário no Outlook
- Use enviar_email para enviar e-mails pelo Outlook do usuário

Sobre conversas anteriores:
- Você TEM acesso às conversas anteriores do usuário via ferramenta buscar_conversas
- Use essa ferramenta quando o usuário pedir para você se atualizar, revisar o histórico, ou referenciar algo que foi discutido antes
- Após buscar, leia os resumos e responda com base no que foi encontrado

Sobre busca na internet:
- Você TEM acesso à internet via Google Search — nunca diga que não consegue pesquisar
- Use a busca quando o usuário pedir informações atuais: cotações, câmbio, notícias, eventos recentes, dados de mercado
- Use a busca também para complementar respostas sobre logística, regulações, notícias do setor farmacêutico
- Nunca cite URLs ou domínios inline no texto — as fontes são exibidas automaticamente no rodapé da resposta

Sobre geração de documentos formais (artefatos):
- Quando o usuário pedir para gerar um documento formal como ITO, POP, e-mail corporativo, contrato, procedimento, relatório narrativo ou qualquer documento extenso que será baixado ou impresso, SEMPRE use o formato de artefato abaixo
- O artefato será renderizado em um painel lateral com preview e botões de download em .docx e .pdf
- Formato obrigatório para artefatos:
<artifact type="TIPO" title="Título">
conteúdo
</artifact>

Tipos disponíveis:
- type="document" → documentos formais em markdown (ITOs, POPs, contratos, relatórios narrativos)
- type="html" → páginas HTML completas, dashboards, layouts, visualizações (use quando o usuário pedir algo visual ou interativo)
- type="react" → componentes React com hooks e lógica interativa (use para calculadoras, formulários, jogos, widgets complexos)

- No chat, escreva apenas uma mensagem curta e natural — pode ser uma frase introdutória, um comentário, uma oferta para ajustar. Seja humano e fluido
- PROIBIDO escrever o conteúdo do artefato fora da tag
- Para type="html": gere HTML completo e válido com CSS inline ou tag <style>. Use cores escuras (#0f1117 fundo, #e2e8f0 texto) para combinar com o tema do Atlas
- Para type="react": gere apenas o corpo do componente (function App() {{ ... }}), sem imports — React e useState já estão disponíveis
- Para respostas normais, análises curtas e tabelas simples, responda normalmente sem artifact
- Use artifact quando: o usuário pedir algo visual, interativo, um documento formal, ou qualquer conteúdo que se beneficie de uma área dedicada"""

ATLAS_TOOLS_DECLARATIONS = [
    {
        'name': 'get_dashboard',
        'description': 'Retorna KPIs e histórico de relatórios gerados. Use quando o usuário perguntar sobre métricas, faturamento, SLA, estoque, ou qualquer dado operacional.',
        'parameters': {
            'type': 'object',
            'properties': {
                'modulo': {'type': ['string', 'null'], 'description': 'Filtrar por módulo específico. Passar null para retornar todos os módulos.'}
            },
            'required': ['modulo']
        }
    },
    {
        'name': 'gerar_relatorio',
        'description': 'Inicia a geração de um relatório para um módulo e mês de referência. Após chamar esta ferramenta, informe ao usuário que ele precisa enviar o arquivo Excel correspondente para continuar.',
        'parameters': {
            'type': 'object',
            'properties': {
                'modulo': {'type': 'string', 'description': 'Nome do módulo: Pedidos, Fretes, Armazenagem, Estoque, Cap. Operacional, Recebimentos, Fat. Distribuição, Fat. Armazenagem'},
                'mes_ref': {'type': 'string', 'description': 'Mês de referência no formato YYYY-MM. Ex: 2025-03'}
            },
            'required': ['modulo', 'mes_ref']
        }
    },
    {
        'name': 'get_agenda',
        'description': 'Retorna eventos da agenda do usuário no Outlook.',
        'parameters': {
            'type': 'object',
            'properties': {
                'data_inicio': {'type': 'string', 'description': 'Data inicial YYYY-MM-DD'},
                'data_fim':    {'type': 'string', 'description': 'Data final YYYY-MM-DD'}
            },
            'required': ['data_inicio', 'data_fim']
        }
    },
    {
        'name': 'criar_evento',
        'description': 'Cria um novo evento na agenda do Outlook.',
        'parameters': {
            'type': 'object',
            'properties': {
                'titulo':      {'type': 'string'},
                'data':        {'type': 'string', 'description': 'YYYY-MM-DD'},
                'hora_inicio': {'type': 'string', 'description': 'HH:MM'},
                'hora_fim':    {'type': 'string', 'description': 'HH:MM'},
                'descricao':   {'type': 'string'}
            },
            'required': ['titulo', 'data', 'hora_inicio', 'hora_fim', 'descricao']
        }
    },
    {
        'name': 'deletar_evento',
        'description': 'Deleta um evento do calendário do Outlook do usuário. Use quando o usuário pedir para cancelar, remover ou deletar um evento da agenda.',
        'parameters': {
            'type': 'object',
            'properties': {
                'evento_id': {'type': 'string', 'description': 'ID do evento a ser deletado. Obtido via get_agenda.'}
            },
            'required': ['evento_id']
        }
    },
    {
        'name': 'buscar_conversas',
        'description': 'Busca conversas anteriores do usuário com o Atlas. Use quando o usuário pedir para se atualizar, revisar o que foi discutido, ou referenciar algo de conversas passadas.',
        'parameters': {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'description': 'Palavras-chave para buscar nas conversas. Pode ser vazio para trazer as mais recentes.'}
            },
            'required': ['query']
        }
    },
    {
        'name': 'buscar_emails',
        'description': 'Busca e-mails do usuário no Outlook. Use quando o usuário perguntar sobre e-mails, mensagens recebidas, ou quiser encontrar um e-mail específico.',
        'parameters': {
            'type': 'object',
            'properties': {
                'query':            {'type': 'string', 'description': 'Texto para buscar no assunto ou remetente. Pode ser vazio para trazer os mais recentes.'},
                'apenas_nao_lidos': {'type': 'boolean', 'description': 'Se true, retorna apenas e-mails não lidos.'},
                'limite':           {'type': 'number', 'description': 'Quantidade máxima de e-mails a retornar. Default 20, máximo 50.'}
            },
            'required': ['query', 'apenas_nao_lidos', 'limite']
        }
    },
    {
        'name': 'enviar_email',
        'description': 'Envia um e-mail pelo Outlook do usuário. Use quando o usuário pedir para enviar, encaminhar ou redigir um e-mail para alguém.',
        'parameters': {
            'type': 'object',
            'properties': {
                'destinatario':      {'type': 'string', 'description': 'Endereço de e-mail do destinatário.'},
                'nome_destinatario': {'type': ['string', 'null'], 'description': 'Nome de exibição do destinatário. Pode ser null.'},
                'assunto':           {'type': 'string', 'description': 'Assunto do e-mail.'},
                'corpo':             {'type': 'string', 'description': 'Corpo do e-mail em texto simples.'}
            },
            'required': ['destinatario', 'nome_destinatario', 'assunto', 'corpo']
        }
    },
    {
        'name': 'teams_listar_times',
        'description': 'Lista os times do Microsoft Teams do usuário.',
        'parameters': {'type': 'object', 'properties': {}, 'required': []}
    },
    {
        'name': 'teams_listar_canais',
        'description': 'Lista os canais de um time específico do Teams.',
        'parameters': {
            'type': 'object',
            'properties': {
                'team_id': {'type': 'string', 'description': 'ID do time.'}
            },
            'required': ['team_id']
        }
    },
    {
        'name': 'teams_enviar_mensagem',
        'description': 'Envia uma mensagem em um canal do Teams.',
        'parameters': {
            'type': 'object',
            'properties': {
                'team_id':    {'type': 'string'},
                'channel_id': {'type': 'string'},
                'mensagem':   {'type': 'string'}
            },
            'required': ['team_id', 'channel_id', 'mensagem']
        }
    },
    {
        'name': 'teams_criar_reuniao',
        'description': 'Cria uma reunião online no Microsoft Teams com link de videoconferência.',
        'parameters': {
            'type': 'object',
            'properties': {
                'titulo':        {'type': 'string'},
                'inicio':        {'type': 'string', 'description': 'Data e hora de início no formato ISO 8601. Ex: 2026-04-15T14:00:00'},
                'fim':           {'type': 'string', 'description': 'Data e hora de fim no formato ISO 8601. Ex: 2026-04-15T15:00:00'},
                'participantes': {'type': ['array', 'null'], 'items': {'type': 'string'}, 'description': 'Lista de e-mails dos participantes. Passar null se não houver participantes.'}
            },
            'required': ['titulo', 'inicio', 'fim', 'participantes']
        }
    },
    {
        'name': 'teams_chat_enviar',
        'description': 'Envia uma mensagem direta para um usuário no Teams.',
        'parameters': {
            'type': 'object',
            'properties': {
                'email_destino': {'type': 'string', 'description': 'E-mail do destinatário.'},
                'mensagem':      {'type': 'string'}
            },
            'required': ['email_destino', 'mensagem']
        }
    },
]

# Defaults de permissão por perfil
PERMISSOES_PADRAO = {
    'admin': {
        'hub':     ['central', 'painel_controle', 'painel_resultados', 'atlas', 'agenda'],
        'modulos': ['pedidos', 'fretes', 'armazenagem', 'estoque', 'cap_operacional',
                    'recebimentos', 'fat_dist', 'fat_arm']
    },
    'analista': {
        'hub':     ['central', 'atlas', 'agenda'],
        'modulos': ['pedidos', 'fretes', 'armazenagem', 'estoque', 'cap_operacional', 'recebimentos']
    },
    'financeiro': {
        'hub':     ['central', 'atlas', 'agenda'],
        'modulos': ['fat_dist', 'fat_arm']
    },
    'operacional': {
        'hub':     ['atlas', 'agenda'],
        'modulos': []
    },
}

class Permissao(db.Model):
    __tablename__ = 'permissoes'
    id           = db.Column(db.Integer, primary_key=True)
    usuario_id   = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), unique=True, nullable=False)
    hub_json     = db.Column(db.Text, nullable=False, default='[]')
    modulos_json = db.Column(db.Text, nullable=False, default='[]')

    usuario = db.relationship('User', backref=db.backref('permissao', uselist=False))

    def to_dict(self):
        return {
            'hub':     json.loads(self.hub_json),
            'modulos': json.loads(self.modulos_json),
        }

    @staticmethod
    def criar_para(usuario_id: int, perfil: str):
        padrao = PERMISSOES_PADRAO.get(perfil, PERMISSOES_PADRAO['operacional'])
        return Permissao(
            usuario_id   = usuario_id,
            hub_json     = json.dumps(padrao['hub']),
            modulos_json = json.dumps(padrao['modulos']),
        )

class User(db.Model):
    __tablename__ = 'baia360_users'
    id         = db.Column(db.Integer, primary_key=True)
    nome       = db.Column(db.String(100), nullable=False)
    email      = db.Column(db.String(120), unique=True, nullable=False)
    senha_hash = db.Column(db.String(256), nullable=False)
    perfil     = db.Column(db.String(20), default='operacional')
    ativo      = db.Column(db.Boolean, default=False)
    status     = db.Column(db.String(20), default='pendente')
    criado_em  = db.Column(db.DateTime, default=datetime.utcnow)

    def set_senha(self, senha):
        self.senha_hash = generate_password_hash(senha)

    def check_senha(self, senha):
        return check_password_hash(self.senha_hash, senha)

    def to_dict(self):
        return {
            'id':        self.id,
            'nome':      self.nome,
            'email':     self.email,
            'perfil':    self.perfil,
            'ativo':     self.ativo,
            'status':    self.status,
            'criado_em': self.criado_em.isoformat()
        }

class RelatorioGerado(db.Model):
    __tablename__ = 'relatorios_gerados'

    id         = db.Column(db.Integer, primary_key=True)
    modulo     = db.Column(db.String(50), nullable=False)
    mes_ref    = db.Column(db.String(10), nullable=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=True)
    gerado_em  = db.Column(db.DateTime, default=datetime.utcnow)
    kpis_json  = db.Column(db.Text, nullable=True)  # KPIs em JSON

    usuario = db.relationship('User', backref='relatorios')

    def kpis(self):
        return json.loads(self.kpis_json) if self.kpis_json else {}

    def to_dict(self):
        return {
            'id':        self.id,
            'modulo':    self.modulo,
            'mes_ref':   self.mes_ref,
            'usuario':   self.usuario.nome if self.usuario else 'Desconhecido',
            'gerado_em': self.gerado_em.isoformat(),
            'kpis':      self.kpis()
        }

# db.create_all() é executado pelo entrypoint.sh antes do gunicorn subir

@app.errorhandler(413)
def arquivo_muito_grande(e):
    return jsonify({'erro': 'Arquivo excede o tamanho máximo permitido (50MB)'}), 413

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

# ── Rotas Auth ────────────────────────────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data  = request.get_json()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')

    if not email or not senha:
        return jsonify({'erro': 'Email e senha são obrigatórios'}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not user.check_senha(senha):
        return jsonify({'erro': 'Credenciais inválidas'}), 401
    if user.status == 'pendente':
        return jsonify({'erro': 'Cadastro aguardando aprovação do administrador.'}), 403
    if not user.ativo:
        return jsonify({'erro': 'Usuário inativo'}), 403

    token = create_access_token(identity=str(user.id), expires_delta=timedelta(hours=8))
    resp  = jsonify({'usuario': user.to_dict()})
    set_access_cookies(resp, token)
    return resp, 200


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    resp = jsonify({'ok': True})
    unset_jwt_cookies(resp)
    return resp, 200


@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def me():
    """Retorna os dados do usuário logado a partir do cookie — frontend usa para validar sessão."""
    user = User.query.get(int(get_jwt_identity()))
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404
    return jsonify(user.to_dict()), 200



@app.route('/api/auth/cadastro', methods=['POST'])
@limiter.limit("5 per hour")
def cadastro():
    """
    Rota pública — qualquer pessoa pode criar uma conta.
    Perfil sempre 'usuario', ativo=True imediatamente.
    """
    data  = request.get_json()
    nome  = data.get('nome', '').strip()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')
    senha_confirmacao = data.get('senha_confirmacao', '')

    # Validações
    if not all([nome, email, senha, senha_confirmacao]):
        return jsonify({'erro': 'Todos os campos são obrigatórios'}), 400
    if len(nome) < 2:
        return jsonify({'erro': 'Nome deve ter pelo menos 2 caracteres'}), 400
    if len(senha) < 8:
        return jsonify({'erro': 'A senha deve ter pelo menos 8 caracteres'}), 400
    if not re.search(r'[A-Z]', senha):
        return jsonify({'erro': 'A senha deve conter pelo menos 1 letra maiúscula'}), 400
    if not re.search(r'[^a-zA-Z0-9]', senha):
        return jsonify({'erro': 'A senha deve conter pelo menos 1 caractere especial (!@#$%...)'}), 400
    if senha != senha_confirmacao:
        return jsonify({'erro': 'As senhas não coincidem'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'erro': 'Este e-mail já está cadastrado'}), 409

    novo = User(nome=nome, email=email, perfil='operacional', ativo=False, status='pendente')
    novo.set_senha(senha)
    db.session.add(novo)
    db.session.commit()

    return jsonify({'mensagem': 'Cadastro realizado! Aguarde a aprovação do administrador.'}), 201

@app.route('/api/auth/usuarios', methods=['GET'])
@jwt_required()
def listar_usuarios():
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    return jsonify([u.to_dict() for u in User.query.all()]), 200


@app.route('/api/auth/usuarios', methods=['POST'])
@jwt_required()
def criar_usuario():
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    data  = request.get_json()
    email = data.get('email', '').strip().lower()
    if User.query.filter_by(email=email).first():
        return jsonify({'erro': 'Email já cadastrado'}), 409

    senha_nova = data.get('senha', '')
    if len(senha_nova) < 8:
        return jsonify({'erro': 'A senha deve ter pelo menos 8 caracteres'}), 400
    if not re.search(r'[A-Z]', senha_nova):
        return jsonify({'erro': 'A senha deve conter pelo menos 1 letra maiúscula'}), 400
    if not re.search(r'[^a-zA-Z0-9]', senha_nova):
        return jsonify({'erro': 'A senha deve conter pelo menos 1 caractere especial (!@#$%...)'}), 400

    novo = User(nome=data.get('nome',''), email=email, perfil=data.get('perfil','usuario'))
    novo.set_senha(senha_nova)
    db.session.add(novo)
    db.session.commit()
    return jsonify(novo.to_dict()), 201

@app.route('/api/auth/seed', methods=['POST'])
def seed():
    seed_key = request.get_json(silent=True) or {}
    if seed_key.get('seed_key') != os.getenv('SEED_KEY', ''):
        return jsonify({'erro': 'Não autorizado'}), 403

    admin_email = os.getenv('ADMIN_EMAIL', 'admin@baia360.com')
    admin_senha = os.getenv('ADMIN_SENHA', '')
    if not admin_senha:
        return jsonify({'erro': 'ADMIN_SENHA não configurada'}), 500

    if User.query.filter_by(email=admin_email).first():
        return jsonify({'msg': 'Admin já existe'}), 200

    admin = User(nome='Administrador', email=admin_email, perfil='admin')
    admin.set_senha(admin_senha)
    db.session.add(admin)
    db.session.commit()
    return jsonify({'msg': 'Admin criado com sucesso'}), 201

@app.route('/api/auth/usuarios/<int:user_id>', methods=['GET'])
@jwt_required()
def get_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404
    return jsonify(user.to_dict()), 200


@app.route('/api/auth/usuarios/<int:user_id>', methods=['PUT'])
@jwt_required()
def atualizar_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    data = request.get_json()
    if 'nome' in data:
        user.nome = data['nome']
    if 'email' in data:
        email = data['email'].strip().lower()
        existente = User.query.filter_by(email=email).first()
        if existente and existente.id != user_id:
            return jsonify({'erro': 'Email já cadastrado'}), 409
        user.email = email
    if 'perfil' in data:
        user.perfil = data['perfil']
    if 'ativo' in data:
        user.ativo = data['ativo']

    db.session.commit()
    return jsonify(user.to_dict()), 200


@app.route('/api/auth/usuarios/<int:user_id>/senha', methods=['PUT'])
@jwt_required()
def redefinir_senha(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    data = request.get_json()
    nova_senha = data.get('nova_senha', '')
    if len(nova_senha) < 8:
        return jsonify({'erro': 'Senha deve ter pelo menos 8 caracteres'}), 400

    user.set_senha(nova_senha)
    db.session.commit()
    return jsonify({'msg': 'Senha redefinida com sucesso'}), 200


@app.route('/api/auth/usuarios/<int:user_id>', methods=['DELETE'])
@jwt_required()
def deletar_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404
    if user.id == admin.id:
        return jsonify({'erro': 'Não é possível deletar seu próprio usuário'}), 400

    Permissao.query.filter_by(usuario_id=user.id).delete()
    AtlasConversa.query.filter_by(usuario_id=user.id).delete()
    AtlasLog.query.filter_by(usuario_id=user.id).delete()
    AtlasMemoria.query.filter_by(usuario_id=user.id).delete()
    RelatorioGerado.query.filter_by(usuario_id=user.id).update({'usuario_id': None})
    db.session.delete(user)
    db.session.commit()
    return jsonify({'msg': 'Usuário deletado com sucesso'}), 200

@app.route('/api/auth/usuarios/<int:user_id>/aprovar', methods=['POST'])
@jwt_required()
def aprovar_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if not admin or admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    data   = request.get_json()
    perfil = data.get('perfil', 'operacional')
    if perfil not in ['admin', 'analista', 'financeiro', 'operacional']:
        return jsonify({'erro': 'Perfil inválido'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    user.perfil = perfil
    user.ativo  = True
    user.status = 'ativo'

    # Cria ou atualiza permissões com o padrão do perfil
    perm = Permissao.query.filter_by(usuario_id=user.id).first()
    if perm:
        padrao = PERMISSOES_PADRAO.get(perfil, PERMISSOES_PADRAO['operacional'])
        perm.hub_json     = json.dumps(padrao['hub'])
        perm.modulos_json = json.dumps(padrao['modulos'])
    else:
        db.session.add(Permissao.criar_para(user.id, perfil))

    db.session.commit()
    return jsonify({'ok': True, 'usuario': user.to_dict()}), 200


@app.route('/api/auth/usuarios/<int:user_id>/rejeitar', methods=['POST'])
@jwt_required()
def rejeitar_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if not admin or admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    user.status = 'rejeitado'
    user.ativo  = False
    db.session.commit()
    return jsonify({'ok': True}), 200

@app.route('/api/auth/me/permissoes', methods=['GET'])
@jwt_required()
def get_minhas_permissoes():
    usuario_id = int(get_jwt_identity())
    usuario = User.query.get(usuario_id)
    if not usuario:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    # Admin sempre tem tudo
    if usuario.perfil == 'admin':
        padrao = PERMISSOES_PADRAO['admin']
        return jsonify(padrao), 200

    perm = Permissao.query.filter_by(usuario_id=usuario_id).first()
    if not perm:
        # Fallback: cria com padrão do perfil
        perm = Permissao.criar_para(usuario_id, usuario.perfil)
        db.session.add(perm)
        db.session.commit()

    return jsonify(perm.to_dict()), 200


@app.route('/api/auth/usuarios/<int:user_id>/permissoes', methods=['GET'])
@jwt_required()
def get_permissoes_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if not admin or admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    perm = Permissao.query.filter_by(usuario_id=user_id).first()
    if not perm:
        perm = Permissao.criar_para(user_id, user.perfil)
        db.session.add(perm)
        db.session.commit()

    return jsonify(perm.to_dict()), 200


@app.route('/api/auth/usuarios/<int:user_id>/permissoes', methods=['PUT'])
@jwt_required()
def atualizar_permissoes_usuario(user_id):
    admin = User.query.get(int(get_jwt_identity()))
    if not admin or admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    data = request.get_json()
    hub     = data.get('hub', [])
    modulos = data.get('modulos', [])

    perm = Permissao.query.filter_by(usuario_id=user_id).first()
    if perm:
        perm.hub_json     = json.dumps(hub)
        perm.modulos_json = json.dumps(modulos)
    else:
        perm = Permissao(
            usuario_id   = user_id,
            hub_json     = json.dumps(hub),
            modulos_json = json.dumps(modulos),
        )
        db.session.add(perm)

    db.session.commit()
    return jsonify({'ok': True}), 200

def _verificar_permissao_modulo(usuario_id: int, modulo: str) -> bool:
    """Retorna True se o usuário tem permissão para acessar o módulo."""
    usuario = User.query.get(usuario_id)
    if not usuario:
        return False
    if usuario.perfil == 'admin':
        return True
    perm = Permissao.query.filter_by(usuario_id=usuario_id).first()
    if not perm:
        return False
    modulos = json.loads(perm.modulos_json)
    return modulo in modulos

# Dicionário para armazenar progresso dos jobs
jobs = {}

# ── Extratores de KPIs ────────────────────────────────────────────────────────

def _extrair_kpis_pedidos(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Resumo Por Depositante')
        df = df[df['Depositante'] != 'TOTAL GERAL']
        total     = int(df['Total Geral'].sum())
        sla       = round(float((df['SLA %'] * df['Total Geral']).sum() / df['Total Geral'].sum()) * 100, 1)
        excedidas = int(df['Excedido D+1'].sum())
        return {'total_ordens': total, 'sla_pct': sla, 'excedidas': excedidas}
    except Exception:
        return {}

def _extrair_kpis_fretes(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Consolidado')
        total_frete = round(float(df['Valor Frete Total'].sum()), 2)
        remetentes  = int(df['Remetente'].nunique())
        return {'total_frete': total_frete, 'remetentes': remetentes}
    except Exception as e:
        print(f'[KPI FRETES ERRO] {e}')
        return {}

def _extrair_kpis_armazenagem(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Armazenagem')
        total    = round(float(df['Soma Armazenagem'].sum()), 2)
        clientes = int(df.shape[0])
        return {'total_armazenagem': total, 'clientes': clientes}
    except Exception:
        return {}

def _extrair_kpis_estoque(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Resumo por Cliente')
        df = df[df['Cliente'] != 'TOTAL GERAL']
        clientes  = int(df.shape[0])
        top_row   = df.loc[df['Pico Volume m³'].idxmax()]
        top_pico  = round(float(top_row['Pico Volume m³']), 2)
        top_cli   = str(top_row['Cliente'])
        return {'clientes': clientes, 'maior_pico_m3': top_pico, 'maior_pico_cliente': top_cli}
    except Exception:
        return {}

def _extrair_kpis_recebimentos(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Resumo por Depositante')
        total_rec  = int(df['Total Recebimentos'].sum())
        valor_total = round(float(df['Valor Total (R$)'].sum()), 2)
        depositantes = int(df.shape[0])
        return {'total_recebimentos': total_rec, 'valor_total': valor_total, 'depositantes': depositantes}
    except Exception:
        return {}

def _extrair_kpis_fat_dist(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Fechamento', header=None)
        mask_total = df[1].astype(str).str.contains('TOTAL GERAL', na=False)
        total = round(float(pd.to_numeric(df.loc[mask_total, 3], errors='coerce').iloc[0]), 2)
        clientes = int(df[1].dropna().apply(lambda x: str(x).strip()).str.endswith('›').sum())
        return {'total_frete': total, 'clientes': clientes}
    except Exception:
        return {}

def _extrair_kpis_fat_arm(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Resumo', header=None)
        # Linhas de TOTAL têm 'Total a Faturar' na col 6, filtra linhas de total por cliente
        mask  = df[0].astype(str).str.startswith('TOTAL —')
        total = round(float(df.loc[mask, 6].sum()), 2)
        clientes = int(mask.sum())
        return {'total_faturamento': total, 'clientes': clientes}
    except Exception:
        return {}

def _extrair_kpis_cap_operacional(caminho_xlsx):
    try:
        df = pd.read_excel(caminho_xlsx, sheet_name='Resumo por Depositante')
        total_os     = int(df['Total de OS'].sum())
        depositantes = int(df.shape[0])
        return {'total_os': total_os, 'depositantes': depositantes}
    except Exception:
        return {}

_EXTRATORES_KPIS = {
    'Pedidos':          _extrair_kpis_pedidos,
    'Fretes':           _extrair_kpis_fretes,
    'Armazenagem':      _extrair_kpis_armazenagem,
    'Estoque':          _extrair_kpis_estoque,
    'Recebimentos':     _extrair_kpis_recebimentos,
    'Fat. Distribuição':_extrair_kpis_fat_dist,
    'Fat. Armazenagem': _extrair_kpis_fat_arm,
    'Cap. Operacional': _extrair_kpis_cap_operacional,
}

@app.route('/api/modulos/fretes', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_fretes_route():
    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'fretes'):
        return jsonify({'erro': 'Acesso negado'}), 403

    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo  = request.files['arquivo']
    mes_ref  = request.form.get('mes_ref', '').strip() or None

    nome_seguro = secure_filename(arquivo.filename or 'arquivo')
    if not nome_seguro.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            resultado = mod.processar_fretes(
                tmp_entrada.name, log,
                _saida_override=tmp_saida.name)

            if resultado:
                jobs[job_id]['status']  = 'concluido'
                jobs[job_id]['arquivo'] = tmp_saida.name
                try:
                    with app.app_context():
                        kpis = _extrair_kpis_fretes(tmp_saida.name)
                        reg  = RelatorioGerado(modulo='Fretes', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                        db.session.add(reg)
                        db.session.commit()
                except Exception:
                    pass
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            _deletar_temp(tmp_entrada.name)

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202


@app.route('/api/modulos/status/<job_id>', methods=['GET'])
@jwt_required()
def status_job(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'erro': 'Job não encontrado'}), 404
    if job.get('usuario_id') != int(get_jwt_identity()):
        return jsonify({'erro': 'Acesso negado'}), 403
    return jsonify(job), 200


@app.route('/api/modulos/download/<job_id>', methods=['GET'])
@jwt_required()
def download_resultado(job_id):
    # Cookie httpOnly enviado automaticamente pelo browser — sem token na URL
    job = jobs.get(job_id)
    if not job:
        return jsonify({'erro': 'Arquivo não disponível'}), 404
    if job.get('usuario_id') != int(get_jwt_identity()):
        return jsonify({'erro': 'Acesso negado'}), 403
    if job['status'] != 'concluido':
        return jsonify({'erro': 'Arquivo não disponível'}), 404

    return send_file(
        job['arquivo'],
        as_attachment=True,
        download_name=job.get('nome', 'relatorio.xlsx'),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.route('/api/modulos/armazenagem', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_armazenagem_route():
    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'armazenagem'):
        return jsonify({'erro': 'Acesso negado'}), 403

    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo    = request.files['arquivo']
    mes_filtro = request.form.get('mes_filtro', '').strip()

    if not mes_filtro:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    nome_seguro = secure_filename(arquivo.filename or 'arquivo')
    if not nome_seguro.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            resultado = mod.processar_armazenagem(
                tmp_entrada.name, mes_filtro, log,
                _saida_override=tmp_saida.name)

            if resultado:
                jobs[job_id]['status']  = 'concluido'
                jobs[job_id]['arquivo'] = tmp_saida.name
                jobs[job_id]['nome']    = f'relatorio_armazenagem_{mes_filtro}.xlsx'
                try:
                    with app.app_context():
                        kpis = _extrair_kpis_armazenagem(tmp_saida.name)
                        reg  = RelatorioGerado(modulo='Armazenagem', mes_ref=mes_filtro, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                        db.session.add(reg)
                        db.session.commit()
                except Exception as e:
                    log(f'Erro ao salvar KPIs: {str(e)}')
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            _deletar_temp(tmp_entrada.name)

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/pedidos', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_pedidos_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip() or None

    nome_seguro = secure_filename(arquivo.filename or 'arquivo')
    if not nome_seguro.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'pedidos'):
        return jsonify({'erro': 'Acesso negado'}), 403
    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            resultado = mod.processar_pedidos(
                tmp_entrada.name, log,
                _saida_override=tmp_saida.name)

            if resultado:
                jobs[job_id]['status']  = 'concluido'
                jobs[job_id]['arquivo'] = tmp_saida.name
                jobs[job_id]['nome']    = 'relatorio_pedidos.xlsx'
                try:
                    with app.app_context():
                        kpis = _extrair_kpis_pedidos(tmp_saida.name)
                        reg  = RelatorioGerado(modulo='Pedidos', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                        db.session.add(reg)
                        db.session.commit()
                except Exception as e:
                    log(f'Erro ao salvar KPIs: {str(e)}')
                    pass
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            _deletar_temp(tmp_entrada.name)

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/recebimentos', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_recebimentos_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip()

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    nome_seguro = secure_filename(arquivo.filename or 'arquivo')
    if not nome_seguro.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'recebimentos'):
        return jsonify({'erro': 'Acesso negado'}), 403
    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            mod._caminho_saida = lambda *args, **kwargs: tmp_saida.name

            resultado = mod.run_recebimentos(
                tmp_entrada.name, mes_ref, log)

            jobs[job_id]['status']  = 'concluido'
            jobs[job_id]['arquivo'] = tmp_saida.name
            jobs[job_id]['nome']    = f'relatorio_recebimentos_{mes_ref}.xlsx'
            try:
                with app.app_context():
                    kpis = _extrair_kpis_recebimentos(tmp_saida.name)
                    reg  = RelatorioGerado(modulo='Recebimentos', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                    db.session.add(reg)
                    db.session.commit()
            except Exception as e:
                log(f'Erro ao salvar KPIs: {str(e)}')
                pass
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            try:
                _deletar_temp(tmp_entrada.name)
            except Exception:
                pass

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/cap_operacional', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_cap_operacional_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip()

    try:
        limiar_media = float(request.form.get('limiar_media', 3.0))
        limiar_alta  = float(request.form.get('limiar_alta', 5.0))
        if not (0 <= limiar_media <= 100 and 0 <= limiar_alta <= 100):
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({'erro': 'Limiares inválidos'}), 400

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    nome_seguro = secure_filename(arquivo.filename or 'arquivo')
    if not nome_seguro.lower().endswith('.pdf'):
        return jsonify({'erro': 'Arquivo deve ser .pdf'}), 400

    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'cap_operacional'):
        return jsonify({'erro': 'Acesso negado'}), 403
    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            mod._caminho_saida = lambda *args, **kwargs: tmp_saida.name

            mod.run_cap_operacional_pdf(
                tmp_entrada.name, mes_ref, log,
                limiar_media=limiar_media,
                limiar_alta=limiar_alta)

            jobs[job_id]['status']  = 'concluido'
            jobs[job_id]['arquivo'] = tmp_saida.name
            jobs[job_id]['nome']    = f'cap_operacional_{mes_ref}.xlsx'
            try:
                with app.app_context():
                    kpis = _extrair_kpis_cap_operacional(tmp_saida.name)
                    reg  = RelatorioGerado(modulo='Cap. Operacional', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                    db.session.add(reg)
                    db.session.commit()
            except Exception as e:
                log(f'Erro ao salvar KPIs: {str(e)}')
                pass
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            try:
                _deletar_temp(tmp_entrada.name)
            except Exception:
                pass

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

DB_ESTOQUE_PATH_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'estoque_db.json')
os.makedirs(os.path.dirname(DB_ESTOQUE_PATH_WEB), exist_ok=True)

@app.route('/api/modulos/estoque/db/info', methods=['GET'])
@jwt_required()
def estoque_db_info():
    try:
        if not os.path.exists(DB_ESTOQUE_PATH_WEB):
            return jsonify({'total_skus': 0, 'ultima': None, 'clientes': []}), 200
        with open(DB_ESTOQUE_PATH_WEB, 'r', encoding='utf-8') as f:
            estoque_data = json.load(f)
        total  = sum(len(skus) for skus in estoque_data.values())
        datas  = []
        for skus in estoque_data.values():
            for sku in skus.values():
                if sku.get('atualizado'):
                    datas.append(sku['atualizado'])
        ultima = max(datas) if datas else None
        return jsonify({'total_skus': total, 'ultima': ultima, 'clientes': list(estoque_data.keys())}), 200
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/modulos/estoque/db/carga', methods=['POST'])
@jwt_required()
def estoque_db_carga():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp.name)
    tmp.close()

    logs = []
    def log(msg): logs.append(msg)

    try:
        spec = importlib.util.spec_from_file_location(
            'central',
            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         'modules', 'central_relatorios.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        mod.DB_ESTOQUE_PATH = DB_ESTOQUE_PATH_WEB
        estoque_data = mod._carregar_estoque_xlsx(tmp.name, log)
        if estoque_data:
            mod._salvar_db_estoque(estoque_data)
            total = sum(len(s) for s in estoque_data.values())
            return jsonify({'msg': f'Carga inicial concluída — {total} SKUs', 'logs': logs}), 200
        return jsonify({'erro': 'Falha na carga', 'logs': logs}), 400
    except Exception as e:
        return jsonify({'erro': str(e), 'logs': logs}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@app.route('/api/modulos/estoque/db/atualizar', methods=['POST'])
@jwt_required()
def estoque_db_atualizar():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp.name)
    tmp.close()

    logs = []
    def log(msg): logs.append(msg)

    try:
        spec = importlib.util.spec_from_file_location(
            'central',
            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         'modules', 'central_relatorios.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        mod.DB_ESTOQUE_PATH = DB_ESTOQUE_PATH_WEB
        mod._atualizar_db_com_movimentacao(tmp.name, log)
        return jsonify({'msg': 'DB atualizado com sucesso', 'logs': logs}), 200
    except Exception as e:
        return jsonify({'erro': str(e), 'logs': logs}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@app.route('/api/modulos/estoque/gerar', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_estoque_route():
    if 'arquivo_pico' not in request.files:
        return jsonify({'erro': 'Arquivo de pico não enviado'}), 400

    arquivo_pico = request.files['arquivo_pico']
    dias_ocioso  = int(request.form.get('dias_ocioso', 120))
    mes_ref      = request.form.get('mes_ref', '').strip()

    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'estoque'):
        return jsonify({'erro': 'Acesso negado'}), 403

    _nome_pico = secure_filename(arquivo_pico.filename or 'arquivo')
    tmp_pico  = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo_pico.save(tmp_pico.name)
    tmp_pico.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            mod.DB_ESTOQUE_PATH = DB_ESTOQUE_PATH_WEB
            mod._caminho_saida  = lambda *args, **kwargs: tmp_saida.name

            resultado = mod.processar_estoque(
                '',           # arquivo_estoque vazio — usa DB interno
                tmp_pico.name,
                '',           # arquivo_movimentacao vazio
                dias_ocioso,
                log,
                _saida_override=tmp_saida.name)

            if resultado:
                jobs[job_id]['status']  = 'concluido'
                jobs[job_id]['arquivo'] = tmp_saida.name
                jobs[job_id]['nome']    = f'relatorio_estoque_{mes_ref}.xlsx'
                try:
                    with app.app_context():
                        kpis = _extrair_kpis_estoque(tmp_saida.name)
                        reg  = RelatorioGerado(modulo='Estoque', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                        db.session.add(reg)
                        db.session.commit()
                except Exception as e:
                    log(f'Erro ao salvar KPIs: {str(e)}')
                    pass
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            try:
                os.unlink(tmp_pico.name)
            except Exception:
                pass

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/fat_dist', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_fat_dist_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip()

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    nome_seguro = secure_filename(arquivo.filename or 'arquivo')
    if not nome_seguro.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'fat_dist'):
        return jsonify({'erro': 'Acesso negado'}), 403
    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_dir = tempfile.mkdtemp()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            resultado = mod.run_faturamento_distribuicao(
                tmp_entrada.name, mes_ref, log,
                pasta_saida=tmp_dir)

            if resultado:
                jobs[job_id]['status']  = 'concluido'
                jobs[job_id]['arquivo'] = resultado
                jobs[job_id]['nome']    = f'Fat_Distribuicao_{mes_ref}.xlsx'
                try:
                    with app.app_context():
                        kpis = _extrair_kpis_fat_dist(resultado)
                        reg  = RelatorioGerado(modulo='Fat. Distribuição', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                        db.session.add(reg)
                        db.session.commit()
                except Exception as e:
                    log(f'Erro ao salvar KPIs: {str(e)}')
                    pass
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            try:
                _deletar_temp(tmp_entrada.name)
            except Exception:
                pass

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

DB_FAMILIAS_PATH_WEB   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'fat_arm_familias.json')
DB_PRECOS_ARM_PATH_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'fat_arm_precos.json')

def _carregar_modulo_central():
    spec = importlib.util.spec_from_file_location(
        'central',
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'modules', 'central_relatorios.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.DB_FAMILIAS_PATH   = DB_FAMILIAS_PATH_WEB
    mod.DB_PRECOS_ARM_PATH = DB_PRECOS_ARM_PATH_WEB
    return mod

@app.route('/api/modulos/fat_arm/status', methods=['GET'])
@jwt_required()
def fat_arm_db_status():
    resultado = {
        'familias': {'total_skus': 0, 'total_clientes': 0, 'ultima': None},
        'config':   {'total_clientes': 0, 'ultima': None},
    }
    try:
        with open(DB_FAMILIAS_PATH_WEB, 'r', encoding='utf-8') as f:
            db_fam = json.load(f)
        ultima = None
        for skus in db_fam.values():
            for info in skus.values():
                ultima = info.get('atualizado')
                break
            break
        resultado['familias'] = {
            'total_skus':      sum(len(skus) for skus in db_fam.values()),
            'total_clientes':  len(db_fam),
            'ultima':          ultima,
        }
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    try:
        with open(DB_PRECOS_ARM_PATH_WEB, 'r', encoding='utf-8') as f:
            db_cfg = json.load(f)
        resultado['config'] = {
            'total_clientes': sum(1 for v in db_cfg.get('clientes', {}).values() if v.get('preco_m3', 0) > 0),
            'ultima':         db_cfg.get('atualizado'),
        }
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return jsonify(resultado), 200

@app.route('/api/modulos/fat_arm/familias', methods=['POST'])
@limiter.limit("5 per minute")
@jwt_required()
def fat_arm_carregar_familias():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Arquivo obrigatório'}), 400
    arquivo = request.files['arquivo']
    if not arquivo.filename or not arquivo.filename.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp.name)
    tmp.close()
    try:
        logs = []
        mod = _carregar_modulo_central()
        db  = mod._carregar_familias_xlsx(tmp.name, logs.append)
        if not db:
            return jsonify({'erro': 'Nenhum dado encontrado no arquivo', 'logs': logs}), 422
        if not mod._salvar_db_familias(db):
            return jsonify({'erro': 'Falha ao salvar DB de famílias no servidor', 'logs': logs}), 500
        return jsonify({
            'total_skus':     sum(len(skus) for skus in db.values()),
            'total_clientes': len(db),
            'logs':           logs,
        }), 200
    except Exception as e:
        return jsonify({'erro': str(e)}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

@app.route('/api/modulos/fat_arm/config', methods=['POST'])
@limiter.limit("5 per minute")
@jwt_required()
def fat_arm_carregar_config():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Arquivo obrigatório'}), 400
    arquivo = request.files['arquivo']
    if not arquivo.filename or not arquivo.filename.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp.name)
    tmp.close()
    try:
        logs = []
        mod = _carregar_modulo_central()
        db  = mod._carregar_config_fat_arm_xlsx(tmp.name, logs.append)
        if not db:
            return jsonify({'erro': 'Arquivo inválido — verifique as abas "Grupo-Familia" e "Valor de armaz."', 'logs': logs}), 422
        if not mod._salvar_db_precos_arm(db):
            return jsonify({'erro': 'Falha ao salvar DB de configuração no servidor', 'logs': logs}), 500
        return jsonify({
            'total_clientes': len(db.get('clientes', {})),
            'logs':           logs,
        }), 200
    except Exception as e:
        return jsonify({'erro': str(e)}), 500
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

@app.route('/api/modulos/fat_arm', methods=['POST'])
@limiter.limit("20 per minute")
@jwt_required()
def processar_fat_arm_route():
    if 'arquivo_mov' not in request.files or 'arquivo_volumes' not in request.files:
        return jsonify({'erro': 'Arquivos de movimentação e volumes são obrigatórios'}), 400

    arquivo_mov     = request.files['arquivo_mov']
    arquivo_volumes = request.files['arquivo_volumes']
    mes_ref         = request.form.get('mes_ref', '').strip()

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    usuario_id = int(get_jwt_identity())
    if not _verificar_permissao_modulo(usuario_id, 'fat_arm'):
        return jsonify({'erro': 'Acesso negado'}), 403

    _nome_mov = secure_filename(arquivo_mov.filename or 'arquivo')
    _nome_vol = secure_filename(arquivo_volumes.filename or 'arquivo')
    tmp_mov = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo_mov.save(tmp_mov.name)
    tmp_mov.close()

    tmp_vol = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo_volumes.save(tmp_vol.name)
    tmp_vol.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None, 'usuario_id': usuario_id}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            spec = importlib.util.spec_from_file_location(
                'central',
                os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'modules', 'central_relatorios.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            mod._caminho_saida      = lambda *args, **kwargs: tmp_saida.name
            mod.DB_FAMILIAS_PATH    = DB_FAMILIAS_PATH_WEB
            mod.DB_PRECOS_ARM_PATH  = DB_PRECOS_ARM_PATH_WEB

            resultado = mod.run_faturamento_armazenagem(
                tmp_mov.name, tmp_vol.name, mes_ref, log)

            if resultado:
                jobs[job_id]['status']  = 'concluido'
                jobs[job_id]['arquivo'] = tmp_saida.name
                jobs[job_id]['nome']    = f'Fat_Armazenagem_{mes_ref}.xlsx'
                try:
                    with app.app_context():
                        kpis = _extrair_kpis_fat_arm(tmp_saida.name)
                        reg  = RelatorioGerado(modulo='Fat. Armazenagem', mes_ref=mes_ref, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
                        db.session.add(reg)
                        db.session.commit()
                except Exception as e:
                    log(f'Erro ao salvar KPIs: {str(e)}')
                    pass
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            for f in [tmp_mov.name, tmp_vol.name]:
                try:
                    os.unlink(f)
                except Exception:
                    pass

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/dashboard/meses', methods=['GET'])
@jwt_required()
def dashboard_meses():
    usuario = User.query.get(int(get_jwt_identity()))
    if not usuario or usuario.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    meses = db.session.query(RelatorioGerado.mes_ref)\
        .filter(RelatorioGerado.mes_ref.isnot(None))\
        .distinct()\
        .order_by(RelatorioGerado.mes_ref.desc())\
        .all()
    return jsonify([m.mes_ref for m in meses]), 200


@app.route('/api/dashboard/resultados', methods=['GET'])
@jwt_required()
def dashboard_resultados():
    usuario = User.query.get(int(get_jwt_identity()))
    if not usuario or usuario.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    mes = request.args.get('mes', '').strip()
    if not mes:
        return jsonify({'erro': 'Parâmetro mes obrigatório'}), 400

    registros = RelatorioGerado.query\
        .filter_by(mes_ref=mes)\
        .order_by(RelatorioGerado.gerado_em.desc())\
        .all()

    por_modulo = {}
    for r in registros:
        if r.modulo not in por_modulo:
            por_modulo[r.modulo] = {
                'modulo':    r.modulo,
                'mes_ref':   r.mes_ref,
                'gerado_em': r.gerado_em.isoformat(),
                'kpis':      r.kpis()
            }

    return jsonify(list(por_modulo.values())), 200

@app.route('/api/dashboard', methods=['GET'])
@jwt_required()
def dashboard():
    # Total por módulo
    por_modulo = db.session.query(
        RelatorioGerado.modulo,
        func.count(RelatorioGerado.id).label('total')
    ).group_by(RelatorioGerado.modulo).all()

    # Evolução mensal
    por_mes = db.session.query(
        RelatorioGerado.mes_ref,
        func.count(RelatorioGerado.id).label('total')
    ).filter(
        RelatorioGerado.mes_ref.isnot(None)
    ).group_by(RelatorioGerado.mes_ref).order_by(RelatorioGerado.mes_ref).all()

    # Últimas 10 gerações
    recentes = RelatorioGerado.query.order_by(
        RelatorioGerado.gerado_em.desc()
    ).limit(10).all()

    # KPIs mais recentes por módulo
    kpis_por_modulo = {}
    for modulo in ['Pedidos', 'Fretes', 'Armazenagem', 'Estoque',
                   'Recebimentos', 'Fat. Distribuição', 'Fat. Armazenagem', 'Cap. Operacional']:
        ultimo = RelatorioGerado.query.filter_by(modulo=modulo)\
            .order_by(RelatorioGerado.gerado_em.desc()).first()
        if ultimo and ultimo.kpis_json:
            kpis_por_modulo[modulo] = {
                'mes_ref':  ultimo.mes_ref,
                'gerado_em': ultimo.gerado_em.isoformat(),
                'kpis':     ultimo.kpis()
            }

    return jsonify({
        'por_modulo':     [{'modulo': r.modulo, 'total': r.total} for r in por_modulo],
        'por_mes':        [{'mes': r.mes_ref, 'total': r.total} for r in por_mes],
        'recentes':       [r.to_dict() for r in recentes],
        'kpis_por_modulo': kpis_por_modulo,
    }), 200

@app.route('/api/auth/perfil', methods=['PUT'])
@jwt_required()
def atualizar_perfil():
    user = User.query.get(int(get_jwt_identity()))
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    data = request.get_json()

    if 'nome' in data and data['nome'].strip():
        user.nome = data['nome'].strip()

    if 'senha_atual' in data and 'nova_senha' in data:
        if not user.check_senha(data['senha_atual']):
            return jsonify({'erro': 'Senha atual incorreta'}), 400
        if len(data['nova_senha']) < 6:
            return jsonify({'erro': 'Nova senha deve ter pelo menos 6 caracteres'}), 400
        user.set_senha(data['nova_senha'])

    db.session.commit()
    return jsonify(user.to_dict()), 200

def analisar_e_salvar_memorias(app_ctx, usuario_id: int, msgs: list):
    """Roda em background — analisa a conversa e atualiza memórias do usuário."""
    # Gatilho: mínimo 6 mensagens do usuário
    msgs_usuario = [m for m in msgs if m.get('role') == 'user']
    if len(msgs_usuario) < 6:
        return

    with app_ctx:
        try:
            # Intervalo mínimo de 24h entre análises
            ultima = AtlasMemoria.query.filter_by(usuario_id=usuario_id)\
                .order_by(AtlasMemoria.atualizada_em.desc()).first()
            if ultima:
                delta = datetime.utcnow() - ultima.atualizada_em
                if delta.total_seconds() < 86400:
                    return

            # Monta o texto apenas com mensagens do usuário
            texto_usuario = '\n'.join([
                f"- {m.get('text', '')}"
                for m in msgs_usuario[-20:]  # últimas 20 mensagens do usuário
                if m.get('text', '').strip()
            ])

            if not texto_usuario.strip():
                return

            # Prompt enxuto para extração de memórias
            prompt = f"""Analise as mensagens abaixo de um usuário conversando com um assistente de IA chamado Atlas, usado em uma empresa de logística farmacêutica.

Extraia de 1 a 5 fatos relevantes sobre esse usuário que ajudariam o Atlas a se comunicar melhor com ele nas próximas conversas. Foque em:
- Estilo de comunicação preferido
- Áreas de interesse ou responsabilidade
- Preferências de formato de resposta
- Contexto profissional relevante

Mensagens do usuário:
{texto_usuario}

Responda APENAS com uma lista JSON no formato:
["fato 1", "fato 2", "fato 3"]

Sem explicações, sem markdown, apenas o JSON."""

            api_key = os.getenv('OPENAI_API_KEY', '').strip()
            client = OpenAI(api_key=api_key)

            response = client.chat.completions.create(
                model='gpt-5.4-mini',
                messages=[{'role': 'user', 'content': prompt}],
                temperature=0.3,
                max_tokens=300
            )

            raw = response.choices[0].message.content.strip()
            # Remove markdown se vier com ```json
            raw = raw.replace('```json', '').replace('```', '').strip()
            novos_fatos = json.loads(raw)

            if not isinstance(novos_fatos, list):
                return

            # Cap de 20 memórias por usuário — remove as mais antigas se necessário
            memorias_atuais = AtlasMemoria.query.filter_by(usuario_id=usuario_id)\
                .order_by(AtlasMemoria.atualizada_em.asc()).all()
            
            espaco_disponivel = 20 - len(memorias_atuais)
            if espaco_disponivel < len(novos_fatos):
                # Remove as mais antigas para abrir espaço
                a_remover = len(novos_fatos) - espaco_disponivel
                for m in memorias_atuais[:a_remover]:
                    db.session.delete(m)

            for fato in novos_fatos:
                if fato.strip():
                    db.session.add(AtlasMemoria(
                        usuario_id=usuario_id,
                        conteudo=fato.strip()
                    ))

            db.session.commit()

        except Exception as e:
            print(f'[AtlasMemoria] Erro na análise: {e}')

@app.route('/api/atlas/chat', methods=['POST'])
@limiter.limit("60 per minute")
@jwt_required()
def atlas_chat():
    """Proxy para a OpenAI Responses API com parâmetros fixados server-side."""
    data = request.get_json()
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada no servidor'}), 500

    # ── Parâmetros aceitos do cliente (apenas preferências de UI seguras) ─────
    history          = data.get('history', [])
    msgs             = data.get('msgs', [])
    conv_id          = data.get('conv_id', '')
    previous_resp_id = data.get('previous_response_id', None)
    use_code_interp  = bool(data.get('code_interpreter', False))

    # Preferências de apresentação — validadas server-side
    modo = data.get('modo', 'Padrão')
    if modo not in ATLAS_MODO_SUFFIXES:
        modo = 'Padrão'

    instrucoes      = str(data.get('instrucoes') or '')[:500]
    memorias_raw    = data.get('memorias', [])
    memorias        = [str(m)[:200] for m in memorias_raw[:20] if m and str(m).strip()]
    projeto_nome    = str(data.get('projeto_nome') or '')[:200].strip()
    projeto_desc    = str(data.get('projeto_descricao') or '')[:1000].strip()

    # ── Busca dados do usuário para personalizar o system prompt ──────────────
    usuario_id  = int(get_jwt_identity())
    usuario     = User.query.get(usuario_id)
    nome_usuario = usuario.nome if usuario else 'Usuário'

    # ── Monta system prompt a partir de componentes confiáveis do servidor ────
    system_prompt = ATLAS_SYSTEM_PROMPT_BASE.replace('{nome_usuario}', nome_usuario)
    if modo in ATLAS_MODO_SUFFIXES:
        system_prompt += ATLAS_MODO_SUFFIXES[modo]
    if instrucoes:
        system_prompt += f'\n\nInstruções do usuário:\n{instrucoes}'
    if memorias:
        system_prompt += '\n\nFatos que o usuário quer que você lembre:\n' + '\n'.join(f'- {m}' for m in memorias)
    if projeto_nome:
        system_prompt += f'\n\n## Contexto do projeto ativo\nVocê está trabalhando dentro do projeto **{projeto_nome}**.'
        if projeto_desc:
            system_prompt += f'\n\nDescrição e contexto:\n{projeto_desc}'
        system_prompt += '\n\nTodas as respostas devem considerar esse contexto.'

    try:
        client = OpenAI(api_key=api_key)

        # ── Converter histórico do formato interno para Responses API ─────────
        def converter_input(hist: list) -> list:
            input_list = []
            for m in hist:
                role = 'assistant' if m['role'] == 'model' else m['role']
                parts = m.get('parts', [])

                fn_responses = [p for p in parts if 'functionResponse' in p]
                if fn_responses:
                    for fr in fn_responses:
                        input_list.append({
                            'type': 'function_call_output',
                            'call_id': fr['functionResponse'].get('call_id', fr['functionResponse']['name']),
                            'output': json.dumps(fr['functionResponse']['response'], ensure_ascii=False)
                        })
                    continue

                fn_calls = [p for p in parts if 'functionCall' in p]
                if fn_calls:
                    for fc in fn_calls:
                        input_list.append({
                            'type': 'function_call',
                            'call_id': fc['functionCall'].get('call_id', fc['functionCall']['name']),
                            'name': fc['functionCall']['name'],
                            'arguments': json.dumps(fc['functionCall'].get('args', {}), ensure_ascii=False)
                        })
                    continue

                content = []
                for p in parts:
                    if 'text' in p:
                        text_type = 'output_text' if role == 'assistant' else 'input_text'
                        content.append({'type': text_type, 'text': p['text']})
                    elif 'file_data' in p:
                        content.append({'type': 'input_file', 'file_id': p['file_data']['file_id']})
                if content:
                    input_list.append({'role': role, 'content': content})

            return input_list

        # ── Converte declarações de tools para formato OpenAI strict mode ─────
        def build_tools(declarations: list) -> list:
            tools = []
            for t in declarations:
                params = t.get('parameters', {'type': 'object', 'properties': {}})
                properties = params.get('properties', {})
                all_keys = list(properties.keys())
                tools.append({
                    'type': 'function',
                    'name': t['name'],
                    'description': t.get('description', ''),
                    'parameters': {
                        'type': 'object',
                        'properties': properties,
                        'required': all_keys,
                        'additionalProperties': False
                    },
                    'strict': True
                })
            return tools

        input_list   = converter_input(history)
        openai_tools = build_tools(ATLAS_TOOLS_DECLARATIONS)

        # ── Chamada à Responses API com streaming SSE ─────────────────────────
        def generate():
            try:
                all_tools = list(openai_tools)
                all_tools.append({'type': 'web_search_preview'})
                if use_code_interp:
                    all_tools.append({'type': 'code_interpreter', 'container': {'type': 'auto'}})
                vs_id = os.getenv('OPENAI_VECTOR_STORE_ID', '').strip()
                if vs_id:
                    all_tools.append({'type': 'file_search', 'vector_store_ids': [vs_id]})

                kwargs = dict(
                    model=ATLAS_MODEL,
                    input=input_list,
                    instructions=system_prompt,
                    temperature=ATLAS_TEMPERATURE,
                    tools=all_tools,
                    stream=True,
                    reasoning={'effort': ATLAS_REASONING_EFFORT, 'summary': 'auto'},
                    store=True,
                )
                if previous_resp_id:
                    kwargs['previous_response_id'] = previous_resp_id

                stream = client.responses.create(**kwargs)

                text_buffer     = ''
                fn_calls_buffer: dict = {}

                for event in stream:
                    etype = event.type

                    if etype == 'response.output_text.delta':
                        delta = event.delta or ''
                        text_buffer += delta
                        yield f"data: {json.dumps({'type': 'text_delta', 'delta': delta})}\n\n"

                    elif etype == 'response.output_item.added':
                        item = event.item
                        if getattr(item, 'type', None) == 'function_call':
                            fn_calls_buffer[item.call_id] = {'name': item.name, 'arguments': ''}
                        elif getattr(item, 'type', None) == 'reasoning':
                            yield f"data: {json.dumps({'type': 'reasoning_start'})}\n\n"

                    elif etype == 'response.reasoning_summary_text.delta':
                        delta = event.delta or ''
                        yield f"data: {json.dumps({'type': 'reasoning_delta', 'delta': delta})}\n\n"

                    elif etype == 'response.function_call_arguments.delta':
                        if fn_calls_buffer:
                            call_id = list(fn_calls_buffer.keys())[-1]
                            fn_calls_buffer[call_id]['arguments'] += (event.delta or '')

                    elif etype == 'response.output_item.done':
                        item = event.item
                        if getattr(item, 'type', None) == 'function_call':
                            call_id = item.call_id
                            try:
                                args = json.loads(item.arguments or '{}')
                            except Exception:
                                args = {}
                            fn_calls_buffer[call_id] = {'name': item.name, 'arguments': item.arguments}
                            yield f"data: {json.dumps({'type': 'function_call', 'call_id': call_id, 'name': item.name, 'args': args})}\n\n"

                    elif etype == 'response.completed':
                        resp_id   = getattr(event.response, 'id', None)
                        citations = []
                        try:
                            output = getattr(event.response, 'output', None) or []
                            for item in output:
                                content = getattr(item, 'content', None) or []
                                for part in content:
                                    annotations = getattr(part, 'annotations', None) or []
                                    for ann in annotations:
                                        if getattr(ann, 'type', '') == 'url_citation':
                                            url   = getattr(ann, 'url', '')
                                            title = getattr(ann, 'title', url)
                                            start = getattr(ann, 'start_index', None)
                                            end   = getattr(ann, 'end_index', None)
                                            if url and not any(c['url'] == url for c in citations):
                                                citations.append({'url': url, 'title': title, 'start': start, 'end': end})
                        except Exception:
                            pass
                        yield f"data: {json.dumps({'type': 'done', 'text': text_buffer, 'response_id': resp_id, 'citations': citations})}\n\n"

                    elif etype == 'error':
                        yield f"data: {json.dumps({'type': 'error', 'message': str(event)})}\n\n"

            except Exception as e:
                traceback.print_exc()
                msg = str(e)
                if '429' in msg or 'quota' in msg.lower() or 'rate_limit' in msg.lower():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'cota_openai'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Erro interno ao processar resposta.'})}\n\n"

        # Dispara análise de memórias em background
        threading.Thread(
            target=analisar_e_salvar_memorias,
            args=(app.app_context(), usuario_id, msgs),
            daemon=True
        ).start()

        # Popula AtlasLog na primeira mensagem da conversa
        primeira = next((m.get('text', '') for m in msgs if m.get('role') == 'user'), '')
        if conv_id and primeira:
            existe = AtlasLog.query.filter_by(usuario_id=usuario_id, primeira_msg=primeira[:200]).first()
            if not existe:
                db.session.add(AtlasLog(
                    usuario_id   = usuario_id,
                    primeira_msg = primeira[:200],
                    total_msgs   = len(msgs)
                ))
                try:
                    db.session.commit()
                except Exception:
                    db.session.rollback()

        return app.response_class(generate(), mimetype='text/event-stream',
                                   headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': 'Erro interno no servidor.'}), 500


@app.route('/api/atlas/upload_arquivo', methods=['POST'])
@jwt_required()
def atlas_upload_arquivo():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    nome = secure_filename(arquivo.filename or 'arquivo')

    extensoes_suportadas = {
        '.xlsx', '.xls', '.csv',
        '.pdf',
        '.docx', '.doc', '.rtf',
        '.pptx', '.ppt',
        '.png', '.jpg', '.jpeg', '.webp', '.gif',
        '.txt', '.md', '.json', '.html', '.xml',
    }

    ext = os.path.splitext(nome)[1].lower()
    if ext not in extensoes_suportadas:
        return jsonify({'erro': f'Tipo de arquivo não suportado: {ext}'}), 400

    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada'}), 500

    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        arquivo.save(tmp.name)
        tmp.close()

        client = OpenAI(api_key=api_key)
        with open(tmp.name, 'rb') as f:
            uploaded = client.files.create(file=(nome, f), purpose='user_data')

        _deletar_temp(tmp.name)

        return jsonify({
            'file_id': uploaded.id,
            'nome': nome
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/atlas/dashboard_data', methods=['GET'])
@jwt_required()
def atlas_dashboard_data():
    try:
        # KPIs do último relatório por módulo
        subq = (
            db.session.query(
                RelatorioGerado.modulo,
                func.max(RelatorioGerado.gerado_em).label('ultimo')
            )
            .group_by(RelatorioGerado.modulo)
            .subquery()
        )

        ultimos = (
            db.session.query(RelatorioGerado)
            .join(subq, (RelatorioGerado.modulo == subq.c.modulo) &
                        (RelatorioGerado.gerado_em == subq.c.ultimo))
            .all()
        )

        kpis_por_modulo = {}
        for r in ultimos:
            kpis = {}
            if r.kpis_json:
                try:
                    kpis = json.loads(r.kpis_json)
                except Exception:
                    pass
            kpis_por_modulo[r.modulo] = {
                'mes_ref':    r.mes_ref,
                'gerado_em':  r.gerado_em.isoformat(),
                'kpis':       kpis
            }

        # Histórico recente (últimas 10 gerações)
        historico = (
            RelatorioGerado.query
            .order_by(RelatorioGerado.gerado_em.desc())
            .limit(10)
            .all()
        )

        historico_list = []
        for r in historico:
            kpis = {}
            if r.kpis_json:
                try:
                    kpis = json.loads(r.kpis_json)
                except Exception:
                    pass
            historico_list.append({
                'modulo':    r.modulo,
                'mes_ref':   r.mes_ref,
                'gerado_em': r.gerado_em.isoformat(),
                'kpis':      kpis
            })

        return jsonify({
            'kpis_por_modulo': kpis_por_modulo,
            'historico':       historico_list
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/atlas/metricas', methods=['GET'])
@jwt_required()
def atlas_metricas():
    """Métricas de uso do Atlas — apenas admins."""
    usuario = User.query.get(int(get_jwt_identity()))
    if not usuario or usuario.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    try:
        conversas_all = AtlasConversa.query.all()

        total_conversas = len(conversas_all)

        # Conta mensagens reais de cada conversa
        def contar_msgs(c):
            try:
                msgs = json.loads(c.msgs_json or '[]')
                return len([m for m in msgs if m.get('role') in ('user', 'assistant')])
            except Exception:
                return 0

        total_msgs = sum(contar_msgs(c) for c in conversas_all)

        # Conversas por usuário
        por_usuario_raw = (
            db.session.query(User.nome, func.count(AtlasConversa.id).label('conversas'))
            .join(AtlasConversa, AtlasConversa.usuario_id == User.id)
            .group_by(User.id, User.nome)
            .order_by(func.count(AtlasConversa.id).desc())
            .all()
        )
        por_usuario = []
        for p in por_usuario_raw:
            msgs_usuario = sum(
                contar_msgs(c) for c in conversas_all
                if c.usuario_id == next((u.id for u in User.query.filter_by(nome=p.nome).all()), None)
            )
            por_usuario.append({'nome': p.nome, 'conversas': p.conversas, 'msgs': msgs_usuario})

        # Conversa mais longa
        mais_longa_dict = None
        if conversas_all:
            mais_longa = max(conversas_all, key=contar_msgs)
            n_msgs = contar_msgs(mais_longa)
            if n_msgs > 0:
                u = User.query.get(mais_longa.usuario_id)
                try:
                    primeira = next((m.get('text','') for m in json.loads(mais_longa.msgs_json or '[]') if m.get('role') == 'user'), '')
                except Exception:
                    primeira = ''
                mais_longa_dict = {
                    'usuario': u.nome if u else 'Desconhecido',
                    'primeira_msg': primeira[:100],
                    'total_msgs': n_msgs
                }

        return jsonify({
            'total_conversas': total_conversas,
            'total_msgs': total_msgs,
            'por_usuario': por_usuario,
            'mais_longa': mais_longa_dict
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/atlas/briefing', methods=['GET'])
@jwt_required()
def atlas_briefing():
    """
    Monta o briefing diário do usuário:
    - Agenda do dia (Outlook, se conectado)
    - E-mails não lidos (Outlook, se conectado)
    - Notícias do setor logístico (web search via OpenAI)
    - Pendências de aprovação (apenas admin)
    """
    usuario_id = get_jwt_identity()
    usuario    = User.query.get(usuario_id)
    resultado  = {}

    # ── 1. Outlook (agenda + e-mails) ─────────────────────────────────────────
    access_token, _ = _get_access_token(usuario_id)
    outlook_conectado = access_token is not None
    resultado['outlook_conectado'] = outlook_conectado

    if outlook_conectado:
        tz_br    = ZoneInfo('America/Sao_Paulo')
        agora_br = datetime.now(tz_br)
        hoje     = agora_br.strftime('%Y-%m-%d')

        agenda_data, emails_data = None, None
        erros = []

        def buscar_agenda():
            nonlocal agenda_data
            try:
                agenda_data = _chamar_mcp('get_agenda', {
                    'access_token': access_token,
                    'data_inicio':  hoje,
                    'data_fim':     hoje
                })
            except Exception as e:
                erros.append(f'agenda: {e}')

        def buscar_emails():
            nonlocal emails_data
            try:
                emails_data = _chamar_mcp('buscar_emails', {
                    'access_token':     access_token,
                    'query':            '',
                    'apenas_nao_lidos': True,
                    'limite':           20
                })
            except Exception as e:
                erros.append(f'emails: {e}')

        t1 = threading.Thread(target=buscar_agenda)
        t2 = threading.Thread(target=buscar_emails)
        t1.start(); t2.start()
        t1.join(); t2.join()

        resultado['agenda'] = agenda_data or {'eventos': []}

        # Classifica e-mails por prioridade via GPT
        emails_brutos = (emails_data or {}).get('emails', [])
        if emails_brutos:
            try:
                api_key = os.environ.get('OPENAI_API_KEY', '')
                _client_email = OpenAI(api_key=api_key)

                lista_emails = '\n'.join([
                    f"{i+1}. De: {e.get('remetente') or e.get('from', {}).get('emailAddress', {}).get('name', 'Desconhecido')} | Assunto: {e.get('assunto') or e.get('subject', 'Sem assunto')}"
                    for i, e in enumerate(emails_brutos)
                ])

                classificacao = _client_email.responses.create(
                    model='gpt-4o-mini',
                    input=f"""Você é um assistente de um gestor logístico da Baia 4 Logística e Transportes.
Abaixo estão {len(emails_brutos)} e-mails não lidos recebidos recentemente.
Selecione os 5 mais importantes e urgentes para um gestor operacional.
Ignore e-mails de marketing, newsletters, notificações automáticas de sistemas e spam.
Priorize: solicitações de clientes, alertas operacionais, aprovações pendentes, comunicados internos relevantes.

E-mails:
{lista_emails}

Retorne APENAS uma lista com os e-mails selecionados no formato:
- [Remetente] — [Assunto] — [Resumo em 1 frase do motivo ser importante]

Sem introdução, sem explicação, apenas a lista."""
                )
                emails_resumo = ''
                for bloco in classificacao.output:
                    if hasattr(bloco, 'content'):
                        for c in bloco.content:
                            if hasattr(c, 'text'):
                                emails_resumo += c.text
                resultado['emails'] = {'resumo': emails_resumo.strip(), 'total': len(emails_brutos)}
            except Exception as e:
                # Fallback: lista simples sem classificação
                resultado['emails'] = {'emails': emails_brutos[:5], 'total': len(emails_brutos)}
        else:
            resultado['emails'] = {'emails': [], 'total': 0}

    # ── 2. Pendências (admin) ─────────────────────────────────────────────────
    if usuario and usuario.perfil == 'admin':
        pendentes = User.query.filter_by(status='pendente').count()
        resultado['pendentes'] = pendentes

    # ── 3. Notícias logísticas via OpenAI web search ──────────────────────────
    try:
        api_key = os.environ.get('OPENAI_API_KEY', '')
        _client = OpenAI(api_key=api_key)
        resp = _client.responses.create(
            model='gpt-4o-mini',
            tools=[{'type': 'web_search_preview'}],
            input='Busque as 3 principais notícias do setor logístico e de transportes no Brasil hoje. Retorne apenas os títulos, fontes e um resumo de 1 frase cada.',
        )
        noticias_texto = ''
        for bloco in resp.output:
            if hasattr(bloco, 'content'):
                for c in bloco.content:
                    if hasattr(c, 'text'):
                        noticias_texto += c.text
        resultado['noticias'] = noticias_texto.strip() or 'Nenhuma notícia encontrada.'
    except Exception as e:
        resultado['noticias'] = f'Erro ao buscar notícias: {e}'

    return jsonify(resultado)

@app.route('/api/atlas/log_conversas', methods=['GET'])
@jwt_required()
def atlas_log_conversas():
    """Log de conversas do Atlas — apenas admins."""
    usuario_id = get_jwt_identity()
    usuario = User.query.get(usuario_id)
    if not usuario or usuario.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    try:
        # Busca os últimos 50 logs de conversas
        logs = (
            db.session.query(
                AtlasLog.id,
                AtlasLog.usuario_id,
                AtlasLog.primeira_msg,
                AtlasLog.total_msgs,
                AtlasLog.criado_em,
                User.nome.label('usuario_nome')
            )
            .join(User, AtlasLog.usuario_id == User.id)
            .order_by(AtlasLog.criado_em.desc())
            .limit(50)
            .all()
        )

        return jsonify([{
            'id': l.id,
            'usuario': l.usuario_nome,
            'primeira_msg': l.primeira_msg,
            'total_msgs': l.total_msgs,
            'criado_em': l.criado_em.isoformat()
        } for l in logs]), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/atlas/conversas', methods=['GET'])
@jwt_required()
def atlas_listar_conversas():
    usuario_id = int(get_jwt_identity())
    conversas = (
        AtlasConversa.query
        .filter_by(usuario_id=usuario_id)
        .order_by(AtlasConversa.atualizada_em.desc())
        .limit(50)
        .all()
    )
    return jsonify([c.to_dict() for c in conversas]), 200


@app.route('/api/atlas/conversas', methods=['POST'])
@jwt_required()
def atlas_salvar_conversa():
    usuario_id = int(get_jwt_identity())
    data = request.get_json()
    conv_id = data.get('conv_id')
    if not conv_id:
        return jsonify({'erro': 'conv_id obrigatório'}), 400

    conversa = AtlasConversa.query.filter_by(usuario_id=usuario_id, conv_id=conv_id).first()
    if conversa:
        conversa.titulo        = data.get('titulo', conversa.titulo)
        conversa.msgs_json     = json.dumps(data.get('msgs', []), ensure_ascii=False)
        conversa.history_json  = json.dumps(data.get('history', []), ensure_ascii=False)
        conversa.pinada        = data.get('pinada', conversa.pinada)
        conversa.atualizada_em = datetime.utcnow()
    else:
        conversa = AtlasConversa(
            usuario_id   = usuario_id,
            conv_id      = conv_id,
            titulo       = data.get('titulo', 'Nova conversa'),
            msgs_json    = json.dumps(data.get('msgs', []), ensure_ascii=False),
            history_json = json.dumps(data.get('history', []), ensure_ascii=False),
            pinada       = data.get('pinada', False),
        )
        db.session.add(conversa)

    db.session.commit()
    return jsonify({'ok': True}), 200


@app.route('/api/atlas/conversas/<conv_id>', methods=['DELETE'])
@jwt_required()
def atlas_deletar_conversa(conv_id):
    usuario_id = int(get_jwt_identity())
    conversa = AtlasConversa.query.filter_by(usuario_id=usuario_id, conv_id=conv_id).first()
    if not conversa:
        return jsonify({'erro': 'Conversa não encontrada'}), 404
    db.session.delete(conversa)
    db.session.commit()
    return jsonify({'ok': True}), 200

@app.route('/api/atlas/memorias', methods=['GET'])
@jwt_required()
def get_memorias():
    usuario_id = get_jwt_identity()
    memorias = AtlasMemoria.query.filter_by(usuario_id=usuario_id)\
        .order_by(AtlasMemoria.atualizada_em.desc()).all()
    return jsonify([{
        'id':       m.id,
        'conteudo': m.conteudo,
        'criada_em': m.criada_em.isoformat()
    } for m in memorias])

@app.route('/api/atlas/memorias/<int:mem_id>', methods=['DELETE'])
@jwt_required()
def delete_memoria(mem_id):
    usuario_id = get_jwt_identity()
    m = AtlasMemoria.query.filter_by(id=mem_id, usuario_id=usuario_id).first()
    if not m:
        return jsonify({'erro': 'Memória não encontrada'}), 404
    db.session.delete(m)
    db.session.commit()
    return jsonify({'ok': True}), 200

# ── PROJETOS ─────────────────────────────────────────────────────────────────

@app.route('/api/atlas/projetos', methods=['GET'])
@jwt_required()
def listar_projetos():
    usuario_id = int(get_jwt_identity())
    projetos = AtlasProjeto.query.filter_by(usuario_id=usuario_id)\
        .order_by(AtlasProjeto.atualizado_em.desc()).all()
    resultado = []
    for p in projetos:
        d = p.to_dict()
        d['total_conversas'] = AtlasConversa.query.filter_by(
            usuario_id=usuario_id, projeto_id=p.id).count()
        resultado.append(d)
    return jsonify(resultado), 200

@app.route('/api/atlas/projetos', methods=['POST'])
@jwt_required()
def criar_projeto():
    usuario_id = int(get_jwt_identity())
    data = request.get_json()
    nome = (data.get('nome') or '').strip()
    if not nome:
        return jsonify({'erro': 'Nome do projeto é obrigatório'}), 400
    projeto = AtlasProjeto(
        usuario_id=usuario_id,
        nome=nome,
        descricao=(data.get('descricao') or '').strip()
    )
    db.session.add(projeto)
    db.session.commit()
    return jsonify(projeto.to_dict()), 201

@app.route('/api/atlas/projetos/<int:projeto_id>', methods=['PUT'])
@jwt_required()
def editar_projeto(projeto_id):
    usuario_id = int(get_jwt_identity())
    projeto = AtlasProjeto.query.filter_by(id=projeto_id, usuario_id=usuario_id).first()
    if not projeto:
        return jsonify({'erro': 'Projeto não encontrado'}), 404
    data = request.get_json()
    if 'nome' in data and data['nome'].strip():
        projeto.nome = data['nome'].strip()
    if 'descricao' in data:
        projeto.descricao = data['descricao'].strip()
    db.session.commit()
    return jsonify(projeto.to_dict()), 200

@app.route('/api/atlas/projetos/<int:projeto_id>', methods=['DELETE'])
@jwt_required()
def deletar_projeto(projeto_id):
    usuario_id = int(get_jwt_identity())
    projeto = AtlasProjeto.query.filter_by(id=projeto_id, usuario_id=usuario_id).first()
    if not projeto:
        return jsonify({'erro': 'Projeto não encontrado'}), 404
    # Desvincula conversas ao invés de deletar em cascata
    AtlasConversa.query.filter_by(projeto_id=projeto_id, usuario_id=usuario_id)\
        .update({'projeto_id': None})
    db.session.delete(projeto)
    db.session.commit()
    return jsonify({'ok': True}), 200

@app.route('/api/atlas/conversas/<conv_id>/projeto', methods=['PUT'])
@jwt_required()
def mover_conversa_projeto(conv_id):
    usuario_id = int(get_jwt_identity())
    conversa = AtlasConversa.query.filter_by(conv_id=conv_id, usuario_id=usuario_id).first()
    if not conversa:
        return jsonify({'erro': 'Conversa não encontrada'}), 404
    data = request.get_json()
    projeto_id = data.get('projeto_id')  # None = remover do projeto
    if projeto_id is not None:
        projeto = AtlasProjeto.query.filter_by(id=projeto_id, usuario_id=usuario_id).first()
        if not projeto:
            return jsonify({'erro': 'Projeto não encontrado'}), 404
    conversa.projeto_id = projeto_id
    db.session.commit()
    return jsonify(conversa.to_dict()), 200

# ── FIM PROJETOS ──────────────────────────────────────────────────────────────

@app.route('/api/atlas/conversas/buscar', methods=['GET'])
@jwt_required()
def atlas_buscar_conversas():
    """Busca conversas por texto — usada pelo Atlas para se atualizar."""
    usuario_id = int(get_jwt_identity())
    q = request.args.get('q', '').strip().lower()
    conversas = (
        AtlasConversa.query
        .filter_by(usuario_id=usuario_id)
        .order_by(AtlasConversa.atualizada_em.desc())
        .limit(50)
        .all()
    )
    if q:
        conversas = [c for c in conversas if q in c.titulo.lower() or q in c.msgs_json.lower()]
    # Retorna apenas título, data e primeiras msgs para não explodir o contexto
    resultado = []
    for c in conversas[:10]:
        msgs = json.loads(c.msgs_json)
        resumo = [m for m in msgs if m.get('role') in ('user', 'assistant')][:6]
        resultado.append({
            'conv_id':    c.conv_id,
            'titulo':     c.titulo,
            'criadaEm':   c.criada_em.isoformat(),
            'resumo':     resumo
        })
    return jsonify(resultado), 200


# ── Helper: obter ou criar Vector Store ───────────────────────────────────────
def _get_vector_store_id():
    """Retorna o vector_store_id do .env ou cria um novo e persiste."""
    vs_id = os.getenv('OPENAI_VECTOR_STORE_ID', '').strip()
    if vs_id:
        return vs_id
    # Cria um novo Vector Store na OpenAI
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    client = OpenAI(api_key=api_key)
    vs = client.vector_stores.create(name='Baia 4 — Base de Conhecimento')
    # Persiste no .env para próximas reinicializações
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    try:
        with open(env_path, 'a') as f:
            f.write(f'\nOPENAI_VECTOR_STORE_ID={vs.id}\n')
    except Exception:
        pass
    os.environ['OPENAI_VECTOR_STORE_ID'] = vs.id
    return vs.id


@app.route('/api/atlas/base_conhecimento', methods=['GET'])
@jwt_required()
def base_conhecimento_listar():
    """Lista todos os documentos indexados no Vector Store."""
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada'}), 500
    try:
        client = OpenAI(api_key=api_key)
        vs_id = _get_vector_store_id()
        # Paginar para buscar TODOS os arquivos (OpenAI retorna até 100 por página)
        todos_files = []
        after = None
        while True:
            kwargs = {'vector_store_id': vs_id, 'limit': 100}
            if after:
                kwargs['after'] = after
            page = client.vector_stores.files.list(**kwargs)
            todos_files.extend(page.data)
            if not page.has_more:
                break
            after = page.data[-1].id
        files_data = todos_files
        resultado = []
        for f in files_data:
            # Busca metadados do arquivo original
            try:
                file_info = client.files.retrieve(f.id)
                nome = file_info.filename
                tamanho = file_info.bytes
                criado_em = file_info.created_at
            except Exception:
                nome = f.id
                tamanho = 0
                criado_em = 0
            resultado.append({
                'file_id':   f.id,
                'nome':      nome,
                'tamanho':   tamanho,
                'status':    f.status,
                'criado_em': criado_em
            })
        return jsonify({
            'vector_store_id': vs_id,
            'documentos': resultado
        }), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500


@app.route('/api/atlas/base_conhecimento', methods=['POST'])
@jwt_required()
def base_conhecimento_upload():
    """Faz upload de um documento para o Vector Store."""
    _admin = User.query.get(int(get_jwt_identity()))
    if not _admin or _admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    nome = secure_filename(arquivo.filename or 'documento')
    ext = os.path.splitext(nome)[1].lower()

    extensoes_suportadas = {'.pdf', '.docx', '.doc', '.txt', '.md', '.pptx', '.ppt', '.xlsx', '.csv'}
    if ext not in extensoes_suportadas:
        return jsonify({'erro': f'Tipo não suportado: {ext}. Use PDF, Word, TXT, PowerPoint ou Excel.'}), 400

    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada'}), 500

    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        arquivo.save(tmp.name)
        tmp.close()

        client = OpenAI(api_key=api_key)
        vs_id = _get_vector_store_id()

        # Upload do arquivo para a OpenAI Files API
        with open(tmp.name, 'rb') as f:
            uploaded = client.files.create(file=(nome, f), purpose='assistants')

        _deletar_temp(tmp.name)

        # Adiciona ao Vector Store — a OpenAI indexa automaticamente
        client.vector_stores.files.create(
            vector_store_id=vs_id,
            file_id=uploaded.id
        )

        return jsonify({
            'file_id': uploaded.id,
            'nome':    nome,
            'status':  'indexando'
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500


@app.route('/api/atlas/base_conhecimento/<file_id>', methods=['DELETE'])
@jwt_required()
def base_conhecimento_deletar(file_id):
    """Remove um documento do Vector Store e da Files API."""
    _admin = User.query.get(int(get_jwt_identity()))
    if not _admin or _admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada'}), 500
    try:
        client = OpenAI(api_key=api_key)
        vs_id = _get_vector_store_id()
        # Remove do Vector Store
        client.vector_stores.files.delete(vector_store_id=vs_id, file_id=file_id)
        # Remove da Files API
        try:
            client.files.delete(file_id)
        except Exception:
            pass
        return jsonify({'ok': True}), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'erro': str(e)}), 500


# ── Model OutlookToken ────────────────────────────────────────────────────────
class OutlookToken(db.Model):
    """Armazena tokens OAuth do Microsoft Graph por usuário."""
    __tablename__ = 'outlook_tokens'
    id            = db.Column(db.Integer, primary_key=True)
    usuario_id    = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), unique=True, nullable=False)
    access_token  = db.Column(db.Text, nullable=False)
    refresh_token = db.Column(db.Text, nullable=True)
    expires_at    = db.Column(db.DateTime, nullable=False)
    email_outlook = db.Column(db.String(120), nullable=True)  # e-mail Microsoft do usuário
    atualizado_em = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def esta_expirado(self):
        """Retorna True se o token expira em menos de 5 minutos."""
        return datetime.utcnow() >= (self.expires_at - timedelta(minutes=5))

    def to_dict(self):
        return {
            'conectado':     True,
            'email_outlook': self.email_outlook,
            'expira_em':     self.expires_at.isoformat()
        }


# ── Helpers Outlook ───────────────────────────────────────────────────────────

def _msal_app():
    """Cria instância do MSAL ConfidentialClientApplication."""
    return msal.ConfidentialClientApplication(
        client_id=os.getenv('AZURE_CLIENT_ID'),
        client_credential=os.getenv('AZURE_CLIENT_SECRET'),
        authority=f"https://login.microsoftonline.com/{os.getenv('AZURE_TENANT_ID')}"
    )

OUTLOOK_SCOPES = [
    "Calendars.ReadWrite",
    "Mail.Read",
    "Mail.Send",
    "User.Read",
    "Chat.ReadWrite",
    "ChannelMessage.Send",
    "OnlineMeetings.ReadWrite",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
]

def _renovar_token_se_necessario(token_obj: OutlookToken) -> bool:
    """
    Renova o access_token usando o refresh_token se estiver próximo do vencimento.
    Retorna True se renovado com sucesso, False se falhou.
    """
    if not token_obj.esta_expirado():
        return True
    if not token_obj.refresh_token:
        return False
    try:
        msal_app = _msal_app()
        resultado = msal_app.acquire_token_by_refresh_token(
            token_obj.refresh_token,
            scopes=OUTLOOK_SCOPES
        )
        if "access_token" not in resultado:
            return False
        token_obj.access_token  = resultado["access_token"]
        token_obj.refresh_token = resultado.get("refresh_token", token_obj.refresh_token)
        token_obj.expires_at    = datetime.utcnow() + timedelta(seconds=resultado.get("expires_in", 3600))
        db.session.commit()
        return True
    except Exception:
        return False

def _get_access_token(usuario_id: int):
    """
    Retorna o access_token válido do usuário ou None se não conectado.
    Renova automaticamente se necessário.
    """
    token_obj = OutlookToken.query.filter_by(usuario_id=usuario_id).first()
    if not token_obj:
        return None, "Outlook não conectado. Use /api/oauth/outlook/login para conectar."
    if not _renovar_token_se_necessario(token_obj):
        return None, "Token do Outlook expirado. Reconecte em /api/oauth/outlook/login."
    return token_obj.access_token, None

def _chamar_mcp(tool: str, body: dict):
    """Chama uma tool do MCP Outlook Server (porta 5002)."""
    mcp_url = os.getenv('MCP_OUTLOOK_URL', 'http://localhost:5002')
    resp = http_requests.post(f"{mcp_url}/tools/{tool}", json=body, timeout=15)
    if not resp.ok:
        try:
            detalhe = resp.json()
        except Exception:
            detalhe = resp.text
        raise Exception(f"MCP erro {resp.status_code} em '{tool}': {detalhe}")
    return resp.json()


# ── Rotas OAuth Outlook ───────────────────────────────────────────────────────

@app.route('/api/oauth/outlook/login', methods=['GET'])
@jwt_required()
def outlook_login():
    """Inicia o fluxo Authorization Code — redireciona para a página de login da Microsoft."""
    usuario_id = get_jwt_identity()
    msal_app   = _msal_app()
    auth_url   = msal_app.get_authorization_request_url(
        scopes=OUTLOOK_SCOPES,
        state=str(usuario_id),  # passamos o id do usuário no state para recuperar no callback
        redirect_uri=os.getenv('AZURE_REDIRECT_URI')
    )
    return jsonify({'auth_url': auth_url})


@app.route('/api/oauth/outlook/callback', methods=['GET'])
def outlook_callback():
    """
    Callback do Azure AD após o usuário autorizar.
    Troca o código de autorização pelo access_token + refresh_token.
    """
    code       = request.args.get('code')
    state      = request.args.get('state')   # usuario_id que passamos no login
    error      = request.args.get('error')
    error_desc = request.args.get('error_description', '')

    if error:
        return f"<h3>Erro na autenticação: {error}</h3><p>{error_desc}</p>", 400

    if not code or not state:
        return "<h3>Parâmetros inválidos no callback.</h3>", 400

    try:
        usuario_id = int(state)
    except ValueError:
        return "<h3>State inválido.</h3>", 400

    msal_app  = _msal_app()
    resultado = msal_app.acquire_token_by_authorization_code(
        code,
        scopes=OUTLOOK_SCOPES,
        redirect_uri=os.getenv('AZURE_REDIRECT_URI')
    )

    if "access_token" not in resultado:
        erro_msg = resultado.get("error_description", "Erro desconhecido")
        return f"<h3>Falha ao obter token: {erro_msg}</h3>", 400

    # Busca o e-mail da conta Microsoft conectada
    email_outlook = None
    try:
        me = http_requests.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {resultado['access_token']}"}
        ).json()
        email_outlook = me.get("mail") or me.get("userPrincipalName")
    except Exception:
        pass

    # Salva ou atualiza o token no banco
    token_obj = OutlookToken.query.filter_by(usuario_id=usuario_id).first()
    if not token_obj:
        token_obj = OutlookToken(usuario_id=usuario_id)
        db.session.add(token_obj)

    token_obj.access_token  = resultado["access_token"]
    token_obj.refresh_token = resultado.get("refresh_token")
    token_obj.expires_at    = datetime.utcnow() + timedelta(seconds=resultado.get("expires_in", 3600))
    token_obj.email_outlook = email_outlook
    db.session.commit()

    # Fecha a janela popup e notifica o frontend
    return """
    <html><body>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OUTLOOK_CONNECTED', email: '""" + (email_outlook or '') + """' }, '""" + os.getenv('FRONTEND_URL', 'http://localhost:5173') + """');
        window.close();
      }
    </script>
    <p>Outlook conectado com sucesso! Pode fechar esta janela.</p>
    </body></html>
    """


@app.route('/api/oauth/outlook/status', methods=['GET'])
@jwt_required()
def outlook_status():
    """Retorna se o usuário atual tem o Outlook conectado."""
    usuario_id = get_jwt_identity()
    token_obj  = OutlookToken.query.filter_by(usuario_id=usuario_id).first()
    if not token_obj:
        return jsonify({'conectado': False})
    return jsonify(token_obj.to_dict())


@app.route('/api/oauth/outlook/desconectar', methods=['DELETE'])
@jwt_required()
def outlook_desconectar():
    """Remove o token do Outlook do usuário."""
    usuario_id = get_jwt_identity()
    token_obj  = OutlookToken.query.filter_by(usuario_id=usuario_id).first()
    if token_obj:
        db.session.delete(token_obj)
        db.session.commit()
    return jsonify({'ok': True})


# ── Rotas de Tools Outlook (Flask → MCP Server) ───────────────────────────────

@app.route('/api/outlook/agenda', methods=['GET'])
@jwt_required()
def outlook_get_agenda():
    """Retorna eventos do calendário do usuário via MCP Server."""
    usuario_id  = get_jwt_identity()
    data_inicio = request.args.get('data_inicio')
    data_fim    = request.args.get('data_fim')

    if not data_inicio or not data_fim:
        return jsonify({'erro': 'Parâmetros obrigatórios: data_inicio, data_fim'}), 400

    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401

    try:
        resultado = _chamar_mcp('get_agenda', {
            'access_token': access_token,
            'data_inicio':  data_inicio,
            'data_fim':     data_fim
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/outlook/agenda/admin', methods=['GET'])
@jwt_required()
def outlook_agenda_admin():
    """
    Consolida a agenda de todos os usuários (apenas admin).
    Retorna eventos agrupados por usuário.
    """
    usuario_id = get_jwt_identity()
    usuario    = User.query.get(usuario_id)
    if not usuario or usuario.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    data_inicio = request.args.get('data_inicio')
    data_fim    = request.args.get('data_fim')
    if not data_inicio or not data_fim:
        return jsonify({'erro': 'Parâmetros obrigatórios: data_inicio, data_fim'}), 400

    todos_tokens = OutlookToken.query.all()
    resultado    = []

    for token_obj in todos_tokens:
        if not _renovar_token_se_necessario(token_obj):
            continue
        usuario_alvo = User.query.get(token_obj.usuario_id)
        if not usuario_alvo or not usuario_alvo.ativo:
            continue
        try:
            agenda = _chamar_mcp('get_agenda', {
                'access_token': token_obj.access_token,
                'data_inicio':  data_inicio,
                'data_fim':     data_fim
            })
            resultado.append({
                'usuario_id':   token_obj.usuario_id,
                'nome':         usuario_alvo.nome,
                'email':        usuario_alvo.email,
                'email_outlook': token_obj.email_outlook,
                'eventos':      agenda.get('eventos', [])
            })
        except Exception:
            continue

    return jsonify({'agendas': resultado, 'total_usuarios': len(resultado)})


@app.route('/api/outlook/evento', methods=['POST'])
@jwt_required()
def outlook_criar_evento():
    """Cria um evento no calendário do usuário via MCP Server."""
    usuario_id = get_jwt_identity()
    data       = request.get_json()

    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401

    try:
        resultado = _chamar_mcp('criar_evento', {
            'access_token': access_token,
            **data
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/outlook/evento/<evento_id>', methods=['DELETE'])
@jwt_required()
def outlook_deletar_evento(evento_id):
    """Deleta um evento do calendário do usuário via MCP Server."""
    usuario_id = get_jwt_identity()

    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401

    try:
        resultado = _chamar_mcp('deletar_evento', {
            'access_token': access_token,
            'evento_id':    evento_id
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/outlook/evento/<evento_id>', methods=['PATCH'])
@jwt_required()
def outlook_editar_evento(evento_id):
    """Edita um evento do calendário do usuário via MCP Server."""
    usuario_id = get_jwt_identity()
    data       = request.get_json()

    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401

    try:
        resultado = _chamar_mcp('editar_evento', {
            'access_token': access_token,
            'evento_id':    evento_id,
            **data
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/outlook/emails', methods=['GET'])
@jwt_required()
def outlook_buscar_emails():
    """Busca e-mails do usuário via MCP Server."""
    usuario_id       = get_jwt_identity()
    query            = request.args.get('q', '')
    apenas_nao_lidos = request.args.get('nao_lidos', 'false').lower() == 'true'
    limite           = min(int(request.args.get('limite', 20)), 50)

    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401

    try:
        resultado = _chamar_mcp('buscar_emails', {
            'access_token':    access_token,
            'query':           query,
            'apenas_nao_lidos': apenas_nao_lidos,
            'limite':          limite
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/outlook/eventos_proximos', methods=['GET'])
@jwt_required()
def outlook_eventos_proximos():
    """Retorna eventos das próximas horas — usado pelo notificador do frontend."""
    usuario_id  = get_jwt_identity()
    horas_ahead = int(request.args.get('horas', 24))

    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        # Usuário não conectou o Outlook — retorna lista vazia sem erro
        return jsonify({'eventos': [], 'conectado': False})

    try:
        resultado = _chamar_mcp('eventos_proximos', {
            'access_token': access_token,
            'horas_ahead':  horas_ahead
        })
        resultado['conectado'] = True
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500



@app.route('/api/outlook/enviar_email', methods=['POST'])
@jwt_required()
def outlook_enviar_email():
    """
    Envia um e-mail pelo Outlook do usuário autenticado.

    Body JSON esperado:
      destinatario      : str   — endereço de e-mail do destinatário
      assunto           : str
      corpo             : str   — texto do e-mail
      nome_destinatario : str   (opcional)
    """
    usuario_id = get_jwt_identity()
    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401

    data = request.get_json()
    destinatario      = data.get('destinatario', '').strip()
    assunto           = data.get('assunto', '').strip()
    corpo             = data.get('corpo', '').strip()
    nome_destinatario = data.get('nome_destinatario', '').strip()

    if not all([destinatario, assunto, corpo]):
        return jsonify({'erro': 'Campos obrigatórios: destinatario, assunto, corpo'}), 400

    try:
        resultado = _chamar_mcp('enviar_email', {
            'access_token':      access_token,
            'destinatario':      destinatario,
            'nome_destinatario': nome_destinatario,
            'assunto':           assunto,
            'corpo':             corpo
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500

# ── Rotas Teams ───────────────────────────────────────────────────────────────

@app.route('/api/teams/times', methods=['GET'])
@jwt_required()
def teams_listar_times():
    usuario_id = int(get_jwt_identity())
    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401
    try:
        resultado = _chamar_mcp('teams_listar_times', {'access_token': access_token})
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/teams/canais', methods=['GET'])
@jwt_required()
def teams_listar_canais():
    usuario_id = int(get_jwt_identity())
    team_id    = request.args.get('team_id', '')
    if not team_id:
        return jsonify({'erro': 'team_id obrigatório'}), 400
    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401
    try:
        resultado = _chamar_mcp('teams_listar_canais', {
            'access_token': access_token,
            'team_id':      team_id
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/teams/mensagem', methods=['POST'])
@jwt_required()
def teams_enviar_mensagem():
    usuario_id = int(get_jwt_identity())
    data       = request.get_json()
    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401
    try:
        resultado = _chamar_mcp('teams_enviar_mensagem', {
            'access_token': access_token,
            'team_id':      data.get('team_id', ''),
            'channel_id':   data.get('channel_id', ''),
            'mensagem':     data.get('mensagem', '')
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/teams/reuniao', methods=['POST'])
@jwt_required()
def teams_criar_reuniao():
    usuario_id = int(get_jwt_identity())
    data       = request.get_json()
    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401
    try:
        resultado = _chamar_mcp('teams_criar_reuniao', {
            'access_token':   access_token,
            'titulo':         data.get('titulo', 'Reunião'),
            'inicio':         data.get('inicio', ''),
            'fim':            data.get('fim', ''),
            'participantes':  data.get('participantes', [])
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@app.route('/api/teams/chat', methods=['POST'])
@jwt_required()
def teams_chat_enviar():
    usuario_id = int(get_jwt_identity())
    data       = request.get_json()
    access_token, erro_msg = _get_access_token(usuario_id)
    if not access_token:
        return jsonify({'erro': erro_msg, 'nao_conectado': True}), 401
    try:
        resultado = _chamar_mcp('teams_chat_enviar', {
            'access_token':  access_token,
            'email_destino': data.get('email_destino', ''),
            'mensagem':      data.get('mensagem', '')
        })
        return jsonify(resultado)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)