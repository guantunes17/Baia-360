"""add escopo_kb to atlas_rag_trace

Segregação da base de conhecimento do Atlas: grava as bases EFETIVAMENTE
anexadas ao file_search em cada turno.

Sem esta coluna, zero_retrieval=True é ambíguo entre "o documento não existe"
e "o documento estava fora do escopo daquele usuário" — a mesma ambiguidade
NULL vs [] que já custou um bug de reprocessamento neste projeto (ver
data_2026-07-16_reprocess_rag_traces.sql). Escopo é dado observável, não
inferência feita depois.

Nullable, sem backfill e sem índice: linhas anteriores a esta coluna nunca
tiveram a informação capturada e não há como reconstruí-la — NULL é a resposta
honesta, e o dashboard as segmenta como 'legacy_unknown' em vez de assumir
'comum'. A segmentação é feita em Python sobre um fetch por janela, igual a
tools_usadas, então não há filtro por esta coluna para um índice servir.

Ver AtlasRAGTrace.escopo_kb em backend/app.py.

Revision ID: d4b8f2c07e15
Revises: c1e7b93af204
Create Date: 2026-08-18 11:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4b8f2c07e15'
down_revision: Union[str, Sequence[str], None] = 'c1e7b93af204'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('atlas_rag_trace', sa.Column('escopo_kb', sa.Text(), nullable=True),
                  schema='atlas')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('atlas_rag_trace', 'escopo_kb', schema='atlas')
