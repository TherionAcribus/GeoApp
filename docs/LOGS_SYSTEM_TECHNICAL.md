# Système de logs GeoApp — Documentation technique

## 1. Objectif et périmètre

Le système de logs GeoApp permet :
- d’éditer des logs pour une ou plusieurs géocaches depuis l’IDE Theia (frontend),
- d’uploader des images (optionnel) sur Geocaching.com,
- de soumettre les logs sur Geocaching.com via un backend Flask,
- de conserver un **historique global** des modèles de logs (texte + paramètres) pour réutilisation.

Cette documentation couvre :
- le fonctionnement **frontend** (widget d’édition),
- le fonctionnement **backend** (endpoints + intégration Geocaching.com),
- les flux de données, modèles et points d’attention.

## 2. Architecture (vue d’ensemble)

### 2.1 Composants

- **Frontend (Theia extension)**
  - Widget principal : `theia-blueprint/theia-extensions/zones/src/browser/geocache-log-editor-widget.tsx`
  - UI table des caches (référence) : `theia-blueprint/theia-extensions/zones/src/browser/geocaches-table.tsx`
  - Services Theia utilisés :
    - `MessageService` (notifications)
    - `PreferenceService` (préférences)
    - `StorageService` (persistance côté application)

- **Backend (Flask)**
  - Routes : `gc-backend/gc_backend/blueprints/logs.py`
  - Client Geocaching.com (soumission + upload images) : `gc-backend/gc_backend/services/geocaching_submit_logs.py`

### 2.2 Flux haut niveau

1. L’utilisateur ouvre l’éditeur de logs et sélectionne une ou plusieurs géocaches.
2. Le widget charge les métadonnées des géocaches, affiche la table, et prépare les états (textes, types, PF, images).
3. Si des images sont sélectionnées : upload préalable (une ou plusieurs images), récupération des `image_guid`.
4. Soumission des logs via le backend : le backend transforme/valide la requête, puis appelle l’API Geocaching.com.
5. En cas de succès : la soumission renvoie un `logReferenceCode` et le widget mémorise un snapshot dans l’historique.

## 3. Modèles et états (Frontend)

### 3.1 Types principaux

- `LogTypeValue` : `'found' | 'dnf' | 'note'`
- `SubmissionStatus` : `'ok' | 'failed' | 'skipped'`
- `ImageUploadStatus` : `'pending' | 'uploading' | 'ok' | 'failed'`

#### 3.1.1 Image sélectionnée

`SelectedLogImage`:
- `id`: string (UUID local)
- `file`: File (blob navigateur)
- `status`: ImageUploadStatus
- `imageGuid?`: string (retourné par backend)
- `error?`: string

#### 3.1.2 Historique de logs

`LogHistoryEntry`:
- `id`: string
- `createdAt`: string ISO
- `logDate`: string `YYYY-MM-DD`
- `useSameTextForAll`: boolean
- `globalText`: string
- `perCacheText`: Record<number, string>
- `logType`: LogTypeValue
- `perCacheLogType`: Record<number, LogTypeValue>
- `perCacheFavorite`: Record<number, boolean>

Note : l’historique est **global** (pas lié à une cache ni à une liste de caches).

### 3.2 États importants du widget

- Contexte et données :
  - `geocacheIds: number[]`
  - `geocaches: GeocacheListItem[]`

- Paramètres log (global / par cache) :
  - `logDate: YYYY-MM-DD`
  - `logType: LogTypeValue`
  - `useSameTextForAll: boolean`
  - `globalText: string`
  - `perCacheText: Record<geocacheId, string>`
  - `perCacheLogType: Record<geocacheId, LogTypeValue>`
  - `perCacheFavorite: Record<geocacheId, boolean>`

- Images :
  - `globalImages: SelectedLogImage[]`
  - `perCacheImages: Record<geocacheId, SelectedLogImage[]>`

- Statuts de soumission :
  - `isSubmitting: boolean`
  - `perCacheSubmitStatus: Record<geocacheId, SubmissionStatus>`
  - `perCacheSubmitReference: Record<geocacheId, string | undefined>`

- Gestion des Points Favoris :
  - `totalFavoritePoints: number` - Nombre total de PF disponibles (récupéré depuis l'API auth)
  - `isFetchingFavoritePoints: boolean` - Indicateur de chargement des PF

## 4. Historique global (persistance)

### 4.1 Stockage

L’historique est persisté via `StorageService` (Theia) avec la clé :
- `geoApp.logs.history.v2`

Cet historique est indépendant du workspace : c’est un stockage persistant côté application.

### 4.2 Migration depuis l’ancien stockage

Migration automatique :
- Ancienne clé `localStorage` : `geoApp.logs.history.v1`
- Si `v2` est vide, le widget tente de charger `v1`, normalise les entrées et les enregistre dans `StorageService`.

### 4.3 Navigation

Le widget maintient :
- `logHistory: LogHistoryEntry[]`
- `logHistoryCursor: number`

Règles :
- Cursor `-1` signifie « état courant (non issu de l’historique) ».
- `navigateHistory(+1)` charge une entrée plus ancienne (index croissant),
- `navigateHistory(-1)` charge une entrée plus récente.

### 4.4 Application d’une entrée (mode “template”)

Lorsqu’on applique une entrée d’historique :
- **on force** `useSameTextForAll = true`
- `globalText` devient le texte du template
  - priorité à `entry.globalText`
  - sinon premier texte non vide trouvé dans `entry.perCacheText`
- `logType` est restauré si valide
- `perCacheLogType` et `perCacheFavorite` ne sont restaurés que pour les caches actuellement chargées
- La date **n’est pas** écrasée (par conception, l’historique sert de “modèle” réutilisable)

## 5. Upload d’images (Backend)

### 5.1 Endpoint

`POST /api/geocaches/<geocache_id>/logs/images/upload`

- Paramètre fichier : `image_file` (fallback : `file`)
- Réponse :
  - `{ ok: true, image_guid: "...", gc_response: {...} }`

### 5.2 Validation

Contrôles appliqués :
- Taille max : 10 MiB (`_MAX_LOG_IMAGE_BYTES`)
- Types MIME autorisés : png, jpeg/jpg, webp
- Vérification signature binaire (magic bytes) :
  - PNG : `\x89PNG...`
  - JPEG : `\xFF\xD8`
  - WEBP : `RIFF....WEBP`

### 5.3 Appel Geocaching.com

Le backend appelle :
- `POST https://www.geocaching.com/api/live/v1/logdrafts/images`

Le client tente plusieurs noms de champ multipart (tolérance) :
- `file`, `image`, `imageFile`

Extraction du GUID :
- `GeocachingSubmitLogsClient.extract_image_guid()` cherche des clés possibles (`imageGuid`, `ImageGuid`, `guid`, etc.) et parcourt récursivement les objets/lists.

## 6. Soumission des logs (Backend)

### 6.1 Endpoint

`POST /api/geocaches/<geocache_id>/logs/submit`

Payload JSON attendu (schéma logique) :
- `text`: string (requis)
- `date`: string `YYYY-MM-DD` (requis)
- `logType`: string optionnel (`found|dnf|note`) ou `logTypeId`: int
- `favorite`: boolean optionnel (pris en compte uniquement si `found`)
- `images`: array de strings (optionnel, liste de `image_guid`)

Réponse :
- `submitted: true`
- `log_reference_code` (UUID)
- `gc_response` (réponse brute GC)

### 6.2 Résolution du type de log

Mapping côté backend :
- found => 2
- dnf => 3
- note => 4

Si `logTypeId` est fourni (int), il est prioritaire.

### 6.3 Appel Geocaching.com

Le backend appelle :
- `POST https://www.geocaching.com/api/live/v1/logs/{GC_CODE}/geocacheLog`

Payload envoyé :
- `images`: [guid...]
- `logDate`: ISO UTC (midday) format `...Z`
- `logText`
- `logType`: int
- `trackables`: []
- `usedFavoritePoint`: bool (si applicable)

### 6.4 Authentification / cookies

Le backend charge des cookies navigateur via `browser_cookie3` (Firefox/Chrome/Edge) et récupère un CSRF token via :
- `GET https://www.geocaching.com/api/auth/csrf`

Ensuite, les requêtes POST incluent l’en-tête :
- `CSRF-Token: <token>`

Points d’attention :
- le backend dépend d’une session Geocaching.com valide dans un navigateur local.
- en cas d’absence de cookies, les appels peuvent échouer (auth requise).

## 7. Préférences

- `geoApp.logs.history.maxItems`
  - type : integer
  - min 1, max 50
  - default 10
  - usage : limite le nombre d’entrées mémorisées dans l’historique.

## 8. Gestion des Points Favoris (PF)

### 8.1 Récupération des PF disponibles

Au chargement du widget (méthode `setContext`), le widget appelle automatiquement `fetchFavoritePoints()` qui :
1. Récupère l'état d'authentification via `GET /api/auth/status`
2. Extrait le champ `user.awarded_favorite_points`
3. Stocke cette valeur dans `totalFavoritePoints`

### 8.2 Calcul des PF restants

La méthode `getRemainingFavoritePoints()` calcule dynamiquement :
```javascript
PF restants = totalFavoritePoints - nombre de cases "Donner PF" cochées
```

### 8.3 Affichage

Le widget affiche deux compteurs :
- **PF disponibles** : nombre total récupéré depuis l'API auth
- **PF restants** : nombre de PF encore distribuables (affiché en rouge si = 0)

### 8.4 Logique de désactivation

Les cases à cocher "Donner PF" sont désactivées dans les cas suivants :
1. Le type de log n'est pas "Found it"
2. Le log a déjà été soumis avec succès (`status === 'ok'`)
3. **Il ne reste plus de PF disponibles ET la case n'est pas déjà cochée**

Cette logique permet de :
- Cocher une case si des PF sont disponibles
- Décocher une case même si plus de PF disponibles (libère un PF)
- Empêcher de cocher de nouvelles cases si le stock est épuisé

### 8.5 Validation côté widget

Lors du toggle d'une case "Donner PF" (`toggleFavoriteForGeocacheId`) :
- Si l'utilisateur tente de cocher une case alors que `remainingFavoritePoints <= 0`
- Un message d'avertissement est affiché : "Plus de PF disponibles"
- L'action est annulée

## 9. Patterns de texte

### 9.1 Concept

Le système de patterns permet d'insérer des éléments dynamiques dans le texte des logs en tapant `@` suivi du nom du pattern. Un menu d'autocomplétion apparaît pour sélectionner le pattern souhaité.

### 9.2 Patterns intégrés

| Pattern | Description | Exemple |
|---------|-------------|---------|
| `@date` | Date du log au format français | 31/01/2026 |
| `@cache_count` | Numéro de la cache (trouvailles + position dans le batch) | 1234 |
| `@cache_name` | Nom de la géocache | La cache mystère |
| `@cache_owner` | Nom du propriétaire de la cache | GeoMaster |
| `@gc_code` | Code GC de la cache | GC12345 |

### 9.3 Calcul du cache_count

Le numéro de cache est calculé dynamiquement :
```
cache_count = finds_count (depuis auth) + position_dans_le_batch + 1
```

- `finds_count` : nombre de caches trouvées récupéré depuis `/api/auth/status`
- `position_dans_le_batch` : index de la cache dans la liste (en comptant uniquement les "Found it")

### 9.4 Patterns personnalisés

Les utilisateurs peuvent créer leurs propres patterns :
- **Nom** : identifiant unique (lettres, chiffres, underscores)
- **Contenu** : texte à insérer

Les patterns personnalisés sont stockés via `StorageService` avec la clé `geoApp.logs.patterns.v1`.

### 9.5 Interface utilisateur

- Section dépliable "📝 Patterns de texte" dans le widget
- Affichage des patterns intégrés avec leur valeur résolue
- Liste des patterns personnalisés avec boutons éditer/supprimer
- Formulaire d'ajout/modification de pattern

### 9.6 Autocomplétion

Lorsque l'utilisateur tape `@` dans un textarea :
1. Le système détecte le token `@` précédé d'un espace ou en début de ligne
2. Un dropdown affiche les patterns correspondant au fragment tapé
3. Navigation avec ↑↓, validation avec Enter/Tab, annulation avec Escape
4. Le pattern sélectionné est remplacé par sa valeur résolue

## 10. Robustesse et UX (notes)

- **Textareas contrôlés (React)** : le widget restaure le curseur lors des rerenders (`selectionStart/selectionEnd`) pour éviter le "cursor jump to end" lors d'édition/coller.
- **Images** : elles doivent être uploadées avant la soumission des logs ; les `image_guid` sont ensuite envoyés au backend.
- **Par-cache vs global** : le widget supporte un texte global ou des textes par cache, et un type de log par cache.
- **Points Favoris** : le système empêche de distribuer plus de PF que disponibles, avec désactivation visuelle et validation côté client.
- **Patterns** : insertion de texte dynamique via `@pattern`, avec autocomplétion et patterns personnalisables.

## 11. Erreurs courantes et diagnostic

- Upload image :
  - 400 : fichier manquant / MIME non supporté / signature invalide
  - 413 : trop volumineux
  - 502 : Geocaching.com n’a pas répondu correctement

- Soumission :
  - 400 : payload invalide (texte/date/logType)
  - 404 : cache inconnue côté DB
  - 502 : échec Geocaching.com ou réponse inattendue (pas de `logReferenceCode`)

## 12. Sécurité (points clés)

- Les appels Geocaching.com sont effectués côté backend avec cookies locaux :
  - ne pas logguer de cookies/tokens en clair.
- L’upload image vérifie taille + signature : réduit les risques d’upload de contenus non conformes.
- Les retours `gc_response` peuvent contenir des infos internes : à garder pour debug, à éviter d’exposer si l’app devient multi-utilisateur.

---

## Références code

- Frontend
  - `theia-blueprint/theia-extensions/zones/src/browser/geocache-log-editor-widget.tsx`

- Backend
  - `gc-backend/gc_backend/blueprints/logs.py`
  - `gc-backend/gc_backend/services/geocaching_submit_logs.py`
