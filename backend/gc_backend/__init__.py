import os

# Neutralise SSLKEYLOGFILE injectée par certains logiciels de monitoring réseau
# (antivirus/panels) : urllib3 tenterait d'ouvrir ce pseudo-fichier via OpenSSL,
# ce qui tue le process sur ce build Python (pas d'OPENSSL_Applink). Évite aussi
# de divulguer les clés TLS des sessions geocaching.com à un logiciel tiers.
os.environ.pop('SSLKEYLOGFILE', None)

import sys
import time

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate
from loguru import logger
from werkzeug.exceptions import HTTPException

from .config import Config
from .database import init_db
from .logging_config import configure_logging
from .utils.preferences import get_value_or_default


configure_logging()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    is_testing = os.environ.get('TESTING') == '1'
    if is_testing:
        # Tests need an isolated database before init_db() binds SQLAlchemy.
        app.config['TESTING'] = True
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    CORS(
        app,
        supports_credentials=True,
        expose_headers=['Content-Disposition'],
        # Pas de "*" : avec supports_credentials=True, un wildcard laisserait
        # n'importe quel site du navigateur de l'utilisateur appeler ce
        # backend local avec ses cookies de session. Seul le frontend Theia
        # (servi sur ce port en dev) a besoin d'accéder à l'API.
        resources={r"/*": {"origins": ["http://127.0.0.1:3000", "http://localhost:3000"]}},
    )

    @app.before_request
    def log_api_request_start():
        g.request_started_at = time.perf_counter()
        if request.path.startswith('/api'):
            query_string = request.query_string.decode('utf-8', errors='replace')
            path = f"{request.path}?{query_string}" if query_string else request.path
            logger.info(
                "HTTP -> {} {} from {}",
                request.method,
                path,
                request.headers.get('X-Forwarded-For', request.remote_addr),
            )

    @app.after_request
    def log_api_request_end(response):
        if request.path.startswith('/api'):
            started_at = getattr(g, 'request_started_at', None)
            duration_ms = (time.perf_counter() - started_at) * 1000 if started_at else 0
            logger.info(
                "HTTP <- {} {} {} {:.1f}ms",
                request.method,
                request.path,
                response.status_code,
                duration_ms,
            )
        return response

    init_db(app)

    with app.app_context():
        auto_discover_plugins = bool(get_value_or_default('geoApp.plugins.autoDiscoverOnStart', True))
        task_auto_start = bool(get_value_or_default('geoApp.tasks.autoStartBackground', True))
        task_max_workers = int(get_value_or_default('geoApp.tasks.maxWorkers', 4))

    from .database import db
    Migrate(app, db)

    from .blueprints.zones import bp as zones_bp
    from .blueprints.geocaches import bp as geocaches_bp
    from .blueprints.plugins import bp as plugins_bp, init_plugin_manager
    from .blueprints.tasks import bp as tasks_bp, init_task_manager
    from .blueprints.coordinates import coordinates_bp
    from .blueprints.formula_solver import bp as formula_solver_bp
    from .blueprints.alphabets import alphabets_bp
    from .blueprints.preferences import bp as preferences_bp
    from .blueprints.logs import bp as logs_bp
    from .blueprints.notes import bp as notes_bp
    from .blueprints.observations import bp as observations_bp
    from .blueprints.logging_tasks import bp as logging_tasks_bp
    from .blueprints.earthcoach_context import bp as earthcoach_context_bp
    from .blueprints.earthcoach_geology import bp as earthcoach_geology_bp
    from .blueprints.earthcoach_geology_fr import bp as earthcoach_geology_fr_bp
    from .blueprints.earthcoach_elevation import bp as earthcoach_elevation_bp
    from .blueprints.checkers import bp as checkers_bp
    from .blueprints.geocache_images import bp as geocache_images_bp
    from .blueprints.auth import bp as auth_bp
    from .blueprints.friends import bp as friends_bp
    from .blueprints.search import bp as search_bp
    from .blueprints.archive import bp as archive_bp
    from .blueprints.server_logs import bp as server_logs_bp
    from .blueprints.puzzle_states import bp as puzzle_states_bp
    from .blueprints.outing_plans import bp as outing_plans_bp

    app.register_blueprint(zones_bp)
    app.register_blueprint(geocaches_bp)
    app.register_blueprint(plugins_bp)
    app.register_blueprint(tasks_bp)
    app.register_blueprint(coordinates_bp)
    app.register_blueprint(formula_solver_bp)
    app.register_blueprint(alphabets_bp)
    app.register_blueprint(preferences_bp)
    app.register_blueprint(logs_bp)
    app.register_blueprint(notes_bp)
    app.register_blueprint(observations_bp)
    app.register_blueprint(logging_tasks_bp)
    app.register_blueprint(earthcoach_context_bp)
    app.register_blueprint(earthcoach_geology_bp)
    app.register_blueprint(earthcoach_geology_fr_bp)
    app.register_blueprint(earthcoach_elevation_bp)
    app.register_blueprint(checkers_bp)
    app.register_blueprint(geocache_images_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(friends_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(archive_bp)
    app.register_blueprint(server_logs_bp)
    app.register_blueprint(puzzle_states_bp)
    app.register_blueprint(outing_plans_bp)

    from .plugins import PluginManager

    plugins_dir = app.config.get('PLUGINS_DIR') or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        'plugins',
    )
    plugin_manager = PluginManager(plugins_dir, app)

    is_migration = 'flask' in sys.argv[0] and 'db' in sys.argv

    if auto_discover_plugins and not is_migration and not is_testing:
        with app.app_context():
            plugin_manager.discover_plugins()
    else:
        logger.info(
            "Decouverte des plugins ignoree (auto_discover={}, migration={}, tests={})",
            auto_discover_plugins,
            is_migration,
            is_testing,
        )

    init_plugin_manager(plugin_manager)

    if not plugin_manager.lazy_mode:
        plugin_manager.preload_enabled_plugins()

    app.plugin_manager = plugin_manager

    from .services import TaskManager

    task_manager = TaskManager(max_workers=task_max_workers, auto_start=task_auto_start)

    init_task_manager(task_manager, plugin_manager)

    app.task_manager = task_manager

    # Synchronisation automatique du flux d'activité des amis en arrière-plan.
    # Le flux distant est plafonné (~100 entrées, fenêtre ~60 j) : sans synchro
    # régulière, les entrées qui sortent de la fenêtre sont perdues. Le scheduler
    # ne tourne pas pendant les tests ni les migrations.
    if not is_testing and not is_migration:
        from .services.friend_activity_scheduler import start_scheduler
        start_scheduler(app)

    @app.errorhandler(Exception)
    def handle_global_error(error):
        if isinstance(error, HTTPException):
            return error

        logger.opt(exception=error).error(
            "Unhandled error while handling {} {}",
            request.method,
            request.path,
        )
        return jsonify({"error": "Erreur interne du serveur"}), 500

    return app
