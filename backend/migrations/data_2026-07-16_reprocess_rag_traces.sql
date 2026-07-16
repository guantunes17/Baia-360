-- Reprocessamento pontual do corpus de observabilidade RAG — plano 2026-07-16,
-- Prompt 1 (§4). NÃO é uma migração Alembic (não altera schema, só dados).
--
-- ESCOPO E O QUE NÃO FAZEMOS (revisado após correção de code review — a
-- primeira versão deste script cometia exatamente o erro que este plano
-- existe para eliminar, ver abaixo):
--
--   id 15: única linha cuja proveniência é conhecida com CERTEZA a partir da
--          investigação deste próprio plano (get_dashboard + file_search com
--          2 citações reais, n_file_citations=2, citation_coverage=true) ->
--          segmento HYBRID. Anotada à mão abaixo.
--
--   id 1, 4, 9: datadas de 07-08 e 07-10 — ANTES do deploy da Fase 2
--          (07-15), quando get_dashboard existia mas era resolvida no
--          FRONTEND (via /api/atlas/dashboard_data), e as tools de
--          Outlook também já existiam. NADA no dado armazenado prova que
--          nenhuma tool rodou nesses três turnos. A primeira versão deste
--          script gravava tools_usadas='[]' nessas três linhas, tratando
--          "não sei" como "sei que não rodou nenhuma" — exatamente a
--          confusão NULL-vs-[] que §2/§3 do plano existem para impedir.
--          NÃO fazemos isso aqui: tools_usadas continua NULL nas três,
--          e por isso elas caem no segmento 'legacy_unknown' (não
--          'rag_only') na leitura — ver derivar_segmento_rag em
--          backend/app.py. O que É seguro reprocessar nessas três é
--          eval_flagged, porque essa coluna depende só de
--          eval_faithfulness/eval_answer_rel — já gravados, e o julgamento
--          em si não muda com a proveniência da tool (só a decisão de rodar
--          o judge mudaria, e ele já rodou). Ver comentário na UPDATE abaixo.
--
-- As 11 linhas restantes (sem file_search) não são tocadas: ficam com
-- tools_usadas/eval_versao NULL — "nunca capturado", o estado honesto para
-- linhas fora do escopo desta reprocessagem.
--
-- Toda linha tocada recebe eval_versao = 2 (EVAL_PIPELINE_VERSION em
-- backend/app.py) — é isso que torna o corpus auditável quanto a qual linha
-- foi escrita/reprocessada por qual pipeline (ver AtlasRAGTrace.eval_versao).
--
-- ORDEM OBRIGATÓRIA (isto é uma UPDATE em produção, não pular passos):
--   1. `alembic current` — confirmar que ee60e0f66c31 (tools_usadas/
--      eval_versao) já está aplicada. Rodar este script antes disso falha
--      (colunas não existem).
--   2. `pg_dump` da tabela (ou do banco inteiro) ANTES de rodar qualquer
--      UPDATE abaixo — isto reescreve linhas de produção, não é reversível
--      por downgrade de migração (migração só mexe em schema, não nestes
--      dados). Exemplo:
--        pg_dump "$DATABASE_URL" -t atlas.atlas_rag_trace -F c \
--          -f atlas_rag_trace_pre_reprocess_2026-07-16.dump
--   3. Rodar este script (via psql, ver comando abaixo).
--   4. Conferir o resultado com o SELECT de verificação no final do arquivo.
--
-- NÃO é opcional pular a linha #15: enquanto ela ficar sem esta correção,
-- continua sendo julgada como RAG-only e pesando ~25% de qualquer média do
-- dashboard sobre uma base de N=4 — exatamente o problema que motivou a
-- investigação. As linhas #1/#4/#9 (recompute de eval_flagged) também não
-- são opcionais pelo mesmo motivo: sob a definição antiga elas ficam
-- indevidamente marcadas como alarme.
--
-- Rodar:
--   docker exec -i baia360-backend psql "$DATABASE_URL" \
--     -f /caminho/para/data_2026-07-16_reprocess_rag_traces.sql
-- (ou copiar o conteúdo abaixo direto num `psql` interativo.)
--
-- CRITÉRIO 5 DO PLANO: nenhuma dessas UPDATEs toca top_score, mean_score,
-- retrieval_count, chunks_json ou qualquer outro campo Tier 0 de retrieval —
-- só tools_usadas, eval_versao, e (para a #15) os campos de eval/groundedness
-- que passam a não se aplicar sob a nova segmentação. Verificável com:
--   SELECT id, top_score, mean_score, retrieval_count FROM atlas.atlas_rag_trace
--   WHERE id IN (1, 4, 9, 15);
-- antes e depois — deve ser byte-idêntico.

BEGIN;

-- Trace #15: hybrid — get_dashboard forneceu os números, file_search também
-- rodou e foi citado (2 citações), mas contra um contexto (procedimentos
-- SISLOG) que não é a fonte da substância da resposta. Sob a nova
-- segmentação (derivar_segmento_rag), isso significa Tier 2/3 NULL — pontuar
-- faithfulness contra chunks que a resposta não usou como fonte real é o
-- que gerou o falso alarme que motivou esta investigação.
UPDATE atlas.atlas_rag_trace
SET tools_usadas      = '["get_dashboard"]',
    eval_versao       = 2,
    groundedness      = NULL,
    eval_faithfulness = NULL,
    eval_answer_rel   = NULL,
    eval_context_rel  = NULL,
    eval_flagged      = NULL
WHERE id = 15;

-- Traces #1, #4, #9: tools_usadas permanece NULL (proveniência desconhecida,
-- ver nota acima — NÃO gravamos '[]' aqui). Isso as classifica como
-- 'legacy_unknown' na leitura, não 'rag_only' — o dashboard não vai contar
-- essas três como amostra RAG-only verificada. O que É seguro tocar é
-- eval_flagged: essa coluna só depende de eval_faithfulness/eval_answer_rel,
-- já gravados por um judge que rodou de fato (a definição antiga alarmava
-- "foi selecionada para julgamento", não "o judge achou um problema real" —
-- as três têm faithfulness/answer_rel = 1.0, então sob a nova definição
-- (<=0.5 em qualquer um dos dois) nenhuma flagga). eval_versao é gravado
-- para marcar que o eval_flagged destas linhas já reflete o pipeline v2,
-- mesmo com tools_usadas ainda desconhecido.
UPDATE atlas.atlas_rag_trace
SET eval_versao  = 2,
    eval_flagged = (eval_faithfulness <= 0.5) OR (eval_answer_rel <= 0.5)
WHERE id IN (1, 4, 9);

COMMIT;

-- Verificação pós-execução (rodar e comparar com o pg_dump/SELECT feito antes):
--   SELECT id, tools_usadas, eval_versao, groundedness, eval_faithfulness,
--          eval_answer_rel, eval_context_rel, eval_flagged,
--          top_score, mean_score, retrieval_count
--   FROM atlas.atlas_rag_trace WHERE id IN (1, 4, 9, 15) ORDER BY id;
-- Esperado: #15 com tools_usadas/eval_versao preenchidos e todo o resto de
-- eval/groundedness NULL; #1/#4/#9 com tools_usadas ainda NULL, eval_versao=2,
-- eval_flagged=false; top_score/mean_score/retrieval_count idênticos ao
-- valor pré-execução nas quatro linhas.

-- NÃO EXECUTADO NESTE PLANO — opcional, custo real (~4 chamadas de judge,
-- centavos de USD): re-rodar avaliar_judge/avaliar_groundedness contra o
-- chunks_json já armazenado das traces #1, #4, #9, #15, para obter um score
-- fresco em vez de reaproveitar o já gravado. O pipeline SUPORTA isso hoje —
-- avaliar_judge(client, pergunta, resposta, chunks) e avaliar_groundedness
-- são funções puras (backend/app.py) que recebem pergunta/resposta/chunks
-- diretamente, sem depender de criar uma linha nova — dá pra chamar contra
-- qualquer registro existente e fazer um UPDATE dos campos eval_*/groundedness
-- na linha, exatamente como acima. Ver tests/observabilidade/test_03_eval.py
-- para os testes dessas funções isoladas. Deixado como ação manual do
-- humano, com uma chave OpenAI real, porque este plano não deve gastar
-- dinheiro de produção sem pedir. (Isto não recuperaria tools_usadas para
-- #1/#4/#9 de qualquer forma — só re-pontuaria faithfulness/groundedness.)
