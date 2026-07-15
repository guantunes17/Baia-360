# Runbook — Deploy do desacoplamento Atlas/Central (Fases 1–5 + correções de Prompt 6)

**Mecanismo: duas ondas.** O cherry-pick de Wave A (identity.py + fixes de dotenv/observabilidade) sobre o commit da Fase 4 aplicou limpo depois de resolver dois conflitos pequenos e esperados (um arquivo que ainda não existia, uma função que ainda não tinha `requer_emissao`) — não foi um cherry-pick sujo, então duas ondas reais fazem sentido aqui: Wave A isola o risco de **dado** (Alembic, schema move, ainda um processo só); Wave B isola o risco de **topologia** (split de processo, volume, nginx, DNS do Docker). Se a Wave A falhar, você não herda a complexidade do split. Se a Wave B falhar, você já sabe que o banco está saudável.

- **Wave A** — branch `deploy/wave-a`, commit **fixo** `8395732` (Fases 1–4: contrato interno, RS256, schema move, mais os fixes de chave-em-base64/dotenv/suíte de observabilidade). Ainda **um único processo** (`baia360-backend` servindo tudo). Esta branch é congelada de propósito e não deve receber novos commits — ela também é o alvo de rollback da Wave B (ver §Wave B/Rollback), então precisa continuar apontando exatamente para o estado já verificado.
- **Wave B** — branch `main`, **HEAD de `origin/main` no momento do deploy** (resolvido dinamicamente em §0.1, não fixado aqui). `main` é a branch de integração normal do projeto — qualquer commit escrito hoje sobre "o SHA de main" ficaria desatualizado assim que outro commit landasse nela (este próprio runbook vive em `main`, então fixar seu próprio SHA aqui seria uma referência circular). No momento em que este runbook foi revisado pela última vez, `origin/main` estava em `4108289`, mas **não confie nesse número** — resolva-o de novo em §0.1 antes de cada deploy.

Todos os 5 usuários serão deslogados quando RS256 (Wave A) entrar no ar — os cookies antigos (se houver algum, o sistema atual é HS256 pré-Fase-1) não validam mais.

**Nenhum passo deste runbook usa `docker compose down`, em nenhuma circunstância — nem no rollback.** `down` remove a rede e (dependendo de flags) os volumes; o que este runbook sempre usa é `up -d --build [--remove-orphans]`, que recria/substitui containers sem tocar nos volumes nomeados (`postgres_data`, `backend_data`).

---

## 0. Pré-requisitos únicos (antes de qualquer onda)

### 0.1 Confirmar que as duas branches estão em origin, e resolver o SHA de Wave B

Sem isto, `git fetch origin && git reset --hard <ref>` no servidor falha com `unknown revision` no meio do procedimento. **No seu laptop, antes de ir para o servidor:**

```bash
git ls-remote origin main deploy/wave-a
```

- `refs/heads/deploy/wave-a` **precisa** mostrar `8395732...` exatamente — essa branch é fixa (ver nota no topo do documento). Se mostrar outro valor, ou não aparecer, PARE: algo mudou na branch congelada e o rollback da Wave B não é mais confiável até isso ser entendido.
- `refs/heads/main` mostra o que está em origin **agora** — copie esse valor, é o seu `WAVE_B_TARGET_SHA` para a seção Wave B mais abaixo. Não existe um valor "certo" fixo aqui por design (ver nota no topo do documento); o que importa é que `main` esteja de fato em origin (comando acima não retorna vazio) e que o valor resolvido seja o que você de fato pretende deployar.

Se algum push ainda estiver pendente (branches locais à frente de origin), resolva antes de continuar:

```bash
git push origin main
git push origin deploy/wave-a   # só se você tiver certeza que precisa mover a branch congelada — normalmente não deveria
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

**ANOTE o valor retornado pela consulta abaixo — ele é `PRE_WAVE_A_ALEMBIC_VERSION`, referenciado no rollback (§Wave A, Rollback) mais abaixo.**

**A resposta esperada, verificada por código, é `2cc774672704` — a linha de "tabela vazia" abaixo é teoricamente inalcançável hoje, mas fica documentada por completude.** `git show 38156a3:backend/entrypoint.sh` mostra que o `entrypoint.sh` do código atualmente em produção **já** roda `alembic upgrade head` antes de subir o gunicorn, e `alembic==1.18.5` já está no `requirements.txt` daquele commit. Como o container de produção está de pé e servindo tráfego (não em crash loop), ele necessariamente já passou por um `alembic upgrade head` bem-sucedido — logo o banco não pode estar destampado. E como `38156a3` é anterior à Fase 4, seu diretório `migrations/versions/` só contém `ba7771d00ae9` e `2cc774672704` (`ea3c7e95f47e` ainda não existe nesse commit) — ou seja, o head daquele código é exatamente `2cc774672704`, e é isso que a consulta abaixo deve retornar. Rode a consulta mesmo assim — é a confirmação real, não a suposição:

```bash
docker exec baia360-postgres psql -U baia360 -d baia360 -c "SELECT version_num FROM alembic_version;"
```

| Saída de `alembic_version` | Significado | Ação |
|---|---|---|
| `2cc774672704` | **Esperado** — head do código pré-Fase-1 atualmente rodando | Normal — `alembic upgrade head` dentro do `entrypoint.sh` aplica `ea3c7e95f47e` quando a Wave A subir |
| `ea3c7e95f47e` | Já no head da Wave A — indica que algo já rodou essa migração antes (não deveria acontecer partindo de pré-Fase-1, investigue por que) | Nenhuma ação de migração — `entrypoint.sh` vai confirmar e seguir quando a Wave A subir, mas entenda a causa antes |
| `ba7771d00ae9` | No baseline — indica que a migração de correção de status nunca rodou (inesperado se o histórico do repositório está correto) | Investigue antes de prosseguir; se confirmado, `entrypoint.sh` aplica as duas migrações em sequência quando a Wave A subir |
| *(tabela vazia / erro "no such table")* | Teoricamente inalcançável (ver acima) — se acontecer mesmo assim, o container de produção pode não ser o `38156a3` que este runbook assume | **PARE.** Não presuma que é seguro stampar sem entender por que o pressuposto acima falhou. |
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
| `ATLAS_EGRESSO_DOMINIOS_INTERNOS` | Atlas | Não — **hoje ausente, ver aviso abaixo** | Ver aviso ATLAS_BLOQUEAR_EXTERNO abaixo |
| `ATLAS_BLOQUEAR_EXTERNO` | Atlas | Não — **hoje ausente, ver aviso abaixo** | Ver aviso abaixo |
| `JWT_SECRET_KEY` | — | **Não usada por nenhum código novo** | Ver aviso de remoção abaixo |

**⚠️ Aviso SEED_KEY / ADMIN_SENHA:** nunca configure `ADMIN_SENHA` sem também configurar `SEED_KEY`. Sem `SEED_KEY`, uma requisição `{"seed_key": ""}` (string vazia, não omitida) passa no comparador de `POST /api/auth/seed`. Hoje isso é inofensivo só porque `ADMIN_SENHA` também está vazio (a rota falha um passo depois com 500) — não dependa disso continuar assim.

**⚠️ Aviso `ATLAS_BLOQUEAR_EXTERNO` / `ATLAS_EGRESSO_DOMINIOS_INTERNOS` — o controle de egresso está INERTE hoje, confirmado no código (`app.py:924-955`, `avaliar_egresso`), não hipotético.** Com as duas variáveis ausentes: `ATLAS_EGRESSO_DOMINIOS_INTERNOS` vazio faz `dominios_internos` ser um conjunto vazio, o que marca **todo** destinatário como `externo: True` — mas `ATLAS_BLOQUEAR_EXTERNO` ausente faz `bloquear_externo` ser `False` por padrão, então `bloqueado` fica sempre `False`. Resultado: nenhuma ação de e-mail/Teams é bloqueada por este mecanismo hoje — só gera um aviso ⚠️ no card de confirmação, que já é exigido para toda ação side-effectful (Fase 2). Não é uma regressão desta rodada — é assim desde que o mecanismo foi escrito, e a contenção real hoje é o gate de confirmação humana, não este allow-list.

**Não ative isso nesta rodada de deploy.** Ligar só `ATLAS_BLOQUEAR_EXTERNO=true` sem também popular `ATLAS_EGRESSO_DOMINIOS_INTERNOS` bloquearia **todo** destinatário, incluindo os internos (o allow-list continuaria vazio, então tudo continua marcado como `externo`) — na prática desativaria `enviar_email`/`teams_chat_enviar` por completo. Ativar esse controle corretamente precisa de uma mudança própria: levantar a lista real de domínios internos da empresa junto ao negócio, configurar `ATLAS_EGRESSO_DOMINIOS_INTERNOS` com ela, e só então considerar `ATLAS_BLOQUEAR_EXTERNO=true`. Fora do escopo deste deploy.

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
git reset --hard origin/main   # o WAVE_B_TARGET_SHA resolvido em §0.1 — não um SHA fixo neste documento
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
| A | `deploy/wave-a` | `8395732` **(fixo — ver nota no topo do documento)** | Fases 1–4 + fixes de chave/dotenv/observabilidade, um processo só |
| B | `main` | **dinâmico — resolva via `git ls-remote origin main` em §0.1** | Fase 5 completa (split físico) + fixes de volume/topologia/docs, mais qualquer commit que tenha landado em `main` desde então |

**Antes de ir para o servidor:** confirme os dois refs em `origin` e resolva o SHA de Wave B (§0.1) — não copie um número deste documento para a Wave B.
