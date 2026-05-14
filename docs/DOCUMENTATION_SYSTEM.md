# Système de Documentation Intégrée GeoApp

Extension Theia `theia-ide-documentation-ext` — widget de documentation Markdown avec recherche plein texte et agent IA `@Aide`.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture](#2-architecture)
3. [Pipeline de build](#3-pipeline-de-build)
4. [Format des pages Markdown](#4-format-des-pages-markdown)
5. [Ajouter du contenu](#5-ajouter-du-contenu)
6. [Services](#6-services)
7. [UI : Widget React](#7-ui--widget-react)
8. [Agent IA @Aide](#8-agent-ia-aide)
9. [Wiring Theia (DI / contributions)](#9-wiring-theia-di--contributions)
10. [Intégration dans l'application browser](#10-intégration-dans-lapplication-browser)
11. [Points d'accès utilisateur](#11-points-daccès-utilisateur)
12. [Extension et personnalisation](#12-extension-et-personnalisation)

---

## 1. Vue d'ensemble

Le système d'aide offre aux utilisateurs de GeoApp une documentation consultable directement depuis l'IDE :

- **Widget de documentation** ouvert dans la zone principale (onglet pleine largeur)
- **Navigation par chapitres/pages** dans une sidebar de navigation
- **Recherche plein texte par section** via FlexSearch
- **Agent IA `@Aide`** accessible depuis le chat Theia, répondant à partir du contenu de la doc
- **Icône 📖** dans la barre d'activité gauche (bas) pour un accès rapide
- **Raccourci clavier** `Shift+F1` et entrée dans le menu **Aide**

### Localisation des fichiers

```
frontend/theia-extensions/documentation/
├── docs/                              ← contenu Markdown (source de vérité)
│   ├── assets/                        ← images référencées dans les .md
│   ├── getting-started/
│   │   ├── index.md
│   │   ├── interface.md
│   │   ├── first-zone.md
│   │   └── first-geocache.md
│   ├── zones/
│   ├── outils/
│   ├── ia/
│   └── depannage/
├── scripts/
│   └── generate-docs-manifest.mjs    ← script de génération du registre TS
├── src/browser/
│   ├── generated/
│   │   └── doc-registry.ts           ← GÉNÉRÉ, ne pas modifier à la main
│   ├── doc-types.ts                  ← interfaces TypeScript
│   ├── doc-content-service.ts        ← service de lecture et parsing
│   ├── doc-search-service.ts         ← moteur de recherche FlexSearch
│   ├── doc-navigation-tree.tsx       ← composant arborescence chapitres
│   ├── doc-viewer.tsx                ← rendu Markdown (react-markdown)
│   ├── doc-widget.tsx                ← ReactWidget principal (ID: geoapp-documentation)
│   ├── doc-agent.ts                  ← ChatAgent @Aide
│   ├── doc-contribution.ts           ← commandes, menus, keybindings, icône sidebar
│   ├── doc-frontend-module.ts        ← module InversifyJS
│   ├── types.d.ts                    ← déclarations de modules
│   └── style/
│       └── doc-widget.css
```

---

## 2. Architecture

### Flux de données

```
docs/*.md  ──[build]──▶  doc-registry.ts (imports webpack)
                                │
                         DocContentService
                        ┌───────┴───────┐
                   getPages()     extractSections()
                        │               │
                   DocWidget      DocSearchService
                   (navigation,    (index FlexSearch)
                    viewer)              │
                                   search(query)
                                         │
                                   DocWidget
                                   (résultats)

                   DocContentService
                         │
                    GeoAppDocAgent
                    (prompt système = ToC + doc complète)
```

### Dépendances npm

| Package | Version | Usage |
|---------|---------|-------|
| `flexsearch` | ^0.7.31 | Index de recherche plein texte par sections |
| `react-markdown` | ^9.0.1 | Rendu Markdown dans React |
| `remark-gfm` | ^4.0.0 | Extension GitHub Flavored Markdown |
| `gray-matter` | ^4.0.3 | Parsing frontmatter YAML (utilisé seulement côté script) |
| `@theia/ai-chat` | 1.70.2 | Base `AbstractStreamParsingChatAgent` pour @Aide |
| `@theia/ai-core` | 1.70.2 | `AgentService`, `AIVariableContext`, etc. |

---

## 3. Pipeline de build

### Commande

```bash
# Depuis frontend/theia-extensions/documentation/
yarn build
# Équivalent à :
node scripts/generate-docs-manifest.mjs && tsc -b && yarn run copy:assets
```

### Étapes

1. **`generate-docs-manifest.mjs`** — parcourt `docs/**/*.md`, parse le frontmatter YAML, génère `src/browser/generated/doc-registry.ts` avec un import webpack `asset/source` par fichier Markdown.
2. **`tsc -b`** — compilation TypeScript de l'extension.
3. **`copy:assets`** — copie `src/browser/style/` → `lib/browser/style/`.

### Intégration lerna

L'extension est incluse dans `frontend/package.json` (workspaces) et dans le script `build:extensions` via le glob `"theia-ide*ext"`. Elle se build automatiquement avec :

```bash
# Depuis frontend/
yarn build:extensions
```

### Fichier généré : `doc-registry.ts`

```typescript
// FICHIER GÉNÉRÉ AUTOMATIQUEMENT - NE PAS MODIFIER MANUELLEMENT
import page_getting_started_index from '../../../docs/getting-started/index.md';
// ...

export const DOC_PAGES: DocPageMeta[] = [
    {
        id: 'getting-started.index',
        chapter: 'getting-started',
        title: 'Bien démarrer avec GeoApp',
        description: '...',
        order: 1,
        tags: ['introduction', 'démarrage'],
        content: page_getting_started_index,  // string (contenu brut du .md)
    },
    // ...
];
```

> **Important** : ce fichier est dans `.gitignore`. Il est régénéré à chaque `yarn build`. Ne jamais le modifier manuellement.

### Webpack — chargement des fichiers `.md`

Dans `applications/browser/webpack.config.js` :

```javascript
{
    test: /\.md$/,
    type: 'asset/source',  // charge le fichier comme string UTF-8
}
```

Et copie des images :

```javascript
new CopyWebpackPlugin({
    patterns: [{
        from: path.resolve(__dirname, '../../theia-extensions/documentation/docs/assets'),
        to: 'docs-assets',
        noErrorOnMissing: true,
    }]
})
```

Les images doivent être placées dans `docs/assets/` et référencées en Markdown avec le chemin `/docs-assets/nom-image.png`.

---

## 4. Format des pages Markdown

### Frontmatter obligatoire

```yaml
---
title: "Titre de la page"
description: "Description courte (affichée dans la navigation et le prompt IA)"
chapter: getting-started
order: 1
tags: [tag1, tag2]
---

# Titre de la page

Contenu Markdown...
```

| Champ | Type | Description |
|-------|------|-------------|
| `title` | string | Titre affiché dans la navigation et les onglets |
| `description` | string | Sous-titre affiché dans la nav, utilisé dans le prompt @Aide |
| `chapter` | string | ID du chapitre (doit correspondre au nom du dossier) |
| `order` | number | Position dans le chapitre (tri ascendant) |
| `tags` | array | Mots-clés pour la recherche |

> Le champ `chapter` dans le frontmatter est indicatif — c'est le **nom du dossier parent** qui fait foi pour le regroupement côté `DocContentService`.

### Identifiant de page

L'ID est calculé automatiquement depuis le chemin relatif :

```
docs/getting-started/interface.md  →  id: "getting-started.interface"
docs/outils/overview.md            →  id: "outils.overview"
docs/ma-page.md                    →  id: "root.ma-page"  (pas de sous-dossier → chapitre "root")
```

### Sections extraites pour la recherche

`DocContentService.extractSections()` découpe chaque page en sections indexables :

- Les titres `## H2` démarrent une nouvelle section
- Les titres `### H3` créent des sous-sections si le H3 suit un H2 isolé
- Le texte avant le premier titre `#` ou `##` crée une section `#intro`

Chaque section reçoit un `anchor` calculé (slug du titre, normalisé NFD, sans accents) utilisé pour le scroll lors de la navigation vers un résultat de recherche.

### Images

```markdown
![Alt text](/docs-assets/nom-image.png)
```

Les images sont copiées par webpack depuis `docs/assets/` vers `<output>/docs-assets/`. Le `DocViewer` réécrit automatiquement les chemins relatifs en chemin absolu `/docs-assets/...`.

---

## 5. Ajouter du contenu

### Ajouter une page dans un chapitre existant

1. Créer le fichier `.md` avec frontmatter valide dans le sous-dossier correspondant :

```bash
# Exemple : nouvelle page dans le chapitre "zones"
touch frontend/theia-extensions/documentation/docs/zones/filtres.md
```

2. Rédiger la page avec le frontmatter :

```yaml
---
title: "Filtres et recherche de zones"
description: "Filtrer les zones par critères, exporter les résultats"
chapter: zones
order: 2
tags: [zones, filtres, recherche]
---

# Filtres et recherche de zones

...
```

3. Rebuilder l'extension :

```bash
cd frontend/theia-extensions/documentation
yarn build
```

La page apparaît automatiquement dans la navigation et dans le prompt de `@Aide`.

### Ajouter un nouveau chapitre

1. Créer un sous-dossier dans `docs/` :

```bash
mkdir frontend/theia-extensions/documentation/docs/mon-chapitre
```

2. Ajouter le label du chapitre dans `src/browser/doc-types.ts` :

```typescript
export const CHAPTER_LABELS: Record<string, string> = {
    'getting-started': 'Bien démarrer',
    'zones': 'Zones',
    'outils': 'Outils de déchiffrement',
    'ia': 'Intelligence artificielle',
    'depannage': 'Dépannage',
    'mon-chapitre': 'Mon Nouveau Chapitre',  // ← ajouter ici
    'root': 'Général',
};
```

3. Pour contrôler l'ordre d'affichage, ajouter l'ID dans le tableau `chapterOrder` de `DocContentService.getChapters()` :

```typescript
const chapterOrder = ['getting-started', 'zones', 'outils', 'ia', 'mon-chapitre', 'depannage', 'root'];
```

4. Créer les pages `.md` dans le dossier, puis `yarn build`.

---

## 6. Services

### `DocContentService`

Service singleton injectable. Point d'entrée principal pour accéder aux données de documentation.

```typescript
@injectable()
class DocContentService {
    async initialize(): Promise<void>        // idempotent, chargement lazy du registre
    getPages(): DocPageMeta[]               // toutes les pages triées (chapitre + order)
    getPage(id: string): DocPageMeta | undefined
    getSections(): DocSection[]             // toutes les sections de toutes les pages
    getSectionsForPage(pageId: string): DocSection[]
    getChapters(): DocChapter[]             // chapitres triés avec leurs pages
    extractSections(page: DocPageMeta): DocSection[]  // utilisé en interne
}
```

**Interfaces clés :**

```typescript
interface DocPageMeta {
    id: string;          // ex: "getting-started.interface"
    chapter: string;     // ex: "getting-started"
    title: string;
    description: string;
    order: number;
    tags: string[];
    content: string;     // contenu Markdown brut (avec frontmatter)
}

interface DocSection {
    id: string;          // ex: "getting-started.interface#navigation"
    pageId: string;      // ex: "getting-started.interface"
    anchor: string;      // ex: "navigation" (slug normalisé)
    level: number;       // 1, 2, ou 3
    title: string;
    text: string;        // contenu Markdown de la section
}

interface DocChapter {
    id: string;
    title: string;       // label traduit (depuis CHAPTER_LABELS)
    pages: DocPageMeta[];
}
```

### `DocSearchService`

Service singleton injectable. Index FlexSearch sur les sections.

```typescript
@injectable()
class DocSearchService {
    async initialize(): Promise<void>     // initialise l'index après DocContentService
    search(query: string, limit?: number): DocSearchResult[]
}

interface DocSearchResult {
    pageId: string;
    sectionAnchor: string;
    pageTitle: string;
    sectionTitle: string;
    excerpt: string;     // extrait de 160 chars autour du premier match
    score: number;
}
```

**Configuration de l'index FlexSearch :**

```typescript
new Document({
    document: {
        id: 'id',
        index: [
            { field: 'title', tokenize: 'forward', resolution: 9 },  // priorité max
            { field: 'text',  tokenize: 'forward', resolution: 5 },
            { field: 'tags',  tokenize: 'full',    resolution: 3 },
        ],
        store: true,
    },
    encode: (str) => str.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').split(/\W+/).filter(Boolean),
})
```

L'encodeur personnalisé assure la recherche insensible aux accents (`zone` → `zone`, `Zones` → `zone`).

---

## 7. UI : Widget React

### `DocWidget`

Extends `ReactWidget` de Theia. Gère l'état de l'UI en propriétés de classe et se re-rend via `this.update()`.

```typescript
// Identifiants Theia
DocWidget.ID    = 'geoapp-documentation'
DocWidget.LABEL = 'Documentation GeoApp'
```

**État interne :**

```typescript
private widgetState = {
    currentPageId: string | null,
    searchQuery: string,
    searchResults: DocSearchResult[],
    isSearching: boolean,
    expandedChapters: Set<string>,
    currentAnchor: string | null,
};
```

**Architecture des composants :**

```
DocWidget (ReactWidget)
├── Toolbar (barre de recherche + bouton @Aide)
├── DocNavigationTree (sidebar gauche)
│   └── Chapitres > Pages (collapsibles)
└── DocViewer (zone principale droite)
    └── ReactMarkdown + remark-gfm
        └── Résolution des images /docs-assets/
```

**Icône du widget :**

```typescript
this.title.iconClass = 'codicon codicon-book';
```

### `DocNavigationTree`

Composant React pur. Props :

```typescript
interface DocNavigationTreeProps {
    chapters: DocChapter[];
    currentPageId: string | null;
    expandedChapters: Set<string>;
    onPageSelect: (pageId: string) => void;
    onChapterToggle: (chapterId: string) => void;
}
```

### `DocViewer`

Composant React pur. Charge `react-markdown` et `remark-gfm` dynamiquement (`await import()`).

```typescript
interface DocViewerProps {
    page: DocPageMeta | null;
    anchor: string | null;       // scroll automatique vers cet ancre après rendu
}
```

---

## 8. Agent IA @Aide

### Classe

```typescript
// doc-agent.ts
@injectable()
class GeoAppDocAgent extends AbstractStreamParsingChatAgent {
    readonly id = 'geoapp-doc-aide';
    readonly name = '@Aide';

    @inject(DocContentService)
    protected readonly contentService: DocContentService;

    protected override async getSystemMessageDescription(
        _context: AIVariableContext
    ): Promise<SystemMessageDescription | undefined>
}
```

### Prompt système

Construit dynamiquement à chaque nouvelle conversation :

1. Instruction de rôle (`@Aide`, documentation GeoApp, répondre uniquement depuis la doc)
2. Table des matières (chapitres + titres + descriptions des pages)
3. Contenu complet de toutes les pages (Markdown, frontmatter strippé)

> Le prompt est reconstruit à chaque appel de `getSystemMessageDescription()` — cela garantit la fraîcheur du contenu après un rebuild. En pratique l'agent est singleton donc l'initialisation n'est faite qu'une fois.

### Enregistrement Theia

```typescript
// doc-frontend-module.ts
bind(GeoAppDocAgent).toSelf().inSingletonScope();
bind(ChatAgent).toService(GeoAppDocAgent);          // ← rend l'agent disponible dans le chat
bind(GeoAppDocAgentContribution).toSelf().inSingletonScope();
bind(FrontendApplicationContribution).toService(GeoAppDocAgentContribution);
// GeoAppDocAgentContribution.onStart() appelle agentService.registerAgent(docAgent)
// → l'agent est configurable dans les settings Theia (sélection du modèle)
```

### Utilisation dans le chat

Dans le panneau AI Chat de Theia :

```
@Aide comment créer une nouvelle zone ?
@Aide quels plugins sont disponibles ?
```

---

## 9. Wiring Theia (DI / contributions)

### `doc-frontend-module.ts`

Module InversifyJS chargé automatiquement par Theia via `theiaExtensions[].frontend` dans `package.json`.

```typescript
export default new ContainerModule(bind => {
    // Services
    bind(DocContentService).toSelf().inSingletonScope();
    bind(DocSearchService).toSelf().inSingletonScope();

    // Widget
    bind(DocWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DocWidget.ID,
        createWidget: () => ctx.container.get(DocWidget),
    })).inSingletonScope();

    // Contributions (commandes, menus, keybindings, icône sidebar)
    bind(DocContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(DocContribution);
    bind(MenuContribution).toService(DocContribution);
    bind(KeybindingContribution).toService(DocContribution);
    bind(FrontendApplicationContribution).toService(DocContribution);

    // Agent IA
    bind(GeoAppDocAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppDocAgent);
    bind(GeoAppDocAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppDocAgentContribution);
});
```

### `doc-contribution.ts` — points d'entrée

| Contribution | Détail |
|---|---|
| `CommandContribution` | Commande `geoapp.documentation.open` |
| `MenuContribution` | Entrée **Aide > Documentation GeoApp** + menu sidebar `GEOAPP_DOC_SIDEBAR_MENU` |
| `KeybindingContribution` | `Shift+F1` → ouvre le widget |
| `FrontendApplicationContribution` | `onStart()` → ajoute l'icône 📖 dans `SidebarBottomMenuWidget` |

---

## 10. Intégration dans l'application browser

### `frontend/package.json` (lerna workspaces)

```json
"workspaces": [
    "...extensions existantes...",
    "theia-extensions/documentation"
]
```

### `applications/browser/package.json` (dépendances)

```json
"dependencies": {
    "theia-ide-documentation-ext": "1.70.200"
}
```

### `applications/browser/webpack.config.js`

```javascript
// Règle pour charger les .md comme strings
{
    test: /\.md$/,
    type: 'asset/source',
}

// Copie des images de documentation
new CopyWebpackPlugin({
    patterns: [{
        from: path.resolve(__dirname, '../../theia-extensions/documentation/docs/assets'),
        to: 'docs-assets',
        noErrorOnMissing: true,
    }]
})
```

---

## 11. Points d'accès utilisateur

| Méthode | Action |
|---|---|
| Icône 📖 en bas de la barre d'activité gauche | Menu → **Ouvrir la documentation** |
| `Shift+F1` | Ouvre directement le widget |
| Menu **Aide** de la barre de menus | **Documentation GeoApp** |
| Palette de commandes `Ctrl+Shift+P` | Taper `Documentation GeoApp` |
| Chat IA | `@Aide <question>` |

---

## 12. Extension et personnalisation

### Modifier le modèle IA utilisé par @Aide

Dans les préférences GeoApp, l'agent `geoapp-doc-aide` est configurable comme tout agent Theia (sélection du provider et du modèle).

Par défaut : `{ purpose: 'chat', identifier: 'default/universal' }`.

### Enrichir le prompt de @Aide

Modifier `GeoAppDocAgent.getSystemMessageDescription()` dans `doc-agent.ts`. Par exemple, ajouter un résumé de la version de GeoApp ou des instructions spécifiques au contexte courant de l'utilisateur.

### Ajouter des outils (tool calls) à @Aide

`AbstractStreamParsingChatAgent` supporte les tool calls. Pour ajouter un outil `search_docs` :

1. Implémenter une `ToolRequest` dans `doc-agent.ts`
2. La référencer dans `this.functions`
3. Le LLM peut alors appeler l'outil et recevoir les résultats structurés

### Ajouter un bouton dans le toolbar du widget

Dans `doc-widget.tsx`, modifier la méthode `renderToolbar()` :

```tsx
private renderToolbar(): React.ReactNode {
    return (
        <div className="doc-toolbar">
            <input ... />
            <button onClick={...}>Mon action</button>
            <button onClick={this.handleAskAide}>@Aide</button>
        </div>
    );
}
```

### Personnaliser les styles

`src/browser/style/doc-widget.css` utilise les variables CSS Theia (`--theia-ui-font-size1`, `--theia-editor-background`, etc.) pour s'intégrer au thème actif. Modifier ce fichier pour ajuster l'apparence.

---

## Référence rapide — checklist ajout de page

```
[ ] Créer docs/<chapitre>/ma-page.md avec frontmatter complet
[ ] Vérifier title, description, order, tags
[ ] Si nouvelles images : les placer dans docs/assets/
[ ] cd frontend/theia-extensions/documentation && yarn build
[ ] Vérifier dans l'app : nav tree + search + @Aide
```
