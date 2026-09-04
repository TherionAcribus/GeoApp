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
import random
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
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


# ------------------------------------------------------- Clustering de zones

# Distance (km) en dessous de laquelle deux caches appartiennent au même
# cluster. Au-delà, on crée une boîte séparée : la recherche geocaching.com
# est limitée en débit, et une boîte qui balaye 1400 caches pour 5 caches de
# zone dispersées coûte 14 pages par ami au lieu de 1-2.
DEFAULT_CLUSTER_RADIUS_KM = 5.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance à vol d'oiseau entre deux points, en km."""
    from math import radians, sin, cos, asin, sqrt
    rlat1, rlon1, rlat2, rlon2 = map(radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(a))


def cluster_coordinates(
    coordinates: list[tuple[float, float]],
    radius_km: float = DEFAULT_CLUSTER_RADIUS_KM,
) -> list[list[tuple[float, float]]]:
    """
    Regroupe des coordonnées en clusters par proximité.

    Algorithme glouton : on prend un point non assigné comme graine, on y
    rattache tous les points à moins de ``radius_km``, puis on recommence.
    Ce n'est pas optimal (DBSCAN le serait) mais c'est déterministe, simple,
    et suffisant pour le cas d'usage : éviter qu'une zone dispersée produise
    une boîte démesurée.

    Retourne une liste de clusters, chacun étant une liste de ``(lat, lon)``.
    """
    if not coordinates:
        return []

    assigned = [False] * len(coordinates)
    clusters: list[list[tuple[float, float]]] = []

    for i, (lat, lon) in enumerate(coordinates):
        if assigned[i]:
            continue
        # Nouvelle graine.
        cluster = [(lat, lon)]
        assigned[i] = True
        # On rattache tous les points non assignés à moins de radius_km.
        # On itère car les points rattachés peuvent en attirer d'autres
        # (effet de chaîne, comme DBSCAN avec un seul voisin).
        changed = True
        while changed:
            changed = False
            for j, (lat2, lon2) in enumerate(coordinates):
                if assigned[j]:
                    continue
                # Distance à n'importe quel point du cluster.
                for clat, clon in cluster:
                    if _haversine_km(clat, clon, lat2, lon2) <= radius_km:
                        cluster.append((lat2, lon2))
                        assigned[j] = True
                        changed = True
                        break

        clusters.append(cluster)

    return clusters


def zone_boxes_from_coordinates(
    coordinates: list[tuple[float, float]],
    radius_km: float = DEFAULT_CLUSTER_RADIUS_KM,
    margin: float = 0.01,
) -> list[ZoneBox]:
    """
    Découpe une zone en boîtes englobantes par clustering géographique.

    Retourne une liste de ``ZoneBox`` : une seule si les caches sont proches,
    plusieurs si elles sont dispersées. Chaque boîte est plus petite que la
    boîte globale, ce qui réduit le nombre de caches balayées par la recherche
    geocaching.com.
    """
    clusters = cluster_coordinates(coordinates, radius_km=radius_km)
    boxes: list[ZoneBox] = []
    for cluster in clusters:
        box = ZoneBox.from_coordinates(cluster, margin=margin)
        if box is not None:
            boxes.append(box)
    return boxes


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

    # Cette API est fortement limitée en débit (429 « Too many requests »).
    # L'en-tête Retry-After est parfois absent, parfois présent : on le lit quand
    # il est là, et on retombe sur un backoff exponentiel avec jitter sinon.
    # c:geo ne retente rien et se contente d'avertir l'utilisateur ; ici on
    # s'auto-limite à ~10 requêtes/minute, puis on retente avec un backoff
    # exponentiel. Après un 429, l'interval de base est augmenté (adaptatif) puis
    # décroît progressivement après des succès consécutifs.
    MIN_INTERVAL_SECONDS = 6.0
    RETRY_DELAYS = (15.0, 30.0, 60.0)  # legacy, utilisé si injecté explicitement
    MAX_RETRY_ATTEMPTS = 5
    BACKOFF_BASE = 10.0  # secondes, premier délai du backoff exponentiel
    BACKOFF_FACTOR = 2.0  # multiplicateur par tentative
    BACKOFF_MAX = 300.0  # plafond (5 min)
    BACKOFF_JITTER = 5.0  # jitter aléatoire ajouté (secondes)
    ADAPTIVE_INTERVAL_MAX = 60.0  # plafond de l'interval adaptatif après 429
    ADAPTIVE_INTERVAL_DECAY = 0.9  # décroissance de l'interval après un succès

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
        self._nominal_interval = self._min_interval  # valeur de référence pour la décroissance
        self._retry_delays = self.RETRY_DELAYS if retry_delays is None else retry_delays
        self._use_legacy_delays = retry_delays is not None  # paliers fixes injectés (tests)
        self._sleep = sleep
        self._consecutive_successes = 0  # pour la décroissance de l'interval adaptatif

    @property
    def session(self) -> requests.Session:
        if self._explicit_session is not None:
            return self._explicit_session
        return get_auth_service().get_session()

    def _parse_retry_after(self, response: requests.Response) -> float | None:
        """
        Lit l'en-tête ``Retry-After`` si présent.

        Deux formats possibles (RFC 7231) :

        - un nombre de secondes : ``Retry-After: 120``
        - une date HTTP : ``Retry-After: Wed, 21 Oct 2026 07:28:00 GMT``

        Retourne le délai en secondes (plafonné à ``BACKOFF_MAX``), ou ``None``
        si l'en-tête est absent ou illisible.
        """
        value = response.headers.get('Retry-After')
        if not value:
            return None
        # Format 1 : nombre de secondes
        try:
            seconds = float(value)
            return min(seconds, self.BACKOFF_MAX)
        except ValueError:
            pass
        # Format 2 : date HTTP
        try:
            target = parsedate_to_datetime(value)
            if target is None:
                return None
            now = datetime.now(timezone.utc)
            if target.tzinfo is None:
                target = target.replace(tzinfo=timezone.utc)
            delay = (target - now).total_seconds()
            return max(0.0, min(delay, self.BACKOFF_MAX))
        except (TypeError, ValueError):
            return None

    def _compute_backoff_delay(self, attempt: int) -> float:
        """
        Délai de backoff exponentiel avec jitter pour la tentative ``attempt``.

        ``base * factor^attempt + jitter`` plafonné à ``BACKOFF_MAX``.
        Le jitter évite que tous les clients réessayent en même temps.
        """
        delay = self.BACKOFF_BASE * (self.BACKOFF_FACTOR ** attempt)
        delay += random.uniform(0, self.BACKOFF_JITTER)
        return min(delay, self.BACKOFF_MAX)

    def _increase_interval(self) -> None:
        """Après un 429, augmente l'interval de base (adaptatif)."""
        new_interval = self._min_interval * 2.0
        self._min_interval = min(new_interval, self.ADAPTIVE_INTERVAL_MAX)
        self._consecutive_successes = 0
        logger.info("Adaptive interval increased to %.1fs after 429", self._min_interval)

    def _decrease_interval(self) -> None:
        """Après un succès, décroît l'interval vers sa valeur nominale."""
        if self._min_interval <= self._nominal_interval:
            return
        self._consecutive_successes += 1
        # Après quelques succès consécutifs, on décroît l'interval.
        if self._consecutive_successes >= 3:
            self._min_interval = max(
                self._nominal_interval,
                self._min_interval * self.ADAPTIVE_INTERVAL_DECAY,
            )
            self._consecutive_successes = 0
            logger.debug("Adaptive interval decreased to %.1fs after successes", self._min_interval)

    def _request(self, params: dict) -> dict:
        """
        Une requête de recherche, auto-limitée en débit et retentée sur 429.

        Stratégie de retry :

        1. Lire l'en-tête ``Retry-After`` si présent (secondes ou date HTTP) ;
        2. Sinon, backoff exponentiel avec jitter : ``base * 2^attempt + jitter`` ;
        3. Après un 429, l'interval de base est augmenté (adaptatif) ;
        4. Après des succès consécutifs, l'interval décroît vers sa valeur nominale.

        Si ``retry_delays`` a été injecté explicitement (pour les tests), les
        paliers fixes sont utilisés à la place du backoff exponentiel.
        """
        use_legacy_delays = self._use_legacy_delays
        max_attempts = len(self._retry_delays) if use_legacy_delays else self.MAX_RETRY_ATTEMPTS

        for attempt in range(max_attempts + 1):
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
                self._increase_interval()
                if attempt < max_attempts:
                    # Priorité au Retry-After du serveur, sinon backoff exponentiel
                    if use_legacy_delays:
                        delay = self._retry_delays[attempt]
                    else:
                        retry_after = self._parse_retry_after(response)
                        delay = retry_after if retry_after is not None else self._compute_backoff_delay(attempt)
                    logger.warning(
                        "Search throttled (429), retrying in %.1fs (attempt %d/%d, interval=%.1fs)",
                        delay, attempt + 1, max_attempts, self._min_interval,
                    )
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

            self._decrease_interval()

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

    def estimate_nfb_count(self, friend_username: str, box: ZoneBox) -> int:
        """
        Nombre de caches de la boîte **non** trouvées par cet ami, en **une**
        requête.

        C'est la sonde qui rend l'analyse supportable : pour « qui n'a pas fait
        la série », la plupart des amis ont 0 trouvaille sur la zone. Sans cette
        sonde, chacun d'eux coûterait autant de pages que la référence (on
        paginerait l'intégralité de la boîte pour apprendre qu'elle n'a rien
        trouvé). Avec elle, un ami à 0 trouvaille se détecte en une seule
        requête.
        """
        payload = self._request({
            'box': box.box_param,
            'origin': box.origin_param,
            'nfb': friend_username,
            'take': 1,
            'skip': 0,
        })
        return int(payload.get('total') or 0)

    def estimate_finds_in_box_count(self, friend_username: str, box: ZoneBox) -> int:
        """
        Nombre de caches de la boîte trouvées par cet ami, en **une** requête.

        C'est la sonde du **chemin direct** (`fb` + `box` + `sort=founddate`) :
        si le filtre joueur est pris en compte par le serveur, on obtient
        directement les trouvailles dans la boîte — sans paginer le complément
        `nfb` (qui pour un ami à 0 trouvaille est aussi gros que la référence).

        > ⚠️ Le mode d'échec de `fb` est **silencieux** (§11.1) : aucune erreur
        > HTTP, juste l'index mondial. Le garde-fou `FilterIgnoredError` lève
        > dès que le total dépasse `MAX_PLAUSIBLE_FINDS`. L'appelant doit
        > intercepter cette exception pour retomber sur le complément `nfb`.
        """
        payload = self._request({
            'fb': friend_username,
            'sort': 'founddate',
            'asc': 'false',
            'box': box.box_param,
            'origin': box.origin_param,
            'take': 1,
            'skip': 0,
        })
        total = int(payload.get('total') or 0)
        if total > self.MAX_PLAUSIBLE_FINDS:
            raise FilterIgnoredError(
                f"geocaching.com a ignoré le filtre joueur : {total} résultats pour "
                f"« {friend_username} » avec boîte, c'est l'index mondial. "
                f"Cette recherche n'est pas exploitable."
            )
        return total

    def _paginate_fb(
        self,
        base_params: dict,
        total: int,
        max_results: Optional[int] = None,
    ) -> tuple[list[CacheSummary], bool]:
        """
        Pagine une recherche `fb` dont le total est déjà connu (sonde faite).

        Retourne (résumés, tronqué). Le plafond `MAX_SKIP` du serveur est
        respecté : au-delà, on s'arrête proprement.
        """
        limit = min(total, max_results) if max_results else total
        summaries: list[CacheSummary] = []
        skip = 0
        truncated = False

        while skip < limit:
            take = min(self.PAGE_SIZE, limit - skip)
            if skip + take > self.MAX_SKIP:
                truncated = True
                break
            payload = self._request({**base_params, 'take': take, 'skip': skip})
            results = payload.get('results') or []
            summaries.extend(self._to_summary(item) for item in results if item.get('code'))
            if len(results) < take:
                break
            skip += len(results)

        return summaries, truncated or len(summaries) < limit

    def search_finds_in_box(
        self,
        username: str,
        box: ZoneBox,
        max_results: Optional[int] = None,
    ) -> tuple[list[CacheSummary], int, bool]:
        """
        Trouvailles d'un joueur **dans une boîte**, de la plus récente à la
        plus ancienne. Retourne (résumés, total, tronqué).

        C'est la variante géolocalisée de `search_finds_by` : mêmes paramètres
        (`fb`, `sort=founddate`, `asc=false`) avec en plus `box` et `origin`.
        Le garde-fou `FilterIgnoredError` détecte le mode d'échec silencieux du
        filtre joueur (§11.1).
        """
        total = self.estimate_finds_in_box_count(username, box)
        base = {
            'fb': username,
            'sort': 'founddate',
            'asc': 'false',
            'box': box.box_param,
            'origin': box.origin_param,
        }
        summaries, truncated = self._paginate_fb(base, total, max_results)
        logger.info(
            "%s : %d trouvailles dans la boîte sur %d annoncées%s",
            username, len(summaries), total, ' (tronqué)' if truncated else ''
        )
        return summaries, total, truncated

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
        """
        Déduit les caches de la zone trouvées par cet ami.

        Deux chemins, du plus rapide au plus robuste :

        1. **Chemin direct** (`fb` + `box` + `sort=founddate`) : si le serveur
           prend en compte le filtre joueur **avec** une boîte, on obtient
           directement les trouvailles dans la zone — un ami avec 5 trouvailles
           sur 1 400 caches coûte 1 page au lieu de 14. C'est l'appel de la page
           « Geocaches found » d'un profil, restreint à une boîte.

        2. **Complément `nfb`** (fallback) : si le filtre `fb` est silencieusement
           ignoré (§11.1), on retombe sur la soustraction
           `trouvées = référence − non_trouvées`. La sonde `nfb` (1 requête)
           court-circuite la pagination pour les amis à 0 ou tout trouvé.
        """
        baseline, truncated_baseline = self.get_zone_baseline_summaries(box)
        baseline_codes = {summary.gc_code for summary in baseline}

        # --- Chemin direct : fb + box ---
        result = self._find_via_fb_box(
            friend_username, box, baseline, baseline_codes, truncated_baseline
        )
        if result is not None:
            return result

        # --- Fallback : complément nfb ---
        return self._find_via_nfb(friend_username, box, baseline, truncated_baseline)

    def find_codes_found_by_multi(
        self,
        friend_username: str,
        boxes: list[ZoneBox],
    ) -> FriendFindsResult:
        """
        Déduit les trouvailles d'un ami sur plusieurs boîtes (clusters).

        Pour une zone dispersée, on découpe en plusieurs boîtes plus petites
        (cf. ``zone_boxes_from_coordinates``) : chaque boîte balaye moins de
        caches côté geocaching.com, et le total des trouvailles est l'union
        des résultats par boîte.

        - Les ``found_codes`` sont l'union des trouvailles de chaque boîte.
        - Les ``summaries`` sont fusionnées (les doublons écrasent).
        - ``zone_codes_count`` est la somme des baselines (sans double-compte
          des codes communs à plusieurs boîtes).
        - ``truncated`` est vrai si au moins une boîte est tronquée.
        """
        if not boxes:
            return FriendFindsResult(
                friend_username=friend_username,
                found_codes=set(),
                zone_codes_count=0,
                truncated=False,
                summaries={},
            )

        all_found: set[str] = set()
        all_summaries: dict[str, CacheSummary] = {}
        all_baseline_codes: set[str] = set()
        any_truncated = False

        for box in boxes:
            result = self.find_codes_found_by(friend_username, box)
            all_found |= result.found_codes
            all_summaries.update(result.summaries)
            # Les baselines peuvent se chevaucher : on dédoublonne par code.
            all_baseline_codes |= {s.gc_code for s in result.summaries.values()}
            # zone_codes_count du résultat = len(baseline) de cette boîte.
            # On l'ajoute au total, mais on dédoublonne à la fin.
            any_truncated = any_truncated or result.truncated

        return FriendFindsResult(
            friend_username=friend_username,
            found_codes=all_found,
            zone_codes_count=len(all_baseline_codes),
            truncated=any_truncated,
            summaries=all_summaries,
        )

    def _find_via_fb_box(
        self,
        friend_username: str,
        box: ZoneBox,
        baseline: list[CacheSummary],
        baseline_codes: set[str],
        truncated_baseline: bool,
    ) -> Optional[FriendFindsResult]:
        """
        Chemin direct via `fb` + `box` + `sort=founddate`.

        Retourne ``None`` si le chemin n'est pas exploisable (filtre ignoré,
        cas ambigu, codes hors boîte) : l'appelant doit alors retomber sur le
        complément `nfb`.
        """
        try:
            fb_total = self.estimate_finds_in_box_count(friend_username, box)
        except FilterIgnoredError:
            logger.info(
                "fb+box ignoré pour %s (filtre joueur non pris en compte), "
                "retour au complément nfb",
                friend_username,
            )
            return None

        if fb_total == 0:
            logger.info(
                "%s a trouvé 0 des %d caches de la zone (fb+box, sans pagination)",
                friend_username, len(baseline)
            )
            return FriendFindsResult(
                friend_username=friend_username,
                found_codes=set(),
                zone_codes_count=len(baseline),
                truncated=truncated_baseline,
                summaries={},
            )

        # Si le total fb atteint la référence et qu'elle n'est pas tronquée,
        # on ne peut pas distinguer « l'ami a tout trouvé » (légitime, rare) de
        # « le filtre fb a été ignoré, le serveur renvoie toutes les caches de
        # la boîte ». On laisse le complément nfb trancher (sa sonde détectera
        # nfb_total == 0 si l'ami a vraiment tout trouvé).
        if not truncated_baseline and fb_total >= len(baseline_codes):
            logger.info(
                "fb+box : total == référence (%d) pour %s, ambigu, retour au complément nfb",
                fb_total, friend_username,
            )
            return None

        # Cas intéressant : 0 < fb_total < len(baseline). On pagine fb+box
        # pour obtenir directement les trouvailles dans la boîte.
        base = {
            'fb': friend_username,
            'sort': 'founddate',
            'asc': 'false',
            'box': box.box_param,
            'origin': box.origin_param,
        }
        summaries_list, truncated_fb = self._paginate_fb(base, fb_total)
        summaries = {summary.gc_code: summary for summary in summaries_list}

        # Vérification de cohérence : si la baseline n'est pas tronquée, tous
        # les codes retournés doivent être dans la boîte. Sinon, le filtre box
        # a été ignoré (le serveur renvoie les trouvailles mondiales de l'ami).
        if not truncated_baseline:
            out_of_box = set(summaries) - baseline_codes
            if out_of_box:
                logger.warning(
                    "fb+box a retourné %d codes hors boîte pour %s : le filtre box "
                    "a probablement été ignoré. Retour au complément nfb.",
                    len(out_of_box), friend_username,
                )
                return None

        logger.info(
            "%s a trouvé %d des %d caches de la zone (fb+box)",
            friend_username, len(summaries), len(baseline)
        )
        return FriendFindsResult(
            friend_username=friend_username,
            found_codes=set(summaries),
            zone_codes_count=len(baseline),
            truncated=truncated_baseline or truncated_fb,
            summaries=summaries,
        )

    def _find_via_nfb(
        self,
        friend_username: str,
        box: ZoneBox,
        baseline: list[CacheSummary],
        truncated_baseline: bool,
    ) -> FriendFindsResult:
        """
        Complément `nfb` : ``trouvées = référence − non_trouvées``.

        Sonde préalable (1 requête) : si l'ami n'a rien trouvé dans la boîte,
        ou s'il a tout trouvé, on s'épargne la pagination complète du
        complément. C'est le cas le plus fréquent pour « qui n'a pas fait
        la série » : la plupart des amis ont 0 trouvaille sur la zone.
        """
        nfb_total = self.estimate_nfb_count(friend_username, box)

        if nfb_total == 0:
            # L'ami a trouvé toutes les caches de la boîte.
            summaries = {summary.gc_code: summary for summary in baseline}
            logger.info(
                "%s a trouvé %d des %d caches de la zone (nfb, tout, sans pagination)",
                friend_username, len(summaries), len(baseline)
            )
            return FriendFindsResult(
                friend_username=friend_username,
                found_codes=set(summaries),
                zone_codes_count=len(baseline),
                truncated=truncated_baseline,
                summaries=summaries,
            )

        if not truncated_baseline and nfb_total == len(baseline):
            # L'ami n'a rien trouvé dans la boîte : le complément nfb est aussi
            # grand que la référence. Inutile de le paginer pour apprendre qu'il
            # ne contient que des caches qu'on connaît déjà.
            logger.info(
                "%s a trouvé 0 des %d caches de la zone (nfb, sans pagination)",
                friend_username, len(baseline)
            )
            return FriendFindsResult(
                friend_username=friend_username,
                found_codes=set(),
                zone_codes_count=len(baseline),
                truncated=False,
                summaries={},
            )

        # Cas général : on pagine le complément nfb pour identifier les caches
        # non trouvées, puis on déduit les trouvailles par différence.
        not_found, truncated_nfb = self.search_codes(box, {'nfb': friend_username})

        not_found_codes = set(not_found)
        summaries = {
            summary.gc_code: summary
            for summary in baseline
            if summary.gc_code not in not_found_codes
        }
        logger.info(
            "%s a trouvé %d des %d caches de la zone (nfb)",
            friend_username, len(summaries), len(baseline)
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


# ----------------------------------------------- Heuristique logbook vs zone

# Coût d'une cache via le logbook : 1 page HTML (userToken) + 1 appel logs
# « tous » + 1 appel logs « amis » (sf=true) = 3 requêtes.
LOGBOOK_COST_PER_CACHE = 3

# Coût minimum d'un ami via la recherche par zone : 1 sonde fb+box. Avec
# pagination, ça grandit (PAGE_SIZE caches par page).
ZONE_SEARCH_COST_PER_FRIEND_MIN = 1


def estimate_logbook_cost(nb_caches: int) -> int:
    """
    Nombre de requêtes pour scanner tous les amis via les logbooks.

    Le logbook filtre par amis (sf=true) : on scanne toutes les caches de la
    zone une par une, et pour chaque cache on récupère les logs d'amis en
    une seule passe. Le coût est O(caches), indépendant du nombre d'amis.
    """
    return nb_caches * LOGBOOK_COST_PER_CACHE


def estimate_zone_search_cost(nb_friends: int, searched_caches: int, page_size: int = 100) -> int:
    """
    Nombre de requêtes pour scanner tous les amis via la recherche par zone.

    Chaque ami coûte au minimum 1 sonde (fb+box), plus la pagination si la
    baseline est grande (nfb fallback). Le coût est O(amis × pages).
    """
    if nb_friends == 0:
        return 0
    pages_per_friend = max(1, -(-searched_caches // page_size))
    return nb_friends * pages_per_friend


def should_use_logbook(nb_caches: int, nb_friends: int, searched_caches: int) -> bool:
    """
    Heuristique : faut-il scanner via les logbooks plutôt que par zone ?

    Le logbook est avantageux quand la zone a peu de caches mais beaucoup
    d'amis : le coût est O(caches) au lieu de O(amis × pages).

    Exemples :
    - 20 caches, 16 amis, 100 caches balayées : logbook=60, zone=16 → zone gagne
    - 5 caches, 16 amis, 1400 caches balayées : logbook=15, zone=224 → logbook gagne
    - 10 caches, 16 amis, 500 caches balayées : logbook=30, zone=80 → logbook gagne
    """
    logbook_cost = estimate_logbook_cost(nb_caches)
    zone_cost = estimate_zone_search_cost(nb_friends, searched_caches)
    return logbook_cost < zone_cost


# --------------------------------------------------- Scan via logbook (sf=true)

def scan_finds_via_logbook(
    zone_id: int,
    gc_codes: list[str],
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> dict:
    """
    Scanne les trouvailles d'amis sur une zone via les logbooks (sf=true).

    Pour chaque cache de la zone, récupère les logs d'amis via le filtre
    ``sf=true`` du logbook de geocaching.com. Les « Found » d'amis sont
    enregistrés dans ``FriendFind`` avec ``source='cache_logs'``.

    Contrairement à la recherche par zone (qui itère sur les amis), cette
    méthode itère sur les **caches** : le coût est O(caches), indépendant du
    nombre d'amis. C'est avantageux pour les zones avec peu de caches mais
    beaucoup d'amis (cf. ``should_use_logbook``).

    Args:
        zone_id: identifiant de la zone (pour enregistrer les scans).
        gc_codes: codes GC des caches à scanner.
        on_progress: callback ``on_progress(done, total, gc_code)``.

    Returns:
        Un dictionnaire avec :
        - ``scanned`` : nombre de caches scannées
        - ``friend_finds`` : dict {friend: [gc_codes trouvés]}
        - ``errors`` : liste des caches en échec
        - ``rate_limited`` : bool (au moins un 429)
    """
    from ..services.geocaching_logs import (
        GeocachingLogsClient,
        GeocachingLogsError,
        FriendLogsCheckFailedError,
    )
    from ..geocaches.models import GeocacheLog

    total = len(gc_codes)
    friend_finds: dict[str, list[str]] = {}
    errors: list[str] = []
    rate_limited = False
    scanned = 0

    client = GeocachingLogsClient()

    for index, gc_code in enumerate(gc_codes):
        try:
            logs, friend_external_ids = client.get_logs_with_friends(gc_code, count=50)
            scanned += 1

            if friend_external_ids:
                # Extraire les « Found » d'amis.
                for log_data in logs:
                    if (log_data.external_id in friend_external_ids
                            and GeocacheLog.normalize_log_type(log_data.log_type) == 'Found'
                            and log_data.author):
                        friend_finds.setdefault(log_data.author, []).append(gc_code)

        except FriendLogsCheckFailedError:
            # Les logs « tous » ont été récupérés, mais sf=true a échoué.
            # On ne peut pas déterminer les amis : on compte la cache comme
            # scannée mais sans trouvailles d'amis.
            scanned += 1
            logger.warning("sf=true failed for %s, skipping friend detection", gc_code)

        except GeocachingLogsError as exc:
            logger.warning("Failed to fetch logs for %s: %s", gc_code, exc)
            errors.append(gc_code)
            # Détecter le rate limiting (message ou statut).
            if '429' in str(exc) or 'rate' in str(exc).lower():
                rate_limited = True

        except LookupError:
            # Cache supprimée ou inaccessible (404).
            errors.append(gc_code)

        except Exception as exc:  # pragma: no cover - garde-fou
            logger.exception("Unexpected error scanning %s", gc_code)
            errors.append(gc_code)

        if on_progress is not None:
            on_progress(index + 1, total, gc_code)

    # Persistance : enregistrer les trouvailles par ami.
    for friend, codes in friend_finds.items():
        store_finds(friend, codes, source='cache_logs')

    return {
        'scanned': scanned,
        'friend_finds': friend_finds,
        'errors': errors,
        'rate_limited': rate_limited,
    }


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


# ------------------------------------------------------- Mémoire des scans

# Une boîte dont la signature change invalide les scans précédents : on
# considère qu'un scan est « frais » s'il date de moins de cette durée ET que
# la boîte n'a pas changé.
DEFAULT_SCAN_FRESHNESS_HOURS = 24 * 7  # 7 jours


def _is_after(dt: datetime, threshold: datetime) -> bool:
    """
    Compare deux datetimes en gérant le cas naive (SQLite) vs aware (UTC).

    SQLite ne stocke pas le fuseau horaire : les datetimes lues depuis la base
    sont « naive ». Les comparaisons directes avec des datetimes « aware »
    lèvent une ``TypeError`` en Python.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if threshold.tzinfo is None:
        threshold = threshold.replace(tzinfo=timezone.utc)
    return dt > threshold


def record_scan(
    friend_username: str,
    zone_id: int,
    box: ZoneBox,
    found_count: int,
    baseline_total: int,
    zone_matches: int,
    truncated: bool,
) -> None:
    """
    Enregistre ou met à jour le résultat d'un scan (ami × zone).

    Upsert sur ``(friend_username, zone_id)`` : un re-scan écrase le résultat
    précédent. La signature de la boîte est stockée pour détecter les
    changements de périmètre (caches ajoutées → boîte différente → scan
    obsolète).
    """
    from ..database import db
    from ..models import FriendZoneScan

    now = datetime.now(timezone.utc)
    row = FriendZoneScan.query.filter_by(
        friend_username=friend_username, zone_id=zone_id
    ).first()

    if row is None:
        db.session.add(FriendZoneScan(
            friend_username=friend_username,
            zone_id=zone_id,
            box_signature=box.box_param,
            baseline_total=baseline_total,
            found_count=found_count,
            zone_matches=zone_matches,
            truncated=truncated,
            scanned_at=now,
        ))
    else:
        row.box_signature = box.box_param
        row.baseline_total = baseline_total
        row.found_count = found_count
        row.zone_matches = zone_matches
        row.truncated = truncated
        row.scanned_at = now

    db.session.commit()


def get_zone_scans(zone_id: int) -> dict[str, dict]:
    """
    État des scans pour une zone, indexé par pseudo d'ami.

    Retourne ``{username: {scanned_at, found_count, zone_matches, ...}}``.
    Les amis jamais scannés sont absents du dict : l'appelant les croise avec
    la liste d'amis pour distinguer « jamais analysé » de « analysé, 0 ».
    """
    from ..models import FriendZoneScan

    rows = FriendZoneScan.query.filter_by(zone_id=zone_id).all()
    return {row.friend_username: row.to_dict() for row in rows}


def filter_friends_to_scan(
    zone_id: int,
    friends: list[str],
    box: ZoneBox,
    max_age_hours: float = DEFAULT_SCAN_FRESHNESS_HOURS,
) -> tuple[list[str], list[str]]:
    """
    Sépare les amis à scanner de ceux dont le scan est encore frais.

    Retourne ``(to_scan, fresh)`` :

    - ``to_scan`` : amis jamais scannés, scannés avec une boîte différente,
      ou scannés depuis plus de ``max_age_hours`` ;
    - ``fresh`` : amis dont le scan est récent et dont la boîte n'a pas
      changé — on peut les skip.

    Pour les amis « frais » avec ``found_count == 0``, on sait déjà qu'ils
    n'ont rien trouvé : aucun intérêt à les re-scanner.
    """
    from datetime import timedelta
    from ..models import FriendZoneScan

    now = datetime.now(timezone.utc)
    threshold = now - timedelta(hours=max_age_hours)
    box_sig = box.box_param

    existing = {
        row.friend_username: row
        for row in FriendZoneScan.query.filter_by(zone_id=zone_id).all()
    }

    to_scan: list[str] = []
    fresh: list[str] = []

    for friend in friends:
        row = existing.get(friend)
        if row is None:
            to_scan.append(friend)
        elif row.box_signature != box_sig:
            # La boîte a changé : le scan est obsolète.
            to_scan.append(friend)
        elif row.scanned_at is not None and _is_after(row.scanned_at, threshold):
            fresh.append(friend)
        else:
            to_scan.append(friend)

    return to_scan, fresh


# ---------------------------------------------------------- Suggestions

def query_suggestions(
    zone_id: Optional[int] = None,
    min_friends: int = 1,
    limit: int = 50,
    include_found: bool = False,
) -> list[dict]:
    """
    Caches trouvées par ≥ ``min_friends`` amis mais **pas (encore) par moi**.

    Croisement naturel de ``friend_find`` et ``Geocache`` : on regroupe les
    trouvailles d'amis par code GC, on joint les caches importées pour récupérer
    nom, type, D/T et le drapeau ``found``, et on exclut celles que j'ai déjà
    trouvées (sauf si ``include_found=True``).

    Args:
        zone_id: restreint aux caches d'une zone donnée. Si ``None``, toutes
            zones confondues.
        min_friends: nombre minimum d'amis distincts ayant trouvé la cache.
        limit: nombre maximum de suggestions (1-200).
        include_found: inclure les caches déjà trouvées par moi (utile pour
            « mes amis ont aussi trouvé ce que j'ai trouvé »).

    Retourne une liste triée par nombre d'amis décroissant, puis par nom. Chaque
    entrée contient les métadonnées de la cache et la liste des amis.
    """
    from ..database import db
    from ..geocaches.models import Geocache
    from ..models import FriendFind

    limit = max(1, min(limit, 200))

    # Jointure friend_find ↔ Geocache (LEFT JOIN : une cache trouvée par un ami
    # n'est pas forcément importée dans GeoApp).
    query = db.session.query(
        FriendFind.gc_code,
        FriendFind.friend_username,
        FriendFind.latitude,
        FriendFind.longitude,
        FriendFind.cache_name,
        FriendFind.cache_type,
        Geocache.id,
        Geocache.name,
        Geocache.type,
        Geocache.difficulty,
        Geocache.terrain,
        Geocache.latitude,
        Geocache.longitude,
        Geocache.found,
        Geocache.zone_id,
        Geocache.status,
        Geocache.favorites_count,
    ).outerjoin(
        Geocache, Geocache.gc_code == FriendFind.gc_code
    )

    if zone_id is not None:
        query = query.filter(Geocache.zone_id == zone_id)

    if not include_found:
        # Pas trouvée par moi : found IS NULL ou found = False.
        query = query.filter(db.or_(Geocache.found.is_(False), Geocache.found.is_(None)))

    rows = query.all()

    # Regroupement par gc_code
    by_code: dict[str, dict] = {}
    for row in rows:
        gc_code = row[0]
        entry = by_code.get(gc_code)
        if entry is None:
            geocache_id = row[6]
            latitude = row[11] if row[11] is not None else row[2]
            longitude = row[12] if row[12] is not None else row[3]
            entry = {
                'gc_code': gc_code,
                'name': (row[7] if row[7] else row[4]) or gc_code,
                'cache_type': (row[8] if row[8] else row[5]),
                'latitude': latitude,
                'longitude': longitude,
                'difficulty': row[9],
                'terrain': row[10],
                'geocache_id': geocache_id if geocache_id else 0,
                'found': bool(row[13]) if row[13] else False,
                'zone_id': row[14],
                'status': row[15],
                'favorites_count': row[16] or 0,
                'friends': set(),
            }
            by_code[gc_code] = entry
        entry['friends'].add(row[1])

    # Filtrage par min_friends + tri
    suggestions = []
    for entry in by_code.values():
        entry['friends_count'] = len(entry['friends'])
        if entry['friends_count'] < min_friends:
            continue
        entry['friends'] = sorted(entry['friends'], key=str.casefold)
        suggestions.append(entry)

    suggestions.sort(key=lambda s: (-s['friends_count'], s['name'].casefold()))
    return suggestions[:limit]


# ---------------------------------------------------------- Statistiques croisées

def query_friend_stats() -> dict:
    """
    Statistiques croisées sur les amis.

    Croise trois sources pour chaque ami :

    - **``friend_find``** : nombre de trouvailles connues (déduction par zone,
      flux d'activité, logs de cache) ;
    - **``FriendActivity``** : nombre de logs capturés dans le flux d'activité
      récent (tous types confondus) ;
    - **``Geocache.found``** : nombre de caches que j'ai trouvées et que cet ami
      a aussi trouvées (« en commun avec moi »).

    Retourne un dict avec :

    - ``friends`` : liste triée par nombre de trouvailles décroissant, chaque
      entrée contenant ``username``, ``finds_count``, ``activity_count`` et
      ``shared_with_me`` ;
    - ``summary`` : totaux globaux (nombre d'amis, total de trouvailles
      distinctes, total de caches en commun, ami le plus actif).
    """
    from ..database import db
    from ..geocaches.models import Geocache
    from ..models import FriendFind, FriendActivity

    # 1. Trouvailles par ami (friend_find)
    finds_rows = (
        db.session.query(
            FriendFind.friend_username,
            db.func.count(FriendFind.id),
        )
        .group_by(FriendFind.friend_username)
        .all()
    )
    finds_by_friend: dict[str, int] = {username: count for username, count in finds_rows}

    # 2. Logs du flux d'activité par ami (excluant mes propres logs)
    activity_rows = (
        db.session.query(
            FriendActivity.author_username,
            db.func.count(FriendActivity.id),
        )
        .filter(FriendActivity.activity_type == 2)  # ACTIVITY_TYPE_FRIENDS
        .filter(db.or_(FriendActivity.is_self.is_(False), FriendActivity.is_self.is_(None)))
        .group_by(FriendActivity.author_username)
        .all()
    )
    activity_by_friend: dict[str, int] = {username: count for username, count in activity_rows}

    # 3. Caches en commun : caches que j'ai trouvées (Geocache.found=True) et
    #    que cet ami a aussi trouvées (FriendFind).
    my_found_codes = {
        code for (code,) in db.session.query(Geocache.gc_code).filter(Geocache.found.is_(True)).all()
    }
    shared_by_friend: dict[str, int] = {}
    if my_found_codes:
        shared_rows = (
            db.session.query(
                FriendFind.friend_username,
                db.func.count(db.distinct(FriendFind.gc_code)),
            )
            .filter(FriendFind.gc_code.in_(my_found_codes))
            .group_by(FriendFind.friend_username)
            .all()
        )
        shared_by_friend = {username: count for username, count in shared_rows}

    # 4. Fusion des trois sources : un ami peut apparaître dans l'une sans les autres.
    all_friends = set(finds_by_friend) | set(activity_by_friend) | set(shared_by_friend)

    friends = []
    for username in all_friends:
        friends.append({
            'username': username,
            'finds_count': finds_by_friend.get(username, 0),
            'activity_count': activity_by_friend.get(username, 0),
            'shared_with_me': shared_by_friend.get(username, 0),
        })

    friends.sort(key=lambda f: (-f['finds_count'], f['username'].casefold()))

    # 5. Résumé global
    total_distinct_finds = (
        db.session.query(db.func.count(db.distinct(FriendFind.gc_code))).scalar() or 0
    )
    total_shared = sum(f['shared_with_me'] for f in friends)
    most_active = friends[0]['username'] if friends else None

    return {
        'friends': friends,
        'summary': {
            'friends_count': len(friends),
            'total_distinct_finds': total_distinct_finds,
            'total_shared_with_me': total_shared,
            'most_active_friend': most_active,
        },
    }


# ---------------------------------------------------------- Tableau de bord fraîcheur

def query_freshness() -> dict:
    """
    État de fraîcheur de toutes les sources de données « amis ».

    Rassemble en une seule lecture (sans réseau) les timestamps et compteurs
    clés pour que l'utilisateur puisse repérer d'un coup d'œil si ses données
    sont à jour ou si une synchro est nécessaire.

    Sources interrogées :

    - **Flux d'activité** : dernière synchro (``LAST_SYNC_KEY``), dernière
      projection de trouvailles (``LAST_PROJECTION_KEY``), nombre de logs
      stockés, nombre d'amis distincts dans le flux, date du log le plus récent ;
    - **Trouvailles déduites** (``friend_find``) : nombre de lignes, nombre de
      caches distinctes, nombre d'amis distincts ;
    - **Liste d'amis** : dernière récupération (cache mémoire), nombre d'amis,
      troncature de la pagination ;
    - **Géocaches** : total importé, nombre trouvées, nombre dans la zone
      « Amis ».
    """
    from ..database import db
    from ..geocaches.models import Geocache
    from ..models import AppConfig, FriendActivity, FriendFind
    from . import friend_activity_store
    from .geocaching_friends import get_friends_client

    now = datetime.now(timezone.utc)

    # --- Flux d'activité ---
    last_sync_str = friend_activity_store.get_last_sync_at()
    last_sync = _parse_iso_config(last_sync_str)
    last_projection_str = AppConfig.get_value(friend_activity_store.LAST_PROJECTION_KEY)
    last_projection = _parse_iso_config(last_projection_str)

    activity_count = db.session.query(db.func.count(FriendActivity.id)).scalar() or 0
    activity_authors = (
        db.session.query(db.func.count(db.distinct(FriendActivity.author_username)))
        .filter(FriendActivity.activity_type == 2)
        .scalar() or 0
    )
    latest_log = (
        db.session.query(db.func.max(FriendActivity.log_date))
        .filter(FriendActivity.activity_type == 2)
        .scalar()
    )

    # --- Trouvailles déduites ---
    finds_count = db.session.query(db.func.count(FriendFind.id)).scalar() or 0
    finds_distinct_caches = (
        db.session.query(db.func.count(db.distinct(FriendFind.gc_code))).scalar() or 0
    )
    finds_distinct_friends = (
        db.session.query(db.func.count(db.distinct(FriendFind.friend_username))).scalar() or 0
    )

    # --- Liste d'amis (cache mémoire, pas de réseau) ---
    friends_fetched_at: str | None = None
    friends_count: int = 0
    friends_reported_count: int | None = None
    friends_truncated: bool = False
    friends_pages_fetched: int = 1
    try:
        result = get_friends_client().get_friends()
        friends_fetched_at = result.fetched_at.isoformat() if result.fetched_at else None
        friends_count = len(result.friends)
        friends_reported_count = result.reported_count
        friends_truncated = result.truncated
        friends_pages_fetched = result.pages_fetched
    except Exception:
        # Pas connecté ou cache vide : on ne bloque pas le tableau de bord.
        pass

    # --- Géocaches ---
    geocaches_total = db.session.query(db.func.count(Geocache.id)).scalar() or 0
    geocaches_found = db.session.query(db.func.count(Geocache.id)).filter(Geocache.found.is_(True)).scalar() or 0
    friends_zone = get_or_create_friends_zone()
    geocaches_in_friends_zone = (
        db.session.query(db.func.count(Geocache.id))
        .filter(Geocache.zone_id == friends_zone.id)
        .scalar() or 0
    )

    # --- Indicateurs de staleness ---
    activity_stale = _is_stale(last_sync, now, hours=1)
    finds_stale = _is_stale(last_projection, now, hours=1)

    return {
        'checked_at': now.isoformat(),
        'activity': {
            'last_sync_at': last_sync_str,
            'last_projection_at': last_projection_str,
            'logs_stored': activity_count,
            'authors_in_feed': activity_authors,
            'latest_log_date': latest_log.isoformat() if latest_log else None,
            'is_stale': activity_stale,
        },
        'finds': {
            'total_rows': finds_count,
            'distinct_caches': finds_distinct_caches,
            'distinct_friends': finds_distinct_friends,
            'is_stale': finds_stale,
        },
        'friends_list': {
            'fetched_at': friends_fetched_at,
            'count': friends_count,
            'reported_count': friends_reported_count,
            'truncated': friends_truncated,
            'pages_fetched': friends_pages_fetched,
        },
        'geocaches': {
            'total': geocaches_total,
            'found': geocaches_found,
            'in_friends_zone': geocaches_in_friends_zone,
        },
    }


def _parse_iso_config(value: str | None) -> datetime | None:
    """Parse une valeur ISO stockée dans AppConfig, tolérant aux None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _is_stale(last: datetime | None, now: datetime, hours: int = 1) -> bool:
    """True si ``last`` est None ou plus ancien que ``hours`` heures."""
    if last is None:
        return True
    return (now - last).total_seconds() >= hours * 3600


# ---------------------------------------------------------- Notifications

NOTIFICATIONS_SEEN_KEY = 'friends.notifications.last_seen_at'


def query_notifications(min_friends: int = 1, limit: int = 50) -> dict:
    """
    Notifications de nouvelles trouvailles d'amis depuis la dernière visite.

    Compare le timestamp ``NOTIFICATIONS_SEEN_KEY`` (dernière fois que
    l'utilisateur a vu les notifications) avec les ``first_seen_at`` des lignes
    de ``friend_find``. Les trouvailles plus récentes que ce timestamp sont
    « non lues » et agrégées par cache.

    Au premier appel (pas de timestamp), toutes les trouvailles sont considérées
    comme nouvelles — mais le frontend ne montre le badge qu'après la première
    visite, donc le timestamp est posé immédiatement par ``mark_notifications_seen``.

    Retourne un dict avec :

    - ``items`` : liste de notifications (par cache), triées par nombre d'amis
      décroissant puis par date ;
    - ``count`` : nombre de notifications (caches distinctes) ;
    - ``total_new_finds`` : nombre total de nouvelles lignes ``friend_find`` ;
    - ``last_seen_at`` : timestamp de la dernière visite.
    """
    from ..database import db
    from ..geocaches.models import Geocache
    from ..models import AppConfig, FriendFind

    last_seen_str = AppConfig.get_value(NOTIFICATIONS_SEEN_KEY)
    last_seen = _parse_iso_config(last_seen_str)

    query = (
        db.session.query(
            FriendFind.gc_code,          # 0
            FriendFind.friend_username,  # 1
            FriendFind.first_seen_at,    # 2
            FriendFind.cache_name,       # 3
            FriendFind.cache_type,       # 4
            FriendFind.latitude,         # 5
            FriendFind.longitude,        # 6
            Geocache.id,                 # 7
            Geocache.name,               # 8
            Geocache.type,               # 9
            Geocache.difficulty,         # 10
            Geocache.terrain,            # 11
            Geocache.latitude,           # 12
            Geocache.longitude,          # 13
            Geocache.found,              # 14
            Geocache.zone_id,            # 15
            Geocache.status,             # 16
            Geocache.favorites_count,    # 17
        )
        .outerjoin(Geocache, FriendFind.gc_code == Geocache.gc_code)
    )

    if last_seen is not None:
        query = query.filter(FriendFind.first_seen_at > last_seen)

    rows = query.all()

    # Regroupement par gc_code
    by_code: dict[str, dict] = {}
    total_new_finds = 0
    for row in rows:
        gc_code = row[0]
        entry = by_code.get(gc_code)
        if entry is None:
            geocache_id = row[7]
            entry = {
                'gc_code': gc_code,
                'name': (row[8] if row[8] else row[3]) or gc_code,
                'cache_type': (row[9] if row[9] else row[4]),
                'latitude': row[12] if row[12] is not None else row[5],
                'longitude': row[13] if row[13] is not None else row[6],
                'difficulty': row[10],
                'terrain': row[11],
                'geocache_id': geocache_id if geocache_id else 0,
                'found': bool(row[14]) if row[14] else False,
                'zone_id': row[15],
                'status': row[16],
                'favorites_count': row[17] or 0,
                'friends': set(),
                'first_seen_at': row[2],
            }
            by_code[gc_code] = entry
        entry['friends'].add(row[1])
        total_new_finds += 1

    # Filtrage par min_friends et tri
    items = []
    for entry in by_code.values():
        entry['friends'] = sorted(entry['friends'], key=str.casefold)
        entry['friends_count'] = len(entry['friends'])
        if entry['friends_count'] >= min_friends:
            items.append(entry)

    items.sort(key=lambda s: (-s['friends_count'], s['name'].casefold()))
    items = items[:limit]

    return {
        'items': items,
        'count': len(items),
        'total_new_finds': total_new_finds,
        'last_seen_at': last_seen_str,
    }


def mark_notifications_seen() -> str:
    """Marque toutes les notifications actuelles comme lues. Retourne le timestamp."""
    from ..database import db
    from ..models import AppConfig

    now = datetime.now(timezone.utc).isoformat()
    AppConfig.set_value(NOTIFICATIONS_SEEN_KEY, now)
    db.session.commit()
    return now




