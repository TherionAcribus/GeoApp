# Authentification Geocaching.com

## Vue d'ensemble

GeoApp propose désormais deux méthodes pour s'authentifier sur Geocaching.com :

1. **Identifiants (recommandé)** : Login avec nom d'utilisateur/email et mot de passe
2. **Cookies navigateur** : Extraction des cookies de session depuis Firefox, Chrome ou Edge

## Architecture

### Backend (Flask)

#### Service centralisé : `geocaching_auth.py`

Le service `GeocachingAuthService` est un singleton thread-safe qui gère toute l'authentification :

```python
from gc_backend.services.geocaching_auth import get_auth_service

# Obtenir le service
auth_service = get_auth_service()

# Vérifier si connecté
if auth_service.is_logged_in():
    print("Connecté!")

# Obtenir une session requests authentifiée
session = auth_service.get_session()

# Login avec credentials
state = auth_service.login_with_credentials("username", "password", remember=True)

# Login avec cookies navigateur
state = auth_service.login_with_browser_cookies(browser="firefox", remember=True)

# Déconnexion
auth_service.logout()
```

#### Routes API : `/api/auth/`

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/auth/status` | GET | Statut d'authentification actuel |
| `/api/auth/login/credentials` | POST | Login avec username/password |
| `/api/auth/login/browser` | POST | Login avec cookies navigateur |
| `/api/auth/logout` | POST | Déconnexion |
| `/api/auth/config` | GET | Configuration actuelle (sans secrets) |
| `/api/auth/test` | GET | Teste la connexion |

#### Exemple de payload login credentials :

```json
{
  "username": "mon_pseudo_ou_email",
  "password": "mon_mot_de_passe",
  "remember": true
}
```

#### Exemple de réponse :

```json
{
  "success": true,
  "status": "logged_in",
  "method": "credentials",
  "user": {
    "username": "MonPseudo",
    "user_type": "Premium",
    "avatar_url": "https://img.geocaching.com/avatar/...",
    "reference_code": "PR123456"
  },
  "error_message": null,
  "last_check": "2025-01-26T08:30:00"
}
```

### Frontend (Theia)

#### Widget d'authentification

Accessible via la commande : **GeoApp: Connexion Geocaching.com** (`geoapp.auth.open`)

Le widget permet de :
- Voir le statut de connexion actuel
- Se connecter avec identifiants ou cookies navigateur
- Tester la connexion
- Se déconnecter

### Préférences

Les préférences suivantes ont été ajoutées au schéma (`geo-preferences-schema.json`) :

| Clé | Type | Description |
|-----|------|-------------|
| `geoApp.auth.geocaching.method` | enum | Méthode d'auth (none, credentials, browser_cookies) |
| `geoApp.auth.geocaching.browserSource` | enum | Navigateur pour cookies (auto, firefox, chrome, edge) |
| `geoApp.auth.geocaching.rememberCredentials` | boolean | Mémoriser les identifiants |
| `geoApp.auth.geocaching.autoLogin` | boolean | Connexion auto au démarrage |

## Stockage des credentials

Les credentials sont stockés dans `gc-backend/data/.gc_credentials.json` avec permissions restrictives (600 sur Unix).

**Format** :
```json
{
  "method": "credentials",
  "username": "...",
  "password": "..."
}
```

ou pour les cookies navigateur :
```json
{
  "method": "browser_cookies",
  "browser": "firefox"
}
```

## Flow d'authentification (comme c:geo)

Le flow credentials suit le même processus que c:geo :

1. **GET** sur `https://www.geocaching.com/account/signin`
2. Extraction du token `__RequestVerificationToken` depuis le HTML
3. **POST** avec `UsernameOrEmail`, `Password`, et le token
4. Analyse de la réponse (succès, captcha, erreur, etc.)
5. Récupération des infos utilisateur via `/play/serverparameters/params`

## Gestion des erreurs

| Status | Description |
|--------|-------------|
| `logged_in` | Connecté avec succès |
| `logged_out` | Déconnecté |
| `not_configured` | Aucune authentification configurée |
| `login_failed` | Échec (mauvais identifiants, etc.) |
| `captcha_required` | Geocaching.com demande un captcha |
| `account_not_validated` | Compte non validé par email |

## Migration depuis l'ancien système

L'ancien système chargeait directement les cookies du navigateur dans chaque service. Les services suivants ont été refactorisés pour utiliser le service centralisé :

- `GeocachingScraper` (scraper.py)
- `GeocachingLogsClient` (geocaching_logs.py)
- `GeocachingSubmitLogsClient` (geocaching_submit_logs.py)
- `GeocachingPersonalNotesClient` (geocaching_personal_notes.py)

## Notes importantes

1. **OAuth Google/Apple/Facebook** : Si votre compte a été créé via OAuth, vous devez d'abord définir un mot de passe sur geocaching.com ou utiliser la méthode cookies navigateur.

2. **Captcha** : Geocaching.com peut demander un captcha après plusieurs tentatives. Dans ce cas, utilisez la méthode cookies navigateur.

3. **Expiration des cookies** : Les cookies navigateur expirent. La méthode credentials est plus fiable sur le long terme.

4. **Sécurité** : Les credentials sont stockés en clair localement. Assurez-vous que seul votre utilisateur a accès au dossier `data/`.
