"""
Service d'authentification centralisé pour Geocaching.com.

Ce service gère l'authentification via:
1. Cookies extraits du navigateur (Firefox, Chrome, Edge) - méthode legacy
2. Login username/password comme c:geo - méthode recommandée

L'authentification par username/password utilise le même flow que c:geo:
1. GET sur la page de login pour obtenir le __RequestVerificationToken
2. POST des credentials (UsernameOrEmail, Password, token)
3. Stockage des cookies de session pour les requêtes futures
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import os
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Optional

import browser_cookie3
import requests
from bs4 import BeautifulSoup

try:  # keyring est optionnel : repli sur le stockage JSON s'il est absent
    import keyring
    from keyring.errors import KeyringError
    _KEYRING_AVAILABLE = True
except Exception:  # pragma: no cover - dépend de l'environnement
    keyring = None
    KeyringError = Exception
    _KEYRING_AVAILABLE = False

logger = logging.getLogger(__name__)

# Nom du service utilisé dans le trousseau système (Windows Credential Manager,
# macOS Keychain, Secret Service sous Linux) pour stocker le mot de passe.
KEYRING_SERVICE = "GeoApp:Geocaching.com"


# User-Agent unique pour toutes les requêtes vers Geocaching.com.
# Changer d'UA sur une même session est un signal de bot : on garde une valeur
# stable et partagée par tous les clients (auth, scraper, logs, notes, recherche).
GEOAPP_USER_AGENT = "GeoApp/1.0 (+https://mysterai.io)"


class AuthMethod(Enum):
    """Méthode d'authentification utilisée."""
    NONE = "none"
    BROWSER_COOKIES = "browser_cookies"
    CREDENTIALS = "credentials"


class AuthStatus(Enum):
    """Statut de l'authentification."""
    NOT_CONFIGURED = "not_configured"
    LOGGED_IN = "logged_in"
    LOGGED_OUT = "logged_out"
    LOGIN_FAILED = "login_failed"
    CAPTCHA_REQUIRED = "captcha_required"
    ACCOUNT_NOT_VALIDATED = "account_not_validated"


@dataclass
class UserInfo:
    """Informations sur l'utilisateur connecté."""
    username: str
    reference_code: Optional[str] = None
    user_type: Optional[str] = None  # Basic, Premium, etc.
    public_guid: Optional[str] = None
    avatar_url: Optional[str] = None
    date_format: Optional[str] = None
    finds_count: Optional[int] = None
    hides_count: Optional[int] = None
    favorite_points: Optional[int] = None  # Total PF gagnés
    awarded_favorite_points: Optional[int] = None  # PF disponibles à distribuer
    stats_last_updated: Optional[datetime] = None


@dataclass
class AuthState:
    """État actuel de l'authentification."""
    status: AuthStatus
    method: AuthMethod
    user_info: Optional[UserInfo] = None
    last_check: Optional[datetime] = None
    error_message: Optional[str] = None


class GeocachingAuthService:
    """
    Service centralisé pour l'authentification Geocaching.com.
    
    Singleton thread-safe qui gère l'authentification et fournit
    une session requests configurée pour les autres services.
    """
    
    LOGIN_URI = "https://www.geocaching.com/account/signin"
    LOGOUT_URI = "https://www.geocaching.com/account/logout"
    SERVER_PARAMS_URI = "https://www.geocaching.com/play/serverparameters/params"
    DASHBOARD_URI = "https://www.geocaching.com/account/dashboard"
    
    REQUEST_VERIFICATION_TOKEN = "__RequestVerificationToken"
    
    # Durée de validité du cache d'état (en secondes)
    STATE_CACHE_TTL = 300  # 5 minutes
    
    _instance: Optional["GeocachingAuthService"] = None
    _lock = threading.Lock()
    
    def __new__(cls) -> "GeocachingAuthService":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance
    
    def __init__(self) -> None:
        if self._initialized:
            return
        
        self._session: Optional[requests.Session] = None
        self._auth_state = AuthState(
            status=AuthStatus.NOT_CONFIGURED,
            method=AuthMethod.NONE
        )
        self._credentials_file = self._get_credentials_file_path()
        # Cookies de session persistés à côté des credentials, pour restaurer une
        # session sans rejouer le login (username/password) à chaque démarrage.
        self._cookies_file = self._credentials_file.parent / ".gc_cookies.json"
        self._session_lock = threading.Lock()
        # Verrou dédié aux lectures/écritures de _auth_state (dataclass mutable
        # partagée entre threads Flask). Le réseau est fait hors de ce verrou.
        self._state_lock = threading.RLock()
        self._initialized = True

        logger.info("GeocachingAuthService initialized")
    
    def _get_credentials_file_path(self) -> Path:
        """Retourne le chemin du fichier de stockage des credentials."""
        override_dir = os.environ.get("GEOAPP_AUTH_DATA_DIR")
        if override_dir:
            data_dir = Path(override_dir)
        elif os.name == "nt":
            base_dir = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
            data_dir = Path(base_dir) / "GeoApp" if base_dir else Path.home() / "AppData" / "Local" / "GeoApp"
        else:
            base_dir = os.environ.get("XDG_CONFIG_HOME")
            data_dir = Path(base_dir) / "geoapp" if base_dir else Path.home() / ".config" / "geoapp"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / ".gc_credentials.json"
    
    def _create_session(self) -> requests.Session:
        """Crée une nouvelle session requests avec les headers appropriés."""
        session = requests.Session()
        session.headers.update({
            'User-Agent': GEOAPP_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        })
        return session
    
    def get_session(self) -> requests.Session:
        """
        Retourne une session requests authentifiée.
        
        La session est créée et authentifiée si nécessaire.
        Cette méthode est thread-safe.
        """
        with self._session_lock:
            if self._session is None:
                self._session = self._create_session()
                self._try_restore_session()
            
            return self._session
    
    def _try_restore_session(self) -> None:
        """Tente de restaurer une session précédente."""
        # 1. Essayer les credentials sauvegardés
        saved = self._load_saved_credentials()
        if saved and saved.get("method") == "credentials":
            # a) D'abord les cookies persistés : évite un login réseau complet
            #    (plus rapide et moins susceptible de déclencher un captcha).
            if self._restore_from_cookies(AuthMethod.CREDENTIALS):
                return

            # b) Sinon, re-login avec les credentials sauvegardés
            username = saved.get("username")
            password = saved.get("password")
            if username and password:
                logger.info("Attempting to restore session with saved credentials...")
                status = self._do_login(username, password)
                if status == AuthStatus.LOGGED_IN:
                    self._save_cookies()
                    logger.info("Session restored successfully")
                    return
        
        # 2. Ne jamais extraire automatiquement les cookies navigateur.
        # Cette méthode doit rester une action utilisateur explicite: sinon une
        # installation peut sembler connectée simplement parce que le navigateur
        # local possède déjà une session Geocaching.com.
        if saved and saved.get("method") == "browser_cookies":
            logger.info("Browser cookie auth is configured but requires an explicit user action")
            self._auth_state = AuthState(
                status=AuthStatus.LOGGED_OUT,
                method=AuthMethod.BROWSER_COOKIES
            )
    
    # ---- Stockage du mot de passe dans le trousseau système ----

    @staticmethod
    def _store_password(username: str, password: str) -> bool:
        """Stocke le mot de passe dans le trousseau système. True si réussi."""
        if not _KEYRING_AVAILABLE or not username:
            return False
        try:
            keyring.set_password(KEYRING_SERVICE, username, password)
            return True
        except KeyringError as e:  # pragma: no cover - dépend de l'OS
            logger.warning(f"Failed to store password in keyring: {e}")
            return False

    @staticmethod
    def _load_password(username: Optional[str]) -> Optional[str]:
        """Récupère le mot de passe depuis le trousseau système."""
        if not _KEYRING_AVAILABLE or not username:
            return None
        try:
            return keyring.get_password(KEYRING_SERVICE, username)
        except KeyringError as e:  # pragma: no cover - dépend de l'OS
            logger.warning(f"Failed to read password from keyring: {e}")
            return None

    @staticmethod
    def _delete_password(username: Optional[str]) -> None:
        """Supprime le mot de passe du trousseau système (silencieux si absent)."""
        if not _KEYRING_AVAILABLE or not username:
            return
        try:
            keyring.delete_password(KEYRING_SERVICE, username)
        except Exception:  # pragma: no cover - absent ou non supporté
            pass

    def _write_credentials_file(self, data: dict) -> None:
        """Écrit le fichier de credentials (sans mot de passe en clair)."""
        with open(self._credentials_file, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        # Restreindre les permissions (Unix only)
        try:
            os.chmod(self._credentials_file, 0o600)
        except (OSError, AttributeError):
            pass  # Windows ou autre

    def _load_saved_credentials(self) -> Optional[dict]:
        """Charge les credentials sauvegardés (si existants).

        Le mot de passe n'est pas stocké dans le JSON mais dans le trousseau
        système ; il est réinjecté ici pour les appelants (restauration de
        session). Les anciens fichiers contenant un mot de passe en clair sont
        automatiquement migrés vers le trousseau puis réécrits sans le secret.
        """
        if not self._credentials_file.exists():
            return None

        try:
            with open(self._credentials_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load saved credentials: {e}")
            return None

        if data.get("method") != "credentials":
            return data

        username = data.get("username")
        legacy_password = data.get("password")

        if legacy_password:
            # Migration: ancien fichier avec mot de passe en clair sur le disque.
            if self._store_password(username, legacy_password):
                logger.info("Migrating plaintext password to system keyring")
                migrated = {k: v for k, v in data.items() if k != "password"}
                migrated["password_in_keyring"] = True
                try:
                    self._write_credentials_file(migrated)
                except Exception as e:
                    logger.warning(f"Failed to rewrite credentials without password: {e}")
            # On garde le mot de passe dans le dict retourné pour cette session.
            return data

        # Cas normal: mot de passe dans le trousseau, à réinjecter.
        password = self._load_password(username)
        if password is not None:
            data["password"] = password
        return data

    def _save_credentials(self, method: str, **kwargs) -> None:
        """Sauvegarde les credentials de manière sécurisée.

        Pour la méthode ``credentials``, le mot de passe est stocké dans le
        trousseau système et jamais écrit en clair. Si le trousseau est
        indisponible, on retombe (en avertissant) sur l'ancien stockage JSON.
        """
        data = {"method": method, **kwargs}

        if method == "credentials":
            username = data.get("username")
            password = data.pop("password", None)
            if password is not None:
                if self._store_password(username, password):
                    data["password_in_keyring"] = True
                else:
                    logger.warning(
                        "keyring indisponible : le mot de passe sera stocké en clair "
                        "dans %s", self._credentials_file,
                    )
                    data["password"] = password

        try:
            logger.info(f"Saving credentials to {self._credentials_file}...")
            self._write_credentials_file(data)
            logger.info(f"Credentials saved successfully (method: {method})")
        except Exception as e:
            logger.error(f"Failed to save credentials: {e}", exc_info=True)

    def _clear_saved_credentials(self) -> None:
        """Supprime les credentials sauvegardés (fichier + entrée trousseau)."""
        try:
            if self._credentials_file.exists():
                with open(self._credentials_file, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                if saved.get("method") == "credentials":
                    self._delete_password(saved.get("username"))
        except Exception:
            pass

        try:
            if self._credentials_file.exists():
                self._credentials_file.unlink()
        except Exception as e:
            logger.warning(f"Failed to clear saved credentials: {e}")

    # ---- Persistance des cookies de session ----

    def _save_cookies(self) -> None:
        """Persiste les cookies de la session courante sur le disque."""
        if self._session is None:
            return
        try:
            data = [
                {
                    'name': c.name,
                    'value': c.value,
                    'domain': c.domain,
                    'path': c.path,
                    'expires': c.expires,
                    'secure': c.secure,
                }
                for c in self._session.cookies
            ]
            with open(self._cookies_file, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            try:
                os.chmod(self._cookies_file, 0o600)
            except (OSError, AttributeError):
                pass  # Windows ou autre
            logger.debug(f"Persisted {len(data)} session cookies")
        except Exception as e:
            logger.warning(f"Failed to persist session cookies: {e}")

    def _load_cookies_into_session(self) -> bool:
        """Charge les cookies persistés dans la session. True si au moins un cookie."""
        if self._session is None or not self._cookies_file.exists():
            return False
        try:
            with open(self._cookies_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read persisted cookies: {e}")
            return False

        if not isinstance(data, list) or not data:
            return False

        import requests.cookies as rc

        count = 0
        for item in data:
            try:
                cookie = rc.create_cookie(
                    name=item['name'],
                    value=item['value'],
                    domain=item.get('domain', ''),
                    path=item.get('path', '/'),
                    expires=item.get('expires'),
                    secure=bool(item.get('secure', False)),
                )
                self._session.cookies.set_cookie(cookie)
                count += 1
            except Exception:
                continue

        logger.debug(f"Loaded {count} persisted cookies into session")
        return count > 0

    def _clear_cookies(self) -> None:
        """Supprime le fichier de cookies persistés."""
        try:
            if self._cookies_file.exists():
                self._cookies_file.unlink()
        except Exception as e:
            logger.warning(f"Failed to clear persisted cookies: {e}")

    def _restore_from_cookies(self, method: AuthMethod) -> bool:
        """Tente de restaurer la session à partir des cookies persistés.

        Retourne True si la session est valide (utilisateur connecté) sans avoir
        eu besoin de rejouer le login. Nettoie les cookies périmés le cas échéant.
        """
        if not self._load_cookies_into_session():
            return False

        params = self._fetch_server_parameters()
        if self._params_is_logged_in(params):
            self._auth_state = AuthState(
                status=AuthStatus.LOGGED_IN,
                method=method,
                last_check=datetime.now(),
            )
            self._fetch_user_info(params)
            logger.info("Session restored from persisted cookies (no login required)")
            return True

        # Cookies périmés : repartir sur une session propre pour le login de repli.
        logger.info("Persisted cookies expired or invalid, will re-login")
        self._session.cookies.clear()
        self._clear_cookies()
        return False

    # ==================== LOGIN METHODS ====================
    
    def login_with_credentials(
        self, 
        username: str, 
        password: str, 
        remember: bool = True
    ) -> AuthState:
        """
        Authentification avec username/password (méthode c:geo).
        
        Args:
            username: Nom d'utilisateur ou email Geocaching.com
            password: Mot de passe
            remember: Si True, sauvegarde les credentials pour les sessions futures
            
        Returns:
            État de l'authentification après la tentative
        """
        with self._session_lock:
            # Toujours créer une nouvelle session pour un login fresh
            logger.info("Creating fresh session for credentials login...")
            self._session = self._create_session()
        
        status = self._do_login(username, password)

        if status == AuthStatus.LOGGED_IN and remember:
            self._save_credentials("credentials", username=username, password=password)
            # Persister les cookies pour restaurer la session sans re-login.
            self._save_cookies()

        return self._auth_state
    
    def _do_login(self, username: str, password: str) -> AuthStatus:
        """
        Effectue le login effectif.
        
        Flow similaire à c:geo:
        1. GET page de login -> extraction du token
        2. POST credentials
        3. Vérification du statut
        """
        try:
            # Étape 1: Récupérer la page de login et le token
            logger.info(f"Fetching login page for {username}...")
            resp = self._session.get(self.LOGIN_URI, timeout=30)
            
            if resp.status_code != 200:
                self._auth_state = AuthState(
                    status=AuthStatus.LOGIN_FAILED,
                    method=AuthMethod.CREDENTIALS,
                    error_message=f"Failed to fetch login page (status {resp.status_code})"
                )
                return AuthStatus.LOGIN_FAILED
            
            # Vérifier si déjà connecté (mais vérifier vraiment avec serverparameters)
            if self._is_logged_in_page(resp.text):
                logger.info(f"Login page suggests already logged in, verifying...")
                params = self._fetch_server_parameters()
                if self._verify_login_status(params):
                    logger.info(f"Confirmed: already logged in as {username}")
                    self._auth_state = AuthState(
                        status=AuthStatus.LOGGED_IN,
                        method=AuthMethod.CREDENTIALS,
                        last_check=datetime.now()
                    )
                    self._fetch_user_info(params)
                    return AuthStatus.LOGGED_IN
                else:
                    logger.info("False positive on login page, proceeding with login...")
            
            # Extraire le token
            token = self._extract_verification_token(resp.text)
            if not token:
                self._auth_state = AuthState(
                    status=AuthStatus.LOGIN_FAILED,
                    method=AuthMethod.CREDENTIALS,
                    error_message="Could not extract verification token from login page"
                )
                return AuthStatus.LOGIN_FAILED
            
            # Étape 2: POST des credentials
            logger.info(f"Posting credentials for {username}...")
            login_data = {
                "UsernameOrEmail": username,
                "Password": password,
                self.REQUEST_VERIFICATION_TOKEN: token
            }
            
            resp = self._session.post(
                self.LOGIN_URI,
                data=login_data,
                timeout=30,
                allow_redirects=True
            )
            
            logger.debug(f"Login POST response: status={resp.status_code}, url={resp.url}")
            
            # Si on est redirigé vers /play/search ou /account/dashboard, c'est un succès
            if resp.status_code == 200 and ('/play/search' in resp.url or '/account/dashboard' in resp.url):
                logger.info(f"Login successful for {username} (redirected to {resp.url})")
                self._auth_state = AuthState(
                    status=AuthStatus.LOGGED_IN,
                    method=AuthMethod.CREDENTIALS,
                    last_check=datetime.now()
                )
                self._fetch_user_info()
                return AuthStatus.LOGGED_IN
            
            # Étape 3: Analyser la réponse
            return self._analyze_login_response(resp.text, username)
            
        except requests.RequestException as e:
            logger.error(f"Login request failed: {e}")
            self._auth_state = AuthState(
                status=AuthStatus.LOGIN_FAILED,
                method=AuthMethod.CREDENTIALS,
                error_message=f"Network error: {str(e)}"
            )
            return AuthStatus.LOGIN_FAILED
    
    def _extract_verification_token(self, html: str) -> Optional[str]:
        """Extrait le __RequestVerificationToken de la page HTML."""
        # Pattern: <input name="__RequestVerificationToken" type="hidden" value="XXX" />
        pattern = r'<input[^>]*name=["\']__RequestVerificationToken["\'][^>]*value=["\']([^"\']+)["\']'
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1)
        
        # Alternative: attributs dans un ordre différent
        pattern2 = r'<input[^>]*value=["\']([^"\']+)["\'][^>]*name=["\']__RequestVerificationToken["\']'
        match2 = re.search(pattern2, html, re.IGNORECASE)
        if match2:
            return match2.group(1)
        
        return None
    
    def _is_logged_in_page(self, html: str) -> bool:
        """Vérifie si la page indique qu'on est connecté."""
        # Vérifier d'abord isLoggedIn:true qui est le plus fiable
        if '"isLoggedIn":true' in html or '"isLoggedIn": true' in html:
            return True
        
        # Indicateurs secondaires (moins fiables)
        indicators = [
            'account/logout',
            'sign out',
        ]
        
        html_lower = html.lower()
        # Compter combien d'indicateurs sont présents
        matches = sum(1 for ind in indicators if ind.lower() in html_lower)
        
        # Exiger au moins 2 indicateurs pour éviter les faux positifs
        logger.debug(f"Login page indicators found: {matches}/{len(indicators)}")
        return matches >= 2
    
    def _analyze_login_response(self, html: str, username: str) -> AuthStatus:
        """Analyse la réponse du login pour déterminer le statut."""
        
        logger.debug(f"Analyzing login response (length: {len(html)} chars)")
        
        # Succès
        if self._is_logged_in_page(html):
            logger.info(f"Login successful for {username}")
            self._auth_state = AuthState(
                status=AuthStatus.LOGGED_IN,
                method=AuthMethod.CREDENTIALS,
                last_check=datetime.now()
            )
            self._fetch_user_info()
            return AuthStatus.LOGGED_IN

        html_lower = html.lower()

        # Compte non validé — marqueurs spécifiques (pas le simple mot "validate"
        # qui matche jquery.validate.js et n'importe quel formulaire).
        if 'account/join/success' in html_lower or re.search(
            r'(not been validated|validate your account|valider votre compte|confirm your email)',
            html_lower,
        ):
            logger.warning(f"Account not validated for {username}")
            self._auth_state = AuthState(
                status=AuthStatus.ACCOUNT_NOT_VALIDATED,
                method=AuthMethod.CREDENTIALS,
                error_message="Account not validated. Please check your email."
            )
            return AuthStatus.ACCOUNT_NOT_VALIDATED

        # Identifiants incorrects — vérifié AVANT le captcha : un mauvais mot de
        # passe re-rend la page signin, qui embarque toujours le script reCAPTCHA.
        # On s'appuie sur des marqueurs d'erreur réels (validation summary ASP.NET
        # ou message explicite), pas sur un vague "incorrect" présent ailleurs.
        wrong_credentials = (
            'signup-validation-error' in html_lower
            or 'validation-summary-errors' in html_lower
            or re.search(
                r'(username|e-?mail)[^<]{0,80}(password|mot de passe)[^<]{0,80}'
                r'(incorrect|invalid|erron)',
                html_lower,
            )
            or re.search(
                r'(password|mot de passe)[^<]{0,40}(incorrect|invalid|erron)',
                html_lower,
            )
        )
        if wrong_credentials:
            logger.warning(f"Wrong credentials for {username}")
            self._auth_state = AuthState(
                status=AuthStatus.LOGIN_FAILED,
                method=AuthMethod.CREDENTIALS,
                error_message="Username or password incorrect"
            )
            return AuthStatus.LOGIN_FAILED

        # Captcha réellement requis — exiger un widget captcha rendu dans un <div>
        # (l'attribut class="g-recaptcha" du conteneur, ou un challenge hCaptcha),
        # et non la simple présence du script api.js toujours chargé par la page.
        captcha_required = (
            re.search(r'class="[^"]*\bg-recaptcha\b[^"]*"', html_lower)
            or re.search(r'class="[^"]*\bh-captcha\b[^"]*"', html_lower)
            or 'data-sitekey' in html_lower
            or 'unusual activity' in html_lower
        )
        if captcha_required:
            logger.warning(f"Captcha required for {username}")
            self._auth_state = AuthState(
                status=AuthStatus.CAPTCHA_REQUIRED,
                method=AuthMethod.CREDENTIALS,
                error_message="Captcha required. Please try again later or use browser cookies method."
            )
            return AuthStatus.CAPTCHA_REQUIRED

        # Échec générique
        logger.warning(f"Login failed for {username} (unknown reason)")
        # Log un extrait de la réponse pour débogage
        snippet = html[:500] if len(html) > 500 else html
        logger.debug(f"Response snippet: {snippet}")
        self._auth_state = AuthState(
            status=AuthStatus.LOGIN_FAILED,
            method=AuthMethod.CREDENTIALS,
            error_message="Login failed for unknown reason"
        )
        return AuthStatus.LOGIN_FAILED
    
    def login_with_browser_cookies(
        self, 
        browser: str = "auto",
        remember: bool = True
    ) -> AuthState:
        """
        Authentification avec les cookies du navigateur.
        
        Args:
            browser: Navigateur à utiliser ('firefox', 'chrome', 'edge', 'auto')
            remember: Si True, sauvegarde la préférence pour les sessions futures
            
        Returns:
            État de l'authentification après la tentative
        """
        with self._session_lock:
            if self._session is None:
                self._session = self._create_session()
            else:
                self._session.cookies.clear()
        
        self._load_browser_cookies(browser)

        params = self._fetch_server_parameters()
        if self._verify_login_status(params):
            self._auth_state = AuthState(
                status=AuthStatus.LOGGED_IN,
                method=AuthMethod.BROWSER_COOKIES,
                last_check=datetime.now()
            )
            self._fetch_user_info(params)

            if remember:
                self._save_credentials("browser_cookies", browser=browser)
            
            logger.info(f"Logged in with {browser} browser cookies")
        else:
            self._auth_state = AuthState(
                status=AuthStatus.LOGIN_FAILED,
                method=AuthMethod.BROWSER_COOKIES,
                error_message="No valid session found in browser cookies. Please login in your browser first."
            )
        
        return self._auth_state
    
    def _load_browser_cookies(self, browser: str = "auto") -> None:
        """Charge les cookies du navigateur spécifié."""
        browsers_map = {
            'firefox': [('Firefox', browser_cookie3.firefox)],
            'chrome': [('Chrome', browser_cookie3.chrome)],
            'edge': [('Edge', browser_cookie3.edge)],
            'auto': [
                ('Firefox', browser_cookie3.firefox),
                ('Chrome', browser_cookie3.chrome),
                ('Edge', browser_cookie3.edge),
            ],
        }
        
        browsers = browsers_map.get(browser.lower(), browsers_map['auto'])
        
        for browser_name, browser_func in browsers:
            try:
                logger.debug(f"Trying to load cookies from {browser_name}...")
                cookies = browser_func(domain_name='geocaching.com')
                
                cookie_count = 0
                for cookie in cookies:
                    self._session.cookies.set_cookie(cookie)
                    cookie_count += 1
                
                if cookie_count > 0:
                    logger.info(f"Loaded {cookie_count} cookies from {browser_name}")
                    return
                    
            except Exception as e:
                logger.debug(f"Failed to load cookies from {browser_name}: {e}")
                continue
        
        logger.warning("No browser cookies could be loaded")
    
    def _fetch_server_parameters(self) -> Optional[dict]:
        """GET SERVER_PARAMS_URI une seule fois et retourne le dict JSON parsé.

        La page renvoie du JavaScript de la forme ``var serverParameters = {...};``.
        Retourne ``None`` en cas d'échec réseau, HTTP != 200 ou JSON introuvable.
        Ce point d'entrée unique évite de télécharger deux fois la même ressource
        pour vérifier la connexion puis récupérer les infos utilisateur.
        """
        try:
            resp = self._session.get(self.SERVER_PARAMS_URI, timeout=30)
            if resp.status_code != 200:
                logger.debug(f"serverparameters returned status {resp.status_code}")
                return None

            text = resp.text
            start = text.find('{')
            end = text.rfind(';')
            if start == -1 or end == -1 or end <= start:
                logger.debug("serverparameters: no JSON payload found")
                return None

            return json.loads(text[start:end])
        except Exception as e:
            logger.warning(f"Failed to fetch server parameters: {e}")
            return None

    @staticmethod
    def _params_is_logged_in(params: Optional[dict]) -> bool:
        """Détermine l'état connecté depuis les serverParameters parsés."""
        if not params:
            return False
        user_info = params.get('user:info')
        if isinstance(user_info, dict) and user_info.get('isLoggedIn'):
            return True
        return bool(params.get('isLoggedIn'))

    def _verify_login_status(self, params: Optional[dict] = None) -> bool:
        """Vérifie si la session actuelle est authentifiée.

        ``params`` peut être fourni pour réutiliser un fetch serverparameters déjà
        effectué (voir _fetch_server_parameters) et éviter un aller-retour réseau.
        """
        if params is None:
            params = self._fetch_server_parameters()
        return self._params_is_logged_in(params)

    def _fetch_user_info(self, params: Optional[dict] = None) -> None:
        """Récupère les informations de l'utilisateur connecté.

        ``params`` peut être fourni pour réutiliser un fetch serverparameters déjà
        effectué et éviter un second téléchargement.
        """
        try:
            if params is None:
                params = self._fetch_server_parameters()
            if params is None:
                logger.warning("Failed to fetch user info: no server parameters")
                return

            user_info_data = params.get('user:info', {})
            if user_info_data and user_info_data.get('isLoggedIn'):
                self._auth_state.user_info = UserInfo(
                    username=user_info_data.get('username', 'Unknown'),
                    reference_code=user_info_data.get('referenceCode'),
                    user_type=user_info_data.get('userType'),
                    public_guid=user_info_data.get('publicGuid'),
                    avatar_url=user_info_data.get('avatarUrl'),
                    date_format=user_info_data.get('dateFormat'),
                )
                logger.info(f"User info fetched: {self._auth_state.user_info.username} ({self._auth_state.user_info.user_type})")
            else:
                logger.warning(f"User info indicates not logged in: isLoggedIn={user_info_data.get('isLoggedIn')}")

        except Exception as e:
            logger.warning(f"Failed to fetch user info: {e}", exc_info=True)
    
    # ==================== PROFILE STATS ====================
    
    PROFILE_STATS_URI = "https://www.geocaching.com/api/proxy/web/v1/users/me"
    
    def fetch_profile_stats(self, force: bool = False) -> Optional[dict]:
        """
        Récupère les statistiques du profil utilisateur.
        
        Args:
            force: Si True, force la récupération même si les stats sont récentes
            
        Returns:
            Dict avec les stats ou None si erreur
        """
        if not self.is_logged_in():
            logger.warning("Cannot fetch profile stats: not logged in")
            return None
        
        # Vérifier si on a des stats récentes (moins de 5 minutes)
        if not force and self._auth_state.user_info and self._auth_state.user_info.stats_last_updated:
            age = datetime.now() - self._auth_state.user_info.stats_last_updated
            if age < timedelta(minutes=5):
                return self._get_current_stats()
        
        try:
            # Utiliser l'API proxy de Geocaching.com
            resp = self._session.get(
                self.PROFILE_STATS_URI,
                headers={
                    'Accept': 'application/json',
                },
                timeout=30
            )
            
            logger.debug(f"Profile stats API response: status={resp.status_code}")

            if resp.status_code != 200:
                logger.warning(f"Failed to fetch profile stats: status {resp.status_code}, body={resp.text[:500]}")
                # Essayer la méthode alternative via le dashboard
                return self._fetch_profile_stats_from_dashboard()

            data = resp.json()

            # Log pour debug
            logger.debug(f"API response keys: {list(data.keys())}")
            logger.debug(f"Full API response: {data}")

            if 'awardedFavoritePoints' not in data:
                logger.debug("Profile stats API does not include awardedFavoritePoints, falling back to dashboard")
                return self._fetch_profile_stats_from_dashboard()
            
            # Extraire les stats
            if self._auth_state.user_info:
                self._auth_state.user_info.finds_count = data.get('findCount', 0)
                self._auth_state.user_info.hides_count = data.get('hideCount', 0)
                self._auth_state.user_info.favorite_points = data.get('favoritePoints', 0)
                self._auth_state.user_info.awarded_favorite_points = data.get('awardedFavoritePoints', 0)
                self._auth_state.user_info.stats_last_updated = datetime.now()
                
                logger.info(f"Profile stats updated: finds={self._auth_state.user_info.finds_count}, "
                           f"hides={self._auth_state.user_info.hides_count}, "
                           f"PF={self._auth_state.user_info.awarded_favorite_points}")
            
            return self._get_current_stats()
            
        except Exception as e:
            logger.warning(f"Failed to fetch profile stats: {e}", exc_info=True)
            # Essayer la méthode alternative
            return self._fetch_profile_stats_from_dashboard()
    
    def _fetch_profile_stats_from_dashboard(self) -> Optional[dict]:
        """
        Méthode alternative: récupère les stats depuis le profil public.
        Utilisée si l'API proxy ne fonctionne pas.
        """
        try:
            # Essayer d'abord le profil public de l'utilisateur
            if self._auth_state.user_info and self._auth_state.user_info.username:
                profile_url = f"https://www.geocaching.com/p/default.aspx?u={self._auth_state.user_info.username}"
                logger.info(f"Fetching profile stats from public profile: {profile_url}")
                resp = self._session.get(profile_url, timeout=30)
                
                if resp.status_code == 200:
                    html = resp.text
                    
                    # Le profil public contient les stats dans un format plus structuré
                    # Chercher dans les sections de stats
                    finds_match = re.search(r'<strong[^>]*>(\d+)</strong>\s*(?:<[^>]*>)*\s*Finds?', html, re.IGNORECASE)
                    hides_match = re.search(r'<strong[^>]*>(\d+)</strong>\s*(?:<[^>]*>)*\s*Hides?', html, re.IGNORECASE)
                    
                    # Pour les favorite points, chercher dans la section appropriée
                    fp_match = re.search(r'<strong[^>]*>(\d+)</strong>\s*(?:<[^>]*>)*\s*Favorite\s+Points?', html, re.IGNORECASE)
                    
                    if finds_match or hides_match or fp_match:
                        logger.info(f"Found stats in public profile: finds={bool(finds_match)}, hides={bool(hides_match)}, fp={bool(fp_match)}")
                        
                        if self._auth_state.user_info:
                            if finds_match:
                                self._auth_state.user_info.finds_count = int(finds_match.group(1))
                            if hides_match:
                                self._auth_state.user_info.hides_count = int(hides_match.group(1))
                            if fp_match:
                                self._auth_state.user_info.awarded_favorite_points = int(fp_match.group(1))
                            
                            self._auth_state.user_info.stats_last_updated = datetime.now()
                        
                        return self._get_current_stats()
            
            # Fallback sur le dashboard si le profil public ne fonctionne pas
            logger.info("Falling back to dashboard")
            resp = self._session.get(self.DASHBOARD_URI, timeout=30)
            if resp.status_code != 200:
                logger.warning(f"Failed to fetch dashboard: status {resp.status_code}")
                return None
            
            html = resp.text
            
            # Log un échantillon du HTML pour debug (section Favorites)
            if logger.isEnabledFor(logging.DEBUG):
                favorites_sample = re.search(r'Favorites?.{0,500}', html, re.IGNORECASE | re.DOTALL)
                if favorites_sample:
                    logger.debug(f"=== FAVORITES HTML SAMPLE ===\n{favorites_sample.group(0)}\n=== END SAMPLE ===")

            dashboard_stats = self._extract_dashboard_favorite_stats(html)
            logger.debug(
                "Dashboard favorite stats: remaining=%s, logs_until_next=%s, total=%s",
                dashboard_stats.get('remaining_points'),
                dashboard_stats.get('logs_until_next_point'),
                dashboard_stats.get('total_favorite_points'),
            )
            
            # Chercher les stats dans le HTML
            # Pattern pour les nombres dans le dashboard
            finds_match = re.search(r'data-finds-count="(\d+)"', html)
            hides_match = re.search(r'data-hides-count="(\d+)"', html)
            fp_match = re.search(r'data-favorite-points="(\d+)"', html)
            
            # Alternative: chercher dans le JSON embarqué
            if not finds_match:
                # Chercher dans serverParameters ou autre JSON
                json_match = re.search(r'"findCount"\s*:\s*(\d+)', html)
                if json_match:
                    finds_match = json_match
            
            # Chercher d'autres patterns pour hideCount et favoritePoints
            if not hides_match:
                hides_match = re.search(r'"hideCount"\s*:\s*(\d+)', html)
                if not hides_match:
                    # Chercher "Hides" ou "Hidden" suivi d'un nombre
                    hides_match = re.search(r'(?:Hides?|Hidden)\s*[:\s]*(\d+)', html, re.IGNORECASE)
            
            if not fp_match:
                fp_match = re.search(r'"awardedFavoritePoints"\s*:\s*(\d+)', html)
                if not fp_match:
                    remaining_points = dashboard_stats.get('remaining_points')
                    if remaining_points is not None:
                        fp_match = re.match(r'(\d+)', str(remaining_points))
                if not fp_match:
                    # Chercher spécifiquement "Favorite points to award: <strong>32</strong>"
                    fp_match = re.search(r'Favorite\s+points?\s+to\s+award\s*:\s*<strong>(\d+)</strong>', html, re.IGNORECASE)
                if not fp_match:
                    # Fallback sans le tag <strong>
                    fp_match = re.search(r'Favorite\s+points?\s+to\s+award\s*:\s*(\d+)', html, re.IGNORECASE)
                if not fp_match:
                    # Dernier fallback: chercher "Favorite Points" ou "FP" suivi d'un nombre
                    fp_match = re.search(r'(?:Favorite\s+Points?|FP)\s*[:\s]*(\d+)', html, re.IGNORECASE)
            
            # Chercher dans les sections spécifiques du dashboard
            if not hides_match or not fp_match:
                # Chercher dans la section profile stats
                stats_section = re.search(r'<div[^>]*class="[^"]*profile-stats[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
                if stats_section:
                    stats_html = stats_section.group(1)
                    if not hides_match:
                        hides_match = re.search(r'(\d+)\s*(?:Hides?|Hidden)', stats_html, re.IGNORECASE)
                    if not fp_match:
                        fp_match = re.search(r'(\d+)\s*(?:Favorite\s+Points?|FP)', stats_html, re.IGNORECASE)
            
            logger.debug(f"Dashboard parsing: finds={bool(finds_match)}, hides={bool(hides_match)}, fp={bool(fp_match)}")

            # Si toujours pas trouvé, chercher n'importe quel nombre près de "hide" pour debug
            if not hides_match and logger.isEnabledFor(logging.DEBUG):
                all_hides = re.findall(r'hide[^>]{0,50}?(\d+)', html, re.IGNORECASE)
                if all_hides:
                    logger.debug(f"Found potential hide counts: {all_hides[:5]}")
            
            if self._auth_state.user_info:
                if finds_match:
                    self._auth_state.user_info.finds_count = int(finds_match.group(1))
                if hides_match:
                    self._auth_state.user_info.hides_count = int(hides_match.group(1))
                if fp_match:
                    self._auth_state.user_info.awarded_favorite_points = int(fp_match.group(1))
                if dashboard_stats.get('total_favorite_points') is not None:
                    self._auth_state.user_info.favorite_points = dashboard_stats['total_favorite_points']
                
                self._auth_state.user_info.stats_last_updated = datetime.now()

                logger.debug(f"Profile stats from dashboard: finds={self._auth_state.user_info.finds_count}")

            return self._get_current_stats()
            
        except Exception as e:
            logger.warning(f"Failed to fetch stats from dashboard: {e}")
            return None

    @staticmethod
    def _extract_dashboard_favorite_stats(html: str) -> dict[str, Optional[int]]:
        """Extrait les PF depuis le dashboard Geocaching.com actuel."""
        candidates = GeocachingAuthService._dashboard_text_candidates(html)
        summary_stats = GeocachingAuthService._extract_favorite_point_summary(candidates)

        def find_number_after_label(label_pattern: str) -> Optional[int]:
            patterns = [
                rf'{label_pattern}\s*:\s*(?:<[^>]+>\s*)*([\d\s,\.]+)',
                rf'{label_pattern}\s*:\s*\\u003c[^\\]+\\u003e\s*([\d\s,\.]+)',
                rf'{label_pattern}\s*:\s*([\d\s,\.]+)',
            ]

            for candidate in candidates:
                for pattern in patterns:
                    match = re.search(pattern, candidate, re.IGNORECASE)
                    if not match:
                        continue

                    raw_value = match.group(1)
                    digits = re.sub(r'\D', '', raw_value)
                    if digits:
                        return int(digits)

            return None

        return {
            'remaining_points': summary_stats.get('remaining_points') or find_number_after_label(r'Remaining\s+points'),
            'logs_until_next_point': summary_stats.get('logs_until_next_point') or find_number_after_label(r'Logs\s+until\s+next\s+point'),
            'total_favorite_points': summary_stats.get('total_favorite_points') or find_number_after_label(r'Total\s+Favorite\s+points'),
        }

    @staticmethod
    def _extract_favorite_point_summary(candidates: list[str]) -> dict[str, Optional[int]]:
        """Extrait window.sidebarProps.favoritePointSummary."""
        for candidate in candidates:
            match = re.search(r'favoritePointSummary\s*:\s*\{(?P<body>[^}]+)\}', candidate, re.IGNORECASE)
            if not match:
                match = re.search(r'"favoritePointSummary"\s*:\s*\{(?P<body>[^}]+)\}', candidate, re.IGNORECASE)
            if not match:
                continue

            body = match.group('body')

            def get_value(key: str) -> Optional[int]:
                value_match = re.search(rf'["\']?{key}["\']?\s*:\s*["\']?([\d\s,\.]+)', body, re.IGNORECASE)
                if not value_match:
                    return None
                digits = re.sub(r'\D', '', value_match.group(1))
                return int(digits) if digits else None

            return {
                'remaining_points': get_value('Available'),
                'logs_until_next_point': get_value('LogsNeededToNext'),
                'total_favorite_points': get_value('Total'),
            }

        return {
            'remaining_points': None,
            'logs_until_next_point': None,
            'total_favorite_points': None,
        }

    @staticmethod
    def _dashboard_text_candidates(html: str) -> list[str]:
        """Retourne plusieurs vues textuelles du dashboard pour les pages HTML/Next.js."""
        candidates = [html]

        unescaped = html_lib.unescape(html)
        if unescaped not in candidates:
            candidates.append(unescaped)

        json_html = html.replace('\\u003c', '<').replace('\\u003e', '>').replace('\\u0026', '&')
        json_html = json_html.replace('\\"', '"').replace('\\/', '/')
        json_html = html_lib.unescape(json_html)
        if json_html not in candidates:
            candidates.append(json_html)

        for candidate in list(candidates):
            if '<' not in candidate:
                continue
            text = BeautifulSoup(candidate, 'html.parser').get_text(' ', strip=True)
            if text and text not in candidates:
                candidates.append(text)

        return candidates
    
    def _get_current_stats(self) -> Optional[dict]:
        """Retourne les stats actuelles sous forme de dict."""
        if not self._auth_state.user_info:
            return None
        
        return {
            "finds_count": self._auth_state.user_info.finds_count,
            "hides_count": self._auth_state.user_info.hides_count,
            "favorite_points": self._auth_state.user_info.favorite_points,
            "awarded_favorite_points": self._auth_state.user_info.awarded_favorite_points,
            "stats_last_updated": self._auth_state.user_info.stats_last_updated.isoformat() 
                if self._auth_state.user_info.stats_last_updated else None
        }
    
    # ==================== LOGOUT & STATUS ====================
    
    def logout(self) -> AuthState:
        """Déconnexion de Geocaching.com."""
        with self._session_lock:
            if self._session:
                try:
                    self._session.post(self.LOGOUT_URI, timeout=30)
                except Exception as e:
                    logger.warning(f"Logout request failed: {e}")
                
                self._session.cookies.clear()

        self._clear_saved_credentials()
        self._clear_cookies()

        self._auth_state = AuthState(
            status=AuthStatus.LOGGED_OUT,
            method=AuthMethod.NONE
        )
        
        logger.info("Logged out from Geocaching.com")
        return self._auth_state
    
    def get_auth_state(self, force_check: bool = False) -> AuthState:
        """
        Retourne l'état actuel de l'authentification.
        
        Args:
            force_check: Si True, vérifie le statut même si le cache est valide
            
        Returns:
            État de l'authentification
        """
        # S'assurer qu'une session existe afin de tenter une restauration automatique
        if self._session is None:
            self.get_session()

        # Vérifier si le cache est encore valide (lecture rapide sous verrou)
        with self._state_lock:
            if not force_check and self._auth_state.last_check:
                age = datetime.now() - self._auth_state.last_check
                if age < timedelta(seconds=self.STATE_CACHE_TTL):
                    return self._auth_state

        # Vérifier le statut réel — le fetch réseau est fait HORS verrou pour ne
        # pas sérialiser les requêtes concurrentes (scrapes/refresh simultanés).
        params = self._fetch_server_parameters() if self._session else None
        logged_in = self._params_is_logged_in(params)

        with self._state_lock:
            if logged_in:
                self._auth_state.status = AuthStatus.LOGGED_IN
                if not self._auth_state.user_info:
                    self._fetch_user_info(params)  # params fournis => pas de réseau
            elif self._auth_state.status == AuthStatus.LOGGED_IN:
                # Était connecté mais plus maintenant
                self._auth_state.status = AuthStatus.LOGGED_OUT

            # Toujours amorcer le cache, y compris en état déconnecté/non configuré,
            # sinon chaque is_logged_in() redéclenche un GET serverparameters (~300-800 ms).
            # De nombreux appelants (GeocachingScraper, GeocachingSearchClient, routes)
            # instancient et vérifient l'état à chaque requête.
            self._auth_state.last_check = datetime.now()

            return self._auth_state
    
    def is_logged_in(self) -> bool:
        """Vérifie rapidement si l'utilisateur est connecté."""
        return self.get_auth_state().status == AuthStatus.LOGGED_IN
    
    def get_configured_method(self) -> Optional[str]:
        """Retourne la méthode d'authentification configurée."""
        saved = self._load_saved_credentials()
        return saved.get("method") if saved else None


# Singleton instance
_auth_service: Optional[GeocachingAuthService] = None


def get_auth_service() -> GeocachingAuthService:
    """Retourne l'instance singleton du service d'authentification."""
    global _auth_service
    if _auth_service is None:
        _auth_service = GeocachingAuthService()
    return _auth_service
