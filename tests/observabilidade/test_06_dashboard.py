"""
GET /api/atlas/observabilidade.

The 403-for-non-admin guard runs before any query, so it's DB-agnostic and
tested unconditionally. The 200-for-admin path is a different story: the route
executes an UNCONDITIONAL raw `date_trunc(...)` query for the daily series —
not just when building that one field, but as a required step before the
response can be built at all. On SQLite this raises OperationalError (no such
function: date_trunc) and the whole route 500s, not just the series portion.
This is a real, verified finding — see REPORT.md "Issues found" — not an
assumption baked into this test. So the aggregation-math assertions are
skipped (not faked) on SQLite, same as retention.
"""
from datetime import datetime, timedelta

from conftest import skip_unless_postgres


def test_non_admin_gets_403(app, db, models, make_user, make_client):
    uid = make_user(perfil='operacional')
    client = make_client(uid)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    assert resp.status_code == 403


def test_admin_aggregation_matches_hand_computed_values(app, db, models, make_user, make_client, db_dialect):
    skip_unless_postgres(db_dialect)

    admin_id = make_user(perfil='admin')
    now = datetime.utcnow()

    with app.app_context():
        # 2 with file_search hits, 1 zero_retrieval, 1 without file_search at all.
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
    assert data['feedback']['up'] == 1
    assert data['feedback']['down'] == 1
    assert data['feedback']['ratio'] == 0.5
    # P95 of [100, 200, 300, 400] sorted ascending, index int(4*0.95)=3 -> 400
    assert data['latencia_p95_ms'] == 400


def test_admin_empty_window_returns_nulls_not_errors(app, db, models, make_user, make_client, db_dialect):
    skip_unless_postgres(db_dialect)

    admin_id = make_user(perfil='admin')
    client = make_client(admin_id)
    resp = client.get('/api/atlas/observabilidade?dias=30')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['total'] == 0
    assert data['retrieval_hit_rate'] is None
    assert data['feedback']['ratio'] is None
    assert data['latencia_p95_ms'] is None
