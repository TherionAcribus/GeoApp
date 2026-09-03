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
from typing import Iterator, Optional

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
    pages_fetched: int = 1          # nombre de pages parcourues (pagination ASP.NET)

    def to_dict(self) -> dict:
        return {
            "friends": [f.to_dict() for f in self.friends],
            "count": len(self.friends),
            "reported_count": self.reported_count,
            "pending_requests": self.pending_requests,
            "truncated": self.truncated,
            "pages_fetched": self.pages_fetched,
            "fetched_at": self.fetched_at.isoformat(),
        }


class GeocachingFriendsClient:
    """
    Client de récupération de la liste d'amis.

    Le résultat est mis en cache en mémoire (`CACHE_TTL`) : la liste d'amis
    bouge très rarement et la page pèse ~90 Ko, inutile de la retélécharger à
    chaque ouverture du widget.

    Au-delà d'un certain nombre d'amis, la page ASP.NET pagine via
    ``__doPostBack`` (contrôle ``FriendPager``). Le client parcourt
    automatiquement toutes les pages en rejouant le postback ASP.NET
    (``__VIEWSTATE`` etc.), avec une limite de sécurité (`MAX_PAGES`).
    """

    FRIENDS_URL = 'https://www.geocaching.com/my/myfriends.aspx'
    PROFILE_URL = 'https://www.geocaching.com/p/?guid={guid}'
    CACHE_TTL = 15 * 60  # secondes
    MAX_PAGES = 50  # garde-fou : ~50 × 50 = 2500 amis maximum

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

        Parcourt automatiquement toutes les pages si la liste est paginée
        (postback ASP.NET sur le contrôle ``FriendPager``).

        Lève NotAuthenticatedError si la session n'est pas connectée, et
        GeocachingFriendsError en cas d'erreur réseau ou de page inattendue.
        """
        with self._lock:
            if not force_refresh and self._is_cache_valid():
                logger.debug("Friends list served from cache (%d entries)", len(self._cache.friends))
                return self._cache

            result = self._fetch_all_pages()

            self._cache = result
            self._cache_time = time.time()
            logger.info(
                "Fetched %d friends from geocaching.com (reported: %s, pages: %d)",
                len(result.friends), result.reported_count, result.pages_fetched
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

    # ----------------------------------------------------- Pagination ASP.NET

    def _fetch_all_pages(self) -> FriendsResult:
        """
        Parcourt toutes les pages de la liste d'amis.

        Page 1 : GET simple. Pages suivantes : POST avec les champs cachés
        ASP.NET (``__VIEWSTATE`` etc.) et les arguments du postback du pager.
        """
        html = self._fetch_friends_page()
        result = self.parse_friends_page(html)

        all_friends = list(result.friends)
        seen = {f.username for f in all_friends}
        pages = 1

        while pages < self.MAX_PAGES:
            postback = self._extract_next_page_postback(html)
            if postback is None:
                break

            event_target, event_argument = postback
            try:
                html = self._post_back(html, event_target, event_argument)
            except GeocachingFriendsError as exc:
                logger.warning("Pagination stopped at page %d: %s", pages + 1, exc)
                break

            pages += 1
            page_result = self.parse_friends_page(html)
            # Déduplication par pseudo : un ami pourrait apparaître sur deux
            # pages si le pager est mal conçu ou si la liste change entre deux
            # requêtes.
            new_count = 0
            for friend in page_result.friends:
                if friend.username not in seen:
                    all_friends.append(friend)
                    seen.add(friend.username)
                    new_count += 1
            logger.debug("Page %d: %d friends (%d new)", pages, len(page_result.friends), new_count)

        # ``truncated`` ne devrait plus être vrai si la pagination a fonctionné.
        # On le garde uniquement si on a atteint la limite de sécurité.
        truncated = result.reported_count is not None and len(all_friends) < result.reported_count
        if truncated and pages >= self.MAX_PAGES:
            logger.warning(
                "Friends list still truncated after %d pages (reported: %s, got: %d)",
                pages, result.reported_count, len(all_friends)
            )
        elif truncated:
            # On a moins d'amis que le compteur annoncé mais on n'a pas atteint
            # la limite : la pagination a probablement échoué silencieusement.
            logger.warning(
                "Friends list truncated: got %d of %s (pages fetched: %d)",
                len(all_friends), result.reported_count, pages
            )

        return FriendsResult(
            friends=all_friends,
            fetched_at=datetime.now(),
            reported_count=result.reported_count,
            pending_requests=result.pending_requests,
            truncated=truncated,
            pages_fetched=pages,
        )

    def _post_back(self, html: str, event_target: str, event_argument: str) -> str:
        """
        Rejoue un postback ASP.NET pour charger la page suivante.

        POST vers la même URL avec les champs cachés du formulaire plus
        ``__EVENTTARGET`` et ``__EVENTARGUMENT``.
        """
        form_fields = self._extract_aspnet_form_fields(html)
        form_fields['__EVENTTARGET'] = event_target
        form_fields['__EVENTARGUMENT'] = event_argument

        try:
            response = self.session.post(
                self.FRIENDS_URL,
                data=form_fields,
                timeout=30,
                allow_redirects=True,
            )
        except requests.RequestException as exc:
            raise GeocachingFriendsError(f"Erreur réseau lors du postback : {exc}") from exc

        if 'account/signin' in response.url or 'account/login' in response.url:
            raise NotAuthenticatedError(
                "Session Geocaching.com expirée pendant la pagination."
            )

        if response.status_code != 200:
            raise GeocachingFriendsError(
                f"Postback a renvoyé HTTP {response.status_code}"
            )

        return response.text

    @staticmethod
    def _extract_aspnet_form_fields(html: str) -> dict[str, str]:
        """
        Extrait les champs cachés du formulaire ASP.NET.

        ``__VIEWSTATE``, ``__VIEWSTATEGENERATOR``, ``__EVENTVALIDATION`` et
        tout autre ``<input type="hidden">`` du formulaire principal.
        """
        soup = BeautifulSoup(html, _BS4_PARSER)
        fields: dict[str, str] = {}

        # Le formulaire ASP.NET est généralement le premier <form> de la page.
        form = soup.find('form')
        if form is None:
            return fields

        for inp in form.find_all('input', attrs={'type': 'hidden'}):
            name = inp.get('name') or inp.get('id')
            if name:
                fields[name] = inp.get('value', '')

        # Certains champs peuvent être hors <form> dans des cas rares ;
        # on complète avec les champs standards s'ils manquent.
        for required in ('__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION'):
            if required not in fields:
                inp = soup.find('input', attrs={'name': required})
                if inp:
                    fields[required] = inp.get('value', '')

        return fields

    @classmethod
    def _extract_next_page_postback(cls, html: str) -> tuple[str, str] | None:
        """
        Détecte le postback vers la page suivante dans le pager ASP.NET.

        Retourne ``(event_target, event_argument)`` ou ``None`` si aucune page
        suivante n'est disponible.

        Stratégie défensive (la structure exacte du pager n'a pas pu être
        observée — compte de test : 16 amis, pager vide) :

        1. Chercher un lien « Next » dans le pager (``__doPostBack(..., 'Next')``).
        2. Sinon, identifier la page courante (le numéro non cliquable) et
           chercher un postback vers ``courant + 1``.
        3. Sinon, chercher n'importe quel postback dans le pager dont l'argument
           est un nombre supérieur à la page courante.
        """
        soup = BeautifulSoup(html, _BS4_PARSER)

        # Le pager peut avoir différentes classes / ids selon la version du site.
        pager = (
            soup.find('div', class_=re.compile(r'FriendPager', re.I))
            or soup.find('div', class_=re.compile(r'pager', re.I))
            or soup.find('div', id=re.compile(r'Pager', re.I))
        )
        if pager is None:
            return None

        # Tous les __doPostBack du pager : (event_target, event_argument)
        postbacks = list(cls._find_postbacks_in_element(pager))
        if not postbacks:
            return None

        current_page = cls._detect_current_page_number(pager)

        # 1. Lien « Next »
        for target, arg in postbacks:
            if arg.lower() in ('next', '>', 'suivant', 'nextpage'):
                return target, arg

        # 2. Page courante + 1
        if current_page is not None:
            wanted = str(current_page + 1)
            for target, arg in postbacks:
                if arg == wanted:
                    return target, arg

        # 3. N'importe quel postback avec un argument numérique > page courante
        if current_page is not None:
            candidates = []
            for target, arg in postbacks:
                try:
                    page_num = int(arg)
                except ValueError:
                    continue
                if page_num > current_page:
                    candidates.append((page_num, target, arg))
            if candidates:
                candidates.sort(key=lambda c: c[0])
                _, target, arg = candidates[0]
                return target, arg

        # 4. Dernier recours : s'il n'y a qu'un seul postback et qu'on n'a pas
        # pu déterminer la page courante, le suivre. Si on connaît la page
        # courante, les stratégies 1-3 sont suffisantes et suivre un postback
        # unique risquerait de revenir en arrière.
        if current_page is None and len(postbacks) == 1:
            return postbacks[0]

        return None

    @staticmethod
    def _find_postbacks_in_element(element) -> Iterator[tuple[str, str]]:
        """
        Extrait tous les ``__doPostBack('target','arg')`` d'un élément HTML.

        Gère les variantes d'échappement : apostrophes simples et entité HTML
        ``&#39;`` (utilisée par ASP.NET dans les ``href="javascript:..."``).
        """
        # On cherche dans le HTML brut plutôt que dans le texte parsé, car
        # __doPostBack est dans des attributs href="javascript:...".
        raw = str(element)
        # Apostrophes simples : __doPostBack('target','arg')
        for match in re.finditer(
            r"__doPostBack\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)",
            raw,
        ):
            yield match.group(1), match.group(2)
        # Entité HTML &#39; : __doPostBack(&#39;target&#39;,&#39;arg&#39;)
        for match in re.finditer(
            r"__doPostBack\s*\(\s*&#39;([^&]*)&#39;\s*,\s*&#39;([^&]*)&#39;\s*\)",
            raw,
        ):
            yield match.group(1), match.group(2)

    @staticmethod
    def _detect_current_page_number(pager) -> int | None:
        """
        Détecte le numéro de la page courante dans le pager.

        Le numéro courant est généralement un ``<span>`` (non cliquable) tandis
        que les autres pages sont des ``<a>``.
        """
        # Chercher un <span> contenant un nombre dans le pager
        for span in pager.find_all('span'):
            text = span.get_text(strip=True)
            if text.isdigit():
                return int(text)

        # Parfois c'est un <b> ou un <strong>
        for tag in pager.find_all(['b', 'strong']):
            text = tag.get_text(strip=True)
            if text.isdigit():
                return int(text)

        # Dernier recours : un <a> avec une classe "Active" ou "Current"
        for link in pager.find_all('a'):
            classes = link.get('class') or []
            if any(c.lower() in ('active', 'current', 'selected') for c in classes):
                text = link.get_text(strip=True)
                if text.isdigit():
                    return int(text)

        return None

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
