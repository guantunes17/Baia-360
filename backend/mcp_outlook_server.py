"""
MCP Outlook Server — Baia 360 Fase 4b
Roda na porta 5002. Recebe chamadas do Flask (app.py) via JSON-RPC
e executa requisições ao Microsoft Graph API.

Tools disponíveis:
  - get_agenda        → GET  /me/calendarView
  - criar_evento      → POST /me/events
  - buscar_emails     → GET  /me/messages
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv
from pathlib import Path

# Carrega o mesmo .env do backend principal
_env_path = Path(__file__).resolve().parent / '.env'
load_dotenv(dotenv_path=_env_path, override=True)

app = Flask(__name__)
CORS(app, origins=["http://localhost:5001"])  # Só aceita chamadas do Flask principal

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


# ── Helpers ───────────────────────────────────────────────────────────────────

def graph_get(access_token: str, endpoint: str, params: dict = None):
    """Faz GET no Microsoft Graph com o token do usuário."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    resp = requests.get(f"{GRAPH_BASE}{endpoint}", headers=headers, params=params)
    resp.raise_for_status()
    return resp.json()


def graph_post(access_token: str, endpoint: str, body: dict):
    """Faz POST no Microsoft Graph com o token do usuário."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    resp = requests.post(f"{GRAPH_BASE}{endpoint}", headers=headers, json=body)
    resp.raise_for_status()
    return resp.json()


def erro(msg: str, code: int = 400):
    return jsonify({"erro": msg}), code


# ── Tools ─────────────────────────────────────────────────────────────────────

@app.route("/tools/get_agenda", methods=["POST"])
def get_agenda():
    """
    Retorna eventos do calendário do usuário em um período.

    Body esperado:
      access_token : str  — token OAuth do usuário
      data_inicio  : str  — YYYY-MM-DD
      data_fim     : str  — YYYY-MM-DD
    """
    data = request.get_json()
    token = data.get("access_token")
    data_inicio = data.get("data_inicio")
    data_fim = data.get("data_fim")

    if not all([token, data_inicio, data_fim]):
        return erro("Campos obrigatórios: access_token, data_inicio, data_fim")

    try:
        # calendarView retorna eventos que ocorrem dentro do intervalo
        params = {
            "startDateTime": f"{data_inicio}T00:00:00",
            "endDateTime":   f"{data_fim}T23:59:59",
            "$select":       "subject,start,end,location,organizer,isAllDay,bodyPreview",
            "$orderby":      "start/dateTime",
            "$top":          50
        }
        resultado = graph_get(token, "/me/calendarView", params=params)
        eventos = []
        for ev in resultado.get("value", []):
            eventos.append({
                "titulo":      ev.get("subject", "Sem título"),
                "inicio":      ev.get("start", {}).get("dateTime", ""),
                "fim":         ev.get("end", {}).get("dateTime", ""),
                "local":       ev.get("location", {}).get("displayName", ""),
                "organizador": ev.get("organizer", {}).get("emailAddress", {}).get("name", ""),
                "dia_inteiro": ev.get("isAllDay", False),
                "resumo":      ev.get("bodyPreview", "")
            })
        return jsonify({"eventos": eventos, "total": len(eventos)})

    except requests.HTTPError as e:
        return erro(f"Erro ao acessar o Graph: {e.response.status_code} — {e.response.text}", 502)
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/criar_evento", methods=["POST"])
def criar_evento():
    """
    Cria um evento no calendário do usuário.

    Body esperado:
      access_token : str
      titulo       : str
      data         : str  — YYYY-MM-DD
      hora_inicio  : str  — HH:MM
      hora_fim     : str  — HH:MM
      descricao    : str  (opcional)
      local        : str  (opcional)
    """
    data = request.get_json()
    token       = data.get("access_token")
    titulo      = data.get("titulo")
    data_ev     = data.get("data")
    hora_inicio = data.get("hora_inicio")
    hora_fim    = data.get("hora_fim")
    descricao   = data.get("descricao", "")
    local       = data.get("local", "")

    if not all([token, titulo, data_ev, hora_inicio, hora_fim]):
        return erro("Campos obrigatórios: access_token, titulo, data, hora_inicio, hora_fim")

    try:
        # Monta o fuso horário do Brasil (Brasília)
        tz = "America/Sao_Paulo"
        body = {
            "subject": titulo,
            "start": {
                "dateTime": f"{data_ev}T{hora_inicio}:00",
                "timeZone": tz
            },
            "end": {
                "dateTime": f"{data_ev}T{hora_fim}:00",
                "timeZone": tz
            },
            "body": {
                "contentType": "text",
                "content": descricao
            },
            "location": {
                "displayName": local
            }
        }
        resultado = graph_post(token, "/me/events", body)
        return jsonify({
            "ok": True,
            "evento_id": resultado.get("id"),
            "titulo":    resultado.get("subject"),
            "inicio":    resultado.get("start", {}).get("dateTime"),
            "fim":       resultado.get("end", {}).get("dateTime"),
            "link":      resultado.get("webLink")
        })

    except requests.HTTPError as e:
        return erro(f"Erro ao criar evento: {e.response.status_code} — {e.response.text}", 502)
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/buscar_emails", methods=["POST"])
def buscar_emails():
    """
    Busca e-mails na caixa do usuário.

    Body esperado:
      access_token : str
      query        : str  — texto livre (assunto, remetente, etc.)
      apenas_nao_lidos : bool (opcional, default False)
      limite       : int  (opcional, default 20)
    """
    data = request.get_json()
    token           = data.get("access_token")
    query           = data.get("query", "")
    apenas_nao_lidos = data.get("apenas_nao_lidos", False)
    limite          = min(data.get("limite", 20), 50)  # máximo 50

    if not token:
        return erro("Campo obrigatório: access_token")

    try:
        params = {
            "$select":  "subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments",
            "$orderby": "receivedDateTime desc",
            "$top":     limite
        }

        # Monta filtro
        filtros = []
        if query:
            params["$search"] = f'"{query}"'
        if apenas_nao_lidos:
            filtros.append("isRead eq false")
        if filtros and not query:  # $search e $filter não podem coexistir no Graph
            params["$filter"] = " and ".join(filtros)

        resultado = graph_get(token, "/me/messages", params=params)
        emails = []
        for msg in resultado.get("value", []):
            emails.append({
                "assunto":      msg.get("subject", "Sem assunto"),
                "remetente":    msg.get("from", {}).get("emailAddress", {}).get("name", ""),
                "email_de":     msg.get("from", {}).get("emailAddress", {}).get("address", ""),
                "recebido_em":  msg.get("receivedDateTime", ""),
                "lido":         msg.get("isRead", True),
                "tem_anexo":    msg.get("hasAttachments", False),
                "resumo":       msg.get("bodyPreview", "")
            })
        return jsonify({"emails": emails, "total": len(emails)})

    except requests.HTTPError as e:
        return erro(f"Erro ao buscar e-mails: {e.response.status_code} — {e.response.text}", 502)
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/eventos_proximos", methods=["POST"])
def eventos_proximos():
    """
    Retorna eventos das próximas horas para notificação proativa.
    Usado pelo outlookNotifier.ts ao montar o Atlas.

    Body esperado:
      access_token   : str
      horas_ahead    : int (opcional, default 24)
    """
    data = request.get_json()
    token      = data.get("access_token")
    horas_ahead = data.get("horas_ahead", 24)

    if not token:
        return erro("Campo obrigatório: access_token")

    try:
        from datetime import datetime, timedelta
        agora = datetime.utcnow()
        fim   = agora + timedelta(hours=horas_ahead)

        params = {
            "startDateTime": agora.strftime("%Y-%m-%dT%H:%M:%S"),
            "endDateTime":   fim.strftime("%Y-%m-%dT%H:%M:%S"),
            "$select":       "subject,start,end,location,isAllDay",
            "$orderby":      "start/dateTime",
            "$top":          10
        }
        resultado = graph_get(token, "/me/calendarView", params=params)
        eventos = []
        for ev in resultado.get("value", []):
            inicio_str = ev.get("start", {}).get("dateTime", "")
            eventos.append({
                "titulo":      ev.get("subject", "Sem título"),
                "inicio":      inicio_str,
                "fim":         ev.get("end", {}).get("dateTime", ""),
                "local":       ev.get("location", {}).get("displayName", ""),
                "dia_inteiro": ev.get("isAllDay", False)
            })
        return jsonify({"eventos": eventos, "total": len(eventos)})

    except requests.HTTPError as e:
        return erro(f"Erro Graph: {e.response.status_code} — {e.response.text}", 502)
    except Exception as e:
        return erro(str(e), 500)



@app.route("/tools/enviar_email", methods=["POST"])
def enviar_email():
    """
    Envia um e-mail pelo Outlook do usuário.

    Body esperado:
      access_token      : str  — token OAuth do usuário
      destinatario      : str  — endereço de e-mail
      assunto           : str
      corpo             : str  — texto do e-mail (plain text)
      nome_destinatario : str  (opcional)
    """
    data = request.get_json()
    token             = data.get("access_token")
    destinatario      = data.get("destinatario")
    assunto           = data.get("assunto")
    corpo             = data.get("corpo")
    nome_destinatario = data.get("nome_destinatario", "")

    if not all([token, destinatario, assunto, corpo]):
        return erro("Campos obrigatórios: access_token, destinatario, assunto, corpo")

    try:
        # Monta o payload conforme Microsoft Graph sendMail
        payload = {
            "message": {
                "subject": assunto,
                "body": {
                    "contentType": "Text",
                    "content": corpo
                },
                "toRecipients": [
                    {
                        "emailAddress": {
                            "address": destinatario,
                            "name": nome_destinatario or destinatario
                        }
                    }
                ]
            },
            "saveToSentItems": True   # salva na pasta Enviados do Outlook
        }
        # POST /me/sendMail não retorna body (204 No Content) — apenas verifica status
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        resp = requests.post(
            f"{GRAPH_BASE}/me/sendMail",
            headers=headers,
            json=payload
        )
        resp.raise_for_status()
        return jsonify({
            "ok": True,
            "destinatario": destinatario,
            "assunto": assunto,
            "mensagem": "E-mail enviado com sucesso e salvo em Enviados."
        })

    except requests.HTTPError as e:
        return erro(f"Erro ao enviar e-mail: {e.response.status_code} — {e.response.text}", 502)
    except Exception as e:
        return erro(str(e), 500)


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "servico": "mcp_outlook_server", "porta": 5002})

# ── Teams ─────────────────────────────────────────────────────────────────────

@app.route("/tools/teams_listar_times", methods=["POST"])
def teams_listar_times():
    """Lista os times do Microsoft Teams do usuário."""
    data  = request.get_json(force=True)
    token = data.get("access_token", "")
    if not token:
        return erro("access_token obrigatório")
    try:
        resultado = graph_get(token, "/me/joinedTeams")
        times = []
        for t in resultado.get("value", []):
            times.append({
                "id":          t.get("id"),
                "nome":        t.get("displayName"),
                "descricao":   t.get("description", ""),
            })
        return jsonify({"times": times, "total": len(times)})
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/teams_listar_canais", methods=["POST"])
def teams_listar_canais():
    """Lista os canais de um time específico."""
    data    = request.get_json(force=True)
    token   = data.get("access_token", "")
    team_id = data.get("team_id", "")
    if not token or not team_id:
        return erro("access_token e team_id obrigatórios")
    try:
        resultado = graph_get(token, f"/teams/{team_id}/channels")
        canais = []
        for c in resultado.get("value", []):
            canais.append({
                "id":    c.get("id"),
                "nome":  c.get("displayName"),
                "tipo":  c.get("membershipType", "standard"),
            })
        return jsonify({"canais": canais, "total": len(canais)})
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/teams_enviar_mensagem", methods=["POST"])
def teams_enviar_mensagem():
    """Envia uma mensagem em um canal do Teams."""
    data       = request.get_json(force=True)
    token      = data.get("access_token", "")
    team_id    = data.get("team_id", "")
    channel_id = data.get("channel_id", "")
    mensagem   = data.get("mensagem", "")
    if not token or not team_id or not channel_id or not mensagem:
        return erro("access_token, team_id, channel_id e mensagem obrigatórios")
    try:
        body = {"body": {"content": mensagem, "contentType": "text"}}
        resultado = graph_post(token, f"/teams/{team_id}/channels/{channel_id}/messages", body)
        return jsonify({
            "ok":         True,
            "mensagem_id": resultado.get("id"),
            "enviada_em":  resultado.get("createdDateTime"),
        })
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/teams_criar_reuniao", methods=["POST"])
def teams_criar_reuniao():
    """Cria uma reunião online no Microsoft Teams."""
    data        = request.get_json(force=True)
    token       = data.get("access_token", "")
    titulo      = data.get("titulo", "Reunião")
    inicio      = data.get("inicio", "")   # ISO 8601 ex: 2026-04-15T14:00:00
    fim         = data.get("fim", "")      # ISO 8601 ex: 2026-04-15T15:00:00
    participantes = data.get("participantes", [])  # lista de e-mails
    if not token or not inicio or not fim:
        return erro("access_token, inicio e fim obrigatórios")
    try:
        body = {
            "subject": titulo,
            "startDateTime": inicio,
            "endDateTime":   fim,
            "isOnlineMeeting": True,
            "onlineMeetingProvider": "teamsForBusiness",
        }
        if participantes:
            body["attendees"] = [
                {"emailAddress": {"address": email}, "type": "required"}
                for email in participantes
            ]
        resultado = graph_post(token, "/me/events", body)
        link = resultado.get("onlineMeeting", {}).get("joinUrl", "")
        return jsonify({
            "ok":            True,
            "evento_id":     resultado.get("id"),
            "titulo":        resultado.get("subject"),
            "inicio":        resultado.get("start", {}).get("dateTime"),
            "fim":           resultado.get("end", {}).get("dateTime"),
            "link_reuniao":  link,
            "link_evento":   resultado.get("webLink"),
        })
    except Exception as e:
        return erro(str(e), 500)


@app.route("/tools/teams_chat_enviar", methods=["POST"])
def teams_chat_enviar():
    """Envia uma mensagem direta (chat) para um usuário no Teams."""
    data         = request.get_json(force=True)
    token        = data.get("access_token", "")
    email_destino = data.get("email_destino", "")
    mensagem     = data.get("mensagem", "")
    if not token or not email_destino or not mensagem:
        return erro("access_token, email_destino e mensagem obrigatórios")
    try:
        # Cria ou recupera o chat direto
        chat_body = {
            "chatType": "oneOnOne",
            "members": [
                {"@odata.type": "#microsoft.graph.aadUserConversationMember", "roles": ["owner"],
                 "user@odata.bind": "https://graph.microsoft.com/v1.0/users('me')"},
                {"@odata.type": "#microsoft.graph.aadUserConversationMember", "roles": ["owner"],
                 "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{email_destino}')"},
            ]
        }
        chat = graph_post(token, "/chats", chat_body)
        chat_id = chat.get("id")
        if not chat_id:
            return erro("Não foi possível criar o chat")
        msg_body = {"body": {"content": mensagem, "contentType": "text"}}
        resultado = graph_post(token, f"/chats/{chat_id}/messages", msg_body)
        return jsonify({
            "ok":         True,
            "chat_id":    chat_id,
            "mensagem_id": resultado.get("id"),
        })
    except Exception as e:
        return erro(str(e), 500)

if __name__ == "__main__":
    print("🔌 MCP Outlook Server rodando na porta 5002")
    app.run(host="0.0.0.0", port=5002, debug=False)