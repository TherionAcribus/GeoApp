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
        from .models import Zone, AppConfig, FriendActivity, FriendFind, OutingPlan  # noqa
        from .geocaches.models import (  # noqa: F401
            Geocache,
            GeocacheImage,
            GeocacheLog,
            GeocacheNote,
            GeocachePuzzleState,
            GeocacheWaypoint,
            Note,
            SolvedGeocacheArchive,
            UserObservation,
            UserObservationImage,
        )
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
                'description_override_source': 'VARCHAR(20)',
                'hints': 'TEXT',
                'hints_decoded': 'TEXT',
                'hints_decoded_override': 'TEXT',
                'hints_decoded_override_updated_at': 'DATETIME',
                'hints_decoded_override_source': 'VARCHAR(20)',
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
                'note_override_source': 'VARCHAR(20)',
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
            logger.info('Running lightweight SQLite migrations for geocache_image columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('geocache_image')"))
            for row in res:
                existing_cols.add(row[1])

            to_add: dict[str, str] = {
                'editor_state_json': 'TEXT',
                'image_type': 'VARCHAR(20)',
            }

            for col, col_type in to_add.items():
                if col not in existing_cols:
                    logger.info('Adding missing column geocache_image.%s (%s)', col, col_type)
                    db.session.execute(text(f'ALTER TABLE geocache_image ADD COLUMN {col} {col_type}'))
            db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (geocache_image): %s', error)
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
            logger.info('Running lightweight SQLite migrations for geocache_log columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('geocache_log')"))
            for row in res:
                existing_cols.add(row[1])

            to_add: dict[str, str] = {
                'is_friend_log': 'BOOLEAN',
            }

            for col, col_type in to_add.items():
                if col not in existing_cols:
                    logger.info('Adding missing column geocache_log.%s (%s)', col, col_type)
                    db.session.execute(text(f'ALTER TABLE geocache_log ADD COLUMN {col} {col_type}'))
            db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (geocache_log): %s', error)
            db.session.rollback()

        try:
            logger.info('Running lightweight SQLite migrations for friend_activity columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('friend_activity')"))
            for row in res:
                existing_cols.add(row[1])

            # Ne rien faire si la table n'existe pas encore : create_all() vient
            # de la créer avec le schéma complet.
            if existing_cols:
                to_add: dict[str, str] = {
                    'is_self': 'BOOLEAN',
                }

                for col, col_type in to_add.items():
                    if col not in existing_cols:
                        logger.info('Adding missing column friend_activity.%s (%s)', col, col_type)
                        db.session.execute(text(f'ALTER TABLE friend_activity ADD COLUMN {col} {col_type}'))
                db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (friend_activity): %s', error)
            db.session.rollback()

        try:
            logger.info('Running lightweight SQLite migrations for friend_find columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('friend_find')"))
            for row in res:
                existing_cols.add(row[1])

            if existing_cols:
                to_add: dict[str, str] = {
                    'latitude': 'FLOAT',
                    'longitude': 'FLOAT',
                    'cache_name': 'VARCHAR(255)',
                    'cache_type': 'VARCHAR(100)',
                }

                for col, col_type in to_add.items():
                    if col not in existing_cols:
                        logger.info('Adding missing column friend_find.%s (%s)', col, col_type)
                        db.session.execute(text(f'ALTER TABLE friend_find ADD COLUMN {col} {col_type}'))
                db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (friend_find): %s', error)
            db.session.rollback()

        try:
            logger.info('Running lightweight SQLite migrations for zone columns...')
            existing_cols = set()
            res = db.session.execute(text("PRAGMA table_info('zone')"))
            for row in res:
                existing_cols.add(row[1])

            if existing_cols and 'is_hidden' not in existing_cols:
                logger.info('Adding missing column zone.is_hidden (BOOLEAN)')
                db.session.execute(text('ALTER TABLE zone ADD COLUMN is_hidden BOOLEAN'))
                # Les zones existantes sont toutes visibles : sans ce défaut,
                # `is_hidden IS NULL` ferait échouer les filtres booléens stricts.
                db.session.execute(text('UPDATE zone SET is_hidden = 0 WHERE is_hidden IS NULL'))
                db.session.commit()
        except Exception as error:
            logger.error('SQLite migration error (zone): %s', error)
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

        try:
            # La zone technique « Amis » est créée au démarrage, comme la zone
            # « default » : masquée, elle ne coûte rien, et l'utilisateur qui
            # active la préférence « Zone « Amis » visible » doit la voir
            # apparaître — même vide, et même s'il n'a jamais lancé d'import.
            from .services.geocaching_friend_finds import get_or_create_friends_zone
            get_or_create_friends_zone()
        except Exception as error:
            logger.error('Error creating the friends zone: %s', error)
            db.session.rollback()

        # Index de recherche plein-texte (FTS5) : création, amorçage et
        # enregistrement des événements ORM de synchronisation.
        from .search_index import ensure_search_index
        ensure_search_index(db)


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
