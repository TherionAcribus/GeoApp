"""Add gps_zone_operation and gps_zone_operation_item tables

Revision ID: add_gps_zone_operation_tables
Revises: add_gps_visit_table
Create Date: 2026-10-03 00:00:00.000000

Journal des ajouts de caches à une zone depuis les visites GPS, pour pouvoir les
annuler. Voir documentation/garmin-visites-ameliorations-spec.md (lot 1).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_gps_zone_operation_tables'
down_revision = 'add_gps_visit_table'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'gps_zone_operation'):
        op.create_table(
            'gps_zone_operation',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('zone_id', sa.Integer(), nullable=False),
            sa.Column('zone_created', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('state', sa.String(length=20), nullable=False, server_default='running'),
            sa.Column('days', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('finished_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_gps_zone_operation_zone_id', 'gps_zone_operation', ['zone_id'])

    if not _table_exists(inspector, 'gps_zone_operation_item'):
        op.create_table(
            'gps_zone_operation_item',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('operation_id', sa.String(length=64),
                      sa.ForeignKey('gps_zone_operation.id', ondelete='CASCADE'), nullable=False),
            sa.Column('gc_code', sa.String(length=20), nullable=False),
            sa.Column('geocache_id', sa.Integer(), nullable=True),
            sa.Column('action', sa.String(length=10), nullable=False),
        )
        op.create_index('ix_gps_zone_operation_item_operation_id', 'gps_zone_operation_item', ['operation_id'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'gps_zone_operation_item'):
        op.drop_index('ix_gps_zone_operation_item_operation_id', table_name='gps_zone_operation_item')
        op.drop_table('gps_zone_operation_item')
    if _table_exists(inspector, 'gps_zone_operation'):
        op.drop_index('ix_gps_zone_operation_zone_id', table_name='gps_zone_operation')
        op.drop_table('gps_zone_operation')
