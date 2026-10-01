"""Add gps_visit table

Revision ID: add_gps_visit_table
Revises: add_trackable_tables
Create Date: 2026-10-01 00:00:00.000000

Visites lues dans le `geocache_visits.txt` des GPS Garmin : le GPS ne vide
jamais ce fichier, la table retient ce qui a déjà été traité.
Voir documentation/garmin-visites-spec.md.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_gps_visit_table'
down_revision = 'add_trackable_tables'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'gps_visit'):
        op.create_table(
            'gps_visit',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('raw_code', sa.String(length=40), nullable=False, server_default=''),
            sa.Column('gc_code', sa.String(length=20), nullable=True),
            sa.Column('visited_at', sa.DateTime(), nullable=False),
            sa.Column('status_raw', sa.String(length=60), nullable=False, server_default=''),
            sa.Column('occurrence', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('status', sa.String(length=30), nullable=False),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('state', sa.String(length=20), nullable=False, server_default='pending'),
            sa.Column('resolved_gc_code', sa.String(length=20), nullable=True),
            sa.Column('resolution_source', sa.String(length=20), nullable=True),
            sa.Column('log_reference_code', sa.String(length=64), nullable=True),
            sa.Column('nm_log_reference_code', sa.String(length=64), nullable=True),
            sa.Column('imported_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('raw_code', 'visited_at', 'status_raw', 'occurrence', name='unique_gps_visit'),
        )
        op.create_index('ix_gps_visit_gc_code', 'gps_visit', ['gc_code'])
        op.create_index('ix_gps_visit_visited_at', 'gps_visit', ['visited_at'])
        op.create_index('ix_gps_visit_state', 'gps_visit', ['state'])
        op.create_index('ix_gps_visit_resolved_gc_code', 'gps_visit', ['resolved_gc_code'])


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'gps_visit'):
        op.drop_index('ix_gps_visit_resolved_gc_code', table_name='gps_visit')
        op.drop_index('ix_gps_visit_state', table_name='gps_visit')
        op.drop_index('ix_gps_visit_visited_at', table_name='gps_visit')
        op.drop_index('ix_gps_visit_gc_code', table_name='gps_visit')
        op.drop_table('gps_visit')
