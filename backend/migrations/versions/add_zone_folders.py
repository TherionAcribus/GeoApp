"""Add zone folders: zone.is_folder and zone_folder_member

Revision ID: add_zone_folders
Revises: add_gps_visit_remote_check
Create Date: 2026-10-05 00:00:00.000000

Un dossier est une zone marquée `is_folder`, qui ne porte aucune géocache en
propre et montre celles de ses zones membres. Voir documentation/zones-technique.md.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_zone_folders'
down_revision = 'add_gps_visit_remote_check'
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    tables = inspector.get_table_names()

    if 'zone' in tables and 'is_folder' not in {column['name'] for column in inspector.get_columns('zone')}:
        op.add_column('zone', sa.Column('is_folder', sa.Boolean(), nullable=True))
        op.execute('UPDATE zone SET is_folder = 0 WHERE is_folder IS NULL')
        op.create_index('ix_zone_is_folder', 'zone', ['is_folder'])

    if 'zone_folder_member' not in tables:
        op.create_table(
            'zone_folder_member',
            sa.Column('folder_id', sa.Integer(), sa.ForeignKey('zone.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('zone_id', sa.Integer(), sa.ForeignKey('zone.id', ondelete='CASCADE'), primary_key=True),
        )
        op.create_index('ix_zone_folder_member_zone_id', 'zone_folder_member', ['zone_id'])


def downgrade():
    inspector = inspect(op.get_bind())
    tables = inspector.get_table_names()

    if 'zone_folder_member' in tables:
        op.drop_index('ix_zone_folder_member_zone_id', table_name='zone_folder_member')
        op.drop_table('zone_folder_member')
    if 'zone' in tables and 'is_folder' in {column['name'] for column in inspector.get_columns('zone')}:
        op.drop_index('ix_zone_is_folder', table_name='zone')
        op.drop_column('zone', 'is_folder')
