"""
« Qui, parmi mes amis, a trouvé quoi » — sur toute l'histoire, pas seulement
sur les dernières semaines.

Le filtre `fb` (found by) de la recherche web de geocaching.com est **ignoré par
le serveur** : il renvoie l'index entier, comme une requête sans filtre. En
revanche `nfb` (not found by) fonctionne. On obtient donc les trouvailles d'un
ami **par complément** sur une zone bornée :

    trouvées_par(ami) = caches_de_la_zone - caches_non_trouvées_par(ami)

Contrairement au flux d'activité (plafonné à ~2 mois), cette déduction n'a
aucune limite de date : une trouvaille de 2013 en ressort aussi bien qu'une
d'hier.

Limites connues :
- les caches **archivées** ne sont pas dans l'index de recherche : elles
  n'apparaissent ni dans la référence, ni dans le complément ;
- « trouvée » ≠ « loguée » : un DNF d'ami ne ressort pas ici (seul le logbook
  par cache, `sf=true`, le donne) ;
- plusieurs filtres de cette API sont réservés aux membres Premium.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

import requests

from .geocaching_auth import get_auth_service
from .geocaching_friends import NotAuthenticatedError

logger = logging.getLogger(__name__)


class FriendFindsError(RuntimeError):
    """Erreur de récupération des trouvailles d'un ami."""


class RateLimitedError(FriendFindsError):
    """geocaching.com a répondu 429 (trop de recherches) malgré les temporisations."""


@dataclass
class ZoneBox:
    """Boîte englobante d'une zone, au format attendu par la recherche web."""
    lat_max: float
    lon_min: float
    lat_min: float
    lon_max: float

    @property
    def box_param(self) -> str:
        return f"{self.lat_max},{self.lon_min},{self.lat_min},{self.lon_max}"

    @property
    def origin_param(self) -> str:
        return f"{(self.lat_max + self.lat_min) / 2},{(self.lon_min + self.lon_max) / 2}"

    @classmethod
    def from_coordinates(cls, coordinates: Iterable[tuple[float, float]], margin: float = 0.01) -> Optional["ZoneBox"]:
        """Boîte englobante d'un ensemble de coordonnées, avec une marge (~1 km)."""
        lats = []
        lons = []
        for lat, lon in coordinates:
            if lat is None or lon is None:
                continue
            lats.append(float(lat))
            lons.append(float(lon))

        if not lats:
            return None

        return cls(
            lat_max=max(lats) + margin,
            lon_min=min(lons) - margin,
            lat_min=min(lats) - margin,
            lon_max=max(lons) + margin,
        )


@dataclass
class FriendFindsResult:
    """Trouvailles déduites pour un ami sur une zone."""
    friend_username: str
    found_codes: set[str] = field(default_factory=set)
    zone_codes_count: int = 0
    truncated: bool = False


class GeocachingFriendFindsClient:
    """Client de la recherche web, avec cache mémoire de la référence par boîte."""

    SEARCH_URL = 'https://www.geocaching.com/api/proxy/web/search/v2'
    PAGE_SIZE = 100
    # Le serveur refuse skip+take au-delà de ~10 000 : on s'arrête avant.
    MAX_PAGES = 50
    BASELINE_TTL = 10 * 60

    # Cette API est fortement limitée en débit (429 « Too many requests », sans
    # en-tête Retry-After : impossible de savoir quand réessayer). c:geo ne
    # retente rien et se contente d'avertir l'utilisateur ; ici on s'auto-limite
    # à ~10 requêtes/minute, puis on retente avec des paliers croissants.
    MIN_INTERVAL_SECONDS = 6.0
    RETRY_DELAYS = (15.0, 30.0, 60.0)

    def __init__(
        self,
        session: Optional[requests.Session] = None,
        min_interval: Optional[float] = None,
        retry_delays: Optional[tuple[float, ...]] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._explicit_session = session
        self._baseline_cache: dict[str, tuple[float, list[str]]] = {}
        self._lock = threading.Lock()
        self._request_lock = threading.Lock()
        self._last_request_at = 0.0
        self._min_interval = self.MIN_INTERVAL_SECONDS if min_interval is None else min_interval
        self._retry_delays = self.RETRY_DELAYS if retry_delays is None else retry_delays
        self._sleep = sleep

    @property
    def session(self) -> requests.Session:
        if self._explicit_session is not None:
            return self._explicit_session
        return get_auth_service().get_session()

    def _request(self, params: dict) -> dict:
        """Une requête de recherche, auto-limitée en débit et retentée sur 429."""
        for attempt in range(len(self._retry_delays) + 1):
            with self._request_lock:
                elapsed = time.time() - self._last_request_at
                if elapsed < self._min_interval:
                    self._sleep(self._min_interval - elapsed)
                self._last_request_at = time.time()

            try:
                response = self.session.get(
                    self.SEARCH_URL,
                    params=params,
                    headers={'Accept': 'application/json'},
                    timeout=60,
                )
            except requests.RequestException as exc:
                raise FriendFindsError(f"Erreur réseau vers geocaching.com : {exc}") from exc

            if response.status_code == 429:
                if attempt < len(self._retry_delays):
                    delay = self._retry_delays[attempt]
                    logger.warning("Search throttled (429), retrying in %.0fs", delay)
                    self._sleep(delay)
                    continue
                raise RateLimitedError(
                    "geocaching.com limite le nombre de recherches. Réessayez dans quelques minutes."
                )

            if response.status_code in (401, 403):
                raise NotAuthenticatedError(
                    "Session Geocaching.com refusée pour la recherche : reconnectez-vous."
                )
            if response.status_code != 200:
                raise FriendFindsError(
                    f"Réponse inattendue de la recherche geocaching.com (HTTP {response.status_code})"
                )

            try:
                return response.json()
            except ValueError as exc:
                raise FriendFindsError("Réponse non-JSON de la recherche geocaching.com") from exc

        raise RateLimitedError("geocaching.com limite le nombre de recherches.")

    # ---------------------------------------------------------------- Requêtes

    def search_codes(self, box: ZoneBox, extra: Optional[dict] = None) -> tuple[list[str], bool]:
        """
        Liste les codes GC d'une boîte. Retourne (codes, tronqué).

        `tronqué` signale qu'on a atteint le garde-fou de pagination : la zone
        est trop grande pour être comparée de façon fiable.
        """
        codes: list[str] = []
        skip = 0

        for _ in range(self.MAX_PAGES):
            params = {
                'box': box.box_param,
                'origin': box.origin_param,
                'take': self.PAGE_SIZE,
                'skip': skip,
            }
            params.update(extra or {})

            payload = self._request(params)
            results = payload.get('results') or []
            codes.extend(item['code'] for item in results if item.get('code'))

            skip += len(results)
            if len(results) < self.PAGE_SIZE or skip >= (payload.get('total') or 0):
                return codes, False

        logger.warning("Zone search hit the pagination guard (%d caches): results are partial", len(codes))
        return codes, True

    def estimate_box_size(self, box: ZoneBox) -> int:
        """
        Nombre de caches dans la boîte, en **une** requête.

        Sert à prévenir avant une analyse coûteuse : une zone aux caches
        dispersées produit une boîte englobante démesurée (5 caches éparpillées
        peuvent en balayer 1400), et chaque ami coûte alors plusieurs minutes.
        """
        payload = self._request({
            'box': box.box_param,
            'origin': box.origin_param,
            'take': 1,
            'skip': 0,
        })
        return int(payload.get('total') or 0)

    def get_zone_baseline(self, box: ZoneBox, force: bool = False) -> tuple[list[str], bool]:
        """
        Codes GC de la zone, sans filtre — la référence de la soustraction.

        Mise en cache : elle est identique pour tous les amis d'une même passe,
        inutile de la retélécharger à chaque ami.
        """
        key = box.box_param
        with self._lock:
            cached = self._baseline_cache.get(key)
            if cached and not force and (time.time() - cached[0]) < self.BASELINE_TTL:
                logger.debug("Zone baseline served from cache (%d caches)", len(cached[1]))
                return cached[1], False

        codes, truncated = self.search_codes(box)

        with self._lock:
            self._baseline_cache[key] = (time.time(), codes)
        return codes, truncated

    def find_codes_found_by(self, friend_username: str, box: ZoneBox) -> FriendFindsResult:
        """Déduit les caches de la zone trouvées par cet ami (complément de `nfb`)."""
        baseline, truncated_baseline = self.get_zone_baseline(box)
        not_found, truncated_nfb = self.search_codes(box, {'nfb': friend_username})

        found = set(baseline) - set(not_found)
        logger.info(
            "%s a trouvé %d des %d caches de la zone", friend_username, len(found), len(baseline)
        )

        return FriendFindsResult(
            friend_username=friend_username,
            found_codes=found,
            zone_codes_count=len(baseline),
            truncated=truncated_baseline or truncated_nfb,
        )

    def invalidate_baseline(self) -> None:
        with self._lock:
            self._baseline_cache.clear()


_client: Optional[GeocachingFriendFindsClient] = None


def get_friend_finds_client() -> GeocachingFriendFindsClient:
    global _client
    if _client is None:
        _client = GeocachingFriendFindsClient()
    return _client


# --------------------------------------------------------------- Persistance

def store_finds(
    friend_username: str,
    gc_codes: Iterable[str],
    source: str = 'zone_search',
    replace_scope: Optional[Iterable[str]] = None,
) -> tuple[int, int]:
    """
    Enregistre les trouvailles d'un ami. Retourne (créées, déjà connues).

    `replace_scope` : si fourni, les trouvailles de cet ami sur ces codes qui ne
    sont plus dans `gc_codes` sont supprimées — c'est ce qui permet à une
    resynchronisation de zone de corriger une donnée devenue fausse.
    """
    from ..database import db
    from ..models import FriendFind
    from datetime import datetime, timezone

    gc_codes = {code.upper() for code in gc_codes}
    now = datetime.now(timezone.utc)

    existing = {
        row.gc_code: row
        for row in FriendFind.query.filter_by(friend_username=friend_username).all()
    }

    created = 0
    known = 0
    for code in gc_codes:
        row = existing.get(code)
        if row is None:
            db.session.add(FriendFind(
                friend_username=friend_username,
                gc_code=code,
                source=source,
                first_seen_at=now,
                last_seen_at=now,
            ))
            created += 1
        else:
            row.last_seen_at = now
            known += 1

    removed = 0
    if replace_scope is not None:
        scope = {code.upper() for code in replace_scope}
        for code, row in existing.items():
            if code in scope and code not in gc_codes and row.source == source:
                db.session.delete(row)
                removed += 1

    db.session.commit()
    if removed:
        logger.info("Removed %d stale finds for %s", removed, friend_username)
    return created, known
