"""
Tier 2 (_cosine, avaliar_groundedness) and Tier 3 (_deve_julgar, avaliar_judge)
evaluation logic. avaliar_groundedness/avaliar_judge take the OpenAI client as
a parameter, so they're tested here with a hand-built fake client object —
no monkeypatching of app.OpenAI needed (that safety net still applies via
conftest's autouse fixture, but these functions never touch it directly).
"""
import json
import random
from types import SimpleNamespace

import pytest


# ── _cosine ────────────────────────────────────────────────────────────────

def test_cosine_identical_vectors(models):
    assert models._cosine([1, 2, 3], [1, 2, 3]) == pytest.approx(1.0)


def test_cosine_orthogonal_vectors(models):
    assert models._cosine([1, 0], [0, 1]) == pytest.approx(0.0)


def test_cosine_zero_vector_returns_none(models):
    assert models._cosine([0, 0, 0], [1, 2, 3]) is None


def test_cosine_opposite_vectors(models):
    assert models._cosine([1, 0], [-1, 0]) == pytest.approx(-1.0)


# ── _deve_julgar ──────────────────────────────────────────────────────────

class _FakeTrace:
    def __init__(self, feedback=None, usou_file_search=False, retrieval_count=1,
                 top_score=0.8, groundedness=0.9):
        self.feedback = feedback
        self.usou_file_search = usou_file_search
        self.retrieval_count = retrieval_count
        self.top_score = top_score
        self.groundedness = groundedness


def test_deve_julgar_flags_on_thumbs_down(models):
    t = _FakeTrace(feedback='down')
    assert models._deve_julgar(t, amostra_pct=0) is True


def test_deve_julgar_flags_on_zero_retrieval(models):
    t = _FakeTrace(usou_file_search=True, retrieval_count=0)
    assert models._deve_julgar(t, amostra_pct=0) is True


def test_deve_julgar_flags_on_low_top_score(models):
    t = _FakeTrace(top_score=0.2)
    assert models._deve_julgar(t, amostra_pct=0) is True


def test_deve_julgar_flags_on_low_groundedness(models):
    t = _FakeTrace(groundedness=0.5)
    assert models._deve_julgar(t, amostra_pct=0) is True


def test_deve_julgar_clean_trace_not_flagged_when_sample_excludes_it(models, monkeypatch):
    """A clean trace (no deterministic trigger) should only be flagged via the
    random sample — force the sample path deterministically both ways.
    _deve_julgar does `import random` locally rather than at module scope, but
    that import still resolves to the one shared `random` module object in
    sys.modules, so patching it here reaches the function's local import too."""
    t = _FakeTrace()
    monkeypatch.setattr(random, 'randint', lambda a, b: 99)
    assert models._deve_julgar(t, amostra_pct=10) is False


def test_deve_julgar_clean_trace_flagged_when_sample_includes_it(models, monkeypatch):
    t = _FakeTrace()
    monkeypatch.setattr(random, 'randint', lambda a, b: 1)
    assert models._deve_julgar(t, amostra_pct=10) is True


# ── avaliar_groundedness (Tier 2) ────────────────────────────────────────

class _FakeEmbeddingsResponse:
    def __init__(self, vectors):
        self.data = [SimpleNamespace(embedding=v) for v in vectors]


class _FakeClient:
    def __init__(self, embed_vectors=None, judge_payload=None,
                 raise_on_embed=False, raise_on_judge=False, judge_raw=None):
        self._embed_vectors = embed_vectors
        self._judge_payload = judge_payload
        self._raise_on_embed = raise_on_embed
        self._raise_on_judge = raise_on_judge
        self._judge_raw = judge_raw
        self.embeddings = SimpleNamespace(create=self._create_embeddings)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create_chat))

    def _create_embeddings(self, model, input):
        if self._raise_on_embed:
            raise RuntimeError('embeddings API down')
        return _FakeEmbeddingsResponse(self._embed_vectors)

    def _create_chat(self, model, messages, temperature, response_format):
        if self._raise_on_judge:
            raise RuntimeError('chat API down')
        content = self._judge_raw if self._judge_raw is not None else json.dumps(self._judge_payload)
        message = SimpleNamespace(content=content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def test_avaliar_groundedness_parses_cosine_from_response(models):
    client = _FakeClient(embed_vectors=[[1, 0], [1, 0]])
    score = models.avaliar_groundedness(client, 'resposta', [{'quote': 'contexto'}])
    assert score == pytest.approx(1.0)


def test_avaliar_groundedness_returns_none_on_empty_context(models):
    client = _FakeClient(embed_vectors=[[1, 0], [1, 0]])
    score = models.avaliar_groundedness(client, 'resposta', [])
    assert score is None


def test_avaliar_groundedness_returns_none_on_empty_resposta(models):
    client = _FakeClient(embed_vectors=[[1, 0], [1, 0]])
    score = models.avaliar_groundedness(client, '', [{'quote': 'contexto'}])
    assert score is None


def test_avaliar_groundedness_never_raises_on_api_error(models):
    client = _FakeClient(raise_on_embed=True)
    score = models.avaliar_groundedness(client, 'resposta', [{'quote': 'contexto'}])
    assert score is None


# ── avaliar_judge (Tier 3) ────────────────────────────────────────────────

def test_avaliar_judge_parses_expected_floats(models):
    client = _FakeClient(judge_payload={
        'faithfulness': 0.9, 'answer_relevancy': 0.8, 'context_relevancy': 0.7,
    })
    result = models.avaliar_judge(client, 'pergunta', 'resposta', [{'quote': 'ctx'}])
    assert result == {'faithfulness': 0.9, 'answer_relevancy': 0.8, 'context_relevancy': 0.7}


def test_avaliar_judge_never_raises_on_api_error(models):
    client = _FakeClient(raise_on_judge=True)
    result = models.avaliar_judge(client, 'pergunta', 'resposta', [])
    assert result is None


def test_avaliar_judge_never_raises_on_malformed_json(models):
    client = _FakeClient(judge_raw='not valid json {{{')
    result = models.avaliar_judge(client, 'pergunta', 'resposta', [])
    assert result is None


def test_avaliar_judge_never_raises_on_missing_keys(models):
    client = _FakeClient(judge_raw=json.dumps({'faithfulness': 0.5}))
    result = models.avaliar_judge(client, 'pergunta', 'resposta', [])
    assert result is None
