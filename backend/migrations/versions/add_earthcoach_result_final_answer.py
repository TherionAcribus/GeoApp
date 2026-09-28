"""Add final answer column to earthcoach_result

La reponse finale generee depuis les propositions relues est rattachee au
resultat source : elle reste visible et copiable dans le dossier terrain au
lieu de ne vivre que dans la session de chat.

Revision ID: add_earthcoach_result_final_answer
Revises: add_earthcoach_result_edited_proposals
Create Date: 2026-09-27 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_result_final_answer'
down_revision = 'add_earthcoach_result_edited_proposals'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'final_answer' not in columns:
        op.add_column('earthcoach_result', sa.Column('final_answer', sa.Text(), nullable=True))


def downgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'final_answer' in columns:
        op.drop_column('earthcoach_result', 'final_answer')
