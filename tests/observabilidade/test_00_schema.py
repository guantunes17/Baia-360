"""Schema smoke test: after db.create_all() on the isolated test DB, the tables
and key columns the other 5 (mocked) test tiers depend on actually exist.

Also covers the _assert_test_db_isolated() interlock itself (conftest.py) as a
plain pure-function test, independent of the app/db fixtures — the whole point
of the interlock is that it doesn't get to rely on the rest of the fixture
machinery being correct."""
import pytest

from conftest import _assert_test_db_isolated


@pytest.mark.parametrize('bad_url', [
    'sqlite:////Users/dev/Baia-360/backend/instance/baia360.db',
    'sqlite:///baia360.db',
    'postgresql://baia360:pw@baia360-postgres:5432/baia360',
    'postgresql://baia360:pw@db:5432/baia360_prod',
])
def test_interlock_aborts_on_real_looking_db(bad_url):
    with pytest.raises(RuntimeError, match='INTERLOCK ABORT'):
        _assert_test_db_isolated(bad_url)


def test_interlock_passes_for_in_memory_db():
    _assert_test_db_isolated('sqlite:///:memory:')  # must not raise


def test_interlock_passes_for_path_under_os_tempdir(monkeypatch):
    """Exercises the tempfile.gettempdir() branch specifically — the db name
    itself deliberately avoids the '_test' substring so this can't accidentally
    pass through the other branch instead."""
    monkeypatch.setattr('tempfile.gettempdir', lambda: '/fake/tmp')
    _assert_test_db_isolated('sqlite:////fake/tmp/observability_db.sqlite3')


def test_interlock_passes_for_explicitly_test_named_db():
    """A DB name containing '_test' passes even outside the tempdir/TEST_DATABASE_URL
    branches — e.g. a Postgres schema someone deliberately named for this purpose."""
    _assert_test_db_isolated('postgresql://someuser:pw@some-ci-host:5432/myapp_test')


def test_interlock_passes_when_matching_configured_test_database_url(monkeypatch):
    """The one case that isn't tempfile/:memory:/_test-named — an explicit
    TEST_DATABASE_URL the operator configured on purpose."""
    url = 'postgresql://someuser:somepass@some-ci-host:5432/whatever_db_name'
    monkeypatch.setenv('TEST_DATABASE_URL', url)
    _assert_test_db_isolated(url)  # must not raise


def test_interlock_aborts_on_unrecognized_url():
    """Not a real-DB marker, but also doesn't look isolated by any of the
    three blessed patterns — must fail closed, not open."""
    with pytest.raises(RuntimeError, match='INTERLOCK ABORT'):
        _assert_test_db_isolated('sqlite:////Users/dev/some/random/path/db.sqlite3')


def test_tables_exist(app, db):
    with app.app_context():
        from sqlalchemy import inspect
        tables = set(inspect(db.engine).get_table_names())
    assert 'atlas_rag_trace' in tables
    assert 'atlas_golden_qa' in tables
    assert 'atlas_golden_run' in tables


def test_atlas_rag_trace_key_columns(app, db):
    with app.app_context():
        from sqlalchemy import inspect
        columns = {c['name'] for c in inspect(db.engine).get_columns('atlas_rag_trace')}
    expected = {
        'id', 'usuario_id', 'conv_id', 'response_id', 'modelo',
        'pergunta', 'resposta', 'retrieval_query', 'retrieval_count',
        'top_score', 'mean_score', 'zero_retrieval', 'chunks_json',
        'n_file_citations', 'citation_coverage', 'feedback',
        'groundedness', 'eval_faithfulness', 'eval_answer_rel',
        'eval_context_rel', 'eval_flagged', 'eval_modelo',
        'latencia_ms', 'tokens_in', 'tokens_out', 'criado_em',
    }
    missing = expected - columns
    assert not missing, f'missing columns on atlas_rag_trace: {missing}'
