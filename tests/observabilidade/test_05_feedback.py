"""
POST /api/atlas/rag_feedback — plain ORM queries, no raw SQL, so this route is
DB-agnostic and runs on both SQLite and Postgres test DBs.
"""


def test_match_by_response_id(app, db, models, make_user, make_client):
    uid = make_user()
    with app.app_context():
        db.session.add(models.AtlasRAGTrace(usuario_id=uid, conv_id='c1', response_id='resp-1'))
        db.session.commit()

    client = make_client(uid)
    resp = client.post('/api/atlas/rag_feedback', json={'feedback': 'up', 'response_id': 'resp-1'})
    assert resp.status_code == 200

    with app.app_context():
        row = models.AtlasRAGTrace.query.filter_by(response_id='resp-1').one()
        assert row.feedback == 'up'


def test_match_by_conv_id_falls_back_to_most_recent(app, db, models, make_user, make_client):
    uid = make_user()
    with app.app_context():
        older = models.AtlasRAGTrace(usuario_id=uid, conv_id='c2', response_id=None)
        db.session.add(older)
        db.session.commit()
        newer = models.AtlasRAGTrace(usuario_id=uid, conv_id='c2', response_id=None)
        db.session.add(newer)
        db.session.commit()
        newer_id = newer.id
        older_id = older.id

    client = make_client(uid)
    resp = client.post('/api/atlas/rag_feedback', json={'feedback': 'down', 'conv_id': 'c2'})
    assert resp.status_code == 200

    with app.app_context():
        assert db.session.get(models.AtlasRAGTrace, newer_id).feedback == 'down'
        assert db.session.get(models.AtlasRAGTrace, older_id).feedback is None


def test_unknown_trace_returns_404(app, db, models, make_user, make_client):
    uid = make_user()
    client = make_client(uid)
    resp = client.post('/api/atlas/rag_feedback', json={'feedback': 'up', 'response_id': 'does-not-exist'})
    assert resp.status_code == 404


def test_invalid_feedback_value_returns_400(app, db, models, make_user, make_client):
    uid = make_user()
    client = make_client(uid)
    resp = client.post('/api/atlas/rag_feedback', json={'feedback': 'sideways', 'response_id': 'x'})
    assert resp.status_code == 400


def test_does_not_match_another_users_trace(app, db, models, make_user, make_client):
    """The route filters by usuario_id — a trace belonging to a different user
    must come back 404, not silently update someone else's data."""
    owner_id = make_user()
    other_id = make_user()
    with app.app_context():
        db.session.add(models.AtlasRAGTrace(usuario_id=owner_id, conv_id='c3', response_id='resp-owner'))
        db.session.commit()

    client = make_client(other_id)
    resp = client.post('/api/atlas/rag_feedback', json={'feedback': 'up', 'response_id': 'resp-owner'})
    assert resp.status_code == 404
