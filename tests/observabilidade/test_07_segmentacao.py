"""
Provenance segmentation (Prompt 1 of the 2026-07-16 observability plan):
derivar_segmento_rag, extrair_tools_do_turno, and the judge-skip behaviour
they drive inside _persistir_rag_trace. See test_02_writer.py for the
pre-existing writer aggregate tests (updated there for the eval_flagged
redefinition) — this file is scoped to what's new: segmentation, provenance
plumbing, and the judge no longer running on turns where it would be
comparing the answer to a context it didn't actually draw from.
"""
import pytest


# ── derivar_segmento_rag ─────────────────────────────────────────────────

def test_segmento_rag_only_when_file_search_and_no_tool(models):
    assert models.derivar_segmento_rag(True, [], 3) == 'rag_only'


def test_segmento_no_retrieval_when_neither(models):
    assert models.derivar_segmento_rag(False, [], 0) == 'no_retrieval'


def test_segmento_tool_only_when_tool_ran_and_no_citations(models):
    assert models.derivar_segmento_rag(False, ['get_dashboard'], 0) == 'tool_only'
    # Also tool_only when file_search fired too, but nothing from it was cited.
    assert models.derivar_segmento_rag(True, ['get_dashboard'], 0) == 'tool_only'


def test_segmento_hybrid_when_tool_ran_and_something_cited(models):
    assert models.derivar_segmento_rag(True, ['get_dashboard'], 2) == 'hybrid'
    # Trace #15 from the investigation: get_dashboard + file_search, 2 citations.


def test_segmento_legacy_unknown_when_tools_usadas_is_none(models):
    """Regression test for a real bug caught in code review: tools_usadas=None
    (provenance never captured — pre-2026-07-16 rows) must NOT collapse into
    'rag_only'/'no_retrieval' just because None is falsy like []. '[]' is a
    positive claim ("we know no tool ran"); None means "we don't know". A row
    with file_search=True and unknown tool provenance is NOT verified RAG-only
    — it must land in its own segment, regardless of usou_file_search/n_file_citations."""
    assert models.derivar_segmento_rag(True, None, 3) == 'legacy_unknown'
    assert models.derivar_segmento_rag(False, None, 0) == 'legacy_unknown'


# ── extrair_tools_do_turno ────────────────────────────────────────────────

def test_extrai_tool_do_turno_atual(models):
    hist = [
        {'role': 'user', 'parts': [{'text': 'quais os KPIs deste mês?'}]},
        {'role': 'model', 'parts': [{'functionCall': {'call_id': 'c1', 'name': 'get_dashboard', 'args': {}}}]},
        {'role': 'user', 'parts': [{'functionResponse': {'call_id': 'c1', 'name': 'get_dashboard',
                                                           'response': {'result': {}}}}]},
    ]
    assert models.extrair_tools_do_turno(hist) == ['get_dashboard']


def test_nao_vaza_tool_de_turno_anterior(models):
    """A tool call from an OLDER turn (before the latest real user text) must
    not leak into the current turn's provenance — history accumulates the
    whole conversation, not just this exchange."""
    hist = [
        {'role': 'user', 'parts': [{'text': 'primeira pergunta'}]},
        {'role': 'model', 'parts': [{'functionCall': {'call_id': 'old', 'name': 'buscar_email', 'args': {}}}]},
        {'role': 'user', 'parts': [{'functionResponse': {'call_id': 'old', 'name': 'buscar_email',
                                                           'response': {'result': {}}}}]},
        {'role': 'model', 'parts': [{'text': 'resposta da primeira pergunta'}]},
        {'role': 'user', 'parts': [{'text': 'segunda pergunta, sem tools'}]},
    ]
    assert models.extrair_tools_do_turno(hist) == []


def test_extrai_multiplas_tools_do_turno_em_ordem(models):
    hist = [
        {'role': 'user', 'parts': [{'text': 'pergunta'}]},
        {'role': 'model', 'parts': [
            {'functionCall': {'call_id': 'c1', 'name': 'buscar_email', 'args': {}}},
            {'functionCall': {'call_id': 'c2', 'name': 'get_dashboard', 'args': {}}},
        ]},
    ]
    assert models.extrair_tools_do_turno(hist) == ['buscar_email', 'get_dashboard']


def test_extrai_tools_sem_texto_de_usuario_no_historico(models):
    """No real user text message at all (edge case) — collects whatever
    functionCall parts exist without crashing."""
    hist = [{'role': 'model', 'parts': [{'functionCall': {'call_id': 'c1', 'name': 'get_dashboard', 'args': {}}}]}]
    assert models.extrair_tools_do_turno(hist) == ['get_dashboard']


def test_extrai_tools_historico_vazio(models):
    assert models.extrair_tools_do_turno([]) == []


# ── Judge skip: tool_only / hybrid never touch groundedness/judge ────────

class _BoomIfCalled:
    """Stands in for the OpenAI-calling functions — raises if invoked, so a
    test proves the judge/groundedness path was never entered, not just that
    its output was discarded."""
    def __call__(self, *a, **kw):
        raise AssertionError('should not have been called — segment must skip Tier 2/3 entirely')


def test_tool_only_skips_judge_and_groundedness(app, db, models, monkeypatch):
    monkeypatch.setattr(models, 'avaliar_groundedness', _BoomIfCalled())
    monkeypatch.setattr(models, 'avaliar_judge', _BoomIfCalled())

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-tool', 'response_id': 'resp-tool', 'modelo': 'gpt-test',
        'pergunta': 'quais os KPIs de fretes deste mês?', 'resposta': 'Os KPIs são X, Y, Z.',
        'usou_file_search': False, 'retrieval_query': None, 'chunks': [],
        'n_file_citations': 0, 'tools_usadas': ['get_dashboard'],
        'latencia_ms': 100, 'tokens_in': 10, 'tokens_out': 10,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.groundedness is None
        assert row.eval_faithfulness is None
        assert row.eval_answer_rel is None
        assert row.eval_context_rel is None
        assert row.eval_flagged is None
        assert row.tools_usadas == '["get_dashboard"]'
        assert row.eval_versao == models.EVAL_PIPELINE_VERSION


def test_hybrid_skips_judge_and_groundedness(app, db, models, monkeypatch):
    """Trace #15's case: get_dashboard fired AND file_search cited real
    chunks. Scoring faithfulness against those chunks would read as
    'hallucinated' when the answer's substance came from the tool, not the
    retrieval — so this segment is NULL'd too, exactly like tool_only."""
    monkeypatch.setattr(models, 'avaliar_groundedness', _BoomIfCalled())
    monkeypatch.setattr(models, 'avaliar_judge', _BoomIfCalled())

    chunks = [{'file_id': 'f1', 'filename': 'sislog.pdf', 'score': 0.29, 'quote': 'fluxo de emissão'}]
    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-hybrid', 'response_id': 'resp-hybrid', 'modelo': 'gpt-test',
        'pergunta': 'quais os KPIs de fretes deste mês?',
        'resposta': 'Os KPIs são X. Os documentos descrevem o fluxo de emissão, mas não o painel mensal.',
        'usou_file_search': True, 'retrieval_query': 'fretes', 'chunks': chunks,
        'n_file_citations': 2, 'tools_usadas': ['get_dashboard'],
        'latencia_ms': 100, 'tokens_in': 10, 'tokens_out': 10,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        # Tier 0/1 raw retrieval telemetry is untouched — only Tier 2/3 skip.
        assert row.retrieval_count == 1
        assert row.top_score == pytest.approx(0.29)
        assert row.n_file_citations == 2
        assert row.citation_coverage is True
        assert row.groundedness is None
        assert row.eval_faithfulness is None
        assert row.eval_flagged is None
        assert row.tools_usadas == '["get_dashboard"]'


def test_rag_only_low_scores_still_judged_and_flagged(app, db, models, monkeypatch):
    """Acceptance criterion from the plan: a low-scoring RAG-only turn must
    still be judged (not suppressed by any score-based threshold — provenance
    is the only gate) and must still flag when the judge finds a real problem."""
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: 0.2)
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: {
        'faithfulness': 0.1, 'answer_relevancy': 0.2, 'context_relevancy': 0.3,
    })

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-bad', 'response_id': 'resp-bad', 'modelo': 'gpt-test',
        'pergunta': 'pergunta genuína de conhecimento', 'resposta': 'resposta ruim/alucinada',
        'usou_file_search': True, 'retrieval_query': 'assunto', 'chunks': [{'quote': 'contexto'}],
        'n_file_citations': 0, 'tools_usadas': [],
        'latencia_ms': 100, 'tokens_in': 10, 'tokens_out': 10,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.eval_faithfulness == 0.1
        assert row.eval_answer_rel == 0.2
        assert row.eval_flagged is True


def test_rag_only_good_scores_not_flagged_even_if_selected_for_judging(app, db, models, monkeypatch):
    """Guards against the exact bug this plan fixes: being selected for
    judging (_deve_julgar) must not by itself set eval_flagged — only a bad
    judge OUTPUT should."""
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: 0.2)  # triggers _deve_julgar
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: {
        'faithfulness': 1.0, 'answer_relevancy': 1.0, 'context_relevancy': 1.0,
    })

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-good', 'response_id': 'resp-good', 'modelo': 'gpt-test',
        'pergunta': 'pergunta', 'resposta': 'resposta correta', 'usou_file_search': True,
        'retrieval_query': 'assunto', 'chunks': [{'quote': 'contexto'}],
        'n_file_citations': 1, 'tools_usadas': [],
        'latencia_ms': 100, 'tokens_in': 10, 'tokens_out': 10,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.eval_flagged is False


def test_judge_failure_leaves_flagged_null_not_false(app, db, models, monkeypatch):
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: 0.2)  # triggers _deve_julgar
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: None)

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-fail', 'response_id': 'resp-fail', 'modelo': 'gpt-test',
        'pergunta': 'pergunta', 'resposta': 'resposta', 'usou_file_search': True,
        'retrieval_query': 'assunto', 'chunks': [{'quote': 'contexto'}],
        'n_file_citations': 1, 'tools_usadas': [],
        'latencia_ms': 100, 'tokens_in': 10, 'tokens_out': 10,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.eval_flagged is None


def test_no_tools_usadas_key_defaults_to_empty_list_not_none(app, db, models, monkeypatch):
    """A caller that doesn't pass 'tools_usadas' at all (shouldn't happen from
    the real SSE loop after this plan, but the writer must not crash or write
    NULL) still gets '[]', preserving the NULL-means-historical contract."""
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: None)
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: None)

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-none', 'response_id': 'resp-none', 'modelo': 'gpt-test',
        'pergunta': 'oi', 'resposta': 'olá', 'usou_file_search': False,
        'retrieval_query': None, 'chunks': [], 'n_file_citations': 0,
        'latencia_ms': 10, 'tokens_in': 1, 'tokens_out': 1,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.tools_usadas == '[]'
        assert row.eval_versao == models.EVAL_PIPELINE_VERSION


# ── Trace hygiene: falhou (2026-07-16 integrity plan, §4) ─────────────────

def test_falhou_true_skips_judge_and_groundedness(app, db, models, monkeypatch):
    """A turn that died mid-stream (e.g. the gurq9e4e rate-limit incident)
    has no coherent 'resposta' to judge — falhou=True must skip Tier 2/3
    exactly like tool_only/hybrid, and store the error message."""
    monkeypatch.setattr(models, 'avaliar_groundedness', _BoomIfCalled())
    monkeypatch.setattr(models, 'avaliar_judge', _BoomIfCalled())

    trace_dict = {
        'usuario_id': None, 'conv_id': 'gurq9e4e', 'response_id': None, 'modelo': 'gpt-test',
        'pergunta': 'agende uma reunião com o André', 'resposta': '',
        'usou_file_search': False, 'retrieval_query': None, 'chunks': [],
        'n_file_citations': 0, 'tools_usadas': ['buscar_emails'],
        'latencia_ms': 45000, 'tokens_in': None, 'tokens_out': None,
        'falhou': True, 'erro_mensagem': 'Rate limit reached for gpt-5.4-mini ... Please try again in 7.218s.',
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.falhou is True
        assert 'Rate limit reached' in row.erro_mensagem
        assert row.groundedness is None
        assert row.eval_faithfulness is None
        assert row.eval_flagged is None
        # Tier 0/1 provenance is still preserved even on failure — this is
        # the whole point: a failed turn is still worth knowing what it attempted.
        assert row.tools_usadas == '["buscar_emails"]'
        assert row.eval_versao == models.EVAL_PIPELINE_VERSION


def test_falhou_defaults_false_when_omitted(app, db, models, monkeypatch):
    """A normal (non-failure) trace_dict never sets 'falhou' — must default
    to False, not None. Every NEW row always has a definite falhou value;
    only rows written before this column existed are NULL."""
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: None)
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: None)

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv-ok', 'response_id': 'resp-ok', 'modelo': 'gpt-test',
        'pergunta': 'oi', 'resposta': 'olá', 'usou_file_search': False,
        'retrieval_query': None, 'chunks': [], 'n_file_citations': 0,
        'latencia_ms': 10, 'tokens_in': 1, 'tokens_out': 1,
    }
    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.falhou is False
        assert row.erro_mensagem is None
