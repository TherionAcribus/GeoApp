"""Routes de gestion des plugins.

Listage, informations, interface HTML, decouverte, statut et rechargement
des plugins, ainsi que le generateur d'interface HTML.
"""

import html
from flask import jsonify, request, render_template_string
from loguru import logger
from typing import Dict, Any

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
        logger.error(f"Erreur lors du listage des plugins: {e}", exc_info=True)
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
        logger.error(
            f"Erreur lors de la récupération du plugin {plugin_name}: {e}",
            exc_info=True
        )
        return jsonify({
            "error": "Erreur lors de la récupération des informations",
            "message": str(e)
        }), 500


@bp.route('/<plugin_name>/interface', methods=['GET'])
def get_plugin_interface(plugin_name: str):
    """
    Génère l'interface HTML du formulaire pour un plugin.
    
    L'interface est générée dynamiquement à partir des input_types
    définis dans le plugin.json.
    
    Args:
        plugin_name (str): Nom du plugin
        
    Returns:
        HTML: Formulaire d'interface du plugin
        
    Example:
        GET /api/plugins/caesar/interface
    """
    try:
        manager = get_plugin_manager()
        
        plugin_info = manager.get_plugin_info(plugin_name)
        
        if not plugin_info:
            return jsonify({
                "error": "Plugin non trouvé",
                "plugin_name": plugin_name
            }), 404
        
        # Générer l'interface HTML
        html = _generate_plugin_interface_html(plugin_info)
        
        logger.info(f"Interface générée pour plugin: {plugin_name}")
        
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
        
    except Exception as e:
        logger.error(
            f"Erreur lors de la génération de l'interface pour {plugin_name}: {e}",
            exc_info=True
        )
        return jsonify({
            "error": "Erreur lors de la génération de l'interface",
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
        logger.error(f"Erreur lors de la découverte: {e}", exc_info=True)
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
            "enabled": sum(1 for p in status.values() if p['enabled'])
        }), 200
        
    except Exception as e:
        logger.error(f"Erreur lors de la récupération du statut: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur lors de la récupération du statut",
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
                "message": f"Échec du rechargement du plugin {plugin_name}"
            }), 500
            
    except Exception as e:
        logger.error(
            f"Erreur lors du rechargement du plugin {plugin_name}: {e}",
            exc_info=True
        )
        return jsonify({
            "error": "Erreur lors du rechargement",
            "message": str(e)
        }), 500


# =============================================================================
# Utilitaires de generation HTML
# =============================================================================

def _generate_plugin_interface_html(plugin_info: Dict[str, Any]) -> str:
    """
    Génère l'interface HTML d'un plugin à partir de ses métadonnées.
    
    Args:
        plugin_info (dict): Informations du plugin incluant metadata
        
    Returns:
        str: Code HTML du formulaire
    """
    metadata = plugin_info.get('metadata', {})
    input_types = metadata.get('input_types', {})
    
    # Template HTML de base
    template = '''
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ plugin_name }} - Interface</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .header {
            background-color: #252526;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        h1 {
            margin: 0 0 10px 0;
            color: #569cd6;
        }
        .description {
            color: #858585;
            margin: 10px 0;
        }
        .categories {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }
        .category-badge {
            background-color: #3e3e42;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            color: #cccccc;
        }
        .form-container {
            background-color: #252526;
            padding: 20px;
            border-radius: 8px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #cccccc;
            font-weight: 500;
        }
        input[type="text"],
        input[type="number"],
        textarea,
        select {
            width: 100%;
            padding: 10px;
            background-color: #3c3c3c;
            border: 1px solid #555555;
            border-radius: 4px;
            color: #d4d4d4;
            font-size: 14px;
            box-sizing: border-box;
        }
        input[type="text"]:focus,
        input[type="number"]:focus,
        textarea:focus,
        select:focus {
            outline: none;
            border-color: #007acc;
        }
        input[type="checkbox"] {
            width: 18px;
            height: 18px;
            margin-right: 8px;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
        }
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
        }
        .btn-primary {
            background-color: #007acc;
            color: white;
        }
        .btn-primary:hover {
            background-color: #005a9e;
        }
        .btn-secondary {
            background-color: #3e3e42;
            color: #cccccc;
        }
        .btn-secondary:hover {
            background-color: #505050;
        }
        .placeholder {
            color: #858585;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{{ plugin_name }}</h1>
            <div class="description">{{ description }}</div>
            <div class="description" style="font-size: 12px;">Version {{ version }} - {{ author }}</div>
            <div class="categories">
                {% for category in categories %}
                <span class="category-badge">{{ category }}</span>
                {% endfor %}
            </div>
        </div>
        
        <div class="form-container">
            <form id="plugin-form">
                {% for input_name, input_config in input_types.items() %}
                <div class="form-group">
                    <label for="{{ input_name }}">{{ input_config.label }}</label>
                    
                    {% if input_config.type == "string" or input_config.type == "textarea" %}
                        {% if input_config.type == "textarea" %}
                        <textarea 
                            id="{{ input_name }}" 
                            name="{{ input_name }}"
                            placeholder="{{ input_config.placeholder or '' }}"
                            rows="4">{{ input_config.default or '' }}</textarea>
                        {% else %}
                        <input 
                            type="text" 
                            id="{{ input_name }}" 
                            name="{{ input_name }}"
                            placeholder="{{ input_config.placeholder or '' }}"
                            value="{{ input_config.default or '' }}">
                        {% endif %}
                    
                    {% elif input_config.type == "number" or input_config.type == "float" %}
                        <input 
                            type="number" 
                            id="{{ input_name }}" 
                            name="{{ input_name }}"
                            value="{{ input_config.default or 0 }}"
                            min="{{ input_config.min or '' }}"
                            max="{{ input_config.max or '' }}"
                            step="{{ input_config.step or 'any' }}">
                    
                    {% elif input_config.type == "select" %}
                        <select id="{{ input_name }}" name="{{ input_name }}">
                            {% for option in input_config.options %}
                                {% if option is mapping %}
                                <option value="{{ option.value }}" {% if option.value == input_config.default %}selected{% endif %}>
                                    {{ option.label }}
                                </option>
                                {% else %}
                                <option value="{{ option }}" {% if option == input_config.default %}selected{% endif %}>
                                    {{ option }}
                                </option>
                                {% endif %}
                            {% endfor %}
                        </select>
                    
                    {% elif input_config.type == "checkbox" or input_config.type == "boolean" %}
                        <div class="checkbox-group">
                            <input 
                                type="checkbox" 
                                id="{{ input_name }}" 
                                name="{{ input_name }}"
                                {% if input_config.default %}checked{% endif %}>
                            <label for="{{ input_name }}" style="margin-bottom: 0;">
                                {{ input_config.description or input_config.label }}
                            </label>
                        </div>
                    {% endif %}
                </div>
                {% endfor %}
                
                <div class="button-group">
                    <button type="submit" class="btn-primary">Exécuter</button>
                    <button type="reset" class="btn-secondary">Réinitialiser</button>
                </div>
            </form>
        </div>
    </div>
    <script>
        // Pré-remplissage automatique des champs à partir des paramètres d'URL (ex: ?text=...)
        document.addEventListener('DOMContentLoaded', function() {
            const urlParams = new URLSearchParams(window.location.search);
            
            // Pour chaque champ du formulaire
            const form = document.getElementById('plugin-form');
            if (form) {
                Array.from(form.elements).forEach(element => {
                    if (element.name && urlParams.has(element.name)) {
                        const paramValue = urlParams.get(element.name);
                        
                        // Gestion spécifique selon le type
                        if (element.type === 'checkbox') {
                            element.checked = paramValue === 'true' || paramValue === '1' || paramValue === 'on';
                        } else {
                            element.value = paramValue;
                        }
                    }
                });
            }
        });
    </script>
</body>
</html>
    '''
    
    return render_template_string(
        template,
        plugin_name=plugin_info.get('name', 'Unknown'),
        version=plugin_info.get('version', '0.0.0'),
        description=plugin_info.get('description', ''),
        author=plugin_info.get('author', 'Unknown'),
        categories=plugin_info.get('categories', []),
        input_types=input_types
    )
