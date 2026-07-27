# Connexion Geocaching.com — Documentation technique

> Authentification centralisée à Geocaching.com : login (identifiants ou cookies
> navigateur), mémorisation sécurisée du mot de passe (trousseau système),
> persistance de session (cookies), vérification d'état, statistiques de profil,
> et partage de la session HTTP avec tous les services qui téléchargent des
> données (scraper, logs, notes, coordonnées, recherche, imports).
> Dernière mise à jour : juillet 2026.

---

## 1. Vue d'ensemble

GeoApp n'a **pas** (encore) accès à l'API officielle Groundspeak. Toutes les
interactions passent donc par le site web `geocaching.com`, comme le fait c:geo :
on ouvre une session HTTP authentifiée, puis on scrape les pages ou on appelle
les endpoints web internes.

Un service singleton, `GeocachingAuthService`, centralise **toute**
l'authentification et expose une unique `requests.Session` authentifiée que les
autres services réutilisent. Objectifs :

- une seule source de vérité pour l'état de connexion et les cookies ;
- deux méthodes de login : **identifiants** (username/mot de passe, recommandé) et
  **cookies du navigateur** (Firefox/Chrome/Edge, via `browser_cookie3`) ;
- **aucun mot de passe en clair sur le disque** : il est délégué au trousseau
  système (Windows Credential Manager / macOS Keychain / Secret Service) ;
- **restauration de session sans re-login** grâce à des cookies persistés ;
- un **cache d'état** (5 min) pour éviter de marteler `geocaching.com` à chaque
  vérification `is_logged_in()`.

```
┌───────────────────────────┐
│   Frontend (widget Theia) │  geocaching-auth-widget.tsx
│   /api/auth/*             │
└─────────────┬─────────────┘
              │ REST
┌─────────────▼─────────────┐
│  blueprints/auth.py       │  routes login/logout/forget/status/profile
└─────────────┬─────────────┘
              │
┌─────────────▼─────────────────────────────────────────────┐
│  GeocachingAuthService (singleton)                         │
│  - requests.Session partagée + cookies                     │
│  - AuthState (statut, méthode, UserInfo)                   │
│  - stockage credentials (JSON) + mot de passe (keyring)    │
│  - cookies persistés (.gc_cookies.json)                    │
└─────────────┬─────────────────────────────────────────────┘
              │ get_session()  (même Session pour tous)
   ┌──────────┼───────────┬───────────┬─────────────┬─────────────┐
   ▼          ▼           ▼           ▼             ▼             ▼
 Scraper   LogsClient  NotesClient  PushCoords   SearchClient  Importers
                                                              (bookmark / PQ)
```

---

## 2. Localisation du code

```
backend/gc_backend/services/
└── geocaching_auth.py          # LE service central (login, session, keyring, cookies, stats)

backend/gc_backend/blueprints/
└── auth.py                     # Routes REST /api/auth/*

backend/gc_backend/geocaches/
├── scraper.py                  # GeocachingScraper : page cache -> ScrapedGeocache
├── search_client.py            # Recherche « autour de » (API web interne)
├── bookmark_list_importer.py   # Listes de favoris (Next.js/API/HTML)
└── pocket_query_importer.py    # Pocket Queries (téléchargement GPX)

backend/gc_backend/services/
├── geocaching_logs.py          # Récupération des logs (userToken + logbook)
├── geocaching_personal_notes.py# Lecture/écriture de la note personnelle
├── geocaching_submit_logs.py   # Publication de logs
└── geocaching_push_coordinates.py # Envoi/suppression de coordonnées corrigées

frontend/theia-extensions/zones/src/browser/
└── geocaching-auth-widget.tsx  # Widget « Connexion Geocaching.com »

backend/tests/
├── test_geocaching_auth_favorite_points.py  # Parsing des PF (dashboard)
└── test_geocaching_scraper.py               # Extraction type de cache
```

Consommateurs plus éloignés (mêmes conventions) : `checkers/session.py`,
`blueprints/checkers.py`, `services/checkers/adapters/geocaching_solution_checker.py`.

---

## 3. Modèle de données

Défini dans `geocaching_auth.py`.

### Enums

| Enum | Valeurs | Rôle |
|------|---------|------|
| `AuthMethod` | `none`, `browser_cookies`, `credentials` | Comment on s'est authentifié |
| `AuthStatus` | `not_configured`, `logged_in`, `logged_out`, `login_failed`, `captcha_required`, `account_not_validated` | Statut courant |

### Dataclasses

```python
@dataclass
class UserInfo:
    username: str
    reference_code: str | None
    user_type: str | None            # Basic / Premium / ...
    public_guid: str | None
    avatar_url: str | None
    date_format: str | None
    finds_count: int | None
    hides_count: int | None
    favorite_points: int | None          # total de PF gagnés
    awarded_favorite_points: int | None  # PF disponibles à distribuer
    stats_last_updated: datetime | None

@dataclass
class AuthState:
    status: AuthStatus
    method: AuthMethod
    user_info: UserInfo | None
    last_check: datetime | None      # amorce le cache d'état (TTL 5 min)
    error_message: str | None
```

`AuthState` est la structure sérialisée vers le frontend par
`_auth_state_to_dict()` (blueprint).

---

## 4. Stockage et sécurité

### 4.1 Répertoire de données

`_get_credentials_file_path()` choisit le dossier (créé si absent) :

| Contexte | Dossier |
|----------|---------|
| Variable `GEOAPP_AUTH_DATA_DIR` définie | sa valeur (utilisé par les tests) |
| Windows | `%LOCALAPPDATA%\GeoApp` (repli `%APPDATA%`, sinon `~/AppData/Local/GeoApp`) |
| Autre | `$XDG_CONFIG_HOME/geoapp` (sinon `~/.config/geoapp`) |

Deux fichiers y sont écrits :

- **`.gc_credentials.json`** — méthode + username, **jamais le mot de passe** quand
  keyring est disponible :
  ```json
  { "method": "credentials", "username": "pseudo", "password_in_keyring": true }
  ```
  Pour la méthode cookies : `{ "method": "browser_cookies", "browser": "auto" }`.

- **`.gc_cookies.json`** — cookies de la session (liste
  `{name, value, domain, path, expires, secure}`), pour restaurer la session sans
  re-login. Permissions restreintes à `0600` sous Unix (`os.chmod`, no-op sous
  Windows).

### 4.2 Mot de passe → trousseau système

Le mot de passe est délégué à `keyring` (service `GeoApp:Geocaching.com`, clé =
username). Sous Windows, cela s'appuie sur le **Credential Manager** (chiffré
DPAPI) via `WinVaultKeyring`.

- `_store_password(username, password)` / `_load_password(username)` /
  `_delete_password(username)` encapsulent l'accès, tolérants aux erreurs.
- **Repli gracieux** : si keyring est indisponible, le mot de passe est écrit en
  clair dans le JSON (avec un `logger.warning`) — l'app reste fonctionnelle.
- **Migration** : un ancien `.gc_credentials.json` contenant un `password` en clair
  est automatiquement migré vers le trousseau au premier chargement, puis réécrit
  sans le secret (`_load_saved_credentials`).

> `keyring` est une dépendance optionnelle au sens du code (import protégé,
> `_KEYRING_AVAILABLE`) mais listée dans `requirements.txt`.

---

## 5. La session HTTP partagée

### 5.1 Création et User-Agent

`_create_session()` crée une `requests.Session` avec un **User-Agent unique et
stable**, la constante module `GEOAPP_USER_AGENT` (`"GeoApp/1.0
(+https://mysterai.io)"`). Un UA qui change au fil des requêtes est un signal de
bot : **tous** les clients (scraper, logs, notes, push-coords, recherche, imports)
réutilisent cette constante ou héritent de l'UA de la session partagée.

> Règle : **ne jamais muter les en-têtes de la session partagée** dans un client
> (ex. `Accept: application/json`, `X-Requested-With`). Ces en-têtes spécifiques
> se passent **par requête**, sinon ils fuitent sur les requêtes HTML d'autres
> services.

### 5.2 Accès et restauration automatique

`get_session()` (verrou `_session_lock`) crée la session au premier appel puis
tente `_try_restore_session()`. Ordre de restauration pour la méthode
`credentials` :

1. **Cookies persistés** (`_restore_from_cookies`) : on recharge `.gc_cookies.json`
   dans la session et on vérifie l'état via `serverparameters`. Si connecté →
   terminé, **sans login réseau**. Si périmés → cookies nettoyés, on continue.
2. **Re-login identifiants** : `_do_login(username, password)` ; en cas de succès,
   les cookies sont re-persistés (`_save_cookies`).

Pour la méthode `browser_cookies`, la restauration automatique est
**volontairement désactivée** : recharger les cookies du navigateur doit rester
une action explicite de l'utilisateur (sinon une installation paraîtrait connectée
juste parce que Firefox a une session GC ouverte).

---

## 6. Flux de login

### 6.1 Identifiants (méthode c:geo) — `login_with_credentials`

```
1. GET  https://www.geocaching.com/account/signin
        └─ extraire __RequestVerificationToken (regex sur le <input hidden>)
2. POST https://www.geocaching.com/account/signin
        body = { UsernameOrEmail, Password, __RequestVerificationToken }
        allow_redirects=True
3. Décision :
   - redirigé vers /play/search ou /account/dashboard  → succès
   - sinon → _analyze_login_response(html)
4. Si succès et remember → _save_credentials(...) + _save_cookies()
```

`_analyze_login_response()` teste les cas **dans cet ordre** (l'ordre est
important) :

1. **Connecté** (`_is_logged_in_page` : `"isLoggedIn":true`, ou ≥ 2 indicateurs
   secondaires).
2. **Compte non validé** — marqueurs précis (`account/join/success`, « not been
   validated », « valider votre compte »…), pas le simple mot « validate » qui
   matcherait `jquery.validate.js`.
3. **Identifiants incorrects** — vérifié **avant** le captcha, car un mauvais mot
   de passe re-rend la page signin qui embarque toujours le script reCAPTCHA. On
   s'appuie sur des marqueurs d'erreur réels (`validation-summary-errors`,
   `signup-validation-error`, message explicite « password … incorrect »).
4. **Captcha requis** — uniquement si un **widget** captcha est réellement rendu
   (`class="g-recaptcha"`, `class="h-captcha"`, `data-sitekey`, « unusual
   activity »), pas juste la présence du script `api.js`.
5. **Échec générique**.

### 6.2 Cookies navigateur — `login_with_browser_cookies`

`_load_browser_cookies(browser)` utilise `browser_cookie3` (`firefox`, `chrome`,
`edge`, ou `auto` qui les essaie dans l'ordre) pour extraire les cookies du domaine
`geocaching.com`, les injecte dans la session, puis vérifie l'état. Utile pour
contourner un captcha bloquant le login par identifiants.

### 6.3 Vérification d'état — un seul fetch `serverparameters`

Point d'entrée unique : `_fetch_server_parameters()` télécharge **une fois**
`https://www.geocaching.com/play/serverparameters/params` (JS de la forme
`var serverParameters = {...};`) et retourne le dict JSON parsé.

- `_params_is_logged_in(params)` : lit `params["user:info"]["isLoggedIn"]`.
- `_verify_login_status(params=None)` : booléen connecté/pas connecté.
- `_fetch_user_info(params=None)` : peuple `UserInfo` (username, referenceCode,
  userType, avatar…).

Les deux méthodes acceptent un `params` déjà récupéré pour **éviter un second
téléchargement** de la même ressource (login, restauration, `get_auth_state`).

---

## 7. Cache d'état et `get_auth_state`

`STATE_CACHE_TTL = 300` s (5 min).

```python
def get_auth_state(self, force_check=False) -> AuthState:
    if self._session is None: self.get_session()
    with self._state_lock:                  # lecture rapide sous verrou
        if not force_check and cache_valide(last_check): return self._auth_state
    params = self._fetch_server_parameters()  # RÉSEAU hors verrou
    with self._state_lock:
        # met à jour status/user_info, puis TOUJOURS last_check = now
        ...
```

Deux points essentiels :

- **`last_check` est toujours réarmé**, y compris en état déconnecté/non
  configuré. Sinon chaque `is_logged_in()` (appelé par `GeocachingScraper`,
  `GeocachingSearchClient`, plusieurs routes à chaque requête) relancerait un GET
  `serverparameters` (~300–800 ms).
- Le **fetch réseau est fait hors du verrou** `_state_lock` pour ne pas sérialiser
  les requêtes concurrentes (scrapes/refresh simultanés).

`is_logged_in()` = `get_auth_state().status == LOGGED_IN`.

---

## 8. Statistiques de profil

`fetch_profile_stats(force=False)` alimente les compteurs `UserInfo` (finds,
hides, favorite points). Cascade de sources :

1. **API proxy** `GET /api/proxy/web/v1/users/me` (JSON). Si elle ne renvoie pas
   `awardedFavoritePoints`, on bascule sur le dashboard.
2. **Profil public** `/p/default.aspx?u=<username>` (regex sur les compteurs).
3. **Dashboard** `/account/dashboard` : `_extract_dashboard_favorite_stats()`
   gère le HTML classique, le Next.js échappé (`<…`), le texte pur, et
   `window.sidebarProps.favoritePointSummary` (`Total`/`Available`/
   `LogsNeededToNext`). Cache : stats considérées fraîches < 5 min.

Ces heuristiques HTML sont couvertes par
`test_geocaching_auth_favorite_points.py`.

---

## 9. Déconnexion vs oubli

| Action | Méthode | Cookies session | Cookies persistés | Credentials (JSON + trousseau) |
|--------|---------|-----------------|-------------------|--------------------------------|
| **Se déconnecter** | `logout()` | effacés | effacés | **conservés** |
| **Oublier le compte** | `forget()` = `logout(forget=True)` | effacés | effacés | **supprimés** |

`logout()` poste aussi vers `/account/logout` (erreur tolérée). Conséquence de la
sémantique : après « Se déconnecter », le compte reste mémorisé et l'app peut se
reconnecter au prochain démarrage. « Oublier » supprime le fichier de credentials
et l'entrée du trousseau.

---

## 10. API REST — `blueprints/auth.py`

Préfixe : `/api/auth`.

| Méthode | Route | Corps / query | Rôle |
|---------|-------|---------------|------|
| GET | `/status` | `?force=true` | État courant (respecte le cache sauf `force`) |
| POST | `/login/credentials` | `{username, password, remember?}` | Login identifiants |
| POST | `/login/browser` | `{browser?, remember?}` | Login cookies navigateur |
| POST | `/logout` | — | Déconnexion (garde le compte) |
| POST | `/forget` | — | Déconnexion + suppression des identifiants |
| GET | `/config` | — | `{configured_method, has_saved_credentials}` |
| GET | `/test` | — | Force une vérification (`force_check=True`) |
| GET | `/profile` | `?force=true` | Statistiques de profil |
| POST | `/profile/refresh` | — | Force le rafraîchissement des stats |

Codes : login réussi → `200` ; échec → `401`. Réponse type via
`_auth_state_to_dict()` : `{status, method, user, error_message, last_check}`.

---

## 11. Frontend — widget « Connexion Geocaching.com »

`geocaching-auth-widget.tsx` (extension `zones`). URL backend lue depuis la
préférence `geoApp.backend.apiBaseUrl`.

- **États** : formulaire de login (identifiants **ou** cookies navigateur) vs vue
  connectée (avatar, type de compte, stats, boutons).
- **Actions** : `loginWithCredentials`, `loginWithBrowser`, `logout`, `forget`,
  `testConnection`, `refreshProfileStats`, `fetchProfileStatsQuietly`.
- **Ergonomie** :
  - En état `captcha_required`, un encart propose un bouton **« Utiliser les
    cookies du navigateur »** qui bascule directement la méthode.
  - Vue connectée : deux boutons distincts **Déconnexion** (garde le compte) et
    **Oublier** (supprime les identifiants), avec tooltips.
  - Un `CustomEvent('geoapp-auth-changed')` est émis à chaque changement d'état
    pour notifier les autres composants.

---

## 12. Consommateurs de la session

Tous récupèrent la session via `get_auth_service().get_session()` (ou reçoivent une
session injectée pour les tests) :

| Client | Fichier | Ce qu'il fait |
|--------|---------|---------------|
| `GeocachingScraper` | `geocaches/scraper.py` | Page cache → `ScrapedGeocache` (parseur `lxml` si présent, repli `html.parser`) |
| `GeocachingSearchClient` | `geocaches/search_client.py` | Recherche « autour de » (API web, bounding box) |
| `GeocachingLogsClient` | `services/geocaching_logs.py` | `userToken` de la page → endpoint `geocache.logbook` |
| `GeocachingPersonalNotesClient` | `services/geocaching_personal_notes.py` | Lecture/écriture note perso (`SetUserCacheNote`) |
| `GeocachingSubmitLogsClient` | `services/geocaching_submit_logs.py` | Publication de logs (CSRF + POST) |
| `GeocachingPushCoordinatesClient` | `services/geocaching_push_coordinates.py` | Coordonnées corrigées (`SetUserCoordinate` / `ResetUserCoordinate`) |
| `BookmarkListImporter` | `geocaches/bookmark_list_importer.py` | Listes de favoris (Next.js/API/HTML). Build-id Next.js détecté dynamiquement (`_get_build_id`) |
| `PocketQueryImporter` | `geocaches/pocket_query_importer.py` | Téléchargement du GPX de la PQ |

> Les imports de masse (GPX / Pocket Query) parsent directement les données
> Groundspeak du fichier et n'utilisent le scraping (donc la session) qu'en repli.
> Voir la doc des imports pour le détail.

---

## 13. Concurrence et thread-safety

- Instanciation du singleton protégée par un verrou de classe (`__new__`).
- `_session_lock` protège la création/remplacement de la `requests.Session`.
- `_state_lock` (`RLock`) protège les lectures/écritures de `AuthState` dans
  `get_auth_state` ; le **fetch réseau est fait hors verrou**.
- La `requests.Session` partagée sert des requêtes concurrentes (cas mono-
  utilisateur local). Le chemin concurrent chaud (`get_auth_state` via
  `is_logged_in`) est sécurisé ; les flux login/logout sont initiés par
  l'utilisateur et non concurrents.

---

## 14. Dépendances

`requests` (session HTTP), `browser_cookie3` (cookies navigateur), `keyring`
(trousseau système), `beautifulsoup4` + `lxml` (parsing HTML côté scraper/stats).
Toutes dans `backend/requirements.txt`. `keyring` et `lxml` **dégradent
gracieusement** si absents.

---

## 15. Pièges et points d'attention

- **Ne pas polluer les en-têtes de la session partagée** dans un client : passer
  les en-têtes spécifiques par requête (§5.1).
- **Ordre de détection du login** : identifiants incorrects **avant** captcha
  (§6.1) — sinon un mauvais mot de passe est signalé « captcha requis ».
- **`last_check` toujours réarmé** dans `get_auth_state` (§7) : régression facile
  à réintroduire, très coûteuse en requêtes réseau.
- **Cookies navigateur non auto-restaurés** : c'est volontaire (§5.2).
- **Build-id Next.js** (imports listes/PQ) : détecté depuis `__NEXT_DATA__` avec
  repli sur une valeur par défaut ; il change à chaque déploiement de GC.
- **Dépendance au HTML de geocaching.com** : les regex/sélecteurs (login, stats,
  scraper) peuvent casser si GC change son markup. Les tests de caractérisation
  (`test_geocaching_*`) documentent les formats attendus.
- **Migration mot de passe** : au premier chargement après mise à jour, un ancien
  fichier en clair est déplacé vers le trousseau et réécrit sans le secret.

---

## 16. Références croisées

- Imports de géocaches (GPX / Pocket Query / bookmark / autour) — voir la doc des
  imports et `blueprints/geocaches.py`.
- Détails de géocache et scraping — [geocache-details-technique.md](geocache-details-technique.md).
- Amis Geocaching.com (liste, flux d'activité) — [amis-geocaching-technique.md](amis-geocaching-technique.md).
- Backend général — [backend-technique.md](backend-technique.md).
- Frontend général — [frontend-technique.md](frontend-technique.md).
