"""
Escopo de conhecimento do Atlas — política (atlas_kb.escopo_para) e adaptador
(atlas_kb.ferramenta_file_search), mais a ponte com o banco em app.py.

Estes testes existem porque a segregação COMUM/RESTRITA é uma decisão de
autorização, e autorização testada por julgamento não é testada. Tudo aqui é
asserção mecânica sobre valores de retorno — sem LLM, sem rede, sem Postgres
para a maior parte.

O teste mais importante do arquivo é test_adaptador_nunca_devolve_tool_so_restrita:
ele afirma o invariante estrutural do desenho (a omissão só pode tirar acesso,
nunca dar) em vez de conferir caso a caso.
"""
import json

import pytest

import atlas_kb


COMUM_FAKE    = 'vs_comum_teste'
RESTRITA_FAKE = 'vs_restrita_teste'


@pytest.fixture
def stores(monkeypatch):
    """Configura as duas bases. Devolve um callable para reconfigurar."""
    def _set(comum=COMUM_FAKE, restrita=RESTRITA_FAKE):
        for nome, valor in (('ATLAS_VECTOR_STORE_COMUM_ID', comum),
                            ('ATLAS_VECTOR_STORE_RESTRITA_ID', restrita),
                            ('OPENAI_VECTOR_STORE_ID', '')):
            if valor:
                monkeypatch.setenv(nome, valor)
            else:
                monkeypatch.delenv(nome, raising=False)
    _set()
    return _set


# ── Política: escopo_para ────────────────────────────────────────────────────

def test_operacional_sem_concessao_fica_na_base_comum():
    assert atlas_kb.escopo_para('operacional', {}).bases == ('comum',)


def test_flag_false_nao_concede():
    assert atlas_kb.escopo_para('analista', {'base_restrita': False}).bases == ('comum',)


def test_flag_true_concede_as_duas_na_ordem():
    escopo = atlas_kb.escopo_para('analista', {'base_restrita': True})
    assert escopo.bases == ('comum', 'restrita')


def test_admin_tem_restrita_mesmo_sem_linha_de_permissao():
    """Bypass de admin, coerente com _verificar_permissao_modulo. Admin nunca
    depende da linha de Permissao — inclusive porque GET /me/permissoes devolve
    o padrão hardcoded sem tocar no banco."""
    assert atlas_kb.escopo_para('admin', None).bases == ('comum', 'restrita')


def test_sem_usuario_nenhum_cai_na_base_comum():
    """responder_atlas roda com usuario_id=None (golden set). Escopo tem de ser
    o comum: se fosse o restrito, o judge mediria faithfulness sobre um escopo
    que nenhum usuário real possui."""
    assert atlas_kb.escopo_para(None, None).bases == ('comum',)


@pytest.mark.parametrize('valor', ['false', 'true', 1, 'sim', [], {}, None, 0])
def test_apenas_o_booleano_verdadeiro_concede(valor):
    """A armadilha da string truthy: 'false' vindo de um atlas_json corrompido
    ou escrito à mão é truthy em Python. Só `is True` concede."""
    escopo = atlas_kb.escopo_para('operacional', {'base_restrita': valor})
    assert escopo.bases == ('comum',), f'{valor!r} não pode conceder base restrita'


@pytest.mark.parametrize('permissoes', [None, {}, [], 'restrita', 42])
def test_permissao_de_tipo_inesperado_nao_concede(permissoes):
    assert atlas_kb.escopo_para('operacional', permissoes).bases == ('comum',)


def test_escopo_e_imutavel():
    """Frozen de propósito: um escopo já decidido não pode ser ampliado por um
    call site depois da política ter rodado."""
    escopo = atlas_kb.escopo_para('operacional', {})
    with pytest.raises(Exception):
        escopo.bases = ('comum', 'restrita')


def test_rotulo():
    assert atlas_kb.escopo_para('operacional', {}).rotulo() == 'comum'
    assert atlas_kb.escopo_para('admin', None).rotulo() == 'comum+restrita'


# ── Adaptador: ferramenta_file_search ───────────────────────────────────────

def test_adaptador_traduz_escopo_completo(stores):
    tool, bases = atlas_kb.ferramenta_file_search(atlas_kb.escopo_para('admin', None))
    assert tool == {'type': 'file_search',
                    'vector_store_ids': [COMUM_FAKE, RESTRITA_FAKE]}
    assert bases == ['comum', 'restrita']


def test_adaptador_traduz_escopo_comum(stores):
    tool, bases = atlas_kb.ferramenta_file_search(atlas_kb.escopo_para('operacional', {}))
    assert tool['vector_store_ids'] == [COMUM_FAKE]
    assert bases == ['comum']


def test_restrita_nao_configurada_degrada_para_comum(stores):
    """Concessão sem store configurada não é erro e não derruba o chat — o
    usuário degrada para a base comum. E `bases` reflete o que foi ANEXADO,
    não o que a política concedeu, que é o que torna a degradação visível no
    dashboard em vez de silenciosa."""
    stores(restrita='')
    tool, bases = atlas_kb.ferramenta_file_search(atlas_kb.escopo_para('admin', None))
    assert tool['vector_store_ids'] == [COMUM_FAKE]
    assert bases == ['comum']


def test_nenhuma_store_configurada_nao_anexa_tool(stores):
    """Comportamento idêntico ao de antes da segregação, quando
    OPENAI_VECTOR_STORE_ID estava vazia: responde sem file_search."""
    stores(comum='', restrita='')
    assert atlas_kb.ferramenta_file_search(atlas_kb.escopo_para('admin', None)) == (None, [])


def test_fallback_para_o_nome_legado_da_env(monkeypatch):
    """Enquanto ATLAS_VECTOR_STORE_COMUM_ID não for setada em produção, a base
    comum continua apontando para a store única de sempre — é o que faz o
    commit do ponto de estrangulamento não mudar o retrieval de ninguém."""
    monkeypatch.delenv('ATLAS_VECTOR_STORE_COMUM_ID', raising=False)
    monkeypatch.delenv('ATLAS_VECTOR_STORE_RESTRITA_ID', raising=False)
    monkeypatch.setenv('OPENAI_VECTOR_STORE_ID', 'vs_legado')
    tool, bases = atlas_kb.ferramenta_file_search(atlas_kb.escopo_para('operacional', {}))
    assert tool['vector_store_ids'] == ['vs_legado']
    assert bases == ['comum']


def test_ids_duplicados_nao_sao_enviados_duas_vezes(stores):
    """Se as duas vars apontarem para a mesma store por erro de .env, a API
    rejeitaria o array duplicado e derrubaria o chat inteiro."""
    stores(comum=COMUM_FAKE, restrita=COMUM_FAKE)
    tool, bases = atlas_kb.ferramenta_file_search(atlas_kb.escopo_para('admin', None))
    assert tool['vector_store_ids'] == [COMUM_FAKE]
    assert bases == ['comum']


def test_nunca_passa_do_teto_de_dois_stores(stores):
    """A Responses API recusa 3+ com 400 (ver
    scripts/probe_file_search_multistore.py). O desenho tem de ser
    estruturalmente incapaz de chegar lá."""
    for perfil, perm in [('admin', None), ('operacional', {'base_restrita': True}),
                         ('operacional', {}), (None, None)]:
        tool, _ = atlas_kb.ferramenta_file_search(atlas_kb.escopo_para(perfil, perm))
        if tool:
            assert len(tool['vector_store_ids']) <= 2


def test_adaptador_nunca_devolve_tool_so_restrita(stores):
    """INVARIANTE do desenho fail-closed, asserido sobre TODAS as combinações
    de política e configuração em vez de caso a caso: o adaptador ou devolve
    None, ou devolve uma tool que inclui a base comum. Nunca uma tool que
    alcance apenas a base restrita.

    Se este teste cair, a segregação virou fail-open em algum caminho."""
    combinacoes_de_politica = [
        ('admin', None), ('admin', {}), ('operacional', {}),
        ('operacional', {'base_restrita': True}),
        ('analista', {'base_restrita': False}), (None, None),
    ]
    configuracoes = [
        (COMUM_FAKE, RESTRITA_FAKE), (COMUM_FAKE, ''), ('', RESTRITA_FAKE), ('', ''),
    ]
    for comum, restrita in configuracoes:
        stores(comum=comum, restrita=restrita)
        for perfil, perm in combinacoes_de_politica:
            escopo = atlas_kb.escopo_para(perfil, perm)
            tool, bases = atlas_kb.ferramenta_file_search(escopo)
            if tool is None:
                assert bases == []
                continue
            assert 'comum' in bases, (
                f'tool sem a base comum: perfil={perfil} perm={perm} '
                f'config=({comum!r}, {restrita!r}) bases={bases}'
            )
            assert tool['vector_store_ids'][0] == comum


# ── Ponte com o banco: escopo_conhecimento_do_usuario ────────────────────────

def test_ponte_sem_usuario_e_base_comum(models):
    assert models.escopo_conhecimento_do_usuario(None).bases == ('comum',)


def test_ponte_sem_linha_de_permissao_fica_no_comum(app, models, make_user):
    """Usuário sem linha de Permissao (cadastro nunca aprovado) não pode herdar
    acesso restrito por omissão."""
    uid = make_user(perfil='operacional')
    with app.app_context():
        assert models.escopo_conhecimento_do_usuario(models.User.query.get(uid)).bases == ('comum',)


def test_ponte_tolera_ausencia_da_coluna_atlas_json(models):
    """O ponto de estrangulamento entra em produção um commit ANTES da migração
    que cria Permissao.atlas_json. Nesse intervalo a leitura tem de devolver
    "sem concessão" em vez de estourar AttributeError e derrubar o chat.

    (Os testes de concessão via linha do banco vivem logo abaixo, a partir do
    commit que cria a coluna.)"""
    class _PermSemColuna:
        hub_json = '[]'
        modulos_json = '[]'

    assert models._atlas_permissoes(_PermSemColuna()) == {}
    assert models._atlas_permissoes(None) == {}


@pytest.mark.parametrize('bruto', ['{isso nao e json', '', 'null', '[]', '"texto"', '42'])
def test_atlas_json_invalido_nunca_concede(models, bruto):
    """Qualquer dúvida sobre o conteúdo da coluna vira ausência de concessão."""
    class _Perm:
        atlas_json = bruto

    assert models._atlas_permissoes(_Perm()) == {}


# ── responder_atlas: o escopo default do helper de avaliação ────────────────

def test_responder_atlas_sem_usuario_usa_apenas_a_base_comum(models, monkeypatch, stores):
    """Regra 10 do plano, asserida no ponto onde ela pode quebrar: o helper de
    avaliação não pode recuperar da base restrita nem por acidente, senão a
    regressão do golden set mede um escopo inexistente em produção."""
    capturado = {}

    class _RespFake:
        output = []

    class _ResponsesFake:
        def create(self, **kwargs):
            capturado.update(kwargs)
            return _RespFake()

    class _ClientFake:
        responses = _ResponsesFake()

    monkeypatch.setattr(models, 'OpenAI', lambda **_kw: _ClientFake())
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-fake-para-teste')

    models.responder_atlas('pergunta qualquer')

    tools_fs = [t for t in capturado['tools'] if t.get('type') == 'file_search']
    assert len(tools_fs) == 1
    assert tools_fs[0]['vector_store_ids'] == [COMUM_FAKE]
