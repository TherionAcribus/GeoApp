"""
Client Geocaching.com pour les trackables (Travel Bugs, geocoins…).

Les échanges reprennent ceux de c:geo (`GCWebAPI`, `GCLogAPI`, `GCParser`),
vérifiés en réel le 2026-09-29 :

- mon inventaire : ``GET /api/proxy/trackables?inCollection=false&inInventory=true&take&skip``
  → liste JSON, avec le code de suivi (`trackingNumber`) de chaque TB ;
- les TBs d'une cache : ``GET /api/proxy/web/v1/trackables/geocache/{GC}?take&skip``
  → ``{total, data: [...]}``, sans code de suivi ;
- un TB : ``GET /api/proxy/web/v1/trackables/{TB}`` → propriétaire, cache courante ;
- la page de log d'un TB : ``GET /live/trackable/{TB}/log`` → JSON Next.js
  (``__NEXT_DATA__``) avec les types de log autorisés et la cache courante ;
- la fiche HTML : ``GET /track/details.aspx?tracker={TB ou code de suivi}`` → objectif,
  origine, localisation et logs de la première page. C'est aussi le seul moyen de
  retrouver un TB à partir de son code de suivi.

c:geo passe les appels `/api/proxy` avec un jeton bearer (`/account/oauth/token`) ;
les cookies de session suffisent ici, comme pour le flux des amis.

Le code de suivi est secret (il permet de loguer le TB) : il n'est jamais écrit dans
les logs applicatifs et `to_dict()` ne l'expose que sur demande explicite.

Ce module ne fait que le réseau et le parsing : aucune écriture en base.
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Optional

import requests

from .geocaching_auth import get_auth_service
from .geocaching_friends import NotAuthenticatedError
from .html_sanitize import clean_remote_url, sanitize_html_fragment

logger = logging.getLogger(__name__)

WEBSITE_URL = 'https://www.geocaching.com'
MY_INVENTORY_URL = f'{WEBSITE_URL}/api/proxy/trackables'
CACHE_INVENTORY_URL = f'{WEBSITE_URL}/api/proxy/web/v1/trackables/geocache/{{gc_code}}'
TRACKABLE_URL = f'{WEBSITE_URL}/api/proxy/web/v1/trackables/{{tb_code}}'
TRACKABLE_LOG_PAGE_URL = f'{WEBSITE_URL}/live/trackable/{{tb_code}}/log'
TRACKABLE_DETAILS_URL = f'{WEBSITE_URL}/track/details.aspx'

# Taille de page de c:geo (`GCWebAPI.MAX_TAKE`).
PAGE_SIZE = 1000
# Garde-fou contre une pagination qui ne s'arrêterait pas (réponse identique en boucle).
MAX_PAGES = 20


class TrackableLogType:
    """Identifiants des types de log trackable (`gcApiId` de `LogTypeTrackable` chez c:geo)."""
    NOTE = 4
    ARCHIVED = 5
    RETRIEVED = 13
    DROPPED_OFF = 14
    TRANSFER = 15
    MARK_MISSING = 16
    GRABBED = 19
    DISCOVERED = 48
    MOVE_TO_COLLECTION = 69
    MOVE_TO_INVENTORY = 70
    VISITED = 75


TRACKABLE_LOG_TYPE_LABELS: dict[int, str] = {
    TrackableLogType.NOTE: 'Note',
    TrackableLogType.ARCHIVED: 'Archivé',
    TrackableLogType.RETRIEVED: 'Retiré de la cache',
    TrackableLogType.DROPPED_OFF: 'Déposé',
    TrackableLogType.TRANSFER: 'Transféré',
    TrackableLogType.MARK_MISSING: 'Marqué manquant',
    TrackableLogType.GRABBED: 'Pris ailleurs',
    TrackableLogType.DISCOVERED: 'Découvert',
    TrackableLogType.MOVE_TO_COLLECTION: 'Déplacé vers la collection',
    TrackableLogType.MOVE_TO_INVENTORY: "Déplacé vers l'inventaire",
    TrackableLogType.VISITED: 'Visité',
}

# Types possibles pour un TB de mon inventaire au moment d'un log de cache
# (`getLogTypesAllowedForInventory` chez c:geo). « Ne rien faire » n'a pas d'id :
# le TB n'est simplement pas envoyé.
CACHE_LOG_TRACKABLE_ACTIONS: dict[str, int] = {
    'visit': TrackableLogType.VISITED,
    'drop': TrackableLogType.DROPPED_OFF,
}

# Code public : TB suivi de caractères sans I, L, O, S, U (`TravelBugConnector`).
TB_CODE_RE = re.compile(r'^TB[0-9A-HJKMNPQRTV-Z]+$')


class TrackableError(RuntimeError):
    """Erreur de dialogue avec Geocaching.com sur un trackable."""


class TrackableNotFoundError(TrackableError):
    """Code inconnu de Geocaching.com (ni code public, ni code de suivi)."""


def normalize_code(code: Any) -> str:
    return str(code or '').strip().upper()


def is_public_code(code: Any) -> bool:
    return bool(TB_CODE_RE.match(normalize_code(code)))


# ------------------------------------------------------------------ Modèles

@dataclass
class TrackableSummary:
    """Un trackable tel que le décrivent les API JSON (inventaire, cache, fiche)."""
    reference_code: str
    name: str | None = None
    icon_url: str | None = None
    tracking_code: str | None = None
    type_id: int | None = None
    type_name: str | None = None
    owner_username: str | None = None
    owner_reference_code: str | None = None
    holder_username: str | None = None
    current_geocache_code: str | None = None
    current_geocache_name: str | None = None
    # Tri-état de la localisation : `location_known` distingue « la source ne dit
    # rien » (False : la fusion ne touche pas à la localisation connue) de « la
    # source affirme » (True : `current_geocache_code = None` veut alors dire
    # « plus dans une cache »). Vrai quand le JSON porte la clé `currentGeocache`,
    # ou quand le type de relevé affirme la position (inventaire d'une cache).
    location_known: bool = False
    goal_html: str | None = None
    released_at: str | None = None
    origin: str | None = None
    distance_km: float | None = None
    is_missing: bool = False
    is_active: bool = True
    is_locked: bool = False
    allowed_to_be_collected: bool = False

    def to_dict(self, *, include_tracking_code: bool = False) -> dict:
        data = asdict(self)
        if not include_tracking_code:
            data.pop('tracking_code', None)
        return data


@dataclass
class TrackableLogPageInfo:
    """Ce que la page de log d'un TB apprend : types autorisés et cache courante."""
    reference_code: str
    allowed_log_type_ids: list[int] = field(default_factory=list)
    current_geocache_code: str | None = None
    current_geocache_name: str | None = None
    name: str | None = None
    owner_username: str | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data['allowed_log_types'] = [
            {'id': type_id, 'label': TRACKABLE_LOG_TYPE_LABELS.get(type_id)}
            for type_id in self.allowed_log_type_ids
        ]
        return data


@dataclass
class TrackableLogEntry:
    """Un log de la fiche HTML d'un TB."""
    log_reference_code: str | None
    log_type_id: int | None
    log_type_label: str | None
    log_date: str | None      # ISO (YYYY-MM-DD), None si la date n'a pas pu être lue
    log_date_raw: str | None  # telle qu'affichée, au format de date du compte
    author_username: str | None
    author_guid: str | None
    geocache_code: str | None
    geocache_name: str | None
    text_html: str | None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TrackableDetails:
    """La fiche HTML d'un TB : ce que les API JSON ne donnent pas."""
    reference_code: str
    name: str | None = None
    owner_username: str | None = None
    owner_guid: str | None = None
    released_at: str | None = None
    origin: str | None = None
    location_kind: str | None = None   # 'cache', 'user', 'owner', 'unknown'
    location_name: str | None = None
    location_geocache_code: str | None = None
    goal_html: str | None = None
    details_html: str | None = None
    image_url: str | None = None
    icon_url: str | None = None
    type_name: str | None = None
    distance_km: float | None = None
    is_locked: bool = False
    logs: list[TrackableLogEntry] = field(default_factory=list)

    def to_dict(self) -> dict:
        data = asdict(self)
        data['logs'] = [log.to_dict() for log in self.logs]
        return data


# ------------------------------------------------------------------- Client

class GeocachingTrackablesClient:
    """Client HTTP des trackables. Sans état, sans cache : le cache, c'est la base."""

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self._explicit_session = session

    @property
    def session(self) -> requests.Session:
        if self._explicit_session is not None:
            return self._explicit_session
        return get_auth_service().get_session()

    # ------------------------------------------------------------ Inventaires

    def fetch_my_inventory(self) -> list[TrackableSummary]:
        """Les TBs que j'ai en main (hors collection), avec leur code de suivi."""
        items: list[TrackableSummary] = []
        for page in range(MAX_PAGES):
            payload = self._get_json(
                MY_INVENTORY_URL,
                params={
                    'inCollection': 'false',
                    'inInventory': 'true',
                    'take': PAGE_SIZE,
                    'skip': page * PAGE_SIZE,
                },
                what="l'inventaire",
            )
            if not isinstance(payload, list):
                raise TrackableError("Format de réponse inattendu pour l'inventaire des trackables")
            items.extend(s for s in (self.parse_summary(raw) for raw in payload) if s)
            if len(payload) < PAGE_SIZE:
                break
        return items

    def fetch_cache_inventory(self, gc_code: str) -> list[TrackableSummary]:
        """Les TBs actuellement déclarés dans une cache."""
        gc_code = normalize_code(gc_code)
        url = CACHE_INVENTORY_URL.format(gc_code=gc_code)
        items: list[TrackableSummary] = []
        for page in range(MAX_PAGES):
            payload = self._get_json(
                url,
                params={'take': PAGE_SIZE, 'skip': page * PAGE_SIZE},
                what=f"l'inventaire de {gc_code}",
            )
            if not isinstance(payload, dict):
                raise TrackableError(f"Format de réponse inattendu pour l'inventaire de {gc_code}")
            data = payload.get('data') or []
            items.extend(s for s in (self.parse_summary(raw) for raw in data) if s)
            if len(data) < PAGE_SIZE:
                break
        return items

    # --------------------------------------------------------------- Un TB

    def fetch_trackable(self, tb_code: str) -> TrackableSummary:
        """Les informations JSON d'un TB, par son code public."""
        tb_code = normalize_code(tb_code)
        payload = self._get_json(
            TRACKABLE_URL.format(tb_code=tb_code),
            what=f'le trackable {tb_code}',
            not_found_message=f'Trackable {tb_code} introuvable sur Geocaching.com.',
        )
        summary = self.parse_summary(payload)
        if summary is None:
            raise TrackableError(f'Format de réponse inattendu pour le trackable {tb_code}')
        return summary

    def lookup(self, code: str) -> TrackableSummary:
        """
        Retrouve un TB à partir de son code public **ou** de son code de suivi.

        `details.aspx?tracker=` accepte les deux : on lit le code public sur la fiche.
        S'il diffère du code saisi, c'est que le code saisi était le code de suivi, que
        l'on garde dans le résultat (il faudra le renvoyer pour loguer le TB).
        """
        code = normalize_code(code)
        if not code:
            raise TrackableNotFoundError('Code de trackable vide.')
        page = self._get_details_page(code)
        reference_code = self._search(r'CoordInfoCode">(TB[0-9A-Z]+)<', page)
        if not reference_code:
            # Le code saisi peut être un code de suivi : il ne sort pas dans l'erreur.
            if is_public_code(code):
                raise TrackableNotFoundError(f'Trackable {code} introuvable sur Geocaching.com.')
            raise TrackableNotFoundError('Aucun trackable ne correspond à ce code.')

        summary = self.fetch_trackable(reference_code)
        if reference_code != code:
            summary.tracking_code = code
        return summary

    def fetch_log_page_info(self, tb_code: str) -> TrackableLogPageInfo:
        """Types de log autorisés et cache courante, lus sur la page de log du TB."""
        tb_code = normalize_code(tb_code)
        response = self._request(TRACKABLE_LOG_PAGE_URL.format(tb_code=tb_code), what=f'la page de log de {tb_code}')
        return self.parse_log_page(tb_code, response.text)

    def fetch_details(self, tb_code: str) -> TrackableDetails:
        """La fiche HTML d'un TB : objectif, origine, localisation, logs de la première page."""
        tb_code = normalize_code(tb_code)
        page = self._get_details_page(tb_code)
        details = self.parse_details_page(page)
        if details is None:
            raise TrackableNotFoundError(f'Trackable {tb_code} introuvable sur Geocaching.com.')
        return details

    # ---------------------------------------------------------------- Réseau

    def _request(self, url: str, *, what: str, params: Optional[dict] = None,
                 headers: Optional[dict] = None, not_found_message: Optional[str] = None) -> requests.Response:
        try:
            response = self.session.get(url, params=params, headers=headers, timeout=60)
        except requests.RequestException as exc:
            # Une exception `requests` cite l'URL appelée, query string comprise ;
            # pour `details.aspx?tracker=` elle contiendrait le code de suivi.
            raise TrackableError(
                f'Erreur réseau vers geocaching.com pour {what} '
                f'({type(exc).__name__} : {_sanitize_request_error(exc)})'
            ) from exc

        if response.status_code in (401, 403):
            raise NotAuthenticatedError(
                f'Session Geocaching.com refusée pour {what} : reconnectez-vous.'
            )
        if response.status_code == 404 and not_found_message:
            raise TrackableNotFoundError(not_found_message)
        if response.status_code == 429:
            raise TrackableError('Geocaching.com limite les requêtes (HTTP 429) : réessayez dans un moment.')
        if response.status_code != 200:
            raise TrackableError(
                f'Réponse inattendue de geocaching.com pour {what} (HTTP {response.status_code})'
            )
        return response

    def _get_json(self, url: str, *, what: str, params: Optional[dict] = None,
                  not_found_message: Optional[str] = None) -> Any:
        response = self._request(
            url, what=what, params=params,
            headers={'Accept': 'application/json'},
            not_found_message=not_found_message,
        )
        try:
            return response.json()
        except ValueError as exc:
            raise TrackableError(f'Réponse non-JSON de geocaching.com pour {what}') from exc

    def _get_details_page(self, code: str) -> str:
        # Le code (éventuellement de suivi) n'apparaît pas dans le message d'erreur.
        return self._request(TRACKABLE_DETAILS_URL, params={'tracker': code}, what='la fiche du trackable').text

    # --------------------------------------------------------------- Parsing

    @staticmethod
    def parse_summary(raw: Any) -> Optional[TrackableSummary]:
        """Un élément des API JSON (inventaire, inventaire de cache, fiche)."""
        if not isinstance(raw, dict):
            return None
        reference_code = normalize_code(raw.get('referenceCode'))
        if not reference_code:
            return None

        owner = raw.get('owner') if isinstance(raw.get('owner'), dict) else {}
        holder = raw.get('holder') if isinstance(raw.get('holder'), dict) else {}
        # La clé `currentGeocache` seule est informative : présente à `null`, elle
        # affirme « plus dans une cache » ; absente, la source ne sait pas.
        location_known = 'currentGeocache' in raw
        current = raw.get('currentGeocache') if isinstance(raw.get('currentGeocache'), dict) else {}
        released = raw.get('locationReleased') if isinstance(raw.get('locationReleased'), dict) else {}

        # `trackableType` est un objet dans l'inventaire, un simple id sur la fiche.
        type_raw = raw.get('trackableType')
        if isinstance(type_raw, dict):
            type_id, type_name = _as_int(type_raw.get('id')), _as_str(type_raw.get('name'))
        else:
            type_id, type_name = _as_int(type_raw), None

        date_released = _as_str(raw.get('dateReleased'))
        if date_released and date_released.startswith('0001-'):
            date_released = None

        origin = ', '.join(p for p in (_as_str(released.get('state')), _as_str(released.get('country'))) if p)

        distance = raw.get('distanceTraveledInKilometers')
        return TrackableSummary(
            reference_code=reference_code,
            name=_as_str(raw.get('name')),
            tracking_code=_as_str(raw.get('trackingNumber')),
            type_id=type_id,
            type_name=type_name,
            owner_username=_as_str(owner.get('userName')),
            owner_reference_code=_as_str(owner.get('code')),
            holder_username=_as_str(holder.get('userName')),
            current_geocache_code=_as_str(current.get('referenceCode')),
            current_geocache_name=_as_str(current.get('name')),
            location_known=location_known,
            # HTML d'utilisateurs tiers : assaini à l'entrée, la base ne stocke
            # jamais de markup actif (contrat de rendu, cf. html_sanitize.py).
            goal_html=sanitize_html_fragment(_as_str(raw.get('currentGoal'))),
            icon_url=clean_remote_url(_as_str(raw.get('iconUrl'))),
            released_at=date_released,
            origin=origin or None,
            distance_km=round(float(distance), 1) if isinstance(distance, (int, float)) else None,
            is_missing=bool(raw.get('isMissing')),
            is_active=raw.get('isActive') is not False,
            is_locked=bool(raw.get('isLocked')),
            allowed_to_be_collected=bool(raw.get('allowedToBeCollected')),
        )

    @classmethod
    def parse_log_page(cls, tb_code: str, page: str) -> TrackableLogPageInfo:
        """
        Page ``/live/trackable/{TB}/log`` : on lit d'abord le JSON Next.js, et à défaut
        les deux motifs de c:geo (`"logTypes":[...]`, `"currentGeocache":{...}`).
        """
        info = TrackableLogPageInfo(reference_code=normalize_code(tb_code))
        props = cls._next_page_props(page)
        if props is not None:
            info.allowed_log_type_ids = [
                type_id for type_id in (
                    _as_int(entry.get('value')) for entry in (props.get('logTypes') or [])
                    if isinstance(entry, dict)
                ) if type_id is not None
            ]
            loggable = props.get('loggable') if isinstance(props.get('loggable'), dict) else {}
            current = loggable.get('currentGeocache') if isinstance(loggable.get('currentGeocache'), dict) else {}
            owner = loggable.get('owner') if isinstance(loggable.get('owner'), dict) else {}
            info.current_geocache_code = _as_str(current.get('referenceCode'))
            info.current_geocache_name = _as_str(current.get('name'))
            info.name = _as_str(loggable.get('name'))
            info.owner_username = _as_str(owner.get('userName'))
            return info

        types = cls._search(r'"logTypes":\[([^\]]*)\]', page)
        if types:
            info.allowed_log_type_ids = [int(v) for v in re.findall(r'"value":\s*(\d+)', types)]
        current = cls._search(r'"currentGeocache":(\{[^}]+\})', page)
        if current:
            try:
                data = json.loads(current)
            except ValueError:
                data = {}
            info.current_geocache_code = _as_str(data.get('referenceCode'))
            info.current_geocache_name = _as_str(data.get('name'))
        return info

    @staticmethod
    def _next_page_props(page: str) -> Optional[dict]:
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
        if not match:
            return None
        try:
            data = json.loads(match.group(1))
        except ValueError:
            return None
        props = (data.get('props') or {}).get('pageProps') if isinstance(data, dict) else None
        return props if isinstance(props, dict) else None

    @classmethod
    def parse_details_page(cls, page: str) -> Optional[TrackableDetails]:
        """Fiche ``track/details.aspx`` (motifs `PATTERN_TRACKABLE_*` de c:geo). None si pas de TB."""
        reference_code = cls._search(r'CoordInfoCode">(TB[0-9A-Z]+)<', page)
        if not reference_code:
            return None

        details = TrackableDetails(reference_code=reference_code)
        details.name = _text(cls._search(r'<span id="ctl00_ContentBody_lbHeading">(.*?)</span>', page))

        owner = re.search(
            r'<a id="ctl00_ContentBody_BugDetails_BugOwner"[^>]*href="[^"]*guid=([^"&]*)"[^>]*>(.*?)</a>', page, re.S
        )
        if owner:
            details.owner_guid = owner.group(1)
            details.owner_username = _text(owner.group(2))

        details.released_at = _text(cls._search(r'<span id="ctl00_ContentBody_BugDetails_BugReleaseDate">([^<]+)</span>', page))
        details.origin = _text(cls._search(r'<span id="ctl00_ContentBody_BugDetails_BugOrigin">([^<]+)</span>', page))

        location = re.search(r'<a id="ctl00_ContentBody_BugDetails_BugLocation"([^>]*)>(.*?)</a>', page, re.S)
        if location:
            attrs = location.group(1)
            status = cls._search(r'data-status="([^"]+)"', attrs)
            details.location_kind = status.lower() if status else None
            details.location_name = _text(cls._search(r'data-name="([^"]*)"', attrs)) or _text(location.group(2))
            details.location_geocache_code = cls._search(r'href="[^"]*/geocache/(GC[0-9A-Z]+)"', attrs)

        # HTML d'utilisateurs tiers : assaini à l'entrée (contrat de rendu sûr).
        details.goal_html = sanitize_html_fragment(
            _inner_html(cls._search(r'<div id="TrackableGoal">(.*?)</div>', page, re.S)))
        details.details_html = sanitize_html_fragment(
            _inner_html(cls._search(r'<div id="TrackableDetails">(.*?)</div>', page, re.S)))
        details.image_url = clean_remote_url(
            cls._search(r'<img id="ctl00_ContentBody_BugDetails_BugImage"[^>]*src="([^"]+)"', page))

        icon = re.search(r'<img id="ctl00_ContentBody_BugTypeImage"[^>]*>', page)
        if icon:
            details.icon_url = clean_remote_url(cls._search(r'src="([^"]+)"', icon.group(0)))
            details.type_name = _text(cls._search(r'alt="([^"]+)"', icon.group(0)))

        distance = re.search(r'\(([0-9.,]+)\s*(km|mi)[^)]*\)\s*<a href="map_gm', page)
        if distance:
            value = float(distance.group(1).replace(',', ''))
            details.distance_km = round(value * 1.609344 if distance.group(2) == 'mi' else value, 1)

        details.is_locked = bool(re.search(r'<a id="ctl00_ContentBody_LogLink"[^(]*\(locked\)</a>', page))
        details.logs = cls.parse_details_logs(page)
        return details

    @classmethod
    def parse_details_logs(cls, page: str) -> list[TrackableLogEntry]:
        """
        Logs de la fiche : chaque log est une paire de lignes de tableau
        (``Data BorderTop`` pour l'en-tête, ``Data BorderBottom`` pour le texte).
        """
        rows = re.findall(
            r'<tr class="Data BorderTop[^"]*">(.*?)</tr>\s*<tr class="Data BorderBottom[^"]*">(.*?)</tr>',
            page, re.S,
        )
        raw_dates: list[str] = []
        entries: list[TrackableLogEntry] = []
        for header, body in rows:
            type_match = re.search(r'/images/logtypes/(\d+)\.png[^>]*title="([^"]*)"[^>]*/?>\s*(?:&nbsp;)?\s*([^<]*)', header)
            log_type_id = int(type_match.group(1)) if type_match else None
            date_raw = _text(type_match.group(3)) if type_match else None
            raw_dates.append(date_raw or '')

            author = re.search(r'href="[^"]*/p/\?guid=([^"]+)">([^<]*)</a>', header)
            cache = re.search(r'href="[^"]*/geocache/(GC[0-9A-Z]+)">(?:<span[^>]*>)?([^<]*)', header)
            log_code = cls._search(r'/live/log/([A-Z0-9]+)', header)
            text = cls._search(r'<div class="TrackLogText[^"]*">(.*?)</div>', body, re.S)

            entries.append(TrackableLogEntry(
                log_reference_code=log_code,
                log_type_id=log_type_id,
                log_type_label=TRACKABLE_LOG_TYPE_LABELS.get(log_type_id) or (_text(type_match.group(2)) if type_match else None),
                log_date=None,
                log_date_raw=date_raw,
                author_username=_text(author.group(2)) if author else None,
                author_guid=author.group(1) if author else None,
                geocache_code=cache.group(1) if cache else None,
                geocache_name=_text(cache.group(2)) if cache else None,
                text_html=sanitize_html_fragment((text or '').strip() or None),
            ))

        day_first = _guess_day_first(raw_dates)
        for entry in entries:
            entry.log_date = _parse_numeric_date(entry.log_date_raw, day_first)
        return entries

    @staticmethod
    def _search(pattern: str, text: str, flags: int = 0) -> Optional[str]:
        match = re.search(pattern, text or '', flags)
        return match.group(1) if match else None


# ----------------------------------------------------------------- Utilitaires

def _sanitize_request_error(exc: requests.RequestException) -> str:
    """
    Détail technique d'une exception `requests`, sans ses query strings : le texte
    cite l'URL appelée, et ``details.aspx?tracker=<code de suivi>`` y laisserait
    le code de suivi. Le nom du type d'exception (`ConnectTimeout`…) reste dans le
    message d'erreur pour le diagnostic.
    """
    detail = re.sub(r"\?[^\s'\")]*", '?…', str(exc)).strip()
    return detail or 'sans détail'


def _as_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _text(value: Optional[str]) -> Optional[str]:
    """Texte HTML → texte brut (entités décodées, espaces normalisés)."""
    if value is None:
        return None
    text = re.sub(r'<[^>]+>', '', value)
    text = html_lib.unescape(text).replace('\xa0', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text or None


def _inner_html(value: Optional[str]) -> Optional[str]:
    """Contenu HTML d'un bloc, sans les paragraphes vides."""
    if value is None:
        return None
    cleaned = re.sub(r'<p>\s*</p>', '', value).strip()
    # La fiche enveloppe parfois le texte de l'objectif dans un <p> de trop.
    if re.match(r'<p>\s*<p', cleaned) and cleaned.endswith('</p>'):
        cleaned = re.sub(r'^<p>\s*', '', cleaned)[:-len('</p>')].strip()
    return cleaned or None


_NUMERIC_DATE_RE = re.compile(r'^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$')


def _guess_day_first(raw_dates: list[str]) -> bool:
    """
    La fiche affiche les dates au format du compte (MM/dd/yyyy, dd/MM/yyyy, dd.MM.yyyy…),
    que la page ne déclare pas. On tranche sur l'ensemble des logs : un premier nombre
    supérieur à 12 impose jour/mois, un second supérieur à 12 impose mois/jour.
    À défaut, le format par défaut du site (mois en premier), sauf séparateur « . ».
    """
    dotted = False
    for raw in raw_dates:
        match = _NUMERIC_DATE_RE.match(raw or '')
        if not match or len(match.group(1)) == 4:
            continue
        dotted = dotted or '.' in raw
        first, second = int(match.group(1)), int(match.group(2))
        if first > 12:
            return True
        if second > 12:
            return False
    return dotted


def _parse_numeric_date(raw: Optional[str], day_first: bool) -> Optional[str]:
    match = _NUMERIC_DATE_RE.match(raw or '')
    if not match:
        return None
    a, b, c = match.groups()
    try:
        if len(a) == 4:
            value = datetime(int(a), int(b), int(c))
        elif day_first:
            value = datetime(int(c), int(b), int(a))
        else:
            value = datetime(int(c), int(a), int(b))
    except ValueError:
        return None
    return value.date().isoformat()
