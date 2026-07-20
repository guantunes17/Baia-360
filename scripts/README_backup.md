# Backup — Trilha A (Postgres) e Trilha B (arquivos)

Ver SDD seção 10. Depois deste projeto, o Postgres é o sistema de registro do
faturamento — config com vigência e dados de reconciliação nascem no banco,
não são reconstruíveis a partir de arquivo.

## Trilha A — Postgres (`pg_dump` + `pg_dumpall --globals-only`)

Um `pg_dump -Fc` sozinho **não basta**: ele captura o conteúdo do banco (as
três schemas — `identity`, `central`, `atlas`, confirmado como um único
database `baia360`), mas não os **globals** do cluster (roles, grants
baseados em role). Num droplet novo, o dado restauraria mas a role com que a
aplicação autentica poderia não existir. Por isso todo backup gera DOIS
artefatos, sempre juntos, no mesmo prefixo:

- `baia360_<timestamp>.dump` — `pg_dump -Fc`
- `baia360_<timestamp>.globals.sql` — `pg_dumpall --globals-only`

### Pré-requisito de host (eu não instalo isso — só uso)

`s3cmd` (não `aws-cli` v2 — o bundle da v2 é pesado demais para um droplet de
2GB que já reserva RAM para o Redis do RQ):

```
sudo apt-get install -y s3cmd
# ou: pip install s3cmd
```

### Variáveis de ambiente (`backend/.env.production`, nunca commitadas)

```
DO_SPACES_KEY=...
DO_SPACES_SECRET=...
DO_SPACES_REGION=nyc3        # exemplo — usar a região real do bucket
DO_SPACES_BUCKET=...
```

### Retenção

7 diários / 4 semanais / 12 mensais, em três prefixos (`backups/daily/`,
`backups/weekly/`, `backups/monthly/`). `scripts/backup_postgres.sh` decide
em quais prefixos o run do dia entra (diário sempre; semanal aos domingos;
mensal no dia 1) e poda cada prefixo para o número de pares mantidos.

### Teste de restore (`scripts/restore_test.sh`)

Baixa o dump diário mais recente + seu `.globals.sql`, sobe um container
Postgres descartável, aplica os globals, roda `pg_restore`, e falha se
**qualquer um** dos dois:

1. `pg_restore` sair com código não-zero (um dump truncado no meio da
   escrita ainda pode restaurar as 3 tabelas de teste e falhar
   silenciosamente no resto — só checar `count()` não pega isso).
2. Uma das contagens em `identity.baia360_users`, `central.relatorios_gerados`,
   `atlas.atlas_conversas` der erro de query.

Container e arquivos temporários são removidos ao final, sucesso ou falha.

### Cron (instalar manualmente — eu não toco no servidor)

```cron
# Backup diário às 03:00 BRT (=06:00 UTC)
0 6 * * * DO_SPACES_KEY=... DO_SPACES_SECRET=... DO_SPACES_REGION=... DO_SPACES_BUCKET=... /path/to/baia-360/scripts/backup_postgres.sh >> /var/log/baia360_backup.log 2>&1

# Teste de restore mensal, dia 2 às 04:00 BRT (=07:00 UTC) — depois do
# backup mensal do dia 1
0 7 2 * * DO_SPACES_KEY=... DO_SPACES_SECRET=... DO_SPACES_REGION=... DO_SPACES_BUCKET=... /path/to/baia-360/scripts/restore_test.sh >> /var/log/baia360_restore_test.log 2>&1
```

(Prefira colocar as credenciais num arquivo fonte por `source` no crontab, em
vez de inline, se o crontab for legível por outros usuários do host.)

## Trilha B — arquivos (brutos + xlsx entregues)

Comprovante fiscal do que foi faturado (ver limite de reprodutibilidade, SDD
seção 0) — **não é reconstruível** a partir do Postgres depois da
refatoração, porque a versão do transform que gerou aquele xlsx deixa de
existir.

Passo manual (não scriptado — trivial demais para valer a manutenção de um
script separado):

1. Ao final de cada apuração mensal, copiar os arquivos brutos recebidos
   (mov, volumes, estoque, etc.) e os xlsx efetivamente entregues para
   armazenamento offsite imutável (ex.: um bucket Spaces separado com
   versionamento/object-lock, ou uma pasta sincronizada fora do droplet).
2. Nunca sobrescrever um mês já arquivado — cada mês é uma pasta própria
   (`AAAA-MM/`).

## Gotcha de disaster recovery — volume externo

Desde este commit, `postgres_data` em `docker-compose.prod.yml` é
`external: true`, apontando para o volume `baia360_postgres_data` que já
existe no droplet atual. Isso é o que impede `docker compose down -v` de
apagar o banco de faturamento por acidente.

**Mas isso também significa que num host NOVO (droplet perdido, restore do
zero) o volume não existe ainda — e compose não cria volumes externos.**
Rodar `docker compose up` direto vai falhar dizendo que o volume não existe.

Ordem correta de disaster recovery:

```
docker volume create baia360_postgres_data
docker compose -f docker-compose.prod.yml --env-file backend/.env.production up -d postgres
# esperar o healthcheck do postgres ficar healthy, então:
#   1. aplicar backup.globals.sql (roles) como superuser
#   2. pg_restore o backup.dump mais recente
docker compose -f docker-compose.prod.yml --env-file backend/.env.production up -d --build
```

Sem o `docker volume create` primeiro, o backup existe mas o `up` nunca
sobe — um backup que não pode ser restaurado a tempo do primeiro `up` não
cumpre o papel dele num disaster recovery real.
