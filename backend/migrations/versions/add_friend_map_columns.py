"""Add map columns: friend_find coordinates and zone.is_hidden

Revision ID: add_friend_map_columns
Revises: add_friend_find_table
Create Date: 2026-07-28 00:00:00.000000

Deux ajouts au service de la carte des trouvailles d'amis :

- `friend_find.latitude/longitude/cache_name/cache_type` : ces métadonnées sont
  déjà présentes dans la réponse de la recherche de référence utilisée pour la
  déduction (`trouvées = référence − complément`) et étaient jusqu'ici jetées.
  Les conserver rend la carte instantanée, sans attendre l'import des caches.
- `zone.is_hidden` : la zone technique « Amis », qui accumule les caches
  importées, n'a pas à encombrer l'arbre des zones.

Les lignes existantes gardent des coordonnées nulles jusqu'à la prochaine
resynchronisation de zone ; les zones existantes sont explicitement visibles.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_friend_map_columns'
down_revision = 'add_friend_find_table'
branch_labels = None
depends_on = None


FRIEND_FIND_COLUMNS = {
    'latitude': sa.Column('latitude', sa.Float(), nullable=True),
    'longitude': sa.Column('longitude', sa.Float(), nullable=True),
    'cache_name': sa.Column('cache_name', sa.String(length=255), nullable=True),
    'cache_type': sa.Column('cache_type', sa.String(length=100), nullable=True),
}


def _column_names(inspector, table_name: str) -> set[str]:
    if table_name not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade():
    inspector = inspect(op.get_bind())

    existing = _column_names(inspector, 'friend_find')
    if existing:
        for name, column in FRIEND_FIND_COLUMNS.items():
            if name not in existing:
                op.add_column('friend_find', column)

    existing = _column_names(inspector, 'zone')
    if existing and 'is_hidden' not in existing:
        op.add_column('zone', sa.Column('is_hidden', sa.Boolean(), nullable=True))
        # Une zone créée avant cette migration est visible : laisser NULL ferait
        # échouer les filtres booléens stricts.
        op.execute('UPDATE zone SET is_hidden = 0 WHERE is_hidden IS NULL')
        op.create_index('ix_zone_is_hidden', 'zone', ['is_hidden'])


def downgrade():
    inspector = inspect(op.get_bind())

    existing = _column_names(inspector, 'zone')
    if 'is_hidden' in existing:
        op.drop_index('ix_zone_is_hidden', table_name='zone')
        op.drop_column('zone', 'is_hidden')

    existing = _column_names(inspector, 'friend_find')
    for name in FRIEND_FIND_COLUMNS:
        if name in existing:
            op.drop_column('friend_find', name)
