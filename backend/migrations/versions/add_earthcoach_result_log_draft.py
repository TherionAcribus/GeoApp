"""Add log draft column to earthcoach_result

Le dossier terrain prepare le log public depuis une resolution : le texte est
conserve avec le resultat pour etre relu, verifie (aucune reponse devoilee) et
rouvert dans l'editeur de log.

Revision ID: add_earthcoach_result_log_draft
Revises: add_earthcoach_result_is_reference
Create Date: 2026-11-22 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_result_log_draft'
down_revision = 'add_earthcoach_result_is_reference'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'log_draft' not in columns:
        op.add_column('earthcoach_result', sa.Column('log_draft', sa.Text(), nullable=True))


def downgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'log_draft' in columns:
        op.drop_column('earthcoach_result', 'log_draft')
