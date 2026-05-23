"""Add structured user observations for EarthCoach

Revision ID: add_user_observation_table
Revises: add_geocache_image_type
Create Date: 2026-05-23 00:00:00.000000

Adds a first-class user_observation table plus image links so EarthCoach can
distinguish observations, hypotheses and interpretations without relying only
on free-form notes.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_user_observation_table'
down_revision = 'add_geocache_image_type'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'user_observation'):
        op.create_table(
            'user_observation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.String(length=100), nullable=True),
            sa.Column('observation_type', sa.String(length=20), nullable=False, server_default='observation'),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('observed_at', sa.DateTime(), nullable=True),
            sa.Column('waypoint_id', sa.Integer(), nullable=True),
            sa.Column('latitude', sa.Float(), nullable=True),
            sa.Column('longitude', sa.Float(), nullable=True),
            sa.Column('coordinates_raw', sa.String(length=100), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id']),
            sa.ForeignKeyConstraint(['waypoint_id'], ['geocache_waypoint.id']),
        )
        op.create_index('ix_user_observation_geocache_id', 'user_observation', ['geocache_id'], unique=False)
        op.create_index('ix_user_observation_waypoint_id', 'user_observation', ['waypoint_id'], unique=False)

    inspector = inspect(conn)
    if not _table_exists(inspector, 'user_observation_image'):
        op.create_table(
            'user_observation_image',
            sa.Column('observation_id', sa.Integer(), nullable=False),
            sa.Column('image_id', sa.Integer(), nullable=False),
            sa.Column('linked_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['observation_id'], ['user_observation.id']),
            sa.ForeignKeyConstraint(['image_id'], ['geocache_image.id']),
            sa.PrimaryKeyConstraint('observation_id', 'image_id'),
        )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'user_observation_image'):
        op.drop_table('user_observation_image')

    inspector = inspect(conn)
    if _table_exists(inspector, 'user_observation'):
        op.drop_index('ix_user_observation_waypoint_id', table_name='user_observation')
        op.drop_index('ix_user_observation_geocache_id', table_name='user_observation')
        op.drop_table('user_observation')
