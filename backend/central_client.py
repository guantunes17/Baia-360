# -*- coding: utf-8 -*-
"""
Internal read-only client Atlas uses to reach Central de Relatórios data.

Fase 5 do desacoplamento Atlas/Central: Atlas e Central agora são processos
separados (containers separados — ver central_app.py e
docker-compose.prod.yml), então esta chamada precisa mesmo ir pela rede.

Recebe o token bruto (string), não um usuario_id — Central revalida esse
token com a chave pública dele mesma, de forma independente. Isso é
deliberado: um Atlas comprometido (a "lethal trifecta" que motivou todo
esse desacoplamento) não pode simplesmente afirmar "esse usuário é o 42";
o JWT precisa ser válido de verdade para a identidade que a Central vai
usar nas checagens de permissão.
"""
import os

import requests

CENTRAL_SERVICE_HEADER = 'X-Central-Service-Token'
JWT_ACCESS_COOKIE_NAME = 'access_token_cookie'


class ModuloInvalidoError(ValueError):
    """Raised when an unknown module slug is requested."""


class PermissaoNegadaError(Exception):
    """Raised when the current user lacks permission for the requested module."""


def _central_base_url() -> str:
    # Default é o cenário de dev local (python central_app.py rodando à parte,
    # porta 5003) — não um hostname só resolvível dentro da rede Docker.
    # docker-compose.prod.yml define CENTRAL_BASE_URL=http://central:5003
    # explicitamente para o container do Atlas.
    return os.getenv('CENTRAL_BASE_URL', 'http://localhost:5003').rstrip('/')


def _service_token() -> str:
    return os.getenv('CENTRAL_SERVICE_TOKEN', '')


def obter_dashboard(token: str, modulo: str | None = None) -> dict:
    """Latest KPIs per module plus recent history, filtered to the modules
    the token's user is allowed to see.

    `token` is the raw JWT string from the current request's cookie — never
    a bare user id — because Central independently re-validates it rather
    than trusting whatever Atlas's own code hands over.

    modulo=None returns every module the user has permission for.
    modulo='<slug>' returns just that module, or raises:
      - ModuloInvalidoError if the slug isn't one of the known report modules
      - PermissaoNegadaError if the user isn't allowed to see that module
    """
    params = {'modulo': modulo} if modulo else {}
    try:
        resp = requests.get(
            f'{_central_base_url()}/internal/relatorios/dashboard',
            params=params,
            cookies={JWT_ACCESS_COOKIE_NAME: token or ''},
            headers={CENTRAL_SERVICE_HEADER: _service_token()},
            timeout=10,
        )
    except requests.RequestException as e:
        raise RuntimeError(f'Central indisponível: {e}') from e

    if resp.status_code == 200:
        return resp.json()

    corpo = {}
    try:
        corpo = resp.json()
    except ValueError:
        pass
    mensagem = corpo.get('erro', f'Erro HTTP {resp.status_code}')

    if resp.status_code == 400:
        raise ModuloInvalidoError(mensagem)
    if resp.status_code == 403:
        raise PermissaoNegadaError(mensagem)
    # 401 não deveria acontecer em uso normal — Atlas só chega aqui com um
    # cookie que já passou pela própria checagem @jwt_required(); se
    # Central mesmo assim rejeitar (token expirou entre as duas checagens,
    # relógio dessincronizado, bug de encaminhamento), é um erro genérico,
    # não "usuário sem permissão" — a mensagem pro usuário não deve confundir
    # sessão expirada com acesso negado.
    raise RuntimeError(f'Central retornou {resp.status_code}: {mensagem}')
