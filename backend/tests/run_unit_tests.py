# -*- coding: utf-8 -*-
"""
Fase 3 — Testes Unitários das Funções da Central de Relatórios.
Chama cada função diretamente (sem API) e reporta resultado.

Executar a partir do diretório backend/:
    python tests/run_unit_tests.py
"""

import sys
import os
import json
import traceback
import importlib.util

# ─── Paths ──────────────────────────────────────────────────────────────────
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES    = os.path.join(BACKEND_DIR, 'tests', 'fixtures')
OUTPUT      = os.path.join(BACKEND_DIR, 'tests', 'output')
os.makedirs(OUTPUT, exist_ok=True)

# Aponta PYTHONIOENCODING para evitar erros de codificação no Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ─── Carrega módulo central_relatorios ─────────────────────────────────────
def _carregar_modulo():
    path = os.path.join(BACKEND_DIR, 'modules', 'central_relatorios.py')
    spec = importlib.util.spec_from_file_location('central', path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Redireciona DB de estoque para path de teste (não polui produção)
    mod.DB_ESTOQUE_PATH = os.path.join(FIXTURES, 'test_estoque_db.json')
    return mod


# ─── Helpers ────────────────────────────────────────────────────────────────
RESULTADOS = []

def log_maker(nome):
    """Retorna (lista_de_logs, função_log) para capturar mensagens."""
    msgs = []
    def log(msg): msgs.append(msg)
    return msgs, log

def reportar(nome, passou, logs, saida=None, exc=None):
    status = "PASS" if passou else "FAIL"
    RESULTADOS.append({'modulo': nome, 'status': status, 'saida': saida, 'exc': exc})
    print(f"\n{'='*60}")
    print(f"  {nome}: {status}")
    if saida:
        try:
            size = os.path.getsize(saida)
            print(f"  Saida: {os.path.basename(saida)} ({size} bytes)")
        except OSError:
            print(f"  Saida: {saida} (nao encontrado)")
    if exc:
        print(f"  EXCECAO: {exc}")
    # Mostra logs relevantes (remove emojis para compatibilidade)
    for msg in logs[-10:]:
        clean = msg.replace('\n', ' ').strip()
        if clean:
            print(f"  LOG: {clean}")
    return passou


# ─── Testes ─────────────────────────────────────────────────────────────────

def test_pedidos(mod):
    nome = "Pedidos"
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'pedidos_out.xlsx')
    try:
        resultado = mod.processar_pedidos(
            os.path.join(FIXTURES, 'mock_pedidos.xlsx'),
            log,
            _saida_override=saida
        )
        reportar(nome, bool(resultado), logs, saida if resultado else None)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_fretes(mod):
    nome = "Fretes"
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'fretes_out.xlsx')
    try:
        resultado = mod.processar_fretes(
            os.path.join(FIXTURES, 'mock_fretes.xlsx'),
            log,
            _saida_override=saida
        )
        reportar(nome, bool(resultado), logs, saida if resultado else None)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_armazenagem(mod):
    nome = "Armazenagem"
    from datetime import date
    mes_filtro = date.today().strftime('%Y-%m')  # mês atual YYYY-MM
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'armazenagem_out.xlsx')
    try:
        resultado = mod.processar_armazenagem(
            os.path.join(FIXTURES, 'mock_armazenagem.xlsx'),
            mes_filtro,
            log,
            _saida_override=saida
        )
        reportar(nome, bool(resultado), logs, saida if resultado else None)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_estoque_carga(mod):
    nome = "Estoque - Carga DB"
    logs, log = log_maker(nome)
    try:
        estoque_data = mod._carregar_estoque_xlsx(
            os.path.join(FIXTURES, 'mock_estoque_carga.xlsx'), log
        )
        passou = bool(estoque_data) and len(estoque_data) >= 2
        if passou:
            # Salva no DB de teste
            mod._salvar_db_estoque(estoque_data)
            total = sum(len(v) for v in estoque_data.values())
            log(f"DB salvo: {total} SKUs em {len(estoque_data)} clientes\n")
        reportar(nome, passou, logs)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_estoque_atualizar(mod):
    nome = "Estoque - Atualizar DB"
    logs, log = log_maker(nome)
    try:
        # Garante que o DB existe (deve ter sido carregado na etapa anterior)
        db_path = os.path.join(FIXTURES, 'test_estoque_db.json')
        if not os.path.exists(db_path):
            log("DB nao encontrado — executando carga primeiro\n")
            mod._salvar_db_estoque(mod._carregar_estoque_xlsx(
                os.path.join(FIXTURES, 'mock_estoque_carga.xlsx'), lambda m: None))

        resultado = mod._atualizar_db_com_movimentacao(
            os.path.join(FIXTURES, 'mock_estoque_atualizar.xlsx'), log
        )
        passou = resultado is True
        reportar(nome, passou, logs)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_estoque_atualizar_sem_db(mod):
    """Edge case: tentar atualizar sem DB — deve retornar False com mensagem clara."""
    nome = "Estoque - Atualizar SEM DB (edge case)"
    logs, log = log_maker(nome)
    try:
        # Salva DB vazio
        import json
        db_vazio_path = os.path.join(FIXTURES, 'test_estoque_db.json')
        with open(db_vazio_path, 'w') as f:
            json.dump({}, f)

        resultado = mod._atualizar_db_com_movimentacao(
            os.path.join(FIXTURES, 'mock_estoque_atualizar.xlsx'), log
        )
        # Espera: retorna False com mensagem de erro
        passou = resultado is False and any('DB vazio' in m or 'carga' in m.lower() for m in logs)
        reportar(nome, passou, logs)

        # Restaura DB com dados para próximos testes
        estoque_data = mod._carregar_estoque_xlsx(
            os.path.join(FIXTURES, 'mock_estoque_carga.xlsx'), lambda m: None)
        mod._salvar_db_estoque(estoque_data)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_estoque_gerar(mod):
    nome = "Estoque - Gerar Relatorio"
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'estoque_out.xlsx')
    try:
        resultado = mod.processar_estoque(
            '',               # arquivo_estoque vazio — usa DB interno
            os.path.join(FIXTURES, 'mock_estoque_pico.xlsx'),
            '',               # arquivo_movimentacao vazio
            120,              # dias_ocioso
            log,
            _saida_override=saida
        )
        reportar(nome, bool(resultado), logs, saida if resultado else None)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_recebimentos(mod):
    nome = "Recebimentos"
    from datetime import date
    mes_ref = date.today().strftime('%m-%Y')  # MM-YYYY
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'recebimentos_out.xlsx')
    try:
        # Override do _caminho_saida para não tentar escrever em Z:\
        mod._caminho_saida = lambda *args, **kwargs: saida
        resultado = mod.run_recebimentos(
            os.path.join(FIXTURES, 'mock_recebimentos.xlsx'),
            mes_ref,
            log
        )
        reportar(nome, bool(resultado), logs, saida if resultado else None)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_fat_dist(mod):
    nome = "Faturamento Distribuicao"
    from datetime import date
    mes_ref = date.today().strftime('%m/%Y')  # MM/YYYY
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'fat_dist_out.xlsx')
    try:
        # Override do pasta_saida (a função cria subpasta {ano}/...)
        resultado = mod.run_faturamento_distribuicao(
            os.path.join(FIXTURES, 'mock_fat_dist.xlsx'),
            mes_ref,
            log,
            pasta_saida=OUTPUT
        )
        passou = resultado is not None and os.path.exists(resultado)
        reportar(nome, passou, logs, resultado)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_fat_arm(mod):
    nome = "Faturamento Armazenagem"
    from datetime import date
    mes_ref = date.today().strftime('%m-%Y')  # MM-YYYY
    logs, log = log_maker(nome)
    saida = os.path.join(OUTPUT, 'fat_arm_out.xlsx')
    try:
        # Override _caminho_saida para não tentar Z:\
        mod._caminho_saida = lambda *args, **kwargs: saida
        resultado = mod.run_faturamento_armazenagem(
            os.path.join(FIXTURES, 'mock_fat_arm_mov.xlsx'),
            os.path.join(FIXTURES, 'mock_fat_arm_volumes.xlsx'),
            mes_ref,
            log
        )
        passou = bool(resultado)
        reportar(nome, passou, logs, saida if passou else None)
    except Exception as e:
        reportar(nome, False, logs, exc=traceback.format_exc())


def test_cap_operacional_skip():
    nome = "Cap. Operacional (PDF)"
    print(f"\n{'='*60}")
    print(f"  {nome}: SKIP")
    print("  Razao: requer PDF real do Kardex ESL com tabelas parseadas por pdfplumber.")
    print("         Arquivo PDF simulado com texto simples nao passa pelo parser.")
    RESULTADOS.append({'modulo': nome, 'status': 'SKIP', 'saida': None, 'exc': None})


# ─── Main ────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("\n" + "="*60)
    print("  FASE 3 - TESTES UNITARIOS - CENTRAL DE RELATORIOS")
    print("="*60)

    print("\nCarregando modulo central_relatorios...")
    try:
        mod = _carregar_modulo()
        print("OK - modulo carregado")
    except Exception as e:
        print(f"ERRO CRITICO: nao foi possivel carregar o modulo!")
        print(traceback.format_exc())
        sys.exit(1)

    # Ordem: Estoque primeiro (gera DB para os outros testes)
    print("\n--- FASE 3A: ESTOQUE (prioridade — bug reportado) ---")
    test_estoque_carga(mod)
    test_estoque_atualizar_sem_db(mod)
    test_estoque_atualizar(mod)
    test_estoque_gerar(mod)

    print("\n--- FASE 3B: DEMAIS MODULOS ---")
    mod2 = _carregar_modulo()
    test_pedidos(mod2)
    mod3 = _carregar_modulo()
    test_fretes(mod3)
    mod4 = _carregar_modulo()
    test_armazenagem(mod4)
    mod5 = _carregar_modulo()
    test_recebimentos(mod5)
    mod6 = _carregar_modulo()
    test_fat_dist(mod6)
    mod7 = _carregar_modulo()
    test_fat_arm(mod7)
    test_cap_operacional_skip()

    # ─── Resumo Final ───────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("  RESUMO FINAL - TESTES UNITARIOS")
    print("="*60)
    passou = [r for r in RESULTADOS if r['status'] == 'PASS']
    falhou = [r for r in RESULTADOS if r['status'] == 'FAIL']
    skip   = [r for r in RESULTADOS if r['status'] == 'SKIP']

    print(f"\n  PASS: {len(passou)}")
    for r in passou:
        print(f"    OK  {r['modulo']}")
    if falhou:
        print(f"\n  FAIL: {len(falhou)}")
        for r in falhou:
            print(f"    FAIL  {r['modulo']}")
            if r['exc']:
                for line in r['exc'].split('\n')[-5:]:
                    print(f"          {line}")
    if skip:
        print(f"\n  SKIP: {len(skip)}")
        for r in skip:
            print(f"    SKIP  {r['modulo']}")

    print(f"\n  Total: {len(RESULTADOS)} | PASS: {len(passou)} | FAIL: {len(falhou)} | SKIP: {len(skip)}")
    sys.exit(0 if not falhou else 1)
