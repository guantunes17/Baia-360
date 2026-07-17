# -*- coding: utf-8 -*-
"""
Central de Relatórios — processo separado do Atlas (Fase 5 do desacoplamento,
ver plan_atlas_central_decoupling_2026-07-13.md e docs/architecture/COUPLING_MAP.md).

Hospeda os ~18 endpoints que eram de Central dentro do app.py monolítico:
geração/consulta dos 8 módulos de relatório (/api/modulos/*), o dashboard
público da Central (/api/dashboard*) e o endpoint interno somente-leitura
que o Atlas consome via central_client.py (/internal/relatorios/dashboard).

Processo próprio, mesmo Postgres — só os schemas `central` (dono) e
`identity` (leitura, para checagem de permissão) são usados aqui. `User` e
`Permissao` abaixo são cópias deliberadas dos modelos equivalentes em
app.py (decisão registrada no plano da Fase 5): dois processos Python
distintos não podem compartilhar as mesmas classes ORM, e um módulo
compartilhado teria exigido reestruturar como app.py cria seu `db`,
um risco maior do que a duplicação de duas tabelas que raramente mudam.

JWT: valida com identity.configurar_jwt(app), que agora aceita rodar só
com JWT_PUBLIC_KEY (sem a privada) — este processo nunca minta token.
"""
import json
import os
import tempfile
import threading
import time
import traceback
import uuid
import importlib
import importlib.util
import pandas as pd

from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import jwt_required, get_jwt_identity
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from pathlib import Path
from werkzeug.utils import secure_filename

import identity


_env_path = Path(__file__).resolve().parent / '.env'
# Mesmo raciocínio do Atlas (ver app.py) — override só opt-in via
# DOTENV_OVERRIDE, nunca hardcoded True em produção.
load_dotenv(dotenv_path=_env_path, override=os.getenv('DOTENV_OVERRIDE', '0') == '1')

app = Flask(__name__)
_is_prod = os.getenv('FLASK_ENV', 'development') == 'production'

app.config['SQLALCHEMY_DATABASE_URI']        = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH']             = 50 * 1024 * 1024  # 50 MB

# CORS — mesmo padrão do Atlas: em produção só FRONTEND_URL, em dev também localhost.
# Central recebe tráfego direto do navegador (via nginx) para /api/modulos e
# /api/dashboard — não é só o Atlas que fala com este processo.
_prod_url = os.getenv("FRONTEND_URL", "").strip()
if _is_prod and _prod_url:
    _frontend_origins = [_prod_url]
elif _prod_url:
    _frontend_origins = ["http://localhost", "http://localhost:5173", "http://localhost:3000", _prod_url]
else:
    _frontend_origins = ["http://localhost", "http://localhost:5173", "http://localhost:3000"]
CORS(app, origins=_frontend_origins, supports_credentials=True)
db      = SQLAlchemy(app)
jwt     = identity.configurar_jwt(app)  # RS256, só chave pública — este processo nunca minta token
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


@app.errorhandler(413)
def arquivo_muito_grande(e):
    return jsonify({'erro': 'Arquivo excede o tamanho máximo permitido (50MB)'}), 413


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200


class ModuloInvalidoError(ValueError):
    """Levantado quando um slug de módulo desconhecido é pedido."""


class PermissaoNegadaError(Exception):
    """Levantado quando o usuário não tem permissão para o módulo pedido."""


# Slug de permissão (Permissao.modulos_json) -> label gravado em
# RelatorioGerado.modulo pelas rotas abaixo — os dois vocabulários
# divergem no banco (permissão usa slugs minúsculos, relatório usa o nome
# de exibição). Mesma tabela usada em app.py (Atlas/identity) — duplicada
# aqui pela mesma razão que User/Permissao (ver docstring do módulo).
MODULO_SLUG_PARA_LABEL = {
    'pedidos':         'Pedidos',
    'fretes':          'Fretes',
    'armazenagem':     'Armazenagem',
    'estoque':         'Estoque',
    'cap_operacional': 'Cap. Operacional',
    'recebimentos':    'Recebimentos',
    'fat_dist':        'Fat. Distribuição',
    'fat_arm':         'Fat. Armazenagem',
}
MODULOS_VALIDOS = list(MODULO_SLUG_PARA_LABEL.keys())


# ── Modelos (identity — cópia read-only, ver docstring do módulo) ─────────────
class User(db.Model):
    __tablename__ = 'baia360_users'
    __table_args__ = {'schema': 'identity'}
    id         = db.Column(db.Integer, primary_key=True)
    nome       = db.Column(db.String(100), nullable=False)
    email      = db.Column(db.String(120), unique=True, nullable=False)
    senha_hash = db.Column(db.String(256), nullable=False)
    perfil     = db.Column(db.String(20), default='operacional')
    ativo      = db.Column(db.Boolean, default=False)
    status     = db.Column(db.String(20), default='pendente', server_default='pendente')
    criado_em  = db.Column(db.DateTime, default=datetime.utcnow)


class Permissao(db.Model):
    __tablename__ = 'permissoes'
    __table_args__ = {'schema': 'identity'}
    id           = db.Column(db.Integer, primary_key=True)
    usuario_id   = db.Column(db.Integer, db.ForeignKey('identity.baia360_users.id'), unique=True, nullable=False)
    hub_json     = db.Column(db.Text, nullable=False, default='[]')
    modulos_json = db.Column(db.Text, nullable=False, default='[]')

    usuario = db.relationship('User', backref=db.backref('permissao', uselist=False))


# ── Modelo (central — dono) ───────────────────────────────────────────────────
class RelatorioGerado(db.Model):
    __tablename__ = 'relatorios_gerados'
    __table_args__ = {'schema': 'central'}

    id         = db.Column(db.Integer, primary_key=True)
    modulo     = db.Column(db.String(50), nullable=False)
    mes_ref    = db.Column(db.String(10), nullable=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('identity.baia360_users.id'), nullable=True)
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


# ── Helpers de permissão + endpoint interno (consumido por central_client.py, lado Atlas) ─

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


def _modulos_permitidos(usuario_id: int) -> list:
    """Módulos de relatório que o usuário pode ver — todos para admin,
    interseção de MODULOS_VALIDOS com Permissao.modulos_json para os demais."""
    usuario = User.query.get(usuario_id)
    if usuario and usuario.perfil == 'admin':
        return list(MODULOS_VALIDOS)
    perm = Permissao.query.filter_by(usuario_id=usuario_id).first()
    modulos_usuario = json.loads(perm.modulos_json) if perm else []
    return [m for m in MODULOS_VALIDOS if m in modulos_usuario]


def _serializar_relatorio(r: 'RelatorioGerado', incluir_modulo: bool = True) -> dict:
    """DTO explícito para um RelatorioGerado — nunca serializa o ORM cru."""
    kpis = {}
    if r.kpis_json:
        try:
            kpis = json.loads(r.kpis_json)
        except Exception:
            kpis = {}
    dto = {'mes_ref': r.mes_ref, 'gerado_em': r.gerado_em.isoformat(), 'kpis': kpis}
    if incluir_modulo:
        dto = {'modulo': r.modulo, **dto}
    return dto


def _dashboard_service(usuario_id: int, modulo: str | None = None) -> dict:
    """Lógica de dados por trás de /internal/relatorios/dashboard — única
    função que lê RelatorioGerado; a rota abaixo é o único chamador."""
    if modulo is not None:
        modulo = modulo.strip().lower()  # o modelo às vezes envia o nome de exibição
                                          # (ex.: "Fretes") em vez do slug — normaliza
                                          # antes de validar, em vez de falhar.
        if modulo not in MODULOS_VALIDOS:
            raise ModuloInvalidoError(f"Módulo inválido: {modulo!r}")
        if not _verificar_permissao_modulo(usuario_id, modulo):
            raise PermissaoNegadaError(f"Sem permissão para o módulo {modulo!r}")
        modulos_permitidos = [modulo]
    else:
        modulos_permitidos = _modulos_permitidos(usuario_id)

    if not modulos_permitidos:
        return {'kpis_por_modulo': {}, 'historico': []}

    # RelatorioGerado.modulo grava o label de exibição (ex.: 'Fat. Armazenagem'),
    # não o slug de permissão — traduz antes de filtrar.
    labels_permitidos = [MODULO_SLUG_PARA_LABEL[m] for m in modulos_permitidos]

    subq = (
        db.session.query(
            RelatorioGerado.modulo,
            func.max(RelatorioGerado.gerado_em).label('ultimo')
        )
        .filter(RelatorioGerado.modulo.in_(labels_permitidos))
        .group_by(RelatorioGerado.modulo)
        .subquery()
    )
    ultimos = (
        db.session.query(RelatorioGerado)
        .join(subq, (RelatorioGerado.modulo == subq.c.modulo) &
                    (RelatorioGerado.gerado_em == subq.c.ultimo))
        .all()
    )
    kpis_por_modulo = {r.modulo: _serializar_relatorio(r, incluir_modulo=False) for r in ultimos}

    historico = (
        RelatorioGerado.query
        .filter(RelatorioGerado.modulo.in_(labels_permitidos))
        .order_by(RelatorioGerado.gerado_em.desc())
        .limit(10)
        .all()
    )
    historico_list = [_serializar_relatorio(r) for r in historico]

    return {'kpis_por_modulo': kpis_por_modulo, 'historico': historico_list}


@app.route('/internal/relatorios/dashboard', methods=['GET'])
@jwt_required()
def internal_relatorios_dashboard():
    """Endpoint interno de leitura da Central — único endpoint que expõe
    KPIs de relatórios para o Atlas (via central_client.py, do lado de lá).
    Fixo, com whitelist de parâmetros; sem passthrough de SQL/filtros livres.

    Fase 5: processo separado de verdade — exige tanto o JWT do usuário
    (@jwt_required(), validado com a chave pública, revalidado a cada
    chamada) quanto a credencial de serviço do Atlas (identity.
    verificar_credencial_servico). Um Atlas comprometido ainda fica
    limitado às permissões do usuário atual; um chamador sem a credencial
    de serviço nem chega a essa checagem de JWT ter valido alguma coisa."""
    if not identity.verificar_credencial_servico(request):
        return jsonify({'erro': 'Credencial de serviço ausente ou inválida.'}), 403

    usuario_id = int(get_jwt_identity())

    params_permitidos = {'modulo'}
    extras = set(request.args.keys()) - params_permitidos
    if extras:
        return jsonify({'erro': f'Parâmetros não suportados: {sorted(extras)}'}), 400

    modulo = request.args.get('modulo') or None

    try:
        return jsonify(_dashboard_service(usuario_id, modulo)), 200
    except ModuloInvalidoError as e:
        return jsonify({'erro': str(e)}), 400
    except PermissaoNegadaError as e:
        return jsonify({'erro': str(e)}), 403
    except Exception:
        traceback.print_exc()
        return jsonify({'erro': 'Erro interno ao consultar dashboard.'}), 500


# Dicionário para armazenar progresso dos jobs
jobs = {}

# ── Extratores de KPIs + rotas de geração de relatório ────────────────────────

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

# ESTOQUE_DB_PATH permite apontar para um arquivo fora do checkout (ex. um
# diretório temporário) sem mexer no default de produção. Existe porque, em
# docker-compose.yml, o volume nomeado `backend_data:/app/data` do serviço
# `central` já sombra `./backend/data` do host — então dentro do container
# este caminho nunca toca o `backend/data/estoque_db.json` versionado no
# git. Mas rodar central_app.py DIRETO no host (fora do compose — o método
# mais rápido de subir um backend ao vivo para run_api_tests.py, sem essa
# indireção de volume) escreve nele de verdade: já aconteceu duas vezes
# (sessão da Fase 2 e desta sessão) o teste de Estoque sobrescrever os
# 2MB do arquivo versionado, só notado porque alguém conferiu `git status`
# antes de commitar. Rodando fora do compose, exporte
# ESTOQUE_DB_PATH=/tmp/estoque_db_test.json (ou qualquer caminho fora do
# checkout) antes de iniciar o processo.
DB_ESTOQUE_PATH_WEB = os.getenv(
    'ESTOQUE_DB_PATH',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'estoque_db.json')
)
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
