"""Routes de gestion des plugins.

Listage, informations, decouverte, statut, activation et rechargement
des plugins.
"""

from flask import jsonify, request
from loguru import logger

from ...services.metasolver_analysis import invalidate_metasolver_caches

from ._common import (
    bp,
    get_plugin_manager,
)

# =============================================================================
# Routes de listage et informations
# =============================================================================

@bp.route('', methods=['GET'])
def list_plugins():
    """
    Liste tous les plugins disponibles avec filtres optionnels.
    
    Query Parameters:
        source (str, optional): Filtrer par source ('official', 'custom')
        category (str, optional): Filtrer par catégorie
        enabled (bool, optional): Filtrer par statut (true/false)
        include_metadata (bool, optional): Inclure metadata/input_schema/output_types (défaut: false)

    Returns:
        JSON: {
            "plugins": [liste des plugins],
            "total": nombre total,
            "filters": filtres appliqués
        }

    Example:
        GET /api/plugins
        GET /api/plugins?source=official
        GET /api/plugins?category=Substitution
        GET /api/plugins?enabled=true
        GET /api/plugins?enabled=true&include_metadata=true
    """
    try:
        manager = get_plugin_manager()

        # Récupérer les paramètres de filtre
        source = request.args.get('source')
        category = request.args.get('category')
        enabled_param = request.args.get('enabled')
        include_metadata_param = request.args.get('include_metadata')

        # Convertir enabled en booléen
        enabled_only = True  # Par défaut
        if enabled_param is not None:
            enabled_only = enabled_param.lower() in ['true', '1', 'yes']

        include_metadata = False
        if include_metadata_param is not None:
            include_metadata = include_metadata_param.lower() in ['true', '1', 'yes']

        # Lister les plugins avec filtres
        plugins = manager.list_plugins(
            source=source,
            category=category,
            enabled_only=enabled_only,
            include_metadata=include_metadata
        )

        logger.info(
            f"Liste plugins : {len(plugins)} résultats "
            f"(source={source}, category={category}, enabled={enabled_only}, "
            f"include_metadata={include_metadata})"
        )

        return jsonify({
            "plugins": plugins,
            "total": len(plugins),
            "filters": {
                "source": source,
                "category": category,
                "enabled": enabled_only,
                "include_metadata": include_metadata
            }
        }), 200
        
    except Exception as e:
        logger.opt(exception=e).error(f"Erreur lors du listage des plugins: {e}")
        return jsonify({
            "error": "Erreur lors du listage des plugins",
            "message": str(e)
        }), 500


@bp.route('/<plugin_name>', methods=['GET'])
def get_plugin_info(plugin_name: str):
    """
    Récupère les informations détaillées d'un plugin.
    
    Args:
        plugin_name (str): Nom du plugin
        
    Returns:
        JSON: Informations complètes du plugin incluant metadata
        
    Example:
        GET /api/plugins/caesar
    """
    try:
        manager = get_plugin_manager()
        
        plugin_info = manager.get_plugin_info(plugin_name)
        
        if not plugin_info:
            logger.warning(f"Plugin non trouvé: {plugin_name}")
            return jsonify({
                "error": "Plugin non trouvé",
                "plugin_name": plugin_name
            }), 404
        
        logger.info(f"Informations récupérées pour plugin: {plugin_name}")
        
        return jsonify(plugin_info), 200
        
    except Exception as e:
        logger.opt(exception=e).error(
            f"Erreur lors de la récupération du plugin {plugin_name}: {e}"
        )
        return jsonify({
            "error": "Erreur lors de la récupération des informations",
            "message": str(e)
        }), 500


# =============================================================================
# Routes de gestion
# =============================================================================

@bp.route('/discover', methods=['POST'])
def discover_plugins():
    """
    Redéclenche la découverte des plugins.
    
    Scanne les répertoires plugins/official/ et plugins/custom/
    pour découvrir les nouveaux plugins ou détecter les modifications.
    
    Returns:
        JSON: {
            "discovered": nombre de plugins découverts,
            "plugins": liste des plugins,
            "errors": erreurs éventuelles
        }
        
    Example:
        POST /api/plugins/discover
    """
    try:
        manager = get_plugin_manager()
        
        logger.info("Déclenchement de la découverte de plugins")
        
        # Lancer la découverte
        discovered = manager.discover_plugins()

        # Invalider les caches metasolver : les presets et candidats peuvent
        # avoir changé (nouveaux plugins, métadonnées modifiées).
        invalidate_metasolver_caches()

        # Récupérer les erreurs
        errors = manager.get_discovery_errors()
        
        logger.info(
            f"Découverte terminée: {len(discovered)} plugins, "
            f"{len(errors)} erreurs"
        )
        
        return jsonify({
            "discovered": len(discovered),
            "plugins": discovered,
            "errors": errors,
            "message": f"{len(discovered)} plugin(s) découvert(s)"
        }), 200
        
    except Exception as e:
        logger.opt(exception=e).error(f"Erreur lors de la découverte: {e}")
        return jsonify({
            "error": "Erreur lors de la découverte",
            "message": str(e)
        }), 500


@bp.route('/status', methods=['GET'])
def get_plugins_status():
    """
    Récupère le statut de tous les plugins (enabled, loaded, errors).
    
    Returns:
        JSON: {
            "plugins": {
                "plugin_name": {
                    "enabled": bool,
                    "loaded": bool,
                    "error": str or null,
                    ...
                }
            },
            "discovery_errors": {
                "chemin_du_dossier": "message d'erreur",
                ...
            }
        }
        
    Example:
        GET /api/plugins/status
    """
    try:
        manager = get_plugin_manager()
        
        status = manager.get_plugin_status()
        
        logger.info(f"Statut récupéré pour {len(status)} plugins")
        
        return jsonify({
            "plugins": status,
            "total": len(status),
            "loaded": sum(1 for p in status.values() if p['loaded']),
            "enabled": sum(1 for p in status.values() if p['enabled']),
            "discovery_errors": manager.get_orphan_discovery_errors()
        }), 200
        
    except Exception as e:
        logger.opt(exception=e).error(f"Erreur lors de la récupération du statut: {e}")
        return jsonify({
            "error": "Erreur lors de la récupération du statut",
            "message": str(e)
        }), 500


@bp.route('/<plugin_name>/enabled', methods=['PUT'])
def set_plugin_enabled(plugin_name: str):
    """
    Active ou désactive un plugin.

    Args:
        plugin_name (str): Nom du plugin

    Body:
        {"enabled": true|false}

    Returns:
        JSON: {"success": true, "plugin": {...}}

    Example:
        PUT /api/plugins/caesar/enabled
    """
    try:
        payload = request.get_json(force=True) or {}
    except Exception:
        return jsonify({
            "error": "Requête invalide",
            "message": "Le champ 'enabled' (booléen) est requis"
        }), 400

    if not isinstance(payload.get('enabled'), bool):
        return jsonify({
            "error": "Requête invalide",
            "message": "Le champ 'enabled' (booléen) est requis"
        }), 400

    try:
        manager = get_plugin_manager()

        plugin = manager.set_plugin_enabled(plugin_name, payload['enabled'])

        if plugin is None:
            return jsonify({
                "error": "Plugin non trouvé",
                "plugin_name": plugin_name
            }), 404

        # Les candidats metasolver sont filtrés sur enabled : invalider.
        invalidate_metasolver_caches()

        return jsonify({
            "success": True,
            "plugin": plugin
        }), 200

    except Exception as e:
        logger.opt(exception=e).error(
            f"Erreur lors du changement d'état du plugin {plugin_name}: {e}"
        )
        return jsonify({
            "error": "Erreur lors du changement d'état",
            "message": str(e)
        }), 500


@bp.route('/<plugin_name>/reload', methods=['POST'])
def reload_plugin(plugin_name: str):
    """
    Recharge un plugin (décharge puis recharge).
    
    Utile après modification du code du plugin.
    
    Args:
        plugin_name (str): Nom du plugin à recharger
        
    Returns:
        JSON: {
            "success": bool,
            "message": str
        }
        
    Example:
        POST /api/plugins/caesar/reload
    """
    try:
        manager = get_plugin_manager()

        if manager.get_plugin_info(plugin_name) is None:
            return jsonify({
                "error": "Plugin non trouvé",
                "plugin_name": plugin_name
            }), 404

        logger.info(f"Rechargement du plugin: {plugin_name}")

        success = manager.reload_plugin(plugin_name)

        if success:
            return jsonify({
                "success": True,
                "message": f"Plugin {plugin_name} rechargé avec succès"
            }), 200
        else:
            return jsonify({
                "success": False,
                "message": f"Échec du rechargement du plugin {plugin_name}",
                "error": manager.get_discovery_errors().get(plugin_name)
            }), 500
            
    except Exception as e:
        logger.opt(exception=e).error(
            f"Erreur lors du rechargement du plugin {plugin_name}: {e}"
        )
        return jsonify({
            "error": "Erreur lors du rechargement",
            "message": str(e)
        }), 500
