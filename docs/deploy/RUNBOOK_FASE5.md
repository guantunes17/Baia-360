# Runbook — Deploy do desacoplamento Atlas/Central (Fases 1–5 + correções de Prompt 6)

**Mecanismo: duas ondas.** O cherry-pick de Wave A (identity.py + fixes de dotenv/observabilidade) sobre o commit da Fase 4 aplicou limpo depois de resolver dois conflitos pequenos e esperados (um arquivo que ainda não existia, uma função que ainda não tinha `requer_emissao`) — não foi um cherry-pick sujo, então duas ondas reais fazem sentido aqui: Wave A isola o risco de **dado** (Alembic, schema move, ainda um processo só); Wave B isola o risco de **topologia** (split de processo, volume, nginx, DNS do Docker). Se a Wave A falhar, você não herda a complexidade do split. Se a Wave B falhar, você já sabe que o banco está saudável.

- **Wave A** — branch `deploy/wave-a`, commit `8395732` (Fases 1–4: contrato interno, RS256, schema move, mais os fixes de chave-em-base64/dotenv/suíte de observabilidade). Ainda **um único processo** (`baia360-backend` servindo tudo).
- **Wave B** — branch `main`, commit `ff19571` (Fase 5: split físico Atlas/Central, mais volume de dados, dev/prod parity, docs).

Todos os 5 usuários serão deslogados quando RS256 (Wave A) entrar no ar — os cookies antigos (se houver algum, o sistema atual é HS256 pré-Fase-1) não validam mais.

**Nenhum passo deste runbook usa `docker compose down`, em nenhuma circunstância — nem no rollback.** `down` remove a rede e (dependendo de flags) os volumes; o que este runbook sempre usa é `up -d --build [--remove-orphans]`, que recria/substitui containers sem tocar nos volumes nomeados (`postgres_data`, `backend_data`).

---

## 0. Pré-requisitos únicos (antes de qualquer onda)

### 0.1 Push — nem `main` nem `deploy/wave-a` estão em origin ainda

Verificado agora mesmo: `git ls-remote origin deploy/wave-a` não retorna nada (branch nunca foi enviada), e `origin/main` ainda está em `c032823` (Fase 5, o commit ANTES das duas correções desta rodada) — ou seja, os commits `05f2299` e `ff19571` também não chegaram a origin. Sem isto, `git fetch origin && git reset --hard <sha>` no servidor falha com `unknown revision` no meio do procedimento, para as duas ondas.

**No seu laptop, antes de ir para o servidor:**

```bash
git push origin main
git push origin deploy/wave-a
git ls-remote origin main deploy/wave-a   # confirme os dois SHAs abaixo antes de prosseguir
# main          -> ff19571...
# deploy/wave-a -> 8395732...
```

### 0.2 Estado atual do servidor

**Produção está intocada** — os containers ainda rodam código anterior à Fase 1.

```bash
# No servidor, dentro de /opt/baia360
cd /opt/baia360
git status
git rev-parse HEAD        # ANOTE este valor — é o piso de rollback caso as duas ondas precisem ser desfeitas (esperado: 38156a3 ou próximo)
```

### 0.3 Backups (uma vez, antes de tocar em qualquer coisa)

```bash
mkdir -p /root/backups   # usando o local onde os backups anteriores já vivem no servidor

# Backup do Postgres (named volume "postgres_data", container baia360-postgres)
docker exec baia360-postgres pg_dump -U baia360 baia360 > /root/backups/pg_pre_fase5_$(date +%Y%m%d_%H%M%S).sql

# Backup do volume de dados do Estoque/Fat.Armazenagem (JSON, hoje montado em backend, migra para central na Wave B)
docker run --rm -v baia360_backend_data:/data -v /root/backups:/backup alpine \
  tar czf /backup/backend_data_pre_fase5_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .

# backend/.env.production NÃO está no repositório — é o único lugar com os segredos reais.
# Já existe uma cópia off-server em ~/Baia360-Secrets (fora deste servidor) — apenas
# adicione mais uma cópia datada lá dentro; não é preciso reinventar o transporte:
cp /opt/baia360/backend/.env.production /root/backups/env.production_pre_fase5_$(date +%Y%m%d_%H%M%S)
# Depois, do lado do laptop/repositório de segredos:
#   scp usuario@servidor:/root/backups/env.production_pre_fase5_* ~/Baia360-Secrets/
```

### 0.4 Alembic — árvore de decisão (ANTES de qualquer deploy, não depois)

**Isto precisa acontecer aqui, não depois do `git reset`/`up -d --build`.** O ponto inteiro do Blocker 2 original era: se o banco não estiver stampado, `entrypoint.sh` roda `alembic upgrade head` sozinho, bate em tabelas que já existem, e o container entra em crash loop — momento em que `docker exec baia360-backend alembic stamp ...` não alcança mais nada, porque o container está reiniciando, não rodando. A consulta abaixo usa `psql` direto no container do Postgres, que já está de pé e independente do backend — funciona como pré-voo de verdade.

Cadeia real de revisões (mais antiga → mais nova): `ba7771d00ae9` (baseline) → `2cc774672704` (corrige default de status) → `ea3c7e95f47e` (move tabelas para atlas/central/identity — **head**).

```bash
docker exec baia360-postgres psql -U baia360 -d baia360 -c "SELECT version_num FROM alembic_version;"
```

**ANOTE o valor retornado — ele é `PRE_WAVE_A_ALEMBIC_VERSION`, referenciado no rollback (§Wave A, Rollback) mais abaixo.**

| Saída de `alembic_version` | Significado | Ação |
|---|---|---|
| `ea3c7e95f47e` | Já no head — algo já rodou a migração antes | Nenhuma — `entrypoint.sh` vai confirmar e seguir quando a Wave A subir |
| `2cc774672704` | Uma migração atrás do head | Normal — `alembic upgrade head` dentro do `entrypoint.sh` aplica `ea3c7e95f47e` quando a Wave A subir |
| `ba7771d00ae9` | No baseline, duas migrações atrás | Normal — `entrypoint.sh` aplica as duas em sequência quando a Wave A subir |
| *(tabela vazia / erro "no such table")* | Banco nunca foi stampado com Alembic | Antes de subir a Wave A: `docker exec baia360-backend alembic stamp ba7771d00ae9` (com o container **atual**, pré-Fase-1, ainda rodando) — sem isso, o `alembic upgrade head` da Wave A tenta `CREATE TABLE` em tabelas que já existem e crasha |
| Qualquer outro valor | Estado desconhecido — **PARE**, não prossiga sem entender por que | Investigue manualmente antes de continuar |

Wave B não adiciona nenhuma migração nova — não repita esta árvore de decisão nela, mas confirme rapidamente antes de seguir (§Wave B, Verificação) que o valor continua `ea3c7e95f47e`, como checagem de sanidade, não como decisão.

### 0.5 Secrets — verificação, não geração

As chaves já existem no servidor (RS256 em base64, gerado numa sessão anterior). **Não gere nada de novo aqui** — confirme que o que já está lá é válido e consistente.

```bash
cd /opt/baia360/backend

# 1. Confirma que JWT_PUBLIC_KEY decodifica para um PEM válido em AMBOS os arquivos
grep '^JWT_PUBLIC_KEY=' .env.production | cut -d= -f2- | base64 -d | head -1
# esperado: -----BEGIN PUBLIC KEY-----
grep '^JWT_PUBLIC_KEY=' .env.central.production | cut -d= -f2- | base64 -d | head -1
# esperado: -----BEGIN PUBLIC KEY-----

# 2. Confirma que JWT_PRIVATE_KEY existe SÓ no .env.production do Atlas (não em Central)
grep -c '^JWT_PRIVATE_KEY=' .env.production          # esperado: 1
grep -c '^JWT_PRIVATE_KEY=' .env.central.production  # esperado: 0 — se der 1, PARE, é uma violação do design "Central nunca minta"

# 3. Confirma que CENTRAL_SERVICE_TOKEN é IDÊNTICO nos dois arquivos (byte a byte)
diff <(grep '^CENTRAL_SERVICE_TOKEN=' .env.production) <(grep '^CENTRAL_SERVICE_TOKEN=' .env.central.production)
# saída vazia = idêntico. Qualquer diff aqui = Atlas e Central nunca vão se autenticar entre si.

# 4. Confirma se ambos os arquivos existem — se .env.central.production estiver ausente,
#    docker compose config falha ANTES de recriar qualquer container (comportamento
#    observado localmente, não hipotético):
docker compose -f docker-compose.prod.yml config >/dev/null
echo "exit code: $?"   # 0 = ambos os arquivos presentes e o YAML é válido

# 5. FRONTEND_URL precisa ser EXATAMENTE a origem real — CORS em produção (FLASK_ENV=
#    production, ver 0.6) passa a aceitar só este valor, nada de localhost como fallback.
grep '^FRONTEND_URL=' .env.production .env.central.production
# esperado nas duas linhas: FRONTEND_URL=https://baia360.com.br
# (confirmado em frontend/nginx.conf: server_name baia360.com.br www.baia360.com.br)
# Se o valor for diferente (www., http sem s, domínio errado), corrija ANTES de subir —
# senão o frontend real fica bloqueado por CORS assim que a Wave A subir.
```

### 0.6 Gate B4.4 — tabela de variáveis (adicione o que faltar ANTES de recriar containers)

**FLASK_ENV=production está faltando nos dois arquivos hoje** (confirmado via `docker inspect` no container real) — adicione agora. Auditado, não assumido: o código **pré-Fase-1** já lê `FLASK_ENV` do mesmo jeito e controla exatamente as mesmas três coisas (`git show 38156a3:backend/app.py` — `JWT_COOKIE_SECURE`, CORS restrito a `FRONTEND_URL`, HSTS) — ou seja, isto não é comportamento novo sendo introduzido às cegas: mesmo se o rollback te levar de volta ao `38156a3`, adicionar `FLASK_ENV=production` continua seguro lá também, com a mesma ressalva do item 0.5 (FRONTEND_URL tem que estar certo). Sem `FLASK_ENV=production`, o cookie JWT nunca sai com a flag `Secure`, mesmo atrás de HTTPS.

```bash
grep -q '^FLASK_ENV=' .env.production || echo 'FLASK_ENV=production' >> .env.production
grep -q '^FLASK_ENV=' .env.central.production || echo 'FLASK_ENV=production' >> .env.central.production
# Se existir mas com valor errado, corrija manualmente com um editor — não use sed às cegas aqui.
```

| Variável | Serviço(s) | Obrigatória? | O que quebra se ausente |
|---|---|---|---|
| `DATABASE_URL` | Atlas + Central | Sim | Processo não sobe, `SQLALCHEMY_DATABASE_URI=None` |
| `POSTGRES_PASSWORD` | postgres (interpolação do compose) | Sim | Container Postgres não inicializa |
| `SECRET_KEY` | Atlas | Sim | Sessão/flash quebra silenciosamente |
| `JWT_PRIVATE_KEY` | **Só Atlas** | Sim (Atlas) / **NUNCA em Central** | Atlas: falha alto no boot (`requer_emissao=True`, corrigido nesta rodada). Central: nunca deveria ter — se tiver, é uma violação de design a corrigir manualmente. |
| `JWT_PUBLIC_KEY` | Atlas + Central | Sim | Processo não sobe (`RuntimeError` no boot, ambos os processos) |
| `CENTRAL_SERVICE_TOKEN` | Atlas + Central | Sim | `/internal/*` sempre rejeita com 403, mesmo com JWT válido |
| `CENTRAL_BASE_URL` | Atlas | Não (default `http://localhost:5003`) | Em prod, sem isso Atlas tenta falar com localhost — dashboard do Atlas fica sempre indisponível |
| `FRONTEND_URL` | Atlas + Central | Não (default localhost) | Com `FLASK_ENV=production`, CORS passa a aceitar só este valor — errado ou ausente, bloqueia o frontend real (ver 0.5) |
| `FLASK_ENV` | Atlas + Central | **Faltando hoje — adicionar agora** | Cookie sem `Secure`, CORS aceita localhost mesmo em prod |
| `SEED_KEY` | Atlas | Não, mas ver aviso abaixo | — |
| `ADMIN_SENHA` | Atlas | Não, mas ver aviso abaixo | — |
| `OPENAI_API_KEY`, `OPENAI_VECTOR_STORE_ID` | Atlas | Sim (para IA funcionar) | Chamadas OpenAI falham, chat quebra |
| `AZURE_CLIENT_ID/SECRET/TENANT_ID/REDIRECT_URI` | Atlas | Sim (para Outlook funcionar) | Fluxo OAuth Outlook quebra |
| `MCP_OUTLOOK_URL` | Atlas | Não (default localhost) | Em prod, sem isso Atlas não alcança o MCP Outlook |
| `JWT_SECRET_KEY` | — | **Não usada por nenhum código novo** | Ver aviso de remoção abaixo |

**⚠️ Aviso SEED_KEY / ADMIN_SENHA:** nunca configure `ADMIN_SENHA` sem também configurar `SEED_KEY`. Sem `SEED_KEY`, uma requisição `{"seed_key": ""}` (string vazia, não omitida) passa no comparador de `POST /api/auth/seed`. Hoje isso é inofensivo só porque `ADMIN_SENHA` também está vazio (a rota falha um passo depois com 500) — não dependa disso continuar assim.

**⚠️ `JWT_SECRET_KEY` fica em `.env.production` durante todo o deploy.** O código novo nunca lê essa variável, mas produção roda `restart: unless-stopped` — se o container reiniciar por qualquer motivo antes da Wave A estar no ar, ele ainda executa código HS256 antigo, que precisa dela. Remover cedo demais = uma reinicialização incidental quebra login silenciosamente. **Remoção é um passo pós-deploy explícito (§Pós-deploy), só depois de verificar a Wave A no ar.**

---

## Wave A — Fases 1–4 (contrato + RS256 + schema move, ainda um processo)

### Deploy

Reconstrói `backend` **e** `frontend` — Fase 2 (já incluída na base da Wave A) mudou `frontend/src/pages/Atlas.tsx` (removeu a busca antiga e morta de `get_dashboard`), e o `nginx.conf` desta branch ainda é o de antes do split (`git diff 842de46 deploy/wave-a -- frontend/nginx.conf` é vazio), então reconstruir o frontend agora é seguro e necessário para não deixar o Atlas.tsx desatualizado no ar.

```bash
cd /opt/baia360
git fetch origin
git reset --hard 8395732   # branch deploy/wave-a — NÃO use origin/main aqui, ainda não é a hora
docker compose -f docker-compose.prod.yml up -d --build backend frontend
```

### Verificação

```bash
# Containers de pé
docker compose -f docker-compose.prod.yml ps

# Alembic no head
docker exec baia360-postgres psql -U baia360 -d baia360 -c "SELECT version_num FROM alembic_version;"
# esperado: ea3c7e95f47e

# Login funciona sobre RS256 (vai deslogar os 5 usuários — esperado)
curl -i -X POST https://baia360.com.br/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"SEU_EMAIL","senha":"SUA_SENHA"}' 2>&1 | grep -i "set-cookie\|HTTP"
# esperado: 200, Set-Cookie com Secure; HttpOnly

# Dashboard do Atlas ainda funciona (mesmo processo nesta onda, mas exercita o caminho get_dashboard)
# — faça login na UI e pergunte ao Atlas algo como "como está o dashboard este mês?"
```

### Rollback (só se a verificação acima falhar)

**Ordem importa — downgrade do Alembic ANTES do git reset.** Se você fizer `git reset --hard` primeiro, o código volta a não ter a migração `ea3c7e95f47e`, mas `alembic_version` no banco ainda aponta pra ela → próximo boot dá `Can't locate revision` → crash loop, e o código que sabe desfazer isso já não existe mais.

O alvo do downgrade é **o valor que você anotou em `PRE_WAVE_A_ALEMBIC_VERSION` (§0.4)** — não necessariamente o baseline. Se o banco já estava em `2cc774672704` antes da Wave A (por exemplo, uma tentativa anterior parcial), descer até `ba7771d00ae9` desfaria uma migração que já estava em produção antes desta rodada, abaixo do piso real de rollback.

```bash
# 1. Com o código da Wave A AINDA no ar:
docker exec baia360-backend alembic downgrade <PRE_WAVE_A_ALEMBIC_VERSION anotado em 0.4>

# 2. SÓ DEPOIS:
cd /opt/baia360
git reset --hard 38156a3   # o HEAD real anotado no §0.2 — confirme que é esse valor antes de rodar
docker compose -f docker-compose.prod.yml up -d --build backend frontend
```

---

## Wave B — Fase 5 (split físico Atlas/Central)

Não adiciona nenhuma migração nova (`ea3c7e95f47e` continua sendo o head) — o risco aqui é topologia (volume, nginx, DNS do Docker), não schema.

### Deploy

```bash
cd /opt/baia360
git fetch origin
git reset --hard ff19571   # main
docker compose -f docker-compose.prod.yml up -d --build
```

### Verificação

```bash
# Checagem de sanidade rápida (sem árvore de decisão — Wave B não migra nada novo)
docker exec baia360-postgres psql -U baia360 -d baia360 -c "SELECT version_num FROM alembic_version;"
# esperado: ea3c7e95f47e (igual à Wave A — se for diferente, PARE e investigue antes de prosseguir)

# Todos os containers de pé, incluindo o novo "central"
docker compose -f docker-compose.prod.yml ps

# Central INALCANÇÁVEL do host — isolamento de rede de verdade (sem "ports:" no compose)
curl -v --max-time 3 http://localhost:5003/api/health
# esperado: falha de conexão (connection refused/timeout), não um 404 ou 200

# Backend alcança Central via DNS do Docker
docker exec baia360-backend curl -s http://central:5003/api/health
# esperado: {"status":"ok"}

# Login continua funcionando (mesmas chaves RS256 da Wave A, nenhuma mudança de identidade aqui)
# faça login na UI

# Um fluxo de relatório ponta a ponta (Central real, através do nginx)
# faça upload de um Fretes/Pedidos/etc pela UI e confirme o download

# Pergunta ao Atlas que exercita get_dashboard EM UMA CHAMADA HTTP REAL para Central
# (não mais em-processo) — pergunte algo como "quais os KPIs de fretes deste mês?"
# Nota conhecida: se o modelo decidir chamar get_dashboard JUNTO com outra tool na
# mesma resposta, a resolução server-side não acontece (ver COUPLING_MAP.md §7.1,
# bug ativo rastreado, não corrigido nesta rodada) — teste com uma pergunta que só
# peça o dashboard, isoladamente, para essa verificação.

# backend/data persiste através de um recreate (prova real, não assumida — já foi
# provado localmente; isto é a reconfirmação em produção)
docker exec baia360-central cat /app/data/estoque_db.json | head -c 200
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps central
sleep 15
docker exec baia360-central cat /app/data/estoque_db.json | head -c 200
# os dois devem ser idênticos
```

### Rollback (só se a verificação acima falhar)

Sem migração nova nesta onda — não há downgrade de Alembic a fazer. Só reverte o código e volta pra topologia de processo único da Wave A. O checkout da Wave A não tem o serviço `central` no `docker-compose.prod.yml`; `--remove-orphans` no próprio `up` já limpa o container `central` que ficaria órfão — **nunca use `down` para isso**:

```bash
cd /opt/baia360
git reset --hard 8395732   # deploy/wave-a — volta a rodar tudo em um processo só
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans backend frontend
```

---

## Pós-deploy (mesmo dia, depois que Wave B estiver verificada)

1. **Remover `JWT_SECRET_KEY` de `.env.production`** — só agora, com a Wave A confirmadamente estável (nenhum restart incidental rodou código antigo). Edite o arquivo manualmente, remova a linha, `docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps backend`.
2. **Suíte red-team** — gasta OpenAI de verdade, rode no mesmo dia (a superfície de auth mudou por completo — RS256 + processos separados — e a tese de todo o hardening é conter o "lethal trifecta"; não adie isso para "quando der tempo").
3. **Phoenix / `AtlasRAGTrace`** — confirme que o tracing de observabilidade ainda escreve; a suíte `tests/observabilidade/` local está verde de novo (54 passed, 1 skipped) mas isso é contra um Postgres descartável, não contra produção.
4. **Cron de observabilidade** — `tasks_observabilidade.py` é invocado via `docker exec baia360-backend python tasks_observabilidade.py ...`; o nome do container não mudou (`baia360-backend`, propositalmente preservado na Fase 5), então o crontab do servidor não precisa de edição, mas confirme a próxima execução agendada.
5. Considere corrigir os itens documentados em `docs/architecture/COUPLING_MAP.md §7` — em especial o bug ativo do `get_dashboard` (item 1), que é user-facing e tem reprodução conhecida.

---

## Referência rápida — SHAs

| Onda | Branch | Commit | Contém |
|---|---|---|---|
| — | `main` (pré-Fase-1) | `38156a3` | Piso de rollback total — anote o valor real do servidor no §0.2, este é o valor esperado |
| A | `deploy/wave-a` | `8395732` | Fases 1–4 + fixes de chave/dotenv/observabilidade, um processo só |
| B | `main` | `ff19571` | Fase 5 completa (split físico) + fixes de volume/topologia/docs |

**Antes de ir para o servidor:** confirme que `main` e `deploy/wave-a` estão em `origin` (§0.1) — nenhuma das duas branches estava lá no momento em que este runbook foi escrito.
