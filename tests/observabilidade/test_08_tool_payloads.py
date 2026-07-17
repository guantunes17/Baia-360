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
