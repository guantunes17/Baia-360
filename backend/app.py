import importlib
import importlib.util
import tempfile
import threading
import uuid
import pandas as pd
import msal
import requests as http_requests

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
    usuario_id  = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    primeira_msg = db.Column(db.String(200), nullable=True)
    total_msgs  = db.Column(db.Integer, default=0)
    criado_em   = db.Column(db.DateTime, default=datetime.utcnow)

class AtlasConversa(db.Model):
    __tablename__ = 'atlas_conversas'
    id          = db.Column(db.Integer, primary_key=True)
    usuario_id  = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    conv_id     = db.Column(db.String(20), nullable=False)       # id gerado no frontend
    titulo      = db.Column(db.String(200), default='Nova conversa')
    msgs_json   = db.Column(db.Text, nullable=False, default='[]')
    history_json = db.Column(db.Text, nullable=False, default='[]')
    atualizada_em = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    criada_em   = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':           self.id,
            'conv_id':      self.conv_id,
            'titulo':       self.titulo,
            'msgs':         json.loads(self.msgs_json),
            'history':      json.loads(self.history_json),
            'criadaEm':     self.criada_em.isoformat(),
            'atualizadaEm': self.atualizada_em.isoformat() if self.atualizada_em else self.criada_em.isoformat()
        }

class User(db.Model):
    __tablename__ = 'users'
    id         = db.Column(db.Integer, primary_key=True)
    nome       = db.Column(db.String(100), nullable=False)
    email      = db.Column(db.String(120), unique=True, nullable=False)
    senha_hash = db.Column(db.String(256), nullable=False)
    perfil     = db.Column(db.String(20), default='usuario')
    ativo      = db.Column(db.Boolean, default=True)
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
            'criado_em': self.criado_em.isoformat()
        }

class RelatorioGerado(db.Model):
    __tablename__ = 'relatorios_gerados'

    id         = db.Column(db.Integer, primary_key=True)
    modulo     = db.Column(db.String(50), nullable=False)
    mes_ref    = db.Column(db.String(10), nullable=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
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

with app.app_context():
    db.create_all()


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
    if not user.ativo:
        return jsonify({'erro': 'Usuário inativo'}), 403

    token = create_access_token(identity=str(user.id), expires_delta=timedelta(hours=8))
    return jsonify({'token': token, 'usuario': user.to_dict()}), 200


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

    novo = User(nome=data.get('nome',''), email=email, perfil=data.get('perfil','usuario'))
    novo.set_senha(data.get('senha',''))
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

    db.session.delete(user)
    db.session.commit()
    return jsonify({'msg': 'Usuário deletado com sucesso'}), 200

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
                        reg  = RelatorioGerado(modulo='Fretes', mes_ref=None, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
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

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

@app.route('/api/modulos/pedidos', methods=['POST'])
@jwt_required()
def processar_pedidos_route():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']

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
                        reg  = RelatorioGerado(modulo='Pedidos', mes_ref=None, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
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
                        reg  = RelatorioGerado(modulo='Recebimento', mes_ref=None, usuario_id=usuario_id, kpis_json=json.dumps(kpis))
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

    threading.Thread(target=executar, daemon=True).start()
    return jsonify({'job_id': job_id}), 202

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
                    reasoning={'effort': reasoning_effort},
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

                    # Início de function call
                    elif etype == 'response.output_item.added':
                        item = event.item
                        if getattr(item, 'type', None) == 'function_call':
                            fn_calls_buffer[item.call_id] = {'name': item.name, 'arguments': ''}

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
                        yield f"data: {json.dumps({'type': 'done', 'text': text_buffer, 'response_id': resp_id})}\n\n"

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
        conversa.titulo       = data.get('titulo', conversa.titulo)
        conversa.msgs_json    = json.dumps(data.get('msgs', []), ensure_ascii=False)
        conversa.history_json = json.dumps(data.get('history', []), ensure_ascii=False)
        conversa.atualizada_em = datetime.utcnow()
    else:
        conversa = AtlasConversa(
            usuario_id   = usuario_id,
            conv_id      = conv_id,
            titulo       = data.get('titulo', 'Nova conversa'),
            msgs_json    = json.dumps(data.get('msgs', []), ensure_ascii=False),
            history_json = json.dumps(data.get('history', []), ensure_ascii=False),
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
    usuario_id    = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
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

OUTLOOK_SCOPES = ["Calendars.ReadWrite", "Mail.Read", "Mail.Send", "User.Read"]

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
    resp.raise_for_status()
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)