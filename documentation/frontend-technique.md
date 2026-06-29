# Frontend GeoApp - documentation technique

> Vue transverse du frontend Theia GeoApp.
> Derniere mise a jour : juin 2026.

Ce document decrit l'organisation frontend : monorepo Yarn/Theia, application
browser, extensions GeoApp, services HTTP, widgets, contributions, preferences,
IA et commandes de build.

Les sujets deja detailles ailleurs :

- `documentation/documentation_systeme.md` pour l'extension Documentation.
- `documentation/chat-ia-geoapp-technique.md` pour le chat IA.
- `documentation/preferences-technique.md` pour les preferences.
- `documentation/plugins-technique.md` pour l'UI plugins et le moteur associe.
- `documentation/formula-solver-technique.md` pour le solveur de formules.
- `documentation/earthcoach-technique.md` pour EarthCoach.
- `documentation/alphabets-technique.md` pour les alphabets.
- `documentation/notes-technique.md` pour les notes d'une geocache.
- `documentation/geocache-details-technique.md` pour la page de details d'une geocache.

## 1. Vue d'ensemble

Le frontend est une application Eclipse Theia 1.70.x personnalisee.

Il est organise en workspace Yarn 1 :

```text
frontend/
|-- package.json
|-- applications/browser/
|-- theia-extensions/
|   |-- zones/
|   |-- plugins/
|   |-- formula-solver/
|   |-- preferences/
|   |-- alphabets/
|   |-- search/
|   |-- documentation/
|   |-- calculator/
|   |-- earthcoach/
|   |-- product/
|   |-- launcher/
|   `-- updater/
`-- yarn.lock
```

L'application browser charge les extensions GeoApp comme dependances Theia.
Le backend Flask est appele via HTTP, par defaut sur :

```text
http://localhost:8000
```

La preference `geoApp.backend.apiBaseUrl` permet de changer cette URL.

## 2. Application Theia browser

Fichiers principaux :

```text
frontend/applications/browser/package.json
frontend/applications/browser/webpack.config.js
frontend/applications/browser/resources/preload.html
```

`package.json` declare :

- les packages Theia ;
- les extensions GeoApp ;
- les scripts `build`, `build:prod`, `watch`, `dev`, `start`.

`webpack.config.js` ajoute des adaptations importantes :

- copie du favicon ;
- alias/stub pour `drivelist` cote browser ;
- ignore de certains modules natifs Windows CA ;
- import des fichiers Markdown en `asset/source` ;
- copie des assets de documentation vers `docs-assets`.

## 3. Workspaces GeoApp

| Workspace | Package | Role |
|---|---|---|
| `theia-extensions/zones` | `theia-ide-zones-ext` | Zones, geocaches, carte, details, logs, notes, images, IA GeoApp. |
| `theia-extensions/plugins` | `@mysterai/theia-plugins` | Catalogue plugins, executeur, batch, metasolver, atelier de grilles. |
| `theia-extensions/formula-solver` | `@mysterai/theia-formula-solver` | Detection et resolution de formules Mystery. |
| `theia-extensions/preferences` | `@mysterai/theia-preferences` | Page preferences GeoApp et synchronisation backend. |
| `theia-extensions/alphabets` | `@mysterai/theia-alphabets` | Catalogue et viewers d'alphabets symboliques. |
| `theia-extensions/search` | `theia-ide-search-ext` | Recherche globale GeoApp. |
| `theia-extensions/documentation` | `theia-ide-documentation-ext` | Documentation utilisateur integree et agent `@Aide`. |
| `theia-extensions/calculator` | `@mysterai/theia-calculator` | Calculateur et tools associes. |
| `theia-extensions/earthcoach` | `theia-ide-earthcoach-ext` | Outils EarthCache/EarthCoach. |
| `theia-extensions/product` | `theia-ide-product-ext` | Branding, page d'accueil, icones. |
| `theia-extensions/launcher` | `theia-ide-launcher-ext` | Creation de lanceurs. |
| `theia-extensions/updater` | `theia-ide-updater-ext` | Mise a jour application. |

## 4. Pattern d'une extension Theia GeoApp

Une extension suit presque toujours cette structure :

```text
theia-extensions/mon-extension/
|-- package.json
|-- tsconfig.json
`-- src/
    |-- common/
    |   `-- protocol.ts
    `-- browser/
        |-- mon-extension-frontend-module.ts
        |-- mon-extension-contribution.ts
        |-- mon-widget.tsx
        |-- services/
        |   `-- mon-service.ts
        `-- style/
            `-- mon-style.css
```

Roles habituels :

- `*-frontend-module.ts` : binding Inversify des services, widgets,
  contributions, factories et agents.
- `*-contribution.ts` : commandes, menus, keybindings, toolbar, lifecycle.
- `*.tsx` : widgets React, souvent derives de `ReactWidget`.
- `services/*.ts` : clients HTTP ou logique metier frontend.
- `common/*.ts` : types partages dans l'extension.
- `style/*.css` : styles charges par import dans le module ou le widget.

## 5. Injection de dependances

Theia utilise Inversify.

Exemple courant :

```ts
export default new ContainerModule(bind => {
    bind(MyService).toSelf().inSingletonScope();
    bind(MyWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MyWidget.ID,
        createWidget: () => ctx.container.get(MyWidget)
    })).inSingletonScope();
});
```

Les widgets qui doivent exister en plusieurs instances ne sont pas bindes en
singleton. Les gestionnaires d'onglets creent souvent un child container pour
obtenir une instance independante.

## 6. Widgets et onglets

GeoApp s'appuie sur deux modeles :

- widgets singleton : panneau de navigation, catalogue, manager ;
- widgets multi-instances : details de geocache, tableaux de zone, executeur de
  plugin, editeur d'image, cartes.

Les managers centralisent la creation et la reutilisation d'onglets :

| Manager | Role |
|---|---|
| `ZoneTabsManager` | Ouvre une table de geocaches par zone. |
| `GeocacheTabsManager` | Ouvre/reprend les details d'une geocache. |
| `PluginTabsManager` | Ouvre plusieurs executeurs de plugins. |
| `GeocacheImageEditorTabsManager` | Ouvre les editeurs d'image. |
| `GeocacheLogEditorTabsManager` | Ouvre les editeurs de log. |
| `AlphabetTabsManager` | Ouvre les viewers d'alphabets. |

Quand un widget doit etre restaurable, il implemente `StatefulWidget`.

## 7. Extension Zones

Racine :

```text
frontend/theia-extensions/zones/src/browser/
```

Responsabilites :

- arbre des zones ;
- table des geocaches d'une zone ;
- details d'une geocache ;
- carte et gestion de plusieurs cartes ;
- images et editeur ;
- logs, notes, observations et taches de logging ;
- archive des caches resolues ;
- authentification Geocaching ;
- agents IA GeoApp ;
- tools IA lies aux zones, checkers et coordonnees.

Fichiers clefs :

| Fichier | Role |
|---|---|
| `zones-frontend-module.ts` | Enregistre tous les services, widgets, agents et contributions. |
| `zones-service.ts` | Client API zones. |
| `geocaches-service.ts` | Client API geocaches. |
| `backend-api-client.ts` | Base client HTTP partagee par l'extension. |
| `zones-tree-widget.tsx` | Arbre de navigation des zones. |
| `zone-geocaches-widget.tsx` | Widget table d'une zone. |
| `geocache-details-widget.tsx` | Details d'une cache. |
| `map/map-widget.tsx` | Carte. |
| `geoapp-chat-*.ts` | Agents, policy et configuration IA. |

## 8. Extension Plugins

Racine :

```text
frontend/theia-extensions/plugins/src/
```

Responsabilites :

- catalogue des plugins ;
- executeur generique ;
- batch execution ;
- metasolver ;
- scoring ;
- atelier de grilles ;
- tools IA pour lancer des plugins.

Fichiers clefs :

| Fichier | Role |
|---|---|
| `common/plugin-protocol.ts` | Types du contrat frontend plugins. |
| `browser/services/plugins-service.ts` | Client HTTP `/api/plugins` et puzzle states. |
| `browser/services/tasks-service.ts` | Client HTTP `/api/tasks`. |
| `browser/plugins-browser-widget.tsx` | Catalogue. |
| `browser/plugin-executor-widget.tsx` | Execution d'un plugin. |
| `browser/batch-plugin-executor-widget.tsx` | Execution par lot. |
| `browser/metasolver-*.tsx` | Panneaux metasolver. |
| `browser/grid-puzzle-workbench-widget.tsx` | Atelier interactif de grilles. |

L'atelier de grilles appelle le plugin backend `grid_puzzle_solver`, puis
sauvegarde son etat via `/api/geocaches/<id>/puzzle-states`.

## 9. Services HTTP et URL backend

Les services HTTP utilisent principalement `axios`, parfois `fetch` pour le
streaming ou les flux speciaux.

La base URL est lue depuis :

```text
geoApp.backend.apiBaseUrl
```

Pattern recommande :

```ts
const initialUrl = String(
    this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')
);
```

Les services qui doivent reagir a un changement de preference ecoutent
`preferenceService.onPreferenceChanged`.

Regles pratiques :

- centraliser les appels d'une API dans un service TypeScript ;
- eviter les `fetch` disperses sauf pour SSE, streaming ou usage tres local ;
- typer les reponses dans `common/*` quand elles traversent plusieurs widgets ;
- convertir les erreurs Axios en messages lisibles pour l'utilisateur.

## 10. Preferences frontend/backend

Le schema officiel est :

```text
shared/preferences/geo-preferences-schema.json
```

L'extension preferences :

- importe ce schema ;
- l'enregistre dans Theia ;
- fournit `GeoPreferenceStore` ;
- affiche `GeoPreferencesWidget` ;
- synchronise les preferences backend via `PreferenceSyncService`.

Voir :

- `documentation/preferences-technique.md`
- `documentation/preferences-ajout-rapide.md`

## 11. IA et agents

GeoApp etend le chat Theia avec plusieurs agents :

- `GeoApp`
- `geoapp-chat-local`
- `geoapp-chat-fast`
- `geoapp-chat-strong`
- `geoapp-chat-web`

Des agents internes specialisent certaines taches :

- OCR ;
- traduction de description ;
- analyse de logs ;
- redaction de logs ;
- AI scorer.

Les tools sont controles par :

- `geoapp-chat-tool-catalog.ts`
- `geoapp-chat-policy-service.ts`
- `geoapp-chat-system-prompts.ts`
- `geoapp-chat-skills.ts`

L'agent documentaire `@Aide` vit dans l'extension `documentation`.

Voir `documentation/chat-ia-geoapp-technique.md`.

## 12. Documentation integree

L'extension `documentation` embarque des pages Markdown utilisateur dans
l'application.

Flux :

```text
docs/*.md -> generate-docs-manifest.mjs -> doc-registry.ts -> DocWidget
```

Le fichier `doc-registry.ts` est genere et ne doit pas etre modifie a la main.

Voir `documentation/documentation_systeme.md`.

## 13. Build et watch

Commandes principales depuis `frontend/` :

```powershell
yarn install
yarn build:extensions
yarn build:applications
yarn build
```

Build d'une extension :

```powershell
yarn workspace @mysterai/theia-plugins build
yarn workspace theia-ide-zones-ext build
yarn workspace theia-ide-documentation-ext build
```

Watch global :

```powershell
yarn watch
```

Application browser :

```powershell
yarn browser start
```

ou depuis `frontend/applications/browser` :

```powershell
yarn start
```

## 14. Tests frontend

Les tests sont places au plus pres des extensions, par exemple :

```text
frontend/theia-extensions/zones/src/browser/tests/
frontend/theia-extensions/earthcoach/src/browser/tests/
```

Commande globale :

```powershell
cd frontend
yarn test
```

Selon l'extension, il est souvent plus rapide de lancer au minimum :

```powershell
yarn workspace theia-ide-zones-ext build
yarn workspace @mysterai/theia-plugins build
```

## 15. Ajouter une fonctionnalite frontend

Checklist recommandee :

1. Choisir l'extension proprietaire de la fonctionnalite.
2. Ajouter les types dans `common/` si plusieurs fichiers ou le backend les
   consomment.
3. Ajouter ou etendre un service HTTP au lieu d'appeler l'API directement depuis
   plusieurs composants.
4. Ajouter le widget ou composant React.
5. Enregistrer le service/widget/contribution dans `*-frontend-module.ts`.
6. Ajouter commandes, menus ou toolbar dans une contribution.
7. Charger le CSS depuis le module ou le widget.
8. Brancher les preferences dans le schema partage si le comportement doit etre
   configurable.
9. Mettre a jour la doc technique specialisee si la feature devient durable.
10. Lancer le build de l'extension concernee.

## 16. Contrat avec le backend

Le frontend attend des APIs backend :

- JSON stable ;
- erreurs lisibles ;
- codes HTTP explicites ;
- compatibilite avec `geoApp.backend.apiBaseUrl` ;
- CORS actif ;
- support des requetes avec credentials quand necessaire.

Lorsqu'une route change :

1. mettre a jour le blueprint backend ;
2. mettre a jour le service TypeScript ;
3. mettre a jour les types partages ;
4. ajouter/ajuster les tests ;
5. verifier le widget consommateur.

## 17. Pieges courants

- Les attributs JSX entoures par `'...'` cassent si le texte contient une
  apostrophe. Utiliser des guillemets doubles dans ce cas.
- Les widgets multi-instances ne doivent pas etre bindes en singleton.
- Les fichiers generes, comme `doc-registry.ts`, ne doivent pas etre modifies
  manuellement.
- Les appels HTTP disperses rendent les changements d'API couteux ; preferer
  un service par domaine.
- Les changements de `geoApp.backend.apiBaseUrl` doivent etre pris en compte par
  les services longue duree.
- Les CSS d'extension sont copies dans `lib/browser/style` pendant le build ;
  verifier que le script `copy:assets` existe quand un style est ajoute.

