"""
Tool-payload containment (2026-07-16 integrity plan, Prompt 1 §1).

atlas_buscar_conversas() used to return the full raw message dict for up to
6 messages across up to 10 conversations — including `artifact` (entire
generated documents/reports), `reasoning`, `tools`, `citations` — with only a
message-COUNT cap, no text-length cap. A single prior turn that generated a
report (e.g. via gerar_relatorio/get_dashboard) was enough to inflate a
single buscar_conversas call to tens of thousands of tokens (measured in the
prompt's report: ~37k tokens for a realistic 10-conversation history
containing one report-sized turn). This is the projection fix: role +
truncated text only, never the full message object.

Code review on the first version of this fix caught a real regression: the
projection above had no paired detail tool, so a 300-char snippet became a
dead end — the model could find that a conversation existed and had no way
to read it. atlas_ler_conversa (tested below) is the fix: the 'detalhe' half
of the list/detalhe split, mirroring ler_email for buscar_emails.

mcp_outlook_server.py's buscar_emails/ler_email split has no equivalent
pytest coverage here — that Flask app has no existing test harness in this
repo (confirmed: no file under tests/ or backend/tests/ references it before
this plan), and standing one up is out of proportion to this plan's scope.
It was smoke-tested manually instead (see the prompt's report for the
transcript) by driving buscar_emails/ler_email directly with a monkeypatched
graph_get, proving: buscar_emails never includes a body/corpo field, every
returned email carries an `id`, and ler_email(id) returns the full body for
exactly one message.
"""
import json

from datetime import datetime


def _msg(role, text, **extra):
    m = {'role': role, 'text': text}
    m.update(extra)
    return m


def test_buscar_conversas_projects_role_and_truncated_text_only(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='operacional')
    now = datetime.utcnow()

    long_report = 'X' * 5000  # stand-in for a real KPI report's markdown length
    msgs = [
        _msg('user', 'gere o relatorio de kpis'),
        _msg('assistant', long_report, artifact={'type': 'markdown', 'content': long_report},
             reasoning='Vou consultar o dashboard...', tools=['get_dashboard'],
             citations=[{'url': 'http://x', 'title': 'y'}], response_id='resp1'),
        _msg('user', 'obrigado'),
        _msg('assistant', 'De nada!'),
    ]

    with app.app_context():
        conversa = models.AtlasConversa(
            usuario_id=admin_id, conv_id='convA', titulo='Conversa de teste',
            msgs_json=json.dumps(msgs), history_json='[]', criada_em=now,
        )
        db.session.add(conversa)
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/conversas/buscar?q=')
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data) == 1
    resumo = data[0]['resumo']
    assert len(resumo) == 4

    # Every projected message has exactly role+texto — nothing else.
    for m in resumo:
        assert set(m.keys()) == {'role', 'texto'}

    long_entry = next(m for m in resumo if m['role'] == 'assistant' and len(m['texto']) > 10)
    assert len(long_entry['texto']) == models.CONVERSA_SNIPPET_MAX_CHARS
    assert long_entry['texto'] == long_report[:models.CONVERSA_SNIPPET_MAX_CHARS]


def test_buscar_conversas_caps_at_ten_conversations_six_messages(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='operacional')
    now = datetime.utcnow()

    with app.app_context():
        for i in range(15):
            msgs = [_msg('user' if j % 2 == 0 else 'assistant', f'msg{j}') for j in range(10)]
            db.session.add(models.AtlasConversa(
                usuario_id=admin_id, conv_id=f'conv{i}', titulo=f'Conversa {i}',
                msgs_json=json.dumps(msgs), history_json='[]',
                criada_em=now, atualizada_em=now,
            ))
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/conversas/buscar?q=')
    data = resp.get_json()
    assert len(data) == 10  # existing conversation-count cap, unchanged
    for conv in data:
        assert len(conv['resumo']) <= 6  # existing message-count cap, unchanged


# ── atlas_ler_conversa (detail tool) ────────────────────────────────────────

def test_ler_conversa_returns_full_text_for_small_conversation(app, db, models, make_user, make_client):
    """A conversation well under the character budget must come back
    un-truncated — the whole point of the detail tool is to NOT be a snippet."""
    admin_id = make_user(perfil='operacional')
    msgs = [
        _msg('user', 'o que discutimos sobre o cliente Kensys?'),
        _msg('assistant', 'Discutimos o atraso na entrega de fretes e o novo SLA proposto.'),
    ]
    with app.app_context():
        db.session.add(models.AtlasConversa(
            usuario_id=admin_id, conv_id='convKensys', titulo='Kensys',
            msgs_json=json.dumps(msgs), history_json='[]',
        ))
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/conversas/convKensys/ler')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['conv_id'] == 'convKensys'
    assert data['truncado'] is False
    assert data['total_disponivel'] == 2
    assert [m['role'] for m in data['mensagens']] == ['user', 'assistant']
    assert data['mensagens'][1]['texto'] == 'Discutimos o atraso na entrega de fretes e o novo SLA proposto.'


def test_ler_conversa_404_when_not_found_or_not_owned(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='operacional')
    outro_id = make_user(perfil='operacional')
    with app.app_context():
        db.session.add(models.AtlasConversa(
            usuario_id=outro_id, conv_id='convDoOutro', titulo='Não é sua',
            msgs_json=json.dumps([_msg('user', 'segredo')]), history_json='[]',
        ))
        db.session.commit()

    client = make_client(admin_id)
    # Doesn't exist at all.
    assert client.get('/api/atlas/conversas/nao-existe/ler').status_code == 404
    # Exists, but belongs to a different user — must 404, not leak content.
    resp = client.get('/api/atlas/conversas/convDoOutro/ler')
    assert resp.status_code == 404
    assert 'segredo' not in json.dumps(resp.get_json())


def test_ler_conversa_respects_total_char_budget(app, db, models, make_user, make_client):
    """The budget is TOTAL, not per-message x count — a conversation whose
    combined text exceeds CONVERSA_DETALHE_TOTAL_CHARS must come back capped
    and explicitly marked truncado=True, never silently."""
    admin_id = make_user(perfil='operacional')
    # 5 messages of 4000 chars each = 20000 total, well over the 12000 budget.
    msgs = [_msg('user' if i % 2 == 0 else 'assistant', f'msg{i}-' + ('Y' * 4000)) for i in range(5)]
    with app.app_context():
        db.session.add(models.AtlasConversa(
            usuario_id=admin_id, conv_id='convGrande', titulo='Grande',
            msgs_json=json.dumps(msgs), history_json='[]',
        ))
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/conversas/convGrande/ler')
    data = resp.get_json()
    assert data['truncado'] is True
    assert data['total_disponivel'] == 5
    total_chars_returned = sum(len(m['texto']) for m in data['mensagens'])
    assert total_chars_returned <= models.CONVERSA_DETALHE_TOTAL_CHARS
    # Order is still chronological in the output despite budgeting from the
    # most-recent message backward internally.
    textos = [m['texto'] for m in data['mensagens']]
    indices = [int(t.split('-')[0].replace('msg', '')) for t in textos if t.startswith('msg')]
    assert indices == sorted(indices)


def test_ler_conversa_never_exceeds_message_count_ceiling(app, db, models, make_user, make_client):
    admin_id = make_user(perfil='operacional')
    msgs = [_msg('user' if i % 2 == 0 else 'assistant', f'm{i}') for i in range(80)]
    with app.app_context():
        db.session.add(models.AtlasConversa(
            usuario_id=admin_id, conv_id='convLonga', titulo='Longa',
            msgs_json=json.dumps(msgs), history_json='[]',
        ))
        db.session.commit()

    client = make_client(admin_id)
    resp = client.get('/api/atlas/conversas/convLonga/ler')
    data = resp.get_json()
    assert data['total_disponivel'] == 80
    assert len(data['mensagens']) <= models.CONVERSA_DETALHE_MAX_MSGS
    assert data['truncado'] is True
