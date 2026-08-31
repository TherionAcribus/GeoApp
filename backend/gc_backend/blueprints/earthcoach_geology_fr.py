"""Proxy EarthCoach vers les geoservices BRGM (France metropolitaine).

Macrostrat couvre le monde mais reste grossier hors Amerique du Nord. Pour une
EarthCache francaise, les geoservices OGC du BRGM apportent trois choses que
Macrostrat ne donne pas :

- une lithologie exprimee dans le vocabulaire geologique francais
  (couche WMS ``LITHO_1M_SIMPLIFIEE``, interrogeable par GetFeatureInfo) ;
- le numero et le nom de la feuille de la carte geologique 1/50 000 qui couvre
  le point (couche ``SCAN_F_GEOL50_CATALOG``), donc un lien direct vers la
  notice explicative PDF : c est la source la plus utile pour repondre aux
  questions d une EarthCache ;
- optionnellement les forages de la Banque du Sous-Sol proches, dont le log
  donne la stratigraphie locale reelle.

Limite connue : la carte harmonisee 1/50 000 vecteur (BD Charm-50) est diffusee
en WMS mais ses couches ne sont pas interrogeables (``LayerNotQueryable``). On ne
peut donc pas recuperer le polygone de formation au 1/50 000 ; on renvoie a la
place la feuille et sa notice.
"""

from __future__ import annotations

import logging
import re

import requests
from flask import Blueprint, jsonify, request

from .earthcoach_geo_common import TTLCache, parse_coord

bp = Blueprint('earthcoach_geology_fr', __name__)
logger = logging.getLogger(__name__)

WMS_URL = 'https://geoservices.brgm.fr/geologie'
ATTRIBUTION = 'Donnees geologiques France: BRGM / InfoTerre (geoservices.brgm.fr)'
REQUEST_TIMEOUT = 12
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_MAX_ENTRIES = 500
_USER_AGENT = 'GeoApp-EarthCoach/1.0 (french geological context lookup)'

# Emprise approximative France metropolitaine + Corse. Hors de cette boite les
# couches interrogees sont vides: on evite un appel reseau inutile.
FRANCE_BBOX = (41.2, -5.6, 51.3, 9.8)

# Demi-largeur de la bbox GetFeatureInfo, en degres. La couche LITHO_1M porte une
# contrainte d echelle cote serveur: en dessous de ~0.02 deg elle ne repond plus
# ("Search returned no results"). Les couches 1/50 000 tolerent une bbox plus
# serree, donc un point d interrogation plus precis.
LITHO_HALF_SPAN = 0.02
SHEET_HALF_SPAN = 0.005
BOREHOLE_HALF_SPAN = 0.02
BOREHOLE_MAX = 3
_IMAGE_SIZE = 201

_cache = TTLCache(CACHE_TTL_SECONDS, CACHE_MAX_ENTRIES)

# "    DESCR = 'Sables'" -> ('DESCR', 'Sables')
_FIELD_RE = re.compile(r"^\s*(\w+)\s*=\s*'(.*)'\s*$")
_FEATURE_RE = re.compile(r'^\s*Feature\s+\d+\s*:\s*$')


def in_france(lat: float, lon: float) -> bool:
    min_lat, min_lon, max_lat, max_lon = FRANCE_BBOX
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def _parse_feature_info(text: str) -> list[dict[str, str]]:
    """Parse la reponse ``text/plain`` de MapServer en liste d attributs.

    MapServer n expose pas de sortie JSON sur ce service : le format texte est le
    plus stable des formats disponibles (l alternative GML imposerait un parsing
    XML avec des namespaces qui varient d une couche a l autre).
    """
    features: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        if _FEATURE_RE.match(line):
            current = {}
            features.append(current)
            continue
        match = _FIELD_RE.match(line)
        if match and current is not None:
            value = match.group(2).strip()
            if value:
                current[match.group(1)] = value
    return [feature for feature in features if feature]


def _get_feature_info(lat: float, lon: float, layer: str, half_span: float, feature_count: int) -> list[dict[str, str]]:
    bbox = f'{lon - half_span},{lat - half_span},{lon + half_span},{lat + half_span}'
    center = _IMAGE_SIZE // 2
    response = requests.get(
        WMS_URL,
        params={
            'service': 'WMS',
            'version': '1.1.1',
            'request': 'GetFeatureInfo',
            'srs': 'EPSG:4326',
            'bbox': bbox,
            'width': _IMAGE_SIZE,
            'height': _IMAGE_SIZE,
            'x': center,
            'y': center,
            'layers': layer,
            'query_layers': layer,
            'info_format': 'text/plain',
            'feature_count': feature_count,
        },
        headers={'User-Agent': _USER_AGENT},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    body = response.text
    if 'ServiceException' in body:
        logger.warning('BRGM GetFeatureInfo exception on %s: %s', layer, body[:200])
        return []
    return _parse_feature_info(body)


def _lithology(lat: float, lon: float) -> dict | None:
    features = _get_feature_info(lat, lon, 'LITHO_1M_SIMPLIFIEE', LITHO_HALF_SPAN, 1)
    if not features:
        return None
    feature = features[0]
    description = feature.get('DESCR')
    rock_type = feature.get('TYPE')
    if not description and not rock_type:
        return None
    return {
        'description': description,
        'rock_type': rock_type,
        'code': feature.get('CODE_GEOL'),
        'scale': '1/1 000 000',
        'layer': 'LITHO_1M_SIMPLIFIEE',
    }


def _sheet(lat: float, lon: float) -> dict | None:
    features = _get_feature_info(lat, lon, 'SCAN_F_GEOL50_CATALOG', SHEET_HALF_SPAN, 1)
    if not features:
        return None
    feature = features[0]
    number = feature.get('numero')
    name = feature.get('nom')
    if not number and not name:
        return None
    sheet = {
        'number': number,
        'name': name,
        'scale': '1/50 000',
        'notice_url': None,
        'infoterre_url': 'https://infoterre.brgm.fr/viewer/MainTileForward.do',
    }
    if number and number.isdigit():
        # Les notices explicatives sont publiees sous le numero de feuille sur 4
        # chiffres. Ce host ne repond qu en HTTP: c est un lien affiche a
        # l utilisateur, jamais telecharge par le backend.
        sheet['notice_url'] = f'http://ficheinfoterre.brgm.fr/Notices/{int(number):04d}N.pdf'
    return sheet


def _boreholes(lat: float, lon: float) -> list[dict]:
    features = _get_feature_info(lat, lon, 'BSS_TOTAL_SANS_LABEL', BOREHOLE_HALF_SPAN, BOREHOLE_MAX)
    boreholes = []
    for feature in features[:BOREHOLE_MAX]:
        bss_id = feature.get('bss_id')
        boreholes.append({
            'bss_id': bss_id,
            'label': feature.get('bss_id_txt') or feature.get('indice'),
            'commune': feature.get('nom_commune'),
            'departement': feature.get('nom_departement'),
            'lat': feature.get('latitude'),
            'lon': feature.get('longitude'),
            'url': f'https://infoterre.brgm.fr/rechercher/rechercheOuvrage.htm?indice={bss_id}' if bss_id else None,
        })
    return boreholes


@bp.get('/api/earthcoach/geology/fr')
def french_geology_at_point():
    try:
        lat = parse_coord(request.args.get('lat'), 'lat', -90, 90)
        lon = parse_coord(request.args.get('lon') or request.args.get('lng'), 'lon', -180, 180)
    except ValueError as error:
        return jsonify({'error': str(error)}), 400

    want_boreholes = str(request.args.get('boreholes', '')).lower() in ('1', 'true', 'yes')

    if not in_france(lat, lon):
        # Pas une erreur: l agent doit pouvoir enchainer sur Macrostrat.
        return jsonify({
            'lat': lat,
            'lon': lon,
            'source': 'brgm',
            'attribution': ATTRIBUTION,
            'covered': False,
            'note': 'Ces coordonnees sont hors de la couverture BRGM (France metropolitaine).',
            'lithology': None,
            'sheet': None,
            'boreholes': [],
            'from_cache': False,
        })

    cache_key = f'{round(lat, 4)},{round(lon, 4)},{int(want_boreholes)}'
    cached = _cache.get(cache_key)
    if cached:
        return jsonify({**cached, 'from_cache': True})

    try:
        lithology = _lithology(lat, lon)
        sheet = _sheet(lat, lon)
        boreholes = _boreholes(lat, lon) if want_boreholes else []
    except requests.RequestException as error:
        logger.warning('BRGM request failed for %s,%s: %s', lat, lon, error)
        return jsonify({'error': 'Le service geologique BRGM est indisponible.'}), 502

    result = {
        'lat': lat,
        'lon': lon,
        'source': 'brgm',
        'attribution': ATTRIBUTION,
        'covered': True,
        'note': (
            'La carte harmonisee 1/50 000 (BD Charm-50) n est pas interrogeable par point: '
            'la lithologie renvoyee vient de la carte au 1/1 000 000, et la notice de la feuille '
            '1/50 000 doit etre consultee pour le detail.'
        ),
        'lithology': lithology,
        'sheet': sheet,
        'boreholes': boreholes,
        'from_cache': False,
    }
    _cache.set(cache_key, result)
    return jsonify(result)
