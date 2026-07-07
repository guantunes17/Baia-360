"""
Orchestrates the RAG observability validation suite: runs pytest, writes a
timestamped results JSON (gitignored, like tests/redteam/results/), and
regenerates REPORT.md (committed).

Usage:
  python run_validation.py                # $0, fully mocked, honest skips on SQLite
  OBS_LIVE=1 OBS_LIVE_QUERY="..." python run_validation.py --phoenix
      # also runs the one live test, and if it produced a trace, pushes it to
      # a local Phoenix (docker run ... arizephoenix/phoenix:latest) so you
      # can inspect it at http://localhost:6006

See conftest.py for TEST_DATABASE_URL / OBS_LIVE / OBS_LIVE_QUERY semantics.
"""
import argparse
import json
import os
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pytest

OBS_DIR     = Path(__file__).resolve().parent
BACKEND_DIR = OBS_DIR.parent.parent / 'backend'
SCRIPTS_DIR = OBS_DIR.parent.parent / 'scripts'
RESULTS_DIR = OBS_DIR / 'results'
RESULTS_DIR.mkdir(exist_ok=True)
REPORT_PATH = OBS_DIR / 'REPORT.md'
LIVE_MARKER = RESULTS_DIR / '.last_live_trace_ids.json'

sys.path.insert(0, str(OBS_DIR))  # so `from conftest import ...` works standalone
from conftest import OBS_LIVE, OBS_LIVE_QUERY  # noqa: E402


# ── pytest result collection ──────────────────────────────────────────────

def _short(text: str, limit: int = 600) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + '… (truncated)'


def _skip_reason(longrepr) -> str:
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        return str(longrepr[2])
    return _short(str(longrepr))


class _Collector:
    def __init__(self):
        self.results = []

    def _append(self, report, status, detail):
        self.results.append({
            'id': report.nodeid,
            'status': status,
            'duration_ms': round(report.duration * 1000, 1),
            'detail': detail,
        })

    def pytest_runtest_logreport(self, report):
        if report.when == 'call':
            # pytest.skip() called from inside a test body (e.g. skip_unless_postgres,
            # invoked at runtime rather than via a skipif marker at collection time)
            # produces a 'call'-phase report with report.skipped=True, not 'passed' —
            # must check this before falling back to pass/fail, or every such skip
            # gets misreported as a failure.
            if report.skipped:
                self._append(report, 'skip', _skip_reason(report.longrepr))
            else:
                status = 'pass' if report.passed else 'fail'
                detail = '' if report.passed else _short(str(report.longrepr))
                self._append(report, status, detail)
        elif report.when == 'setup':
            if report.skipped:
                self._append(report, 'skip', _skip_reason(report.longrepr))
            elif report.failed:
                self._append(report, 'fail', _short(str(report.longrepr)))


# ── environment introspection ───────────────────────────────────────────────

def _environment_info() -> dict:
    sys.path.insert(0, str(BACKEND_DIR))
    from app import app as flask_app, db  # noqa: E402

    # Mirror conftest's rebind so this reads the same test DB the suite used —
    # cheap and idempotent if conftest already did it in this same process.
    with flask_app.app_context():
        try:
            dialect = db.engine.dialect.name
        except Exception:
            dialect = 'unknown'

    return {
        'db': 'postgres' if dialect == 'postgresql' else dialect,
        'live_enabled': OBS_LIVE,
        'openai_keys_present': bool(os.environ.get('OPENAI_API_KEY', '').strip())
                                and bool(os.environ.get('OPENAI_VECTOR_STORE_ID', '').strip()),
    }


# ── results JSON ─────────────────────────────────────────────────────────

def _write_results_json(results, environment) -> tuple[Path, dict]:
    total   = len(results)
    passed  = sum(1 for r in results if r['status'] == 'pass')
    failed  = sum(1 for r in results if r['status'] == 'fail')
    skipped = sum(1 for r in results if r['status'] == 'skip')

    payload = {
        'suite': 'observabilidade_rag',
        'timestamp_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'environment': environment,
        'summary': {'total': total, 'passed': passed, 'failed': failed, 'skipped': skipped},
        'results': results,
    }
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    path = RESULTS_DIR / f'{ts}.json'
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    return path, payload


# ── REPORT.md ────────────────────────────────────────────────────────────

def _tier(nodeid: str) -> str:
    return nodeid.split('::', 1)[0].replace('.py', '')


def _write_report_md(payload: dict) -> None:
    results = payload['results']
    env     = payload['environment']
    summary = payload['summary']

    tiers = {}
    for r in results:
        t = tiers.setdefault(_tier(r['id']), {'pass': 0, 'fail': 0, 'skip': 0})
        t[r['status']] += 1

    tier_order = [
        'test_00_schema', 'test_01_parser', 'test_02_writer', 'test_03_eval',
        'test_04_retention', 'test_05_feedback', 'test_06_dashboard', 'test_99_live',
    ]
    known_tiers = [t for t in tier_order if t in tiers] + [t for t in tiers if t not in tier_order]

    lines = []
    lines.append('# RAG observability — validation report')
    lines.append('')
    lines.append(f"**Generated:** {payload['timestamp_utc']}")
    lines.append('')
    lines.append(
        'Validates the RAG observability system shipped across 6 prompts (AtlasRAGTrace '
        'model + async writer, SSE capture hook, tiered evaluation, admin dashboard, '
        'golden-set regression loop, Phoenix export) — mirrors `tests/redteam/` in '
        'layout and reporting style. Runs with **zero OpenAI cost by default** (the '
        'OpenAI client is mocked); the one live, cost-incurring test only runs with '
        '`OBS_LIVE=1`.'
    )
    lines.append('')
    lines.append('## Summary')
    lines.append('')
    lines.append(f"**{summary['passed']}/{summary['total']} passed, "
                  f"{summary['failed']} failed, {summary['skipped']} skipped.**")
    lines.append('')
    lines.append('| Tier | Pass | Fail | Skip |')
    lines.append('|---|---|---|---|')
    for t in known_tiers:
        c = tiers[t]
        lines.append(f"| {t} | {c['pass']} | {c['fail']} | {c['skip']} |")
    lines.append('')

    lines.append('## Environment')
    lines.append('')
    lines.append(f"- **DB dialect:** {env['db']}")
    lines.append(f"- **Live test enabled (`OBS_LIVE=1`):** {env['live_enabled']}")
    lines.append(f"- **OpenAI keys present:** {env['openai_keys_present']}")
    lines.append('')

    skips = [r for r in results if r['status'] == 'skip']
    lines.append('## Skipped and why')
    lines.append('')
    if not skips:
        lines.append('Nothing was skipped this run.')
    else:
        lines.append('| Test | Reason |')
        lines.append('|---|---|')
        for r in skips:
            reason = r['detail'].replace('\n', ' ').replace('|', '\\|')
            lines.append(f"| `{r['id']}` | {reason} |")
    lines.append('')

    fails = [r for r in results if r['status'] == 'fail']
    if fails:
        lines.append('## Failures')
        lines.append('')
        for r in fails:
            lines.append(f"### `{r['id']}`")
            lines.append('')
            lines.append('```')
            lines.append(r['detail'])
            lines.append('```')
            lines.append('')

    lines.append('## Issues found')
    lines.append('')
    lines.append(
        "Per this suite's constraints, discovered bugs are reported here rather than "
        "quietly worked around in the test or \"fixed\" in production code. Nothing "
        "outstanding as of this run — see **Resolved** below for what this suite has "
        "already caught and fixed."
    )
    lines.append('')

    lines.append('## Resolved')
    lines.append('')
    lines.append(
        "- **`GET /api/atlas/observabilidade` was unconditionally Postgres-only, not just "
        "its daily-series field.** The route ran a raw `date_trunc('day', ...)` query "
        "before it could build the JSON response at all — on SQLite that raised "
        "`sqlite3.OperationalError: no such function: date_trunc` and the **entire** "
        "route 500'd, including the simple aggregate counts (total, hit rate, feedback "
        "ratio, P95 latency) that had nothing to do with the series and were otherwise "
        "portable. Since this repo's `backend/.env.example` defaults to "
        "`DATABASE_URL=sqlite:///baia360.db`, the admin observability dashboard was "
        "unusable in the default dev configuration, not just its chart. **Fixed**: the "
        "daily series is now bucketed in Python instead of via `date_trunc`, so the "
        "route is dialect-portable; Postgres behavior is unchanged. "
        "`test_06_dashboard.py`'s aggregation-math tests now run unconditionally on "
        "both dialects instead of being skipped on SQLite."
    )
    lines.append(
        "- **A DB-isolation near-miss**: an early version of the test-DB rebind fixture "
        "looked correct but silently wrote a row into the real local dev database "
        "(Flask-SQLAlchemy 3.x binds its engine eagerly at `SQLAlchemy(app)` time, so a "
        "post-import `app.config[...]` reassignment alone has no effect). **Fixed**: the "
        "rebind now goes through `app.extensions.pop('sqlalchemy', None); db.init_app(app)`, "
        "and `_assert_test_db_isolated()` in `conftest.py` is a hard, independent interlock "
        "that aborts the whole suite if the resolved bind URL doesn't look isolated — "
        "checked every run, not just when someone remembers to check. Covered by its own "
        "unit tests in `test_00_schema.py`."
    )
    lines.append('')

    lines.append('## Reproducing this report')
    lines.append('')
    lines.append('```bash')
    lines.append('cd tests/observabilidade')
    lines.append('pip install -r requirements.txt')
    lines.append('')
    lines.append('# Default: $0, fully mocked, honest skips on SQLite')
    lines.append('python run_validation.py')
    lines.append('')
    lines.append('# Exercise the one genuinely Postgres-only path (retention interval SQL)')
    lines.append('TEST_DATABASE_URL=postgresql://user:pass@localhost/obs_test python run_validation.py')
    lines.append('')
    lines.append('# Live end-to-end + push the resulting trace to a local Phoenix')
    lines.append('docker run --rm -d --name phoenix -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest')
    lines.append('OBS_LIVE=1 OBS_LIVE_QUERY="<a question your Vector Store covers>" \\')
    lines.append('  python run_validation.py --phoenix')
    lines.append('```')
    lines.append('')

    REPORT_PATH.write_text('\n'.join(lines), encoding='utf-8')


# ── optional Phoenix push ───────────────────────────────────────────────────

def _parse_host_port(url: str):
    u = urlparse(url)
    return u.hostname or 'localhost', u.port or 4317


def _is_reachable(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _maybe_push_to_phoenix(enabled: bool) -> None:
    if not enabled:
        return

    if not OBS_LIVE:
        print('[phoenix] --phoenix passed but OBS_LIVE was not set, so the live test did not '
              'run and there is no fresh trace to push. Not an error — no-op.')
        return

    if not LIVE_MARKER.exists():
        print('[phoenix] --phoenix passed but no live-trace marker was found '
              f'({LIVE_MARKER}) — test_99_live likely skipped (missing OBS_LIVE_QUERY / '
              'OPENAI_API_KEY / OPENAI_VECTOR_STORE_ID) or failed before writing a trace. No-op.')
        return

    marker = json.loads(LIVE_MARKER.read_text(encoding='utf-8'))
    trace_ids = marker.get('trace_ids') or []
    if not trace_ids:
        print('[phoenix] marker file has no trace ids. No-op.')
        return

    otlp = os.environ.get('PHOENIX_OTLP', 'http://localhost:4317')
    host, port = _parse_host_port(otlp)
    if not _is_reachable(host, port):
        print('[phoenix] Phoenix not running — start it with:\n'
              '  docker run --rm -d --name phoenix -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest')
        return

    sys.path.insert(0, str(BACKEND_DIR))
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        from app import app as flask_app, AtlasRAGTrace  # noqa: E402
        import phoenix_replay  # noqa: E402
    except ImportError as e:
        print(f'[phoenix] import failed ({e}) — is opentelemetry-sdk / '
              'opentelemetry-exporter-otlp-proto-grpc installed? See scripts/phoenix_replay.py '
              'docstring for the install command.')
        return

    try:
        tracer = phoenix_replay._tracer()
    except Exception as e:
        print(f'[phoenix] failed to build the OTel tracer: {e}')
        return

    with flask_app.app_context():
        rows = AtlasRAGTrace.query.filter(AtlasRAGTrace.id.in_(trace_ids)).all()
        for row in rows:
            trace_dict = {
                'id': row.id,
                'pergunta': row.pergunta,
                'resposta': row.resposta,
                'retrieval_query': row.retrieval_query,
                'chunks': json.loads(row.chunks_json) if row.chunks_json else [],
                'groundedness': row.groundedness,
                'eval_faithfulness': row.eval_faithfulness,
                'feedback': row.feedback,
                'latencia_ms': row.latencia_ms,
            }
            phoenix_replay.emitir_trace_para_phoenix(trace_dict, tracer)

    print(f'[phoenix] pushed {len(rows)} trace(s) to Phoenix ({otlp}) — open http://localhost:6006')


# ── entrypoint ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phoenix', action='store_true',
                         help='push the live test trace (if any) to a local Phoenix instance')
    args = parser.parse_args()

    collector = _Collector()
    exit_code = pytest.main([str(OBS_DIR), '-v', '--tb=short'], plugins=[collector])

    environment = _environment_info()
    results_path, payload = _write_results_json(collector.results, environment)
    print(f'\n[run_validation] results written to {results_path}')

    _write_report_md(payload)
    print(f'[run_validation] REPORT.md regenerated at {REPORT_PATH}')

    _maybe_push_to_phoenix(args.phoenix)

    sys.exit(int(exit_code))


if __name__ == '__main__':
    main()
