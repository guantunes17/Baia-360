# RAG observability — validation report

**Generated:** 2026-07-07T23:39:21Z

Validates the RAG observability system shipped across 6 prompts (AtlasRAGTrace model + async writer, SSE capture hook, tiered evaluation, admin dashboard, golden-set regression loop, Phoenix export) — mirrors `tests/redteam/` in layout and reporting style. Runs with **zero OpenAI cost by default** (the OpenAI client is mocked); the one live, cost-incurring test only runs with `OBS_LIVE=1`.

## Summary

**48/51 passed, 0 failed, 3 skipped.**

| Tier | Pass | Fail | Skip |
|---|---|---|---|
| test_00_schema | 11 | 0 | 0 |
| test_01_parser | 8 | 0 | 0 |
| test_02_writer | 3 | 0 | 0 |
| test_03_eval | 18 | 0 | 0 |
| test_04_retention | 0 | 0 | 2 |
| test_05_feedback | 5 | 0 | 0 |
| test_06_dashboard | 3 | 0 | 0 |
| test_99_live | 0 | 0 | 1 |

## Environment

- **DB dialect:** sqlite
- **Live test enabled (`OBS_LIVE=1`):** False
- **OpenAI keys present:** True

## Skipped and why

| Test | Reason |
|---|---|
| `test_04_retention.py::test_purge_deletes_only_traces_older_than_window` | Skipped: requires PostgreSQL (test DB is 'sqlite') — set TEST_DATABASE_URL to a disposable Postgres to exercise this path |
| `test_04_retention.py::test_purge_is_idempotent` | Skipped: requires PostgreSQL (test DB is 'sqlite') — set TEST_DATABASE_URL to a disposable Postgres to exercise this path |
| `test_99_live.py::test_live_retrieval_returns_scored_chunks` | Skipped: OBS_LIVE not set to 1 — this is the one opt-in, cost-incurring test in the suite |

## Issues found

Per this suite's constraints, discovered bugs are reported here rather than quietly worked around in the test or "fixed" in production code. Nothing outstanding as of this run — see **Resolved** below for what this suite has already caught and fixed.

## Resolved

- **`GET /api/atlas/observabilidade` was unconditionally Postgres-only, not just its daily-series field.** The route ran a raw `date_trunc('day', ...)` query before it could build the JSON response at all — on SQLite that raised `sqlite3.OperationalError: no such function: date_trunc` and the **entire** route 500'd, including the simple aggregate counts (total, hit rate, feedback ratio, P95 latency) that had nothing to do with the series and were otherwise portable. Since this repo's `backend/.env.example` defaults to `DATABASE_URL=sqlite:///baia360.db`, the admin observability dashboard was unusable in the default dev configuration, not just its chart. **Fixed**: the daily series is now bucketed in Python instead of via `date_trunc`, so the route is dialect-portable; Postgres behavior is unchanged. `test_06_dashboard.py`'s aggregation-math tests now run unconditionally on both dialects instead of being skipped on SQLite.
- **A DB-isolation near-miss**: an early version of the test-DB rebind fixture looked correct but silently wrote a row into the real local dev database (Flask-SQLAlchemy 3.x binds its engine eagerly at `SQLAlchemy(app)` time, so a post-import `app.config[...]` reassignment alone has no effect). **Fixed**: the rebind now goes through `app.extensions.pop('sqlalchemy', None); db.init_app(app)`, and `_assert_test_db_isolated()` in `conftest.py` is a hard, independent interlock that aborts the whole suite if the resolved bind URL doesn't look isolated — checked every run, not just when someone remembers to check. Covered by its own unit tests in `test_00_schema.py`.

## Reproducing this report

```bash
cd tests/observabilidade
pip install -r requirements.txt

# Default: $0, fully mocked, honest skips on SQLite
python run_validation.py

# Exercise the one genuinely Postgres-only path (retention interval SQL)
TEST_DATABASE_URL=postgresql://user:pass@localhost/obs_test python run_validation.py

# Live end-to-end + push the resulting trace to a local Phoenix
docker run --rm -d --name phoenix -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
OBS_LIVE=1 OBS_LIVE_QUERY="<a question your Vector Store covers>" \
  python run_validation.py --phoenix
```
