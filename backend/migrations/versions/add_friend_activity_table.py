"""Add friend_activity table for the geocaching friends activity feed

Revision ID: add_friend_activity_table
Revises: add_geocache_logging_task_table
Create Date: 2026-07-27 00:00:00.000000

Le flux d'activité des amis exposé par geocaching.com est plafonné (~100
entrées, ~2 mois). Cette table accumule les synchronisations successives pour
constituer un historique local plus profond ; `log_reference_code` (GLxxxxx)
sert de clé de déduplication.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_friend_activity_table'
down_revision = 'add_geocache_logging_task_table'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'friend_activity'):
        op.create_table(
            'friend_activity',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('log_reference_code', sa.String(length=30), nullable=False),
            sa.Column('activity_type', sa.Integer(), nullable=False, server_default='2'),
            sa.Column('author_username', sa.String(length=150), nullable=False),
            sa.Column('author_reference_code', sa.String(length=30), nullable=True),
            sa.Column('author_avatar_url', sa.String(length=500), nullable=True),
            sa.Column('is_self', sa.Boolean(), nullable=True, server_default=sa.false()),
            sa.Column('log_type_id', sa.Integer(), nullable=True),
            sa.Column('log_date', sa.DateTime(), nullable=True),
            sa.Column('created_date', sa.DateTime(), nullable=True),
            sa.Column('note', sa.Text(), nullable=True),
            sa.Column('cache_name', sa.String(length=255), nullable=True),
            sa.Column('cache_reference_code', sa.String(length=30), nullable=True),
            sa.Column('cache_type_id', sa.Integer(), nullable=True),
            sa.Column('container_type_id', sa.Integer(), nullable=True),
            sa.Column('difficulty', sa.Float(), nullable=True),
            sa.Column('terrain', sa.Float(), nullable=True),
            sa.Column('favorite_points', sa.Integer(), nullable=True),
            sa.Column('image_count', sa.Integer(), nullable=True),
            sa.Column('is_premium', sa.Boolean(), nullable=True),
            sa.Column('is_archived', sa.Boolean(), nullable=True),
            sa.Column('is_favorited', sa.Boolean(), nullable=True),
            sa.Column('latitude', sa.Float(), nullable=True),
            sa.Column('longitude', sa.Float(), nullable=True),
            sa.Column('location_name', sa.String(length=255), nullable=True),
            sa.Column('is_condensed', sa.Boolean(), nullable=True),
            sa.Column('condensed_count', sa.Integer(), nullable=True),
            sa.Column('action_url', sa.String(length=500), nullable=True),
            sa.Column('first_seen_at', sa.DateTime(), nullable=True),
            sa.Column('last_seen_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_friend_activity_log_reference_code', 'friend_activity',
                        ['log_reference_code'], unique=True)
        op.create_index('ix_friend_activity_activity_type', 'friend_activity', ['activity_type'])
        op.create_index('ix_friend_activity_author_username', 'friend_activity', ['author_username'])
        op.create_index('ix_friend_activity_is_self', 'friend_activity', ['is_self'])
        op.create_index('ix_friend_activity_log_type_id', 'friend_activity', ['log_type_id'])
        op.create_index('ix_friend_activity_log_date', 'friend_activity', ['log_date'])
        op.create_index('ix_friend_activity_cache_reference_code', 'friend_activity',
                        ['cache_reference_code'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'friend_activity'):
        for index in (
            'ix_friend_activity_cache_reference_code',
            'ix_friend_activity_log_date',
            'ix_friend_activity_log_type_id',
            'ix_friend_activity_is_self',
            'ix_friend_activity_author_username',
            'ix_friend_activity_activity_type',
            'ix_friend_activity_log_reference_code',
        ):
            op.drop_index(index, table_name='friend_activity')
        op.drop_table('friend_activity')
