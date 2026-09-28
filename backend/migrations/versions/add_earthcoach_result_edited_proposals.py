"""Add user-edited proposals column to earthcoach_result

Les corrections relues par l'utilisateur vivent dans `edited_proposals` :
une recapture IA du meme request_id met a jour `proposals` (version modele)
sans pouvoir ecraser le travail humain.

Revision ID: add_earthcoach_result_edited_proposals
Revises: add_earthcoach_workspace_tables
Create Date: 2026-09-26 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_earthcoach_result_edited_proposals'
down_revision = 'add_earthcoach_workspace_tables'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'edited_proposals' not in columns:
        op.add_column('earthcoach_result', sa.Column('edited_proposals', sa.JSON(), nullable=True))


def downgrade():
    inspector = inspect(op.get_bind())
    if 'earthcoach_result' not in inspector.get_table_names():
        return
    columns = {column['name'] for column in inspector.get_columns('earthcoach_result')}
    if 'edited_proposals' in columns:
        op.drop_column('earthcoach_result', 'edited_proposals')
