"""Proxy EarthCoach vers les services d altitude.

Beaucoup de questions d EarthCache portent sur l altitude ou le denivele entre
deux points (sommet et point de vue, haut et bas d une cascade, terrasses
alluviales...). On combine deux sources sans cle :

- **IGN / Geoplateforme** (RGE ALTI) pour la France : precision metrique, mais
  renvoie la sentinelle ``-99999`` hors couverture ;
- **Open-Meteo elevation** (Copernicus DEM 90 m) en repli mondial.

Chaque point garde la trace de la source qui l a resolu, pour que l agent puisse
annoncer la precision reelle. La reponse inclut min/max/denivele des qu il y a
plus d un point : c est exactement ce que demandent les questions de terrain.
"""

from __future__ import annotations

import logging

import requests
from flask import Blueprint, jsonify, request

from .earthcoach_geo_common import TTLCache, parse_coord

bp = Blueprint('earthcoach_elevation', __name__)
logger = logging.getLogger(__name__)

IGN_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
IGN_RESOURCE = 'ign_rge_alti_wld'
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation'
# Valeur sentinelle renvoyee par l IGN quand le point est hors couverture RGE ALTI.
IGN_NO_DATA = -99000
ATTRIBUTION = 'Altitudes: IGN RGE ALTI (Geoplateforme) en France, Open-Meteo / Copernicus DEM ailleurs'
REQUEST_TIMEOUT = 12
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
CACHE_MAX_ENTRIES = 500
MAX_POINTS = 10
_USER_AGENT = 'GeoApp-EarthCoach/1.0 (elevation lookup)'

_cache = TTLCache(CACHE_TTL_SECONDS, CACHE_MAX_ENTRIES)


def parse_points(args) -> list[tuple[float, float]]:
    """Lit soit ``lat``/``lon`` simples, soit ``points=lat,lon|lat,lon``.

    Leve ValueError avec un message exploitable tel quel dans la reponse 400.
    """
    raw_points = (args.get('points') or '').strip()
    if not raw_points:
        lat = parse_coord(args.get('lat'), 'lat', -90, 90)
        lon = parse_coord(args.get('lon') or args.get('lng'), 'lon', -180, 180)
        return [(lat, lon)]

    points: list[tuple[float, float]] = []
    for index, chunk in enumerate(part for part in raw_points.split('|') if part.strip()):
        pieces = chunk.split(',')
        if len(pieces) != 2:
            raise ValueError(f'point {index + 1} must be "lat,lon"')
        lat = parse_coord(pieces[0].strip(), f'point {index + 1} lat', -90, 90)
        lon = parse_coord(pieces[1].strip(), f'point {index + 1} lon', -180, 180)
        points.append((lat, lon))
    if not points:
        raise ValueError('points is empty')
    if len(points) > MAX_POINTS:
        raise ValueError(f'at most {MAX_POINTS} points are allowed')
    return points


def _fetch_ign(points: list[tuple[float, float]]) -> list[float | None]:
    """Altitudes IGN, ``None`` par point non couvert. Ne leve pas: l IGN est optionnel."""
    try:
        response = requests.get(
            IGN_URL,
            params={
                'lat': '|'.join(str(lat) for lat, _ in points),
                'lon': '|'.join(str(lon) for _, lon in points),
                'resource': IGN_RESOURCE,
                'delimiter': '|',
                'zonly': 'false',
            },
            headers={'User-Agent': _USER_AGENT, 'Accept': 'application/json'},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        elevations = response.json().get('elevations')
    except (requests.RequestException, ValueError) as error:
        logger.info('IGN elevation unavailable, falling back: %s', error)
        return [None] * len(points)
    if not isinstance(elevations, list) or len(elevations) != len(points):
        return [None] * len(points)

    values: list[float | None] = []
    for entry in elevations:
        raw = entry.get('z') if isinstance(entry, dict) else entry
        try:
            value = float(raw)
        except (TypeError, ValueError):
            values.append(None)
            continue
        values.append(None if value <= IGN_NO_DATA else value)
    return values


def _fetch_open_meteo(points: list[tuple[float, float]]) -> list[float | None]:
    response = requests.get(
        OPEN_METEO_URL,
        params={
            'latitude': ','.join(str(lat) for lat, _ in points),
            'longitude': ','.join(str(lon) for _, lon in points),
        },
        headers={'User-Agent': _USER_AGENT, 'Accept': 'application/json'},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    elevations = response.json().get('elevation')
    if not isinstance(elevations, list) or len(elevations) != len(points):
        raise ValueError('unexpected open-meteo payload')

    values: list[float | None] = []
    for raw in elevations:
        try:
            values.append(float(raw))
        except (TypeError, ValueError):
            values.append(None)
    return values


def _summarize(resolved: list[dict]) -> dict:
    known = [point['elevation_m'] for point in resolved if point['elevation_m'] is not None]
    if len(known) < 2:
        return {}
    lowest, highest = min(known), max(known)
    return {
        'min_m': lowest,
        'max_m': highest,
        'difference_m': round(highest - lowest, 2),
    }


@bp.get('/api/earthcoach/elevation')
def elevation_at_points():
    try:
        points = parse_points(request.args)
    except ValueError as error:
        return jsonify({'error': str(error)}), 400

    cache_key = '|'.join(f'{round(lat, 5)},{round(lon, 5)}' for lat, lon in points)
    cached = _cache.get(cache_key)
    if cached:
        return jsonify({**cached, 'from_cache': True})

    ign_values = _fetch_ign(points)
    missing = [index for index, value in enumerate(ign_values) if value is None]
    fallback_values: dict[int, float | None] = {}
    if missing:
        try:
            open_meteo = _fetch_open_meteo([points[index] for index in missing])
        except (requests.RequestException, ValueError) as error:
            logger.warning('Open-Meteo elevation failed: %s', error)
            if all(value is None for value in ign_values):
                return jsonify({'error': 'Le service d altitude externe est indisponible.'}), 502
            open_meteo = [None] * len(missing)
        fallback_values = dict(zip(missing, open_meteo))

    resolved = []
    for index, (lat, lon) in enumerate(points):
        if ign_values[index] is not None:
            elevation, source = ign_values[index], 'ign_rge_alti'
        else:
            elevation, source = fallback_values.get(index), 'open-meteo'
        resolved.append({
            'lat': lat,
            'lon': lon,
            'elevation_m': round(elevation, 2) if elevation is not None else None,
            'source': source if elevation is not None else None,
        })

    result = {
        'points': resolved,
        'attribution': ATTRIBUTION,
        'accuracy_note': (
            'IGN RGE ALTI est metrique en France; Open-Meteo (Copernicus DEM ~90 m) reste '
            'approximatif, surtout en relief accidente. A confirmer par un GPS ou un altimetre sur place.'
        ),
        'from_cache': False,
        **_summarize(resolved),
    }
    _cache.set(cache_key, result)
    return jsonify(result)
