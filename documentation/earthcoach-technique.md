# EarthCoach - Documentation technique

## Vue d'ensemble

EarthCoach est une extension Theia separee de `zones` :

```text
frontend/theia-extensions/earthcoach
```

Elle fournit un agent IA `@EarthCoach` specialise dans les EarthCaches. L'objectif est de garder le coeur GeoApp lisible et de pouvoir desactiver EarthCoach en retirant sa dependance de l'application browser.

La v1 repose sur les donnees existantes :

- listing et fiche de geocache venant de `zones` ;
- notes GeoApp existantes, mappees en observations textuelles ;
- images de listing ou images utilisateur deja disponibles ;
- chat Theia/GeoApp existant ;
- aucun schema backend supplementaire.

## Extension et wiring Theia

Fichiers principaux :

| Fichier | Role |
|---|---|
| `earthcoach-frontend-module.ts` | Module InversifyJS, bindings agent, commands, tools, widget references. |
| `earthcoach-agent.ts` | Agent `@EarthCoach`, prompt systeme et injection des tools EarthCoach. |
| `earthcoach-command-contribution.ts` | Commandes, menus, bouton EarthCoach sur les fiches EarthCache, QuickPick d'actions. |
| `earthcoach-context-service.ts` | Collecte le contexte actif : cache, notes, images, derniere fiche ouverte. |
| `earthcoach-prompt-builder.ts` | Construit le prompt utilisateur envoye au chat a l'ouverture d'une action. |
| `earthcoach-prompts.ts` | Prompt systeme des modes `coach` et `resolver`. |
| `earthcoach-types.ts` | Types EarthCoach : modes, actions, images, observations. |
| `earthcoach-field-checklist.ts` | Builder pur du mode terrain compact. |
| `earthcoach-field-checklist-widget.tsx` | Widget Theia de checklist imprimable/mobile. |
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

La methode filtre les tools EarthCoach deja presents dans `toolRequests`, puis ajoute les instances reconstruites par les managers :

```ts
const earthCoachTools = [
    ...this.referenceTools.buildAllTools(),
    ...this.noteTools.buildAllTools(),
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

Le mode est transmis par le bridge chat GeoApp dans les settings de session :

```ts
commonSettings.geoapp.earthcoachMode
```

L'agent le relit dans `readMode()`.

## Actions rapides

Les actions sont definies par :

```ts
export type EarthCoachQuickAction =
  | 'understand'
  | 'prepare_visit'
  | 'field_checklist'
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
  note: string;
  createdAt: string;
  images: GeoImage[];
  sourceNoteId?: number;
}
```

En v1, `UserObservation` est une vue logique construite depuis les notes existantes. Il n'y a pas encore de table backend dediee.

## References externes

Le tool `earthcoach_search_reference` cherche des references pedagogiques externes. Les resultats sont toujours marques `educational_reference`.

Sources v1 :

- Wikipedia ;
- Wikimedia Commons.

Preferences associees :

| Cle | Defaut | Role |
|---|---|---|
| `geoApp.earthCoach.references.web.enabled` | `true` | Active ou desactive la recherche externe. |
| `geoApp.earthCoach.references.language` | `fr` | Langue par defaut : `fr` ou `en`. |
| `geoApp.earthCoach.references.maxArticles` | `3` | Limite articles Wikipedia. |
| `geoApp.earthCoach.references.maxImages` | `5` | Limite images Wikimedia. |
| `geoApp.earthCoach.references.allowedSources` | `wikipedia,wikimedia` | Sources CSV autorisees. |

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
- affichage articles ;
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
- separation des origines d'images ;
- mapping notes existantes vers observations ;
- respect des preferences references ;
- cache local des references ;
- sauvegarde d'une note EarthCoach avec `source: earthcoach`.

Builds utiles :

```bash
yarn --cwd frontend/theia-extensions/earthcoach build
yarn --cwd frontend/theia-extensions/preferences build
yarn --cwd frontend/theia-extensions/documentation build
yarn --cwd frontend/theia-extensions/zones build
```

## Limites v1

- Pas de table backend `UserObservation`.
- Les observations v1 viennent des notes utilisateur et du texte chat.
- Les photos utilisateur structurees par observation sont reportees.
- Les sources externes serieuses comme BRGM, notices de cartes geologiques, universites ou GeoWiki ne sont pas encore implementees.
- Le cache references est en memoire, non persistant.

## Evolutions prevues

- Mode terrain compact imprimable/mobile.
- Galerie visuelle stricte : images pedagogiques vs photos utilisateur.
- Entite backend `UserObservation` avec date, waypoint, coordonnees et photos liees.
- Sources supplementaires : BRGM, cartes geologiques, universites, GeoWiki.
- Tests plus fins sur l'exposition effective des tools dans les sessions Theia.
