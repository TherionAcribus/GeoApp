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
  - Libellés affichés : `pending` → « 📎 Prête — sera envoyée avec le log » (+ taille du fichier), `uploading` → « ⬆️ Envoi en cours… », `ok` → « ✅ Envoyée à Geocaching.com » (le `imageGuid` est en infobulle), `failed` → « ⚠️ <erreur> ».
  - L'upload étant différé au moment de la soumission, `pending` signifie « chargée dans l'app, pas encore transmise » : le libellé doit rester non anxiogène.
  - Chaque image sélectionnée est affichée avec une miniature (`URL.createObjectURL`), mutualisée par `File` dans `previewUrlByFile` et libérée par `releaseUnusedPreviewUrls()` (suppression d'une image, changement de contexte).

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

## 3.3 Rendu Markdown

Geocaching.com interprète les logs en Markdown (cf. [guide officiel](https://www.geocaching.com/guide/markdown.aspx)).
Le rendu est mutualisé entre l'aperçu de l'éditeur et l'affichage des logs récupérés :

- `log-markdown.ts` : analyse pure (sans React), donc testable
  - `tokenizeInlineMarkdown()` : gras, italique, code inline, liens
  - `parseMarkdownBlocks()` : paragraphes, titres, listes, citations, blocs de code
  - `sanitizeLogUrl()` : n'autorise que `http(s)` dans les liens (logs d'autres joueurs)
- `log-markdown-renderer.tsx` : rendu React (`renderLogMarkdown`, `renderInlineLogMarkdown`)
- Consommateurs : `geocache-log-editor-widget.tsx` (aperçu) et `geocache-logs-widget.tsx` (liste des logs)

**Règle des emphases** : comme sur Geocaching.com, les délimiteurs doivent être collés au texte.
`**gras**` fonctionne, `**pas gras **` (espace avant la fermeture) reste affiché littéralement.
L'aperçu applique la même règle que le site, afin de ne pas promettre une mise en forme
qui n'apparaîtra pas dans le log publié.

Quand une ligne contient des astérisques qui ne seront pas interprétées, l'aperçu affiche
un avertissement listant les lignes concernées (`findUnrenderedEmphasis()`), afin de
distinguer « l'aperçu ne fait rien » de « ton Markdown est invalide ».

Les boutons de la barre d'outils (B, I, code, lien) sont des **bascules**, pilotées par
`toggleMarkdownFormat()` qui traite trois cas dans l'ordre :

0. la sélection est d'abord resserrée sur son contenu non blanc (`trimSelectionRange()`) ;
1. sélection déjà formatée → retrait des délimiteurs (`unwrapMarkdownSelection()`) ;
2. curseur seul posé dans une zone formatée → retrait des délimiteurs de cette zone ;
3. sinon → enveloppement de la sélection, ou du texte indicatif s'il n'y en a pas.

L'étape 0 est indispensable : un double-clic sélectionne le mot **et** l'espace qui suit,
et envelopper tel quel produirait `**mot **`, que Geocaching.com n'interprète pas. Les
espaces restent donc à l'extérieur des délimiteurs (`un **mot** suite`), et la sélection
restituée après l'action porte sur le seul mot.

Le bouton correspondant s'**allume** quand le curseur est dans une zone formatée
(`findFormatAtCaret()`, alimenté par les bornes `start`/`end` que le tokenizer attache à
chaque token). Comme la détection passe par le tokenizer, un bouton allumé signifie
« Geocaching.com rendra bien ce formatage » : sur `**gras **`, le bouton reste éteint,
ce que l'avertissement de l'aperçu vient expliquer.

Le lien fait exception au cas 2 : son délimiteur fermant contient l'URL, de longueur
variable, donc il ne peut pas être retiré au curseur.

La barre est rendue une seule fois par `renderMarkdownToolbar(section, disabled)`, partagée
entre l'éditeur global et les éditeurs par cache ; `isEditorActive(section)` évite d'allumer
les boutons des deux barres simultanément.

Tests : `src/browser/tests/log-markdown.test.ts` (`npm run test:geoapp` dans l'extension `zones`).

**Repli d'un log long (liste des logs)** : le repli est **visuel**, jamais textuel. Le
Markdown est toujours rendu en entier et seule la hauteur du conteneur est bornée à
`COLLAPSED_TEXT_MAX_LINES` lignes (`geocache-logs-widget.tsx`). Couper la chaîne avant le
rendu — ce que faisait la troncature à 200 caractères — produisait deux défauts : un
délimiteur orphelin (`**gras` privé de sa fermeture) s'affichait littéralement, et la
coupe tombait au milieu d'un mot.

Le bouton « Voir plus » n'apparaît que si le contenu déborde réellement, mesuré par
`scrollHeight > COLLAPSED_TEXT_MAX_HEIGHT`. Cette comparaison vaut dans les deux états :
`scrollHeight` reste la hauteur du contenu complet même quand le conteneur est replié en
`overflow: hidden`, donc le bouton ne disparaît pas une fois le log déplié. Un
`ResizeObserver` refait la mesure quand la largeur du panneau change, puisque c'est elle
qui décide du nombre de lignes. Le fondu de bas de bloc remplace les « … » supprimés.

### 3.4 Champ texte à couche de surlignage

`renderTextareaWithOverlay()` superpose un `<textarea>` au texte transparent et une couche
qui affiche le même texte avec les `@patterns` colorés. Les deux couches doivent produire
**exactement le même découpage de lignes**, sans quoi le surlignage se décale d'autant plus
que le texte est long. Les contraintes, réunies dans `sharedMetrics` :

- police, taille et interlignage déclarés **en inline sur les deux couches** — `.theia-input`
  impose ses propres valeurs au `<textarea>` mais ne s'applique pas à la couche, et un
  `<textarea>` n'hérite pas de la police de son parent
- padding identique — `.theia-input` utilise `padding: 3px 0 3px 8px`, dont le
  `padding-right: 0` modifie la largeur de retour à la ligne
- `box-sizing: border-box` et `scrollbar-gutter: stable` sur les deux couches
- défilement synchronisé (`syncOverlayScroll`), sinon la couche reste figée dès que le
  texte dépasse la hauteur visible
- fond de sélection translucide (`style/log-editor-textarea.css`, classe
  `geoapp-log-textarea`) : le fond de sélection est peint par le `<textarea>`, donc
  au-dessus de la couche ; opaque, il masquerait entièrement le texte sélectionné

Le redimensionnement vertical du `<textarea>` ne nécessite rien de particulier : le
conteneur suit sa hauteur, et la couche est positionnée en `inset: 0` sur ce conteneur.

### 3.5 Feuilles de styles

Les deux surfaces sont habillées par des classes, pas par des styles en ligne :

- `style/logs-panel.css` — panneau de lecture (`geocache-logs-widget.tsx`) et résumé
  des derniers logs (`geocache-logs-summary.tsx`, réutilisé par la fiche détail).
  Préfixes `geoapp-logs-panel`, `geoapp-log-card`, `geoapp-logs-summary`.
- `style/log-editor.css` — éditeur et tous ses composants de présentation
  (`log-editor/*.tsx`). Préfixe `geoapp-log-`.

Nommage `bloc__element--modificateur`, couleurs prises aux variables Theia.

**Ce qui reste légitimement en ligne** — et seulement ça :

| Où | Quoi | Pourquoi |
|---|---|---|
| `geocache-logs-widget.tsx`, `geocache-logs-summary.tsx` | `--geoapp-log-color` | couleur du type de log, issue des données |
| `geocache-logs-widget.tsx` | `--geoapp-log-collapsed-height` | seuil de repli, dont le TSX a besoin comme seuil de mesure |
| `geocache-log-editor-widget.tsx` | les six accents d'état | cf. ci-dessous |
| `log-editor/geocaches-table.tsx` | `maxHeight` | prop du composant |
| `log-editor/submit-progress.tsx` | `width` de la barre | avancement |
| `log-editor/pattern-autocomplete-menu.tsx` | `top` / `left` | suit le curseur |
| `log-editor/textarea-overlay.tsx` | `sharedMetrics` | cf. § 3.4 : les deux couches doivent déclarer les mêmes métriques, et `.theia-input` écraserait une classe posée sur le `<textarea>` seul |

**Accents d'état.** `ALREADY_FOUND_ACCENT`, `JUST_LOGGED_ACCENT`, `DNF_ACCENT` et leurs
fonds restent définis dans `log-editor/constants.ts`, parce que les icônes SVG de
`geocache-log-type-icons.tsx` les dessinent aussi : une valeur recopiée dans la feuille
aurait fini par diverger. Le widget les pose une seule fois en variables CSS sur sa
racine `.geoapp-log-editor` ; le tableau, les blocs par cache et les badges les lisent
par héritage. Pour changer une couleur d'état, un seul endroit : `constants.ts`.

**Menu d'autocomplétion.** `log-editor/pattern-autocomplete-menu.tsx` a été extrait au
passage : l'éditeur global et les blocs par cache en contenaient deux copies identiques.

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

Champ multipart : `image` (constante `LOG_IMAGE_FORM_FIELD`), en-tête `CSRF-Token`.

C'est le nom utilisé par c:geo sur l'API live de Groundspeak (`GCLogAPI.addLogImage` :
`bodyForm(null, "image", "image/jpeg", ...)`). Le client tentait auparavant trois noms
successifs (`file`, `image`, `imageFile`), ce qui renvoyait le fichier — jusqu'à 10 Mo —
jusqu'à trois fois avant de rendre l'erreur. Un envoi refusé est désormais remonté tel
quel, sans nouvel upload ; seul un rejet CSRF (401/403) rejoue l'appel, une fois, avec un
jeton frais.

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

Le backend appelle l'endpoint tRPC « batch » :
- `POST https://www.geocaching.com/api/live/v1/trpc/web.logs.createGeocacheLog?batch=1`

> Changement site (juin 2026) : l'ancien endpoint REST
> `POST /api/live/v1/logs/{GC_CODE}/geocacheLog` a été retiré et renvoyait des réponses
> sans `logReferenceCode`. Aligné sur c:geo 2026.06.19 (commit `a7e42d3`).
> Il reste utilisé en repli automatique si le tRPC répond 404/405.

Payload envoyé :
```json
{"0": {"referenceCode": "GC_CODE", "body": { ... }}}
```

Contenu de `body` :
- `images`: [guid...]
- `logDate`: timestamp local sans fuseau, ex. `2026-07-26T12:00:00`
- `logText`
- `logType`: int
- `trackables`: []
- `geocacheReferenceCode`: `""` (vide pour un log de cache)
- `usedFavoritePoint`: bool (si applicable)

Réponse attendue :
```json
[{"result": {"data": {"logReferenceCode": "GLxxx", ...}}}]
```

Le déballage est fait par `GeocachingSubmitLogsClient.unwrap_trpc_payload()` ; les erreurs
métier (`[{"error": {"json": {"message": ...}}}]`) sont extraites par `extract_trpc_error()`
et remontées dans `error_message`.

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

Les préférences de traduction sont décrites au § 13.

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

`finds_count` est lu à l'ouverture de l'onglet de log (`setContext` → `fetchFavoritePoints`),
puis reste figé pour la durée de vie de l'onglet : la position dans le batch fait le reste
de l'incrémentation.

Quand le texte utilise `@cache_count`, la valeur est **resynchronisée depuis
Geocaching.com** (`POST /api/auth/profile/refresh`) via `refreshUserFindsCount()` :

- à l'insertion du pattern par l'autocomplétion (l'aperçu montre le vrai numéro) ;
- juste avant l'envoi du lot, dans `submitLogsToGeocaching` ;
- à la demande, via le bouton `⟳` à côté de « Trouvailles ».

Le rafraîchissement est ignoré si une cache de l'onglet a déjà été envoyée : le compteur
distant inclurait ce log, que la position dans le batch recompte déjà (double comptage).

Pour que le numéro reparte de la bonne base à l'envoi **suivant**, le backend répercute
chaque log envoyé sur les stats en cache (`GeocachingAuthService.apply_submitted_log`,
appelé depuis `/api/geocaches/<id>/logs/submit`) :

- un "Found it" envoyé → `finds_count + 1`
- un PF attribué → `awarded_favorite_points - 1`

Sans cela, deux envois successifs (deux onglets, ou une cache loguée à la fois) repartaient
du `finds_count` mémorisé au login et donnaient le même numéro à tous les logs.

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

## 13. Traduction IA du log

Permet d’écrire un log dans sa langue puis de le publier dans celle de la cache.

### 13.1 Agent et modèle

Agent interne dédié `geoapp-log-translator` (« GeoApp Traduction de Logs »), déclaré dans
`geoapp-log-translator-agent.ts`, enregistré via `zones-frontend-module.ts` et listé dans
`AGENT_MODEL_ROWS` de `geoapp-chat-policy-widget.tsx` sous « Traduction de logs ».

Il est **distinct** de `geoapp-translate-description` : traduire un log court en Markdown est
une tâche bien plus légère que traduire un listing HTML, et mérite de pouvoir recevoir son
propre modèle (typiquement un modèle rapide et économique).

L’appel se fait entièrement côté frontend via `LanguageModelService`, comme la génération de
logs. **Aucune route backend** n’est impliquée : `POST /api/geocaches/<id>/logs/submit` n’a pas
de notion de langue et n’en a pas besoin.

### 13.2 Moteur

`log-editor/log-translator.ts` — même découpage que `ai-log-generator.ts` (fonctions pures +
un appel prenant les services en paramètres), dont il réutilise `cleanAiResponse` et
`NoLanguageModelError`.

| Fonction | Rôle |
|---|---|
| `buildTranslationSource` | Texte réellement soumis au modèle (mention de traduction comprise) |
| `buildLogTranslationPrompt` | Prompt, incluant la liste nommée des `@patterns` à préserver |
| `extractPatternTokens` / `findLostPatterns` | Garde-fou `@patterns` (§ 13.4) |
| `assembleTranslation` | Assemblage final selon le mode (remplacer / bilingue) |
| `translateLogWithAi` | Sélection du modèle, appel, nettoyage, assemblage |

### 13.3 La mention « traduction automatique »

Elle est ajoutée au texte **source, avant l’appel**, et non au résultat après coup. Le modèle
la traduit donc avec le reste : elle ressort dans la langue cible sans table de correspondance
ni second appel, et sa présence est garantie puisqu’elle faisait partie de l’entrée. Le prompt
précise explicitement de traduire aussi cette dernière ligne.

En mode bilingue, `assembleTranslation` reçoit l’original **sans** la mention : celle-ci
n’apparaît que sous la version traduite.

### 13.4 Garde-fou `@patterns`

Le texte contient des `@patterns` résolus *après* la saisie (§ 9). Un modèle qui traduit
`@cache_name` en `@nom_cache` casse le pattern **en silence** : le surlignage, le compteur de
caractères et l’aperçu mentiraient tous les trois.

Deux protections :

1. le prompt liste nommément les patterns connus (`buildPatternsIndex(...).names`) et interdit
   de les traduire, renommer, supprimer ou changer de casse ;
2. après l’appel, `findLostPatterns` compare les tokens présents à l’entrée et à la sortie, et
   le widget avertit en nommant ceux qui ont disparu.

L’avertissement **ne bloque pas** : le texte est sous les yeux de l’utilisateur, qui peut
revenir à l’original.

### 13.5 Épinglage de la langue

Transposition littérale de l’épinglage de la date : clé `geoApp.logs.pinnedLanguage.v1` dans le
`StorageService`, **la présence de l’entrée vaut « épinglé »**, `setData(key, undefined)`
dé-épingle. `loadPinnedLogLanguage()` est appelée en tête de `initializeSession()`, à côté de
`loadPinnedLogDate()`.

Résolution de la langue courante : langue épinglée → sinon `defaultLanguage` si elle figure
dans la liste → sinon la première de la liste → sinon rien. Liste vide : le menu affiche
un renvoi vers les préférences et l’action principale est désactivée.

L’épinglage se pilote depuis le menu du split button (§ 13.6), et son état est reflété par une
punaise dans le badge de langue — visible sans ouvrir le menu.

Comme pour la date, une langue épinglée n’est jamais écrasée par la restauration d’un brouillon
ou d’une entrée d’historique : `computeDraftApplication` et `computeHistoryApplication`
reçoivent `isLogLanguagePinned` et renvoient `undefined` (= ne pas toucher) dans ce cas.
`LogDraft.logLanguage` et `LogHistoryEntry.logLanguage` sont **optionnels** : les brouillons et
historiques écrits avant la fonctionnalité restent lisibles.

### 13.6 Périmètre dans l’UI

| Emplacement | Élément |
|---|---|
| `translate-split-button.tsx` | **Split button** « Traduire » : action à gauche (avec badge de la langue active), ▾ à droite ouvrant le menu des langues + l’épinglage. Même motif que le split « Chat IA » de `geocache-details-sections.tsx` |
| `global-log-editor.tsx` | Le split button et « ↩ Revenir à l’original » dans la toolbar du texte commun |
| `per-cache-block.tsx` | « 🌐 Traduire » et « ↩ Original » par bloc — bouton simple : la langue est globale, et un menu par bloc serait illisible sur 30 caches |
| `batch-translation-bar.tsx` | Le split button en « Traduire tous les blocs » : `ConfirmDialog` annonçant le nombre d’appels, progression `n/N`, bouton Stop. Traitement **séquentiel** ; les blocs vides, ceux en `skip` et ceux déjà envoyés sont ignorés |
| `ai-generation-panel.tsx` | Rappel de la langue : la génération IA rédige **directement** dans la langue cible (`buildLogGenerationPrompt(..., targetLanguage)`), ce qui donne un meilleur texte que générer en français puis traduire |

Les deux split buttons partagent un unique `isLanguageMenuOpen` côté widget : la toolbar du
texte commun et la barre du mode par cache ne sont jamais affichées en même temps. Le composant
gère lui-même la fermeture au clic extérieur et à `Escape`, et sélectionner une langue ou basculer
l’épingle referme le menu. La langue n’est **plus** dans la ligne d’en-tête à côté de la date : elle est
lisible dans le badge du split button, dans les deux modes de saisie.

Les `deps` du `MemoizedFragment` des blocs par cache incluent `translatingKey === gc.id`,
`logLanguage` et `preTranslationPerCacheText[gc.id]` : sans cela, le spinner et le bouton de
retour à l’original n’apparaîtraient pas.

### 13.7 Préférences (catégorie Logs, section « Traduction »)

| Clé | Type | Défaut |
|---|---|---|
| `geoApp.logs.translation.languages` | array de chaînes, rendu `string-list` | `["Français","Anglais","Allemand","Espagnol"]` |
| `geoApp.logs.translation.defaultLanguage` | string | `"Anglais"` |
| `geoApp.logs.translation.mode` | enum `replace` / `bilingual` | `replace` |
| `geoApp.logs.translation.addNotice` | boolean | `true` |
| `geoApp.logs.translation.noticeText` | string | `*Traduction automatique.*` |
| `geoApp.logs.translation.bilingualSeparator` | string (avancé) | `---` |

Les langues sont des **noms en clair**, pas des codes ISO : c’est ce que le prompt consomme
directement, et c’est ce qui rend la liste réellement libre (« Breton » fonctionne sans table
de correspondance). Le rendu `string-list` de la page Préférences est décrit dans
`documentation/preferences-ajout-rapide.md`.

### 13.8 Points d’attention

- La limite de **4000 caractères** porte sur le texte *résolu*. Une traduction gonfle le texte
  (~15-20 % vers l’allemand) et le mode bilingue le double : `warnIfTranslationIsTooLong`
  avertit, le `CharCounter` prend le relais visuellement.
- Le retour à l’original est une mémoire **d’un seul niveau**, non persistée : elle ne survit
  pas à la fermeture de l’onglet.
- Dans « Traduire tous les blocs », une cache qui échoue n’emporte pas le lot — sauf
  `NoLanguageModelError`, qui ferait échouer toutes les suivantes à l’identique et interrompt
  donc la boucle.
- La langue épinglée peut avoir été retirée des préférences depuis : le `<select>` l’ajoute en
  tête de liste pour ne pas la perdre silencieusement.

## Références code

- Frontend
  - `theia-blueprint/theia-extensions/zones/src/browser/geocache-log-editor-widget.tsx`
  - `theia-extensions/zones/src/browser/log-editor/log-translator.ts`
  - `theia-extensions/zones/src/browser/log-editor/batch-translation-bar.tsx`
  - `theia-extensions/zones/src/browser/geoapp-log-translator-agent.ts`

- Backend
  - `gc-backend/gc_backend/blueprints/logs.py`
  - `gc-backend/gc_backend/services/geocaching_submit_logs.py`
