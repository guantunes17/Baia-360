"""
Fixtures for the Atlas prompt-injection red-team baseline suite.

Auth strategy: everything goes through the app's real HTTP routes — no direct
DB access, no manually-minted JWTs. We log in as the existing admin account
(bootstrapped the same way the rest of the test suite does, see
backend/tests/run_api_tests.py), use it to sign up + approve a throwaway
"redteam" user via the real /api/auth/cadastro + /api/auth/usuarios/<id>/aprovar
routes, and log that user in via the real /api/auth/login route. The resulting
requests.Session carries the same httpOnly JWT cookie a real browser would get.
The throwaway user is deleted via the real DELETE route on teardown.
"""
import json
import os
import secrets
import string
from datetime import date
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

REDTEAM_DIR = Path(__file__).resolve().parent
BACKEND_ENV = REDTEAM_DIR.parent.parent / 'backend' / '.env'

# Load backend/.env values as *fallback defaults only* — real process env
# (e.g. exported by CI) always wins. This lets the suite "just work" against
# a local dev backend without re-declaring secrets.
_backend_env = dotenv_values(BACKEND_ENV) if BACKEND_ENV.exists() else {}


def _cfg(name: str, default: str = '') -> str:
    return os.environ.get(name) or _backend_env.get(name.replace('REDTEAM_', ''), '') or default


BASE_URL       = _cfg('REDTEAM_BASE_URL', 'http://localhost:5001').rstrip('/')
ADMIN_EMAIL    = _cfg('REDTEAM_ADMIN_EMAIL', _backend_env.get('ADMIN_EMAIL', ''))
ADMIN_SENHA    = _cfg('REDTEAM_ADMIN_SENHA', _backend_env.get('ADMIN_SENHA', ''))
SEED_KEY       = _cfg('REDTEAM_SEED_KEY', _backend_env.get('SEED_KEY', ''))
OPENAI_API_KEY = _cfg('OPENAI_API_KEY', _backend_env.get('OPENAI_API_KEY', ''))
JUDGE_MODEL    = os.environ.get('REDTEAM_JUDGE_MODEL', 'gpt-4o-mini')
VECTOR_STORE_ID = os.environ.get('REDTEAM_VECTOR_STORE_ID', '').strip()

# Phase 5: same harness, different report name — pass REDTEAM_REPORT_PREFIX=post_hardening
# for the post-hardening re-measurement so it never collides with the Phase 1 baseline file.
REPORT_PREFIX = os.environ.get('REDTEAM_REPORT_PREFIX', 'baseline')

# Egress policy, read the same way app.py reads it — used by test_gate_enforcement.py
# to assert the *correct* outcome (block vs warn) for whatever policy is actually configured,
# rather than assuming one fixed behavior.
ATLAS_BLOQUEAR_EXTERNO = _cfg('ATLAS_BLOQUEAR_EXTERNO', 'false').strip().lower() == 'true'
ATLAS_EGRESSO_DOMINIOS_INTERNOS = _cfg('ATLAS_EGRESSO_DOMINIOS_INTERNOS', '')

RESULTS_DIR = REDTEAM_DIR / 'results'
RESULTS_DIR.mkdir(exist_ok=True)


def _random_password() -> str:
    # Meets /api/auth/cadastro policy: 8+ chars, 1 uppercase, 1 special char.
    body = ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    return f"Rt{body}!"


@pytest.fixture(scope='session')
def base_url():
    return BASE_URL


@pytest.fixture(scope='session')
def admin_session():
    if not ADMIN_EMAIL or not ADMIN_SENHA:
        pytest.skip('ADMIN_EMAIL/ADMIN_SENHA not configured (env or backend/.env) — cannot bootstrap red-team user')

    session = requests.Session()
    resp = session.post(f"{BASE_URL}/api/auth/login", json={'email': ADMIN_EMAIL, 'senha': ADMIN_SENHA}, timeout=15)

    if resp.status_code != 200 and SEED_KEY:
        # Admin doesn't exist yet on a fresh DB — seed it via the real /api/auth/seed route.
        session.post(f"{BASE_URL}/api/auth/seed", json={'seed_key': SEED_KEY}, timeout=15)
        resp = session.post(f"{BASE_URL}/api/auth/login", json={'email': ADMIN_EMAIL, 'senha': ADMIN_SENHA}, timeout=15)

    if resp.status_code != 200:
        pytest.skip(f"Could not authenticate as admin ({ADMIN_EMAIL}) against {BASE_URL}: "
                    f"{resp.status_code} {resp.text[:200]}")
    return session


@pytest.fixture(scope='session')
def redteam_user(admin_session):
    """Provisions a throwaway low-privilege user via the real signup/approve flow."""
    token = secrets.token_hex(6)
    domain = ADMIN_EMAIL.split('@', 1)[1] if '@' in ADMIN_EMAIL else 'baia360.com'
    email = f"redteam.{token}@{domain}"
    senha = _random_password()

    resp = requests.post(f"{BASE_URL}/api/auth/cadastro", json={
        'nome': f'RedTeam Bot {token}',
        'email': email,
        'senha': senha,
        'senha_confirmacao': senha,
    }, timeout=15)
    if resp.status_code != 201:
        pytest.skip(f"Could not sign up red-team user: {resp.status_code} {resp.text[:200]}")

    users = admin_session.get(f"{BASE_URL}/api/auth/usuarios", timeout=15).json()
    match = next((u for u in users if u['email'] == email), None)
    if not match:
        pytest.skip('Red-team user not found after signup')
    user_id = match['id']

    aprova = admin_session.post(f"{BASE_URL}/api/auth/usuarios/{user_id}/aprovar",
                                 json={'perfil': 'operacional'}, timeout=15)
    if aprova.status_code != 200:
        pytest.skip(f"Could not approve red-team user: {aprova.status_code} {aprova.text[:200]}")

    yield {'id': user_id, 'email': email, 'senha': senha, 'domain': domain}

    admin_session.delete(f"{BASE_URL}/api/auth/usuarios/{user_id}", timeout=15)


@pytest.fixture(scope='session')
def redteam_session(redteam_user):
    session = requests.Session()
    resp = session.post(f"{BASE_URL}/api/auth/login",
                         json={'email': redteam_user['email'], 'senha': redteam_user['senha']}, timeout=15)
    if resp.status_code != 200:
        pytest.skip(f"Could not log in as red-team user: {resp.status_code} {resp.text[:200]}")
    return session


@pytest.fixture(scope='session')
def internal_domain(redteam_user):
    return redteam_user['domain']


@pytest.fixture(scope='session')
def openai_api_key():
    if not OPENAI_API_KEY:
        pytest.skip('OPENAI_API_KEY not configured — cannot run the LLM judge')
    return OPENAI_API_KEY


# ── Aggregation across the whole run — written once at session end ──────────
_ALL_RESULTS = []
_GATE_CHECKS = []


def record_result(result: dict):
    _ALL_RESULTS.append(result)


def record_gate_check(name: str, passed: bool, detail: str = ''):
    """Records a Phase 5 gate-enforcement check (direct route/token test) —
    these are independent of the payload corpus, so they get their own bucket
    in the report rather than being folded into successful_injection_rate."""
    _GATE_CHECKS.append({'name': name, 'passed': passed, 'detail': detail})


def pytest_sessionfinish(session, exitstatus):
    if not _ALL_RESULTS and not _GATE_CHECKS:
        return

    by_category = {}
    direct_execution_attempts_total = 0
    direct_execution_blocked_total = 0
    for r in _ALL_RESULTS:
        cat = r['category']
        by_category.setdefault(cat, {'total': 0, 'evaluated': 0, 'successful_injections': 0, 'skipped': 0})
        bucket = by_category[cat]
        bucket['total'] += 1
        if r.get('skipped'):
            bucket['skipped'] += 1
        else:
            bucket['evaluated'] += 1
            if r.get('success'):
                bucket['successful_injections'] += 1
        for attempt in r.get('direct_execution_attempts', []):
            direct_execution_attempts_total += 1
            if attempt.get('blocked'):
                direct_execution_blocked_total += 1

    def _rate(bucket):
        return round(bucket['successful_injections'] / bucket['evaluated'], 4) if bucket['evaluated'] else None

    per_category = {
        cat: {**bucket, 'successful_injection_rate': _rate(bucket)}
        for cat, bucket in by_category.items()
    }

    evaluated_total = sum(b['evaluated'] for b in by_category.values())
    success_total = sum(b['successful_injections'] for b in by_category.values())

    gate_checks_passed = sum(1 for c in _GATE_CHECKS if c['passed'])
    action_vector_bypass_total = (
        (len(_GATE_CHECKS) - gate_checks_passed) +
        (direct_execution_attempts_total - direct_execution_blocked_total)
    )
    action_vector_attempts_total = len(_GATE_CHECKS) + direct_execution_attempts_total

    report = {
        'generated_at': date.today().isoformat(),
        'base_url': BASE_URL,
        'judge_model': JUDGE_MODEL,
        # ── Model-compliance metric (payload corpus — same shape as Phase 1) ──
        'total_payloads': len(_ALL_RESULTS),
        'evaluated_payloads': evaluated_total,
        'skipped_payloads': len(_ALL_RESULTS) - evaluated_total,
        'overall_successful_injection_rate': round(success_total / evaluated_total, 4) if evaluated_total else None,
        'per_category': per_category,
        'results': _ALL_RESULTS,
        # ── Action-vector execution metric (Phase 2/4 gate — new in Phase 5) ──
        'gate_checks': _GATE_CHECKS,
        'gate_checks_passed': gate_checks_passed,
        'gate_checks_total': len(_GATE_CHECKS),
        'direct_execution_attempts_total': direct_execution_attempts_total,
        'direct_execution_blocked_total': direct_execution_blocked_total,
        'action_vector_execution_rate': (
            round(action_vector_bypass_total / action_vector_attempts_total, 4)
            if action_vector_attempts_total else None
        ),
    }

    out_path = RESULTS_DIR / f"{REPORT_PREFIX}_{date.today().strftime('%Y%m%d')}.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"\n[redteam] report written to {out_path}")
