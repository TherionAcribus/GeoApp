# EarthCoach - Documentation technique

## Vue d'ensemble

EarthCoach est une extension Theia separee de `zones` :

```text
frontend/theia-extensions/earthcoach
```

Elle fournit un agent IA `@EarthCoach` specialise dans les EarthCaches. L'objectif est de garder le coeur GeoApp lisible et de pouvoir desactiver EarthCoach en retirant sa dependance de l'application browser.

EarthCoach repose sur :

- listing et fiche de geocache venant de `zones` ;
- observations structurees backend quand elles existent ;
- notes GeoApp existantes, utilisees comme fallback textuel ;
- images de listing ou images utilisateur deja disponibles ;
- chat Theia/GeoApp existant.

## Extension et wiring Theia

Fichiers principaux :

| Fichier | Role |
|---|---|
| `earthcoach-frontend-module.ts` | Module InversifyJS, bindings agent, commands, tools, widget references. |
| `earthcoach-agent.ts` | Agent `@EarthCoach`, prompt systeme et injection des tools EarthCoach. |
| `earthcoach-command-contribution.ts` | Commandes, menus, bouton EarthCoach sur les fiches EarthCache, QuickPick d'actions. |
| `earthcoach-context-service.ts` | Collecte le contexte actif : cache, observations structurees, notes fallback, images, derniere fiche ouverte. |
| `earthcoach-prompt-builder.ts` | Construit le prompt utilisateur envoye au chat a l'ouverture d'une action. |
| `earthcoach-prompts.ts` | Prompt systeme des modes `coach` et `resolver`. |
| `earthcoach-types.ts` | Types EarthCoach : modes, actions, images, observations. |
| `earthcoach-field-checklist.ts` | Builder pur du mode terrain compact. |
| `earthcoach-field-checklist-widget.tsx` | Widget Theia de checklist imprimable/mobile. |
| `earthcoach-image-gallery.ts` | Regroupement strict des images par origine. |
| `earthcoach-image-gallery-widget.tsx` | Widget Theia de galerie images separee. |
| `earthcoach-observations.ts` | Helpers purs des brouillons et payloads d'observations structurees. |
| `earthcoach-observation-service.ts` | Client frontend des routes observations et upload photo. |
| `earthcoach-observations-widget.tsx` | Widget Theia de creation, edition, suppression et liaison de photos aux observations. |
| `earthcoach-logging-tasks.ts` | Helpers purs des questions du proprietaire : DTO, drafts, normalisation de l'extraction LLM. |
| `earthcoach-logging-task-service.ts` | Client frontend des routes logging tasks (liste, CRUD, remplacement en masse). |
| `earthcoach-logging-task-tools.ts` | Tool `earthcoach_extract_logging_tasks` et evenement de rafraichissement du widget. |
| `earthcoach-logging-tasks-widget.tsx` | Widget Theia de suivi, edition et extraction des questions du proprietaire. |
| `earthcoach-geo-calculator.ts` | Fonctions pures de calcul geologique deterministe et dispatcher `runEarthCoachCalculation`. |
| `earthcoach-geo-calculator-tools.ts` | Tool `earthcoach_calculate` exposant les calculs deterministes a l'agent. |
| `earthcoach-geology.ts` | Types du contexte geologique et resume pur `formatGeologySummary`. |
| `earthcoach-geology-service.ts` | Client frontend du proxy geologique (`/api/earthcoach/geology`). |
| `earthcoach-geology-tools.ts` | Tool `earthcoach_geology_at_point` (contexte geologique par coordonnees). |
| `earthcoach-mode.ts` | Helpers purs du mode: normalisation, lecture et mise a jour des settings de session. |
| `earthcoach-mode-tools.ts` | Tool `earthcoach_set_mode` (bascule coach <-> resolver de la session active). |
| `earthcoach-reference-tools.ts` | Tool `earthcoach_search_reference`, recherches Wikipedia/Wikimedia, cache local. |
| `earthcoach-reference-widget.tsx` | Vue "References EarthCoach" avec recherche, articles et images pedagogiques. |
| `earthcoach-note-tools.ts` | Tool `earthcoach_save_note` pour enregistrer une synthese dans les notes GeoApp. |
| `earthcoach-preferences.ts` | Constantes des preferences EarthCoach. |

L'extension est declaree comme package Theia :

```json
{
  "name": "theia-ide-earthcoach-ext",
  "theiaExtensions": [
    { "frontend": "lib/browser/earthcoach-frontend-module" }
  ]
}
```

## Agent `@EarthCoach`

Identifiant :

```ts
export const EarthCoachAgentId = 'earthcoach';
```

Nom visible :

```ts
readonly name = '@EarthCoach';
```

L'agent herite de `AbstractStreamParsingChatAgent`.

Il expose les tools EarthCoach a chaque requete via `sendLlmRequest()` :

- `earthcoach_search_reference`
- `earthcoach_save_note`
- `earthcoach_extract_logging_tasks`
- `earthcoach_calculate`
- `earthcoach_geology_at_point`
- `earthcoach_set_mode`

La methode filtre les tools EarthCoach deja presents dans `toolRequests`, puis ajoute les instances reconstruites par les managers :

```ts
const earthCoachTools = [
    ...this.referenceTools.buildAllTools(),
    ...this.noteTools.buildAllTools(),
    ...this.loggingTaskTools.buildAllTools(),
    ...this.geoCalculatorTools.buildAllTools(),
    ...this.geologyTools.buildAllTools(),
    ...this.modeTools.buildAllTools(),
];
```

## Modes

EarthCoach supporte deux modes :

```ts
export type EarthCoachMode = 'coach' | 'resolver';
```

### `coach`

Mode par defaut. Il aide a comprendre, expliquer et preparer la visite. Il ne doit pas donner une reponse finale prete a envoyer au proprietaire.

### `resolver`

Mode explicite. Il peut aider a produire une synthese ou une formulation candidate, mais seulement a partir du listing, des notes et des observations fournies.

En mode `resolver`, le prompt utilisateur inclut un **gabarit de resolution structure** genere par `buildResolverTemplateInstruction`. Pour chaque question, EarthCoach doit produire : `Question`, `Reponse proposee` (ou `a completer sur le terrain`), `Fondee sur` (observation ou donnee du listing), `Confiance` (elevee / moyenne / faible) et `A completer`. Si des logging tasks structurees existent (voir plus bas), il les traite dans l'ordre de leur numero; sinon il deduit les questions du listing et applique le meme gabarit.

Le mode est transmis par le bridge chat GeoApp dans les settings de session :

```ts
commonSettings.geoapp.earthcoachMode
```

L'agent le relit dans `readMode()`.

### Badge de mode et bascule en cours de session

Le mode courant est rendu visible de deux facons :

- le **titre de session** encode deja le mode (`EARTHCOACH - <gc>` vs `EARTHCOACH RESOLUTION - <gc>`) ;
- le prompt systeme impose a l'agent de **commencer chaque reponse par une ligne de badge** (`**Mode EarthCoach : coach**` ou `**Mode EarthCoach : resolution**`) qui rappelle aussi comment changer.

Pour **basculer sans repasser par le QuickPick**, l'utilisateur formule sa demande en langage naturel ("passe en resolution", "reviens en coach"). L'agent appelle alors le tool `earthcoach_set_mode` (`earthcoach-mode-tools.ts`), qui met a jour `commonSettings.geoapp.earthcoachMode` de la **session de chat active** via `ChatService.getActiveSession()` puis `session.model.setSettings(...)` (helper pur `applyEarthCoachModeToSettings`). Le nouveau mode est lu par `readMode()` (via `readEarthCoachModeFromSettings`) et s'applique **au message suivant**.

La verbosite des reponses EarthCoach est aussi transmise par le bridge :

```ts
commonSettings.geoapp.earthcoachVerbosity
```

Valeurs supportees :

- `compact` : defaut, compte rendu rapide du listing ;
- `normal` : synthese pratique ;
- `detailed` : autorise davantage d'explications geologiques.

L'agent relit cette valeur dans `readVerbosity()` et adapte le prompt systeme.

## Actions rapides

Les actions sont definies par :

```ts
export type EarthCoachQuickAction =
  | 'understand'
  | 'prepare_visit'
  | 'field_checklist'
  | 'observations'
  | 'image_gallery'
  | 'explain_word'
  | 'illustrate_term'
  | 'analyze_observations'
  | 'resolve';
```

Le QuickPick est dans `earthcoach-command-contribution.ts`.

Les actions `understand`, `prepare_visit`, `explain_word`, `illustrate_term` et `analyze_observations` ouvrent EarthCoach en mode `coach`.

L'action `resolve` ouvre EarthCoach en mode `resolver`, avec un titre de session explicite :

```text
EARTHCOACH RESOLUTION - <GC ou nom>
```

L'action `field_checklist` ouvre directement le widget `EarthCoachFieldChecklistWidget`. Elle ne lance pas de requete LLM.

L'action `observations` ouvre directement le widget `EarthCoachObservationsWidget`. Elle ne lance pas de requete LLM.

L'action `image_gallery` ouvre directement le widget `EarthCoachImageGalleryWidget`. Elle ne lance pas de requete LLM.

## Mode terrain compact

Le mode terrain compact est une vue Theia autonome :

```text
EarthCoachFieldChecklistWidget.ID = 'earthcoach.fieldChecklist'
```

Le widget recoit un `EarthCoachContext`, appelle `buildEarthCoachFieldChecklist(context)`, puis affiche une checklist avec cases a cocher.

Sections generees :

- `A observer`
- `A mesurer ou estimer`
- `A photographier`
- `Questions du listing`
- `Waypoints et reperes`
- `A ne pas oublier`

La logique est volontairement deterministe et testable. Elle n'appelle pas le LLM et n'effectue pas de requete reseau.

Fonctions exportees :

```ts
buildEarthCoachFieldChecklist(context)
formatEarthCoachFieldChecklistMarkdown(checklist)
```

Le bouton **Copier Markdown** utilise le presse-papiers navigateur avec une sortie en cases a cocher Markdown.

Le bouton **Imprimer** appelle `window.print()`. Le widget inclut une regle CSS `@media print` pour masquer les actions.

## Galerie images stricte

La galerie images EarthCoach est une vue Theia autonome :

```text
EarthCoachImageGalleryWidget.ID = 'earthcoach.imageGallery'
```

Elle s'appuie sur un builder pur :

```ts
buildEarthCoachImageGallery(images)
```

Le builder retourne toujours trois sections, dans cet ordre :

1. `user_observation`
2. `cache_listing`
3. `educational_reference`

Chaque section porte un titre, une description et un rappel de prudence. Le but est d'eviter qu'une image pedagogique ou une image du listing soit traitee comme une preuve terrain.

Le widget affiche :

- les photos utilisateur ;
- les images du listing ;
- les references pedagogiques deja presentes dans le contexte ;
- un bouton vers `earthcoach.references.open` pour chercher des references pedagogiques supplementaires.

La galerie ne modifie pas la galerie image de `zones`. Elle reste dans l'extension EarthCoach pour conserver une separation optionnelle et desactivable.

## Observations terrain structurees

Le widget observations EarthCoach est une vue Theia autonome :

```text
EarthCoachObservationsWidget.ID = 'earthcoach.observations'
```

Il utilise le service frontend :

```text
EarthCoachObservationService
```

Fonctions exposees cote UI :

- creation d'une observation ;
- edition d'une observation existante ;
- suppression avec confirmation ;
- type `observation`, `hypothesis` ou `interpretation` ;
- date terrain `observed_at` ;
- waypoint lie ;
- coordonnees texte et coordonnees decimales ;
- liaison d'images existantes de la cache ;
- upload direct d'une photo utilisateur, puis liaison automatique au brouillon courant.

Le widget recharge la liste depuis :

```text
GET /api/geocaches/<id>/observations
```

Les mutations utilisent :

```text
POST /api/geocaches/<id>/observations
PUT /api/observations/<id>
DELETE /api/observations/<id>
```

L'upload photo utilise la route images existante :

```text
POST /api/geocaches/<id>/images/upload
```

Les photos importees sont ajoutees dans `geocache_image` avec une `source_url` `geoapp-upload://...`, puis EarthCoach les classe comme `user_observation`.

## Logging tasks (questions du proprietaire)

EarthCoach modelise les questions imposees par le proprietaire d'une EarthCache comme une entite persistante `GeocacheLoggingTask` :

- table `geocache_logging_task` ;
- migration `add_geocache_logging_task_table` (revision suivant `add_user_observation_table`) ;
- relation `Geocache.logging_tasks` (cascade delete, triee par `position`).

Chaque logging task porte :

- `position` : numero d'ordre de la question ;
- `question` : texte de la question du CO ;
- `guidance` : ce qu'il faut observer ou mesurer pour y repondre (optionnel) ;
- `answer` : brouillon de reponse (optionnel) ;
- `status` : `todo`, `field` (a observer sur place) ou `answered` ;
- `requires_photo` : la question exige-t-elle une photo ;
- `observation_id` : observation `UserObservation` qui justifie la reponse (FK `ON DELETE SET NULL`) ;
- `source` : `manual` ou `extracted`.

Routes (blueprint `logging_tasks`) :

```text
GET    /api/geocaches/<id>/logging-tasks
POST   /api/geocaches/<id>/logging-tasks
PUT    /api/geocaches/<id>/logging-tasks   (remplacement en masse, utilise par l'extraction IA)
PUT    /api/logging-tasks/<id>
DELETE /api/logging-tasks/<id>
```

Cote frontend, `EarthCoachContextService.loadLoggingTasks` charge ces taches dans `EarthCoachContext.loggingTasks`. Le prompt builder les expose dans un bloc `Questions du proprietaire (logging tasks)` et le mode terrain compact les utilise en priorite a la place de l'extraction regex des questions du listing.

### Alimentation par extraction LLM

Le tool `earthcoach_extract_logging_tasks` (`earthcoach-logging-task-tools.ts`) permet a l'agent d'extraire les questions du listing et de les enregistrer via `EarthCoachLoggingTaskService.replaceLoggingTasks` (route `PUT /api/geocaches/<id>/logging-tasks`). Cette operation **remplace** toutes les questions existantes; le prompt systeme rappelle de ne l'utiliser que sur demande explicite. Apres ecriture, le tool emet l'evenement `earthcoach-logging-tasks-updated` pour rafraichir le widget ouvert.

### Widget de gestion

`EarthCoachLoggingTasksWidget` (`earthcoach.loggingTasks`) permet de :

- lister les questions enregistrees avec statut, indicateur photo et observation liee ;
- creer, editer et supprimer une question manuellement ;
- definir le statut (`todo`, `field`, `answered`), la consigne d'observation, le brouillon de reponse et l'observation `UserObservation` liee ;
- declencher l'extraction IA via le bouton **Extraire via EarthCoach (IA)**, qui execute la commande `earthcoach.open` avec l'action `extract_logging_tasks`.

L'action rapide **Questions du proprietaire** du QuickPick (`logging_tasks`) ouvre ce widget.

### Boucle terrain (question <-> observation)

Chaque question expose un bouton **Observer** qui execute la commande `earthcoach.observeTask` (id `EarthCoachObserveTaskCommandId`). Le handler `observeLoggingTask` collecte le contexte, ouvre le widget Observations et lui transmet une graine `LoggingTaskSeed` via `seedFromLoggingTask`.

Cote widget Observations :

- une banniere rappelle la question liee (`formatLoggingTaskSeedLabel`) avec un bouton **Ne pas lier** ;
- a la creation de l'observation, si une graine est presente, l'observation est liee a la question via `EarthCoachLoggingTaskService.linkObservation` (route `PUT /api/logging-tasks/<id>` avec `observation_id`) ;
- l'evenement `earthcoach-logging-tasks-updated` est emis pour rafraichir le widget Questions.

La liaison inverse (choisir une observation existante pour une question) reste disponible via le menu deroulant du formulaire de question. La boucle se ferme donc dans les deux sens : terrain -> observation -> question -> resolution.

## Calculs geologiques deterministes

Le tool `earthcoach_calculate` (`earthcoach-geo-calculator-tools.ts`) couvre les questions quantitatives frequentes des EarthCaches, la ou un calcul fait "de tete" par le LLM est peu fiable. La logique est entierement deterministe et testee dans `earthcoach-geo-calculator.ts` :

| Operation | Calcul | Parametres |
|---|---|---|
| `height_from_shadow` | hauteur = hauteur_ref x (ombre_objet / ombre_ref) | reference_height, reference_shadow, object_shadow |
| `scale_from_reference` | taille_reelle = mesure_cible x (taille_ref / mesure_ref) | reference_real, reference_measured, target_measured |
| `slope_angle` | angle = atan(denivele / distance) + pente en % | rise, run |
| `distance_between_coordinates` | distance Haversine (m et km) | lat1, lon1, lat2, lon2 |
| `age_from_rate` | duree = quantite / taux | amount, rate, amount_unit?, time_unit? |
| `flow_rate` | debit = volume / temps | volume, time, volume_unit?, time_unit? |
| `circumference_to_diameter` | diametre = circonference / pi (+ rayon) | circumference |
| `average` | moyenne, min, max, somme | values |

Chaque resultat renvoie la valeur, l'unite, la formule, les entrees et un rappel que les mesures doivent venir du terrain. Le prompt systeme demande d'utiliser ce tool des qu une valeur chiffree est attendue et de ne jamais inventer les mesures d entree.

## Contexte geologique par coordonnees

EarthCoach peut situer la geologie d'une EarthCache a partir de ses coordonnees decimales, via **Macrostrat** (API JSON publique, sans cle, couverture mondiale).

Architecture :

- **Proxy backend** `earthcoach_geology.py` : route `GET /api/earthcoach/geology?lat=&lon=`. Il appelle Macrostrat (`geologic_units/map`), normalise chaque unite (nom, lithologie, age, description...), met en cache memoire (TTL 24 h, cle par coordonnees arrondies) et renvoie une erreur 502 propre si le service externe est indisponible. Le proxy evite toute dependance au CORS et centralise le cache.
- **Service frontend** `EarthCoachGeologyService.geologyAtPoint(lat, lon)`.
- **Tool** `earthcoach_geology_at_point` (`earthcoach-geology-tools.ts`) : l'agent l'appelle avec les coordonnees decimales de la cache (desormais incluses dans le prompt). La reponse contient les unites normalisees plus un `summary` (`formatGeologySummary`).
- **Action rapide** `geology_context` (groupe *Comprendre*) : lance une session chat qui demande a l'agent d'appeler le tool puis de resumer lithologie, age et formation.

Le prompt systeme rappelle que ces donnees viennent d'une carte geologique generale : ce n'est jamais une observation de terrain, et le resultat doit etre confirme sur place. Attribution : Macrostrat (CC-BY 4.0).

## Integration avec `zones`

`zones` ne depend pas d'EarthCoach directement. Il expose un point d'extension generique pour les actions d'en-tete de fiche geocache :

- `GeocacheDetailsHeaderActionContribution`
- `GeocacheDetailsHeaderActionRegistry`

EarthCoach contribue une action uniquement si la cache est une EarthCache :

```ts
if (!isEarthCacheGeocache(context.geocacheData)) {
    return [];
}
```

Cela garde EarthCoach optionnel : si l'extension n'est pas chargee, aucun bouton EarthCoach n'apparait.

## Bridge Chat GeoApp

EarthCoach utilise le bridge existant de `zones` pour ouvrir une session de chat.

Champs importants :

| Champ | Role |
|---|---|
| `preferredAgentId: 'earthcoach'` | Force l'agent `@EarthCoach`. |
| `sessionKind: 'earthcoach'` | Evite la reutilisation d'une session GeoApp classique. |
| `earthcoachMode` | Transmet `coach` ou `resolver`. |
| `earthcoachVerbosity` | Transmet `compact`, `normal` ou `detailed` pour aligner le prompt systeme avec la preference utilisateur. |
| `imageContexts` | Transporte les images avec leur origine. |
| `resumeState.earthcoach` | Stocke mode, action et origines images dans l'etat de reprise. |

## Images et observations

Types principaux :

```ts
type ImageOrigin =
  | 'cache_listing'
  | 'user_observation'
  | 'educational_reference';
```

```ts
interface GeoImage {
  id: string;
  origin: ImageOrigin;
  cacheId?: string;
  userId?: string;
  label?: string;
  description?: string;
  takenAt?: string;
  coordinates?: { lat: number; lon: number };
  fileUri: string;
}
```

```ts
interface UserObservation {
  id: string;
  cacheId: string;
  userId: string;
  waypointId?: string;
  observationType?: 'observation' | 'hypothesis' | 'interpretation';
  note: string;
  observedAt?: string;
  createdAt: string;
  coordinates?: { lat: number; lon: number };
  coordinatesRaw?: string;
  source?: 'structured' | 'note';
  images: GeoImage[];
  sourceNoteId?: number;
}
```

Le backend expose maintenant une entite persistante `UserObservation` :

- table `user_observation` ;
- table de liaison `user_observation_image` ;
- route `GET /api/geocaches/<id>/observations` ;
- route `POST /api/geocaches/<id>/observations` ;
- route `PUT /api/observations/<id>` ;
- route `DELETE /api/observations/<id>`.

Chaque observation peut porter :

- `observation_type` : `observation`, `hypothesis`, `interpretation` ;
- `observed_at` ;
- `waypoint_id` ;
- `latitude`, `longitude`, `coordinates_raw` ;
- `image_ids` pour lier des photos `GeocacheImage`.

L'UI dediee EarthCoach permet maintenant de creer et modifier ces observations sans passer par l'API manuellement.

EarthCoach charge d'abord les observations structurees. S'il n'y en a pas, il conserve le fallback historique : les notes utilisateur sont mappees en observations textuelles.

## References externes

Le tool `earthcoach_search_reference` cherche des references pedagogiques externes. Les resultats sont toujours marques `educational_reference`.

Sources disponibles :

- Wikipedia ;
- Wikimedia Commons ;
- BRGM ;
- InfoTerre BRGM ;
- GeoWiki ;
- Planet-Terre ENS Lyon.

`wikipedia` et `wikimedia` utilisent des API publiques pour retourner articles et images. Les sources `brgm`, `infoterre`, `geowiki` et `planet-terre` retournent des entrees `source_portal` : ce sont des liens de recherche fiables vers les portails concernes, pas des observations terrain ni des preuves automatiques.

Preferences associees :

| Cle | Defaut | Role |
|---|---|---|
| `geoApp.earthCoach.references.web.enabled` | `true` | Active ou desactive la recherche externe. |
| `geoApp.earthCoach.response.verbosity` | `compact` | Controle la longueur des premiers comptes rendus EarthCoach : `compact`, `normal` ou `detailed`. |
| `geoApp.earthCoach.references.language` | `fr` | Langue par defaut : `fr` ou `en`. |
| `geoApp.earthCoach.references.maxArticles` | `3` | Limite articles Wikipedia. |
| `geoApp.earthCoach.references.maxImages` | `5` | Limite images Wikimedia. |
| `geoApp.earthCoach.references.allowedSources` | `wikipedia,wikimedia,brgm,infoterre,geowiki,planet-terre` | Sources CSV autorisees. |

Les preferences sont declarees dans le schema partage :

```text
shared/preferences/geo-preferences-schema.json
```

Les constantes sont dans :

```text
frontend/theia-extensions/earthcoach/src/browser/earthcoach-preferences.ts
```

## Cache local des references

`EarthCoachReferenceTools` maintient un cache memoire :

```ts
protected readonly referenceCache = new Map<string, ReferenceCacheEntry>();
```

TTL :

```ts
const REFERENCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
```

La cle de cache inclut :

- query normalisee ;
- langue ;
- max articles ;
- max images ;
- include images ;
- sources autorisees.

Le cache est volontairement en memoire pour la v1. Il evite les appels repetes pendant une session sans introduire de stockage persistant.

## Vue References EarthCoach

Widget :

```text
EarthCoachReferenceWidget.ID = 'earthcoach.references'
```

Fonctions :

- champ de recherche ;
- langue `fr` / `en` ;
- affichage articles et portails fiables ;
- affichage images pedagogiques ;
- rappel que les references ne remplacent pas les observations terrain ;
- affichage des sources actives ;
- indication si le resultat vient du cache local ;
- bouton **Preferences** ouvrant directement `Preferences GeoApp > EarthCoach`.

## Notes GeoApp

Le tool `earthcoach_save_note` enregistre une synthese dans les notes d'une cache.

Fichier :

```text
earthcoach-note-tools.ts
```

Payload :

```ts
await notesService.createNote(geocacheId, {
    content,
    note_type: 'system',
    source: 'earthcoach',
    source_plugin: 'earthcoach',
});
```

La sauvegarde n'est autorisee par prompt que sur demande explicite utilisateur.

Apres creation, le tool emet :

```ts
widgetEventsService.notifyGeocacheChanged({
    geocacheId,
    reason: 'note-created',
    source: 'chat',
});
```

Dans `zones`, `geocache-notes-view.tsx` affiche les notes `source === 'earthcoach'` avec un badge **EarthCoach**.

## Preferences GeoApp

Le panneau Preferences GeoApp supporte maintenant l'ouverture ciblee :

```ts
commandService.executeCommand('geo-preferences:open', { category: 'earthcoach' });
```

Le widget scrolle sur la section et la met en evidence.

`@Aide` utilise le meme mecanisme avec `aide_open_preferences(category?)`.

## Documentation utilisateur et @Aide

La notice utilisateur est :

```text
frontend/theia-extensions/documentation/docs/ia/earthcoach.md
```

Elle est indexee automatiquement par l'extension documentation et injectee dans le prompt systeme de `@Aide`.

`@Aide` peut donc repondre a :

```text
@Aide comment utiliser EarthCoach ?
@Aide ouvre les preferences EarthCoach
@Aide liste les preferences de la categorie earthcoach
```

## Tests

Tests EarthCoach :

```bash
yarn --cwd frontend/theia-extensions/earthcoach test:earthcoach
```

Ils verifient notamment :

- presence de `earthcoach_search_reference` ;
- presence de `earthcoach_save_note` ;
- prompt systeme `coach` et `resolver` ;
- verbosite compacte des premiers comptes rendus ;
- separation des origines d'images ;
- mapping observations structurees vers contexte EarthCoach ;
- fallback notes existantes vers observations ;
- respect des preferences references ;
- cache local des references ;
- ajout des portails BRGM, InfoTerre, GeoWiki et Planet-Terre ;
- sauvegarde d'une note EarthCoach avec `source: earthcoach`.

Builds utiles :

```bash
yarn --cwd frontend/theia-extensions/earthcoach build
yarn --cwd frontend/theia-extensions/preferences build
yarn --cwd frontend/theia-extensions/documentation build
yarn --cwd frontend/theia-extensions/zones build
```

## Limites actuelles

- Les sources BRGM, InfoTerre, GeoWiki et Planet-Terre sont exposees comme portails fiables, sans extraction automatique de notices precises.
- Le cache references est en memoire, non persistant.

## Evolutions prevues

- Synchronisation optionnelle entre anciennes notes terrain et observations structurees.
- Recherche avancee de notice de carte geologique a partir d'une position, d'un numero de carte ou d'un nom de commune.
- Providers dedies pour extraire et normaliser plus finement les resultats BRGM/InfoTerre/Planet-Terre quand une API stable est disponible.
- Tests plus fins sur l'exposition effective des tools dans les sessions Theia.
