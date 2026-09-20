"""
Service pour récupérer les logs des géocaches depuis Geocaching.com.

Ce service utilise l'API interne de Geocaching.com pour récupérer les logs
d'une géocache. Il nécessite une authentification via les cookies du navigateur.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import requests

from .geocaching_auth import get_auth_service

logger = logging.getLogger(__name__)


class GeocachingLogsError(Exception):
    """Erreur réseau, JSON invalide ou réponse applicative en échec (`status: error`)."""


class FriendLogsCheckFailedError(GeocachingLogsError):
    """
    L'appel `sf=true` (logs d'amis) a échoué alors que les logs « tous » ont pu
    être récupérés.

    Distinct de « aucun log d'ami » : sans cette distinction, une panne
    transitoire sur ce seul appel se traduirait par un ensemble vide de
    pseudos amis, et le rafraîchissement des logs (blueprints/logs.py)
    réinitialiserait `is_friend_log` à `False` sur tous les logs existants —
    y compris ceux correctement marqués par un rafraîchissement précédent.

    `logs` porte les logs « tous » déjà récupérés, pour qu'un appelant puisse
    quand même les enregistrer sans toucher aux badges « ami ».
    """

    def __init__(
        self,
        message: str,
        logs: list["GeocacheLogData"],
        total_available: int | None = None,
    ) -> None:
        super().__init__(message)
        self.logs = logs
        self.total_available = total_available


@dataclass
class GeocacheLogImageData:
    """Une photo jointe à un log, telle que le logbook l'annonce."""
    external_id: str
    source_url: str
    title: str
    description: str
    taken_at: datetime | None = None


@dataclass
class GeocacheLogData:
    """Représente un log récupéré depuis Geocaching.com."""
    external_id: str
    author: str
    author_guid: str | None
    text: str
    date: datetime | None
    log_type: str
    is_favorite: bool
    images: list[GeocacheLogImageData] = field(default_factory=list)


@dataclass
class LogbookPage:
    """Une page du logbook, avec le total de logs de la cache s'il est connu."""
    logs: list[GeocacheLogData]
    total_available: int | None = None


@dataclass
class LogbookFetchResult:
    """
    Résultat d'une récupération du logbook.

    `total_available` est le nombre de logs que la cache possède sur
    Geocaching.com, **pas** le nombre de logs ramenés : c'est lui qui permet à
    l'interface de proposer « il en reste, on continue ? ». Il vaut `None`
    quand le logbook ne l'annonce pas (voir `_read_total_available`).

    `truncated` signale qu'un `fetch_all` s'est arrêté sur le plafond de
    sécurité plutôt que sur la fin réelle des logs.

    `own_external_ids` identifie les logs écrits par le compte connecté
    (filtre `sp=true` du logbook). Il ne vaut quelque chose que si
    `include_own` était demandé **et** que l'appel a réussi : `None` signifie
    « on ne sait pas », ce qui doit se traduire en aval par « ne pas toucher
    aux badges existants », jamais par « aucun log à moi ».
    """
    logs: list[GeocacheLogData]
    friend_external_ids: set[str]
    own_external_ids: set[str] | None = None
    total_available: int | None = None
    truncated: bool = False


# Le logbook sert les logs par pages (`idx` = numéro de page, `num` = taille).
# Au-delà de cette taille, mieux vaut enchaîner les pages que demander un `num`
# énorme d'un seul coup.
MAX_LOGS_PER_PAGE = 100

# Garde-fou du mode « tout charger » : une cache ancienne peut compter plusieurs
# milliers de logs, qu'on ne veut ni télécharger ni stocker sans fin.
MAX_LOGS_FETCH_ALL = 1000

# Préfixe des photos de logs. Le logbook porte bien un champ `ImageUrl`, mais il
# est **toujours nul** (constaté sur plusieurs centaines de logs) : l'URL se
# reconstruit à partir de `FileName`, qui vaut `<ImageGuid>.jpg`.
#
# Quatre variantes existent, toutes servies sans authentification :
#
#   `/<FileName>`                    l'original     ~970 Ko
#   `/cache/log/large/<FileName>`    grand format   ~100 Ko
#   `/cache/log/display/<FileName>`  réduit          ~14 Ko
#   `/cache/log/thumb/<FileName>`    vignette         ~3 Ko
#
# On retient `large` : l'original coûterait dix fois plus pour un écran qui ne
# l'exploite pas, et `display` est trop dégradé pour un spoiler qu'on agrandit.
# Un seul fichier est stocké par photo — le projet redimensionne en CSS plutôt
# que de générer des vignettes (cf. le panneau d'images de géocache).
LOG_IMAGE_URL_PREFIX = 'https://img.geocaching.com/cache/log/large/'


def build_log_image_url(file_name: str | None) -> str | None:
    """
    Construit l'URL d'une photo de log à partir du `FileName` du logbook.

    Renvoie `None` si le nom est absent ou suspect : il finit dans une URL
    téléchargée par le serveur, et un `../` y aurait sa place ailleurs que dans
    le dossier des photos de logs.
    """
    name = (file_name or '').strip()
    if not name or '/' in name or '\\' in name or '..' in name:
        return None
    return LOG_IMAGE_URL_PREFIX + name


class GeocachingLogsClient:
    """
    Client pour récupérer les logs des géocaches depuis Geocaching.com.
    
    Utilise l'API interne de Geocaching.com qui retourne les logs en JSON.
    L'authentification se fait via les cookies du navigateur (Firefox, Chrome, Edge).
    
    Stratégie:
    1. Récupérer la page HTML de la géocache
    2. Extraire le userToken de la page
    3. Utiliser ce token pour appeler l'API des logs
    """
    
    # URL de la page de la géocache (pour extraire le userToken)
    GEOCACHE_PAGE_URL = 'https://www.geocaching.com/geocache/{gc_code}'
    
    # URL de l'API des logs (nécessite le userToken)
    LOGS_API_URL = 'https://www.geocaching.com/seek/geocache.logbook'
    
    def __init__(self, session: Optional[requests.Session] = None) -> None:
        # Utiliser la session du service d'authentification centralisé
        if session is not None:
            self.session = session
        else:
            auth_service = get_auth_service()
            self.session = auth_service.get_session()

        # NB: ne pas muter les headers de la session partagée ici. Les headers
        # spécifiques (Accept JSON, X-Requested-With) sont passés par requête dans
        # _get_user_token / _fetch_logs_page ; sinon ils fuiteraient sur les
        # requêtes HTML du scraper qui réutilise la même session singleton.
    
    def get_logs(
        self, 
        gc_code: str, 
        count: int = 25, 
        log_type: str = 'all'
    ) -> list[GeocacheLogData]:
        """
        Récupère les logs d'une géocache depuis Geocaching.com.
        
        Stratégie:
        1. Récupérer la page HTML de la géocache
        2. Extraire le userToken de la page
        3. Utiliser ce token pour appeler l'API des logs
        
        Args:
            gc_code: Code GC de la géocache (ex: GC12345)
            count: Nombre de logs à récupérer (défaut: 25)
            log_type: Type de logs à récupérer ('all', 'friends', 'own')
            
        Returns:
            Liste des logs récupérés
            
        Raises:
            LookupError: Si la géocache n'est pas trouvée
            GeocachingLogsError: erreur réseau, JSON invalide ou réponse en échec
        """
        gc_code = gc_code.strip().upper()
        logger.info(f"Fetching logs for {gc_code} (count={count}, type={log_type})")
        
        # Étape 1: Récupérer le userToken depuis la page de la géocache
        user_token = self._get_user_token(gc_code)
        if not user_token:
            logger.error(f"Could not get userToken for {gc_code}")
            return []
        
        # Étape 2: Appeler l'API des logs avec le token
        return self._fetch_logs_page(user_token, count, log_type).logs

    def get_logs_with_friends(
        self,
        gc_code: str,
        count: int = 25,
    ) -> tuple[list[GeocacheLogData], set[str]]:
        """
        Récupère les logs d'une géocache **et** ceux écrits par mes amis.

        Raccourci historique vers `fetch_logbook`, pour les appelants qui ne
        veulent que les logs les plus récents et se moquent du total disponible.

        Returns:
            (logs, external_ids des logs d'amis)
        """
        result = self.fetch_logbook(gc_code, count=count)
        return result.logs, result.friend_external_ids

    def fetch_logbook(
        self,
        gc_code: str,
        count: int = 25,
        page: int = 1,
        fetch_all: bool = False,
        include_own: bool = False,
    ) -> LogbookFetchResult:
        """
        Récupère une tranche du logbook d'une géocache **et** les logs de mes amis.

        Le paramètre `sf=true` du logbook fait filtrer geocaching.com selon la
        liste d'amis du compte connecté (c'est la méthode de c:geo). Comme ce
        filtre s'applique à *tous* les logs de la cache et pas seulement aux
        plus récents, un log d'ami peut sortir de la fenêtre demandée : il est
        alors retourné en plus dans la liste.

        Le `userToken` n'est extrait qu'une fois pour toutes les requêtes.

        Args:
            gc_code: Code GC de la géocache.
            count: Taille de page demandée (plafonnée à `MAX_LOGS_PER_PAGE`).
            page: Numéro de page 1-based — c'est le `idx` du logbook, donc un
                numéro de page, pas un offset en nombre de logs.
            fetch_all: Enchaîne les pages à partir de `page` jusqu'à épuisement
                des logs ou jusqu'au plafond `MAX_LOGS_FETCH_ALL`.
            include_own: Demande en plus la page `sp=true` — les logs du compte
                connecté, même mécanisme que `sf=true` pour les amis. Ceux qui
                sortent de la fenêtre sont ajoutés au résultat, et leurs
                external_ids sont rapportés dans `own_external_ids`.

        Raises:
            GeocachingLogsError: la récupération des logs « tous » a échoué —
                impossible de faire quoi que ce soit sans eux.
            FriendLogsCheckFailedError: les logs « tous » ont été récupérés,
                mais l'appel `sf=true` a échoué. Ne surtout pas interpréter ça
                comme « aucun ami n'a loggué cette cache » (voir la docstring
                de l'exception) : l'exception porte les logs déjà récupérés
                dans son attribut `logs`, pour que l'appelant puisse les
                enregistrer sans toucher aux badges « ami ».
        """
        gc_code = gc_code.strip().upper()
        page_size = max(1, min(count, MAX_LOGS_PER_PAGE))
        first_page = max(1, page)
        logger.info(
            f"Fetching logbook for {gc_code} "
            f"(page={first_page}, size={page_size}, all={fetch_all})"
        )

        user_token = self._get_user_token(gc_code)
        if not user_token:
            logger.error(f"Could not get userToken for {gc_code}")
            return LogbookFetchResult(logs=[], friend_external_ids=set())

        logs: list[GeocacheLogData] = []
        seen_ids: set[str] = set()
        total_available: int | None = None
        truncated = False
        current_page = first_page

        while True:
            fetched = self._fetch_logs_page(user_token, page_size, 'all', page=current_page)
            if fetched.total_available is not None:
                total_available = fetched.total_available

            # Deux pages peuvent se recouvrir si un log est posté entre les deux
            # appels : on déduplique ici plutôt que de compter deux fois.
            for log in fetched.logs:
                if log.external_id:
                    if log.external_id in seen_ids:
                        continue
                    seen_ids.add(log.external_id)
                logs.append(log)

            if not fetch_all:
                break

            # Une page incomplète marque la fin du logbook. C'est le seul critère
            # d'arrêt qui reste juste quand `totalRows` est absent de la réponse.
            if len(fetched.logs) < page_size:
                break

            if len(logs) >= MAX_LOGS_FETCH_ALL:
                logger.warning(
                    f"Stopping at {len(logs)} logs for {gc_code}: "
                    f"safety cap MAX_LOGS_FETCH_ALL={MAX_LOGS_FETCH_ALL} reached"
                )
                truncated = True
                break

            current_page += 1

        # Le filtre amis porte sur toute la cache : une seule requête suffit,
        # quel que soit le nombre de pages parcourues au-dessus.
        try:
            friend_page = self._fetch_logs_page(user_token, page_size, 'friends')
        except GeocachingLogsError as e:
            raise FriendLogsCheckFailedError(str(e), logs, total_available) from e

        friend_logs = friend_page.logs
        friend_ids = {log.external_id for log in friend_logs if log.external_id}

        # Un log d'ami plus ancien que la fenêtre demandée n'est pas dans `logs` :
        # on l'ajoute, c'est justement l'intérêt du filtre côté serveur.
        extra = [log for log in friend_logs if log.external_id and log.external_id not in seen_ids]
        if extra:
            logger.info(f"{len(extra)} friend log(s) outside the fetched window of {gc_code}")
            logs = logs + extra
            seen_ids.update(log.external_id for log in extra)

        # Même traitement pour mes propres logs (`sp=true`), quand l'appelant le
        # demande. Un échec ici ne doit rien casser : les logs « tous » sont déjà
        # récupérés, et `own_external_ids=None` dira « inconnu » plutôt que
        # « aucun » — l'appelant laissera alors les badges existants tranquilles.
        own_ids: set[str] | None = None
        if include_own:
            try:
                own_logs = self._fetch_logs_page(user_token, page_size, 'own').logs
            except GeocachingLogsError as e:
                logger.warning(f"Own logs check failed for {gc_code}: {e}")
            else:
                own_ids = {log.external_id for log in own_logs if log.external_id}
                extra = [
                    log for log in own_logs
                    if log.external_id and log.external_id not in seen_ids
                ]
                if extra:
                    logger.info(
                        f"{len(extra)} own log(s) outside the fetched window of {gc_code}"
                    )
                    logs = logs + extra

        return LogbookFetchResult(
            logs=logs,
            friend_external_ids=friend_ids,
            own_external_ids=own_ids,
            total_available=total_available,
            truncated=truncated,
        )


    def _get_user_token(self, gc_code: str) -> str | None:
        """
        Récupère le userToken depuis la page HTML de la géocache.
        
        Le userToken est un token chiffré nécessaire pour appeler l'API des logs.
        Il est présent dans le JavaScript de la page sous la forme:
        userToken = 'XXXXX...'
        
        Args:
            gc_code: Code GC de la géocache
            
        Returns:
            Le userToken ou None si non trouvé
        """
        url = self.GEOCACHE_PAGE_URL.format(gc_code=gc_code)
        logger.debug(f"Fetching geocache page to extract userToken: {url}")
        
        try:
            # Utiliser les headers pour une requête HTML normale
            headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
            resp = self.session.get(url, headers=headers, timeout=30)
            
            if resp.status_code == 404:
                logger.warning(f"Geocache {gc_code} not found (404)")
                raise LookupError('gc_not_found')
            
            resp.raise_for_status()
            
            # Chercher le userToken dans la page
            # Format: userToken = 'XXXXX...'
            token_match = re.search(r"userToken\s*=\s*'([^']+)'", resp.text)
            if token_match:
                token = token_match.group(1)
                logger.debug(f"Found userToken for {gc_code}: {token[:30]}...")
                return token
            
            logger.warning(f"userToken not found in page for {gc_code}")
            return None
            
        except requests.RequestException as e:
            logger.error(f"Failed to fetch geocache page for {gc_code}: {e}")
            raise
    
    @staticmethod
    def _read_total_available(data: dict) -> int | None:
        """
        Lit le nombre total de logs de la cache dans l'enveloppe du logbook.

        Le logbook accompagne les logs d'un bloc de pagination
        (`{"pageInfo": {"idx": 1, "size": 25, "rows": 25, "totalRows": 137}}`),
        seule source du total réel : `data` ne contient que la page demandée.

        Ce bloc n'est pas contractuel — c'est une API interne, qui a déjà changé
        de forme. On accepte donc plusieurs graphies et on renvoie `None` si
        rien n'est exploitable : tout le code en aval doit savoir s'en passer
        (l'interface masque simplement la proposition « charger la suite »).
        """
        candidates = []
        page_info = data.get('pageInfo')
        if isinstance(page_info, dict):
            candidates.extend([page_info.get('totalRows'), page_info.get('totalrows')])
        candidates.extend([data.get('totalRows'), data.get('pageInfoTotalRows')])

        for candidate in candidates:
            try:
                total = int(candidate)
            except (TypeError, ValueError):
                continue
            if total >= 0:
                return total

        logger.debug("No totalRows in logbook response (keys: %s)", sorted(data.keys()))
        return None

    def _fetch_logs_page(
        self,
        user_token: str,
        count: int,
        log_type: str,
        page: int = 1
    ) -> LogbookPage:
        """
        Récupère une page de logs via l'API en utilisant le userToken.

        Args:
            user_token: Token chiffré extrait de la page
            count: Nombre de logs à récupérer (taille de page)
            log_type: Type de logs ('all', 'friends', 'own')
            page: Numéro de page 1-based (le `idx` du logbook)

        Returns:
            La page récupérée (`logs` peut être vide : c'est une réponse
            valide, pas une erreur), avec le total de logs de la cache quand le
            logbook l'annonce.

        Raises:
            GeocachingLogsError: erreur réseau, JSON invalide, ou réponse
                applicative en échec. Ne **jamais** dégrader ça en liste vide :
                l'appelant ne pourrait plus distinguer « pas de logs de ce
                type » de « la récupération a échoué » (voir
                `FriendLogsCheckFailedError`).
        """
        params = {
            'tkn': user_token,
            'idx': max(1, page),
            'num': count,
            'decrypt': 'false',
        }

        # Ajouter le filtre de type si nécessaire
        if log_type.lower() == 'friends':
            params['sf'] = 'true'
        elif log_type.lower() == 'own':
            params['sp'] = 'true'

        headers = {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
        }

        try:
            logger.debug(f"Requesting logs API with token: {user_token[:30]}...")
            resp = self.session.get(self.LOGS_API_URL, params=params, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.JSONDecodeError as e:
            logger.error(f"Failed to parse logs JSON: {e}")
            raise GeocachingLogsError(f"Invalid JSON from logs API: {e}") from e
        except requests.RequestException as e:
            logger.error(f"Failed to fetch logs: {e}")
            raise GeocachingLogsError(f"Network error fetching logs: {e}") from e

        if isinstance(data, dict):
            status = data.get('status', '')
            if status == 'error':
                error_msg = data.get('msg', 'Unknown error')
                logger.error(f"Logs API returned error: {error_msg}")
                raise GeocachingLogsError(f"Logs API returned an error: {error_msg}")

            if status == 'success' and 'data' in data:
                logs = self._parse_legacy_logs(data['data'])
                total_available = self._read_total_available(data)
                logger.info(
                    f"Retrieved {len(logs)} logs (page {params['idx']}, "
                    f"total available: {total_available if total_available is not None else 'unknown'})"
                )
                return LogbookPage(logs=logs, total_available=total_available)

        logger.warning("Unexpected response format from logs API")
        raise GeocachingLogsError("Unexpected response format from logs API")
    
    def _parse_legacy_logs(self, logs_data: list) -> list[GeocacheLogData]:
        """
        Parse les logs depuis l'API legacy.
        
        Format attendu:
        {
            "LogID": 1336648432,
            "LogGuid": "0e47266d-0c68-4956-ab59-3f31305641b7",
            "LogType": "Found it",
            "LogText": "<p>...</p>",
            "Created": "12/02/2025",
            "Visited": "11/30/2025",
            "UserName": "geokaboutervinnie",
            "AccountGuid": "602bdfc3-c48e-4a14-8449-216dfc1416fb",
            "FavoritePointUsed": false,
            "Images": [
                {
                    "ImageID": 103296230,
                    "ImageGuid": "2dd2667c-8c1f-4ebb-b39b-452af9bd1987",
                    "Name": "Bild 1",
                    "Descr": "",
                    "FileName": "2dd2667c-8c1f-4ebb-b39b-452af9bd1987.jpg",
                    "Created": "09/07/2026",
                    "LogID": 1383323441,
                    "CacheID": 4158,
                    "ImageUrl": null
                }
            ]
        }

        `ImageUrl` est toujours nul et `ImageCount` aussi : seul `FileName`
        permet de retrouver la photo (voir `build_log_image_url`). Les photos
        n'apparaissent jamais en `<img>` dans `LogText` — et ce serait sans
        effet, `_clean_log_text` supprimant toutes les balises.
        """
        logs = []
        
        for entry in logs_data:
            try:
                external_id = str(entry.get('LogID', entry.get('LogGuid', '')))
                author = entry.get('UserName', 'Unknown')
                author_guid = entry.get('AccountGuid')
                
                text = entry.get('LogText', '')
                text = self._clean_log_text(text)
                
                # Utiliser Visited (date de visite) plutôt que Created (date de création du log)
                date_str = entry.get('Visited', entry.get('Created', ''))
                date = self._parse_date(date_str)
                
                log_type = entry.get('LogType', 'Unknown')
                is_favorite = bool(entry.get('FavoritePointUsed', False))
                
                logs.append(GeocacheLogData(
                    external_id=external_id,
                    author=author,
                    author_guid=author_guid,
                    text=text,
                    date=date,
                    log_type=log_type,
                    is_favorite=is_favorite,
                    images=self._parse_log_images(entry),
                ))
            except Exception as e:
                logger.warning(f"Failed to parse log entry: {e}")
                continue

        return logs

    def _parse_log_images(self, entry: dict) -> list[GeocacheLogImageData]:
        """
        Extrait les photos jointes à un log.

        Une photo dont le `FileName` est inexploitable est ignorée plutôt que de
        faire échouer le log entier : le texte reste la donnée principale, et un
        log sans sa photo vaut mieux qu'un log perdu.
        """
        images: list[GeocacheLogImageData] = []

        for raw in entry.get('Images') or []:
            if not isinstance(raw, dict):
                continue

            source_url = build_log_image_url(raw.get('FileName'))
            if not source_url:
                logger.warning(
                    "Skipping log image with unusable FileName: %r", raw.get('FileName')
                )
                continue

            external_id = str(raw.get('ImageID') or raw.get('ImageGuid') or '')
            if not external_id:
                logger.warning("Skipping log image without identifier: %s", source_url)
                continue

            images.append(GeocacheLogImageData(
                external_id=external_id,
                source_url=source_url,
                title=(raw.get('Name') or '').strip(),
                description=(raw.get('Descr') or '').strip(),
                taken_at=self._parse_date(raw.get('Created') or ''),
            ))

        return images

    def _clean_log_text(self, text: str) -> str:
        """
        Nettoie le texte d'un log (supprime le HTML basique).
        
        Args:
            text: Texte brut ou HTML
            
        Returns:
            Texte nettoyé
        """
        if not text:
            return ''
        
        # Remplacer les balises <br> par des sauts de ligne
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
        
        # Supprimer les autres balises HTML
        text = re.sub(r'<[^>]+>', '', text)
        
        # Décoder les entités HTML courantes
        text = text.replace('&nbsp;', ' ')
        text = text.replace('&amp;', '&')
        text = text.replace('&lt;', '<')
        text = text.replace('&gt;', '>')
        text = text.replace('&quot;', '"')
        text = text.replace('&#39;', "'")
        
        # Nettoyer les espaces multiples
        text = re.sub(r'\n\s*\n', '\n\n', text)
        text = text.strip()
        
        return text
    
    def _parse_date(self, date_str: str) -> datetime | None:
        """
        Parse une date depuis différents formats possibles.
        
        Args:
            date_str: Chaîne de date
            
        Returns:
            datetime ou None si le parsing échoue
        """
        if not date_str:
            return None
        
        # Formats de date possibles
        formats = [
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%dT%H:%M:%SZ',
            '%Y-%m-%d',
            '%m/%d/%Y',
            '%d/%m/%Y',
        ]
        
        # Nettoyer la chaîne (enlever les millisecondes et timezone)
        date_str = re.sub(r'\.\d+', '', date_str)
        date_str = re.sub(r'[+-]\d{2}:\d{2}$', '', date_str)
        
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        
        logger.warning(f"Could not parse date: {date_str}")
        return None
