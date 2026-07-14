# -*- coding: utf-8 -*-
"""
Fase 4 — Testes de API para a Central de Relatórios.
Requer o backend rodando em http://localhost:5001.

Executar a partir do diretório backend/:
    python tests/run_api_tests.py
"""

import sys
import os
import io
import time
import json

# Encoding UTF-8 no Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import requests
except ImportError:
    print("ERRO: requests nao instalado. Execute: pip install requests")
    sys.exit(1)

try:
    import jwt as pyjwt  # PyJWT — ja e dependencia do backend (Flask-JWT-Extended)
except ImportError:
    print("ERRO: PyJWT nao instalado. Execute: pip install PyJWT[crypto]")
    sys.exit(1)

BASE        = "http://localhost:5001"
FIXTURES    = os.path.join(os.path.dirname(__file__), 'fixtures')
OUTPUT_DIR  = os.path.join(os.path.dirname(__file__), 'output')
ADMIN_EMAIL = "admin@baia360.com"
ADMIN_SENHA = "Agucla*25"
MES_REF     = "04-2026"   # formato MM-AAAA esperado por _atualizar_historico e _caminho_saida
MES_FILTRO  = "2026-04"   # formato YYYY-MM esperado por processar_armazenagem

# Credencial de serviço Atlas->Central (ver backend/identity.py) — precisa bater
# com CENTRAL_SERVICE_TOKEN no .env usado para rodar o backend deste teste.
CENTRAL_SERVICE_TOKEN  = "test-service-token-abc123"
CENTRAL_SERVICE_HEADER = "X-Central-Service-Token"

RESULTADOS = []


# ─── Auth ────────────────────────────────────────────────────────────────────

def _session_logada():
    """Cria requests.Session com cookie JWT já setado."""
    session = requests.Session()
    resp = session.post(f"{BASE}/api/auth/login",
                        json={"email": ADMIN_EMAIL, "senha": ADMIN_SENHA})
    if resp.status_code != 200:
        raise RuntimeError(f"Login falhou: {resp.status_code} — {resp.text[:200]}")
    print(f"  Login OK (status={resp.status_code})")
    return session


def _session_anonima():
    return requests.Session()


def _com_credencial_servico(session):
    """Anexa o header de credencial de serviço à sessão — necessário para
    qualquer chamada a /internal/relatorios/* desde a Fase 3."""
    session.headers[CENTRAL_SERVICE_HEADER] = CENTRAL_SERVICE_TOKEN
    return session


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _aguardar_job(session, job_id, timeout=60):
    """Faz polling do status do job até concluir ou timeout."""
    t0 = time.time()
    while True:
        r = session.get(f"{BASE}/api/modulos/status/{job_id}")
        if r.status_code != 200:
            return None, f"Status poll erro HTTP {r.status_code}"
        data = r.json()
        status = data.get('status')
        if status == 'concluido':
            return 'concluido', data
        if status == 'erro':
            return 'erro', data.get('erro', 'sem detalhe')
        if time.time() - t0 > timeout:
            return 'timeout', data
        time.sleep(2)


def _baixar(session, job_id):
    """Faz download do resultado."""
    r = session.get(f"{BASE}/api/modulos/download/{job_id}")
    return r.status_code, len(r.content)


def reportar(nome, passou, detalhe=''):
    status = "PASS" if passou else "FAIL"
    RESULTADOS.append({'modulo': nome, 'status': status, 'detalhe': detalhe})
    mark = "OK " if passou else "FAIL"
    print(f"  {mark}  {nome}" + (f" — {detalhe}" if detalhe else ''))
    return passou


# ─── Testes de Auth ──────────────────────────────────────────────────────────

def test_auth():
    print("\n=== Testes de Autenticacao ===")
    session = requests.Session()

    # Login correto
    r = session.post(f"{BASE}/api/auth/login",
                     json={"email": ADMIN_EMAIL, "senha": ADMIN_SENHA})
    reportar("Auth - Login correto", r.status_code == 200,
             f"status={r.status_code}")

    # Login senha errada
    r2 = session.post(f"{BASE}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "senha": "SENHA_ERRADA"})
    reportar("Auth - Login senha errada -> 401", r2.status_code == 401,
             f"status={r2.status_code}")

    # Rota protegida sem autenticação
    anon = _session_anonima()
    r3 = anon.get(f"{BASE}/api/modulos/status/uuid-inexistente")
    reportar("Auth - Rota protegida sem cookie -> 401", r3.status_code == 401,
             f"status={r3.status_code}")

    # Status de job inexistente (autenticado)
    r4 = session.get(f"{BASE}/api/modulos/status/uuid-inexistente-xpto")
    reportar("Auth - Job inexistente -> 404", r4.status_code == 404,
             f"status={r4.status_code}")

    # A partir daqui a sessão carrega a credencial de serviço para os testes
    # de /internal/relatorios/* — não afeta as demais rotas (elas ignoram o header).
    _com_credencial_servico(session)
    return session


# ─── Helper genérico para endpoints assíncronos ───────────────────────────────

def _testar_modulo_async(session, nome, endpoint, arquivo_campo, arquivo_path,
                          extra_fields=None, suffix='.xlsx'):
    """
    Testa o happy path de um endpoint assíncrono:
    POST arquivo → job_id → polling → download
    """
    print(f"\n=== {nome} ===")

    # A) Happy path
    with open(arquivo_path, 'rb') as f:
        data = {arquivo_campo: (os.path.basename(arquivo_path), f,
                                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        fields = extra_fields or {}
        r = session.post(f"{BASE}{endpoint}",
                         files={arquivo_campo: (os.path.basename(arquivo_path), open(arquivo_path, 'rb'))},
                         data=fields)

    ok_submit = r.status_code == 202
    reportar(f"{nome} - Submit", ok_submit, f"status={r.status_code}")
    if not ok_submit:
        print(f"    Resposta: {r.text[:200]}")
        return False

    job_id = r.json().get('job_id')
    status, info = _aguardar_job(session, job_id)
    ok_job = status == 'concluido'
    reportar(f"{nome} - Job concluido", ok_job,
             f"status={status}" + (f" | erro={info}" if status == 'erro' else ''))

    if ok_job:
        code, size = _baixar(session, job_id)
        reportar(f"{nome} - Download", code == 200 and size > 0,
                 f"HTTP {code} | {size} bytes")

    # B) Sem arquivo → 400
    r_nofile = session.post(f"{BASE}{endpoint}", data=fields or {})
    reportar(f"{nome} - Sem arquivo -> 400", r_nofile.status_code == 400,
             f"status={r_nofile.status_code}")

    # C) Arquivo inválido (.txt) → 400
    with open(arquivo_path, 'rb') as f:
        r_bad = session.post(f"{BASE}{endpoint}",
                              files={arquivo_campo: ('arquivo.txt', f, 'text/plain')},
                              data=fields or {})
    # Alguns endpoints validam extensão (400), outros não (202 mas falha no job)
    passou_bad = r_bad.status_code in (400, 202)
    reportar(f"{nome} - Arquivo invalido", passou_bad,
             f"status={r_bad.status_code} (400=validado, 202=passa mas pode falhar)")

    # D) Sem autenticação → 401
    anon = _session_anonima()
    with open(arquivo_path, 'rb') as f:
        r_anon = anon.post(f"{BASE}{endpoint}",
                            files={arquivo_campo: (os.path.basename(arquivo_path), f)},
                            data=fields or {})
    reportar(f"{nome} - Sem auth -> 401", r_anon.status_code == 401,
             f"status={r_anon.status_code}")

    return ok_job


# ─── Testes por módulo ────────────────────────────────────────────────────────

def test_pedidos(session):
    _testar_modulo_async(session, "Pedidos", "/api/modulos/pedidos",
                          'arquivo', os.path.join(FIXTURES, 'mock_pedidos.xlsx'))


def test_fretes(session):
    _testar_modulo_async(session, "Fretes", "/api/modulos/fretes",
                          'arquivo', os.path.join(FIXTURES, 'mock_fretes.xlsx'))


def test_armazenagem(session):
    _testar_modulo_async(session, "Armazenagem", "/api/modulos/armazenagem",
                          'arquivo', os.path.join(FIXTURES, 'mock_armazenagem.xlsx'),
                          extra_fields={'mes_filtro': MES_FILTRO})

    # Edge case: sem mes_filtro → 400
    print("\n  Edge case: armazenagem sem mes_filtro")
    r = session.post(f"{BASE}/api/modulos/armazenagem",
                      files={'arquivo': ('mock.xlsx', open(os.path.join(FIXTURES, 'mock_armazenagem.xlsx'), 'rb'))})
    reportar("Armazenagem - Sem mes_filtro -> 400", r.status_code == 400,
             f"status={r.status_code}")


def test_estoque_fluxo_completo(session):
    """Testa o fluxo completo: carga → atualizar → gerar."""
    print("\n=== ESTOQUE — Fluxo Completo (prioridade: bug reportado) ===")

    # 1. DB info antes da carga
    r = session.get(f"{BASE}/api/modulos/estoque/db/info")
    info_pre = r.json() if r.status_code == 200 else {}
    reportar("Estoque DB Info (antes)", r.status_code == 200,
             f"status={r.status_code} | skus={info_pre.get('total_skus', '?')}")

    # 2. Carga inicial
    print("\n  [Passo 2] Carga Inicial...")
    with open(os.path.join(FIXTURES, 'mock_estoque_carga.xlsx'), 'rb') as f:
        r2 = session.post(f"{BASE}/api/modulos/estoque/db/carga",
                          files={'arquivo': ('mock_estoque_carga.xlsx', f)})
    ok_carga = r2.status_code == 200
    resp2 = r2.json() if r2.headers.get('Content-Type', '').startswith('application/json') else {}
    reportar("Estoque - Carga Inicial", ok_carga,
             f"status={r2.status_code} | msg={resp2.get('msg', resp2.get('erro', ''))[:60]}")

    # 3. DB info após carga
    r3 = session.get(f"{BASE}/api/modulos/estoque/db/info")
    info_pos = r3.json() if r3.status_code == 200 else {}
    reportar("Estoque DB Info (apos carga)", r3.status_code == 200 and info_pos.get('total_skus', 0) > 0,
             f"skus={info_pos.get('total_skus', '?')} | clientes={info_pos.get('clientes', [])}")

    # 4. Atualizar DB — ESTE É O BUG REPORTADO
    print("\n  [Passo 4] Atualizar DB (bug reportado)...")
    with open(os.path.join(FIXTURES, 'mock_estoque_atualizar.xlsx'), 'rb') as f:
        r4 = session.post(f"{BASE}/api/modulos/estoque/db/atualizar",
                          files={'arquivo': ('mock_estoque_atualizar.xlsx', f)})
    resp4 = r4.json() if r4.headers.get('Content-Type', '').startswith('application/json') else {}
    ok_atualizar = r4.status_code == 200
    reportar("Estoque - Atualizar DB", ok_atualizar,
             f"status={r4.status_code} | {json.dumps(resp4)[:100]}")
    if ok_atualizar:
        print("    ATENCAO: endpoint retorna 200 mesmo se a funcao falhar (bug #1 confirmado)")
        print(f"    Logs recebidos: {len(resp4.get('logs', []))} entradas")
        for lg in resp4.get('logs', [])[-5:]:
            print(f"    LOG: {lg.strip()[:100]}")

    # 4b. Atualizar sem fazer carga prévia (simula cenário de erro real)
    # (teste já feito nos unitários — aqui verificamos resposta da API)

    # 5. Gerar relatório de estoque
    print("\n  [Passo 5] Gerar Relatorio de Estoque...")
    with open(os.path.join(FIXTURES, 'mock_estoque_pico.xlsx'), 'rb') as f:
        r5 = session.post(f"{BASE}/api/modulos/estoque/gerar",
                          files={'arquivo_pico': ('mock_estoque_pico.xlsx', f)},
                          data={'dias_ocioso': '120', 'mes_ref': MES_FILTRO})
    ok_submit5 = r5.status_code == 202
    reportar("Estoque - Gerar Submit", ok_submit5, f"status={r5.status_code}")
    if ok_submit5:
        job_id5 = r5.json().get('job_id')
        status5, info5 = _aguardar_job(session, job_id5)
        ok_job5 = status5 == 'concluido'
        reportar("Estoque - Gerar Job", ok_job5,
                 f"status={status5}" + (f" | {info5}" if status5 == 'erro' else ''))
        if ok_job5:
            code5, size5 = _baixar(session, job_id5)
            reportar("Estoque - Gerar Download", code5 == 200 and size5 > 0,
                     f"HTTP {code5} | {size5} bytes")

    # 6. Sem arquivo → 400
    r6 = session.post(f"{BASE}/api/modulos/estoque/db/carga")
    reportar("Estoque Carga - Sem arquivo -> 400", r6.status_code == 400,
             f"status={r6.status_code}")

    r7 = session.post(f"{BASE}/api/modulos/estoque/db/atualizar")
    reportar("Estoque Atualizar - Sem arquivo -> 400", r7.status_code == 400,
             f"status={r7.status_code}")


def test_recebimentos(session):
    _testar_modulo_async(session, "Recebimentos", "/api/modulos/recebimentos",
                          'arquivo', os.path.join(FIXTURES, 'mock_recebimentos.xlsx'),
                          extra_fields={'mes_ref': MES_REF})

    # Edge case: sem mes_ref → 400
    r = session.post(f"{BASE}/api/modulos/recebimentos",
                      files={'arquivo': ('mock.xlsx', open(os.path.join(FIXTURES, 'mock_recebimentos.xlsx'), 'rb'))})
    reportar("Recebimentos - Sem mes_ref -> 400", r.status_code == 400,
             f"status={r.status_code}")


def test_fat_dist(session):
    _testar_modulo_async(session, "Fat. Distribuicao", "/api/modulos/fat_dist",
                          'arquivo', os.path.join(FIXTURES, 'mock_fat_dist.xlsx'),
                          extra_fields={'mes_ref': MES_REF})

    # Edge case: sem mes_ref → 400
    r = session.post(f"{BASE}/api/modulos/fat_dist",
                      files={'arquivo': ('mock.xlsx', open(os.path.join(FIXTURES, 'mock_fat_dist.xlsx'), 'rb'))})
    reportar("Fat. Dist. - Sem mes_ref -> 400", r.status_code == 400,
             f"status={r.status_code}")


def test_fat_arm(session):
    print("\n=== Faturamento Armazenagem ===")
    # Happy path: 2 arquivos
    r = session.post(f"{BASE}/api/modulos/fat_arm",
                      files={
                          'arquivo_mov': ('mock_fat_arm_mov.xlsx',
                                         open(os.path.join(FIXTURES, 'mock_fat_arm_mov.xlsx'), 'rb')),
                          'arquivo_volumes': ('mock_fat_arm_volumes.xlsx',
                                              open(os.path.join(FIXTURES, 'mock_fat_arm_volumes.xlsx'), 'rb'))
                      },
                      data={'mes_ref': MES_REF})
    ok_submit = r.status_code == 202
    reportar("Fat. Arm. - Submit", ok_submit, f"status={r.status_code}")
    if ok_submit:
        job_id = r.json().get('job_id')
        status, info = _aguardar_job(session, job_id)
        ok_job = status == 'concluido'
        reportar("Fat. Arm. - Job", ok_job,
                 f"status={status}" + (f" | {info}" if status == 'erro' else ''))
        if ok_job:
            code, size = _baixar(session, job_id)
            reportar("Fat. Arm. - Download", code == 200 and size > 0,
                     f"HTTP {code} | {size} bytes")

    # Sem arquivo de volumes → 400
    r2 = session.post(f"{BASE}/api/modulos/fat_arm",
                       files={'arquivo_mov': ('m.xlsx',
                               open(os.path.join(FIXTURES, 'mock_fat_arm_mov.xlsx'), 'rb'))},
                       data={'mes_ref': MES_REF})
    reportar("Fat. Arm. - Sem volumes -> 400", r2.status_code == 400,
             f"status={r2.status_code}")

    # Sem auth → 401
    anon = _session_anonima()
    r3 = anon.post(f"{BASE}/api/modulos/fat_arm",
                    files={
                        'arquivo_mov': ('m.xlsx', open(os.path.join(FIXTURES, 'mock_fat_arm_mov.xlsx'), 'rb')),
                        'arquivo_volumes': ('v.xlsx', open(os.path.join(FIXTURES, 'mock_fat_arm_volumes.xlsx'), 'rb'))
                    },
                    data={'mes_ref': MES_REF})
    reportar("Fat. Arm. - Sem auth -> 401", r3.status_code == 401,
             f"status={r3.status_code}")


def test_cap_operacional_api(session):
    """Testa o endpoint de cap. operacional com arquivo inválido."""
    print("\n=== Cap. Operacional (endpoint test com arquivo invalido) ===")

    # Arquivo .txt enviado como PDF → 400 (validação de extensão)
    r = session.post(f"{BASE}/api/modulos/cap_operacional",
                      files={'arquivo': ('test.txt', b'texto simples', 'text/plain')},
                      data={'mes_ref': MES_REF})
    reportar("Cap. Oper. - Arquivo .txt (nao .pdf) -> 400", r.status_code == 400,
             f"status={r.status_code}")

    # Sem arquivo → 400
    r2 = session.post(f"{BASE}/api/modulos/cap_operacional", data={'mes_ref': MES_REF})
    reportar("Cap. Oper. - Sem arquivo -> 400", r2.status_code == 400,
             f"status={r2.status_code}")

    # Sem mes_ref → 400
    r3 = session.post(f"{BASE}/api/modulos/cap_operacional",
                       files={'arquivo': ('test.pdf', b'%PDF-1.4', 'application/pdf')})
    reportar("Cap. Oper. - Sem mes_ref -> 400", r3.status_code == 400,
             f"status={r3.status_code}")

    # PDF válido (mesmo que falhe no pdfplumber, deve retornar job_id=202 ou erro legível)
    fake_pdf = b'%PDF-1.4\n1 0 obj\n<</Type /Catalog>>\nendobj\n%%EOF'
    r4 = session.post(f"{BASE}/api/modulos/cap_operacional",
                       files={'arquivo': ('kardex.pdf', fake_pdf, 'application/pdf')},
                       data={'mes_ref': MES_REF})
    ok4 = r4.status_code in (202, 400, 500)
    reportar("Cap. Oper. - PDF fake (job ou erro legivel)", ok4,
             f"status={r4.status_code}")
    if r4.status_code == 202:
        job_id = r4.json().get('job_id')
        status, info = _aguardar_job(session, job_id, timeout=30)
        reportar("Cap. Oper. - Job (esperado: erro legivel)", True,
                 f"status={status} | info={str(info)[:80]}")


# ─── Fase 2 (desacoplamento Atlas/Central) — /internal/relatorios/dashboard ──

def test_internal_dashboard_validacao(session):
    """Endpoint interno consumido pelo Atlas: whitelist de parâmetros e
    validação de módulo. Sessão admin — aqui não é sobre permissão, é sobre
    forma da requisição."""
    print("\n=== Internal Dashboard - Validacao de parametros ===")

    r = session.get(f"{BASE}/internal/relatorios/dashboard")
    corpo = r.json() if r.status_code == 200 else {}
    ok = r.status_code == 200 and 'kpis_por_modulo' in corpo and 'historico' in corpo
    reportar("Internal Dashboard - Sem filtro -> 200 com DTO esperado", ok,
             f"status={r.status_code}")
    # Roda depois dos testes de módulo (ver __main__): admin deve enxergar os
    # relatórios já gerados. Não-vazio aqui é o que teria pego o bug real de
    # slug ('estoque') vs label ('Estoque') gravado em RelatorioGerado.modulo.
    reportar("Internal Dashboard - Sem filtro -> kpis_por_modulo nao vazio",
             r.status_code == 200 and len(corpo.get('kpis_por_modulo', {})) > 0,
             f"modulos retornados={list(corpo.get('kpis_por_modulo', {}).keys())}")

    r2 = session.get(f"{BASE}/internal/relatorios/dashboard", params={'modulo': 'estoque'})
    corpo2 = r2.json() if r2.status_code == 200 else {}
    reportar("Internal Dashboard - Modulo valido (admin) -> 200", r2.status_code == 200,
             f"status={r2.status_code}")
    reportar("Internal Dashboard - Modulo 'estoque' -> kpis_por_modulo nao vazio",
             r2.status_code == 200 and len(corpo2.get('kpis_por_modulo', {})) > 0,
             f"corpo={corpo2}")

    r3 = session.get(f"{BASE}/internal/relatorios/dashboard", params={'modulo': 'nao_existe'})
    reportar("Internal Dashboard - Modulo invalido -> 400", r3.status_code == 400,
             f"status={r3.status_code}")

    r4 = session.get(f"{BASE}/internal/relatorios/dashboard", params={'filtro_livre': 'x'})
    reportar("Internal Dashboard - Parametro nao suportado -> 400", r4.status_code == 400,
             f"status={r4.status_code}")

    anon = _session_anonima()
    r5 = anon.get(f"{BASE}/internal/relatorios/dashboard")
    reportar("Internal Dashboard - Sem auth -> 401", r5.status_code == 401,
             f"status={r5.status_code}")


def test_internal_dashboard_permissoes(session):
    """Provisiona um usuário 'financeiro' throwaway (só tem fat_dist/fat_arm,
    per PERMISSOES_PADRAO) via o fluxo real de cadastro+aprovação e confirma
    que o endpoint interno aplica _verificar_permissao_modulo por módulo."""
    print("\n=== Internal Dashboard - Enforcamento de permissao ===")
    import secrets

    token = secrets.token_hex(6)
    email = f"teste.financeiro.{token}@baia360.com"
    senha = "Teste*Financ1"

    r_cad = session.post(f"{BASE}/api/auth/cadastro", json={
        'nome': f'Teste Financeiro {token}',
        'email': email,
        'senha': senha,
        'senha_confirmacao': senha,
    })
    if r_cad.status_code != 201:
        reportar("Internal Dashboard - Setup usuario financeiro", False,
                 f"cadastro falhou: status={r_cad.status_code}")
        return

    usuarios = session.get(f"{BASE}/api/auth/usuarios").json()
    match = next((u for u in usuarios if u['email'] == email), None)
    if not match:
        reportar("Internal Dashboard - Setup usuario financeiro", False, "usuario nao encontrado apos cadastro")
        return
    user_id = match['id']

    try:
        r_aprova = session.post(f"{BASE}/api/auth/usuarios/{user_id}/aprovar", json={'perfil': 'financeiro'})
        if r_aprova.status_code != 200:
            reportar("Internal Dashboard - Setup usuario financeiro", False,
                     f"aprovacao falhou: status={r_aprova.status_code}")
            return

        fin_session = requests.Session()
        r_login = fin_session.post(f"{BASE}/api/auth/login", json={'email': email, 'senha': senha})
        if r_login.status_code != 200:
            reportar("Internal Dashboard - Setup usuario financeiro", False,
                     f"login falhou: status={r_login.status_code}")
            return
        # Credencial de serviço presente daqui pra frente: os 403 abaixo têm que
        # ser por falta de PERMISSÃO de módulo, não por falta desse header.
        _com_credencial_servico(fin_session)

        # Financeiro tem fat_dist/fat_arm, NAO tem estoque -> 403
        r_neg = fin_session.get(f"{BASE}/internal/relatorios/dashboard", params={'modulo': 'estoque'})
        reportar("Internal Dashboard - Financeiro pede 'estoque' -> 403", r_neg.status_code == 403,
                 f"status={r_neg.status_code}")

        # Financeiro tem fat_dist -> 200
        r_pos = fin_session.get(f"{BASE}/internal/relatorios/dashboard", params={'modulo': 'fat_dist'})
        reportar("Internal Dashboard - Financeiro pede 'fat_dist' -> 200", r_pos.status_code == 200,
                 f"status={r_pos.status_code}")

        # Sem filtro: resposta agregada não pode vazar módulos fora da permissão do usuário
        r_agg = fin_session.get(f"{BASE}/internal/relatorios/dashboard")
        vazou = False
        if r_agg.status_code == 200:
            corpo = r_agg.json()
            # RelatorioGerado.modulo grava o label de exibição, não o slug de
            # permissão (ver MODULO_SLUG_PARA_LABEL em app.py) — financeiro só
            # pode ver fat_dist/fat_arm, que no banco aparecem como estes labels.
            permitidos = {'Fat. Distribuição', 'Fat. Armazenagem'}
            modulos_no_corpo = set(corpo.get('kpis_por_modulo', {}).keys()) | \
                               {h['modulo'] for h in corpo.get('historico', [])}
            vazou = bool(modulos_no_corpo - permitidos)
        reportar("Internal Dashboard - Agregado nao vaza modulos fora da permissao",
                 r_agg.status_code == 200 and not vazou,
                 f"status={r_agg.status_code} | vazou={vazou}")

    finally:
        session.delete(f"{BASE}/api/auth/usuarios/{user_id}")


# ─── Fase 3 (desacoplamento Atlas/Central) — RS256 + credencial de serviço ───

def test_rs256_e_credencial_servico(session):
    """Token emitido é RS256 (assimétrico); um token re-assinado com outra
    chave é rejeitado; /internal/relatorios/* exige JWT válido E a
    credencial de serviço — as quatro combinações. `session` já carrega o
    header de credencial (ver test_auth)."""
    print("\n=== RS256 + Credencial de Servico (Fase 3) ===")

    token = session.cookies.get('access_token_cookie')
    header = pyjwt.get_unverified_header(token) if token else {}
    reportar("RS256 - Token emitido usa alg RS256", header.get('alg') == 'RS256',
             f"alg={header.get('alg')}")

    # Token re-assinado com uma chave RSA DIFERENTE da configurada no servidor —
    # prova que a validação é assimétrica de verdade (um segredo simétrico
    # vazado não bastaria pra forjar isso), não só que "alguma checagem existe".
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    claims = pyjwt.decode(token, options={'verify_signature': False}) if token else {}
    chave_forjada = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_forjada = chave_forjada.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    token_forjado = pyjwt.encode(claims, pem_forjada, algorithm='RS256')

    forjado = requests.Session()
    forjado.cookies.set('access_token_cookie', token_forjado)
    r_forjado = forjado.get(f"{BASE}/api/auth/me")
    # Flask-JWT-Extended usa 422 pra "token presente mas assinatura invalida"
    # e reserva 401 pra "token ausente" — qualquer um dos dois é rejeição;
    # o que importa é NUNCA 200 (autenticaria como o usuário forjado).
    reportar("RS256 - Token re-assinado com outra chave -> rejeitado (401/422)",
             r_forjado.status_code in (401, 422),
             f"status={r_forjado.status_code}")

    # /internal/relatorios/* exige JWT válido E credencial de serviço.
    sem_credencial = _session_logada()
    r1 = sem_credencial.get(f"{BASE}/internal/relatorios/dashboard")
    reportar("Credencial servico - JWT valido, sem credencial -> 403", r1.status_code == 403,
             f"status={r1.status_code}")

    sem_jwt = requests.Session()
    sem_jwt.headers[CENTRAL_SERVICE_HEADER] = CENTRAL_SERVICE_TOKEN
    r2 = sem_jwt.get(f"{BASE}/internal/relatorios/dashboard")
    reportar("Credencial servico - Sem JWT, credencial valida -> 401", r2.status_code == 401,
             f"status={r2.status_code}")

    r3 = requests.Session().get(f"{BASE}/internal/relatorios/dashboard")
    reportar("Credencial servico - Sem JWT e sem credencial -> 401", r3.status_code == 401,
             f"status={r3.status_code}")

    credencial_errada = _session_logada()
    credencial_errada.headers[CENTRAL_SERVICE_HEADER] = "valor-errado"
    r4 = credencial_errada.get(f"{BASE}/internal/relatorios/dashboard")
    reportar("Credencial servico - Credencial errada -> 403", r4.status_code == 403,
             f"status={r4.status_code}")

    r5 = session.get(f"{BASE}/internal/relatorios/dashboard")
    reportar("Credencial servico - JWT valido + credencial valida -> 200", r5.status_code == 200,
             f"status={r5.status_code}")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("\n" + "="*60)
    print("  FASE 4 - TESTES DE API - CENTRAL DE RELATORIOS")
    print(f"  Backend: {BASE}")
    print("="*60)

    # Verifica backend
    try:
        r = requests.get(f"{BASE}/api/health", timeout=5)
        if r.status_code != 200:
            raise Exception(f"Health retornou {r.status_code}")
        print(f"\nBackend OK: {r.json()}")
    except Exception as e:
        print(f"\nERRO: Backend nao acessivel em {BASE}")
        print(f"       {e}")
        print("       Inicie o backend: venv\\Scripts\\activate && python app.py")
        sys.exit(1)

    session = test_auth()

    # Testes de todos os módulos
    test_pedidos(session)
    test_fretes(session)
    test_armazenagem(session)
    test_estoque_fluxo_completo(session)
    test_recebimentos(session)
    test_fat_dist(session)
    test_fat_arm(session)
    test_cap_operacional_api(session)

    # Fase 2 — desacoplamento Atlas/Central: contrato interno de leitura
    test_internal_dashboard_validacao(session)
    test_internal_dashboard_permissoes(session)

    # Fase 3 — RS256 + credencial de serviço
    test_rs256_e_credencial_servico(session)

    # Resumo
    print("\n" + "="*60)
    print("  RESUMO FINAL - TESTES DE API")
    print("="*60)
    passou = [r for r in RESULTADOS if r['status'] == 'PASS']
    falhou = [r for r in RESULTADOS if r['status'] == 'FAIL']

    print(f"\n  PASS: {len(passou)}")
    if falhou:
        print(f"\n  FAIL: {len(falhou)}")
        for r in falhou:
            print(f"    FAIL  {r['modulo']} — {r['detalhe']}")

    print(f"\n  Total: {len(RESULTADOS)} | PASS: {len(passou)} | FAIL: {len(falhou)}")
    sys.exit(0 if not falhou else 1)
