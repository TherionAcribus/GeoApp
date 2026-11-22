"""Add final answer control column to earthcoach_result

Quand le message final part dans une autre langue que celle de l'utilisateur,
sa traduction de controle est conservee a cote pour etre relue avant envoi.

Revision ID: add_earthcoach_result_final_answer_control
Revises: add_logging_task_kind
Create Date: 2026-11-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_result_final_answer_control'
down_revision = 'add_logging_task_kind'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'final_answer_control' not in columns:
        op.add_column('earthcoach_result', sa.Column('final_answer_control', sa.Text(), nullable=True))


def downgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'final_answer_control' in columns:
        op.drop_column('earthcoach_result', 'final_answer_control')
