"""Add reference flag to earthcoach_result

Un resultat EarthCoach peut etre marque comme celui qui fait foi pour sa
geocache : il passe en tete du dossier et ses corrections sont proposees aux
resolutions suivantes.

Revision ID: add_earthcoach_result_is_reference
Revises: add_earthcoach_result_final_answer_generated
Create Date: 2026-11-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_result_is_reference'
down_revision = 'add_earthcoach_result_final_answer_generated'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'is_reference' not in columns:
        op.add_column(
            'earthcoach_result',
            sa.Column('is_reference', sa.Boolean(), nullable=False, server_default='0'),
        )


def downgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'is_reference' in columns:
        op.drop_column('earthcoach_result', 'is_reference')
