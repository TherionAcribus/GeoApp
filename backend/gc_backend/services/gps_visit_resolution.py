"""
Rattacher une visite GPS sans code à une cache.

Le GPS écrit parfois une visite sans code (367 dans le fichier réel, surtout en
2021-2023). L'App propose des candidats ; l'utilisateur choisit toujours, rien
n'est rattaché automatiquement.

Recherche rapide (par défaut), vérifiée sur le compte réel le 2026-10-01 :

1. **Les voisines** : visites codées du même jour, juste avant et juste après
   (à moins de 90 min). Elles sont situées par la base GeoApp, sinon par la fiche
   JSON ``/api/proxy/web/v1/geocache/{code}`` (0,2 s, hors de la cadence de la
   recherche).
2. **Une recherche dans une boîte d'environ 1 km** autour d'elles. Elle donne
   aussi les caches non trouvées (une visite sans code peut être un DNF), avec
   ``userFound``.
3. **Ma date de trouvaille** des caches trouvées de la boîte : la même fiche JSON
   l'expose (``callerSpecific.found``). Trouvée le jour de la visite = candidat
   confirmé.

Recherche approfondie (bouton dédié, ~1 min) : **l'ordre de mes trouvailles**
(``fb=<moi>&sort=founddate``). La recherche ne renvoie pas ma date de trouvaille
(``lastFoundDate`` est la dernière trouvaille tous joueurs confondus) mais la
liste est triée par elle : les caches que le GPS connaît servent de repères de
date, et une trouvaille absente du fichier, coincée entre deux repères du jour,
date de ce jour-là. Utile quand aucune voisine n'est située. Limites : ~10 000
trouvailles accessibles, caches archivées absentes de l'index, une requête toutes
les ~6 s.
"""
from __future__ import annotations

import logging
import math
import time as time_module
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, tzinfo
from typing import Callable, Optional

from ..database import db
from ..models import GpsVisit
from .garmin_visits import STATUS_FOUND, local_day

logger = logging.getLogger(__name__)

PAGE_SIZE = 100
# Le serveur refuse `skip + take` au-delà (cf. geocaching_friend_finds).
MAX_SKIP = 10000
# Visites codées retenues comme voisines : même jour, à moins de tant de minutes.
NEIGHBOUR_WINDOW = timedelta(minutes=90)
# Demi-côtés des boîtes de recherche autour des voisines (~1 km, puis ~3 km si rien
# n'est confirmé : la cache visitée peut être loin d'une voisine notée 1 h avant).
BOX_MARGINS_DEGREES = (0.01, 0.03)
MAX_CANDIDATES = 15
# Fiches lues pour connaître ma date de trouvaille des caches de la boîte.
MAX_FOUND_DATE_LOOKUPS = 30
LOOKUP_INTERVAL_SECONDS = 0.15
# Pages de mes trouvailles gardées en mémoire : la visite suivante de la même période en profite.
FINDS_PAGE_TTL_SECONDS = 30 * 60

RequestFn = Callable[[dict], dict]
# Fiche JSON d'une cache (`/api/proxy/web/v1/geocache/{code}`), ou None.
LookupFn = Callable[[str], Optional[dict]]

# Écart toléré entre le jour de la visite et la date du log : un log saisi en différé
# porte souvent la date de saisie.
CLOSE_DAY_TOLERANCE = 3

CONFIDENCE_RANK = {'confirmed': 0, 'same_day': 1, 'close_day': 2, 'around': 3, None: 4, 'other_day': 5}


@dataclass
class Candidate:
    gc_code: str
    name: Optional[str] = None
    cache_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    found_by_me: Optional[bool] = None
    # Ma date de trouvaille (AAAA-MM-JJ), quand la fiche l'a donnée.
    found_on: Optional[str] = None
    sources: set[str] = field(default_factory=set)
    # 'confirmed' : trouvée ce jour-là d'après Geocaching.com ; 'close_day' : à quelques
    # jours près ; 'same_day' / 'around' : déduit de l'ordre de mes trouvailles ;
    # 'other_day' : trouvée un autre jour.
    day_confidence: Optional[str] = None
    distance_m: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            'gc_code': self.gc_code,
            'name': self.name,
            'cache_type': self.cache_type,
            'found_by_me': self.found_by_me,
            'found_on': self.found_on,
            'sources': sorted(self.sources),
            'day_confidence': self.day_confidence,
            'distance_m': round(self.distance_m) if self.distance_m is not None else None,
        }


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def record_to_candidate(record: dict) -> Optional[Candidate]:
    """Enregistrement de la recherche web → candidat (extracteurs du client de recherche)."""
    from ..geocaches.search_client import GeocachingSearchClient

    code = str(record.get('code') or '').upper()
    if not code:
        return None
    latitude, longitude = GeocachingSearchClient._extract_lat_lon(record)
    extra = GeocachingSearchClient._extract_extra_fields(record)
    return Candidate(
        gc_code=code,
        name=extra.get('name'),
        cache_type=extra.get('cache_type'),
        latitude=latitude,
        longitude=longitude,
        found_by_me=extra.get('found'),
    )


def parse_geocache_sheet(sheet: Optional[dict]) -> tuple[Optional[float], Optional[float], Optional[str], Optional[str]]:
    """Fiche JSON → (latitude, longitude, nom, ma date de trouvaille AAAA-MM-JJ)."""
    if not isinstance(sheet, dict):
        return None, None, None, None
    coordinates = sheet.get('postedCoordinates') or {}
    latitude = coordinates.get('latitude') if isinstance(coordinates, dict) else None
    longitude = coordinates.get('longitude') if isinstance(coordinates, dict) else None
    caller = sheet.get('callerSpecific') or {}
    found = caller.get('found') if isinstance(caller, dict) else None
    found_on = found[:10] if isinstance(found, str) and len(found) >= 10 else None
    return latitude, longitude, sheet.get('name'), found_on


# --------------------------------------------------------- mes trouvailles

_finds_pages: dict[tuple[str, int], tuple[float, list[Candidate]]] = {}
_finds_totals: dict[str, tuple[float, int]] = {}


def clear_finds_cache() -> None:
    _finds_pages.clear()
    _finds_totals.clear()
    _sheets.clear()


class MyFindsPager:
    """
    Pages de mes trouvailles, de la plus récente à la plus ancienne, avec cache mémoire.

    La recherche est cadencée (une requête toutes les ~6 s pour ne pas être bloqué par
    Geocaching.com) : chaque page évitée compte, d'où le cache des pages et du total.
    """

    def __init__(self, request: RequestFn, username: str):
        self.request = request
        self.username = username

    def _params(self, take: int, skip: int) -> dict:
        return {'fb': self.username, 'sort': 'founddate', 'asc': 'false', 'take': take, 'skip': skip}

    def _remember_total(self, payload: dict) -> None:
        total = payload.get('total')
        if isinstance(total, int):
            _finds_totals[self.username] = (time_module.monotonic(), total)

    @property
    def total(self) -> int:
        cached = _finds_totals.get(self.username)
        if cached and time_module.monotonic() - cached[0] < FINDS_PAGE_TTL_SECONDS:
            return cached[1]
        self._remember_total(self.request(self._params(1, 0)))
        return _finds_totals.get(self.username, (0, 0))[1]

    @property
    def reachable_pages(self) -> int:
        reachable = min(self.total, MAX_SKIP)
        return max(0, math.ceil(reachable / PAGE_SIZE))

    def page(self, index: int) -> list[Candidate]:
        key = (self.username, index)
        cached = _finds_pages.get(key)
        if cached and time_module.monotonic() - cached[0] < FINDS_PAGE_TTL_SECONDS:
            return cached[1]
        skip = index * PAGE_SIZE
        take = min(PAGE_SIZE, MAX_SKIP - skip)
        if take <= 0:
            return []
        payload = self.request(self._params(take, skip))
        self._remember_total(payload)
        records = [c for c in (record_to_candidate(r) for r in payload.get('results') or []) if c]
        for record in records:
            record.found_by_me = True
        _finds_pages[key] = (time_module.monotonic(), records)
        return records


def known_found_days(tz: Optional[tzinfo]) -> dict[str, date]:
    """Jour local de trouvaille de chaque cache que le GPS connaît (sa dernière ligne « Found it »)."""
    days: dict[str, date] = {}
    rows = db.session.query(GpsVisit.gc_code, GpsVisit.resolved_gc_code, GpsVisit.visited_at).filter(
        GpsVisit.status == STATUS_FOUND
    ).order_by(GpsVisit.visited_at).all()
    for gc_code, resolved, visited_at in rows:
        code = gc_code or resolved
        if code:
            days[code] = local_day(visited_at, tz)
    return days


def _page_days(page: list[Candidate], known: dict[str, date]) -> list[date]:
    return [known[c.gc_code] for c in page if c.gc_code in known]


def first_page_not_newer(pager: MyFindsPager, day: date, known: dict[str, date], pages: int) -> int:
    """
    Première page dont le plus ancien repère n'est pas plus récent que ``day``
    (``pages`` si aucune : le jour est hors de portée).

    Interpolation sur les dates entre les deux bornes connues, avec une bissection
    une fois sur trois pour borner le pire cas.
    """
    if not known:
        return 0
    # Invariant : la page `lo` est entièrement plus récente que `day` (ou lo = -1),
    # la page `hi` ne l'est pas (ou hi = pages). Dates aux bornes, pour interpoler.
    lo, hi = -1, pages
    lo_day, hi_day = max(known.values()), min(known.values())
    iteration = 0
    while hi - lo > 1:
        iteration += 1
        span = (lo_day - hi_day).days
        if iteration % 3 == 0 or span <= 0:
            mid = (lo + hi) // 2
        else:
            fraction = min(max((lo_day - day).days / span, 0.0), 1.0)
            mid = lo + 1 + int(fraction * (hi - lo - 1))
        mid = min(max(mid, lo + 1), hi - 1)
        days = _page_days(pager.page(mid), known)
        # Page sans repère (rare) : considérée comme atteinte, la fenêtre lira autour.
        if not days or min(days) <= day:
            hi = mid
            if days:
                hi_day = min(max(days), lo_day)
        else:
            lo = mid
            lo_day = max(min(days), hi_day)
    return hi


def finds_around_day(pager: MyFindsPager, day: date, known: dict[str, date],
                     gps_codes: set[str]) -> tuple[list[Candidate], str]:
    """
    Mes trouvailles absentes du fichier GPS, placées le jour ``day`` par leurs voisines
    connues dans la liste. Renvoie (candidats, état) — état : ``ok``, ``out_of_reach``
    (jour plus ancien que les ~10 000 trouvailles accessibles) ou ``empty``.
    """
    pages = pager.reachable_pages
    if pages == 0:
        return [], 'empty'

    lo = first_page_not_newer(pager, day, known, pages)
    if lo >= pages:
        return [], 'out_of_reach'

    # Fenêtre : la page d'avant (frontière « plus récent que le jour ») et les suivantes
    # jusqu'à un repère plus ancien que le jour.
    window: list[Candidate] = []
    for index in range(max(0, lo - 1), min(pages, lo + 4)):
        page = pager.page(index)
        window.extend(page)
        days = _page_days(page, known)
        if index >= lo and days and min(days) < day:
            break

    candidates: list[Candidate] = []
    for position, record in enumerate(window):
        if record.gc_code in gps_codes:
            continue
        newer = next((known[c.gc_code] for c in reversed(window[:position]) if c.gc_code in known), None)
        older = next((known[c.gc_code] for c in window[position + 1:] if c.gc_code in known), None)
        if newer == day and older == day:
            confidence = 'same_day'
        elif (newer == day and (older is None or older < day)) or (older == day and (newer is None or newer > day)):
            confidence = 'around'
        else:
            continue
        # Copie : les pages en cache servent à d'autres visites.
        candidates.append(replace(record, sources={'my_finds'}, day_confidence=confidence))
    return candidates, 'ok'


# ------------------------------------------------------------- voisinage

@dataclass
class Neighbour:
    gc_code: str
    time: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    name: Optional[str] = None


def neighbour_visits(visit: GpsVisit, tz: Optional[tzinfo]) -> list[Neighbour]:
    """Visites codées du même jour juste avant et juste après (à moins de 90 min)."""
    day = local_day(visit.visited_at, tz)
    rows = GpsVisit.query.filter(
        GpsVisit.visited_at >= visit.visited_at - NEIGHBOUR_WINDOW,
        GpsVisit.visited_at <= visit.visited_at + NEIGHBOUR_WINDOW,
        GpsVisit.id != visit.id,
    ).order_by(GpsVisit.visited_at).all()
    coded = [r for r in rows if r.effective_gc_code and local_day(r.visited_at, tz) == day]
    before = [r for r in coded if r.visited_at <= visit.visited_at]
    after = [r for r in coded if r.visited_at > visit.visited_at]
    chosen = ([before[-1]] if before else []) + ([after[0]] if after else [])
    return [Neighbour(gc_code=r.effective_gc_code, time=r.visited_at) for r in chosen]


def locate_neighbours(neighbours: list[Neighbour], lookup: LookupFn) -> None:
    """Coordonnées des voisines : base GeoApp d'abord, sinon la fiche JSON de Geocaching.com."""
    from ..geocaches.models import Geocache

    for neighbour in neighbours:
        geocache = Geocache.query.filter_by(gc_code=neighbour.gc_code).first()
        if geocache and geocache.latitude is not None and geocache.longitude is not None:
            neighbour.latitude, neighbour.longitude, neighbour.name = geocache.latitude, geocache.longitude, geocache.name
            continue
        latitude, longitude, name, _ = parse_geocache_sheet(cached_lookup(lookup, neighbour.gc_code)[0])
        if latitude is not None and longitude is not None:
            neighbour.latitude, neighbour.longitude, neighbour.name = latitude, longitude, name


def midpoint(neighbours: list[Neighbour]) -> Optional[tuple[float, float]]:
    points = [(n.latitude, n.longitude) for n in neighbours if n.latitude is not None and n.longitude is not None]
    if not points:
        return None
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def caches_near(request: RequestFn, point: tuple[float, float], margin: float) -> list[Candidate]:
    lat, lon = point
    params = {
        'box': f'{lat + margin},{lon - margin},{lat - margin},{lon + margin}',
        'origin': f'{lat},{lon}',
        'take': PAGE_SIZE,
        'skip': 0,
    }
    found = [c for c in (record_to_candidate(r) for r in request(params).get('results') or []) if c]
    for candidate in found:
        candidate.sources.add('neighbours')
    return found


_sheets: dict[str, tuple[float, Optional[dict]]] = {}


def cached_lookup(lookup: LookupFn, code: str) -> tuple[Optional[dict], bool]:
    """Fiche d'une cache, gardée 30 min : une journée a souvent des dizaines de visites sans code."""
    cached = _sheets.get(code)
    if cached and time_module.monotonic() - cached[0] < FINDS_PAGE_TTL_SECONDS:
        return cached[1], True
    sheet = lookup(code)
    _sheets[code] = (time_module.monotonic(), sheet)
    return sheet, False


def confirm_found_dates(candidates: list[Candidate], day: date, lookup: LookupFn,
                        sleep: Callable[[float], None] = time_module.sleep) -> None:
    """Ma date de trouvaille des candidats trouvés par moi, les plus vraisemblables d'abord."""
    to_check = [c for c in candidates if c.found_by_me and c.found_on is None]
    to_check.sort(key=lambda c: (
        CONFIDENCE_RANK.get(c.day_confidence, 4),
        c.distance_m if c.distance_m is not None else float('inf'),
    ))
    fetched = 0
    for candidate in to_check[:MAX_FOUND_DATE_LOOKUPS]:
        if fetched:
            sleep(LOOKUP_INTERVAL_SECONDS)
        sheet, from_cache = cached_lookup(lookup, candidate.gc_code)
        fetched += 0 if from_cache else 1
        _, _, _, found_on = parse_geocache_sheet(sheet)
        if not found_on:
            continue
        candidate.found_on = found_on
        gap = abs((date.fromisoformat(found_on) - day).days)
        candidate.day_confidence = ('confirmed' if gap == 0
                                    else 'close_day' if gap <= CLOSE_DAY_TOLERANCE else 'other_day')


# --------------------------------------------------------------- synthèse

def gps_codes() -> set[str]:
    """Tous les codes que le GPS connaît, lus ou rattachés : jamais proposés comme candidats."""
    codes = set()
    for gc_code, resolved in db.session.query(GpsVisit.gc_code, GpsVisit.resolved_gc_code).all():
        if gc_code:
            codes.add(gc_code)
        if resolved:
            codes.add(resolved)
    return codes


def find_candidates(visit: GpsVisit, *, request: RequestFn, lookup: LookupFn, username: Optional[str],
                    deep: bool = False, tz: Optional[tzinfo] = None,
                    sleep: Callable[[float], None] = time_module.sleep) -> dict:
    day = local_day(visit.visited_at, tz)
    excluded = gps_codes()
    neighbours = neighbour_visits(visit, tz)
    locate_neighbours(neighbours, lookup)
    point = midpoint(neighbours)

    merged: dict[str, Candidate] = {}
    finds_state = 'not_requested'
    if deep:
        finds_state = 'unavailable'
        if username:
            finds, finds_state = finds_around_day(MyFindsPager(request, username), day, known_found_days(tz), excluded)
            merged.update({c.gc_code: c for c in finds})

    searched_margin = None
    for margin in (BOX_MARGINS_DEGREES if point is not None else ()):
        searched_margin = margin
        for nearby in caches_near(request, point, margin):
            if nearby.gc_code in excluded:
                continue
            existing = merged.get(nearby.gc_code)
            if existing:
                existing.sources.add('neighbours')
                existing.latitude = existing.latitude if existing.latitude is not None else nearby.latitude
                existing.longitude = existing.longitude if existing.longitude is not None else nearby.longitude
                existing.found_by_me = existing.found_by_me or nearby.found_by_me
            else:
                merged[nearby.gc_code] = nearby
        for candidate in merged.values():
            if candidate.latitude is not None and candidate.longitude is not None:
                candidate.distance_m = _haversine_m(point[0], point[1], candidate.latitude, candidate.longitude)
        confirm_found_dates(list(merged.values()), day, lookup, sleep)
        if any(c.day_confidence == 'confirmed' for c in merged.values()):
            break
    if point is None:
        confirm_found_dates(list(merged.values()), day, lookup, sleep)

    ranked = sorted(merged.values(), key=lambda c: (
        CONFIDENCE_RANK.get(c.day_confidence, 4),
        0 if c.found_by_me else 1,
        c.distance_m if c.distance_m is not None else float('inf'),
        c.gc_code,
    ))[:MAX_CANDIDATES]

    return {
        'visit_id': visit.id,
        'day': day.isoformat(),
        'neighbours': [
            {'gc_code': n.gc_code, 'name': n.name, 'located': n.latitude is not None}
            for n in neighbours
        ],
        'located': point is not None,
        # Rayon de la dernière recherche autour des voisines, en mètres (≈ 111 km par degré).
        'search_radius_m': round(searched_margin * 111_000) if searched_margin else None,
        'finds_state': finds_state,
        'candidates': [c.to_dict() for c in ranked],
    }
