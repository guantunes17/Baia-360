# -*- coding: utf-8 -*-
"""
Deploy readiness (Prompt 6) — prova de que identity._carregar_chave() aceita
os três formatos de chave RS256, com ênfase no base64 (formato usado em
produção, não hipotético — o env_file: do Docker Compose não é confiável
para um valor com quebras de linha reais).

Testes unitários diretos (sem servidor, sem Docker) — chama identity.py
importado direto, como run_unit_tests.py já faz com modules/central_relatorios.py.

Executar a partir do diretório backend/:
    python tests/test_identity_key_formats.py
"""
import base64
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from flask import Flask

import identity

FALHAS = []


def _gerar_par_pem():
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = chave.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    pub_pem = chave.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return priv_pem, pub_pem


def _checar(nome, condicao):
    status = "PASS" if condicao else "FAIL"
    print(f"  [{status}] {nome}")
    if not condicao:
        FALHAS.append(nome)


def _boot_e_mintar(priv_env, pub_env, label):
    """Configura um Flask app isolado com as env vars dadas, chama
    configurar_jwt + emitir_token, e confirma que o token mintado é
    validável com a chave pública configurada (prova end-to-end, não só
    que _carregar_chave não lançou exceção)."""
    os.environ['JWT_PRIVATE_KEY'] = priv_env
    os.environ['JWT_PUBLIC_KEY'] = pub_env
    app = Flask(f'test-{label}')
    app.config['JWT_TOKEN_LOCATION'] = ['cookies']
    identity.configurar_jwt(app)
    with app.app_context():
        from types import SimpleNamespace
        token = identity.emitir_token(SimpleNamespace(id=42))
    import jwt as pyjwt
    claims = pyjwt.decode(token, app.config['JWT_PUBLIC_KEY'], algorithms=['RS256'])
    return claims.get('sub') == '42'


def main():
    priv_pem, pub_pem = _gerar_par_pem()

    print("\n=== identity._carregar_chave — formatos aceitos (Prompt 6 / B4) ===")

    # 1) PEM cru (quebras de linha reais) — o formato "óbvio", já coberto
    #    implicitamente pelos testes de Fase 3, incluído aqui para regressão.
    ok = _boot_e_mintar(priv_pem, pub_pem, 'raw-pem')
    _checar("PEM cru (quebras de linha reais) -> mint + valida token", ok)

    # 2) PEM com \n escapado numa linha só (formato de um .env de uma linha
    #    só, sem aspas triplas).
    priv_escaped = priv_pem.replace('\n', '\\n')
    pub_escaped = pub_pem.replace('\n', '\\n')
    ok = _boot_e_mintar(priv_escaped, pub_escaped, 'escaped-newline')
    _checar("PEM com \\n escapado -> mint + valida token", ok)

    # 3) Base64 do PEM — O FORMATO REAL DE PRODUÇÃO, não hipotético. O par
    #    RS256 que já está em .env.production/.env.central.production no
    #    servidor está armazenado exatamente assim.
    priv_b64 = base64.b64encode(priv_pem.encode()).decode()
    pub_b64 = base64.b64encode(pub_pem.encode()).decode()
    ok = _boot_e_mintar(priv_b64, pub_b64, 'base64')
    _checar("Base64 do PEM (formato de produção) -> mint + valida token", ok)

    # 4) Lixo que não é nenhum dos três formatos -> RuntimeError claro, não
    #    uma chave truncada/vazia silenciosa.
    os.environ['JWT_PRIVATE_KEY'] = ''
    os.environ['JWT_PUBLIC_KEY'] = 'isto-nao-e-pem-nem-base64-valido!!!'
    app = Flask('test-garbage')
    try:
        identity.configurar_jwt(app)
        _checar("Valor inválido -> RuntimeError claro (não deveria ter chegado aqui)", False)
    except RuntimeError as e:
        _checar(f"Valor inválido -> RuntimeError claro ({e.__class__.__name__})", True)

    print()
    if FALHAS:
        print(f"FALHOU: {len(FALHAS)} caso(s) — {FALHAS}")
        sys.exit(1)
    print("Todos os casos de formato de chave passaram.")
    sys.exit(0)


if __name__ == '__main__':
    main()
