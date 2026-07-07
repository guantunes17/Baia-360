"""
Replay das traces RAG de produção para um Phoenix LOCAL (on-demand).
A produção nunca roda Phoenix — este script puxa as traces do Postgres de
produção (via SSH + docker exec, read-only) e as empurra como spans
OpenInference para o Phoenix rodando no seu Mac.

PASSO A PASSO:
  1) Suba o Phoenix local (container avulso, não é o compose de produção):
       docker run --rm -d --name phoenix -p 6006:6006 -p 4317:4317 \
         arizephoenix/phoenix:latest
  2) Instale as libs no Mac (uma vez):
       pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-grpc \
         openinference-semantic-conventions
  3) Replay único:      python scripts/phoenix_replay.py
     Modo watch (auto): python scripts/phoenix_replay.py --watch 30
  4) Abra http://localhost:6006 e investigue. Ao terminar:
       docker stop phoenix

ENV:
  BAIA_SSH      host SSH de produção            (default: root@baia360.com.br)
  PHOENIX_OTLP  endpoint OTLP do Phoenix local  (default: http://localhost:4317)
  CURSOR_FILE   arquivo de cursor incremental   (default: ~/.baia_phoenix_cursor)
"""
import os, sys, json, time, subprocess
from pathlib import Path

BAIA_SSH     = os.getenv('BAIA_SSH', 'root@baia360.com.br')
PHOENIX_OTLP = os.getenv('PHOENIX_OTLP', 'http://localhost:4317')
CURSOR_FILE  = Path(os.getenv('CURSOR_FILE', str(Path.home() / '.baia_phoenix_cursor')))

def _ler_cursor():
    try:
        return CURSOR_FILE.read_text().strip() or None
    except Exception:
        return None

def _salvar_cursor(iso):
    try:
        CURSOR_FILE.write_text(iso)
    except Exception:
        pass

def _puxar_traces(since_iso):
    """Roda o export dentro do container de produção via SSH e devolve a
    lista de dicts. Read-only (SELECT)."""
    cmd = ['ssh', BAIA_SSH,
           'docker', 'exec', 'baia360-backend', 'python',
           'tasks_observabilidade.py', 'export_traces']
    if since_iso:
        cmd += ['--since', since_iso]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        print('[replay] erro no SSH/export:', out.stderr[:500], file=sys.stderr)
        return []
    traces = []
    for linha in out.stdout.splitlines():
        linha = linha.strip()
        if not linha:
            continue
        try:
            traces.append(json.loads(linha))
        except Exception:
            pass
    return traces

# ── Phoenix / OpenInference ──────────────────────────────────────────
# NOTA: as APIs do OpenInference/OTel evoluem — CONFIRMAR os nomes exatos dos
# atributos e a construção de span contra as versões instaladas. O padrão
# OpenInference para um span de retrieval usa:
#   openinference.span.kind = "RETRIEVER"
#   input.value             = a pergunta / retrieval_query
#   retrieval.documents.{i}.document.id / .content / .score
# e um span pai kind="CHAIN" com input.value=pergunta e output.value=resposta.
def _tracer():
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    provider = TracerProvider()
    provider.add_span_processor(
        SimpleSpanProcessor(OTLPSpanExporter(endpoint=PHOENIX_OTLP, insecure=True)))
    trace.set_tracer_provider(provider)
    return trace.get_tracer('baia360.phoenix_replay')

def emitir_trace_para_phoenix(trace: dict, tracer) -> None:
    """Emite UMA trace (mesmo shape do export_traces / AtlasRAGTrace) como span
    CHAIN+RETRIEVER. Cria um span CHAIN (pergunta→resposta) com um filho
    RETRIEVER que carrega os documentos recuperados e seus scores. Reutilizável
    pelo replay de produção (abaixo) E pela suíte de validação
    (tests/observabilidade/run_validation.py --phoenix) — uma única definição
    do schema de spans, sem divergência entre as duas."""
    with tracer.start_as_current_span('atlas.turn') as chain:
        chain.set_attribute('openinference.span.kind', 'CHAIN')
        chain.set_attribute('input.value', trace.get('pergunta') or '')
        chain.set_attribute('output.value', trace.get('resposta') or '')
        chain.set_attribute('metadata.trace_id', trace.get('id'))
        chain.set_attribute('metadata.groundedness', trace.get('groundedness') or 0.0)
        chain.set_attribute('metadata.eval_faithfulness', trace.get('eval_faithfulness') or 0.0)
        chain.set_attribute('metadata.feedback', trace.get('feedback') or '')
        chain.set_attribute('metadata.latencia_ms', trace.get('latencia_ms') or 0)
        with tracer.start_as_current_span('atlas.retrieval') as ret:
            ret.set_attribute('openinference.span.kind', 'RETRIEVER')
            ret.set_attribute('input.value', trace.get('retrieval_query') or trace.get('pergunta') or '')
            for i, c in enumerate(trace.get('chunks') or []):
                ret.set_attribute(f'retrieval.documents.{i}.document.id', str(c.get('file_id') or ''))
                ret.set_attribute(f'retrieval.documents.{i}.document.content', c.get('quote') or '')
                ret.set_attribute(f'retrieval.documents.{i}.document.score', c.get('score') or 0.0)
                ret.set_attribute(f'retrieval.documents.{i}.document.metadata',
                                  json.dumps({'filename': c.get('filename')}))

def replay_once(tracer):
    since = _ler_cursor()
    traces = _puxar_traces(since)
    if not traces:
        print('[replay] nenhuma trace nova.')
        return
    for t in traces:
        try:
            emitir_trace_para_phoenix(t, tracer)
        except Exception as e:
            print('[replay] falha ao emitir span:', e, file=sys.stderr)
    _salvar_cursor(traces[-1]['criado_em'])
    print(f'[replay] {len(traces)} traces enviadas ao Phoenix ({PHOENIX_OTLP}).')

if __name__ == '__main__':
    tracer = _tracer()
    if '--watch' in sys.argv:
        try:
            intervalo = int(sys.argv[sys.argv.index('--watch') + 1])
        except Exception:
            intervalo = 30
        print(f'[replay] modo watch a cada {intervalo}s. Ctrl+C para sair.')
        try:
            while True:
                replay_once(tracer)
                time.sleep(intervalo)
        except KeyboardInterrupt:
            print('\n[replay] encerrado.')
    else:
        replay_once(tracer)
