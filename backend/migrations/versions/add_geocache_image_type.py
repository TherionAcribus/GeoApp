"""Add image_type field to geocache_image

Revision ID: add_geocache_image_type
Revises: add_archive_resolution_diagnostics
Create Date: 2025-05-19 00:00:00.000000

Ajoute un champ image_type pour distinguer les images du listing ('listing'),
les images propriétaire hors spoiler ('owner') et les spoilers ('spoiler').
Migration idempotente.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_geocache_image_type'
down_revision = 'add_archive_resolution_diagnostics'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)

    if 'geocache_image' not in inspector.get_table_names():
        return

    columns = [col['name'] for col in inspector.get_columns('geocache_image')]

    if 'image_type' not in columns:
        op.add_column('geocache_image', sa.Column('image_type', sa.String(20), nullable=True))
        op.execute("UPDATE geocache_image SET image_type = 'listing' WHERE image_type IS NULL")


def downgrade():
    from sqlalchemy import inspect

    conn = op.get_bind()
    inspector = inspect(conn)

    if 'geocache_image' not in inspector.get_table_names():
        return

    columns = [col['name'] for col in inspector.get_columns('geocache_image')]

    if 'image_type' in columns:
        op.drop_column('geocache_image', 'image_type')
