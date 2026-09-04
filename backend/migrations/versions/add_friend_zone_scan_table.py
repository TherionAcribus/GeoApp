"""Add friend_zone_scan table: memory of zone analyses per friend

Revision ID: add_friend_zone_scan_table
Revises: add_friend_map_columns
Create Date: 2026-09-03 00:00:00.000000

Mémorise le résultat de chaque analyse « qui a trouvé quoi » sur une zone,
par ami. Sans cette table, « absent de friend_find » est indiscernable de
« jamais analysé » : un re-scan repaginerait intégralement la boîte pour
chaque ami, même ceux dont on sait déjà qu'ils n'ont rien trouvé.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_friend_zone_scan_table'
down_revision = 'add_friend_map_columns'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'friend_zone_scan'):
        op.create_table(
            'friend_zone_scan',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('friend_username', sa.String(length=150), nullable=False),
            sa.Column('zone_id', sa.Integer(), nullable=False),
            sa.Column('box_signature', sa.String(length=100), nullable=True),
            sa.Column('baseline_total', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('found_count', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('zone_matches', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('truncated', sa.Boolean(), nullable=True, server_default=sa.false()),
            sa.Column('scanned_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('friend_username', 'zone_id', name='unique_scan_per_friend_zone'),
        )
        op.create_index('ix_friend_zone_scan_friend_username', 'friend_zone_scan',
                        ['friend_username'])
        op.create_index('ix_friend_zone_scan_zone_id', 'friend_zone_scan', ['zone_id'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'friend_zone_scan'):
        op.drop_index('ix_friend_zone_scan_zone_id', table_name='friend_zone_scan')
        op.drop_index('ix_friend_zone_scan_friend_username', table_name='friend_zone_scan')
        op.drop_table('friend_zone_scan')
