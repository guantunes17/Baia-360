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

Cron sugerido (host, fora do container):
  # 1º dia do mês, 03:00 — regressão de segurança contra drift da OpenAI
  0 3 1 * * docker exec baia360-backend python tasks_observabilidade.py regressao --motivo floor
  # todo dia, 03:30 — purga de traces com mais de 90 dias
  30 3 * * * docker exec baia360-backend python tasks_observabilidade.py retencao
"""
import sys
import json
from app import app, db, AtlasGoldenQA, AtlasGoldenRun, purgar_rag_traces, \
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


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'regressao'
    if cmd == 'retencao':
        retencao()
    else:
        motivo = 'manual'
        if '--motivo' in sys.argv:
            motivo = sys.argv[sys.argv.index('--motivo') + 1]
        regressao(motivo)
