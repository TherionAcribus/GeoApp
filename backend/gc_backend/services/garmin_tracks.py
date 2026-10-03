"""
Traces du GPS Garmin (``GPX/Current/Current.gpx``, ``GPX/Archive/*.gpx``).

Module pur : aucune base, aucun accès disque. Le GPS enregistre en continu une
trace horodatée ; elle donne la **position de chaque visite** à son heure (y compris
les visites sans code) et le tracé de la sortie. Les fichiers d'archive sont nommés
par leur heure de début (``2021-06-13 09.39.56 Auto.gpx``) : seuls ceux des jours
utiles sont lus (le GPS réel en compte 795, 237 Mo).
"""
from __future__ import annotations

import bisect
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

TRACK_FILE_RE = re.compile(r'^(\d{4})-(\d{2})-(\d{2}) \d{2}\.\d{2}\.\d{2}\b.*\.gpx$', re.IGNORECASE)

_TRKPT_RE = re.compile(rb'<trkpt\b([^>]*)>(.*?)</trkpt>', re.DOTALL)
_LAT_RE = re.compile(rb'\blat="([-+0-9.eE]+)"')
_LON_RE = re.compile(rb'\blon="([-+0-9.eE]+)"')
_TIME_RE = re.compile(rb'<time>([^<]+)</time>')

# Écart maximal entre les deux points qui encadrent une visite pour interpoler.
MAX_INTERPOLATION_GAP = timedelta(minutes=5)
# Sinon, un point à moins de tant de la visite suffit.
MAX_NEAREST_GAP = timedelta(minutes=2)

EARTH_RADIUS_M = 6371000.0


@dataclass(frozen=True)
class TrackPoint:
    at: datetime   # UTC, avec fuseau
    lat: float
    lon: float


def parse_track_points(data: bytes) -> list[TrackPoint]:
    """Points horodatés d'un GPX de trace, triés par heure (les points sans heure sont ignorés)."""
    points: list[TrackPoint] = []
    for attrs, body in _TRKPT_RE.findall(data):
        lat, lon, when = _LAT_RE.search(attrs), _LON_RE.search(attrs), _TIME_RE.search(body)
        if not (lat and lon and when):
            continue
        try:
            at = datetime.fromisoformat(when.group(1).decode('ascii').strip().replace('Z', '+00:00'))
        except (ValueError, UnicodeDecodeError):
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        points.append(TrackPoint(at.astimezone(timezone.utc), float(lat.group(1)), float(lon.group(1))))
    points.sort(key=lambda p: p.at)
    return points


def file_start_date(name: str) -> Optional[date]:
    match = TRACK_FILE_RE.match(name)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def files_for_days(names: Iterable[str], days: Iterable[date]) -> list[str]:
    """Fichiers d'archive qui peuvent couvrir ces jours : commencés le jour même ou la veille."""
    wanted = set()
    for day in days:
        wanted.add(day)
        wanted.add(day - timedelta(days=1))
    return [name for name in names if file_start_date(name) in wanted]


def merge_points(*groups: Iterable[TrackPoint]) -> list[TrackPoint]:
    """Fusionne des traces (fichiers qui se chevauchent) : triées, sans doublon d'heure."""
    merged: dict[datetime, TrackPoint] = {}
    for group in groups:
        for point in group:
            merged.setdefault(point.at, point)
    return [merged[at] for at in sorted(merged)]


def position_at(points: list[TrackPoint], at: datetime) -> Optional[tuple[float, float]]:
    """
    Position à l'heure ``at`` : interpolée entre les deux points qui l'encadrent s'ils
    sont à moins de 5 min d'écart, sinon le point le plus proche s'il est à moins de 2 min.
    """
    if not points:
        return None
    times = [p.at for p in points]
    index = bisect.bisect_left(times, at)
    after = points[index] if index < len(points) else None
    before = points[index - 1] if index > 0 else None
    if after is not None and after.at == at:
        return after.lat, after.lon
    if before is not None and after is not None and after.at - before.at <= MAX_INTERPOLATION_GAP:
        span = (after.at - before.at).total_seconds()
        ratio = (at - before.at).total_seconds() / span if span else 0.0
        return before.lat + (after.lat - before.lat) * ratio, before.lon + (after.lon - before.lon) * ratio
    nearest = min((p for p in (before, after) if p is not None), key=lambda p: abs(p.at - at), default=None)
    if nearest is not None and abs(nearest.at - at) <= MAX_NEAREST_GAP:
        return nearest.lat, nearest.lon
    return None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _offset_m(origin: TrackPoint, point: TrackPoint) -> tuple[float, float]:
    """Projection locale équirectangulaire (mètres), suffisante à l'échelle d'une sortie."""
    x = math.radians(point.lon - origin.lon) * math.cos(math.radians(origin.lat)) * EARTH_RADIUS_M
    y = math.radians(point.lat - origin.lat) * EARTH_RADIUS_M
    return x, y


def _segment_distance_m(point: TrackPoint, start: TrackPoint, end: TrackPoint) -> float:
    px, py = _offset_m(start, point)
    ex, ey = _offset_m(start, end)
    length2 = ex * ex + ey * ey
    if length2 == 0:
        return math.hypot(px, py)
    t = max(0.0, min(1.0, (px * ex + py * ey) / length2))
    return math.hypot(px - t * ex, py - t * ey)


def simplify(points: list[TrackPoint], tolerance_m: float = 10.0) -> list[TrackPoint]:
    """Douglas-Peucker itératif : garde la forme du tracé à ``tolerance_m`` près."""
    if len(points) <= 2:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        worst, worst_index = 0.0, -1
        for index in range(first + 1, last):
            distance = _segment_distance_m(points[index], points[first], points[last])
            if distance > worst:
                worst, worst_index = distance, index
        if worst > tolerance_m and worst_index > 0:
            keep[worst_index] = True
            stack.append((first, worst_index))
            stack.append((worst_index, last))
    return [p for p, kept in zip(points, keep) if kept]


def track_distance_m(points: list[TrackPoint]) -> float:
    """Longueur du tracé. À calculer sur le tracé simplifié : le bruit du GPS à l'arrêt ne compte pas."""
    return sum(haversine_m(a.lat, a.lon, b.lat, b.lon) for a, b in zip(points, points[1:]))
