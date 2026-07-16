"""add tools_usadas and eval_versao to atlas_rag_trace

Plano de observabilidade 2026-07-16 (Prompt 1): duas colunas aditivas,
nullable, sem backfill — ver o corpo da migração e o commit correspondente
para o motivo de cada uma. Não altera nenhum score de retrieval existente
(top_score/mean_score/retrieval_count ficam byte-idênticos).

- tools_usadas: nomes das tools resolvidas no turno (JSON array-as-text,
  mesma convenção de chunks_json). NULL nas 15 linhas existentes — essa
  informação nunca foi capturada e não pode ser reconstruída a partir do
  que já está gravado; linhas novas sempre populam com uma lista (vazia se
  nenhuma tool rodou).
- eval_versao: qual versão do pipeline de eval escreveu/reprocessou a linha.
  NULL nas 15 linhas existentes (pipeline v1, implícito). Necessário porque,
  após o reprocessamento parcial deste mesmo plano, o corpus passa a ter
  linhas escritas por pipelines diferentes e sem isso não dá pra saber qual
  lógica gerou qual score.

Revision ID: ee60e0f66c31
Revises: ea3c7e95f47e
Create Date: 2026-07-16 12:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ee60e0f66c31'
down_revision: Union[str, Sequence[str], None] = 'ea3c7e95f47e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('atlas_rag_trace', sa.Column('tools_usadas', sa.Text(), nullable=True), schema='atlas')
    op.add_column('atlas_rag_trace', sa.Column('eval_versao', sa.Integer(), nullable=True), schema='atlas')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('atlas_rag_trace', 'eval_versao', schema='atlas')
    op.drop_column('atlas_rag_trace', 'tools_usadas', schema='atlas')
