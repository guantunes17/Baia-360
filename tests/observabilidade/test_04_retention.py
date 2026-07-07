"""
purgar_rag_traces uses Postgres-specific interval arithmetic
(NOW() - (:d || ' days')::interval) — genuinely Postgres-only, not a portability
oversight. Skipped, not failed, when the test DB is SQLite.
"""
from datetime import datetime, timedelta

from conftest import skip_unless_postgres


def test_purge_deletes_only_traces_older_than_window(app, db, models, db_dialect):
    skip_unless_postgres(db_dialect)

    now = datetime.utcnow()
    with app.app_context():
        db.session.add_all([
            models.AtlasRAGTrace(conv_id='old', criado_em=now - timedelta(days=100)),
            models.AtlasRAGTrace(conv_id='mid', criado_em=now - timedelta(days=50)),
            models.AtlasRAGTrace(conv_id='recent', criado_em=now - timedelta(days=10)),
        ])
        db.session.commit()

        deleted = models.purgar_rag_traces(90)
        assert deleted == 1

        remaining = {r.conv_id for r in models.AtlasRAGTrace.query.all()}
        assert remaining == {'mid', 'recent'}


def test_purge_is_idempotent(app, db, models, db_dialect):
    skip_unless_postgres(db_dialect)

    now = datetime.utcnow()
    with app.app_context():
        db.session.add(models.AtlasRAGTrace(conv_id='ancient', criado_em=now - timedelta(days=200)))
        db.session.commit()

        first = models.purgar_rag_traces(90)
        second = models.purgar_rag_traces(90)
        assert first == 1
        assert second == 0
