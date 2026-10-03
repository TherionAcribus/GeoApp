"""Add gps_visit.remote_found_on and remote_checked_at

Revision ID: add_gps_visit_remote_check
Revises: add_gps_device_tables
Create Date: 2026-10-03 00:00:00.000000

« Vérifier sur Geocaching.com » : ma date de trouvaille lue sur la fiche de la cache,
gardée sur les visites. Voir documentation/garmin-visites-ameliorations-spec.md (lot 5).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_gps_visit_remote_check'
down_revision = 'add_gps_device_tables'
branch_labels = None
depends_on = None

_COLUMNS = (
    ('remote_found_on', sa.Date()),
    ('remote_checked_at', sa.DateTime()),
)


def upgrade():
    inspector = inspect(op.get_bind())
    if 'gps_visit' not in inspector.get_table_names():
        return
    existing = {column['name'] for column in inspector.get_columns('gps_visit')}
    for name, column_type in _COLUMNS:
        if name not in existing:
            op.add_column('gps_visit', sa.Column(name, column_type, nullable=True))


def downgrade():
    inspector = inspect(op.get_bind())
    if 'gps_visit' not in inspector.get_table_names():
        return
    existing = {column['name'] for column in inspector.get_columns('gps_visit')}
    for name, _ in reversed(_COLUMNS):
        if name in existing:
            op.drop_column('gps_visit', name)
