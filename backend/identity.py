# -*- coding: utf-8 -*-
"""
Identity authority — the single owner of user token issuance for the whole
process. Fase 3 do desacoplamento Atlas/Central (ver
plan_atlas_central_decoupling_2026-07-13.md e docs/architecture/COUPLING_MAP.md).

Ainda um processo só (Postgres único, um Flask), mas a emissão de token
agora tem um dono único e explícito: só emitir_token() chama
create_access_token — nenhum outro lugar do código (rotas "Atlas" ou
"Central" dentro do mesmo app.py) deve mintar token. Validação continua
acontecendo do jeito que já acontecia em todo o resto do app: via
@jwt_required()/get_jwt_identity(), que revalida a assinatura a cada
request, sem estado — isso já é "revalidação", não precisa de um segundo
mecanismo paralelo.

Chaves — RS256 assimétrico: a autoridade assina com a chave PRIVADA; o
resto do processo só precisa da chave PÚBLICA para verificar.
JWT_PRIVATE_KEY é opcional em configurar_jwt(): o processo Atlas (que
mint) carrega as duas; o processo Central (Fase 5 — container separado,
ver central_app.py) carrega só JWT_PUBLIC_KEY. Se algum código rodando em
Central tentar chamar emitir_token(), falha alto (sem chave privada) —
isso é a garantia real de "Central nunca minta", não só documentação.

Gerar um par novo (nunca commitar as chaves):
    openssl genrsa -out private.pem 2048
    openssl rsa -in private.pem -pubout -out public.pem
Colar o conteúdo de private.pem em JWT_PRIVATE_KEY e de public.pem em
JWT_PUBLIC_KEY no .env (dev) / .env.production (prod) — mesmo padrão que
JWT_SECRET_KEY já usava, só que agora são duas chaves PEM em vez de um
segredo simétrico.

Rotação de chaves: sem suporte a múltiplas chaves ativas (JWKS) — para os
~5 usuários internos desta aplicação isso seria complexidade sem benefício
real. Girar a chave invalida todos os tokens em circulação na hora: o
próximo /api/auth/me de cada sessão aberta responde 401 e o frontend manda
o usuário para o login de novo. Gire fora do horário de pico; não há downtime
de serviço, só um re-login forçado para quem estava logado.

Credencial de serviço: identifica o backend Atlas para os endpoints
internos da Central (/internal/relatorios/*) — em processos separados
(Fase 5), central_client.py anexa este header numa chamada HTTP real;
Central confere via verificar_credencial_servico() abaixo, junto com
@jwt_required() (o JWT do usuário, revalidado com a chave pública).
"""
import hmac
import os
from datetime import timedelta

from flask_jwt_extended import JWTManager, create_access_token

CENTRAL_SERVICE_HEADER = 'X-Central-Service-Token'
JWT_ACCESS_COOKIE_NAME = 'access_token_cookie'


def configurar_jwt(app) -> JWTManager:
    """RS256 + cookie httpOnly — chamado uma vez no boot do app, no lugar do
    bloco antigo de app.config['JWT_SECRET_KEY'] (HS256/simétrico).

    JWT_PUBLIC_KEY é sempre obrigatória. JWT_PRIVATE_KEY é opcional — um
    processo que só valida tokens (Central) não precisa dela; um processo
    que também faz login (Atlas) precisa das duas."""
    private_key = os.getenv('JWT_PRIVATE_KEY', '').strip()
    public_key  = os.getenv('JWT_PUBLIC_KEY', '').strip()
    if not public_key:
        raise RuntimeError(
            'JWT_PUBLIC_KEY é obrigatória (RS256). Gere um par com:\n'
            '  openssl genrsa -out private.pem 2048\n'
            '  openssl rsa -in private.pem -pubout -out public.pem\n'
            'e cole o conteúdo de cada arquivo nas respectivas variáveis do .env.'
        )

    app.config['JWT_ALGORITHM']  = 'RS256'
    app.config['JWT_PUBLIC_KEY'] = public_key
    if private_key:
        app.config['JWT_PRIVATE_KEY'] = private_key

    # Cookie httpOnly — comportamento preservado da Fase 2 (HS256 antes, RS256 agora).
    app.config['JWT_TOKEN_LOCATION']      = ['cookies']
    app.config['JWT_COOKIE_SECURE']       = os.getenv('FLASK_ENV', 'development') == 'production'
    app.config['JWT_COOKIE_SAMESITE']     = 'Lax'
    app.config['JWT_COOKIE_CSRF_PROTECT'] = False
    app.config['JWT_ACCESS_COOKIE_NAME']  = JWT_ACCESS_COOKIE_NAME
    app.config['JWT_COOKIE_DOMAIN']       = None

    return JWTManager(app)


def emitir_token(user, validade: timedelta = timedelta(hours=8)) -> str:
    """Único ponto de emissão de token do processo inteiro. Chamado apenas
    por POST /api/auth/login — nenhum outro código deve chamar
    create_access_token diretamente."""
    return create_access_token(identity=str(user.id), expires_delta=validade)


def verificar_credencial_servico(request) -> bool:
    """Confere o header de credencial de serviço contra CENTRAL_SERVICE_TOKEN,
    em tempo constante (evita timing attack no valor do segredo). Usado pelos
    endpoints /internal/relatorios/* junto com @jwt_required() — a chamada
    precisa das duas coisas: um JWT de usuário válido E esta credencial."""
    esperado = os.getenv('CENTRAL_SERVICE_TOKEN', '')
    recebido = request.headers.get(CENTRAL_SERVICE_HEADER, '')
    if not esperado:
        return False
    return hmac.compare_digest(esperado, recebido)
