import importlib
import importlib.util
import tempfile
import threading
import uuid
import pandas as pd
import msal
import requests as http_requests
import os
import json

def _deletar_temp(path: str):
    """Remove arquivo temporário com tolerância ao PermissionError do Windows."""
    import time
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

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, decode_token
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
from datetime import datetime, timedelta
import os

from pathlib import Path
_env_path = Path(__file__).resolve().parent / '.env'
load_dotenv(dotenv_path=_env_path, override=True)

app = Flask(__name__)
app.config['SECRET_KEY']                     = os.getenv('SECRET_KEY')
app.config['JWT_SECRET_KEY']                 = os.getenv('JWT_SECRET_KEY')
app.config['SQLALCHEMY_DATABASE_URI']        = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# CORS — em produção lê FRONTEND_URL do ambiente; em dev aceita localhost
_frontend_origins = ["http://localhost:5173", "http://localhost:3000"]
_prod_url = os.getenv("FRONTEND_URL", "").strip()
if _prod_url:
    _frontend_origins.append(_prod_url)
CORS(app, origins=_frontend_origins)
db  = SQLAlchemy(app)
jwt = JWTManager(app)


# ── Model ─────────────────────────────────────────────────────────────────────
class AtlasLog(db.Model):
    __tablename__ = 'atlas_logs'
    id          = db.Column(db.Integer, primary_key=True)
    usuario_id  = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=False)
    primeira_msg = db.Column(db.String(200), nullable=True)
    total_msgs  = db.Column(db.Integer, default=0)
    criado_em   = db.Column(db.DateTime, default=datetime.utcnow)

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

    def to_dict(self):
        return {
            'id':           self.id,
            'conv_id':      self.conv_id,
            'titulo':       self.titulo,
            'pinada':       self.pinada,
            'msgs':         json.loads(self.msgs_json),
            'history':      json.loads(self.history_json),
            'criadaEm':     self.criada_em.isoformat(),
            'atualizadaEm': self.atualizada_em.isoformat() if self.atualizada_em else self.criada_em.isoformat()
        }

class AtlasMemoria(db.Model):
    __tablename__ = 'atlas_memoria'
    id            = db.Column(db.Integer, primary_key=True)
    usuario_id    = db.Column(db.Integer, db.ForeignKey('baia360_users.id'), nullable=False)
    conteudo      = db.Column(db.Text, nullable=False)
    criada_em     = db.Column(db.DateTime, default=datetime.utcnow)
    atualizada_em = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    usuario = db.relationship('User', backref='memorias_atlas')

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
        import json
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

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

# ── Rotas Auth ────────────────────────────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
def login():
    from flask import request, jsonify
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
    return jsonify({'token': token, 'usuario': user.to_dict()}), 200



@app.route('/api/auth/cadastro', methods=['POST'])
def cadastro():
    """
    Rota pública — qualquer pessoa pode criar uma conta.
    Perfil sempre 'usuario', ativo=True imediatamente.
    """
    from flask import request, jsonify
    data  = request.get_json()
    nome  = data.get('nome', '').strip()
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '')
    senha_confirmacao = data.get('senha_confirmacao', '')

    # Validações
    import re as _re
    if not all([nome, email, senha, senha_confirmacao]):
        return jsonify({'erro': 'Todos os campos são obrigatórios'}), 400
    if len(nome) < 2:
        return jsonify({'erro': 'Nome deve ter pelo menos 2 caracteres'}), 400
    if len(senha) < 8:
        return jsonify({'erro': 'A senha deve ter pelo menos 8 caracteres'}), 400
    if not _re.search(r'[A-Z]', senha):
        return jsonify({'erro': 'A senha deve conter pelo menos 1 letra maiúscula'}), 400
    if not _re.search(r'[^a-zA-Z0-9]', senha):
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

@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def me():
    from flask import jsonify
    user = User.query.get(int(get_jwt_identity()))
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404
    return jsonify(user.to_dict()), 200


@app.route('/api/auth/usuarios', methods=['GET'])
@jwt_required()
def listar_usuarios():
    from flask import jsonify
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    return jsonify([u.to_dict() for u in User.query.all()]), 200


@app.route('/api/auth/usuarios', methods=['POST'])
@jwt_required()
def criar_usuario():
    from flask import request, jsonify
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    data  = request.get_json()
    email = data.get('email', '').strip().lower()
    if User.query.filter_by(email=email).first():
        return jsonify({'erro': 'Email já cadastrado'}), 409

    senha_nova = data.get('senha', '')
    import re as _re2
    if len(senha_nova) < 8:
        return jsonify({'erro': 'A senha deve ter pelo menos 8 caracteres'}), 400
    if not _re2.search(r'[A-Z]', senha_nova):
        return jsonify({'erro': 'A senha deve conter pelo menos 1 letra maiúscula'}), 400
    if not _re2.search(r'[^a-zA-Z0-9]', senha_nova):
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
    admin_senha = os.getenv('ADMIN_SENHA', 'admin123')

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
    from flask import jsonify
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
    from flask import request, jsonify
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
    from flask import request, jsonify
    admin = User.query.get(int(get_jwt_identity()))
    if admin.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({'erro': 'Usuário não encontrado'}), 404

    data = request.get_json()
    nova_senha = data.get('nova_senha', '')
    if len(nova_senha) < 6:
        return jsonify({'erro': 'Senha deve ter pelo menos 6 caracteres'}), 400

    user.set_senha(nova_senha)
    db.session.commit()
    return jsonify({'msg': 'Senha redefinida com sucesso'}), 200


@app.route('/api/auth/usuarios/<int:user_id>', methods=['DELETE'])
@jwt_required()
def deletar_usuario(user_id):
    from flask import jsonify
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

import tempfile, threading, uuid
from flask import send_file

# Dicionário para armazenar progresso dos jobs
jobs = {}

# ── Extratores de KPIs ────────────────────────────────────────────────────────
import json

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
        # Linha do total está na coluna 3 (Valor do Frete), filtra linhas numéricas
        valores = pd.to_numeric(df[3], errors='coerce').dropna()
        total   = round(float(valores.sum()), 2)
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
@jwt_required()
def processar_fretes_route():
    from flask import request, jsonify

    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo  = request.files['arquivo']
    nome_aba = request.form.get('nome_aba', '').strip()
    mes_ref  = request.form.get('mes_ref', '').strip() or None

    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    # Salva arquivo temporário de entrada
    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    # Arquivo temporário de saída
    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            import sys, os
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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

        if not _verificar_permissao_modulo(usuario_id, 'fretes'):
            return jsonify({'erro': 'Acesso negado'}), 403


    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202


@app.route('/api/modulos/status/<job_id>', methods=['GET'])
@jwt_required()
def status_job(job_id):
    from flask import jsonify
    job = jobs.get(job_id)
    if not job:
        return jsonify({'erro': 'Job não encontrado'}), 404
    return jsonify(job), 200


@app.route('/api/modulos/download/<job_id>', methods=['GET'])
def download_resultado(job_id):
    from flask import request as freq
    # Aceita token via query string para download direto
    token = freq.args.get('token')
    if not token:
        return jsonify({'erro': 'Token não fornecido'}), 401
    
    try:
        from flask_jwt_extended import decode_token
        decode_token(token)
    except Exception:
        return jsonify({'erro': 'Token inválido'}), 401

    job = jobs.get(job_id)
    if not job or job['status'] != 'concluido':
        return jsonify({'erro': 'Arquivo não disponível'}), 404
    
    return send_file(
        job['arquivo'],
        as_attachment=True,
        download_name=job.get('nome', 'relatorio.xlsx'),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.route('/api/modulos/armazenagem', methods=['POST'])
@jwt_required()
def processar_armazenagem_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo   = request.files['arquivo']
    mes_filtro = request.form.get('mes_filtro', '').strip()

    if not mes_filtro:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

    def log(msg):
        jobs[job_id]['logs'].append(msg)

    def executar():
        try:
            import sys, os
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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
                    pass
            else:
                jobs[job_id]['status'] = 'erro'
                jobs[job_id]['erro']   = 'Processamento falhou'
        except Exception as e:
            jobs[job_id]['status'] = 'erro'
            jobs[job_id]['erro']   = str(e)
        finally:
            _deletar_temp(tmp_entrada.name)

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'armazenagem'):
            return jsonify({'erro': 'Acesso negado'}), 403

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/pedidos', methods=['POST'])
@jwt_required()
def processar_pedidos_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip() or None

    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

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

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'pedidos'):
            return jsonify({'erro': 'Acesso negado'}), 403

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/recebimentos', methods=['POST'])
@jwt_required()
def processar_recebimentos_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip()

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

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

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'recebimentos'):
            return jsonify({'erro': 'Acesso negado'}), 403

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/cap_operacional', methods=['POST'])
@jwt_required()
def processar_cap_operacional_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip()
    limiar_media = float(request.form.get('limiar_media', 3.0))
    limiar_alta  = float(request.form.get('limiar_alta', 5.0))

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    if not arquivo.filename.endswith('.pdf'):
        return jsonify({'erro': 'Arquivo deve ser .pdf'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

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

            resultado = mod.run_cap_operacional_pdf(
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

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'cap_operacional'):
            return jsonify({'erro': 'Acesso negado'}), 403

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202
import json

DB_ESTOQUE_PATH_WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'estoque_db.json')
os.makedirs(os.path.dirname(DB_ESTOQUE_PATH_WEB), exist_ok=True)

@app.route('/api/modulos/estoque/db/info', methods=['GET'])
@jwt_required()
def estoque_db_info():
    try:
        if not os.path.exists(DB_ESTOQUE_PATH_WEB):
            return jsonify({'total_skus': 0, 'ultima': None, 'clientes': []}), 200
        with open(DB_ESTOQUE_PATH_WEB, 'r', encoding='utf-8') as f:
            db = json.load(f)
        total  = sum(len(skus) for skus in db.values())
        datas  = []
        for skus in db.values():
            for sku in skus.values():
                if sku.get('atualizado'):
                    datas.append(sku['atualizado'])
        ultima = max(datas) if datas else None
        return jsonify({'total_skus': total, 'ultima': ultima, 'clientes': list(db.keys())}), 200
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
        db = mod._carregar_estoque_xlsx(tmp.name, log)
        if db:
            mod._salvar_db_estoque(db)
            total = sum(len(s) for s in db.values())
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
@jwt_required()
def processar_estoque_route():
    if 'arquivo_pico' not in request.files:
        return jsonify({'erro': 'Arquivo de pico não enviado'}), 400

    arquivo_pico = request.files['arquivo_pico']
    dias_ocioso  = int(request.form.get('dias_ocioso', 120))
    mes_ref      = request.form.get('mes_ref', '').strip()

    tmp_pico  = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo_pico.save(tmp_pico.name)
    tmp_pico.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

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

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'estoque'):
            return jsonify({'erro': 'Acesso negado'}), 403

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/fat_dist', methods=['POST'])
@jwt_required()
def processar_fat_dist_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    mes_ref = request.form.get('mes_ref', '').strip()

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    if not arquivo.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'erro': 'Arquivo deve ser .xlsx ou .xls'}), 400

    tmp_entrada = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo.save(tmp_entrada.name)
    tmp_entrada.close()

    tmp_dir = tempfile.mkdtemp()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

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

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'fat_dist'):
            return jsonify({'erro': 'Acesso negado'}), 403

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/fat_arm', methods=['POST'])
@jwt_required()
def processar_fat_arm_route():
    if 'arquivo_mov' not in request.files or 'arquivo_volumes' not in request.files:
        return jsonify({'erro': 'Arquivos de movimentação e volumes são obrigatórios'}), 400

    arquivo_mov     = request.files['arquivo_mov']
    arquivo_volumes = request.files['arquivo_volumes']
    mes_ref         = request.form.get('mes_ref', '').strip()

    if not mes_ref:
        return jsonify({'erro': 'Mês de referência é obrigatório'}), 400

    tmp_mov = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo_mov.save(tmp_mov.name)
    tmp_mov.close()

    tmp_vol = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    arquivo_volumes.save(tmp_vol.name)
    tmp_vol.close()

    tmp_saida = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_saida.close()

    job_id     = str(uuid.uuid4())
    usuario_id = int(get_jwt_identity())
    jobs[job_id] = {'status': 'processando', 'logs': [], 'erro': None}

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

        if not _verificar_permissao_modulo(int(get_jwt_identity()), 'fat_arm'):
            return jsonify({'erro': 'Acesso negado'}), 403

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
    from sqlalchemy import func

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

from openai import OpenAI
import json

def analisar_e_salvar_memorias(app_ctx, usuario_id: int, msgs: list):
    """Roda em background — analisa a conversa e atualiza memórias do usuário."""
    import threading
    
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
@jwt_required()
def atlas_chat():
    data          = request.get_json()
    api_key       = os.getenv('OPENAI_API_KEY', '').strip()
    model_id      = data.get('model', 'gpt-5.4-mini')
    history       = data.get('history', [])
    tools_def     = data.get('tools', [])
    temp          = float(data.get('temperature', 1.0))
    system_prompt = data.get('system_prompt', '')

    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada no servidor'}), 500

    try:
        client = OpenAI(api_key=api_key)

        # ── Converter histórico do formato interno para Responses API ─────────
        def converter_input(history):
            input_list = []
            for m in history:
                role = 'assistant' if m['role'] == 'model' else m['role']
                parts = m.get('parts', [])

                # Mensagem de tool result (role=user com functionResponse)
                fn_responses = [p for p in parts if 'functionResponse' in p]
                if fn_responses:
                    for fr in fn_responses:
                        input_list.append({
                            'type': 'function_call_output',
                            'call_id': fr['functionResponse'].get('call_id', fr['functionResponse']['name']),
                            'output': json.dumps(fr['functionResponse']['response'], ensure_ascii=False)
                        })
                    continue

                # Mensagem de function call (role=assistant com functionCall)
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

                # Mensagem normal (texto e/ou arquivo)
                content = []
                for p in parts:
                    if 'text' in p:
                        # user → input_text | assistant (model) → output_text
                        text_type = 'output_text' if role == 'assistant' else 'input_text'
                        content.append({'type': text_type, 'text': p['text']})
                    elif 'file_data' in p:
                        content.append({'type': 'input_file', 'file_id': p['file_data']['file_id']})

                if content:
                    input_list.append({'role': role, 'content': content})

            return input_list

        # ── Converter tools para formato OpenAI (com Structured Outputs) ─────
        def build_tools(tools_def):
            tools = []
            for t in tools_def:
                params = t.get('parameters', {'type': 'object', 'properties': {}})
                properties = params.get('properties', {})
                # Strict mode exige que TODOS os campos estejam em required
                # Campos opcionais devem usar type: [string, null] no frontend
                all_keys = list(properties.keys())
                params = {
                    'type': 'object',
                    'properties': properties,
                    'required': all_keys,
                    'additionalProperties': False
                }
                tools.append({
                    'type': 'function',
                    'name': t['name'],
                    'description': t.get('description', ''),
                    'parameters': params,
                    'strict': True
                })
            return tools

        input_list        = converter_input(history)
        openai_tools      = build_tools(tools_def) if tools_def else []
        reasoning_effort  = data.get('reasoning_effort', 'medium')
        use_code_interp   = data.get('code_interpreter', False)
        previous_resp_id  = data.get('previous_response_id', None)

        # ── Chamada à Responses API com streaming SSE ─────────────────────────
        def generate():
            try:
                # Tools: funções customizadas + web_search + code_interpreter
                all_tools = []
                if openai_tools:
                    all_tools.extend(openai_tools)
                all_tools.append({'type': 'web_search_preview'})
                if use_code_interp:
                    all_tools.append({'type': 'code_interpreter', 'container': {'type': 'auto'}})
                # File Search — ativa se houver Vector Store configurado
                vs_id = os.getenv('OPENAI_VECTOR_STORE_ID', '').strip()
                if vs_id:
                    all_tools.append({
                        'type': 'file_search',
                        'vector_store_ids': [vs_id]
                    })

                kwargs = dict(
                    model=model_id,
                    input=input_list,
                    instructions=system_prompt or None,
                    temperature=temp,
                    tools=all_tools,
                    stream=True,
                    reasoning={'effort': reasoning_effort, 'summary': 'auto'},
                    store=True,
                )
                if previous_resp_id:
                    kwargs['previous_response_id'] = previous_resp_id

                stream = client.responses.create(**kwargs)

                text_buffer = ''
                fn_calls_buffer = {}   # call_id → {name, arguments}

                for event in stream:
                    etype = event.type

                    # Chunk de texto chegando
                    if etype == 'response.output_text.delta':
                        delta = event.delta or ''
                        text_buffer += delta
                        yield f"data: {json.dumps({'type': 'text_delta', 'delta': delta})}\n\n"

                    # Início de function call ou reasoning
                    elif etype == 'response.output_item.added':
                        item = event.item
                        if getattr(item, 'type', None) == 'function_call':
                            fn_calls_buffer[item.call_id] = {'name': item.name, 'arguments': ''}
                        elif getattr(item, 'type', None) == 'reasoning':
                            yield f"data: {json.dumps({'type': 'reasoning_start'})}\n\n"

                    # Delta do reasoning chegando
                    elif etype == 'response.reasoning_summary_text.delta':
                        delta = event.delta or ''
                        yield f"data: {json.dumps({'type': 'reasoning_delta', 'delta': delta})}\n\n"

                    # Delta dos argumentos de function call
                    elif etype == 'response.function_call_arguments.delta':
                        if fn_calls_buffer:
                            call_id = list(fn_calls_buffer.keys())[-1]
                            fn_calls_buffer[call_id]['arguments'] += (event.delta or '')

                    # Function call completa
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

                    # Resposta completa — retorna response_id para conversation state
                    elif etype == 'response.completed':
                        resp_id = getattr(event.response, 'id', None)
                        # Extrai anotações de citação do web search
                        citations = []

                        try:
                            output = getattr(event.response, 'output', None) or []
                            for item in output:
                                content = getattr(item, 'content', None) or []
                                for part in content:
                                    annotations = getattr(part, 'annotations', None) or []
                                    for ann in annotations:
                                        if getattr(ann, 'type', '') == 'url_citation':
                                            url = getattr(ann, 'url', '')
                                            title = getattr(ann, 'title', url)
                                            start = getattr(ann, 'start_index', None)
                                            end = getattr(ann, 'end_index', None)
                                            if url and not any(c['url'] == url for c in citations):
                                                citations.append({'url': url, 'title': title, 'start': start, 'end': end})
                        except Exception:
                            pass

                        yield f"data: {json.dumps({'type': 'done', 'text': text_buffer, 'response_id': resp_id, 'citations': citations})}\n\n"

                    elif etype == 'error':
                        yield f"data: {json.dumps({'type': 'error', 'message': str(event)})}\n\n"

                    # Todos os outros eventos ignorados silenciosamente
                    # (web search, content parts, response.in_progress, etc.)

            except Exception as e:
                import traceback; traceback.print_exc()
                msg = str(e)
                if '429' in msg or 'quota' in msg.lower() or 'rate_limit' in msg.lower():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'cota_openai'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"

# Dispara análise de memórias em background
        usuario_id = int(get_jwt_identity())
        msgs = data.get('msgs', [])
        threading.Thread(
            target=analisar_e_salvar_memorias,
            args=(app.app_context(), usuario_id, msgs),
            daemon=True
        ).start()

        # Popula AtlasLog na primeira mensagem da conversa
        conv_id  = data.get('conv_id', '')
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
        import traceback; traceback.print_exc()
        return jsonify({'erro': str(e)}), 500


@app.route('/api/atlas/upload_arquivo', methods=['POST'])
@jwt_required()
def atlas_upload_arquivo():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    nome = arquivo.filename or 'arquivo'

    extensoes_suportadas = {
        '.xlsx', '.xls', '.csv',
        '.pdf',
        '.docx', '.doc', '.rtf',
        '.pptx', '.ppt',
        '.png', '.jpg', '.jpeg', '.webp', '.gif',
        '.txt', '.md', '.json', '.html', '.xml',
    }

    import os as _os
    ext = _os.path.splitext(nome)[1].lower()
    if ext not in extensoes_suportadas:
        return jsonify({'erro': f'Tipo de arquivo não suportado: {ext}'}), 400

    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada'}), 500

    try:
        import tempfile
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
        import traceback; traceback.print_exc()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/atlas/dashboard_data', methods=['GET'])
@jwt_required()
def atlas_dashboard_data():
    try:
        from sqlalchemy import func

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
        import traceback; traceback.print_exc()
        return jsonify({'erro': str(e)}), 500

@app.route('/api/atlas/metricas', methods=['GET'])
@jwt_required()
def atlas_metricas():
    """Métricas de uso do Atlas — apenas admins."""
    usuario = User.query.get(int(get_jwt_identity()))
    if not usuario or usuario.perfil != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403

    try:
        from sqlalchemy import func

        # Total de conversas e mensagens
        total_conversas = AtlasLog.query.count()
        total_msgs = db.session.query(func.sum(AtlasLog.total_msgs)).scalar() or 0

        # Conversas por usuário
        por_usuario = (
            db.session.query(User.nome, func.count(AtlasLog.id).label('conversas'), func.sum(AtlasLog.total_msgs).label('msgs'))
            .join(AtlasLog, AtlasLog.usuario_id == User.id)
            .group_by(User.id, User.nome)
            .order_by(func.count(AtlasLog.id).desc())
            .all()
        )

        # Conversa mais longa
        mais_longa = AtlasLog.query.order_by(AtlasLog.total_msgs.desc()).first()
        mais_longa_dict = None
        if mais_longa:
            u = User.query.get(mais_longa.usuario_id)
            mais_longa_dict = {
                'usuario': u.nome if u else 'Desconhecido',
                'primeira_msg': mais_longa.primeira_msg,
                'total_msgs': mais_longa.total_msgs
            }

        return jsonify({
            'total_conversas': total_conversas,
            'total_msgs': int(total_msgs),
            'por_usuario': [{'nome': p.nome, 'conversas': p.conversas, 'msgs': int(p.msgs or 0)} for p in por_usuario],
            'mais_longa': mais_longa_dict
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
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
    import threading
    from datetime import datetime, timezone

    usuario_id = get_jwt_identity()
    usuario    = User.query.get(usuario_id)
    resultado  = {}

    # ── 1. Outlook (agenda + e-mails) ─────────────────────────────────────────
    access_token, _ = _get_access_token(usuario_id)
    outlook_conectado = access_token is not None
    resultado['outlook_conectado'] = outlook_conectado

    if outlook_conectado:
        hoje     = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        amanha   = (datetime.now(timezone.utc).replace(hour=23, minute=59)).strftime('%Y-%m-%dT%H:%M:%S')
        inicio   = f'{hoje}T00:00:00'

        agenda_data, emails_data = None, None
        erros = []

        def buscar_agenda():
            nonlocal agenda_data
            try:
                agenda_data = _chamar_mcp('get_agenda', {
                    'access_token': access_token,
                    'data_inicio':  inicio,
                    'data_fim':     amanha
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
                from openai import OpenAI as _OpenAI
                _client_email = _OpenAI(api_key=api_key)

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
            from openai import OpenAI as _OpenAI
            _client = _OpenAI(api_key=api_key)
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
        import traceback; traceback.print_exc()
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
    if conversa:
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
        import traceback; traceback.print_exc()
        return jsonify({'erro': str(e)}), 500


@app.route('/api/atlas/base_conhecimento', methods=['POST'])
@jwt_required()
def base_conhecimento_upload():
    """Faz upload de um documento para o Vector Store."""
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    nome = arquivo.filename or 'documento'
    ext = os.path.splitext(nome)[1].lower()

    extensoes_suportadas = {'.pdf', '.docx', '.doc', '.txt', '.md', '.pptx', '.ppt', '.xlsx', '.csv'}
    if ext not in extensoes_suportadas:
        return jsonify({'erro': f'Tipo não suportado: {ext}. Use PDF, Word, TXT, PowerPoint ou Excel.'}), 400

    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'OPENAI_API_KEY não configurada'}), 500

    try:
        import tempfile
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
        import traceback; traceback.print_exc()
        return jsonify({'erro': str(e)}), 500


@app.route('/api/atlas/base_conhecimento/<file_id>', methods=['DELETE'])
@jwt_required()
def base_conhecimento_deletar(file_id):
    """Remove um documento do Vector Store e da Files API."""
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
        import traceback; traceback.print_exc()
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
        window.opener.postMessage({ type: 'OUTLOOK_CONNECTED', email: '""" + (email_outlook or '') + """' }, '*');
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


@app.route('/api/outlook/emails', methods=['GET'])
@jwt_required()
def outlook_buscar_emails():
    """Busca e-mails do usuário via MCP Server."""
    usuario_id       = get_jwt_identity()
    query            = request.args.get('q', '')
    apenas_nao_lidos = request.args.get('nao_lidos', 'false').lower() == 'true'
    limite           = int(request.args.get('limite', 20))

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