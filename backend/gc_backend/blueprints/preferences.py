"""
Blueprint REST pour la gestion centralisée des préférences GeoApp.

Expose :
- GET /api/preferences
- GET /api/preferences/<key>
- PUT /api/preferences/<key>
- DELETE /api/preferences/<key>
- PATCH /api/preferences
- GET /api/preferences/schema
"""

from flask import Blueprint, jsonify, request
from loguru import logger

from ..models import AppConfig
from ..utils.preferences import (
    list_preferences,
    list_sensitive_keys,
    list_stored_keys,
    get_preference_value,
    set_preference_value,
    set_preferences_bulk,
    reset_preference_value,
    is_sensitive,
    get_preference_definition,
    load_preference_schema,
)

bp = Blueprint('preferences', __name__, url_prefix='/api/preferences')


@bp.get('')
def get_preferences():
    include_schema = request.args.get('includeSchema', 'false').lower() in ('1', 'true', 'yes')
    preferences = list_preferences()
    sensitive_keys = list_sensitive_keys()
    # Les secrets ne quittent jamais le backend : la valeur est masquée, le client
    # se contente de savoir que la clé est sensible et si elle est définie.
    for key in sensitive_keys:
        if key in preferences:
            preferences[key] = None
    response = {
        'preferences': preferences,
        'storedKeys': list_stored_keys(),
        'sensitiveKeys': sensitive_keys,
        'version': load_preference_schema().get('version')
    }
    if include_schema:
        response['schema'] = load_preference_schema()
    return jsonify(response)


@bp.get('/schema')
def get_preferences_schema():
    return jsonify(load_preference_schema())


@bp.get('/<path:key>')
def get_preference(key: str):
    try:
        value = get_preference_value(key)
        definition = get_preference_definition(key)
        sensitive = bool(definition and definition.get('x-sensitive'))
        return jsonify({
            'key': key,
            'value': None if sensitive else value,
            'sensitive': sensitive,
            'defined': (AppConfig.get_value(key) is not None) if sensitive else None,
            'definition': definition
        })
    except KeyError:
        return jsonify({'error': 'Préférence inconnue', 'key': key}), 404


@bp.put('/<path:key>')
def update_preference(key: str):
    try:
        payload = request.get_json(force=True) or {}
    except Exception as error:  # pragma: no cover
        logger.error('JSON invalide pour /api/preferences/{}: {}', key, error)
        return jsonify({'error': 'JSON invalide', 'message': str(error)}), 400

    if 'value' not in payload:
        return jsonify({'error': "Le champ 'value' est requis"}), 400

    try:
        value = set_preference_value(key, payload['value'])
        if is_sensitive(key):
            logger.info('Préférence {} mise à jour -> <masquée>', key)
        else:
            logger.info('Préférence {} mise à jour -> {}', key, value)
        return jsonify({'key': key, 'value': value})
    except KeyError:
        return jsonify({'error': 'Préférence inconnue', 'key': key}), 404
    except ValueError as error:
        return jsonify({'error': 'Valeur invalide', 'message': str(error)}), 400


@bp.delete('/<path:key>')
def delete_preference(key: str):
    try:
        removed = reset_preference_value(key)
    except KeyError:
        return jsonify({'error': 'Préférence inconnue', 'key': key}), 404
    logger.info('Préférence {} réinitialisée{}', key, '' if removed else ' (aucune valeur stockée)')
    return jsonify({'key': key, 'removed': removed})


@bp.patch('')
def update_preferences_bulk():
    try:
        payload = request.get_json(force=True) or {}
    except Exception as error:  # pragma: no cover
        logger.error('JSON invalide pour PATCH /api/preferences: {}', error)
        return jsonify({'error': 'JSON invalide', 'message': str(error)}), 400

    if 'values' not in payload or not isinstance(payload['values'], dict):
        return jsonify({'error': "Le champ 'values' doit être un objet"}), 400

    try:
        updated = set_preferences_bulk(payload['values'])
        logger.info('Préférences mises à jour en bulk: {}', ', '.join(updated.keys()))
        return jsonify({'updated': updated})
    except KeyError as error:
        return jsonify({'error': 'Préférence inconnue', 'message': str(error)}), 404
    except ValueError as error:
        return jsonify({'error': 'Valeur invalide', 'message': str(error)}), 400

