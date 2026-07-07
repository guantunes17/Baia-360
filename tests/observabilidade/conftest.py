"""
Fixtures for the RAG observability validation suite.

Auth strategy: unlike tests/redteam (which hits a live running backend over HTTP),
this suite imports backend/app.py directly and drives it with Flask's test client —
no server process needs to be running. We mint real JWTs with flask_jwt_extended's
create_access_token() and set them as the access-token cookie by hand, matching this
app's JWT_TOKEN_LOCATION=['cookies'] config (see app.py).

DATABASE ISOLATION — READ BEFORE TOUCHING THIS FILE
Flask-SQLAlchemy 3.x builds its engine(s) EAGERLY inside SQLAlchemy.init_app(), which
runs once at import time (`db = SQLAlchemy(app)` in app.py). Relative sqlite URIs are
resolved against app.instance_path AT THAT MOMENT. Simply reassigning
app.config['SQLALCHEMY_DATABASE_URI'] AFTER import has NO EFFECT — the already-built
engine keeps pointing at the original URI. Discovered the hard way while building this
suite: an early draft did the "obvious" thing (import app, then set
app.config['SQLALCHEMY_DATABASE_URI']) and it silently kept writing to
backend/instance/baia360.db — the real local dev database — because that's where the
engine had already been bound before the override ran. A stray test row landed in the
real users table and had to be manually deleted.
The only way to actually rebind the engine is to force flask_sqlalchemy to redo
init_app() against the new config:
    app.extensions.pop('sqlalchemy', None)
    db.init_app(app)
(the pop is required — init_app() raises RuntimeError if 'sqlalchemy' is already
registered in app.extensions). Do not "simplify" this back to a plain config
assignment; it silently re-opens the hole described above.

TEST DATABASE
Prefer TEST_DATABASE_URL (a real, disposable Postgres) if set — this is required to
actually exercise the Postgres-only code paths (purgar_rag_traces' interval SQL, the
date_trunc series in /api/atlas/observabilidade). Otherwise falls back to a throwaway
SQLite file under tests/observabilidade/results/ (gitignored), and the Postgres-only
tests report themselves as skipped, honestly, rather than faking a pass.
"""
import os
import sys
from pathlib import Path

import pytest

OBS_DIR     = Path(__file__).resolve().parent
BACKEND_DIR = OBS_DIR.parent.parent / 'backend'
RESULTS_DIR = OBS_DIR / 'results'
RESULTS_DIR.mkdir(exist_ok=True)

SQLITE_FALLBACK_PATH = RESULTS_DIR / '.test_db.sqlite3'

TEST_DATABASE_URL = os.environ.get('TEST_DATABASE_URL', '').strip()

OBS_LIVE       = os.environ.get('OBS_LIVE', '') == '1'
OBS_LIVE_QUERY = os.environ.get('OBS_LIVE_QUERY', '').strip()

sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope='session')
def app():
    """Imports the Flask app once per session and rebinds its DB engine to an
    isolated test database — see the module docstring for why the rebind has
    to happen this specific way."""
    from app import app as flask_app, db  # noqa: F401  (db bound via extensions)

    if TEST_DATABASE_URL:
        uri = TEST_DATABASE_URL
    else:
        SQLITE_FALLBACK_PATH.unlink(missing_ok=True)
        uri = f'sqlite:///{SQLITE_FALLBACK_PATH}'

    flask_app.config['SQLALCHEMY_DATABASE_URI'] = uri
    flask_app.config['TESTING'] = True
    flask_app.extensions.pop('sqlalchemy', None)
    db.init_app(flask_app)

    with flask_app.app_context():
        db.create_all()

    yield flask_app

    # Deliberately no drop_all()/engine.dispose() here: for the SQLite fallback the
    # file is gitignored scratch and gets wiped at the top of the next run; for a
    # real TEST_DATABASE_URL leaving the schema in place is what lets --phoenix (run
    # right after pytest.main() returns, same process) still read the row(s) test_99
    # just wrote.


@pytest.fixture(scope='session')
def db(app):
    from app import db as _db
    return _db


@pytest.fixture(scope='session')
def models(app):
    """Bag of model classes / helpers under test, imported after the DB rebind
    above so nothing accidentally touches the real engine first."""
    import app as app_module
    return app_module


@pytest.fixture(scope='session')
def db_dialect(app, db):
    with app.app_context():
        return db.engine.dialect.name


def skip_unless_postgres(dialect: str):
    if dialect != 'postgresql':
        pytest.skip(f"requires PostgreSQL (test DB is '{dialect}') — set TEST_DATABASE_URL to a "
                     f"disposable Postgres to exercise this path")


@pytest.fixture(autouse=True)
def _clean_tables(app, db, models):
    """Wipes the tables this suite touches before every test — cheap full-table
    delete rather than savepoint/rollback tricks, which don't play well with
    _persistir_rag_trace's own commits or registrar_rag_trace's background thread
    (separate connection). FK-safe order: traces before users."""
    with app.app_context():
        db.session.execute(db.delete(models.AtlasRAGTrace))
        db.session.execute(db.delete(models.AtlasGoldenRun))
        db.session.execute(db.delete(models.AtlasGoldenQA))
        db.session.execute(db.delete(models.User))
        db.session.commit()
    yield


class _Blocked(RuntimeError):
    pass


def _blocked(*_a, **_kw):
    raise _Blocked('Real OpenAI call attempted from a mocked test — this suite must '
                    'cost $0 by default. Mock the function that would call this.')


class _DummyOpenAI:
    """Stand-in for openai.OpenAI — every method raises loudly instead of making a
    network call, so a test that forgot to mock something fails fast and cheap
    rather than silently spending money."""
    def __init__(self, *a, **kw):
        from types import SimpleNamespace
        self.embeddings = SimpleNamespace(create=_blocked)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=_blocked))


@pytest.fixture(autouse=True)
def _no_real_openai_by_default(request, models, monkeypatch):
    """Patches app.OpenAI to the network-blocking dummy for every test EXCEPT
    test_99_live, which explicitly needs the real client and is itself gated
    behind OBS_LIVE=1."""
    if 'test_99_live' in request.node.nodeid:
        yield
        return
    monkeypatch.setattr(models, 'OpenAI', _DummyOpenAI)
    yield


@pytest.fixture
def make_client(app, models):
    """Returns a factory: make_client(user_id) -> Flask test client authenticated
    as that user via the real JWT cookie (matches JWT_TOKEN_LOCATION=['cookies']).
    Takes a plain int id, not a model instance — a User object handed back across
    an app_context boundary would be a DetachedInstanceError waiting to happen the
    moment a test touches an attribute that wasn't already loaded."""
    def _make(user_id):
        with app.app_context():
            token = models.create_access_token(identity=str(user_id))
        client = app.test_client()
        client.set_cookie(app.config['JWT_ACCESS_COOKIE_NAME'], token)
        return client
    return _make


@pytest.fixture
def make_user(app, db, models):
    """Returns a factory: make_user(perfil='operacional') -> the new user's id
    (int). Deliberately returns an id, not the ORM instance — see make_client's
    docstring for why."""
    counter = {'n': 0}

    def _make(perfil='operacional', **kwargs):
        counter['n'] += 1
        with app.app_context():
            u = models.User(
                nome=kwargs.pop('nome', f'Teste {counter["n"]}'),
                email=kwargs.pop('email', f'teste{counter["n"]}@obs.local'),
                perfil=perfil,
                ativo=True,
                status='ativo',
                **kwargs,
            )
            u.set_senha('irrelevante')
            db.session.add(u)
            db.session.commit()
            return u.id
    return _make


# ── Aggregation across the whole run — read back by run_validation.py ────────
RESULTS_JSON_MARKER = RESULTS_DIR / '.last_live_trace_ids.json'
