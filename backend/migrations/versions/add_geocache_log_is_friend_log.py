"""Add is_friend_log flag on geocache logs

Revision ID: add_geocache_log_is_friend_log
Revises: add_friend_activity_table
Create Date: 2026-07-27 00:00:00.000000

Marque les logs écrits par un ami Geocaching.com. Le drapeau est renseigné au
rafraîchissement des logs via `seek/geocache.logbook?...&sf=true`, où c'est
geocaching.com qui filtre selon la liste d'amis du compte connecté.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_log_is_friend_log'
down_revision = 'add_friend_activity_table'
branch_labels = None
depends_on = None


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return column_name in {column['name'] for column in inspector.get_columns(table_name)}


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _column_exists(inspector, 'geocache_log', 'is_friend_log'):
        op.add_column(
            'geocache_log',
            sa.Column('is_friend_log', sa.Boolean(), nullable=True, server_default=sa.false()),
        )
        op.create_index('ix_geocache_log_is_friend_log', 'geocache_log', ['is_friend_log'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _column_exists(inspector, 'geocache_log', 'is_friend_log'):
        op.drop_index('ix_geocache_log_is_friend_log', table_name='geocache_log')
        op.drop_column('geocache_log', 'is_friend_log')
