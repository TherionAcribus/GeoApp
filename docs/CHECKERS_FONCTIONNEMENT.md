# Fonctionnement des checkers (GeoApp)

Ce document décrit l’architecture, les flux d’exécution et les points de configuration pour les checkers (Certitude, Geocaching.com, etc.) dans GeoApp.

## Objectif

Les checkers permettent de valider une réponse d’énigme (ex: Certitude) ou de vérifier/maintenir une session authentifiée (ex: Geocaching.com) via une automatisation Playwright côté backend, exposée au frontend via des endpoints HTTP et, côté IDE, via des Tools IA.

## Architecture (vue d’ensemble)

- **Frontend Theia (zones)**
  - `theia-extensions/zones/src/browser/checker-tools-manager.ts`
  - Expose des tools IA (ToolInvocationRegistry) :
    - `geoapp.checkers.run` (`run_checker`)
    - `geoapp.checkers.session.ensure` (`ensure_checker_session`)
    - `geoapp.checkers.session.login` (`login_checker_session`)
    - `geoapp.checkers.session.reset` (`reset_checker_session`)
  - Appelle le backend via `fetch`:
    - `/api/checkers/run` (non interactif)
    - `/api/checkers/run-interactive` (interactif, ex: Certitude)
    - `/api/checkers/session/*`

- **Backend Flask**
  - `gc_backend/blueprints/checkers.py`
  - Construit un `CheckerRunner` configuré (profil Playwright, timeouts, domaines autorisés)
  - Exécute le checker via un adapter (ex: `certitude.py`)

- **Backend Playwright / Adapters**
  - `gc_backend/services/checkers/runner.py`
  - `gc_backend/services/checkers/adapters/certitude.py`
  - `gc_backend/services/checkers/session.py` (gestion session Geocaching/Certitudes)

## Endpoints Flask

## `/api/checkers/run` (POST)

- **Usage**: checkers « simples » sans interaction humaine.
- **Body JSON**:
  - `url` (string, requis)
  - `input` (object, requis)
    - `candidate` (string) ou `text` selon adapter
- **Réponse**:
  - `{ "status": "success", "result": <CheckerRunResult> }`
  - ou `{ "status": "error", "error": "..." }`

## `/api/checkers/run-interactive` (POST)

- **Usage**: checkers nécessitant action manuelle (Cloudflare/Turnstile, captcha, etc.).
- **Body JSON**:
  - `url` (string, requis)
  - `input` (object)
  - `timeout_sec` (int, optionnel)
- **Particularités**:
  - Une fenêtre Chromium peut s’ouvrir.
  - L’utilisateur peut devoir cliquer sur « Certifier ».
- **Logs**:
  - `Checker run-interactive start ...`
  - `Checker run-interactive done ... duration_ms=...`

## `/api/checkers/session/ensure` (POST)

- **Usage**: vérifier si une session est active.
- **Body JSON**:
  - `provider` (string, ex: `geocaching` ou `certitudes`)
  - `wp` (string, optionnel pour certitudes)

## `/api/checkers/session/login` (POST)

- **Usage**: ouvrir un navigateur “headed” pour login.
- **Body JSON**:
  - `provider` (string)
  - `timeout_sec` (int)
  - `wp` (string optionnel)
- **Note UX**:
  - Si l’utilisateur ferme la fenêtre, le backend tente de renvoyer un état propre plutôt que de crasher.

## `/api/checkers/session/reset` (POST)

- **Usage**: supprimer le profil Playwright (cookies/session).
- **Body JSON**:
  - `confirm: true` (requis)

## Tool IA : `run_checker`

Le tool `run_checker` est un wrapper frontend qui :

- normalise l’URL Certitude (host `www`, protocole `https`, path `/certitude`, ajout `?wp=` si fourni)
- choisit le bon endpoint:
  - Certitude → `/api/checkers/run-interactive`
  - Geocaching.com (Solution Checker intégré) → `/api/checkers/run-interactive`
  - autres → `/api/checkers/run`
- gère un timeout et des logs pour diagnostiquer les blocages

En mode « tool-driven », `run_checker` peut aussi **résoudre automatiquement** le checker à partir d’une géocache en base (sans que le modèle fournisse l’URL), puis exécuter la vérification.

Paramètres (outil IA) :

- `geocache_id` (optionnel, recommandé)
  - Identifiant interne GeoApp de la géocache.
- `gc_code` (optionnel)
  - Code GC (ex: `GCAWZA2`) si `geocache_id` n’est pas disponible.
- `zone_id` (optionnel)
  - Utile si plusieurs géocaches existent avec le même `gc_code`.
- `url` (optionnel)
  - Mode legacy : URL du checker à ouvrir.
- `candidate` (requis)
- `wp` (optionnel mais recommandé pour Certitude)
- `timeout_sec` (optionnel)
- `auto_login` (optionnel, défaut `true`)
  - Pour Geocaching.com, déclenche automatiquement le login si la session n’est pas authentifiée.
- `login_timeout_sec` (optionnel, défaut `180`)
  - Durée max accordée à l’utilisateur pour terminer le login Geocaching (fenêtre Playwright).

Si le checker Geocaching est stocké comme fragment (ex: `#solution-checker`), GeoApp reconstruit automatiquement une URL valide en s’appuyant sur `wp` (ou sur le `gc_code` de la géocache résolue).

## Normalisation URL Certitude

Pour Certitude, GeoApp privilégie une URL canonique du type :

- `https://www.certitudes.org/certitude?wp=GCAWZA2`

Cela évite des URL “inventées” ou non supportées (ex: `/validate`) qui peuvent ne pas contenir le champ attendu.

## Robustesse : détection du champ Certitude

Dans `certitude.py` (mode interactif), GeoApp tente de localiser un champ parmi :

- `input[type="text"]`
- `input[type="search"]`
- `textarea`
- `input:not([type])`

Si le champ n’est pas trouvé immédiatement, un **retry** est effectué pendant quelques secondes (utile quand la page charge des iframes/Turnstile).

## Checker intégré Geocaching.com (Solution Checker)

Sur certaines pages de geocache, Geocaching.com expose un bloc « Solution checker » (ex: `#ctl00_ContentBody_uxCacheChecker`) avec :

- un champ de saisie (ex: `#ctl00_ContentBody_txtSolutionInput`)
- un bouton `#CheckerButton` (« Check Solution »)
- une zone de réponse `#lblSolutionResponse`
- parfois des labels de coordonnées `#solution-lat` / `#solution-lon`

Particularités :

- Il faut généralement une **session Geocaching.com** valide.
- Il peut y avoir un **Google reCAPTCHA** (bloc `.g-recaptcha`). Dans ce cas l’exécution doit être **interactive** (résolution humaine du captcha).

Flux recommandé :

- Appeler directement `run_checker(...)`.
  - Si l’URL cible est Geocaching.com, GeoApp fait un `ensure` automatiquement.
  - Si la session n’est pas authentifiée et que `auto_login=true`, GeoApp ouvre automatiquement la fenêtre de login, puis continue.

Exemple (recommandé) :

- `run_checker(geocache_id=<id>, candidate=<coordonnées>, timeout_sec=300)`

## Préférences (backend/front)

- `geoApp.checkers.enabled` (bool)
  - Désactive tout le système de checkers si `false`.
- `geoApp.backend.apiBaseUrl` (string, frontend)
  - Base URL du backend (défaut `http://localhost:8000`).
- Backend (via `get_value_or_default`):
  - `geoApp.checkers.playwright.headless` (bool)
  - `geoApp.checkers.timeoutMs` (int)
  - `geoApp.checkers.maxAttempts` (int)
  - `geoApp.checkers.profileDir` (string)
  - `geoApp.checkers.allowedDomains` (liste ou null)

## Endpoint utilitaire : géocache par GC code

Pour permettre le mode tool-driven, GeoApp expose un endpoint permettant de résoudre une géocache à partir d’un `gc_code` :

- `GET /api/geocaches/by-code/<gc_code>?zone_id=<optionnel>`

Il renvoie les détails complets de la géocache (équivalent à `/api/geocaches/<id>`), incluant `checkers[]`.

## Dépannage (symptômes fréquents)

## “Unable to find input field”

Causes possibles :

- URL non canonique (page Certitude différente)
- page pas encore chargée / iframes non prêtes
- challenge Cloudflare/Turnstile

Actions :

- vérifier l’URL Certitude (utiliser `https://www.certitudes.org/certitude?wp=...`)
- augmenter `timeout_sec` (mode interactif)
- vérifier que la fenêtre Playwright est bien ouverte et que l’utilisateur clique sur “Certifier”

## “Cloudflare Turnstile challenge present”

- Indique une vérification humaine.
- Solution: résoudre le challenge dans la fenêtre ouverte, puis relancer.

## Erreurs 500

- Consulter les logs Flask : stacktrace + `Checker run-interactive failed ...`
- Consulter les logs Theia : `[CHECKERS-TOOLS] run_checker:*`

## Logs utiles

- Theia (console / logs node):
  - `[CHECKERS-TOOLS] run_checker:start|fetch|response|done|error`
- Flask:
  - `Checker run-interactive start/done`
