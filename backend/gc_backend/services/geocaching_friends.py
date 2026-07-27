"""
Service pour récupérer la liste des amis Geocaching.com.

Geocaching.com n'expose aucune API JSON pour les amis : la page
`/my/myfriends.aspx` est un formulaire ASP.NET rendu côté serveur, avec un
bloc `<div class="FriendWidget">` par ami. On la scrape donc, en s'appuyant
sur les identifiants de contrôles ASP.NET (`lblMemberSince`, `lblLastOnline`,
`lblLocation`, ...) qui sont stables et indépendants de la langue du compte,
plutôt que sur les libellés affichés.

NB: c:geo ne récupère pas la liste d'amis. Pour afficher les logs d'amis sur
une cache, ils passent par `seek/geocache.logbook?...&sf=true`, où c'est le
serveur qui filtre selon la liste d'amis du compte connecté.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, date
from typing import Optional

import requests
from bs4 import BeautifulSoup

from .geocaching_auth import get_auth_service

logger = logging.getLogger(__name__)


try:
    import lxml  # noqa: F401
    _BS4_PARSER = 'lxml'
except Exception:  # pragma: no cover - dépend de l'environnement
    _BS4_PARSER = 'html.parser'


class GeocachingFriendsError(RuntimeError):
    """Erreur de récupération de la liste d'amis."""


class NotAuthenticatedError(GeocachingFriendsError):
    """La session Geocaching.com n'est pas (ou plus) authentifiée."""


@dataclass
class GeocachingFriend:
    """Un ami Geocaching.com tel qu'affiché sur /my/myfriends.aspx."""
    username: str
    profile_guid: str | None
    profile_url: str | None
    avatar_url: str | None
    is_premium: bool
    member_since: str | None       # ISO 8601 (YYYY-MM-DD)
    last_online: str | None        # ISO 8601 (YYYY-MM-DD)
    location: str | None           # None si "not listed"
    finds_count: int | None
    hides_count: int | None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FriendsResult:
    """Résultat d'une récupération, avec métadonnées de fraîcheur."""
    friends: list[GeocachingFriend]
    fetched_at: datetime
    reported_count: int | None      # `window.friendsCount` annoncé par la page
    pending_requests: int | None    # onglet "Pending Friend Requests (n)"
    truncated: bool                 # moins d'amis parsés que le compteur annoncé

    def to_dict(self) -> dict:
        return {
            "friends": [f.to_dict() for f in self.friends],
            "count": len(self.friends),
            "reported_count": self.reported_count,
            "pending_requests": self.pending_requests,
            "truncated": self.truncated,
            "fetched_at": self.fetched_at.isoformat(),
        }


class GeocachingFriendsClient:
    """
    Client de récupération de la liste d'amis.

    Le résultat est mis en cache en mémoire (`CACHE_TTL`) : la liste d'amis
    bouge très rarement et la page pèse ~90 Ko, inutile de la retélécharger à
    chaque ouverture du widget.
    """

    FRIENDS_URL = 'https://www.geocaching.com/my/myfriends.aspx'
    PROFILE_URL = 'https://www.geocaching.com/p/?guid={guid}'
    CACHE_TTL = 15 * 60  # secondes

    # Sur la page, l'avatar par défaut n'apporte aucune information.
    _DEFAULT_AVATAR_MARKER = 'default_avatar'

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self._explicit_session = session
        self._cache: Optional[FriendsResult] = None
        self._cache_time: float = 0.0
        self._lock = threading.Lock()

    @property
    def session(self) -> requests.Session:
        if self._explicit_session is not None:
            return self._explicit_session
        return get_auth_service().get_session()

    # ------------------------------------------------------------------ API

    def get_friends(self, force_refresh: bool = False) -> FriendsResult:
        """
        Retourne la liste des amis du compte connecté.

        Lève NotAuthenticatedError si la session n'est pas connectée, et
        GeocachingFriendsError en cas d'erreur réseau ou de page inattendue.
        """
        with self._lock:
            if not force_refresh and self._is_cache_valid():
                logger.debug("Friends list served from cache (%d entries)", len(self._cache.friends))
                return self._cache

            html = self._fetch_friends_page()
            result = self.parse_friends_page(html)

            self._cache = result
            self._cache_time = time.time()
            logger.info(
                "Fetched %d friends from geocaching.com (reported: %s)",
                len(result.friends), result.reported_count
            )
            return result

    def invalidate_cache(self) -> None:
        with self._lock:
            self._cache = None
            self._cache_time = 0.0

    # -------------------------------------------------------------- Interne

    def _is_cache_valid(self) -> bool:
        return self._cache is not None and (time.time() - self._cache_time) < self.CACHE_TTL

    def _fetch_friends_page(self) -> str:
        try:
            response = self.session.get(self.FRIENDS_URL, timeout=30)
        except requests.RequestException as exc:
            raise GeocachingFriendsError(f"Erreur réseau vers geocaching.com : {exc}") from exc

        # Une session expirée renvoie une redirection vers /account/signin.
        if 'account/signin' in response.url or 'account/login' in response.url:
            raise NotAuthenticatedError(
                "Session Geocaching.com expirée : reconnectez-vous depuis 'Connexion Geocaching.com'."
            )

        if response.status_code != 200:
            raise GeocachingFriendsError(
                f"Réponse inattendue de geocaching.com (HTTP {response.status_code})"
            )

        return response.text

    # ---------------------------------------------------------- Parsing HTML

    @classmethod
    def parse_friends_page(cls, html: str) -> FriendsResult:
        """Parse le HTML de /my/myfriends.aspx (exposé pour les tests)."""
        soup = BeautifulSoup(html, _BS4_PARSER)

        widgets = soup.select('div.FriendWidget')
        friends = [cls._parse_friend_widget(w) for w in widgets]
        friends = [f for f in friends if f is not None]

        reported_count = cls._extract_reported_count(html)
        pending = cls._extract_pending_requests(html)

        if not widgets and reported_count is None:
            # Ni liste ni compteur : la page n'est pas celle attendue.
            raise GeocachingFriendsError(
                "Page 'Vos amis' non reconnue (structure HTML modifiée ?)"
            )

        truncated = reported_count is not None and len(friends) < reported_count
        if truncated:
            # La page est paginée au-delà d'un certain nombre d'amis (pager
            # ASP.NET par postback). Non géré pour l'instant : on le signale.
            logger.warning(
                "Friends list appears paginated: parsed %d of %d friends",
                len(friends), reported_count
            )

        return FriendsResult(
            friends=friends,
            fetched_at=datetime.now(),
            reported_count=reported_count,
            pending_requests=pending,
            truncated=truncated,
        )

    @classmethod
    def _parse_friend_widget(cls, widget) -> Optional[GeocachingFriend]:
        link = widget.find('a', id=re.compile(r'lnkName$'))
        if link is None:
            return None

        username = link.get_text(strip=True)
        if not username:
            return None

        href = link.get('href') or ''
        guid_match = re.search(r'guid=([0-9a-fA-F\-]{36})', href)
        guid = guid_match.group(1) if guid_match else None

        avatar = widget.find('img', id=re.compile(r'imgAvatar$'))
        avatar_url = avatar.get('src') if avatar else None
        if avatar_url and cls._DEFAULT_AVATAR_MARKER in avatar_url:
            avatar_url = None

        status_img = widget.find('img', id=re.compile(r'imgMemberStatus$'))
        is_premium = bool(status_img and 'prem' in (status_img.get('src') or '').lower())

        return GeocachingFriend(
            username=username,
            profile_guid=guid,
            profile_url=href or (cls.PROFILE_URL.format(guid=guid) if guid else None),
            avatar_url=avatar_url,
            is_premium=is_premium,
            member_since=cls._parse_us_date(cls._span_text(widget, 'lblMemberSince')),
            last_online=cls._parse_us_date(cls._span_text(widget, 'lblLastOnline')),
            location=cls._clean_location(cls._span_text(widget, 'lblLocation')),
            **cls._parse_counts(widget),
        )

    @staticmethod
    def _span_text(widget, id_suffix: str) -> str | None:
        span = widget.find('span', id=re.compile(rf'{id_suffix}$'))
        if span is None:
            return None
        text = span.get_text(strip=True)
        return text or None

    @staticmethod
    def _parse_counts(widget) -> dict:
        """
        Extrait "Found" et "Hidden".

        Ces deux valeurs sont les seules `<dd>` purement numériques de la
        définition list, et apparaissent toujours dans cet ordre — les autres
        `<dd>` (date d'inscription, dernière connexion, lieu) passent par un
        `<span>` identifié. On se base donc sur l'ordre plutôt que sur les
        libellés, qui sont traduits selon la langue du compte.
        """
        numbers: list[int] = []
        for dd in widget.select('dl.FriendList dd'):
            if dd.find('span') is not None:
                continue
            text = dd.get_text(strip=True).replace('\xa0', '').replace(',', '')
            if text.isdigit():
                numbers.append(int(text))

        return {
            'finds_count': numbers[0] if len(numbers) > 0 else None,
            'hides_count': numbers[1] if len(numbers) > 1 else None,
        }

    @staticmethod
    def _parse_us_date(value: str | None) -> str | None:
        """Convertit la date US de la page (MM/DD/YYYY) en ISO YYYY-MM-DD."""
        if not value:
            return None
        for fmt in ('%m/%d/%Y', '%d/%m/%Y', '%Y-%m-%d'):
            try:
                parsed: date = datetime.strptime(value, fmt).date()
                return parsed.isoformat()
            except ValueError:
                continue
        logger.debug("Unparsable friend date: %r", value)
        return None

    @staticmethod
    def _clean_location(value: str | None) -> str | None:
        if not value:
            return None
        if value.strip().lower() in ('not listed', 'non renseigné', 'non renseignée'):
            return None
        return value.strip()

    @staticmethod
    def _extract_reported_count(html: str) -> int | None:
        # Onglet actif de la page amis : <a id="...lnkMyFriends" ...>Your Friends (16)</a>
        match = re.search(r'lnkMyFriends[^>]*>[^<(]*\((\d+)\)', html)
        if match:
            return int(match.group(1))
        # Le dashboard, lui, expose le compteur en JS.
        match = re.search(r'window\.friendsCount\s*=\s*(\d+)', html)
        return int(match.group(1)) if match else None

    @staticmethod
    def _extract_pending_requests(html: str) -> int | None:
        # <a id="...lnkPendingRequests" ...>Pending Friend Requests (0)</a>
        match = re.search(r'lnkPendingRequests[^>]*>[^<(]*\((\d+)\)', html)
        return int(match.group(1)) if match else None


_client: Optional[GeocachingFriendsClient] = None
_client_lock = threading.Lock()


def get_friends_client() -> GeocachingFriendsClient:
    """Retourne le client partagé (le cache mémoire est ainsi mutualisé)."""
    global _client
    with _client_lock:
        if _client is None:
            _client = GeocachingFriendsClient()
        return _client
