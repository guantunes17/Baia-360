"""
OPT-IN, spends real OpenAI money. Only collected/run when OBS_LIVE=1 — every
other tier in this suite is fully mocked and free; this is the single
exception, and it's gated hard behind an explicit env var plus a real
OPENAI_API_KEY / OPENAI_VECTOR_STORE_ID / OBS_LIVE_QUERY.

Honest scope note: this exercises the real retrieval path (responder_atlas)
and the real writer core (_persistir_rag_trace) against live data, but it is
NOT byte-identical to the streaming SSE path in generate() — responder_atlas
is a non-streaming, store=False variant built for exactly this kind of
offline replay (golden-set regression, this test), not the interactive chat
route itself.
"""
import json
import os

import pytest

from conftest import OBS_LIVE, OBS_LIVE_QUERY, RESULTS_JSON_MARKER

_OPENAI_KEY_PRESENT = bool(os.environ.get('OPENAI_API_KEY', '').strip())
_VECTOR_STORE_PRESENT = bool(os.environ.get('OPENAI_VECTOR_STORE_ID', '').strip())

pytestmark = pytest.mark.skipif(
    not OBS_LIVE,
    reason='OBS_LIVE not set to 1 — this is the one opt-in, cost-incurring test in the suite',
)


def test_live_retrieval_returns_scored_chunks(app, db, models):
    if not OBS_LIVE_QUERY:
        pytest.skip('OBS_LIVE_QUERY not set — need a question known to be covered by the '
                     'configured Vector Store')
    if not _OPENAI_KEY_PRESENT:
        pytest.skip('OPENAI_API_KEY not set in the environment')
    if not _VECTOR_STORE_PRESENT:
        pytest.skip('OPENAI_VECTOR_STORE_ID not set in the environment')

    import time
    t0 = time.time()
    resposta, chunks = models.responder_atlas(OBS_LIVE_QUERY)
    latencia_ms = int((time.time() - t0) * 1000)

    assert chunks, 'expected at least one retrieved chunk for a question known to be covered'
    top = chunks[0]
    assert isinstance(top.get('score'), (int, float)), f'top chunk has no numeric score: {top}'

    with app.app_context():
        trace_dict = {
            'usuario_id': None, 'conv_id': 'obs-live-test', 'response_id': None,
            'modelo': models.ATLAS_MODEL, 'pergunta': OBS_LIVE_QUERY, 'resposta': resposta,
            'usou_file_search': True, 'retrieval_query': OBS_LIVE_QUERY, 'chunks': chunks,
            'n_file_citations': 0, 'latencia_ms': latencia_ms, 'tokens_in': None, 'tokens_out': None,
        }
        row_id = models._persistir_rag_trace(trace_dict)

    RESULTS_JSON_MARKER.write_text(json.dumps({'trace_ids': [row_id]}), encoding='utf-8')
    print(f'\n[live] wrote AtlasRAGTrace #{row_id} to the test DB '
          f'({len(chunks)} chunks, top score {top["score"]})')
