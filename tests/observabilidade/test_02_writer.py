"""
_persistir_rag_trace is the synchronous core of registrar_rag_trace's background
thread (R2 extraction) — this is what actually turns a trace_dict into a row.
avaliar_groundedness/avaliar_judge are monkeypatched to fixed values so this
tier never touches the network; test_03_eval covers their own internals.
"""
import pytest


def test_persists_row_with_correct_aggregates(app, db, models, monkeypatch):
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: 0.5)
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: {
        'faithfulness': 0.9, 'answer_relevancy': 0.8, 'context_relevancy': 0.7,
    })

    chunks = [
        {'file_id': 'f1', 'filename': 'a.pdf', 'score': 0.9, 'quote': 'x'},
        {'file_id': 'f2', 'filename': 'b.pdf', 'score': 0.7, 'quote': 'y'},
        {'file_id': 'f3', 'filename': 'c.pdf', 'score': 0.5, 'quote': 'z'},
        {'file_id': 'f4', 'filename': 'd.pdf', 'score': 0.3, 'quote': 'w'},
        {'file_id': 'f5', 'filename': 'e.pdf', 'score': 0.1, 'quote': 'v'},
    ]
    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv1', 'response_id': 'resp1', 'modelo': 'gpt-test',
        'pergunta': 'qual a política de reembolso?', 'resposta': 'até 30 dias',
        'usou_file_search': True, 'retrieval_query': 'reembolso', 'chunks': chunks,
        'n_file_citations': 2, 'latencia_ms': 1234, 'tokens_in': 100, 'tokens_out': 50,
    }

    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row is not None
        assert row.retrieval_count == 5
        assert row.top_score == 0.9
        assert row.mean_score == pytest.approx(0.5)
        assert row.zero_retrieval is False
        assert row.citation_coverage is True
        assert row.n_file_citations == 2
        assert row.latencia_ms == 1234
        # groundedness=0.5 < 0.75 deterministically trips _deve_julgar, so the
        # judge fields must have been filled in from the mocked avaliar_judge.
        assert row.groundedness == 0.5
        assert row.eval_flagged is True
        assert row.eval_faithfulness == 0.9
        assert row.eval_answer_rel == 0.8
        assert row.eval_context_rel == 0.7


def test_zero_retrieval_when_file_search_ran_but_empty(app, db, models, monkeypatch):
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: None)
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: None)

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv2', 'response_id': 'resp2', 'modelo': 'gpt-test',
        'pergunta': 'pergunta sem cobertura', 'resposta': 'não encontrei nada sobre isso',
        'usou_file_search': True, 'retrieval_query': 'assunto obscuro', 'chunks': [],
        'n_file_citations': 0, 'latencia_ms': 500, 'tokens_in': 20, 'tokens_out': 10,
    }

    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.retrieval_count == 0
        assert row.top_score is None
        assert row.mean_score is None
        assert row.zero_retrieval is True
        assert row.citation_coverage is False
        # zero_retrieval is one of _deve_julgar's deterministic triggers.
        assert row.eval_flagged is True


def test_not_flagged_when_no_file_search_at_all(app, db, models, monkeypatch):
    """A plain chat turn (no retrieval attempted) shouldn't be zero_retrieval —
    that flag is specifically for 'we tried and got nothing back'."""
    monkeypatch.setattr(models, 'avaliar_groundedness', lambda client, resposta, chunks: None)
    monkeypatch.setattr(models, 'avaliar_judge', lambda client, pergunta, resposta, chunks: None)

    trace_dict = {
        'usuario_id': None, 'conv_id': 'conv3', 'response_id': 'resp3', 'modelo': 'gpt-test',
        'pergunta': 'oi', 'resposta': 'olá!', 'usou_file_search': False,
        'retrieval_query': None, 'chunks': [], 'n_file_citations': 0,
        'latencia_ms': 100, 'tokens_in': 5, 'tokens_out': 5,
    }

    with app.app_context():
        row_id = models._persistir_rag_trace(trace_dict)
        row = db.session.get(models.AtlasRAGTrace, row_id)
        assert row.zero_retrieval is False
