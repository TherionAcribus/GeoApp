"""Add is_own_log flag on geocache logs

Revision ID: add_geocache_log_is_own_log
Revises: add_geocache_logs_analysis_table
Create Date: 2026-09-20 00:00:00.000000

Marque les logs écrits avec le compte Geocaching.com connecté. Le drapeau est
renseigné au rafraîchissement des logs via `seek/geocache.logbook?...&sp=true`
— pendant de `sf=true` qui filtre sur la liste d'amis — et posé directement à
la soumission d'un log.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_log_is_own_log'
down_revision = 'add_geocache_logs_analysis_table'
branch_labels = None
depends_on = None


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return column_name in {column['name'] for column in inspector.get_columns(table_name)}


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _column_exists(inspector, 'geocache_log', 'is_own_log'):
        op.add_column(
            'geocache_log',
            sa.Column('is_own_log', sa.Boolean(), nullable=True, server_default=sa.false()),
        )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _column_exists(inspector, 'geocache_log', 'is_own_log'):
        op.drop_column('geocache_log', 'is_own_log')
