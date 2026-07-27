"""Add friend_find table: which friend found which cache

Revision ID: add_friend_find_table
Revises: add_geocache_log_is_friend_log
Create Date: 2026-07-27 00:00:00.000000

Alimentée par deux sources : le complément du filtre `nfb` de la recherche web
(toutes les trouvailles d'un ami sur une zone, sans limite de date) et les logs
d'amis relevés au rafraîchissement des logs d'une cache.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_friend_find_table'
down_revision = 'add_geocache_log_is_friend_log'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'friend_find'):
        op.create_table(
            'friend_find',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('friend_username', sa.String(length=150), nullable=False),
            sa.Column('gc_code', sa.String(length=30), nullable=False),
            sa.Column('source', sa.String(length=20), nullable=False, server_default='zone_search'),
            sa.Column('first_seen_at', sa.DateTime(), nullable=True),
            sa.Column('last_seen_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('friend_username', 'gc_code', name='unique_find_per_friend'),
        )
        op.create_index('ix_friend_find_friend_username', 'friend_find', ['friend_username'])
        op.create_index('ix_friend_find_gc_code', 'friend_find', ['gc_code'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'friend_find'):
        op.drop_index('ix_friend_find_gc_code', table_name='friend_find')
        op.drop_index('ix_friend_find_friend_username', table_name='friend_find')
        op.drop_table('friend_find')
