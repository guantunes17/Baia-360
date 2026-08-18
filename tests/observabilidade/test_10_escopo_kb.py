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


def test_ponte_le_a_linha_viva_e_nao_o_perfil(app, db, models, make_user):
    """O enforcement lê Permissao, não a string `perfil` (COUPLING_MAP §5): um
    'operacional' com a flag concedida alcança a base restrita, e um 'analista'
    sem ela não alcança. Se algum dia alguém derivar acesso do perfil, este
    teste cai."""
    uid_concedido = make_user(perfil='operacional')
    uid_negado    = make_user(perfil='analista')
    with app.app_context():
        db.session.add(models.Permissao(
            usuario_id=uid_concedido, hub_json='[]', modulos_json='[]',
            atlas_json=json.dumps({'base_restrita': True})))
        db.session.add(models.Permissao(
            usuario_id=uid_negado, hub_json='[]', modulos_json='[]',
            atlas_json=json.dumps({'base_restrita': False})))
        db.session.commit()

        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(uid_concedido)).bases == ('comum', 'restrita')
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(uid_negado)).bases == ('comum',)


def test_ponte_com_atlas_json_corrompido_no_banco_fica_no_comum(app, db, models, make_user):
    uid = make_user(perfil='operacional')
    with app.app_context():
        db.session.add(models.Permissao(usuario_id=uid, hub_json='[]',
                                        modulos_json='[]', atlas_json='{isso nao e json'))
        db.session.commit()
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(uid)).bases == ('comum',)


# ── PUT /api/auth/usuarios/<id>/permissoes ──────────────────────────────────

def test_put_grava_a_concessao_e_o_escopo_passa_a_incluir_restrita(
        app, db, models, make_user, make_client):
    admin_id = make_user(perfil='admin')
    alvo_id  = make_user(perfil='operacional')

    resp = make_client(admin_id).put(
        f'/api/auth/usuarios/{alvo_id}/permissoes',
        json={'hub': [], 'modulos': [], 'atlas': {'base_restrita': True}})
    assert resp.status_code == 200

    with app.app_context():
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(alvo_id)).bases == ('comum', 'restrita')


@pytest.mark.parametrize('enviado', ['true', 1, 'sim', [1], {'x': 1}])
def test_put_coage_valores_nao_booleanos_para_false(
        app, db, models, make_user, make_client, enviado):
    """O que chega do cliente nunca é persistido cru: só `is True` vira True.
    Sem isso, a string 'true' ficaria gravada e o enforcement teria de
    reinterpretá-la — e `escopo_para` a rejeitaria, deixando a tela mostrando
    uma concessão que não concede nada."""
    admin_id = make_user(perfil='admin')
    alvo_id  = make_user(perfil='operacional')

    make_client(admin_id).put(f'/api/auth/usuarios/{alvo_id}/permissoes',
                              json={'hub': [], 'modulos': [],
                                    'atlas': {'base_restrita': enviado}})

    with app.app_context():
        perm = models.Permissao.query.filter_by(usuario_id=alvo_id).first()
        assert json.loads(perm.atlas_json) == {'base_restrita': False}


def test_put_descarta_chaves_nao_concediveis(app, db, models, make_user, make_client):
    """Mesmo tratamento que hub/modulos: filtra em silêncio em vez de 400."""
    admin_id = make_user(perfil='admin')
    alvo_id  = make_user(perfil='operacional')

    make_client(admin_id).put(f'/api/auth/usuarios/{alvo_id}/permissoes',
                              json={'hub': [], 'modulos': [],
                                    'atlas': {'base_restrita': True, 'inventada': True}})

    with app.app_context():
        perm = models.Permissao.query.filter_by(usuario_id=alvo_id).first()
        assert json.loads(perm.atlas_json) == {'base_restrita': True}


def test_put_sem_a_chave_atlas_revoga(app, db, models, make_user, make_client):
    """Toda chave concedível é sempre gravada, então um PUT que omite 'atlas'
    grava False em vez de deixar a concessão anterior. É o mesmo
    comportamento-overwrite de hub/modulos, e erra para o lado seguro."""
    admin_id = make_user(perfil='admin')
    alvo_id  = make_user(perfil='operacional')
    cliente  = make_client(admin_id)

    cliente.put(f'/api/auth/usuarios/{alvo_id}/permissoes',
                json={'hub': [], 'modulos': [], 'atlas': {'base_restrita': True}})
    cliente.put(f'/api/auth/usuarios/{alvo_id}/permissoes',
                json={'hub': [], 'modulos': []})

    with app.app_context():
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(alvo_id)).bases == ('comum',)


def test_nao_admin_nao_concede_a_si_mesmo(app, models, make_user, make_client):
    alvo_id = make_user(perfil='operacional')
    resp = make_client(alvo_id).put(
        f'/api/auth/usuarios/{alvo_id}/permissoes',
        json={'hub': [], 'modulos': [], 'atlas': {'base_restrita': True}})
    assert resp.status_code == 403
    with app.app_context():
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(alvo_id)).bases == ('comum',)


# ── Semeadura por perfil ────────────────────────────────────────────────────

def test_nenhum_perfil_alem_de_admin_semeia_base_restrita(models):
    """O perfil semeia o default, a flag governa o acesso. 'operacional' é o
    default de todo cadastro novo e costuma significar apenas "ainda não
    classificado" — herdar acesso regulatório daí seria conceder por inércia."""
    for perfil, padrao in models.PERMISSOES_PADRAO.items():
        concedido = padrao.get('atlas', {}).get('base_restrita', False)
        assert concedido == (perfil == 'admin'), f'perfil {perfil}'


def test_criar_para_grava_o_padrao_do_perfil(app, models):
    with app.app_context():
        assert json.loads(models.Permissao.criar_para(1, 'operacional').atlas_json) == {'base_restrita': False}
        assert json.loads(models.Permissao.criar_para(2, 'admin').atlas_json) == {'base_restrita': True}


def test_aprovacao_reseta_a_concessao_para_o_padrao_do_perfil(
        app, db, models, make_user, make_client):
    """Documenta um comportamento com dente: reaprovar um usuário já ativo
    REVOGA uma concessão manual. É o que hub/modulos já faziam (COUPLING_MAP §7
    item 10) e, para acesso a material regulatório, revogar por engano é o lado
    seguro de errar — mas tem de estar coberto, não descoberto por acidente."""
    admin_id = make_user(perfil='admin')
    alvo_id  = make_user(perfil='operacional')
    cliente  = make_client(admin_id)

    cliente.put(f'/api/auth/usuarios/{alvo_id}/permissoes',
                json={'hub': [], 'modulos': [], 'atlas': {'base_restrita': True}})
    with app.app_context():
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(alvo_id)).bases == ('comum', 'restrita')

    resp = cliente.post(f'/api/auth/usuarios/{alvo_id}/aprovar',
                        json={'perfil': 'operacional'})
    assert resp.status_code == 200

    with app.app_context():
        assert models.escopo_conhecimento_do_usuario(
            models.User.query.get(alvo_id)).bases == ('comum',)


def test_to_dict_expoe_atlas(app, models):
    with app.app_context():
        assert models.Permissao.criar_para(1, 'admin').to_dict()['atlas'] == {'base_restrita': True}


# ── Escopo gravado no trace ─────────────────────────────────────────────────

def _trace_base(**extra):
    base = {
        'usuario_id': None, 'conv_id': 'c1', 'response_id': 'r1',
        'modelo': 'gpt-5.4-mini', 'pergunta': 'p', 'resposta': 'r',
        'usou_file_search': False, 'retrieval_query': None, 'chunks': [],
        'n_file_citations': 0, 'tools_usadas': [],
    }
    base.update(extra)
    return base


def test_escopo_ausente_no_trace_dict_grava_null(app, db, models):
    """Chave ausente = escopo não capturado. Tem de virar NULL, não '[]' —
    senão uma linha onde nada foi medido leria como medição de "sem base"."""
    with app.app_context():
        row_id = models._persistir_rag_trace(_trace_base())
        assert models.AtlasRAGTrace.query.get(row_id).escopo_kb is None


def test_escopo_vazio_grava_lista_vazia(app, db, models):
    """[] é uma afirmação positiva: escopo capturado, nenhum store
    configurado. Distinto de NULL."""
    with app.app_context():
        row_id = models._persistir_rag_trace(_trace_base(escopo_kb=[]))
        assert models.AtlasRAGTrace.query.get(row_id).escopo_kb == '[]'


@pytest.mark.parametrize('bases', [['comum'], ['comum', 'restrita']])
def test_escopo_grava_as_bases_efetivas(app, db, models, bases):
    with app.app_context():
        row_id = models._persistir_rag_trace(_trace_base(escopo_kb=bases))
        assert json.loads(models.AtlasRAGTrace.query.get(row_id).escopo_kb) == bases


def test_dashboard_segmenta_por_escopo_e_soma_o_total(app, db, models, make_user, make_client):
    """NULL não pode virar 'comum' na leitura: seria inventar um escopo que
    ninguém mediu, a mesma fabricação de certeza que o reprocessamento de
    2026-07-16 corrigiu na escrita."""
    admin_id = make_user(perfil='admin')
    with app.app_context():
        models._persistir_rag_trace(_trace_base())                                # NULL
        models._persistir_rag_trace(_trace_base(escopo_kb=[]))                    # sem_base
        models._persistir_rag_trace(_trace_base(escopo_kb=['comum']))
        models._persistir_rag_trace(_trace_base(escopo_kb=['comum']))
        models._persistir_rag_trace(_trace_base(escopo_kb=['comum', 'restrita']))

    resp = make_client(admin_id).get('/api/atlas/observabilidade?dias=30')
    assert resp.status_code == 200
    dados = resp.get_json()

    assert dados['escopos'] == {
        'comum': 2, 'comum+restrita': 1, 'sem_base': 1, 'legacy_unknown': 1,
    }
    assert sum(dados['escopos'].values()) == dados['total']


def test_dashboard_distingue_zero_retrieval_por_escopo(app, db, models, make_user, make_client):
    """O ponto inteiro da coluna: um zero_retrieval no escopo comum pode ser
    "o documento existe, mas fora do seu escopo"; no escopo ampliado, é "o
    documento não foi encontrado". A métrica global não separa os dois."""
    admin_id = make_user(perfil='admin')
    with app.app_context():
        # comum: 2 turnos com file_search, 1 deles sem chunk algum.
        models._persistir_rag_trace(_trace_base(escopo_kb=['comum'], usou_file_search=True,
                                                chunks=[{'file_id': 'f', 'score': 0.5}]))
        models._persistir_rag_trace(_trace_base(escopo_kb=['comum'], usou_file_search=True))
        # comum+restrita: 1 turno, recuperou.
        models._persistir_rag_trace(_trace_base(escopo_kb=['comum', 'restrita'],
                                                usou_file_search=True,
                                                chunks=[{'file_id': 'g', 'score': 0.9}]))

    dados = make_client(admin_id).get('/api/atlas/observabilidade?dias=30').get_json()
    por_escopo = dados['zero_retrieval_por_escopo']

    assert por_escopo['comum'] == {'rate': 0.5, 'com_fs': 2}
    assert por_escopo['comum+restrita'] == {'rate': 0.0, 'com_fs': 1}


def test_dashboard_sem_traces_nao_divide_por_zero(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='admin')
    dados = make_client(admin_id).get('/api/atlas/observabilidade?dias=30').get_json()
    assert dados['escopos'] == {'comum': 0, 'comum+restrita': 0, 'sem_base': 0, 'legacy_unknown': 0}
    assert dados['zero_retrieval_por_escopo']['comum'] == {'rate': None, 'com_fs': 0}


def test_escopo_corrompido_no_banco_cai_em_legacy(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='admin')
    with app.app_context():
        row_id = models._persistir_rag_trace(_trace_base(escopo_kb=['comum']))
        row = models.AtlasRAGTrace.query.get(row_id)
        row.escopo_kb = '{nao e json'
        db.session.commit()

    dados = make_client(admin_id).get('/api/atlas/observabilidade?dias=30').get_json()
    assert dados['escopos']['legacy_unknown'] == 1
    assert dados['escopos']['comum'] == 0


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
