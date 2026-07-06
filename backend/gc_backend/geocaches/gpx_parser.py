"""Parseur de fichiers GPX Groundspeak (Pocket Queries, bookmark GPX, "my finds").

Les GPX Groundspeak contiennent déjà toutes les données d'une géocache
(nom, coordonnées, type, taille, D/T, propriétaire, description, indices,
attributs, statut). Les parser directement évite de re-télécharger et re-parser
la page HTML de chaque cache — pour une Pocket Query de plusieurs centaines de
caches, on passe de plusieurs minutes (et autant de pages scrapées) à quelques
secondes, tout en réduisant fortement le risque de blocage par Geocaching.com.

Le parseur produit des ``ScrapedGeocache`` identiques à ceux du scraper, afin de
réutiliser telle quelle la persistance de ``GeocacheImporter``.
"""
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Optional

from ..utils.html_cleaner import html_to_text_with_linebreaks
from .scraper import ScrapedGeocache

logger = logging.getLogger(__name__)


# Espaces de noms rencontrés dans les GPX Groundspeak.
_GPX_NS = ('http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1')
_GROUNDSPEAK_NS = (
    'http://www.groundspeak.com/cache/1/0/1',
    'http://www.groundspeak.com/cache/1/0',
    'http://www.groundspeak.com/cache/1/1',
)

# Correspondance type Groundspeak complet -> vocabulaire court utilisé par le
# scraper et attendu par le frontend (voir GEOCACHING_CACHE_TYPE_ID_MAP).
_TYPE_MAP = {
    'traditional cache': 'Traditional',
    'multi-cache': 'Multi',
    'unknown cache': 'Mystery',
    'mystery cache': 'Mystery',
    'unknown (mystery) cache': 'Mystery',
    'virtual cache': 'Virtual',
    'letterbox hybrid': 'Letterbox Hybrid',
    'event cache': 'Event',
    'cache in trash out event': 'CITO',
    'cito event cache': 'CITO',
    'mega-event cache': 'Mega-Event',
    'giga-event cache': 'Giga-Event',
    'webcam cache': 'Webcam',
    'wherigo cache': 'Wherigo',
    'earthcache': 'Earthcache',
    'gps adventures exhibit': 'Locationless',
    'groundspeak hq': 'Groundspeak HQ',
}

# Correspondance conteneur Groundspeak -> valeur normalisée du scraper.
_SIZE_MAP = {
    'micro': 'micro',
    'small': 'small',
    'regular': 'regular',
    'large': 'large',
    'very large': 'very_large',
    'other': 'other',
    'not chosen': 'unknown',
    'unknown': 'unknown',
    'virtual': 'virtual',
}


def _local(tag: str) -> str:
    """Retourne le nom local d'une balise (sans l'espace de noms)."""
    return tag.rsplit('}', 1)[-1] if '}' in tag else tag


def _find_child(element: ET.Element, local_name: str) -> Optional[ET.Element]:
    for child in element:
        if _local(child.tag) == local_name:
            return child
    return None


def _find_groundspeak_cache(wpt: ET.Element) -> Optional[ET.Element]:
    for child in wpt:
        if _local(child.tag) == 'cache':
            return child
    return None


def _text(element: Optional[ET.Element]) -> Optional[str]:
    if element is None:
        return None
    text = (element.text or '').strip()
    return text or None


def _decimal_to_gc_coordinates(lat: Optional[float], lon: Optional[float]) -> Optional[str]:
    """Convertit des coordonnées décimales au format Geocaching (N 48° 51.402 ...)."""
    if lat is None or lon is None:
        return None
    try:
        lat_dir = 'N' if lat >= 0 else 'S'
        lat_abs = abs(lat)
        lat_deg = int(lat_abs)
        lat_min = (lat_abs - lat_deg) * 60.0

        lon_dir = 'E' if lon >= 0 else 'W'
        lon_abs = abs(lon)
        lon_deg = int(lon_abs)
        lon_min = (lon_abs - lon_deg) * 60.0

        return f"{lat_dir} {lat_deg}° {lat_min:.3f} {lon_dir} {lon_deg:03d}° {lon_min:.3f}"
    except Exception:
        return None


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    cleaned = value.strip().replace('Z', '+00:00')
    for parser in (datetime.fromisoformat,):
        try:
            return parser(cleaned)
        except Exception:
            pass
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(value.strip()[:19], fmt)
        except Exception:
            continue
    return None


def _parse_float(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return float(value.strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None


def _parse_attributes(cache_el: ET.Element) -> list[dict]:
    attributes: list[dict] = []
    attrs_container = _find_child(cache_el, 'attributes')
    if attrs_container is None:
        return attributes
    for attr in attrs_container:
        if _local(attr.tag) != 'attribute':
            continue
        name = (attr.text or '').strip()
        if not name:
            continue
        # inc="1" => attribut positif, inc="0" => négatif ("No dogs", etc.)
        inc = attr.get('inc', '1')
        is_negative = str(inc).strip() == '0'
        entry = {'name': name, 'is_negative': is_negative}
        attr_id = attr.get('id')
        if attr_id:
            entry['gc_attribute_id'] = attr_id
        attributes.append(entry)
    return attributes


def _build_description(cache_el: ET.Element) -> tuple[Optional[str], Optional[str]]:
    short_el = _find_child(cache_el, 'short_description')
    long_el = _find_child(cache_el, 'long_description')

    fragments_html: list[str] = []
    for el in (short_el, long_el):
        if el is None:
            continue
        raw = el.text or ''
        if not raw.strip():
            continue
        is_html = str(el.get('html', 'False')).strip().lower() == 'true'
        if is_html:
            fragments_html.append(raw)
        else:
            # Échapper le texte brut minimalement et préserver les retours ligne.
            escaped = raw.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            fragments_html.append('<p>' + escaped.replace('\n', '<br/>') + '</p>')

    if not fragments_html:
        return None, None

    description_html = '\n'.join(fragments_html)
    try:
        description_raw = html_to_text_with_linebreaks(description_html)
    except Exception:
        description_raw = None
    return description_html, description_raw


def _cache_status(cache_el: ET.Element) -> str:
    archived = str(cache_el.get('archived', 'False')).strip().lower() == 'true'
    available = str(cache_el.get('available', 'True')).strip().lower() == 'true'
    if archived:
        return 'archived'
    if not available:
        return 'disabled'
    return 'active'


def parse_gpx_caches(data: bytes) -> tuple[list[ScrapedGeocache], list[str]]:
    """Parse un fichier GPX unique.

    Returns:
        - la liste des géocaches complètes (bloc ``groundspeak:cache`` présent),
          sous forme de ``ScrapedGeocache`` prêts pour ``import_from_scraped``.
        - la liste des codes GC repérés sans données Groundspeak (GPX générique) :
          l'appelant peut les compléter par scraping.
    """
    caches: list[ScrapedGeocache] = []
    codes_without_data: list[str] = []

    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        logger.warning(f"GPX parse error: {e}")
        return caches, codes_without_data

    for wpt in root:
        if _local(wpt.tag) != 'wpt':
            continue

        name_el = _find_child(wpt, 'name')
        wpt_name = (name_el.text or '').strip() if name_el is not None else ''
        # On ne traite que les points principaux (code GC) ; les waypoints
        # additionnels (préfixes PK/S1/...) sont ignorés dans cette passe.
        if not wpt_name.startswith('GC') or '-' in wpt_name:
            continue

        cache_el = _find_groundspeak_cache(wpt)
        if cache_el is None:
            # GPX générique sans bloc Groundspeak : on ne connaît que le code.
            if wpt_name not in codes_without_data:
                codes_without_data.append(wpt_name)
            continue

        try:
            caches.append(_build_scraped_from_wpt(wpt, cache_el, wpt_name))
        except Exception as e:  # pragma: no cover - robustesse par cache
            logger.warning(f"Failed to parse GPX cache {wpt_name}: {e}")
            if wpt_name not in codes_without_data:
                codes_without_data.append(wpt_name)

    return caches, codes_without_data


def _build_scraped_from_wpt(wpt: ET.Element, cache_el: ET.Element, code: str) -> ScrapedGeocache:
    latitude = _parse_float(wpt.get('lat'))
    longitude = _parse_float(wpt.get('lon'))
    coordinates_raw = _decimal_to_gc_coordinates(latitude, longitude)

    name = _text(_find_child(cache_el, 'name')) or code

    owner = _text(_find_child(cache_el, 'owner')) or _text(_find_child(cache_el, 'placed_by'))

    gs_type = (_text(_find_child(cache_el, 'type')) or '')
    type_short = _TYPE_MAP.get(gs_type.lower(), gs_type or None)

    container = (_text(_find_child(cache_el, 'container')) or '')
    size = _SIZE_MAP.get(container.lower(), container.lower() or None)

    difficulty = _parse_float(_text(_find_child(cache_el, 'difficulty')))
    terrain = _parse_float(_text(_find_child(cache_el, 'terrain')))

    placed_at = _parse_time(_text(_find_child(wpt, 'time')))

    description_html, description_raw = _build_description(cache_el)

    # Les indices GPX (encoded_hints) sont en clair : on les stocke au format
    # ROT13 (comme le scraper le récupère depuis la page) pour que l'importeur
    # produise un hints_decoded correct via decode_hint_rot13.
    hint_plain = _text(_find_child(cache_el, 'encoded_hints'))
    hints = None
    if hint_plain:
        try:
            import codecs
            hints = codecs.encode(hint_plain, 'rot_13')
        except Exception:
            hints = hint_plain

    attributes = _parse_attributes(cache_el)
    status = _cache_status(cache_el)

    url_el = _find_child(wpt, 'url')
    url = _text(url_el) or f'https://www.geocaching.com/geocache/{code}'

    return ScrapedGeocache(
        gc_code=code,
        name=name,
        url=url,
        type=type_short,
        size=size,
        owner=owner,
        difficulty=difficulty,
        terrain=terrain,
        latitude=latitude,
        longitude=longitude,
        placed_at=placed_at,
        status=status,
        coordinates_raw=coordinates_raw,
        is_corrected=None,
        original_latitude=latitude,
        original_longitude=longitude,
        original_coordinates_raw=coordinates_raw,
        description_html=description_html,
        description_raw=description_raw,
        hints=hints,
        attributes=attributes or None,
        favorites_count=None,
        logs_count=None,
        images=None,
        waypoints=[],
        checkers=[],
    )
