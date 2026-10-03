"""Add gps_visit position columns, gps_track_day and gps_device_cache

Revision ID: add_gps_device_tables
Revises: add_gps_zone_operation_tables
Create Date: 2026-10-03 00:00:00.000000

Lecture complète du GPS : fuseau et secondes des visites (geocache_logs.xml),
position sur la trace, tracé simplifié de chaque jour, index des caches des GPX
du GPS. Voir documentation/garmin-visites-ameliorations-spec.md (lot 2).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_gps_device_tables'
down_revision = 'add_gps_zone_operation_tables'
branch_labels = None
depends_on = None

_VISIT_COLUMNS = (
    ('utc_offset_minutes', sa.Integer()),
    ('seconds', sa.Integer()),
    ('latitude', sa.Float()),
    ('longitude', sa.Float()),
    ('position_source', sa.String(length=20)),
)


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()

    if 'gps_visit' in tables:
        existing = {column['name'] for column in inspector.get_columns('gps_visit')}
        for name, column_type in _VISIT_COLUMNS:
            if name not in existing:
                op.add_column('gps_visit', sa.Column(name, column_type, nullable=True))

    if 'gps_track_day' not in tables:
        op.create_table(
            'gps_track_day',
            sa.Column('day', sa.String(length=10), primary_key=True),
            sa.Column('points', sa.Text(), nullable=False),
            sa.Column('distance_m', sa.Float(), nullable=True),
            sa.Column('started_at', sa.DateTime(), nullable=True),
            sa.Column('ended_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )

    if 'gps_device_cache' not in tables:
        op.create_table(
            'gps_device_cache',
            sa.Column('gc_code', sa.String(length=20), primary_key=True),
            sa.Column('name', sa.String(length=255), nullable=True),
            sa.Column('cache_type', sa.String(length=100), nullable=True),
            sa.Column('latitude', sa.Float(), nullable=True),
            sa.Column('longitude', sa.Float(), nullable=True),
            sa.Column('gpx_file', sa.String(length=500), nullable=False),
            sa.Column('gpx_mtime', sa.Float(), nullable=True),
        )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()

    if 'gps_device_cache' in tables:
        op.drop_table('gps_device_cache')
    if 'gps_track_day' in tables:
        op.drop_table('gps_track_day')
    if 'gps_visit' in tables:
        existing = {column['name'] for column in inspector.get_columns('gps_visit')}
        with op.batch_alter_table('gps_visit') as batch:
            for name, _ in reversed(_VISIT_COLUMNS):
                if name in existing:
                    batch.drop_column(name)
