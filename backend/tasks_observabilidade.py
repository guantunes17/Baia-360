"""
RAG observability: regressão do golden set + retenção de traces.

Roda como script standalone (docker exec), não no worker web — evita competir
com o tráfego de produção pelo mesmo processo gunicorn e mantém o custo da
regressão (chamadas ao judge/embeddings) fora do caminho quente do request.

Disparo é event-driven, não um timer semanal: rode 'regressao' manualmente após
qualquer deploy que mude o system prompt, o modelo ou reindexe os documentos do
Atlas. Um floor mensal via cron cobre drift silencioso do lado da OpenAI (mesmo
modelo, comportamento diferente) que nenhum deploy nosso explicaria.

Uso:
  docker exec baia360-backend python tasks_observabilidade.py regressao --motivo deploy
  docker exec baia360-backend python tasks_observabilidade.py regressao --motivo floor
  docker exec baia360-backend python tasks_observabilidade.py retencao
  docker exec baia360-backend python tasks_observabilidade.py export_traces --since 2026-07-01T00:00:00

Cron sugerido (host, fora do container):
  # 1º dia do mês, 03:00 — regressão de segurança contra drift da OpenAI
  0 3 1 * * docker exec baia360-backend python tasks_observabilidade.py regressao --motivo floor
  # todo dia, 03:30 — purga de traces com mais de 90 dias
  30 3 * * * docker exec baia360-backend python tasks_observabilidade.py retencao

'export_traces' é read-only (só SELECT) e emite NDJSON no stdout — usado por
scripts/phoenix_replay.py (roda no Mac do dev, fora de qualquer container) para
puxar traces via SSH e visualizá-las num Phoenix local, sob demanda.
"""
import sys
import json
from app import app, db, AtlasGoldenQA, AtlasGoldenRun, AtlasRAGTrace, purgar_rag_traces, \
                avaliar_judge, avaliar_groundedness, responder_atlas
from openai import OpenAI
import os


def regressao(motivo='manual'):
    with app.app_context():
        client = OpenAI(api_key=os.getenv('OPENAI_API_KEY', '').strip())
        perguntas = AtlasGoldenQA.query.filter_by(ativo=True).all()
        if not perguntas:
            print('[regressao] nenhuma pergunta ativa em AtlasGoldenQA — nada a fazer.')
            return

        resultados = []
        for qa in perguntas:
            try:
                resposta, chunks = responder_atlas(qa.pergunta)
                j = avaliar_judge(client, qa.pergunta, resposta, chunks) or {}
                g = avaliar_groundedness(client, resposta, chunks)
                resultados.append({'id': qa.id, **j, 'groundedness': g})
            except Exception as e:
                print(f'[regressao] erro na pergunta #{qa.id}: {e}')
                resultados.append({'id': qa.id, 'erro': str(e)})

        def _avg(k):
            vals = [r[k] for r in resultados if r.get(k) is not None]
            return sum(vals) / len(vals) if vals else None

        run = AtlasGoldenRun(
            motivo=motivo,
            n_perguntas=len(perguntas),
            mean_faith=_avg('faithfulness'),
            mean_answer=_avg('answer_relevancy'),
            mean_context=_avg('context_relevancy'),
            mean_ground=_avg('groundedness'),
            detalhe_json=json.dumps(resultados, ensure_ascii=False),
        )
        db.session.add(run)
        db.session.commit()
        print(f'[regressao] run #{run.id} motivo={motivo} n={run.n_perguntas} '
              f'faith={run.mean_faith} ground={run.mean_ground}')


def retencao():
    with app.app_context():
        n = purgar_rag_traces(90)
        print(f'[retencao] {n} traces apagadas')


def export_traces(since_iso=None, limite=2000):
    """Emite AtlasRAGTrace como NDJSON (uma linha JSON por trace), ordenado
    por criado_em asc. Read-only. Usado pelo phoenix_replay.py no Mac."""
    from datetime import datetime as _dt
    with app.app_context():
        q = AtlasRAGTrace.query.order_by(AtlasRAGTrace.criado_em.asc())
        if since_iso:
            try:
                q = q.filter(AtlasRAGTrace.criado_em > _dt.fromisoformat(since_iso))
            except Exception:
                pass
        for r in q.limit(limite).all():
            rec = {
                'id': r.id, 'criado_em': r.criado_em.isoformat(),
                'usuario_id': r.usuario_id, 'conv_id': r.conv_id,
                'response_id': r.response_id, 'modelo': r.modelo,
                'pergunta': r.pergunta, 'resposta': r.resposta,
                'retrieval_query': r.retrieval_query,
                'retrieval_count': r.retrieval_count,
                'top_score': r.top_score, 'mean_score': r.mean_score,
                'zero_retrieval': r.zero_retrieval,
                'chunks': json.loads(r.chunks_json) if r.chunks_json else [],
                'n_file_citations': r.n_file_citations, 'feedback': r.feedback,
                'groundedness': r.groundedness,
                'eval_faithfulness': r.eval_faithfulness,
                'eval_answer_rel': r.eval_answer_rel,
                'eval_context_rel': r.eval_context_rel,
                'latencia_ms': r.latencia_ms,
                'tokens_in': r.tokens_in, 'tokens_out': r.tokens_out,
            }
            print(json.dumps(rec, ensure_ascii=False))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'regressao'
    if cmd == 'retencao':
        retencao()
    elif cmd == 'export_traces':
        since = None
        if '--since' in sys.argv:
            since = sys.argv[sys.argv.index('--since') + 1]
        export_traces(since)
    else:
        motivo = 'manual'
        if '--motivo' in sys.argv:
            motivo = sys.argv[sys.argv.index('--motivo') + 1]
        regressao(motivo)
