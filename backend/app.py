from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
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

CORS(app)
db  = SQLAlchemy(app)
jwt = JWTManager(app)


# ── Model ─────────────────────────────────────────────────────────────────────
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
    from flask import jsonify
    if User.query.filter_by(email='admin@baia360.com').first():
        return jsonify({'msg': 'Admin já existe'}), 200
    admin = User(nome='Administrador', email='admin@baia360.com', perfil='admin')
    admin.set_senha('admin123')
    db.session.add(admin)
    db.session.commit()
    return jsonify({'msg': 'Admin criado com sucesso'}), 201

if __name__ == '__main__':
    app.run(debug=True)