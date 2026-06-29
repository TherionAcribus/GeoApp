# Détails d'une géocache - Documentation technique

## Vue d'ensemble

La **page de détails d'une géocache** est l'onglet central de GeoApp pour consulter et manipuler une cache : statistiques, coordonnées (originales / corrigées), description (originale / modifiée / traduite), indices, images, waypoints, checkers, résumé des logs récents et statut d'archive. Elle sert aussi de point de lancement vers les outils d'analyse (Formula Solver, Plugin Executor, Metasolver, atelier de grilles) et vers les chats IA (chat dédié, chat libre, analyse d'images).

Tout est concentré dans l'extension Theia `zones` :

```text
frontend/theia-extensions/zones/src/browser/geocache-details-*
```

Le code est organisé selon une séparation stricte **rendu / état / métier / HTTP** : un widget Theia détient l'état et orchestre, une vue React purement présentationnelle affiche, des contrôleurs portent le métier (sans dépendance à l'UI Theia) et un service encapsule les appels HTTP.

Particularité notable : le widget est **multi-instances** (un onglet par géocache), géré par `GeocacheTabsManager`, alors que les contrôleurs et services sont des **singletons** partagés entre toutes les instances.

## Architecture

### Fichiers frontend

| Fichier | Rôle |
|---|---|
| `geocache-details-widget.tsx` | `ReactWidget` Theia (`StatefulWidget`). Détient tout l'état, orchestre les actions, écoute les événements (DOM + service inter-widgets), et délègue le rendu à `GeocacheDetailsView`. ~1300 lignes : c'est le chef d'orchestre. |
| `geocache-details-view.tsx` | Composant React **sans état** : assemble les sections dans l'ordre et applique l'overlay de rechargement. Contient les wrappers `React.memo` des composants feuilles coûteux. |
| `geocache-details-sections.tsx` | Composants présentationnels du header et des sections (overview, infos détaillées, indices, checkers) + helpers de rendu (étoiles, attributs, badges d'archive). |
| `geocache-details-types.ts` | DTO et types partagés (`GeocacheDto`, `GeocacheWaypoint`, `GeocacheChecker`, `DescriptionVariant`, `WaypointPrefillPayload`…). |
| `geocache-details-service.ts` | Client HTTP (via `BackendApiClient`) : description, coordonnées, waypoints, statut solved, contenu traduit, archive, workflow chat, résumé des logs. |
| `geocache-details-content-controller.ts` | Logique de contenu pure : choix description effective (original/modifié), décodage ROT13 des indices, extraction du contenu cherchable (recherche in-page). |
| `geocache-details-preferences-controller.ts` | Lecture/écriture typée des préférences `geoApp.*` (variante par défaut, ROT13, mode d'ouverture des liens/checkers, options galerie d'images & OCR…). |
| `geocache-details-archive-controller.ts` | Statut d'archive (`synced` / `needs_sync` / `none` / `loading`) et synchronisation. |
| `geocache-details-chat-controller.ts` | Construction des contextes de chat IA (dédié, libre, images) et résolution du profil/workflow effectif. |
| `geocache-details-translation-controller.ts` | Traduction IA (description seule ou tout le contenu) via `LanguageModelService`, puis persistance des overrides. |
| `geocache-details-navigation-controller.ts` | Navigation inter-widgets par événements DOM (ouverture logs / éditeur de log / notes) et (dé)activation de la carte associée. |
| `geocache-details-notes-controller.ts` | Comptage des notes + auto-sync de la note perso GC.com (selon préférence). |
| `geocache-details-header-actions.ts` | Registre d'actions de header extensibles via `ContributionProvider` (ex. action EarthCache). |
| `geocache-coordinates-editor.tsx` | Éditeur des coordonnées + statut « solved » (composant autonome). |
| `geocache-description-editor.tsx` | Éditeur de description (bascule variante, édition, traduction) ; rendu HTML **sanitizé**. |
| `geocache-waypoints-editor.tsx` | Éditeur de waypoints (création/édition, projection, antipode, actions). |
| `geocache-images-panel.tsx` | Galerie d'images (stockage local, OCR, sélection pour chat) — composant le plus lourd. |
| `geocache-logs-summary.tsx` | Résumé compact des derniers logs. |

Chaîne de responsabilités :

```text
View (rendu) → Widget (état + orchestration) → Controllers (métier) → Service (HTTP) → BackendApiClient
```

La vue et les contrôleurs ne se connaissent pas ; ils communiquent uniquement via le widget.

### Injection de dépendances

`zones-frontend-module.ts` :

- `bind(GeocacheDetailsWidget).toSelf();` → **transient** : chaque `getOrCreateWidget` produit une nouvelle instance (un onglet = un widget).
- La `WidgetFactory` (`id = 'geocache.details.widget'`) crée le widget et lui attribue un `id` suffixé `#<instanceId>` pour permettre plusieurs onglets simultanés.
- Tous les contrôleurs et services (`GeocacheDetailsService`, `*Controller`, `GeoAppWidgetEventsService`, `BackendApiClient`…) sont liés `inSingletonScope()`.
- `GeocacheDetailsHeaderActionContribution` est exposé via `bindRootContributionProvider` (point d'extension du header).

## Modèle de données

### `GeocacheDto` (frontend)

Miroir de la géocache renvoyée par le backend (`GET /api/geocaches/<id>`). Champs principaux :

| Groupe | Champs |
|---|---|
| Identité | `id`, `gc_code`, `name`, `url`, `type`, `size`, `owner`, `status` |
| Difficulté | `difficulty`, `terrain`, `favorites_count`, `logs_count`, `placed_at`, `attributes[]` |
| Coordonnées | `latitude`, `longitude`, `coordinates_raw`, `is_corrected`, `original_*` |
| Description | `description_html`, `description_raw`, `description_override_html`, `description_override_raw`, `description_override_updated_at` |
| Indices | `hints`, `hints_decoded`, `hints_decoded_override`, `hints_decoded_override_updated_at` |
| Résolution | `solved` (`not_solved` / `in_progress` / `solved`), `found`, `found_date` |
| Relations | `waypoints[]`, `checkers[]`, `images[]`, `zone_id` |

Notion clé de **variante de description** (`DescriptionVariant`) :

- `original` : `description_html` (sinon `description_raw` converti en HTML).
- `modified` : `description_override_html` (sinon `description_override_raw`).

La présence d'`override_*` indique qu'une version modifiée existe (édition manuelle **ou** traduction IA). Même logique pour les indices (`hints_decoded_override`) et les notes de waypoints (`note_override`).

## API backend consommée

Routes appelées par la page (via `GeocacheDetailsService` et `GeocachesService`, toutes en `credentials: 'include'`) :

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/geocaches/<id>` | Charge le `GeocacheDto` complet. |
| POST | `/api/geocaches/<id>/refresh` | Re-scrape la géocache depuis GC.com. |
| PUT | `/api/geocaches/<id>/coordinates` | Met à jour les coordonnées corrigées. |
| POST | `/api/geocaches/<id>/reset-coordinates` | Réinitialise les coordonnées. |
| POST | `/api/geocaches/<id>/push-corrected-coordinates` | Pousse les coordonnées corrigées vers GC.com. |
| PUT | `/api/geocaches/<id>/solved-status` | Met à jour le statut de résolution. |
| PUT | `/api/geocaches/<id>/description` | Enregistre la description modifiée. |
| POST | `/api/geocaches/<id>/reset-description` | Réinitialise la description. |
| PUT | `/api/geocaches/<id>/translated-content` | Enregistre description + indices + notes traduits. |
| POST/PUT | `/api/geocaches/<id>/waypoints[/<wid>]` | Crée / met à jour un waypoint. |
| DELETE | `/api/geocaches/<id>/waypoints/<wid>` | Supprime un waypoint. |
| POST | `/api/geocaches/<id>/waypoints/<wid>/push-coordinates` | Pousse les coords d'un waypoint vers GC.com. |
| POST | `/api/geocaches/<id>/set-corrected-coords/<wid>` | Définit un waypoint comme coords corrigées. |
| GET | `/api/geocaches/<id>/logs/recent-summary?count=<n>` | Résumé des derniers logs. |
| GET | `/api/geocaches/<id>/images` | Liste des images (pour le chat libre). |
| GET | `/api/archive/<gc>/status` | Statut d'archive. |
| POST | `/api/archive/<gc>/sync` | Synchronise l'archive. |
| POST | `/api/plugins/workflow/resolve` | Prévisualise le workflow/profil de chat IA. |

## Cycle de vie & multi-instances

`GeocacheTabsManager.openGeocacheDetails()` :

1. cherche un onglet existant pour la géocache (ou recycle un onglet selon la logique « smart replace ») ;
2. à défaut, crée un widget via `widgetManager.getOrCreateWidget(GeocacheDetailsWidget.ID, { instanceId })` ;
3. appelle `widget.setGeocache({ geocacheId, name })` puis attache et active l'onglet.

`setGeocache()` réinitialise l'état spécifique à la cache (`notesCount`, `archiveStatus`, résumé des logs…), met à jour le titre de l'onglet, (ré)arme le timer d'interaction, puis lance `load()`.

**Persistance d'état** (`StatefulWidget`) : `storeState()` sérialise `{ geocacheId, lastAccessTimestamp }` ; `restoreState()` rappelle `setGeocache()` au redémarrage de l'application.

## État du widget & flux de chargement

### État principal

Données : `geocacheId`, `data: GeocacheDto`, `notesCount`, `logsSummaryEntries[]`, `logsSummaryTotalCount`, `archiveStatus`, `archiveUpdatedAt`.
Variante d'affichage : `descriptionVariant`, `descriptionVariantGeocacheId`.
Flags : `isLoading`, `isSavingWaypoint`, `isTranslatingDescription`, `isTranslatingAllContent`, `isSyncingArchive`, `isLogsSummaryLoading`, `isChatRoutingPreviewLoading`.
Chat : `chatWorkflowPreview`, `chatProfilePreview`, `chatProfileOverride`, `isChatProfileMenuOpen`, état du dialogue de chat libre.

`this.update()` (de `ReactWidget`) re-rend la vue après chaque mutation.

### `load()`

1. `isLoading = true` → `update()` (affiche l'overlay discret sur le contenu existant) ;
2. `await geocachesService.get()` → pose `data`, calcule la variante de description par défaut, met à jour le titre ;
3. `isLoading = false` → `update()` : l'overlay disparaît **dès** que les données principales sont là ;
4. lance **en parallèle** les chargements secondaires (notes, auto-sync GC.com, statut d'archive, preview de routage chat, résumé des logs). Leurs préfixes synchrones fusionnent en un seul rendu (conflation Lumino), puis chacun rafraîchit l'UI à son aboutissement (affichage progressif).

Les chargements secondaires portent une **garde anti-course** : si l'utilisateur change de géocache entre-temps (`this.geocacheId !== geocacheId` capturé), le résultat obsolète est ignoré.

## Sections de l'UI

L'ordre de rendu (`GeocacheDetailsView`) :

1. **Header** (`GeocacheDetailsHeader`) : titre, badges (archivée / désactivée), barre d'actions :
   - menu déroulant **« Analyser »** (Formula Solver, Analyse page, Analyse code/Metasolver, Analyse plugins, Grilles, + actions contribuées) ;
   - **split-button Chat IA** affichant le profil effectif + menu de sélection de profil (`Auto`/`Fast`/`Strong`/`Web`/`Local`) ;
   - **Chat Libre** ;
   - groupe **Logs / Loguer / Notes** (avec compteur de notes) ;
   - bouton **rafraîchir** et bouton **statut d'archive** (couleur/icône selon l'état).
2. **Overview** (`GeocacheOverviewSection`) : carte « Statistiques » (D/T en étoiles, taille, favoris, résumé des logs, attributs) + carte « Coordonnées » (`CoordinatesEditor`).
3. **Infos détaillées** (`GeocacheDetailedInfoSection`) : `<details>` repliable avec le tableau complet.
4. **Description** (`DescriptionEditor`) : bascule original/modifié, édition, traduction (FR / tout FR), rendu HTML **sanitizé**.
5. **Indices** (`GeocacheHintsSection`) : affichage codé/décodé (ROT13) avec bascule.
6. **Images** (`GeocacheImagesPanel`) : galerie, stockage local, OCR, sélection pour chat.
7. **Waypoints** (`WaypointsEditorWrapper`) : CRUD, projection/antipode, push GC.com, définir comme coords corrigées.
8. **Checkers** (`GeocacheCheckersSection`) : liens vers les checkers, menu contextuel d'ouverture (même groupe / nouveau groupe / fenêtre externe), avertissement spécifique GeoCheck (captcha).

## Fonctionnalités transverses

### Traduction IA

`GeocacheDetailsTranslationController` utilise `LanguageModelService` (agent `GeoAppTranslateDescriptionAgentId`) pour traduire :

- **la description seule** (`translateDescription`) : conserve le HTML, ne traduit que le texte ;
- **tout le contenu** (`translateAllContent`) : description + indices + notes de waypoints, renvoyé en JSON structuré.

Le résultat est nettoyé (`sanitizeTranslatedHtml` retire les blocs `<think>`/`<analysis>`) puis persisté en overrides ; la variante bascule sur `modified`. Si des overrides existent déjà, une `ConfirmDialog` demande confirmation avant écrasement.

### Chat IA

`GeocacheDetailsChatController` :

- `resolveRoutingPreview()` interroge `/api/plugins/workflow/resolve` pour prévisualiser le **workflow** et en déduire le **profil effectif** (selon les préférences `geoApp.chat.*`). L'utilisateur peut forcer un profil via le menu (`chatProfileOverride`).
- `openGeocacheChat` / `openFreeChat` / `openImagesChat` construisent le contexte et émettent une requête d'ouverture de chat (événement DOM consommé par l'extension chat).

### Statut d'archive

`GeocacheDetailsArchiveController` mappe la réponse backend en `synced` / `needs_sync` / `none`. Le bouton du header déclenche `forceSyncArchive()`.

### Navigation inter-widgets

`GeocacheDetailsNavigationController` émet des `CustomEvent` DOM (`open-geocache-logs`, `open-geocache-log-editor`, `open-geocache-notes`) et (ré)active/ferme la **carte associée** (`geoapp-map-geocache-<id>` dans la zone `bottom`) au gré de l'activation/fermeture de l'onglet.

### Événements écoutés / émis

| Sens | Événement | Effet |
|---|---|---|
| Écoute (DOM) | `geoapp-plugin-add-waypoint` | Pré-remplit ou auto-sauvegarde un waypoint issu d'un plugin. |
| Écoute (DOM) | `geoapp-geocache-coordinates-updated` | Recharge si la cache concernée. |
| Écoute (service) | `GeoAppWidgetEventsService.onDidChangeGeocache` | Recharge si `event.geocacheId === this.geocacheId`. |
| Émet (service) | `notifyGeocacheChanged({ reason, source: 'details' })` | Après création/suppression de waypoint, mise à jour des coords corrigées ou du statut. |
| Émet (DOM) | `geoapp-geocache-tab-interaction` | Signale clic / scroll / temps minimum d'ouverture (logique « smart replace » des onglets). |
| Émet (DOM) | `geoapp-geocache-images-updated` | Après rafraîchissement, pour réactualiser les galeries. |

## Performance (rendu React)

Le widget est un `ReactWidget` : chaque `update()` re-rend tout l'arbre. Plusieurs optimisations rendent ce coût négligeable hors changement réel de données :

- **Composants feuilles mémoïsés** (`React.memo` dans `geocache-details-view.tsx`) : `CoordinatesEditor`, `DescriptionEditor`, `GeocacheImagesPanel` (le plus lourd), `WaypointsEditorWrapper`, `GeocacheDetailedInfoSection`. Comme les props sont passées en spread, `memo` compare chaque **valeur** individuellement (l'identité de l'objet de props n'a pas d'importance).
- **Références de callbacks stables** : le widget expose des champs-flèches `readonly` (`handleSaveCoordinates`, `handleSaveWaypoint`, `handleThumbnailSizeChange`…) au lieu de fermetures recréées à chaque `render()`. C'est la condition pour que `memo` court-circuite.
- **Cache de `hiddenDomains`** : le getter de préférence reconstruit un tableau à chaque appel (référence instable) ; `getStableHiddenDomains()` ne le recalcule que si le texte source change.
- **Rendu progressif sans démontage** : pendant un rechargement, le contenu existant reste monté (préservation du scroll), atténué et coiffé d'un badge « Mise à jour… » ; seul le **tout premier** chargement affiche un « Chargement… » plein écran.
- **Batching des `update()`** : `load()` masque l'overlay dès l'arrivée des données principales puis lance les chargements secondaires en parallèle ; leurs rendus initiaux fusionnent (conflation Lumino). Un `load()` passe d'une dizaine de rendus à ~2 + les rendus progressifs nécessaires.
- **Sanitisation mémoïsée** : `DOMPurify.sanitize` de la description est encapsulé dans un `useMemo` (clé : le HTML effectif).

## Sécurité

- **Sanitisation XSS de la description** : le HTML provient de geocaching.com (contenu tiers non maîtrisé) et est injecté via `dangerouslySetInnerHTML`. Il est systématiquement nettoyé par `DOMPurify` (`@theia/core/shared/dompurify`) avant injection — scripts, handlers `on*` et URLs `javascript:` neutralisés ; images, liens et mise en forme conservés.
- **Liens externes** : la description intercepte les clics sur les `<a>` pour les ouvrir selon la préférence (`new-tab` / `new-window`), et les checkers offrent un choix explicite (même groupe / nouveau groupe / fenêtre externe).

## UX & accessibilité

- **Indicateur de rechargement discret** : pas de flash ni de perte de scroll lors des rechargements déclenchés par une action.
- **Menus cohérents** : « Analyser » et « profil de chat » se ferment tous deux au clic extérieur **et** à la touche **Échap**.
- **Accessibilité des menus** : déclencheurs avec `aria-haspopup='menu'` + `aria-expanded` ; conteneurs `role='menu'` ; items `role='menuitem'` / `role='menuitemradio'` (`aria-checked`) focusables (`tabIndex`), activables au clavier (Enter/Espace), `aria-disabled` si désactivés.
- **Boutons icône-seule** (`▾`, `🔄`) : `aria-label` explicite ; emojis purement décoratifs marqués `aria-hidden='true'`.
- **Confirmations** : suppression de waypoint, push vers GC.com, écrasement d'overrides par traduction et stockage local des images passent par une `ConfirmDialog`.
- **Couleurs thémisées** : usage des variables `var(--theia-*)` pour rester lisible en thème clair comme sombre.

## Points d'attention

- Le widget est **transient** (par onglet) ; ne pas y stocker d'état devant survivre à la fermeture autrement que via `storeState()/restoreState()`.
- Les gardes anti-course sont nécessaires car les contrôleurs sont des **singletons** partagés : capturer `geocacheId` localement avant tout `await` dont le résultat mute l'instance.
- Les overrides (`description_override_*`, `hints_decoded_override`, `note_override`) reflètent une modification manuelle **ou** une traduction IA : ils ne sont pas distinguables côté DTO.
- La sanitisation préserve les images en `data:`/URL : elle ne filtre pas le contenu visuel, seulement le HTML dangereux.
- Le rendu mémoïsé suppose que `this.data` est **réassigné** (nouvelle référence) lors d'un changement ; les mutations en place sans `update()` ou sans nouvelle référence ne déclencheront pas de re-rendu des composants mémoïsés.
- La preview de routage chat et le résumé des logs sont « best-effort » : leurs échecs sont seulement journalisés (pas de toast d'erreur).

## Références code

- Widget & vue
  - `frontend/theia-extensions/zones/src/browser/geocache-details-widget.tsx`
  - `frontend/theia-extensions/zones/src/browser/geocache-details-view.tsx`
  - `frontend/theia-extensions/zones/src/browser/geocache-details-sections.tsx`
  - `frontend/theia-extensions/zones/src/browser/geocache-details-types.ts`
- Contrôleurs
  - `geocache-details-content-controller.ts`, `geocache-details-preferences-controller.ts`
  - `geocache-details-archive-controller.ts`, `geocache-details-chat-controller.ts`
  - `geocache-details-translation-controller.ts`, `geocache-details-navigation-controller.ts`
  - `geocache-details-notes-controller.ts`, `geocache-details-header-actions.ts`
- Service & HTTP
  - `geocache-details-service.ts`, `geocaches-service.ts`, `backend-api-client.ts`
- Éditeurs & panneaux
  - `geocache-coordinates-editor.tsx`, `geocache-description-editor.tsx`
  - `geocache-waypoints-editor.tsx`, `geocache-images-panel.tsx`, `geocache-logs-summary.tsx`
- Intégration
  - `geocache-tabs-manager.ts` (multi-instances), `geoapp-widget-events-service.ts` (événements inter-widgets)
  - `zones-frontend-module.ts` (bindings DI & WidgetFactory)
