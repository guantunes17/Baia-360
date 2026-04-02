import importlib
import importlib.util
import tempfile
import threading
import uuid
import pandas as pd

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

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY']                     = os.getenv('SECRET_KEY')
app.config['JWT_SECRET_KEY']                 = os.getenv('JWT_SECRET_KEY')
app.config['SQLALCHEMY_DATABASE_URI']        = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

CORS(app, origins=["http://localhost:5173", "http://localhost:3000"])
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

import google.generativeai as genai
from google import genai as genai_new
from google.genai import types as genai_types
import json

@app.route('/api/atlas/chat', methods=['POST'])
@jwt_required()
def atlas_chat():
    data          = request.get_json()
    api_key       = os.getenv('GEMINI_API_KEY', '').strip()
    model_id      = data.get('model', 'gemini-2.5-flash')
    history       = data.get('history', [])
    tools_def     = data.get('tools', [])
    temp          = float(data.get('temperature', 1.0))
    system_prompt = data.get('system_prompt', '')

    if not api_key:
        return jsonify({'erro': 'GEMINI_API_KEY não configurada no servidor'}), 500

    try:
        client = genai_new.Client(api_key=api_key)

        def converter_contents(history):
            contents = []
            for m in history:
                parts = []
                for p in m.get('parts', []):
                    if 'text' in p:
                        parts.append(genai_types.Part(text=p['text']))
                    elif 'file_data' in p:
                        parts.append(genai_types.Part(
                            file_data=genai_types.FileData(
                                mime_type=p['file_data']['mime_type'],
                                file_uri=p['file_data']['file_uri']
                            )
                        ))
                    elif 'functionCall' in p:
                        parts.append(genai_types.Part(
                            function_call=genai_types.FunctionCall(
                                name=p['functionCall']['name'],
                                args=p['functionCall']['args']
                            )
                        ))
                    elif 'functionResponse' in p:
                        parts.append(genai_types.Part(
                            function_response=genai_types.FunctionResponse(
                                name=p['functionResponse']['name'],
                                response=p['functionResponse']['response']
                            )
                        ))
                role = 'model' if m['role'] == 'model' else 'user'
                contents.append(genai_types.Content(role=role, parts=parts))
            return contents

        def build_declarations(tools_def):
            declarations = []
            for t in tools_def:
                params = t.get('parameters', {})
                properties = {}
                for prop_name, prop_def in params.get('properties', {}).items():
                    properties[prop_name] = genai_types.Schema(
                        type=genai_types.Type.STRING,
                        description=prop_def.get('description', '')
                    )
                schema = genai_types.Schema(
                    type=genai_types.Type.OBJECT,
                    properties=properties,
                    required=params.get('required', [])
                )
                declarations.append(genai_types.FunctionDeclaration(
                    name=t['name'],
                    description=t.get('description', ''),
                    parameters=schema
                ))
            return declarations

        contents = converter_contents(history)

        # ── Chamada 1: Router — google_search apenas ──────────────────────────
        router_system = system_prompt + """

INSTRUÇÃO ESPECIAL DE ROTEAMENTO:
Antes de responder, classifique internamente o que o usuário precisa:
- Se precisar de dados internos da operação (KPIs, relatórios, dashboard, faturamento, SLA, estoque, gerar relatório, agenda) → responda EXATAMENTE com: USAR_FUNCTION_CALLING
- Se precisar de informações atuais da internet (cotações, notícias, eventos recentes, dados externos) → use o google_search e responda normalmente
- Para qualquer outra pergunta → responda normalmente sem busca

Responda APENAS com USAR_FUNCTION_CALLING quando for o caso, sem nenhuma outra palavra."""

        config_router = genai_types.GenerateContentConfig(
            system_instruction=router_system,
            tools=[genai_types.Tool(google_search=genai_types.GoogleSearch())],
            temperature=temp
        )

        response1 = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=config_router
        )

        texto1 = ''
        for part in response1.candidates[0].content.parts:
            if part.text:
                texto1 += part.text

        # ── Se o router decidiu usar function calling ─────────────────────────
        if texto1.strip() == 'USAR_FUNCTION_CALLING':
            declarations = build_declarations(tools_def)
            fc_tools = [genai_types.Tool(function_declarations=declarations)] if declarations else []

            config_fc = genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                tools=fc_tools or None,
                temperature=temp
            )

            response2 = client.models.generate_content(
                model=model_id,
                contents=contents,
                config=config_fc
            )

            parts_out = []
            for part in response2.candidates[0].content.parts:
                if part.text:
                    parts_out.append({'text': part.text})
                elif part.function_call:
                    parts_out.append({'functionCall': {
                        'name': part.function_call.name,
                        'args': dict(part.function_call.args)
                    }})
            return jsonify({'parts': parts_out}), 200

        # ── Resposta direta (texto ou web search já processado) ───────────────
        parts_out = []
        for part in response1.candidates[0].content.parts:
            if part.text:
                parts_out.append({'text': part.text})
            elif part.function_call:
                parts_out.append({'functionCall': {
                    'name': part.function_call.name,
                    'args': dict(part.function_call.args)
                }})

        return jsonify({'parts': parts_out}), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        msg = str(e)
        if '429' in msg or 'quota' in msg.lower() or 'resource_exhausted' in msg.lower():
            return jsonify({'erro': 'cota_gemini'}), 429
        return jsonify({'erro': msg}), 500
    
@app.route('/api/atlas/chat/tool_response', methods=['POST'])
@jwt_required()
def atlas_tool_response():
    data          = request.get_json()
    api_key       = os.getenv('GEMINI_API_KEY', '').strip()
    model_id      = data.get('model', 'gemini-2.5-flash')
    history       = data.get('history', [])
    tools_def     = data.get('tools', [])
    temp          = float(data.get('temperature', 1.0))
    system_prompt = data.get('system_prompt', '')

    if not api_key:
        return jsonify({'erro': 'GEMINI_API_KEY não configurada no servidor'}), 500

    try:
        client = genai_new.Client(api_key=api_key)

        def converter_contents(history):
            contents = []
            for m in history:
                parts = []
                for p in m.get('parts', []):
                    if 'text' in p:
                        parts.append(genai_types.Part(text=p['text']))
                    elif 'file_data' in p:
                        parts.append(genai_types.Part(
                            file_data=genai_types.FileData(
                                mime_type=p['file_data']['mime_type'],
                                file_uri=p['file_data']['file_uri']
                            )
                        ))
                    elif 'functionCall' in p:
                        parts.append(genai_types.Part(
                            function_call=genai_types.FunctionCall(
                                name=p['functionCall']['name'],
                                args=p['functionCall']['args']
                            )
                        ))
                    elif 'functionResponse' in p:
                        parts.append(genai_types.Part(
                            function_response=genai_types.FunctionResponse(
                                name=p['functionResponse']['name'],
                                response=p['functionResponse']['response']
                            )
                        ))
                role = 'model' if m['role'] == 'model' else 'user'
                contents.append(genai_types.Content(role=role, parts=parts))
            return contents

        def build_declarations(tools_def):
            declarations = []
            for t in tools_def:
                params = t.get('parameters', {})
                properties = {}
                for prop_name, prop_def in params.get('properties', {}).items():
                    properties[prop_name] = genai_types.Schema(
                        type=genai_types.Type.STRING,
                        description=prop_def.get('description', '')
                    )
                schema = genai_types.Schema(
                    type=genai_types.Type.OBJECT,
                    properties=properties,
                    required=params.get('required', [])
                )
                declarations.append(genai_types.FunctionDeclaration(
                    name=t['name'],
                    description=t.get('description', ''),
                    parameters=schema
                ))
            return declarations

        contents = converter_contents(history)
        declarations = build_declarations(tools_def)

        # tool_response sempre continua o ciclo de function calling — sem google_search
        fc_tools = [genai_types.Tool(function_declarations=declarations)] if declarations else None

        config = genai_types.GenerateContentConfig(
            system_instruction=system_prompt or None,
            tools=fc_tools,
            temperature=temp
        )

        response = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=config
        )

        parts_out = []
        for part in response.candidates[0].content.parts:
            if part.text:
                parts_out.append({'text': part.text})
            elif part.function_call:
                parts_out.append({'functionCall': {
                    'name': part.function_call.name,
                    'args': dict(part.function_call.args)
                }})

        return jsonify({'parts': parts_out}), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        msg = str(e)
        if '429' in msg or 'quota' in msg.lower() or 'resource_exhausted' in msg.lower():
            return jsonify({'erro': 'cota_gemini'}), 429
        return jsonify({'erro': msg}), 500

@app.route('/api/atlas/upload_arquivo', methods=['POST'])
@jwt_required()
def atlas_upload_arquivo():
    if 'arquivo' not in request.files:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400

    arquivo = request.files['arquivo']
    nome = arquivo.filename or 'arquivo'

    extensoes_suportadas = {
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
    }

    import os as _os
    ext = _os.path.splitext(nome)[1].lower()
    if ext not in extensoes_suportadas:
        return jsonify({'erro': f'Tipo de arquivo não suportado: {ext}'}), 400

    mime = extensoes_suportadas[ext]
    api_key = os.getenv('GEMINI_API_KEY', '').strip()
    if not api_key:
        return jsonify({'erro': 'GEMINI_API_KEY não configurada'}), 500

    try:
        import tempfile
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        arquivo.save(tmp.name)
        tmp.close()

        genai.configure(api_key=api_key)
        uploaded = genai.upload_file(tmp.name, mime_type=mime, display_name=nome)

        _deletar_temp(tmp.name)

        return jsonify({
            'file_uri': uploaded.uri,
            'mime_type': mime,
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)