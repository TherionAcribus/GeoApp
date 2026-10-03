"""
Ce que le GPS Garmin contient au-delà des visites : traces et GPX des caches.

- **Structure** du dossier ``Garmin`` (``layout``) : ``geocache_logs.xml``,
  ``geocache_visits.txt``, traces (``GPX/Current/Current.gpx``, ``GPX/Archive``),
  GPX des Pocket Queries (``GPX/<n>.gpx`` et ``<n>-wpts.gpx``).
- **Index des caches des GPX** (table ``gps_device_cache``) : nom, type et
  coordonnées des caches chargées sur le GPS, avant tout import ; le fichier sert
  ensuite à **créer la cache sans réseau** (``scraped_from_device``). Lecture légère
  par expressions régulières : le GPS réel porte 38 fichiers et 87 Mo de GPX.
- **Positionnement des visites** sur la trace (``position_visits``) et tracé
  simplifié de chaque jour (table ``gps_track_day``).

Pour un GPS sans lettre de lecteur (MTP), les fichiers déposés sont traités de la
même façon ; les GPX de caches déposés sont gardés dans ``data/gps_device_gpx``.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field
from datetime import date, timedelta, timezone, tzinfo
from typing import Callable, Iterable, Optional

from ..database import db
from ..models import AppConfig, GpsDeviceCache, GpsTrackDay, GpsVisit
from .garmin_tracks import (
    TrackPoint,
    file_start_date,
    files_for_days,
    merge_points,
    parse_track_points,
    position_at,
    simplify,
    track_distance_m,
)
from .garmin_visits import as_utc, local_day, local_midnight_utc, offset_tz

logger = logging.getLogger(__name__)

DEVICE_GPX_MTIMES_KEY = 'gps_visits.device_gpx_mtimes'


# ------------------------------------------------------------------ structure

@dataclass
class DeviceLayout:
    root: str
    logs_xml: Optional[str] = None
    visits_txt: Optional[str] = None
    current_track: Optional[str] = None
    archive_dir: Optional[str] = None
    archive_names: list[str] = field(default_factory=list)
    cache_gpx: list[str] = field(default_factory=list)

    @property
    def visits_file(self) -> Optional[str]:
        return self.logs_xml or self.visits_txt

    def to_dict(self) -> dict:
        return {
            'root': self.root,
            'visits_file': self.visits_file,
            'has_logs_xml': bool(self.logs_xml),
            'has_visits_txt': bool(self.visits_txt),
            'tracks_count': len(self.archive_names) + (1 if self.current_track else 0),
            'gpx_count': len(self.cache_gpx),
        }


def _file(path: str) -> Optional[str]:
    return path if os.path.isfile(path) else None


def is_cache_gpx_name(name: str) -> bool:
    lowered = name.lower()
    return (lowered.endswith('.gpx') and not lowered.endswith('-wpts.gpx')
            and not lowered.startswith('waypoints_') and file_start_date(name) is None)


def layout(root: str) -> DeviceLayout:
    """Structure d'un dossier ``Garmin`` (racine détectée ou dossier copié)."""
    gpx_dir = os.path.join(root, 'GPX')
    archive_dir = os.path.join(gpx_dir, 'Archive')
    info = DeviceLayout(
        root=root,
        logs_xml=_file(os.path.join(root, 'geocache_logs.xml')),
        visits_txt=_file(os.path.join(root, 'geocache_visits.txt')),
        current_track=_file(os.path.join(gpx_dir, 'Current', 'Current.gpx')),
        archive_dir=archive_dir if os.path.isdir(archive_dir) else None,
    )
    if info.archive_dir:
        info.archive_names = sorted(n for n in os.listdir(archive_dir) if n.lower().endswith('.gpx'))
    if os.path.isdir(gpx_dir):
        info.cache_gpx = sorted(
            os.path.join(gpx_dir, n) for n in os.listdir(gpx_dir)
            if is_cache_gpx_name(n) and os.path.isfile(os.path.join(gpx_dir, n))
        )
    return info


# ---------------------------------------------------------- caches des GPX

_WPT_RE = re.compile(rb'<wpt\b([^>]*)>(.*?)</wpt>', re.DOTALL)
_LAT_RE = re.compile(rb'\blat="([-+0-9.eE]+)"')
_LON_RE = re.compile(rb'\blon="([-+0-9.eE]+)"')
_WPT_NAME_RE = re.compile(rb'<name>\s*(GC[0-9A-Z]{1,8})\s*</name>', re.IGNORECASE)
_CACHE_NAME_RE = re.compile(rb'<(?:groundspeak|gs):name>([^<]*)</', re.IGNORECASE)
_CACHE_TYPE_RE = re.compile(rb'<(?:groundspeak|gs):type>([^<]*)</', re.IGNORECASE)


def light_index(data: bytes) -> list[dict]:
    """Code, nom, type et coordonnées de chaque cache d'un GPX Groundspeak (sans tout parser)."""
    caches = []
    for attrs, body in _WPT_RE.findall(data):
        code = _WPT_NAME_RE.search(body)
        lat, lon = _LAT_RE.search(attrs), _LON_RE.search(attrs)
        if not (code and lat and lon):
            continue
        name, cache_type = _CACHE_NAME_RE.search(body), _CACHE_TYPE_RE.search(body)
        caches.append({
            'gc_code': code.group(1).decode('ascii').upper(),
            'name': html.unescape(name.group(1).decode('utf-8', 'replace')).strip() if name else None,
            'cache_type': html.unescape(cache_type.group(1).decode('utf-8', 'replace')).strip() if cache_type else None,
            'latitude': float(lat.group(1)),
            'longitude': float(lon.group(1)),
        })
    return caches


def _known_mtimes() -> dict[str, float]:
    raw = AppConfig.get_value(DEVICE_GPX_MTIMES_KEY)
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def index_cache_gpx(paths: Iterable[str]) -> int:
    """
    Met à jour l'index des caches avec les GPX qui ont changé depuis leur dernière
    lecture. Pour une cache présente dans plusieurs fichiers, le plus récent l'emporte.
    Renvoie le nombre de caches (ré)indexées.
    """
    known = _known_mtimes()
    indexed = 0
    for path in paths:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if known.get(path) == mtime:
            continue
        try:
            with open(path, 'rb') as handle:
                caches = light_index(handle.read())
        except OSError as exc:
            logger.warning('GPX du GPS illisible %s : %s', path, exc)
            continue
        existing = {row.gc_code: row for row in GpsDeviceCache.query.filter(
            GpsDeviceCache.gc_code.in_([c['gc_code'] for c in caches])).all()} if caches else {}
        for cache in caches:
            row = existing.get(cache['gc_code'])
            if row is not None and (row.gpx_mtime or 0) > mtime and os.path.isfile(row.gpx_file):
                continue
            if row is None:
                row = GpsDeviceCache(gc_code=cache['gc_code'])
                db.session.add(row)
            row.name, row.cache_type = cache['name'], cache['cache_type']
            row.latitude, row.longitude = cache['latitude'], cache['longitude']
            row.gpx_file, row.gpx_mtime = path, mtime
            indexed += 1
        known[path] = mtime
    AppConfig.set_value(DEVICE_GPX_MTIMES_KEY, json.dumps(known))
    db.session.commit()
    return indexed


def device_caches(codes: Iterable[str]) -> dict[str, GpsDeviceCache]:
    codes = [c for c in set(codes) if c]
    if not codes:
        return {}
    return {row.gc_code: row for row in GpsDeviceCache.query.filter(GpsDeviceCache.gc_code.in_(codes)).all()}


# Dernier GPX parsé en entier : un ajout crée souvent plusieurs caches du même fichier.
_parsed_cache: dict[str, tuple[float, dict]] = {}
_parsed_lock = threading.Lock()


def _parse_full(path: str) -> dict:
    from ..geocaches.gpx_parser import parse_gpx_caches

    mtime = os.path.getmtime(path)
    with _parsed_lock:
        cached = _parsed_cache.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
    with open(path, 'rb') as handle:
        caches, _codes, waypoints = parse_gpx_caches(handle.read())
    by_code = {sc.gc_code: sc for sc in caches}
    wpts_path = path[:-4] + '-wpts.gpx'
    if os.path.isfile(wpts_path):
        with open(wpts_path, 'rb') as handle:
            _c, _codes, extra = parse_gpx_caches(handle.read())
        for code, points in extra.items():
            waypoints.setdefault(code, []).extend(points)
    for code, scraped in by_code.items():
        if waypoints.get(code):
            scraped.waypoints = list(waypoints[code])
    with _parsed_lock:
        _parsed_cache.clear()
        _parsed_cache[path] = (mtime, by_code)
    return by_code


def scraped_from_device(gc_code: str):
    """La cache telle que le GPX du GPS la décrit (``ScrapedGeocache``), ou ``None``."""
    row = db.session.get(GpsDeviceCache, gc_code)
    if row is None or not os.path.isfile(row.gpx_file):
        return None
    try:
        return _parse_full(row.gpx_file).get(gc_code)
    except Exception as exc:  # noqa: BLE001 - repli : téléchargement depuis le site
        logger.warning('Cache %s illisible dans %s : %s', gc_code, row.gpx_file, exc)
        return None


# ------------------------------------------------------------- positionnement

@dataclass
class TrackSource:
    """Une trace à lire : son nom (date de début pour l'archive) et de quoi la charger."""
    name: str
    load: Callable[[], bytes]
    archive: bool = True


def device_track_sources(info: DeviceLayout) -> list[TrackSource]:
    sources = []
    if info.archive_dir:
        for name in info.archive_names:
            path = os.path.join(info.archive_dir, name)
            sources.append(TrackSource(name, (lambda p=path: open(p, 'rb').read())))
    if info.current_track:
        path = info.current_track
        sources.append(TrackSource('Current.gpx', (lambda p=path: open(p, 'rb').read()), archive=False))
    return sources


def _row_tz(row: GpsVisit, tz: Optional[tzinfo]) -> Optional[tzinfo]:
    return offset_tz(row.utc_offset_minutes, tz)


def _visit_instant(row: GpsVisit):
    return as_utc(row.visited_at) + timedelta(seconds=row.seconds or 0)


def position_visits(sources: list[TrackSource], *, days: Optional[Iterable[date]] = None,
                    tz: Optional[tzinfo] = None) -> dict:
    """
    Positionne les visites sur les traces et enregistre le tracé de chaque jour.

    - Sans ``days`` : les visites à loguer jamais positionnées.
    - Avec ``days`` : toutes les visites de ces jours (nouvel essai compris), pour le
      rattachement des visites anciennes.
    Les traces d'archive ne sont lues que pour les jours utiles (et la veille).
    """
    wanted_days = set(days) if days is not None else None
    query = GpsVisit.query
    if wanted_days is None:
        query = query.filter(GpsVisit.state == 'pending', GpsVisit.position_source.is_(None))
    else:
        lo = local_midnight_utc(min(wanted_days), tz) - timedelta(hours=14)
        hi = local_midnight_utc(max(wanted_days) + timedelta(days=1), tz) + timedelta(hours=14)
        query = query.filter(GpsVisit.visited_at >= lo, GpsVisit.visited_at < hi)
    by_day: dict[date, list[GpsVisit]] = {}
    for row in query.all():
        day = local_day(row.visited_at, _row_tz(row, tz))
        if wanted_days is None or day in wanted_days:
            by_day.setdefault(day, []).append(row)
    if not by_day:
        return {'positioned': 0, 'no_track': 0, 'days': 0, 'tracks_read': 0}

    archive = [s for s in sources if s.archive]
    current = [s for s in sources if not s.archive]
    loaded: dict[str, list[TrackPoint]] = {}

    def points_of(source: TrackSource) -> list[TrackPoint]:
        if source.name not in loaded:
            try:
                loaded[source.name] = parse_track_points(source.load())
            except OSError as exc:
                logger.warning('Trace illisible %s : %s', source.name, exc)
                loaded[source.name] = []
        return loaded[source.name]

    positioned = no_track = 0
    for day, rows in sorted(by_day.items()):
        names = set(files_for_days([s.name for s in archive], [day]))
        groups = [points_of(s) for s in archive if s.name in names] + [points_of(s) for s in current]
        day_tz = _row_tz(rows[0], tz)
        start = local_midnight_utc(day, day_tz).replace(tzinfo=timezone.utc)
        end = local_midnight_utc(day + timedelta(days=1), day_tz).replace(tzinfo=timezone.utc)
        points = [p for p in merge_points(*groups) if start - timedelta(hours=1) <= p.at < end + timedelta(hours=1)]
        for row in rows:
            position = position_at(points, _visit_instant(row))
            if position:
                row.latitude, row.longitude = position
                row.position_source = 'track'
                positioned += 1
            elif row.position_source != 'track':
                row.position_source = 'no_track'
                no_track += 1
        day_points = [p for p in points if start <= p.at < end]
        if len(day_points) >= 2:
            store_track_day(day, day_points)
    db.session.commit()
    return {'positioned': positioned, 'no_track': no_track, 'days': len(by_day), 'tracks_read': len(loaded)}


def store_track_day(day: date, points: list[TrackPoint]) -> GpsTrackDay:
    simplified = simplify(points)
    row = db.session.get(GpsTrackDay, day.isoformat()) or GpsTrackDay(day=day.isoformat())
    row.points = json.dumps([[round(p.lat, 6), round(p.lon, 6), int(p.at.timestamp())] for p in simplified])
    row.distance_m = round(track_distance_m(simplified))
    row.started_at = points[0].at.replace(tzinfo=None)
    row.ended_at = points[-1].at.replace(tzinfo=None)
    db.session.merge(row)
    return row
