"""add falhou and erro_mensagem to atlas_rag_trace

Plano de integridade Atlas 2026-07-16 (Prompt 1, §4) — colunas aditivas,
nullable, sem backfill. Distinguem um turno que terminou normalmente
(falhou=False) de um que morreu no meio do stream (falhou=True, ex. rate
limit interno como no incidente gurq9e4e) — sem isso, um turno que falha
gera zero traces, apagando justamente o caso mais importante de registrar.
Ver AtlasRAGTrace.falhou/erro_mensagem em backend/app.py.

Revision ID: 9033ea28bb29
Revises: ee60e0f66c31
Create Date: 2026-07-16 19:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9033ea28bb29'
down_revision: Union[str, Sequence[str], None] = 'ee60e0f66c31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('atlas_rag_trace', sa.Column('falhou', sa.Boolean(), nullable=True), schema='atlas')
    op.add_column('atlas_rag_trace', sa.Column('erro_mensagem', sa.Text(), nullable=True), schema='atlas')
    # Sem naming_convention customizada em db.metadata (ver app.py), o padrão
    # do SQLAlchemy é ix_<tabela>_<coluna> — SEM prefixo de schema (ALTER
    # TABLE...SET SCHEMA em ea3c7e95f47e não renomeou os índices existentes;
    # ix_atlas_rag_trace_eval_flagged, por exemplo, continua sem "atlas_" no
    # nome mesmo com a tabela hoje vivendo no schema atlas). Mantendo o mesmo
    # padrão aqui.
    op.create_index('ix_atlas_rag_trace_falhou', 'atlas_rag_trace', ['falhou'],
                     unique=False, schema='atlas')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_atlas_rag_trace_falhou', table_name='atlas_rag_trace', schema='atlas')
    op.drop_column('atlas_rag_trace', 'erro_mensagem', schema='atlas')
    op.drop_column('atlas_rag_trace', 'falhou', schema='atlas')
