"""Add owner_guid on geocaches

Revision ID: add_geocache_owner_guid
Revises: add_geocache_log_image_table
Create Date: 2026-09-21 00:00:00.000000

GUID Geocaching du propriétaire de la cache. Le pseudo suffit pour l'URL de
profil publique (`/p/?u=`), mais le centre de messages n'accepte que le GUID
(`/account/messagecenter?recipientId=`). Il est lu sur le listing au scrape.

NULL sur les géocaches importées avant cette colonne : le rattrapage se fait à
la demande (endpoint `/api/geocaches/<id>/owner-link`) plutôt que par un
re-scrape massif.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_owner_guid'
down_revision = 'add_geocache_log_image_table'
branch_labels = None
depends_on = None


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return column_name in {column['name'] for column in inspector.get_columns(table_name)}


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _column_exists(inspector, 'geocache', 'owner_guid'):
        op.add_column('geocache', sa.Column('owner_guid', sa.String(length=36), nullable=True))


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _column_exists(inspector, 'geocache', 'owner_guid'):
        op.drop_column('geocache', 'owner_guid')
