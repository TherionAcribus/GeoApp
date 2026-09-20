"""Add geocache_log_image table: les photos jointes aux logs

Revision ID: add_geocache_log_image_table
Revises: add_geocache_log_is_own_log
Create Date: 2026-09-20 00:00:00.000000

Le logbook de Geocaching.com accompagne chaque log d'un tableau ``Images`` que
le parseur ignorait : un quart des logs d'une cache fréquentée porte pourtant
une photo, et c'est souvent l'information la plus utile avant d'aller sur le
terrain (vue du site, état du conteneur, spoiler).

Table séparée de ``geocache_image`` à dessein : ces photos parlent d'une visite,
pas de la cache. Les verser dans la table existante noierait la galerie,
l'éditeur d'image et l'OCR sous des centaines de vignettes.

``stored`` distingue les deux états : le rafraîchissement n'enregistre que les
métadonnées (gratuit), les octets ne descendent sur disque que lorsque la
préférence ``geoApp.logs.downloadImages`` — ou un clic — le demande.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'add_geocache_log_image_table'
down_revision = 'add_geocache_log_is_own_log'
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if not _table_exists(inspector, 'geocache_log_image'):
        op.create_table(
            'geocache_log_image',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('geocache_log_id', sa.Integer(), nullable=False),
            sa.Column('geocache_id', sa.Integer(), nullable=False),
            sa.Column('external_id', sa.String(length=100), nullable=True),
            sa.Column('source_url', sa.String(length=2000), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('taken_at', sa.DateTime(), nullable=True),
            sa.Column('stored', sa.Boolean(), nullable=True),
            sa.Column('stored_path', sa.String(length=1000), nullable=True),
            sa.Column('mime_type', sa.String(length=100), nullable=True),
            sa.Column('byte_size', sa.Integer(), nullable=True),
            sa.Column('sha256', sa.String(length=64), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['geocache_log_id'], ['geocache_log.id']),
            sa.ForeignKeyConstraint(['geocache_id'], ['geocache.id']),
            sa.UniqueConstraint('geocache_log_id', 'external_id', name='unique_image_per_log'),
        )
        op.create_index(
            'ix_geocache_log_image_geocache_log_id', 'geocache_log_image', ['geocache_log_id']
        )
        op.create_index(
            'ix_geocache_log_image_geocache_id', 'geocache_log_image', ['geocache_id']
        )
        op.create_index(
            'ix_geocache_log_image_external_id', 'geocache_log_image', ['external_id']
        )


def downgrade():
    conn = op.get_bind()
    inspector = inspect(conn)

    if _table_exists(inspector, 'geocache_log_image'):
        op.drop_index('ix_geocache_log_image_external_id', table_name='geocache_log_image')
        op.drop_index('ix_geocache_log_image_geocache_id', table_name='geocache_log_image')
        op.drop_index('ix_geocache_log_image_geocache_log_id', table_name='geocache_log_image')
        op.drop_table('geocache_log_image')
