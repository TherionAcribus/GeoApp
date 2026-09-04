"""Add outing_plan table: the outing analysis report, kept outside the chat

Revision ID: add_outing_plan_table
Revises: add_friend_zone_scan_table
Create Date: 2026-09-04 00:00:00.000000

Le rapport de préparation de sortie ne vivait que dans la conversation : il disparaissait
avec elle, et aucune autre vue de GeoApp ne pouvait le lire. Cette table en garde la
partie structurée (checklist, alertes, drapeaux par cache) et le texte complet, ce qui
permet le panneau cochable, les badges des tables et l'export Markdown.

La clé unique ``(zone_name, outing_date)`` reprend celle du titre de session du chat :
relancer l'analyse d'une sortie remplace son plan au lieu d'en empiler un second.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_outing_plan_table'
down_revision = 'add_friend_zone_scan_table'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'outing_plan'):
        op.create_table(
            'outing_plan',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('zone_name', sa.String(length=150), nullable=False, server_default=''),
            sa.Column('outing_date', sa.String(length=10), nullable=False),
            sa.Column('gc_codes', sa.Text(), nullable=True),
            sa.Column('payload', sa.Text(), nullable=False),
            sa.Column('markdown', sa.Text(), nullable=True),
            sa.Column('checked', sa.Text(), nullable=True),
            sa.Column('source', sa.String(length=20), nullable=True),
            sa.Column('model_name', sa.String(length=120), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('zone_name', 'outing_date', name='unique_plan_per_zone_date'),
        )
        op.create_index('ix_outing_plan_outing_date', 'outing_plan', ['outing_date'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'outing_plan'):
        op.drop_index('ix_outing_plan_outing_date', table_name='outing_plan')
        op.drop_table('outing_plan')
