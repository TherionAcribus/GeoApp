"""Add generated final answer column to earthcoach_result

Le message final peut etre retouche dans le dossier : la version generee par
le modele est conservee a part, pour signaler les retouches (la version de
controle ne traduit qu'elle) et permettre d'y revenir.

Revision ID: add_earthcoach_result_final_answer_generated
Revises: add_earthcoach_result_final_answer_control
Create Date: 2026-11-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_result_final_answer_generated'
down_revision = 'add_earthcoach_result_final_answer_control'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'final_answer_generated' not in columns:
        op.add_column('earthcoach_result', sa.Column('final_answer_generated', sa.Text(), nullable=True))


def downgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'final_answer_generated' in columns:
        op.drop_column('earthcoach_result', 'final_answer_generated')
