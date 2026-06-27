"""Add EarthCache logging tasks

Revision ID: add_geocache_logging_task_table
Revises: add_user_observation_table
Create Date: 2026-06-27 00:00:00.000000

Adds a first-class geocache_logging_task table so EarthCoach can track each
question required by the cache owner, what to observe to answer it, the drafted
answer and the supporting field observation. Backs the structured resolver mode.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_logging_task_table'
down_revision = 'add_user_observation_table'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'geocache_logging_task'):
        op.create_table(
            'geocache_logging_task',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('question', sa.Text(), nullable=False),
            sa.Column('guidance', sa.Text(), nullable=True),
            sa.Column('answer', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='todo'),
            sa.Column('requires_photo', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('observation_id', sa.Integer(), nullable=True),
            sa.Column('source', sa.String(length=20), nullable=False, server_default='manual'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id']),
            sa.ForeignKeyConstraint(['observation_id'], ['user_observation.id'], ondelete='SET NULL'),
        )
        op.create_index('ix_geocache_logging_task_geocache_id', 'geocache_logging_task', ['geocache_id'], unique=False)
        op.create_index('ix_geocache_logging_task_observation_id', 'geocache_logging_task', ['observation_id'], unique=False)


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'geocache_logging_task'):
        op.drop_index('ix_geocache_logging_task_observation_id', table_name='geocache_logging_task')
        op.drop_index('ix_geocache_logging_task_geocache_id', table_name='geocache_logging_task')
        op.drop_table('geocache_logging_task')
