"""
Direct-unit coverage of avaliar_egresso() under BOTH ATLAS_BLOQUEAR_EXTERNO
configurations. Deliberately breaks this suite's usual HTTP-only pattern (see
conftest.py's module docstring) for this one function only — worth explaining
why, since every other file here talks exclusively to a live backend over HTTP.

test_gate_enforcement.py's test_egress_policy_enforced hits an
ALREADY-RUNNING backend over HTTP, so it can only ever observe whichever ONE
config that process happens to have been started with — there's no way to
"exercise both configurations" against a single live server without
restarting it mid-suite. avaliar_egresso() is a pure function of
(destinatario, os.environ) though, so the mechanism itself can be verified
directly and deterministically, independent of whatever the live server under
test currently has configured.

This is what closes the gap the 2026-07-16 observability plan flagged: the
last published redteam report (results/post_prompt6_20260715.json, "34/34")
only ever proved the mechanism blocks when ATLAS_BLOQUEAR_EXTERNO=true was set
to match the harness — it never proved, or disclosed in the artifact itself,
what happens under production's actual configuration (the var is unset there
-> defaults false -> the control is warn-only, never blocks). The honest
caveat lived in a chat message, not in the repo. See
test_avaliar_egresso_matches_production_default_today below, and
conftest.py's config_fingerprint in the results JSON.
"""
import importlib
import sys
from pathlib import Path

import pytest

REDTEAM_DIR = Path(__file__).resolve().parent
BACKEND_DIR = REDTEAM_DIR.parent.parent / 'backend'
sys.path.insert(0, str(BACKEND_DIR))

from conftest import record_gate_check  # noqa: E402


@pytest.fixture(scope='module')
def avaliar_egresso():
    try:
        app_module = importlib.import_module('app')
    except Exception as e:
        pytest.skip(f"could not import backend/app.py directly for a mechanism-level unit test: {e}")
    return app_module.avaliar_egresso


@pytest.mark.parametrize('bloquear_externo', [True, False])
def test_avaliar_egresso_external_recipient(avaliar_egresso, monkeypatch, bloquear_externo):
    """The mechanism must block external recipients when the flag is true,
    and only warn (never block) when it's false — proven directly, not
    inferred from whatever the live server under test happens to run."""
    monkeypatch.setenv('ATLAS_BLOQUEAR_EXTERNO', 'true' if bloquear_externo else 'false')
    monkeypatch.setenv('ATLAS_EGRESSO_DOMINIOS_INTERNOS', 'baia360.com.br')
    resultado = avaliar_egresso('atacante@fora-da-empresa-xyz.com')
    passed = resultado['externo'] is True and resultado['bloqueado'] is bloquear_externo
    record_gate_check(f'avaliar_egresso_direct:external:bloquear_externo={bloquear_externo}', passed,
                       f'resultado={resultado}')
    assert resultado['externo'] is True
    assert resultado['bloqueado'] is bloquear_externo


@pytest.mark.parametrize('bloquear_externo', [True, False])
def test_avaliar_egresso_internal_recipient_never_blocked(avaliar_egresso, monkeypatch, bloquear_externo):
    """A recipient on the configured internal allow-list is never external,
    never blocked — regardless of ATLAS_BLOQUEAR_EXTERNO."""
    monkeypatch.setenv('ATLAS_BLOQUEAR_EXTERNO', 'true' if bloquear_externo else 'false')
    monkeypatch.setenv('ATLAS_EGRESSO_DOMINIOS_INTERNOS', 'baia360.com.br')
    resultado = avaliar_egresso('colega@baia360.com.br')
    passed = resultado['externo'] is False and resultado['bloqueado'] is False
    record_gate_check(f'avaliar_egresso_direct:internal:bloquear_externo={bloquear_externo}', passed,
                       f'resultado={resultado}')
    assert resultado['externo'] is False
    assert resultado['bloqueado'] is False


def test_avaliar_egresso_matches_production_default_today(avaliar_egresso, monkeypatch):
    """Documents the actual production gap this plan found: with
    ATLAS_BLOQUEAR_EXTERNO unset (production's real state) and no allow-list
    configured, every recipient is treated as external and NONE are ever
    blocked — the control is warn-only today, not enforced. If this test
    starts failing, production's default egress behaviour changed and the
    plan's finding needs re-checking against reality."""
    monkeypatch.delenv('ATLAS_BLOQUEAR_EXTERNO', raising=False)
    monkeypatch.delenv('ATLAS_EGRESSO_DOMINIOS_INTERNOS', raising=False)
    resultado = avaliar_egresso('qualquer-destinatario@qualquer-dominio.com')
    passed = resultado['externo'] is True and resultado['bloqueado'] is False
    record_gate_check('avaliar_egresso_direct:production_default_is_inert', passed, f'resultado={resultado}')
    assert resultado['externo'] is True
    assert resultado['bloqueado'] is False
    assert resultado['origem'] == 'sem_allowlist_configurada'
