# RAG observability — validation report

**Generated:** 2026-07-07T23:17:33Z

Validates the RAG observability system shipped across 6 prompts (AtlasRAGTrace model + async writer, SSE capture hook, tiered evaluation, admin dashboard, golden-set regression loop, Phoenix export) — mirrors `tests/redteam/` in layout and reporting style. Runs with **zero OpenAI cost by default** (the OpenAI client is mocked); the one live, cost-incurring test only runs with `OBS_LIVE=1`.

## Summary

**37/42 passed, 0 failed, 5 skipped.**

| Tier | Pass | Fail | Skip |
|---|---|---|---|
| test_00_schema | 2 | 0 | 0 |
| test_01_parser | 8 | 0 | 0 |
| test_02_writer | 3 | 0 | 0 |
| test_03_eval | 18 | 0 | 0 |
| test_04_retention | 0 | 0 | 2 |
| test_05_feedback | 5 | 0 | 0 |
| test_06_dashboard | 1 | 0 | 2 |
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
| `test_06_dashboard.py::test_admin_aggregation_matches_hand_computed_values` | Skipped: requires PostgreSQL (test DB is 'sqlite') — set TEST_DATABASE_URL to a disposable Postgres to exercise this path |
| `test_06_dashboard.py::test_admin_empty_window_returns_nulls_not_errors` | Skipped: requires PostgreSQL (test DB is 'sqlite') — set TEST_DATABASE_URL to a disposable Postgres to exercise this path |
| `test_99_live.py::test_live_retrieval_returns_scored_chunks` | Skipped: OBS_LIVE not set to 1 — this is the one opt-in, cost-incurring test in the suite |

## Issues found

Per this suite's constraints, discovered bugs are reported here rather than quietly worked around in the test or "fixed" in production code.

- **`GET /api/atlas/observabilidade` is unconditionally Postgres-only, not just its daily-series field.** The route runs a raw `date_trunc('day', ...)` query before it can build the JSON response at all — on SQLite this raises `sqlite3.OperationalError: no such function: date_trunc` and the **entire** route 500s, including the simple aggregate counts (total, hit rate, feedback ratio, P95 latency) that have nothing to do with the series and are otherwise portable. Verified directly: an admin request against an empty SQLite test DB raises before returning a response. Since this repo's own `backend/.env.example` defaults to `DATABASE_URL=sqlite:///baia360.db`, the admin observability dashboard is unusable in that default dev configuration, not just its chart. Not fixed here (would require deciding whether to special-case the query on `db.engine.dialect.name` or something more general) — flagged for a follow-up prompt. `test_06_dashboard.py`'s aggregation-math test documents and skips around this on SQLite rather than hiding it.

## Reproducing this report

```bash
cd tests/observabilidade
pip install -r requirements.txt

# Default: $0, fully mocked, honest skips on SQLite
python run_validation.py

# Exercise the Postgres-only paths (retention, dashboard aggregation)
TEST_DATABASE_URL=postgresql://user:pass@localhost/obs_test python run_validation.py

# Live end-to-end + push the resulting trace to a local Phoenix
docker run --rm -d --name phoenix -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
OBS_LIVE=1 OBS_LIVE_QUERY="<a question your Vector Store covers>" \
  python run_validation.py --phoenix
```
