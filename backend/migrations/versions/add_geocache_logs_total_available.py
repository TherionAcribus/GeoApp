"""Add logs_total_available on geocaches

Revision ID: add_geocache_logs_total_available
Revises: add_outing_plan_table
Create Date: 2026-09-20 00:00:00.000000

Nombre de logs que la géocache possède sur Geocaching.com, distinct de
`logs_count` que le rafraîchissement écrase avec le nombre de logs stockés en
local. C'est l'écart entre les deux qui permet de proposer « il en reste, on
charge la suite ? » sans re-scraper d'abord.

Renseigné soit par `pageInfo.totalRows` du logbook, soit par le compteur lu sur
la page de la cache. NULL = inconnu.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_logs_total_available'
down_revision = 'add_outing_plan_table'
branch_labels = None
depends_on = None


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return column_name in {column['name'] for column in inspector.get_columns(table_name)}


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _column_exists(inspector, 'geocache', 'logs_total_available'):
        op.add_column('geocache', sa.Column('logs_total_available', sa.Integer(), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _column_exists(inspector, 'geocache', 'logs_total_available'):
        op.drop_column('geocache', 'logs_total_available')
