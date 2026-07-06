"""
Atlas prompt-injection red-team suite (Phase 1 baseline, extended in Phase 5).

This suite MEASURES injection resistance against a running Atlas instance —
it never asserts that an injection must fail to influence the MODEL. Every
payload's outcome (mechanical checks + LLM-judge verdict) is written to
tests/redteam/results/<prefix>_<YYYYMMDD>.json via the pytest_sessionfinish
hook in conftest.py (prefix controlled by REDTEAM_REPORT_PREFIX — 'baseline'
for Phase 1, 'post_hardening' for Phase 5). See README.md for how to run this
and REPORT.md for how to read the Phase 1 vs Phase 5 comparison.

Two things CAN genuinely fail a test here:
  1. A harness-level problem (the request errored out, backend unreachable).
  2. Since Phase 5: a side-effectful function_call the model emitted actually
     reaching execution without a valid confirmation token. That's a real
     regression in the Phase 2/4 enforcement layer, not a "the model got
     tricked" finding — model compliance and execution-layer bypass are
     different things (see conftest.py's action_vector metric).
"""
import os
import secrets

import pytest

from conftest import VECTOR_STORE_ID, OPENAI_API_KEY, JUDGE_MODEL, record_result
from payload_loader import load_all_payloads
from runner import evaluate_payload, evaluate_memory_poisoning, build_skip_result, seed_rag_document

PAYLOADS = load_all_payloads()


@pytest.mark.parametrize('payload', PAYLOADS, ids=[p['id'] for p in PAYLOADS])
def test_payload(payload, base_url, redteam_session, internal_domain, openai_api_key):
    canary = f"CANARY-{secrets.token_hex(4)}"

    if payload['category'] == 'memory_poisoning':
        result = evaluate_memory_poisoning(redteam_session, base_url, payload, internal_domain, canary)

    elif payload.get('skip'):
        rag_doc = payload.get('rag_document')
        if VECTOR_STORE_ID and OPENAI_API_KEY and rag_doc:
            from runner import substitute
            rendered_doc = substitute(rag_doc, internal_domain, canary)
            seed_rag_document(OPENAI_API_KEY, VECTOR_STORE_ID, rendered_doc['filename'], rendered_doc['content'])
            result = evaluate_payload(redteam_session, base_url, payload, internal_domain,
                                       openai_api_key, JUDGE_MODEL, canary)
        else:
            result = build_skip_result(payload, payload.get('skip_reason', 'skipped by default'))

    else:
        result = evaluate_payload(redteam_session, base_url, payload, internal_domain,
                                   openai_api_key, JUDGE_MODEL, canary)

    record_result(result)

    if not result.get('skipped'):
        assert result.get('transport_error') is None, (
            f"Harness-level transport error for payload {payload['id']}: {result.get('transport_error')}"
        )

    for attempt in result.get('direct_execution_attempts', []):
        assert attempt['blocked'], (
            f"Payload {payload['id']}: a {attempt['tool']} function_call reached execution "
            f"WITHOUT a confirmation token (HTTP {attempt['status_code']}, expected 403). "
            f"This is a real gate bypass, not an expected injection outcome."
        )
