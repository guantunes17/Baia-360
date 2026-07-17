"""
Atlas integrity plan (2026-07-16, Prompt 2) — gurq9e4e incident: rate limit
inside the SSE stream, then a permanently orphaned function_call, on a
conversation whose context was being duplicated every turn.

Covers the pure/testable pieces of the fix in isolation: message-parsing
helpers, the previous_response_id-duplication fix (preparar_input_turno),
the history ceiling's safe-truncation logic, and orphan repair against a
fake client (mirrors test_03_eval.py's _FakeClient pattern — no network).
The SSE-loop wiring itself (A1.4 batching, in-stream retry) is exercised by
running a live backend — see the Prompt 2 report for that transcript;
reproducing a real mid-stream OpenAI rate limit isn't practical in a unit
test, so that path is verified by code review + the live run, not here.
"""
import json

import pytest


# ── extrair_call_id_orfao ────────────────────────────────────────────────

def test_extrai_call_id_orfao_do_erro_real(models):
    msg = "Error code: 400 - {'error': {'message': 'No tool output found for function call call_idsYuUQSC4t8nqEbizKY8nIO.', 'type': 'invalid_request_error', 'param': 'input', 'code': None}}"
    assert models.extrair_call_id_orfao(msg) == 'call_idsYuUQSC4t8nqEbizKY8nIO'


def test_extrai_call_id_orfao_none_quando_nao_e_esse_erro(models):
    assert models.extrair_call_id_orfao('Rate limit reached for gpt-5.4-mini') is None
    assert models.extrair_call_id_orfao('') is None
    assert models.extrair_call_id_orfao(None) is None


# ── extrair_retry_segundos ───────────────────────────────────────────────

def test_extrai_retry_segundos_do_erro_real(models):
    msg = ('Rate limit reached for gpt-5.4-mini in organization org-x on tokens per min (TPM): '
           'Limit 200000, Used 116903, Requested 107160. Please try again in 7.218s.')
    assert models.extrair_retry_segundos(msg) == pytest.approx(7.218)


def test_extrai_retry_segundos_none_quando_ausente(models):
    assert models.extrair_retry_segundos('algum outro erro qualquer') is None
    assert models.extrair_retry_segundos('') is None


# ── eh_erro_rate_limit ───────────────────────────────────────────────────

@pytest.mark.parametrize('msg,esperado', [
    ('Rate limit reached for gpt-5.4-mini ... Please try again in 7.218s.', True),
    ('Error code: 429 - quota exceeded', True),
    ('rate_limit_exceeded', True),
    ('No tool output found for function call call_x.', False),
    ('Connection timed out', False),
    ('', False),
])
def test_eh_erro_rate_limit(models, msg, esperado):
    assert models.eh_erro_rate_limit(msg) is esperado


# ── montar_output_sintetico_orfao ────────────────────────────────────────

def test_montar_output_sintetico_orfao_shape(models):
    out = models.montar_output_sintetico_orfao('call_abc')
    assert out['type'] == 'function_call_output'
    assert out['call_id'] == 'call_abc'
    payload = json.loads(out['output'])
    assert 'erro' in payload
    assert 'falhou' in payload['erro'].lower() or 'não recebeu' in payload['erro'].lower()


# ── _sufixo_seguro_historico ─────────────────────────────────────────────

def _msg(role, **extra):
    parts = extra.pop('parts', None)
    if parts is None:
        parts = [{'text': f'{role} text'}]
    return {'role': role, 'parts': parts}


def test_sufixo_nao_corta_quando_dentro_do_limite(models):
    hist = [_msg('user') for _ in range(5)]
    assert models._sufixo_seguro_historico(hist, 10) == hist


def test_sufixo_corta_no_limite_quando_fronteira_e_segura(models):
    hist = [_msg('user') for _ in range(10)]
    sufixo = models._sufixo_seguro_historico(hist, 4)
    assert len(sufixo) == 4
    assert sufixo == hist[-4:]


def test_sufixo_nunca_comeca_com_function_response_orfa(models):
    """A functionCall seguida da sua functionResponse não pode ser separada
    pelo corte — se o ponto de corte 'ingênuo' cairia numa functionResponse,
    o sufixo tem que se estender pra trás até incluir a functionCall também."""
    hist = [
        _msg('user'),
        _msg('user'),
        _msg('model', parts=[{'functionCall': {'call_id': 'c1', 'name': 'buscar_emails', 'args': {}}}]),
        _msg('user', parts=[{'functionResponse': {'call_id': 'c1', 'name': 'buscar_emails', 'response': {}}}]),
        _msg('model'),
        _msg('user'),
    ]
    # Corte "ingênuo" de n=3 cairia bem na functionResponse (índice 3) — o
    # sufixo tem que recuar pra incluir a functionCall correspondente (índice 2).
    sufixo = models._sufixo_seguro_historico(hist, 3)
    tem_function_call = any('functionCall' in p for m in sufixo for p in m.get('parts', []))
    tem_function_response = any('functionResponse' in p for m in sufixo for p in m.get('parts', []))
    if tem_function_response:
        assert tem_function_call, 'sufixo tem functionResponse sem a functionCall correspondente — órfã criada pela própria truncagem'


def test_sufixo_com_todo_historico_sendo_function_response_nao_trava(models):
    """Caso degenerado: se TODA mensagem antes do corte candidato for uma
    functionResponse (não deveria acontecer em uma conversa bem formada, mas
    a função não pode entrar em loop infinito nem estourar índice negativo)."""
    hist = [_msg('user', parts=[{'functionResponse': {'call_id': f'c{i}', 'name': 'x', 'response': {}}}]) for i in range(5)]
    sufixo = models._sufixo_seguro_historico(hist, 2)
    assert isinstance(sufixo, list)  # não trava, não estoura


# ── preparar_input_turno ─────────────────────────────────────────────────

def test_preparar_input_sem_chaining_manda_historico_inteiro(models):
    hist = [_msg('user'), _msg('model'), _msg('user')]
    input_list, resp_id = models.preparar_input_turno(hist, None)
    assert resp_id is None
    assert len(input_list) == 3


def test_preparar_input_com_chaining_manda_so_o_delta(models):
    """O achado central do Prompt 2: com previous_response_id setado, manda
    só a última mensagem — o resto já está retido do lado da OpenAI via o
    chain. Mandar tudo de novo JUNTO faz a conversa ser processada (e
    cobrada) duas vezes (confirmado empiricamente, ver COUPLING_MAP.md §7
    item 8)."""
    hist = [_msg('user'), _msg('model'), _msg('user'), _msg('model'), _msg('user')]
    input_list, resp_id = models.preparar_input_turno(hist, 'resp_anterior')
    assert resp_id == 'resp_anterior'
    assert len(input_list) == 1  # só o delta, não os 5


def test_preparar_input_teto_quebra_chain_de_proposito(models):
    hist = [_msg('user') for _ in range(models.HISTORY_CEILING_MENSAGENS + 10)]
    input_list, resp_id = models.preparar_input_turno(hist, 'resp_anterior')
    assert resp_id is None  # chain quebrado de propósito, mesmo tendo vindo um válido
    assert len(input_list) == models.HISTORY_CEILING_MENSAGENS


# ── criar_resposta_com_reparo_orfao (fake client, sem rede) ─────────────

class _FakeBadRequestError(Exception):
    """Stand-in leve pro BadRequestError real do SDK — só precisa suportar
    str(e) igual ao erro de verdade, que é tudo que extrair_call_id_orfao usa."""
    def __init__(self, mensagem):
        super().__init__(mensagem)
        self._mensagem = mensagem

    def __str__(self):
        return self._mensagem


class _FakeClientReparo:
    """Simula: a 1a chamada falha com 'No tool output found' para call_x; a
    2a (já com o output sintético injetado) sucede. Grava as tentativas para
    o teste inspecionar exatamente o que foi enviado em cada uma."""
    def __init__(self, call_id_orfao='call_x', falhas_antes_de_suceder=1):
        self.tentativas = []
        self._call_id_orfao = call_id_orfao
        self._falhas_restantes = falhas_antes_de_suceder
        self.responses = self

    def create(self, **kwargs):
        self.tentativas.append(kwargs)
        if self._falhas_restantes > 0:
            self._falhas_restantes -= 1
            raise _FakeBadRequestError(
                f"Error code: 400 - {{'error': {{'message': 'No tool output found for function call {self._call_id_orfao}.'}}}}"
            )
        return {'ok': True, 'ultimo_input': kwargs.get('input')}


def test_reparo_orfao_injeta_output_sintetico_e_tenta_de_novo(models, monkeypatch):
    monkeypatch.setattr(models, 'BadRequestError', _FakeBadRequestError)
    client = _FakeClientReparo(call_id_orfao='call_x', falhas_antes_de_suceder=1)
    resultado = models.criar_resposta_com_reparo_orfao(client, {'input': [{'type': 'function_call_output', 'call_id': 'call_outro', 'output': '{}'}]})
    assert len(client.tentativas) == 2
    # A 2a tentativa preserva o que já estava no input e ACRESCENTA o output sintético.
    input_2a_tentativa = client.tentativas[1]['input']
    assert len(input_2a_tentativa) == 2
    assert input_2a_tentativa[0]['call_id'] == 'call_outro'
    assert input_2a_tentativa[1]['call_id'] == 'call_x'
    assert 'erro' in json.loads(input_2a_tentativa[1]['output'])
    assert resultado['ok'] is True


def test_reparo_orfao_propaga_erro_que_nao_e_orfa(models, monkeypatch):
    monkeypatch.setattr(models, 'BadRequestError', _FakeBadRequestError)

    class _ClienteErroDiferente:
        responses = None
        def __init__(self):
            self.responses = self
        def create(self, **kwargs):
            raise _FakeBadRequestError("Error code: 400 - some unrelated validation error")

    with pytest.raises(_FakeBadRequestError, match='unrelated validation error'):
        models.criar_resposta_com_reparo_orfao(_ClienteErroDiferente(), {'input': []})


def test_reparo_orfao_esgota_tentativas_e_propaga(models, monkeypatch):
    monkeypatch.setattr(models, 'BadRequestError', _FakeBadRequestError)
    client = _FakeClientReparo(call_id_orfao='call_x', falhas_antes_de_suceder=99)
    with pytest.raises(_FakeBadRequestError):
        models.criar_resposta_com_reparo_orfao(client, {'input': []}, max_tentativas=2)
    assert len(client.tentativas) == 2
