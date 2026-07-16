"""
GET /api/atlas/observabilidade.

The 403-for-non-admin guard runs before any query, so it's DB-agnostic and
tested unconditionally. The 200-for-admin path used to be Postgres-only too:
the route ran an UNCONDITIONAL raw `date_trunc(...)` query for the daily
series — not just when building that one field, but as a required step before
the response could be built at all — which raised OperationalError on SQLite
and 500'd the WHOLE route, not just the series portion. That was a real,
verified finding (see REPORT.md's "Issues found" history). The route now
buckets the daily series in Python instead of via date_trunc, so it's
dialect-portable and these tests run unconditionally on both SQLite and
Postgres — no more skip_unless_postgres gate here.
"""
from datetime import datetime, timedelta

import pytest


def test_non_admin_gets_403(app, db, models, make_user, make_client):
    uid = make_user(perfil='operacional')
    client = make_client(uid)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    assert resp.status_code == 403


def test_admin_aggregation_matches_hand_computed_values(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='admin')
    now = datetime.utcnow()

    with app.app_context():
        # 2 with file_search hits, 1 zero_retrieval, 1 without file_search at all.
        # None of these 4 rows set tools_usadas -> it's genuinely NULL in the
        # DB (these rows predate the 2026-07-16 plan's provenance capture),
        # so they must all land in 'legacy_unknown', never 'rag_only'/
        # 'no_retrieval' — see test_segmentos_legacy_unknown_when_tools_usadas_null
        # below for the dedicated regression test of that exact bug.
        db.session.add_all([
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now - timedelta(hours=1),
                                  usou_file_search=True, zero_retrieval=False, top_score=0.9,
                                  feedback='up', latencia_ms=100),
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now - timedelta(hours=2),
                                  usou_file_search=True, zero_retrieval=False, top_score=0.5,
                                  feedback='down', latencia_ms=200),
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now - timedelta(hours=3),
                                  usou_file_search=True, zero_retrieval=True, top_score=None,
                                  feedback=None, latencia_ms=300),
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now - timedelta(hours=4),
                                  usou_file_search=False, zero_retrieval=False, top_score=None,
                                  feedback=None, latencia_ms=400),
        ])
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    assert resp.status_code == 200
    data = resp.get_json()

    assert data['total'] == 4
    assert data['com_file_search'] == 3
    # zero_retrieval_rate = 1/3 of the file_search traces
    assert data['zero_retrieval_rate'] == round(1 / 3, 4)
    assert data['retrieval_hit_rate'] == round(1 - 1 / 3, 4)
    assert data['mean_top_score'] == round((0.9 + 0.5) / 2, 4)
    # No mean without its N (2026-07-16 plan §6) — only 2 of the 4 rows have a
    # non-null top_score (the zero_retrieval row is NULL, not 0).
    assert data['mean_top_score_n'] == 2
    assert data['feedback']['up'] == 1
    assert data['feedback']['down'] == 1
    assert data['feedback']['ratio'] == 0.5
    # P95 of [100, 200, 300, 400] sorted ascending, index int(4*0.95)=3 -> 400
    assert data['latencia_p95_ms'] == 400
    # serie_top_score buckets by calendar day — how many buckets the 4 traces
    # land in depends on whether "now" is near a UTC midnight boundary, but the
    # bucket counts must always sum back to the total regardless of that split.
    serie = data['serie_top_score']
    assert serie, 'expected at least one day bucket'
    assert sum(s['n'] for s in serie) == 4
    # Segmentation: tools_usadas is NULL (never set) on all 4 seeded rows ->
    # 'legacy_unknown' for all of them. NOT 'rag_only'/'no_retrieval' — we
    # don't actually know whether a tool ran on these (they represent
    # pre-2026-07-16 data), and treating None the same as [] would fabricate
    # that certainty (the exact bug this test guards against).
    assert data['segmentos'] == {'rag_only': 0, 'tool_only': 0, 'hybrid': 0,
                                  'no_retrieval': 0, 'legacy_unknown': 4}
    # None of the 4 rows carry an eval_versao (pre-dates the 2026-07-16 plan).
    assert data['versoes_disponiveis'] == []
    assert data['eval_versao_filtro'] is None
    # Heartbeat: the most recent of the 4 seeded rows is 1h old.
    assert data['heartbeat']['ultimo_trace_h_atras'] == pytest.approx(1.0, abs=0.05)
    assert data['heartbeat']['traces_24h'] == 4


def test_admin_empty_window_returns_nulls_not_errors(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='admin')
    client = make_client(admin_id)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['total'] == 0
    assert data['retrieval_hit_rate'] is None
    assert data['feedback']['ratio'] is None
    assert data['latencia_p95_ms'] is None
    assert data['serie_top_score'] == []
    assert data['segmentos'] == {'rag_only': 0, 'tool_only': 0, 'hybrid': 0,
                                  'no_retrieval': 0, 'legacy_unknown': 0}
    assert data['versoes_disponiveis'] == []
    assert data['mean_top_score_n'] == 0
    # No traces at all -> heartbeat can't report an age, only a definite zero count.
    assert data['heartbeat']['ultimo_trace_h_atras'] is None
    assert data['heartbeat']['traces_24h'] == 0


def test_segmentos_tool_only_and_hybrid_from_tools_usadas(app, db, models, make_user, make_client):
    """Rows with a populated tools_usadas must segment as tool_only/hybrid,
    not rag_only — even when usou_file_search is True (hybrid case)."""
    import json
    admin_id = make_user(perfil='admin')
    now = datetime.utcnow()

    with app.app_context():
        db.session.add_all([
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now,
                                  usou_file_search=False, tools_usadas=json.dumps(['get_dashboard']),
                                  n_file_citations=0),
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now,
                                  usou_file_search=True, tools_usadas=json.dumps(['get_dashboard']),
                                  n_file_citations=2),
        ])
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    data = resp.get_json()
    assert data['segmentos'] == {'rag_only': 0, 'tool_only': 1, 'hybrid': 1,
                                  'no_retrieval': 0, 'legacy_unknown': 0}


def test_segmentos_legacy_unknown_when_tools_usadas_null(app, db, models, make_user, make_client):
    """Regression test for a real bug caught in code review: a row with
    usou_file_search=True and tools_usadas genuinely NULL (never captured,
    e.g. a pre-2026-07-16 row) must be counted as 'legacy_unknown' through
    the actual HTTP route — not silently promoted to 'rag_only' just because
    the read-site collapsed None into [] before calling derivar_segmento_rag.
    A verified-clean RAG-only count must never include rows we can't vouch for."""
    admin_id = make_user(perfil='admin')
    now = datetime.utcnow()

    with app.app_context():
        db.session.add_all([
            # tools_usadas intentionally omitted -> NULL in the DB.
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now,
                                  usou_file_search=True, n_file_citations=0),
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now,
                                  usou_file_search=False, n_file_citations=0),
        ])
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    data = resp.get_json()
    assert data['segmentos'] == {'rag_only': 0, 'tool_only': 0, 'hybrid': 0,
                                  'no_retrieval': 0, 'legacy_unknown': 2}


def test_eval_versao_filtro_isola_pipelines(app, db, models, make_user, make_client):
    """A row scored by the old (pre-2026-07-16) pipeline has eval_versao NULL;
    a reprocessed/new row carries EVAL_PIPELINE_VERSION. Filtering by
    eval_versao must exclude the other pipeline's rows from every aggregate,
    not just from the count."""
    admin_id = make_user(perfil='admin')
    now = datetime.utcnow()

    with app.app_context():
        db.session.add_all([
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now,
                                  usou_file_search=True, top_score=0.1, eval_versao=None),
            models.AtlasRAGTrace(usuario_id=admin_id, criado_em=now,
                                  usou_file_search=True, top_score=0.9,
                                  eval_versao=models.EVAL_PIPELINE_VERSION),
        ])
        db.session.commit()

    client = make_client(admin_id)
    resp_all = client.get('/api/atlas/observabilidade?dias=30')
    assert resp_all.get_json()['total'] == 2

    resp_v2 = client.get(f'/api/atlas/observabilidade?dias=30&eval_versao={models.EVAL_PIPELINE_VERSION}')
    data_v2 = resp_v2.get_json()
    assert data_v2['total'] == 1
    assert data_v2['mean_top_score'] == 0.9
    assert data_v2['eval_versao_filtro'] == models.EVAL_PIPELINE_VERSION
    assert data_v2['versoes_disponiveis'] == [models.EVAL_PIPELINE_VERSION]
