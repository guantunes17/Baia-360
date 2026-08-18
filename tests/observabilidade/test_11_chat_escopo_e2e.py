"""
POST /api/atlas/chat de ponta a ponta, com um cliente OpenAI falso.

POR QUE ESTE ARQUIVO EXISTE
  Até aqui NENHUM teste desta suite exercitava a rota de chat — o docstring de
  test_09 diz explicitamente que o loop SSE é verificado "por code review + run
  ao vivo, não aqui". Isso deixava os dois pontos onde `escopo_kb` é gravado
  (caminho feliz e caminho de falha) completamente sem cobertura, e eles são
  justamente onde a promessa de observabilidade da segregação se cumpre ou não.

  Pior: são variáveis de CLOSURE. `_fs_tool` e `_bases_efetivas` são
  calculados no corpo da rota e lidos lá dentro de generate(), que roda depois
  do contexto do request ser desmontado. Um erro aí não aparece em import, não
  aparece em lint e não aparece em teste unitário — aparece como NameError no
  meio de um stream em produção, ou pior, como trace gravada sem escopo.

  O cliente falso substitui só a fronteira da OpenAI (client.responses.create).
  O resto — rota, JWT, montagem de tools, loop SSE, extração de RAG, escrita da
  trace — é o código real.
"""
import json
import threading
import time

import pytest

import atlas_kb


COMUM_FAKE    = 'vs_comum_e2e'
RESTRITA_FAKE = 'vs_restrita_e2e'


# ── Dublês do stream da Responses API ───────────────────────────────────────

class _Evt:
    def __init__(self, type, **kw):
        self.type = type
        for k, v in kw.items():
            setattr(self, k, v)


class _Resultado:
    def __init__(self, file_id, filename, score, text):
        self.file_id, self.filename, self.score, self.text = file_id, filename, score, text


class _FileSearchCall:
    type = 'file_search_call'
    def __init__(self, queries, results):
        self.queries, self.results = queries, results


class _Usage:
    input_tokens, output_tokens = 11, 22


class _Response:
    def __init__(self, output):
        self.id, self.output, self.usage = 'resp_e2e_1', output, _Usage()


def _stream_ok(texto='Resposta do Atlas.', com_retrieval=True):
    """Stream mínimo que o loop real aceita: delta de texto + response.completed."""
    saida = []
    if com_retrieval:
        saida.append(_FileSearchCall(
            queries=['planta baixa'],
            results=[_Resultado('file-1', 'planta.pdf', 0.81, 'trecho recuperado')],
        ))
    return [
        _Evt('response.output_text.delta', delta=texto),
        _Evt('response.completed', response=_Response(saida)),
    ]


class _ClienteFake:
    """Captura os kwargs de cada chamada e devolve o stream programado."""
    def __init__(self, stream=None, erro=None):
        self.chamadas = []
        self._stream, self._erro = stream, erro
        cliente = self

        class _Responses:
            def create(self, **kwargs):
                cliente.chamadas.append(kwargs)
                if cliente._erro:
                    raise cliente._erro
                return iter(cliente._stream if cliente._stream is not None else _stream_ok())

        self.responses = _Responses()


@pytest.fixture
def stores_e2e(monkeypatch):
    def _set(comum=COMUM_FAKE, restrita=RESTRITA_FAKE):
        for nome, valor in (('ATLAS_VECTOR_STORE_COMUM_ID', comum),
                            ('ATLAS_VECTOR_STORE_RESTRITA_ID', restrita),
                            ('OPENAI_VECTOR_STORE_ID', '')):
            monkeypatch.setenv(nome, valor) if valor else monkeypatch.delenv(nome, raising=False)
    _set()
    return _set


@pytest.fixture
def chat(app, models, monkeypatch, make_client, make_user):
    """Devolve enviar(perfil=..., base_restrita=..., cliente=...) -> (eventos, cliente).

    O teardown DRENA as threads de escrita de trace. registrar_rag_trace grava
    numa thread de background que sobrevive ao fim do teste; sem drenar, uma
    inserção atrasada cai entre o DELETE de atlas_rag_trace e o DELETE de
    baia360_users do _clean_tables do teste SEGUINTE, e o resultado é um
    ForeignKeyViolation intermitente em outro arquivo — flake clássico, que
    culpa o teste errado. Observado de verdade aqui, não hipotético.
    """
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-fake-e2e')
    _threads_iniciais = set(threading.enumerate())

    def _enviar(perfil='operacional', base_restrita=None, cliente=None, db=None):
        cliente = cliente or _ClienteFake()
        monkeypatch.setattr(models, 'OpenAI', lambda **_kw: cliente)

        uid = make_user(perfil=perfil)
        if base_restrita is not None:
            with app.app_context():
                models.db.session.add(models.Permissao(
                    usuario_id=uid, hub_json='[]', modulos_json='[]',
                    atlas_json=json.dumps({'base_restrita': base_restrita})))
                models.db.session.commit()

        resp = make_client(uid).post('/api/atlas/chat', json={
            'history': [{'role': 'user', 'parts': [{'text': 'qual a planta baixa?'}]}],
            'msgs': [{'role': 'user', 'text': 'qual a planta baixa?'}],
            'conv_id': '', 'previous_response_id': None, 'code_interpreter': False,
            'modo': 'Padrão', 'projeto_nome': '', 'projeto_descricao': '',
        })
        assert resp.status_code == 200, resp.get_data(as_text=True)[:400]

        eventos = []
        for linha in resp.get_data(as_text=True).splitlines():
            if linha.startswith('data: '):
                try:
                    eventos.append(json.loads(linha[len('data: '):]))
                except json.JSONDecodeError:
                    pass
        return eventos, cliente, uid

    yield _enviar

    for t in threading.enumerate():
        if t not in _threads_iniciais and t.is_alive():
            t.join(timeout=5)


def _esperar_trace(app, models, timeout=5.0):
    """registrar_rag_trace grava numa thread de background — espera aparecer."""
    limite = time.time() + timeout
    while time.time() < limite:
        with app.app_context():
            linha = models.AtlasRAGTrace.query.order_by(models.AtlasRAGTrace.id.desc()).first()
            if linha is not None:
                return linha
        time.sleep(0.05)
    return None


# ── A tool que de fato vai para a API ───────────────────────────────────────

def test_usuario_sem_concessao_manda_apenas_a_store_comum(chat, stores_e2e):
    """A asserção é sobre o que saiu no fio, não sobre a política em memória."""
    _, cliente, _ = chat(perfil='operacional', base_restrita=False)
    tools = [t for t in cliente.chamadas[0]['tools'] if t.get('type') == 'file_search']
    assert len(tools) == 1
    assert tools[0]['vector_store_ids'] == [COMUM_FAKE]


def test_usuario_com_concessao_manda_as_duas_stores(chat, stores_e2e):
    _, cliente, _ = chat(perfil='operacional', base_restrita=True)
    tools = [t for t in cliente.chamadas[0]['tools'] if t.get('type') == 'file_search']
    assert tools[0]['vector_store_ids'] == [COMUM_FAKE, RESTRITA_FAKE]


def test_admin_manda_as_duas_stores_sem_linha_de_permissao(chat, stores_e2e):
    _, cliente, _ = chat(perfil='admin')
    tools = [t for t in cliente.chamadas[0]['tools'] if t.get('type') == 'file_search']
    assert tools[0]['vector_store_ids'] == [COMUM_FAKE, RESTRITA_FAKE]


def test_sem_store_configurada_nao_manda_file_search(chat, stores_e2e):
    """O chat continua respondendo — degradação, não erro."""
    stores_e2e(comum='', restrita='')
    eventos, cliente, _ = chat(perfil='admin')
    assert not [t for t in cliente.chamadas[0]['tools'] if t.get('type') == 'file_search']
    assert any(e.get('type') == 'done' for e in eventos)


# ── escopo_kb chegando na trace (o ponto do arquivo) ────────────────────────

def test_trace_grava_o_escopo_no_caminho_feliz(app, models, chat, stores_e2e):
    chat(perfil='operacional', base_restrita=True)
    linha = _esperar_trace(app, models)
    assert linha is not None, 'nenhuma trace gravada'
    assert json.loads(linha.escopo_kb) == ['comum', 'restrita']
    assert linha.falhou is False


def test_trace_grava_escopo_comum_para_quem_nao_tem_concessao(app, models, chat, stores_e2e):
    chat(perfil='operacional', base_restrita=False)
    linha = _esperar_trace(app, models)
    assert json.loads(linha.escopo_kb) == ['comum']


def test_trace_registra_degradacao_quando_a_store_restrita_nao_existe(
        app, models, chat, stores_e2e):
    """O caso que justifica gravar o escopo ANEXADO e não o CONCEDIDO: a
    permissão diz restrita, a store não existe, e isso tem de ficar visível."""
    stores_e2e(restrita='')
    chat(perfil='admin', base_restrita=True)
    linha = _esperar_trace(app, models)
    assert json.loads(linha.escopo_kb) == ['comum'], (
        'a trace registrou o escopo concedido em vez do efetivamente anexado — '
        'a degradação silenciosa some do dashboard'
    )


def test_trace_grava_lista_vazia_quando_nao_ha_store_alguma(app, models, chat, stores_e2e):
    """'[]' e NULL são coisas diferentes: aqui o escopo FOI medido."""
    stores_e2e(comum='', restrita='')
    chat(perfil='admin')
    linha = _esperar_trace(app, models)
    assert linha.escopo_kb == '[]'


def test_trace_de_falha_tambem_grava_o_escopo(app, models, chat, stores_e2e):
    """O caminho que mais fácil passaria despercebido: quando o turno morre, o
    escopo ainda é conhecido (é propriedade do request) e é o que diz se o
    usuário sequer tinha acesso à base onde a resposta estaria.

    Também é o único teste que prova que a variável de closure `_bases_efetivas`
    é alcançável do bloco except — um NameError ali só apareceria em produção."""
    from openai import APIError
    erro = APIError('boom no meio do stream', request=None, body=None)
    _, _, _ = chat(perfil='operacional', base_restrita=True,
                   cliente=_ClienteFake(erro=erro))

    linha = _esperar_trace(app, models)
    assert linha is not None, 'turno que falhou não gravou trace alguma'
    assert linha.falhou is True, 'a trace encontrada não é a do caminho de falha'
    # Checado antes do json.loads para a mensagem ser a causa real ("o caminho
    # de falha não gravou o escopo") em vez de um TypeError sobre NoneType.
    assert linha.escopo_kb is not None, (
        'trace de falha gravada SEM escopo — o único sinal que dizia se o '
        'usuário sequer tinha acesso à base onde a resposta estaria'
    )
    assert json.loads(linha.escopo_kb) == ['comum', 'restrita']


def test_escopo_e_lido_por_requisicao_e_nao_cacheado(app, models, db, chat, stores_e2e,
                                                     make_client):
    """Conceder e revogar tem efeito imediato: o escopo sai da linha viva de
    Permissao a cada request, não do token nem de cache de processo."""
    eventos, cliente, uid = chat(perfil='operacional', base_restrita=True)
    assert [t for t in cliente.chamadas[0]['tools']
            if t.get('type') == 'file_search'][0]['vector_store_ids'] == [COMUM_FAKE, RESTRITA_FAKE]

    with app.app_context():
        perm = models.Permissao.query.filter_by(usuario_id=uid).first()
        perm.atlas_json = json.dumps({'base_restrita': False})
        db.session.commit()

    make_client(uid).post('/api/atlas/chat', json={
        'history': [{'role': 'user', 'parts': [{'text': 'de novo'}]}],
        'msgs': [{'role': 'user', 'text': 'de novo'}],
        'conv_id': '', 'previous_response_id': None, 'code_interpreter': False,
        'modo': 'Padrão', 'projeto_nome': '', 'projeto_descricao': '',
    })
    assert [t for t in cliente.chamadas[-1]['tools']
            if t.get('type') == 'file_search'][0]['vector_store_ids'] == [COMUM_FAKE], (
        'a revogação não teve efeito na requisição seguinte — escopo cacheado'
    )
