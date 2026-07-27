"""
Service de récupération du flux d'activité (logs) des amis Geocaching.com.

Endpoint interne du site, découvert en analysant le bundle React du dashboard
(`dashboard-react-entry.js`) :

    GET /api/proxy/web/v1/activities/account/{referenceCode}/api
        ?activitySince=YYYY-MM-DD&activityType=2

`activityType` : 1 = moi, 2 = communauté (mes amis), 3 = mes caches, 4 = collègues.

Le serveur plafonne la réponse autour de 100 entrées quelle que soit la
profondeur demandée : demander 180 jours ne remonte pas plus loin que ~2 mois.
C'est la raison d'être du stockage incrémental (`friend_activity_store`) — on
collecte régulièrement de petites fenêtres et on accumule localement.

Ce module ne fait que le réseau et le parsing : aucune écriture en base.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

import requests

from .geocaching_auth import get_auth_service
from .geocaching_friends import NotAuthenticatedError

logger = logging.getLogger(__name__)


ACTIVITY_TYPE_MINE = 1
ACTIVITY_TYPE_FRIENDS = 2
ACTIVITY_TYPE_MY_CACHES = 3
ACTIVITY_TYPE_DOMAIN = 4


class FriendActivityError(RuntimeError):
    """Erreur de récupération du flux d'activité."""


# Verbes des types de log, repris tels quels de `window.logFormats` (dashboard
# geocaching.com) puis traduits. `{0}` = la cache ou le trackable concerné.
LOG_TYPE_LABELS: dict[int, str] = {
    1: "a désarchivé",
    2: "a trouvé",
    3: "n'a pas trouvé",
    4: "a écrit une note sur",
    5: "a archivé",
    6: "a archivé",
    7: "a demandé l'attention d'un reviewer sur",
    8: "a marqué comme détruit",
    9: "participera à",
    10: "a participé à",
    11: "a pris une photo webcam pour",
    12: "a désarchivé",
    13: "a récupéré",
    14: "a déposé",
    15: "a transféré",
    16: "a marqué comme manquant",
    18: "a posté une note de reviewer sur",
    19: "a attrapé",
    22: "a désactivé temporairement",
    23: "a réactivé",
    24: "a publié",
    25: "a retiré",
    45: "a demandé l'attention de l'owner sur",
    46: "a fait une maintenance sur",
    47: "a mis à jour les coordonnées de",
    48: "a découvert",
    67: "signale un problème sur",
    69: "a déplacé vers sa collection",
    70: "a déplacé vers son inventaire",
    74: "a fait une annonce pour",
    75: "a emmené",
    76: "a soumis pour review",
}


@dataclass
class FriendActivityItem:
    """Une entrée du flux d'activité (un log d'un ami)."""
    log_reference_code: str          # GLxxxxx — identifiant stable, clé de déduplication
    author_username: str
    author_reference_code: str | None
    author_avatar_url: str | None
    log_type_id: int | None
    log_type_label: str | None
    log_date: str | None             # ISO 8601
    created_date: str | None         # ISO 8601
    note: str | None
    cache_name: str | None
    cache_reference_code: str | None  # GCxxxxx (ou TBxxxxx pour un trackable)
    cache_type_id: int | None
    container_type_id: int | None
    difficulty: float | None
    terrain: float | None
    favorite_points: int | None
    image_count: int | None
    is_premium: bool
    is_archived: bool
    is_favorited: bool
    latitude: float | None
    longitude: float | None
    location_name: str | None
    is_condensed: bool               # entrée groupée (« +26 autres caches »)
    condensed_count: int
    action_url: str | None

    @property
    def is_trackable_log(self) -> bool:
        return bool(self.cache_reference_code and self.cache_reference_code.upper().startswith('TB'))

    def to_dict(self) -> dict:
        return asdict(self)


class GeocachingFriendActivityClient:
    """Client HTTP du flux d'activité. Sans état, sans cache : le cache, c'est la base."""

    ACTIVITY_URL = 'https://www.geocaching.com/api/proxy/web/v1/activities/account/{reference_code}/api'

    # Plafond observé côté serveur, quelle que soit la profondeur demandée.
    SERVER_ITEM_CAP = 100

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self._explicit_session = session

    @property
    def session(self) -> requests.Session:
        if self._explicit_session is not None:
            return self._explicit_session
        return get_auth_service().get_session()

    def fetch(
        self,
        since_days: int = 7,
        activity_type: int = ACTIVITY_TYPE_FRIENDS,
        reference_code: Optional[str] = None,
    ) -> list[FriendActivityItem]:
        """
        Récupère le flux depuis `since_days` jours.

        Lève NotAuthenticatedError si la session n'est pas connectée (ou si le
        `referenceCode` du compte est introuvable), FriendActivityError sinon.
        """
        reference_code = reference_code or self._get_reference_code()
        since = (date.today() - timedelta(days=max(1, since_days))).isoformat()
        url = self.ACTIVITY_URL.format(reference_code=reference_code)

        try:
            response = self.session.get(
                url,
                params={'activitySince': since, 'activityType': activity_type},
                headers={'Accept': 'application/json'},
                timeout=60,
            )
        except requests.RequestException as exc:
            raise FriendActivityError(f"Erreur réseau vers geocaching.com : {exc}") from exc

        if response.status_code in (401, 403):
            raise NotAuthenticatedError(
                "Session Geocaching.com refusée pour le flux d'activité : reconnectez-vous."
            )
        if response.status_code != 200:
            raise FriendActivityError(
                f"Réponse inattendue de geocaching.com (HTTP {response.status_code})"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise FriendActivityError("Réponse non-JSON de geocaching.com") from exc

        items = self.parse_items(payload)
        if len(items) >= self.SERVER_ITEM_CAP:
            # Au plafond : des entrées ont probablement été tronquées côté serveur.
            # Une synchronisation plus fréquente (fenêtre plus courte) est la parade.
            logger.warning(
                "Friend activity feed hit the server cap (%d items for %d days) — "
                "some entries may be missing",
                len(items), since_days
            )
        return items

    def _get_reference_code(self) -> str:
        auth_service = get_auth_service()
        if not auth_service.is_logged_in():
            raise NotAuthenticatedError(
                "Vous devez être connecté à Geocaching.com pour voir l'activité de vos amis."
            )

        user_info = auth_service.get_auth_state().user_info
        reference_code = getattr(user_info, 'reference_code', None)
        if not reference_code:
            raise NotAuthenticatedError(
                "Code de compte (referenceCode) introuvable : reconnectez-vous à Geocaching.com."
            )
        return reference_code

    # ---------------------------------------------------------------- Parsing

    @classmethod
    def parse_items(cls, payload: Any) -> list[FriendActivityItem]:
        """Parse la réponse (liste brute ou objet `{data: [...]}`)."""
        if isinstance(payload, list):
            raw_items = payload
        elif isinstance(payload, dict):
            raw_items = payload.get('data') or []
        else:
            raise FriendActivityError("Format de réponse inattendu pour le flux d'activité")

        items: list[FriendActivityItem] = []
        for raw in raw_items:
            item = cls._parse_item(raw)
            if item is not None:
                items.append(item)
        return items

    @classmethod
    def _parse_item(cls, raw: Any) -> Optional[FriendActivityItem]:
        if not isinstance(raw, dict):
            return None

        data = raw.get('data') or {}
        attributes = data.get('attributes') or {}
        author = (raw.get('relationships') or {}).get('author') or {}
        links = raw.get('links') or {}

        log_reference_code = data.get('logReferenceCode')
        if not log_reference_code:
            # Sans identifiant stable, impossible de dédoublonner : on ignore.
            logger.debug("Skipping activity entry without logReferenceCode")
            return None

        log_type_id = attributes.get('logTypeId')
        location = attributes.get('location') or {}

        return FriendActivityItem(
            log_reference_code=log_reference_code,
            author_username=author.get('username') or 'Inconnu',
            author_reference_code=cls._extract_profile_code(author),
            author_avatar_url=author.get('profileImageUrl'),
            log_type_id=log_type_id if isinstance(log_type_id, int) else None,
            log_type_label=LOG_TYPE_LABELS.get(log_type_id) if isinstance(log_type_id, int) else None,
            log_date=cls._normalize_datetime(attributes.get('logDateTime')),
            created_date=cls._normalize_datetime(attributes.get('createdDateTime')),
            note=attributes.get('note') or None,
            cache_name=attributes.get('name') or None,
            cache_reference_code=attributes.get('parentReferenceCode') or None,
            cache_type_id=attributes.get('cacheTypeId'),
            container_type_id=attributes.get('containerTypeId'),
            difficulty=cls._as_float(attributes.get('difficultyLevel')),
            terrain=cls._as_float(attributes.get('terrainLevel')),
            favorite_points=attributes.get('favoritePoints'),
            image_count=attributes.get('imageCount'),
            is_premium=bool(attributes.get('isPremium')),
            is_archived=bool(attributes.get('isArchived')),
            is_favorited=bool(attributes.get('isFavorited')),
            latitude=cls._as_float(location.get('latitude')),
            longitude=cls._as_float(location.get('longitude')),
            location_name=location.get('name') or None,
            is_condensed=bool(attributes.get('isCondensed')),
            condensed_count=attributes.get('condensedCount') or 0,
            action_url=links.get('action'),
        )

    @staticmethod
    def _extract_profile_code(author: dict) -> str | None:
        """Extrait le code PRxxxxx depuis `links.profile` (https://coord.info/PRxxxxx)."""
        profile = ((author.get('links') or {}).get('profile') or '')
        code = profile.rstrip('/').rsplit('/', 1)[-1]
        return code or None

    @staticmethod
    def _normalize_datetime(value: Any) -> str | None:
        """
        Normalise les dates du flux en ISO 8601.

        L'API renvoie des dates sans fuseau, avec une précision variable
        (`2026-07-26T12:52:52.4075283` : 7 décimales, que `fromisoformat`
        n'accepte pas avant Python 3.11).
        """
        if not isinstance(value, str) or not value.strip():
            return None
        text = value.strip()
        if '.' in text:
            head, _, tail = text.partition('.')
            digits = ''.join(c for c in tail if c.isdigit())[:6]
            text = f"{head}.{digits}" if digits else head
        try:
            return datetime.fromisoformat(text).isoformat()
        except ValueError:
            logger.debug("Unparsable activity date: %r", value)
            return None

    @staticmethod
    def _as_float(value: Any) -> float | None:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None


_client: Optional[GeocachingFriendActivityClient] = None


def get_friend_activity_client() -> GeocachingFriendActivityClient:
    global _client
    if _client is None:
        _client = GeocachingFriendActivityClient()
    return _client
