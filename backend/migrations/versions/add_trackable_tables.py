"""Add trackable and geocache_trackable tables

Revision ID: add_trackable_tables
Revises: add_earthcoach_result_final_answer
Create Date: 2026-09-29 00:00:00.000000

Gestion des trackables (TB) : `trackable` garde le cache local de mon inventaire
et la dernière action choisie par TB au log de cache ; `geocache_trackable` note
les TBs déclarés dans une cache. Voir documentation/trackables-spec.md.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_trackable_tables'
down_revision = 'add_earthcoach_result_final_answer'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'trackable'):
        op.create_table(
            'trackable',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('reference_code', sa.String(length=20), nullable=False),
            sa.Column('brand', sa.String(length=20), nullable=False, server_default='gc'),
            sa.Column('name', sa.String(length=255), nullable=True),
            sa.Column('icon_url', sa.String(length=500), nullable=True),
            sa.Column('tracking_code', sa.String(length=30), nullable=True),
            sa.Column('type_id', sa.Integer(), nullable=True),
            sa.Column('type_name', sa.String(length=255), nullable=True),
            sa.Column('owner_username', sa.String(length=150), nullable=True),
            sa.Column('owner_reference_code', sa.String(length=30), nullable=True),
            sa.Column('holder_username', sa.String(length=150), nullable=True),
            sa.Column('current_geocache_code', sa.String(length=20), nullable=True),
            sa.Column('current_geocache_name', sa.String(length=255), nullable=True),
            sa.Column('goal_html', sa.Text(), nullable=True),
            sa.Column('released_at', sa.String(length=40), nullable=True),
            sa.Column('origin', sa.String(length=255), nullable=True),
            sa.Column('distance_km', sa.Float(), nullable=True),
            sa.Column('is_missing', sa.Boolean(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True),
            sa.Column('is_locked', sa.Boolean(), nullable=True),
            sa.Column('allowed_to_be_collected', sa.Boolean(), nullable=True),
            sa.Column('in_my_inventory', sa.Boolean(), nullable=True),
            sa.Column('last_cache_log_action', sa.String(length=10), nullable=True),
            sa.Column('last_cache_log_action_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_trackable_reference_code', 'trackable', ['reference_code'], unique=True)
        op.create_index('ix_trackable_current_geocache_code', 'trackable', ['current_geocache_code'])
        op.create_index('ix_trackable_in_my_inventory', 'trackable', ['in_my_inventory'])

    if not _table_exists(inspector, 'geocache_trackable'):
        op.create_table(
            'geocache_trackable',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('gc_code', sa.String(length=20), nullable=False),
            sa.Column('trackable_code', sa.String(length=20), nullable=False),
            sa.Column('seen_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('gc_code', 'trackable_code', name='unique_trackable_per_geocache'),
        )
        op.create_index('ix_geocache_trackable_gc_code', 'geocache_trackable', ['gc_code'])
        op.create_index('ix_geocache_trackable_trackable_code', 'geocache_trackable', ['trackable_code'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'geocache_trackable'):
        op.drop_index('ix_geocache_trackable_trackable_code', table_name='geocache_trackable')
        op.drop_index('ix_geocache_trackable_gc_code', table_name='geocache_trackable')
        op.drop_table('geocache_trackable')

    if _table_exists(inspector, 'trackable'):
        op.drop_index('ix_trackable_in_my_inventory', table_name='trackable')
        op.drop_index('ix_trackable_current_geocache_code', table_name='trackable')
        op.drop_index('ix_trackable_reference_code', table_name='trackable')
        op.drop_table('trackable')
