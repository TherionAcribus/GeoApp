"""
« Qui, parmi mes amis, a trouvé quoi » — sur toute l'histoire, pas seulement
sur les dernières semaines.

Deux chemins, selon la forme donnée à la requête de recherche web
(`/api/proxy/web/search/v2`) :

1. **Par complément, sur une zone bornée** (`find_codes_found_by`). Le filtre
   `fb` (found by) envoyé **avec une boîte englobante** est silencieusement
   ignoré : le serveur renvoie l'index mondial. En revanche `nfb` (not found by)
   fonctionne, d'où la soustraction :

       trouvées_par(ami) = caches_de_la_zone - caches_non_trouvées_par(ami)

   Aucune limite de date : une trouvaille de 2013 en ressort comme une d'hier.

2. **Par profil, sans borne géographique** (`search_finds_by`). Le même `fb`,
   envoyé **sans boîte et avec `sort=founddate`**, fonctionne — c'est l'appel de
   la page « Geocaches found » d'un profil. Il donne les trouvailles une par
   une, de la plus récente à la plus ancienne, ce qui compense la condensation
   du flux d'activité.

   > Le mode d'échec de `fb` étant silencieux (aucune erreur, juste l'index
   > mondial), `FilterIgnoredError` est levée dès que le total est aberrant.

Limites connues, communes aux deux chemins :
- les caches **archivées** ne sont pas dans l'index de recherche ;
- « trouvée » ≠ « loguée » : un DNF d'ami ne ressort pas ici (seul le logbook
  par cache, `sf=true`, le donne) ;
- le serveur refuse `skip + take` au-delà de ~10 000 ;
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


class FilterIgnoredError(FriendFindsError):
    """
    Le serveur a ignoré le filtre joueur et renvoie l'index mondial.

    C'est le mode d'échec **silencieux** documenté au §11.1 : aucune erreur HTTP,
    juste des millions de résultats sans rapport. Sans cette détection, on
    importerait l'index entier comme « trouvailles de l'ami ».
    """


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
class CacheSummary:
    """
    Ce que la recherche de référence sait d'une cache, en plus de son code.

    Ces champs sont dans la réponse de toute façon : les garder évite d'avoir à
    importer la cache (une requête chacune) juste pour pouvoir la placer sur une
    carte.
    """
    gc_code: str
    name: str | None = None
    cache_type: str | None = None
    latitude: float | None = None
    longitude: float | None = None


@dataclass
class FriendFindsResult:
    """Trouvailles déduites pour un ami sur une zone."""
    friend_username: str
    found_codes: set[str] = field(default_factory=set)
    zone_codes_count: int = 0
    truncated: bool = False
    #  code GC -> métadonnées, pour les seules caches trouvées.
    summaries: dict[str, CacheSummary] = field(default_factory=dict)


class GeocachingFriendFindsClient:
    """Client de la recherche web, avec cache mémoire de la référence par boîte."""

    SEARCH_URL = 'https://www.geocaching.com/api/proxy/web/search/v2'
    PAGE_SIZE = 100
    # Le serveur refuse skip+take au-delà de ~10 000 : on s'arrête avant.
    MAX_PAGES = 50
    MAX_SKIP = 10000

    # Aucun joueur n'approche ce volume (le record mondial est de l'ordre de
    # 200 000 trouvailles) : au-delà, c'est que le filtre `fb` a été ignoré et
    # que le serveur renvoie l'index entier (~3,5 M).
    MAX_PLAUSIBLE_FINDS = 500000
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
        self._baseline_cache: dict[str, tuple[float, list[CacheSummary], bool]] = {}
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

    def search_summaries(self, box: ZoneBox, extra: Optional[dict] = None) -> tuple[list[CacheSummary], bool]:
        """
        Parcourt une boîte et retourne ce que la recherche sait de chaque cache.

        `tronqué` signale qu'on a atteint le garde-fou de pagination : la zone
        est trop grande pour être comparée de façon fiable.
        """
        summaries: list[CacheSummary] = []
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
            summaries.extend(
                self._to_summary(item) for item in results if item.get('code')
            )

            skip += len(results)
            if len(results) < self.PAGE_SIZE or skip >= (payload.get('total') or 0):
                return summaries, False

        logger.warning(
            "Zone search hit the pagination guard (%d caches): results are partial", len(summaries)
        )
        return summaries, True

    def search_codes(self, box: ZoneBox, extra: Optional[dict] = None) -> tuple[list[str], bool]:
        """Liste les codes GC d'une boîte. Retourne (codes, tronqué)."""
        summaries, truncated = self.search_summaries(box, extra)
        return [summary.gc_code for summary in summaries], truncated

    @staticmethod
    def _to_summary(record: dict) -> CacheSummary:
        """
        Extrait les métadonnées d'un enregistrement de recherche.

        On réutilise les extracteurs du client de recherche plutôt que de
        redevenir : les formes de la réponse (`postedCoordinates`, `coordinates`,
        `geocacheType` dict/int/str) y sont déjà toutes gérées.
        """
        from ..geocaches.search_client import GeocachingSearchClient

        latitude, longitude = GeocachingSearchClient._extract_lat_lon(record)
        extra = GeocachingSearchClient._extract_extra_fields(record)

        return CacheSummary(
            gc_code=str(record['code']).upper(),
            name=extra.get('name'),
            cache_type=extra.get('cache_type'),
            latitude=latitude,
            longitude=longitude,
        )

    def search_finds_by(
        self,
        username: str,
        max_results: Optional[int] = None,
    ) -> tuple[list[CacheSummary], int, bool]:
        """
        Trouvailles d'un joueur, **sans borne géographique**, de la plus récente
        à la plus ancienne. Retourne (résumés, total annoncé, tronqué).

        C'est l'appel que fait la page « Geocaches found » d'un profil
        (`/play/results?sort=founddate&asc=false&fb=<pseudo>`). Il complète les
        deux autres sources :

        - le **flux d'activité** (§9) condense les trouvailles et n'en nomme
          qu'une par groupe : c'est la raison d'être de cette méthode ;
        - la **déduction par zone** (§11) est exhaustive mais bornée à une boîte.

        > ⚠️ Le §11.1 avait conclu que `fb` était ignoré par le serveur. Ce test
        > portait sur un appel **avec boîte et tri par défaut**. Ici on
        > reproduit l'appel de la page profil : `sort=founddate` (qui n'a de sens
        > que si le filtre joueur s'applique) et pas de boîte. Le garde-fou
        > ci-dessous vérifie que le filtre a bien été pris en compte.

        Deux limites structurelles, héritées de l'API :

        - le serveur refuse `skip + take` au-delà de ~10 000 : au-delà, seules
          les trouvailles les plus récentes sont accessibles. Le tri décroissant
          est donc essentiel — ce sont précisément celles que le flux condense ;
        - les caches **archivées** restent absentes de l'index (§11.3).
        """
        base = {'fb': username, 'sort': 'founddate', 'asc': 'false'}

        probe = self._request({**base, 'take': 1, 'skip': 0})
        total = int(probe.get('total') or 0)

        # Le mode d'échec de `fb` est silencieux : pas d'erreur, juste l'index
        # mondial. Aucun joueur n'approche ce volume (le record est ~200 000).
        if total > self.MAX_PLAUSIBLE_FINDS:
            raise FilterIgnoredError(
                f"geocaching.com a ignoré le filtre joueur : {total} résultats pour "
                f"« {username} », c'est l'index mondial. Cette recherche n'est pas exploitable."
            )

        limit = min(total, max_results) if max_results else total
        summaries: list[CacheSummary] = []
        skip = 0
        truncated = False

        while skip < limit:
            take = min(self.PAGE_SIZE, limit - skip)
            if skip + take > self.MAX_SKIP:
                # Palier dur du serveur : on s'arrête proprement plutôt que de
                # récolter une erreur HTTP en fin de pagination.
                truncated = True
                break

            payload = self._request({**base, 'take': take, 'skip': skip})
            results = payload.get('results') or []
            summaries.extend(self._to_summary(item) for item in results if item.get('code'))

            if len(results) < take:
                break
            skip += len(results)

        logger.info(
            "%s : %d trouvailles récupérées sur %d annoncées%s",
            username, len(summaries), total, ' (tronqué)' if truncated else ''
        )
        return summaries, total, truncated or len(summaries) < total

    def estimate_finds_count(self, username: str) -> int:
        """Nombre de trouvailles annoncées pour ce joueur, en **une** requête."""
        payload = self._request({
            'fb': username, 'sort': 'founddate', 'asc': 'false', 'take': 1, 'skip': 0,
        })
        total = int(payload.get('total') or 0)
        if total > self.MAX_PLAUSIBLE_FINDS:
            raise FilterIgnoredError(
                f"geocaching.com a ignoré le filtre joueur : {total} résultats pour « {username} »."
            )
        return total

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

    def get_zone_baseline_summaries(self, box: ZoneBox, force: bool = False) -> tuple[list[CacheSummary], bool]:
        """
        Caches de la zone, sans filtre — la référence de la soustraction.

        Mise en cache : elle est identique pour tous les amis d'une même passe,
        inutile de la retélécharger à chaque ami. On garde les métadonnées et pas
        seulement les codes : elles sont dans la réponse de toute façon, et ce
        sont elles qui permettront de placer les trouvailles sur une carte sans
        importer les caches une à une.
        """
        key = box.box_param
        with self._lock:
            cached = self._baseline_cache.get(key)
            if cached and not force and (time.time() - cached[0]) < self.BASELINE_TTL:
                logger.debug("Zone baseline served from cache (%d caches)", len(cached[1]))
                return cached[1], cached[2]

        summaries, truncated = self.search_summaries(box)

        with self._lock:
            self._baseline_cache[key] = (time.time(), summaries, truncated)
        return summaries, truncated

    def get_zone_baseline(self, box: ZoneBox, force: bool = False) -> tuple[list[str], bool]:
        """Codes GC de la référence de zone (voir `get_zone_baseline_summaries`)."""
        summaries, truncated = self.get_zone_baseline_summaries(box, force=force)
        return [summary.gc_code for summary in summaries], truncated

    def find_codes_found_by(self, friend_username: str, box: ZoneBox) -> FriendFindsResult:
        """Déduit les caches de la zone trouvées par cet ami (complément de `nfb`)."""
        baseline, truncated_baseline = self.get_zone_baseline_summaries(box)
        not_found, truncated_nfb = self.search_codes(box, {'nfb': friend_username})

        not_found_codes = set(not_found)
        summaries = {
            summary.gc_code: summary
            for summary in baseline
            if summary.gc_code not in not_found_codes
        }
        logger.info(
            "%s a trouvé %d des %d caches de la zone", friend_username, len(summaries), len(baseline)
        )

        return FriendFindsResult(
            friend_username=friend_username,
            found_codes=set(summaries),
            zone_codes_count=len(baseline),
            truncated=truncated_baseline or truncated_nfb,
            summaries=summaries,
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


# ------------------------------------------------------------- Zone « Amis »

FRIENDS_ZONE_NAME = 'Amis'
FRIENDS_ZONE_DESCRIPTION = (
    "Zone technique : géocaches importées pour cartographier les trouvailles de "
    "vos amis. Masquée par défaut (préférence « Zone « Amis » visible »)."
)


def get_or_create_friends_zone():
    """
    La zone qui accueille les caches importées depuis les trouvailles d'amis.

    Créée à la demande et **masquée** : elle peut contenir des centaines de
    caches qui ne sont pas un projet de l'utilisateur, et n'a donc pas sa place
    dans l'arbre ni dans les cibles de déplacement. Si elle a été supprimée, le
    prochain import la recrée.
    """
    from ..database import db
    from ..models import Zone

    zone = Zone.query.filter_by(name=FRIENDS_ZONE_NAME).first()
    if zone is None:
        zone = Zone(
            name=FRIENDS_ZONE_NAME,
            description=FRIENDS_ZONE_DESCRIPTION,
            is_hidden=True,
        )
        db.session.add(zone)
        db.session.commit()
        logger.info("Created the hidden « %s » zone (id=%s)", FRIENDS_ZONE_NAME, zone.id)

    return zone


def list_codes_to_import() -> list[str]:
    """
    Codes GC connus comme trouvés par un ami mais **absents de GeoApp**.

    C'est la liste exacte de ce qu'un import aurait à télécharger : les caches
    déjà importées, quelle que soit leur zone, en sont exclues.
    """
    from ..database import db
    from ..geocaches.models import Geocache
    from ..models import FriendFind

    known = {code for (code,) in db.session.query(Geocache.gc_code).all()}
    wanted = {code for (code,) in db.session.query(FriendFind.gc_code).distinct().all()}
    return sorted(wanted - known)


# --------------------------------------------------------------- Persistance

_SOURCE_SEPARATOR = ','


def _parse_sources(source_field: str) -> set[str]:
    """Décode `FriendFind.source` en l'ensemble des sources qui l'ont confirmée."""
    return {part for part in source_field.split(_SOURCE_SEPARATOR) if part}


def _format_sources(sources: set[str]) -> str:
    return _SOURCE_SEPARATOR.join(sorted(sources))


def store_finds(
    friend_username: str,
    gc_codes: Iterable[str],
    source: str = 'zone_search',
    replace_scope: Optional[Iterable[str]] = None,
    summaries: Optional[dict[str, CacheSummary]] = None,
) -> tuple[int, int]:
    """
    Enregistre les trouvailles d'un ami. Retourne (créées, déjà connues).

    `source` est la preuve apportée par **cet appel**. Une même trouvaille peut
    être confirmée par plusieurs sources au fil des synchronisations (le flux
    d'activité *et* la déduction de zone, par exemple) : `FriendFind.source`
    stocke alors l'ensemble sous forme de chaîne séparée par des virgules
    (`"activity,zone_search"`, voir `_parse_sources`/`_format_sources`). Une
    valeur simple reste un ensemble à un élément, donc aucune migration n'est
    nécessaire pour les lignes existantes.

    `replace_scope` : si fourni, les trouvailles de cet ami sur ces codes qui ne
    sont plus dans `gc_codes` perdent la preuve `source` — la ligne n'est
    supprimée que s'il ne lui en reste plus aucune. C'est ce qui empêche une
    resynchronisation de zone (aveugle aux caches archivées, sujette aux
    faux-négatifs de `nfb`) d'effacer une trouvaille par ailleurs confirmée par
    le flux d'activité ou les logs d'une cache.

    `summaries` : métadonnées relevées à la déduction (coordonnées, nom, type).
    Elles sont écrites à la création **et** rafraîchies sur une ligne existante
    qui n'en avait pas — c'est ce qui répare les lignes créées avant l'ajout de
    ces colonnes, sans requête supplémentaire.
    """
    from ..database import db
    from ..models import FriendFind
    from datetime import datetime, timezone

    gc_codes = {code.upper() for code in gc_codes}
    summaries = summaries or {}
    now = datetime.now(timezone.utc)

    existing = {
        row.gc_code: row
        for row in FriendFind.query.filter_by(friend_username=friend_username).all()
    }

    created = 0
    known = 0
    for code in gc_codes:
        summary = summaries.get(code)
        row = existing.get(code)
        if row is None:
            db.session.add(FriendFind(
                friend_username=friend_username,
                gc_code=code,
                source=source,
                latitude=summary.latitude if summary else None,
                longitude=summary.longitude if summary else None,
                cache_name=summary.name if summary else None,
                cache_type=summary.cache_type if summary else None,
                first_seen_at=now,
                last_seen_at=now,
            ))
            created += 1
        else:
            row.last_seen_at = now
            sources = _parse_sources(row.source)
            if source not in sources:
                sources.add(source)
                row.source = _format_sources(sources)
            if summary and row.latitude is None and summary.latitude is not None:
                row.latitude = summary.latitude
                row.longitude = summary.longitude
            if summary and not row.cache_name:
                row.cache_name = summary.name
            if summary and not row.cache_type:
                row.cache_type = summary.cache_type
            known += 1

    removed = 0
    if replace_scope is not None:
        scope = {code.upper() for code in replace_scope}
        for code, row in existing.items():
            if code not in scope or code in gc_codes:
                continue
            sources = _parse_sources(row.source)
            if source not in sources:
                continue  # cette synchro n'a aucune preuve à retirer ici
            sources.discard(source)
            if sources:
                row.source = _format_sources(sources)
            else:
                db.session.delete(row)
                removed += 1

    db.session.commit()
    if removed:
        logger.info("Removed %d stale finds for %s", removed, friend_username)
    return created, known
