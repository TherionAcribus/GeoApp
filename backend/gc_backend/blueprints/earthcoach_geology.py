"""Proxy EarthCoach vers Macrostrat pour le contexte geologique par point.

Macrostrat (https://macrostrat.org) expose une API JSON publique, sans cle, qui
renvoie les unites geologiques cartographiees a une coordonnee donnee. On la
proxifie cote backend pour : eviter toute dependance au CORS, normaliser la
reponse et mettre en cache les appels repetes pendant une session.
"""

from __future__ import annotations

import logging

import requests
from flask import Blueprint, jsonify, request

from .earthcoach_geo_common import TTLCache, parse_coord

bp = Blueprint('earthcoach_geology', __name__)
logger = logging.getLogger(__name__)

MACROSTRAT_URL = 'https://macrostrat.org/api/v2/geologic_units/map'
ATTRIBUTION = 'Donnees geologiques: Macrostrat (macrostrat.org, CC-BY 4.0)'
REQUEST_TIMEOUT = 15
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_MAX_ENTRIES = 500
_USER_AGENT = 'GeoApp-EarthCoach/1.0 (geological context lookup)'

# Cache memoire: cle = "lat,lon" arrondis.
_cache = TTLCache(CACHE_TTL_SECONDS, CACHE_MAX_ENTRIES)


def _first(unit: dict, *keys: str) -> object:
    for key in keys:
        value = unit.get(key)
        if value not in (None, '', []):
            return value
    return None


def _age_text(unit: dict) -> str | None:
    explicit = _first(unit, 'age')
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    bottom = _first(unit, 'b_int_name', 'b_interval_name')
    top = _first(unit, 't_int_name', 't_interval_name')
    if bottom and top and bottom != top:
        return f'{bottom} - {top}'
    return str(bottom or top) if (bottom or top) else None


def _normalize_unit(unit: dict) -> dict:
    return {
        'name': _first(unit, 'name', 'map_unit_name', 'strat_name', 'unit_name'),
        'strat_name': _first(unit, 'strat_name'),
        'lithology': _first(unit, 'lith', 'lithology'),
        'description': _first(unit, 'descrip', 'description'),
        'comments': _first(unit, 'comments'),
        'age_text': _age_text(unit),
        'b_age': _first(unit, 'b_int_age', 'best_age_bottom', 'b_age'),
        't_age': _first(unit, 't_int_age', 'best_age_top', 't_age'),
        'scale': _first(unit, 'scale'),
        'source': _first(unit, 'source_id', 'source'),
        'color': _first(unit, 'color'),
    }


def _has_content(unit: dict) -> bool:
    return any(unit.get(key) for key in ('name', 'lithology', 'description', 'strat_name', 'age_text'))


def _fetch_macrostrat(lat: float, lon: float) -> list[dict]:
    response = requests.get(
        MACROSTRAT_URL,
        params={'lat': lat, 'lng': lon},
        headers={'User-Agent': _USER_AGENT, 'Accept': 'application/json'},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    raw_units = (payload.get('success') or {}).get('data')
    if not isinstance(raw_units, list):
        raw_units = payload.get('data') if isinstance(payload.get('data'), list) else []
    units = [_normalize_unit(unit) for unit in raw_units if isinstance(unit, dict)]
    return [unit for unit in units if _has_content(unit)]


@bp.get('/api/earthcoach/geology')
def geology_at_point():
    try:
        lat = parse_coord(request.args.get('lat'), 'lat', -90, 90)
        lon = parse_coord(request.args.get('lon') or request.args.get('lng'), 'lon', -180, 180)
    except ValueError as error:
        return jsonify({'error': str(error)}), 400

    cache_key = f'{round(lat, 4)},{round(lon, 4)}'
    cached = _cache.get(cache_key)
    if cached:
        return jsonify({**cached, 'from_cache': True})

    try:
        units = _fetch_macrostrat(lat, lon)
    except requests.RequestException as error:
        logger.warning('Macrostrat request failed for %s,%s: %s', lat, lon, error)
        return jsonify({'error': 'Le service geologique externe est indisponible.'}), 502
    except ValueError as error:
        logger.warning('Macrostrat returned invalid JSON for %s,%s: %s', lat, lon, error)
        return jsonify({'error': 'Reponse geologique externe invalide.'}), 502

    result = {
        'lat': lat,
        'lon': lon,
        'source': 'macrostrat',
        'attribution': ATTRIBUTION,
        'units': units,
        'from_cache': False,
    }
    _cache.set(cache_key, result)
    return jsonify(result)
