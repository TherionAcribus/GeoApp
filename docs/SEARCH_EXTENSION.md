# Extension Recherche In-Page (GeoApp Search)

## Vue d'ensemble

Extension Theia permettant la recherche de texte dans les widgets GeoApp via **Ctrl+F**, similaire à la fonction de recherche native du navigateur. La recherche fonctionne sur tous les widgets GeoApp (détails géocache, exécuteur de plugins, etc.) sans conflit avec le Ctrl+F de l'éditeur Monaco.

## Fonctionnalités

- **Recherche texte simple** : insensible à la casse et aux accents par défaut
- **Recherche par jokers** : `*` = tout, `?` = un caractère
- **Recherche par expression régulière** : syntaxe JavaScript standard
- **Navigation** : parcours des occurrences avec compteur `N/M`
- **Surlignage DOM** : toutes les occurrences surlignées, match actif mis en évidence
- **Persistance** : le terme de recherche est conservé entre ouvertures/fermetures
- **Scroll automatique** : défilement vers le match actif
- **Debounce** : recherche différée (250ms) pour éviter les recalculs sur chaque frappe
- **MutationObserver** : réapplication automatique des highlights après changement DOM (React re-renders)
- **Feedback visuel** : shake + bordure rouge quand aucun résultat trouvé
- **Recherche structurée** : les widgets peuvent fournir du contenu via duck-typing (`getSearchableContent()`)

## Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+F` | Ouvrir la recherche (widgets GeoApp uniquement) |
| `F3` / `Enter` | Occurrence suivante |
| `Shift+F3` / `Shift+Enter` | Occurrence précédente |
| `Escape` | Fermer la recherche |
| `Alt+C` | Basculer sensibilité à la casse |
| `Alt+W` | Basculer mode jokers (wildcards) |
| `Alt+R` | Basculer mode expression régulière |

## Architecture

### Fichiers de l'extension

```
theia-extensions/search/
├── package.json                          # Package npm, dépendances, theiaExtensions
├── tsconfig.json                         # Configuration TypeScript
└── src/
    ├── common/
    │   └── search-protocol.ts            # Interfaces et types partagés
    └── browser/
        ├── search-engine.ts              # Moteur de recherche (texte/wildcard/regex)
        ├── search-highlight.ts           # Surlignage DOM (TreeWalker + <mark>)
        ├── search-overlay.tsx            # Composant React de l'overlay
        ├── search-overlay-renderer.ts    # Pont entre service et rendu React 18
        ├── search-service.ts             # Service central (état, orchestration)
        ├── search-contribution.ts        # Commandes, keybindings, ContextKey
        ├── search-frontend-module.ts     # Module InversifyJS
        └── style/
            └── search-overlay.css        # Styles Theia-themed
```

### Composants principaux

#### `search-protocol.ts` — Interfaces

- **`SearchableContent`** : bloc de texte avec identifiant et élément DOM source
- **`SearchMatch`** : occurrence trouvée (contentId, startOffset, endOffset, texte)
- **`SearchOptions`** : options de recherche (caseSensitive, useRegex, useWildcard)
- **`SearchState`** : état global (query, options, matches, activeMatchIndex, isOpen)
- **`SearchableWidget`** : interface optionnelle pour widgets fournissant du contenu structuré

#### `search-engine.ts` — Moteur de recherche

Trois modes de recherche :

1. **Texte simple** : recherche littérale, normalisation Unicode (accents supprimés)
2. **Jokers** : `*` → `.*`, `?` → `.` (convertis en regex)
3. **Regex** : expression régulière JavaScript directe

Fonctions exportées :
- `searchInContents(contents, query, options)` → `SearchMatch[]`
- `searchInDomNode(node, query, options)` → `SearchMatch[]` (mode fallback DOM)
- `buildSearchRegex(query, options)` → `RegExp | null`

#### `search-highlight.ts` — Surlignage DOM

Utilise un `TreeWalker` pour parcourir les nœuds texte du widget, puis injecte des éléments `<mark>` autour des occurrences trouvées. Le conteneur de l'overlay est automatiquement exclu pour éviter le self-matching.

Classes CSS :
- `mark.geoapp-search-highlight` : toutes les occurrences
- `mark.geoapp-search-highlight.geoapp-search-highlight-active` : match actif

#### `search-service.ts` — Service central

Singleton injectable qui :
- Gère l'état de la recherche (`SearchState`)
- Crée/supprime le conteneur DOM de l'overlay dans le widget ciblé
- Orchestre le moteur de recherche et le surlignage
- Persiste le terme de recherche entre ouvertures
- **Debounce 250ms** sur les changements de query/options
- **MutationObserver** pour re-appliquer les highlights après les changements DOM
- **stopPropagation** sur mousedown/focusin dans l'overlay pour éviter les fermetures intempestives
- Supporte trois modes :
  - **Mode structuré complet** : le widget implémente `getSearchableContent()` + `revealMatch()` + `clearSearchHighlights()`
  - **Mode structuré léger** : le widget n'implémente que `getSearchableContent()` (highlighting DOM automatique)
  - **Mode fallback** : extraction automatique du `textContent` du DOM du widget

#### `search-contribution.ts` — Commandes et keybindings

Enregistre 4 commandes :
- `geoapp.search.find` — Ouvrir la recherche
- `geoapp.search.findNext` — Occurrence suivante
- `geoapp.search.findPrevious` — Occurrence précédente
- `geoapp.search.close` — Fermer la recherche

Le Ctrl+F est conditionné par `!editorFocus && !terminalFocus` pour ne pas interférer avec Monaco. Un `ContextKey` nommé `geoappSearchOpen` contrôle l'activation de la touche Escape.

#### `search-overlay.tsx` — Composant React

Barre flottante positionnée en haut à droite du widget, contenant :
- Champ de saisie avec placeholder
- Boutons toggle : `Aa` (casse), `*?` (jokers), `.*` (regex)
- Compteur d'occurrences `N/M`
- Boutons navigation ▲ ▼
- Bouton fermer ✕

## Widgets supportés

La recherche utilise le **mode fallback DOM** par défaut et fonctionne sur tous les widgets GeoApp listés dans `search-contribution.ts` :

- `plugin-executor-widget` — Exécuteur de plugins
- `geocache.details.widget` — Détails géocache
- `geocache.logs.widget` — Logs géocache
- `geocache.notes.widget` — Notes géocache
- `zone-geocaches-widget` — Table des géocaches
- `formula-solver-widget` — Solveur de formules
- `alphabet-viewer` — Visualiseur d'alphabets
- `plugins-browser-widget` — Navigateur de plugins
- `batch-plugin-executor-widget` — Exécution batch
- Et autres widgets GeoApp

Pour ajouter un nouveau widget, ajouter son ID dans le tableau `GEOAPP_SEARCHABLE_WIDGET_IDS` de `search-contribution.ts`.

## Interface SearchableWidget (duck-typing)

Pour une recherche plus précise, un widget peut implémenter l'interface `SearchableWidget` par **duck-typing** (aucun import nécessaire depuis l'extension search) :

### Mode léger (recommandé)

Seule `getSearchableContent()` est nécessaire. Le highlighting DOM est géré automatiquement par le service :

```typescript
// Aucun import depuis l'extension search !
// Le type guard détecte la méthode par duck-typing.

getSearchableContent(): { id: string; text: string; element?: HTMLElement }[] {
    return [
        { id: 'header', text: this.data.name + ' ' + this.data.code },
        { id: 'description', text: htmlToRawText(this.data.descriptionHtml) },
        { id: 'hints', text: this.data.hints }
    ];
}
```

### Mode complet (optionnel)

Pour contrôler le highlighting soi-même, ajouter `revealMatch()` et `clearSearchHighlights()` :

```typescript
revealMatch(match: { contentId: string; startOffset: number; endOffset: number }): void {
    // Scroll vers le match et le mettre en évidence
}

clearSearchHighlights(): void {
    // Nettoyer les surlignages
}
```

### Widgets avec implémentation structurée

- **`GeocacheDetailsWidget`** : fournit header (nom, code, type, owner), coordonnées, description, hints, waypoints, checkers
- **`PluginExecutorWidget`** : utilise le mode fallback DOM (contenu géré par React FC interne)

Type guards disponibles :
- `isSearchableWidget(widget)` — vérifie `getSearchableContent()`
- `hasCustomHighlighting(widget)` — vérifie les 3 méthodes

## Pré-requis pour les widgets

Pour que Ctrl+F fonctionne sur un widget, celui-ci doit :

1. **Accepter le focus** — implémenter `onActivateRequest` :
   ```typescript
   protected onActivateRequest(msg: any): void {
       super.onActivateRequest(msg);
       this.node.focus();
   }
   ```
2. **Avoir un tabIndex** — dans `init()` ou le constructeur :
   ```typescript
   this.node.tabIndex = 0;
   ```
3. **Être listé** dans `GEOAPP_SEARCHABLE_WIDGET_IDS` de `search-contribution.ts`

## Build

```bash
# Build de l'extension seule
cd theia-extensions/search
yarn run clean
yarn run build

# Build via Lerna (depuis la racine theia-blueprint)
yarn build:extensions

# Build complet de l'application
cd applications/browser
yarn build
```

## Styles et thème

L'overlay utilise les variables CSS Theia pour rester cohérent avec le thème actif :
- `--theia-editorWidget-background` / `--theia-editorWidget-border`
- `--theia-input-background` / `--theia-input-foreground`
- `--theia-focusBorder`
- `--theia-button-background`
- `--theia-errorForeground`

## Historique des versions

### Phase 1 — Core
- Extension setup (package.json, tsconfig.json)
- Moteur de recherche (texte, wildcard, regex)
- Surlignage DOM (TreeWalker + `<mark>`)
- Overlay React + CSS Theia-themed
- Commandes et keybindings (Ctrl+F, F3, Escape)
- ContextKey `geoappSearchOpen`
- Exclusion de l'overlay du DOM search/highlight

### Phase 1.5 — Intégration & UX
- Debounce 250ms sur la recherche
- MutationObserver pour re-appliquer les highlights (sans scroll forcé)
- `SearchableWidget` duck-typing (revealMatch/clearSearchHighlights optionnels)
- `getSearchableContent()` sur `GeocacheDetailsWidget`
- Fix focus `PluginExecutorWidget` (tabIndex + onActivateRequest)
- Fix overlay focus (stopPropagation mousedown/focusin)
- Migration ReactDOM.render → createRoot (React 18)
- CSS amélioré : shake no-results, meilleurs highlights
- Overlay sticky (suit le scroll du widget)
- Séparation highlight/scroll (MutationObserver ne scroll plus)

### Phase 2 — Recherche Globale
- **Panel sidebar** `GlobalSearchWidget` (Ctrl+Shift+F) dans la barre latérale gauche
- **Recherche multi-scope** : onglets ouverts, base de données, ou les deux
- **Backend `/api/search`** : recherche dans géocaches (nom, description, hints, notes personnelles), logs et notes
- **Résultats groupés** : sections pliables par catégorie avec badges de comptage
- **Snippets avec surlignage** : contexte autour des matches avec le terme en surbrillance
- **Clic → navigation** : active l'onglet du widget ou ouvre la géocache
- **Options** : casse, wildcards, regex, scope (Tout / Onglets ouverts / Base de données)
- **Debounce 300ms** sur la saisie

#### Nouveaux fichiers (Phase 2)

| Fichier | Rôle |
|---------|------|
| `search/src/browser/global-search-service.ts` | Service orchestrant la recherche globale |
| `search/src/browser/global-search-widget.tsx` | Widget sidebar React |
| `search/src/browser/global-search-contribution.ts` | Commandes, keybinding Ctrl+Shift+F |
| `search/src/browser/style/global-search.css` | Styles du panel de recherche globale |
| `gc-backend/gc_backend/blueprints/search.py` | Endpoint Flask `/api/search` |

#### Raccourci clavier supplémentaire

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Shift+F` | Ouvrir la recherche globale (sidebar) |

## Évolutions futures (Phase 3+)

- **Remplacement** : fonctionnalité find-and-replace pour les champs éditables
- **Historique** : historique des termes de recherche
- **SearchableWidget** sur plus de widgets (logs, notes, formula-solver)
- **Filtres avancés** : filtre par zone, type de géocache, date
- **Recherche incrémentale** : mise à jour en temps réel quand les onglets changent
