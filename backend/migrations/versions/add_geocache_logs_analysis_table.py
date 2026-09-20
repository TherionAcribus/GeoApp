"""Add geocache_logs_analysis table: l'analyse IA des logs, gardée entre deux ouvertures

Revision ID: add_geocache_logs_analysis_table
Revises: add_geocache_logs_total_available
Create Date: 2026-09-20 00:00:00.000000

L'analyse IA des logs ne vivait que dans le widget : changer de géocache la
perdait, et il fallait repayer un appel de modèle pour la revoir. Cette table en
garde le texte (Markdown) et, surtout, son **périmètre** — combien de logs ont
été soumis au modèle, combien la base en comptait, combien la cache en affiche
sur Geocaching.com. Sans ces compteurs, une analyse faite sur 25 logs sur 300 se
lit comme si elle les avait tous vus.

La contrainte d'unicité sur ``geocache_id`` est volontaire : relancer l'analyse
remplace la précédente au lieu d'en empiler une seconde.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_logs_analysis_table'
down_revision = 'add_geocache_logs_total_available'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'geocache_logs_analysis'):
        op.create_table(
            'geocache_logs_analysis',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('model_id', sa.String(length=200), nullable=True),
            sa.Column('analyzed_count', sa.Integer(), nullable=True),
            sa.Column('stored_count', sa.Integer(), nullable=True),
            sa.Column('total_available', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id']),
            sa.UniqueConstraint('geocache_id', name='unique_logs_analysis_per_geocache'),
        )
        op.create_index(
            'ix_geocache_logs_analysis_geocache_id', 'geocache_logs_analysis', ['geocache_id']
        )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'geocache_logs_analysis'):
        op.drop_index('ix_geocache_logs_analysis_geocache_id', table_name='geocache_logs_analysis')
        op.drop_table('geocache_logs_analysis')
