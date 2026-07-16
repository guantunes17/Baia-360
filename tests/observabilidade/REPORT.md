# RAG observability — validation report

**Generated:** 2026-07-16T16:45:03Z

Validates the RAG observability system shipped across 6 prompts (AtlasRAGTrace model + async writer, SSE capture hook, tiered evaluation, admin dashboard, golden-set regression loop, Phoenix export) — mirrors `tests/redteam/` in layout and reporting style. Runs with **zero OpenAI cost by default** (the OpenAI client is mocked); the one live, cost-incurring test only runs with `OBS_LIVE=1`.

## Summary

**73/74 passed, 0 failed, 1 skipped.**

| Tier | Pass | Fail | Skip |
|---|---|---|---|
| test_00_schema | 11 | 0 | 0 |
| test_01_parser | 12 | 0 | 0 |
| test_02_writer | 3 | 0 | 0 |
| test_03_eval | 18 | 0 | 0 |
| test_04_retention | 2 | 0 | 0 |
| test_05_feedback | 5 | 0 | 0 |
| test_06_dashboard | 6 | 0 | 0 |
| test_99_live | 0 | 0 | 1 |
| test_07_segmentacao | 16 | 0 | 0 |

## Environment

- **DB dialect:** postgres
- **Live test enabled (`OBS_LIVE=1`):** False
- **OpenAI keys present:** True

## Skipped and why

| Test | Reason |
|---|---|
| `test_99_live.py::test_live_retrieval_returns_scored_chunks` | Skipped: OBS_LIVE not set to 1 — this is the one opt-in, cost-incurring test in the suite |

## Issues found

Per this suite's constraints, discovered bugs are reported here rather than quietly worked around in the test or "fixed" in production code. Nothing outstanding as of this run — see **Resolved** below for what this suite has already caught and fixed.

## Resolved

- **`GET /api/atlas/observabilidade` was unconditionally Postgres-only, not just its daily-series field.** The route ran a raw `date_trunc('day', ...)` query before it could build the JSON response at all — on SQLite that raised `sqlite3.OperationalError: no such function: date_trunc` and the **entire** route 500'd, including the simple aggregate counts (total, hit rate, feedback ratio, P95 latency) that had nothing to do with the series and were otherwise portable. Since this repo's `backend/.env.example` defaults to `DATABASE_URL=sqlite:///baia360.db`, the admin observability dashboard was unusable in the default dev configuration, not just its chart. **Fixed**: the daily series is now bucketed in Python instead of via `date_trunc`, so the route is dialect-portable; Postgres behavior is unchanged. `test_06_dashboard.py`'s aggregation-math tests now run unconditionally on both dialects instead of being skipped on SQLite.
- **A DB-isolation near-miss**: an early version of the test-DB rebind fixture looked correct but silently wrote a row into the real local dev database (Flask-SQLAlchemy 3.x binds its engine eagerly at `SQLAlchemy(app)` time, so a post-import `app.config[...]` reassignment alone has no effect). **Fixed**: the rebind now goes through `app.extensions.pop('sqlalchemy', None); db.init_app(app)`, and `_assert_test_db_isolated()` in `conftest.py` is a hard, independent interlock that aborts the whole suite if the resolved bind URL doesn't look isolated — checked every run, not just when someone remembers to check. Covered by its own unit tests in `test_00_schema.py`.
- **`eval_flagged` was a dead alarm (2026-07-16 observability plan, Prompt 1).** It was set to `True` the instant a row was *selected* for judging (`_deve_julgar`), before the judge even ran — so a row with a perfect faithfulness/answer_relevancy of 1.0 could still be flagged, as long as `groundedness < 0.75` or `top_score < 0.3` triggered the selection. Production data confirmed this: 4/4 RAG traces were flagged, including three with perfect judge scores. **Fixed**: `eval_flagged` now means "the judge ran AND found a real problem" (`faithfulness <= 0.5 or answer_relevancy <= 0.5`, verified against the judge's code as a continuous 0.0-1.0 scale — no rounding/discretization anywhere), computed after the judge returns, not before. NULL when the judge didn't run (skipped segment, not selected, or the API call failed) — never a stale `False`. See `test_07_segmentacao.py` and the redefinition note in `_persistir_rag_trace`.
- **NULL-vs-`[]` fabrication bug in the provenance read path, caught in code review before deploy.** An early version of `derivar_segmento_rag`'s caller (both the dashboard route and a first draft of the reprocessing SQL) collapsed `tools_usadas IS NULL` (provenance never captured — true of every row that predates this plan) into `[]` (provenance captured, positively no tool ran) before the segmentation check — `if tools_usadas:` treats `None` and `[]` identically in Python, since both are falsy. That silently promoted rows of *unknown* origin into verified `rag_only`/`no_retrieval`, at N=4 a 25%-of-corpus fabrication — exactly what this plan exists to eliminate. **Fixed**: `derivar_segmento_rag` now checks `tools_usadas is None` explicitly and returns its own `legacy_unknown` segment; the reprocessing SQL no longer writes `tools_usadas='[]'` for traces whose provenance wasn't actually investigated (only the one trace hand-verified this session gets annotated). See `test_segmento_legacy_unknown_when_tools_usadas_is_none` and `test_segmentos_legacy_unknown_when_tools_usadas_null`.

## Findings for future work (not bugs — inputs to the chunking session)

- **Tier 2's judge-triage role is structurally inert, and the fix is NOT to recalibrate its threshold.** `_deve_julgar` samples a row for the Tier 3 judge when `groundedness < 0.75` (among other triggers). Across the 4 RAG traces in production as of this plan, groundedness was 0.7431, 0.7108, 0.7143, and 0.4777 — **all four** below 0.75, so the threshold selected 100% of the sample instead of triaging it. This is the same disease found everywhere else in this investigation: `zero_retrieval` is unreachable without an API-level score threshold, the old `eval_flagged` fired on 4/4 regardless of judge quality, and the egress block-vs-warn check was validated only under a harness config production doesn't run — thresholds calibrated against a distribution that doesn't exist yet. `groundedness` is a cosine similarity between the answer and the retrieved chunks; with `retrieval_count` pinned at 20 (the OpenAI `max_num_results` default) and most of those chunks documented elsewhere in this plan as low-relevance/boilerplate, groundedness is plausibly depressed by the same root cause as the low `mean_score` — not by anything wrong with the groundedness computation itself. **Do not tune 0.75 to fix this** — that would calibrate the instrument to a retrieval-quality problem instead of fixing the problem. Fix retrieval (chunking strategy, PDF ingestion, `score_threshold`) in the dedicated chunking session first; if groundedness rises as a side effect, Tier 2 triage starts working again on its own, and only then does 0.75 deserve a second look — with a real distribution to look at, not N=4.

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
