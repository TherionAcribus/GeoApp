import logging
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text

logger = logging.getLogger(__name__)

db = SQLAlchemy()

GEOCACHE_IMAGES_V2_BACKFILL_VERSION = '1'
GEOCACHE_IMAGES_V2_BACKFILL_KEY = 'system.geocache_images_v2_backfill_version'


def init_db(app):
    db.init_app(app)

    with app.app_context():
        from .models import Zone, AppConfig  # noqa
        from .geocaches.models import Geocache, GeocacheLog, Note, GeocacheNote, GeocacheImage, GeocacheWaypoint, SolvedGeocacheArchive  # noqa: F401
        from .plugins.models import Plugin  # noqa: F401

        logger.info('Creating database tables if not exist...')
        db.create_all()

        run_geocache_images_v2_backfill_once(AppConfig)

        try:
            logger.info('Running lightweight SQLite migrations for geocache columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('geocache')"))
            for row in res:
                existing_cols.add(row[1])

            to_add: dict[str, str] = {
                'coordinates_raw': 'TEXT',
                'is_corrected': 'BOOLEAN',
                'original_latitude': 'REAL',
                'original_longitude': 'REAL',
                'original_coordinates_raw': 'TEXT',
                'description_html': 'TEXT',
                'description_raw': 'TEXT',
                'description_override_html': 'TEXT',
                'description_override_raw': 'TEXT',
                'description_override_updated_at': 'DATETIME',
                'hints': 'TEXT',
                'hints_decoded': 'TEXT',
                'hints_decoded_override': 'TEXT',
                'hints_decoded_override_updated_at': 'DATETIME',
                'attributes': 'JSON',
                'favorites_count': 'INTEGER',
                'logs_count': 'INTEGER',
                'images': 'JSON',
                'found': 'BOOLEAN',
                'found_date': 'DATETIME',
                'solved': 'VARCHAR(20)',
                'gc_personal_note': 'TEXT',
                'gc_personal_note_synced_at': 'DATETIME',
                'gc_personal_note_last_pushed_at': 'DATETIME',
            }

            for col, col_type in to_add.items():
                if col not in existing_cols:
                    logger.info('Adding missing column geocache.%s (%s)', col, col_type)
                    db.session.execute(text(f'ALTER TABLE geocache ADD COLUMN {col} {col_type}'))
            db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error: %s', error)
            db.session.rollback()

        try:
            logger.info('Running lightweight SQLite migrations for geocache_waypoint columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('geocache_waypoint')"))
            for row in res:
                existing_cols.add(row[1])

            to_add: dict[str, str] = {
                'note_override': 'TEXT',
                'note_override_updated_at': 'DATETIME',
            }

            for col, col_type in to_add.items():
                if col not in existing_cols:
                    logger.info('Adding missing column geocache_waypoint.%s (%s)', col, col_type)
                    db.session.execute(text(f'ALTER TABLE geocache_waypoint ADD COLUMN {col} {col_type}'))
            db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (geocache_waypoint): %s', error)
            db.session.rollback()

        try:
            logger.info('Running lightweight SQLite migrations for solved_geocache_archive columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('solved_geocache_archive')"))
            for row in res:
                existing_cols.add(row[1])

            to_add: dict[str, str] = {
                'resolution_diagnostics': 'TEXT',
            }

            for col, col_type in to_add.items():
                if col not in existing_cols:
                    logger.info('Adding missing column solved_geocache_archive.%s (%s)', col, col_type)
                    db.session.execute(text(f'ALTER TABLE solved_geocache_archive ADD COLUMN {col} {col_type}'))
            db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (solved_geocache_archive): %s', error)
            db.session.rollback()

        try:
            default_zone = Zone.query.filter_by(name='default').first()
            if default_zone is None:
                default_zone = Zone(name='default', description='Default zone')
                db.session.add(default_zone)
                db.session.commit()
            else:
                logger.info('Default zone already exists')
        except Exception as error:
            logger.error('Error creating default zone: %s', error)
            db.session.rollback()


def run_geocache_images_v2_backfill_once(app_config_model) -> None:
    current_version = app_config_model.get_value(GEOCACHE_IMAGES_V2_BACKFILL_KEY)
    if current_version == GEOCACHE_IMAGES_V2_BACKFILL_VERSION:
        logger.info('Skipping geocache image v2 backfill (already completed)')
        return

    try:
        from .geocaches.image_sync import ensure_images_v2_for_all_geocaches

        created = ensure_images_v2_for_all_geocaches()
        app_config_model.set_value(GEOCACHE_IMAGES_V2_BACKFILL_KEY, GEOCACHE_IMAGES_V2_BACKFILL_VERSION)
        db.session.commit()
        logger.info('Geocache image v2 backfill completed (created=%s)', created)
    except Exception as error:
        logger.error('GeocacheImage backfill error: %s', error)
        db.session.rollback()
