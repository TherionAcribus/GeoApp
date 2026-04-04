# Usage des checkers dans le Chat IA (GeoApp)

Ce document explique comment utiliser les checkers depuis le Chat IA de GeoApp (Theia), quels tools sont disponibles, et quelles bonnes pratiques adopter pour une validation fiable.

## Prérequis

- Backend Flask démarré (par défaut sur `http://localhost:8000`).
- Préférence `geoApp.checkers.enabled=true`.
- Le Chat IA doit utiliser un agent qui a accès aux tools GeoApp (recommandé : **agent `GeoApp`**).

## Agent recommandé : `GeoApp`

GeoApp enregistre un agent `GeoApp` qui injecte en permanence les tools checkers via `additionalToolRequests`.

Conséquences :

- le modèle peut appeler `run_checker` sur **tous** les messages
- tu n’as pas besoin de préfixer tes messages avec `~geoapp.checkers.run`

## Traduction IA de la description (FR)

GeoApp enregistre aussi un agent interne non-chat `geoapp-translate-description` (similaire à `geoapp-ocr`) utilisé par l'interface (bouton dans le panneau de détails de la géocache) pour traduire la description en français en conservant le HTML.

Notes :

- La traduction est enregistrée dans la **description modifiée** (override) de la géocache.
- Si une description modifiée existe déjà, GeoApp demande confirmation avant de l'écraser.
- L’agent n’expose pas de tool : l’appel est effectué directement par le widget via `LanguageModelService`.

Traduction tout-en-un :

- Le widget propose aussi **"Traduire tout (FR)"** : description + indices + notes de waypoints.
- L’IA est appelée une seule fois (retour JSON), puis GeoApp persiste les overrides via un endpoint backend unique.

Si tu utilises un autre agent (ex: `Universal`) et que les tools semblent “disparaître”, c’est généralement parce que Theia ne fournit les tools que si le message courant contient des marqueurs `~...`.

## Tools disponibles

## `run_checker`

- **Tool id**: `geoapp.checkers.run`
- **Nom**: `run_checker`
- **But**: exécuter un checker avec une réponse candidate.

Paramètres :

- `geocache_id` (number, optionnel, recommandé)
  - Identifiant interne GeoApp de la géocache. Permet à GeoApp de résoudre automatiquement le checker et l’URL.
- `gc_code` (string, optionnel)
  - Code GC (ex: `GCAWZA2`) si `geocache_id` n’est pas disponible.
- `zone_id` (number, optionnel)
  - Utile si `gc_code` n’est pas unique (multi-zone).
- `url` (string, optionnel)
  - Mode legacy : URL du checker.
- `candidate` (string, requis)
  - réponse à tester (souvent en MAJUSCULES, sans espace, selon consigne)
- `wp` (string, optionnel)
  - code GC (ex: `GCAWZA2`). Recommandé pour Certitude si l’URL ne contient pas `?wp=`.
- `timeout_sec` (number, optionnel)
  - durée max pour les checkers interactifs (ex: Certitude)
- `auto_login` (boolean, optionnel, défaut `true`)
  - Pour Geocaching.com : si la session n’est pas loggée, GeoApp ouvre automatiquement la fenêtre de login.
- `login_timeout_sec` (number, optionnel, défaut `180`)
  - Durée max laissée pour se connecter lors de l’auto-login Geocaching.

Notes Certitude :

- GeoApp normalise automatiquement l’URL Certitude vers une forme canonique (`https://www.certitudes.org/certitude?wp=...`) quand c’est possible.
- Le mode Certitude est généralement **interactif** (fenêtre Playwright + action manuelle possible).

## `ensure_checker_session`

- **Tool id**: `geoapp.checkers.session.ensure`
- **Nom**: `ensure_checker_session`
- **But**: vérifier si une session est active pour un provider.

Paramètres :

- `provider` (string, requis)
  - ex: `geocaching` ou `certitudes`
- `wp` (string, optionnel)
  - utile pour `certitudes`

Retour typique :

- `{ "provider": "geocaching", "logged_in": true|false }`

## `login_checker_session`

- **Tool id**: `geoapp.checkers.session.login`
- **Nom**: `login_checker_session`
- **But**: ouvrir une fenêtre Playwright pour effectuer un login.

Paramètres :

- `provider` (string, requis)
- `timeout_sec` (number, optionnel)
- `wp` (string, optionnel)

Bonnes pratiques :

- ne pas fermer la fenêtre trop tôt
- si tu la fermes, le système tente de retomber sur un état propre (pas de crash souhaité)

## `reset_checker_session`

- **Tool id**: `geoapp.checkers.session.reset`
- **Nom**: `reset_checker_session`
- **But**: effacer le profil Playwright (cookies/session).

Paramètres :

- `confirm: true` (requis)

## Exemples d’utilisation (copier/coller)

## Certitude (validation d’un mot)

```text
Valide la réponse "BASILIC" sur le checker de la géocache.
Appelle run_checker en mode tool-driven (recommandé) :

run_checker({
  "geocache_id": <ID_GEOAPP>,
  "candidate": "BASILIC",
  "timeout_sec": 300
})
```

## Certitude (avec timeout plus long)

```text
run_checker({
  "geocache_id": <ID_GEOAPP>,
  "candidate": "BASILIC",
  "timeout_sec": 300
})
```

## Geocaching.com (Solution Checker) : session + captcha

```text
1) Appelle run_checker(geocache_id, candidate)
2) Si la session n'est pas loggée, GeoApp déclenche automatiquement l’auto-login (fenêtre Chromium), puis continue.
3) Si un reCAPTCHA apparaît, résous-le dans la fenêtre puis clique “Check Solution”.
```

## Règles de qualité (pour le modèle)

- Ne jamais conclure “coordonnées finales” sans une preuve (checker / calcul déterministe).
- Ne jamais inventer une URL de checker.
- Préférer `run_checker` en mode tool-driven (`geocache_id` ou `gc_code`) plutôt que de construire une URL.

## Dépannage rapide

## Le modèle dit: “je n’ai pas accès à run_checker”

Causes :

- agent non-GeoApp
- message courant ne référence pas les tools

Solutions :

- utiliser l’agent `GeoApp`
- ou préfixer le message par `~geoapp.checkers.run`

## `run_checker` renvoie “Unable to find input field”

Causes probables :

- URL pas canonique
- page pas encore prête / challenge Cloudflare

Solutions :

- utiliser `https://www.certitudes.org/certitude?wp=...`
- augmenter `timeout_sec`
- relancer le checker si la fenêtre Playwright a été fermée

## Où regarder les logs

- Theia:
  - `[CHECKERS-TOOLS] run_checker:*`
- Flask:
  - `Checker run-interactive start/done`
