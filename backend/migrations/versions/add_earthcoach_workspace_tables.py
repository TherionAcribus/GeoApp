"""Add persistent EarthCoach workspaces and results

Revision ID: add_earthcoach_workspace_tables
Revises: add_geocache_owner_guid
Create Date: 2026-09-26 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_workspace_tables'
down_revision = 'add_geocache_owner_guid'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    inspector = inspect(op.get_bind())

    if not _table_exists(inspector, 'earthcoach_workspace'):
        op.create_table(
            'earthcoach_workspace',
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('general_comment', sa.Text(), nullable=True),
            sa.Column('selected_language', sa.String(length=20), nullable=True),
            sa.Column('description_fingerprint', sa.String(length=64), nullable=True),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('geocache_id'),
        )

    if not _table_exists(inspector, 'earthcoach_image_context'):
        op.create_table(
            'earthcoach_image_context',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('image_id', sa.Integer(), nullable=False),
            sa.Column('included', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('waypoint_id', sa.Integer(), nullable=True),
            sa.Column('observation_id', sa.Integer(), nullable=True),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['image_id'], ['geocache_image.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['waypoint_id'], ['geocache_waypoint.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['observation_id'], ['user_observation.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('image_id'),
        )
        op.create_index('ix_earthcoach_image_context_geocache_id', 'earthcoach_image_context', ['geocache_id'])
        op.create_index('ix_earthcoach_image_context_image_id', 'earthcoach_image_context', ['image_id'])
        op.create_index('ix_earthcoach_image_context_waypoint_id', 'earthcoach_image_context', ['waypoint_id'])
        op.create_index('ix_earthcoach_image_context_observation_id', 'earthcoach_image_context', ['observation_id'])

    if not _table_exists(inspector, 'earthcoach_image_group'):
        op.create_table(
            'earthcoach_image_group',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('instruction', sa.Text(), nullable=True),
            sa.Column('waypoint_id', sa.Integer(), nullable=True),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['waypoint_id'], ['geocache_waypoint.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_earthcoach_image_group_geocache_id', 'earthcoach_image_group', ['geocache_id'])
        op.create_index('ix_earthcoach_image_group_waypoint_id', 'earthcoach_image_group', ['waypoint_id'])

    if not _table_exists(inspector, 'earthcoach_image_group_member'):
        op.create_table(
            'earthcoach_image_group_member',
            sa.Column('group_id', sa.Integer(), nullable=False),
            sa.Column('image_id', sa.Integer(), nullable=False),
            sa.Column('role', sa.String(length=20), nullable=False, server_default='other'),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.ForeignKeyConstraint(['group_id'], ['earthcoach_image_group.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['image_id'], ['geocache_image.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('group_id', 'image_id'),
        )

    if not _table_exists(inspector, 'earthcoach_result'):
        op.create_table(
            'earthcoach_result',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('request_id', sa.String(length=64), nullable=False),
            sa.Column('action', sa.String(length=20), nullable=False),
            sa.Column('session_id', sa.String(length=255), nullable=True),
            sa.Column('context_snapshot', sa.JSON(), nullable=False),
            sa.Column('proposals', sa.JSON(), nullable=False),
            sa.Column('markdown', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('request_id'),
        )
        op.create_index('ix_earthcoach_result_geocache_id', 'earthcoach_result', ['geocache_id'])
        op.create_index('ix_earthcoach_result_request_id', 'earthcoach_result', ['request_id'], unique=True)


def downgrade():
    inspector = inspect(op.get_bind())
    for table_name in (
        'earthcoach_result',
        'earthcoach_image_group_member',
        'earthcoach_image_group',
        'earthcoach_image_context',
        'earthcoach_workspace',
    ):
        if _table_exists(inspector, table_name):
            op.drop_table(table_name)
