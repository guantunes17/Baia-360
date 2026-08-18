"""add atlas_json to permissoes

Segregação da base de conhecimento do Atlas (COMUM/RESTRITA): a concessão de
acesso à base restrita vive numa coluna própria de Permissao, no mesmo padrão
de hub_json/modulos_json — o enforcement lê a linha viva, nunca a string
`perfil` (COUPLING_MAP §5).

NOT NULL com server_default '{}' de propósito, e não nullable: toda linha
existente passa a ter um objeto vazio, que atlas_kb.escopo_para() lê como
"sem concessão". Não existe estado em que a migração conceda acesso a alguém
— nem transitoriamente, nem por omissão de backfill. A migração não tem como
falhar aberta.

Sem índice: a coluna nunca é filtrada, só lida junto da linha do usuário.

Ver Permissao.atlas_json / _atlas_permissoes em backend/app.py e
ATLAS_CONCEDIVEIS em backend/atlas_kb.py.

Revision ID: c1e7b93af204
Revises: 9033ea28bb29
Create Date: 2026-08-18 10:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1e7b93af204'
down_revision: Union[str, Sequence[str], None] = '9033ea28bb29'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'permissoes',
        sa.Column('atlas_json', sa.Text(), nullable=False, server_default='{}'),
        schema='identity',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('permissoes', 'atlas_json', schema='identity')
