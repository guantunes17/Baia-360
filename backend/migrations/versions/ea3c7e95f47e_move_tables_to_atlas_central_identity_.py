"""move tables to atlas central identity schemas

Fase 4 do desacoplamento Atlas/Central — separa as 13 tabelas em três
schemas (atlas, central, identity) dentro da MESMA instância Postgres,
seguindo o mapa de domínio de docs/architecture/COUPLING_MAP.md. Nenhuma
tabela muda de estrutura aqui — só de schema. FKs que cruzam o limite (9 no
total, todas apontando para baia360_users) continuam FKs reais: schemas são
só namespaces dentro do mesmo banco, então uma FK cross-schema é tão válida
e tão íntegra quanto uma dentro do mesmo schema — não há motivo, nesta
fase, pra abrir mão de integridade referencial pelo banco em favor de
checagem na aplicação (isso só passaria a fazer sentido se um dia atlas e
central virarem bancos de fato separados, o que está fora do escopo desta
fase — ver Fase 5/6 do plano).

`ALTER TABLE ... SET SCHEMA` move a tabela e tudo que pertence a ela —
sequence da PK (SERIAL), índices, constraints (incluindo as FKs, que o
Postgres rastreia por OID interno, não por nome qualificado, então
sobrevivem ao ALTER intactas nos dois lados) — sem precisar recriar nada.
Verificado manualmente (ver mensagem do PR): a sequence de cada PK
acompanha a tabela para o novo schema automaticamente.

A tabela alembic_version (bookkeeping do próprio Alembic) fica onde está
(schema public/default) — não faz parte do mapa de domínio da aplicação.

Revision ID: ea3c7e95f47e
Revises: 2cc774672704
Create Date: 2026-07-14 19:25:38.980258

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ea3c7e95f47e'
down_revision: Union[str, Sequence[str], None] = '2cc774672704'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tabela -> schema de destino, na mesma ordem/atribuição de
# docs/architecture/COUPLING_MAP.md (identity primeiro, por ser referenciada
# pelas demais — a ordem não afeta a correção do ALTER, só a legibilidade).
TABELAS_POR_SCHEMA = {
    'identity': ['baia360_users', 'permissoes'],
    'atlas': [
        'atlas_logs', 'atlas_rag_trace', 'atlas_golden_qa', 'atlas_golden_run',
        'atlas_projetos', 'atlas_conversas', 'atlas_memoria', 'atlas_instrucao',
        'atlas_acao_log', 'outlook_tokens',
    ],
    'central': ['relatorios_gerados'],
}


def upgrade() -> None:
    """Upgrade schema."""
    for schema in TABELAS_POR_SCHEMA:
        op.execute(f'CREATE SCHEMA IF NOT EXISTS {schema}')

    for schema, tabelas in TABELAS_POR_SCHEMA.items():
        for tabela in tabelas:
            op.execute(f'ALTER TABLE public.{tabela} SET SCHEMA {schema}')


def downgrade() -> None:
    """Downgrade schema."""
    for schema, tabelas in TABELAS_POR_SCHEMA.items():
        for tabela in tabelas:
            op.execute(f'ALTER TABLE {schema}.{tabela} SET SCHEMA public')

    # RESTRICT (padrão do DROP SCHEMA): falha alto se algo ainda estiver lá
    # dentro em vez de apagar silenciosamente — mas a essa altura os schemas
    # já estão vazios, todas as tabelas voltaram para public acima.
    for schema in TABELAS_POR_SCHEMA:
        op.execute(f'DROP SCHEMA IF EXISTS {schema} RESTRICT')
