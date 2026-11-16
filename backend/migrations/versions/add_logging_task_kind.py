"""Add kind column to geocache_logging_task

Une consigne photo (« photo de vous avec le panneau ») n'est pas une question :
elle n'appelle aucune reponse et ne doit pas rendre une resolution incomplete.
Les taches existantes restent des questions.

Revision ID: add_logging_task_kind
Revises: add_zone_folders
Create Date: 2026-11-16 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_logging_task_kind'
down_revision = 'add_zone_folders'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'geocache_logging_task' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('geocache_logging_task')}
    if 'kind' not in columns:
        op.add_column(
            'geocache_logging_task',
            sa.Column('kind', sa.String(length=16), nullable=False, server_default='question'),
        )


def downgrade():
    inspector = inspect(op.get_bind())
    if 'geocache_logging_task' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('geocache_logging_task')}
    if 'kind' in columns:
        op.drop_column('geocache_logging_task', 'kind')
