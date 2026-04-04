# Comportement des onglets GeoApp

Ce document décrit l'architecture technique et le comportement détaillé du système d'onglets de GeoApp (détails de géocaches, tableaux par zone, plugins, alphabets, cartes).

Il complète la vue d'ensemble fournie dans `docs/PREFERENCES.md` et sert de référence pour la maintenance et l'extension du système.

---

## 1. Objectifs

- **Centraliser** la logique d'ouverture / réutilisation des onglets dans des services dédiés (un par catégorie).
- Proposer trois **modes de comportement** configurables :
  - `smart-replace`
  - `always-new-tab`
  - `always-replace`
- Limiter le **remplacement** aux onglets de la même catégorie (geocache, zone, plugin, alphabet, carte).
- Gérer l'**épinglage automatique** des onglets en fonction des interactions utilisateur (clic, scroll, temps minimum ouvert).

---

## 2. Préférences et clés

Les préférences d'onglets sont définies dans `shared/preferences/geo-preferences-schema.json`.

### 2.1. Modes par catégorie

Les clés suivantes contrôlent le mode de comportement pour chaque type d'onglet :

- `geoApp.ui.tabs.categories.geocache`  
- `geoApp.ui.tabs.categories.zone`  
- `geoApp.ui.tabs.categories.plugin`  
- `geoApp.ui.tabs.categories.alphabet`  
- `geoApp.ui.tabs.categories.map`  

Chaque clé accepte trois valeurs :

- `smart-replace` : un onglet "preview" peut être remplacé tant qu'il n'est pas épinglé.  
- `always-new-tab` : chaque ouverture crée un nouvel onglet (sauf réactivation d'un contexte identique déjà ouvert).  
- `always-replace` : la catégorie n'utilise qu'un seul onglet, systématiquement remplacé.

### 2.2. Préférences d'interaction (smart-replace)

Le mode `smart-replace` s'appuie sur des préférences communes :

- `geoApp.ui.tabs.smartReplaceTimeout` (integer)  
  Temps en secondes après lequel un onglet est considéré comme ayant reçu une interaction implicite.

- `geoApp.ui.tabs.smartReplace.interaction.clickInContent` (boolean)  
  Un clic dans le contenu de l'onglet épingle l'onglet.

- `geoApp.ui.tabs.smartReplace.interaction.scroll` (boolean)  
  Un scroll dans le contenu de l'onglet épingle l'onglet.

- `geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled` (boolean)  
  Active la promotion automatique d'un onglet en interaction après `smartReplaceTimeout` secondes.

---

## 3. Gestionnaires d'onglets par catégorie

Chaque catégorie d'onglets est gérée par un service dédié, responsable de :

- suivre les onglets ouverts de ce type,
- appliquer le mode configuré (smart-replace / always-new-tab / always-replace),
- écouter les événements d'interaction pour marquer les onglets comme "pinnés".

### 3.1. Détails de géocaches

- **Fichier** : `theia-extensions/zones/src/browser/geocache-tabs-manager.ts`  
- **Service** : `GeocacheTabsManager`  
- **Widget géré** : `GeocacheDetailsWidget`  
- **Préférence** : `geoApp.ui.tabs.categories.geocache`

Structure interne :

```ts
interface GeocacheTabEntry {
    widget: GeocacheDetailsWidget;
    geocacheId?: number;
    isPinned: boolean;
}
```

Méthode principale :

```ts
async openGeocacheDetails(options: OpenGeocacheOptions): Promise<GeocacheDetailsWidget>
```

- `OpenGeocacheOptions` contient `geocacheId`, `name?`, `forceDuplicate?`.
- Sans `forceDuplicate`, un onglet déjà ouvert pour `geocacheId` est simplement réactivé.
- Sinon, le service applique le mode de remplacement avant de créer ou réutiliser un onglet.

### 3.2. Tableaux par zone

- **Fichier** : `theia-extensions/zones/src/browser/zone-tabs-manager.ts`  
- **Service** : `ZoneTabsManager`  
- **Widget géré** : `ZoneGeocachesWidget`  
- **Préférence** : `geoApp.ui.tabs.categories.zone`

Structure interne :

```ts
interface ZoneTabEntry {
    widget: ZoneGeocachesWidget;
    zoneId?: number;
    isPinned: boolean;
}
```

Méthode principale :

```ts
async openZone(options: OpenZoneOptions): Promise<ZoneGeocachesWidget>
```

- `OpenZoneOptions` contient `zoneId`, `zoneName?`, `forceDuplicate?`.
- Sans `forceDuplicate`, un onglet déjà ouvert pour `zoneId` est réactivé.

Le gestionnaire crée les widgets via un constructeur explicite, en leur injectant les services carte et le `GeocacheTabsManager`.

### 3.3. Plugins

- **Fichier** : `theia-extensions/plugins/src/browser/plugin-tabs-manager.ts`  
- **Service** : `PluginTabsManager`  
- **Widget géré** : `PluginExecutorWidget`  
- **Préférence** : `geoApp.ui.tabs.categories.plugin`

Structure interne :

```ts
interface PluginTabEntry {
    widget: PluginExecutorWidget;
    contextKey?: string; // ex: "plugin:Name" ou "geocache:GC12345"
    isPinned: boolean;
}
```

Méthodes principales :

```ts
async openPlugin(options: OpenPluginOptions): Promise<PluginExecutorWidget>
async openForGeocache(options: OpenPluginForGeocacheOptions): Promise<PluginExecutorWidget>
```

- Contexte PLUGIN : `contextKey = "plugin:<pluginName>"`.
- Contexte GEOCACHE : `contextKey = "geocache:<gcCode>"`.
- `forceDuplicate` permet de forcer la création d'un nouvel onglet même si un onglet pour ce contexte existe déjà.

Un `widgetCreator` est configuré dans `plugins-frontend-module.ts` pour instancier `PluginExecutorWidget` via un child container.

### 3.4. Alphabets

- **Fichier** : `theia-extensions/alphabets/src/browser/alphabet-tabs-manager.ts`  
- **Service** : `AlphabetTabsManager`  
- **Widget géré** : `AlphabetViewerWidget`  
- **Préférence** : `geoApp.ui.tabs.categories.alphabet`

Structure interne :

```ts
interface AlphabetTabEntry {
    widget: AlphabetViewerWidget;
    alphabetId?: string;
    isPinned: boolean;
}
```

Méthode principale :

```ts
async openAlphabet(options: OpenAlphabetOptions): Promise<AlphabetViewerWidget>
```

- `OpenAlphabetOptions` contient `alphabetId`, `forceDuplicate?`.
- Sans `forceDuplicate`, un onglet déjà ouvert pour `alphabetId` est simplement réactivé.
- En mode `smart-replace`, tous les alphabets partagent le même pool d'onglets, avec remplacement limité aux alphabets non épinglés.

Comme pour les plugins, un `widgetCreator` est configuré dans `alphabets-frontend-module.ts` pour permettre la création de plusieurs instances d'`AlphabetViewerWidget` via un child container.

---

## 4. Modes de comportement (algorithme commun)

Chaque gestionnaire applique la même logique générale lors de l'ouverture d'un onglet :

1. **Nettoyage** des onglets disposés (`cleanupDisposed`).
2. **Déduplication forte** (si `forceDuplicate` est absent ou `false`) :
   - Si un onglet existe déjà pour le même contexte exact (même `geocacheId`, `zoneId`, `contextKey`, `alphabetId`), il est réactivé et mis à jour.
3. **Choix d'un onglet cible** selon le mode :
   - `always-replace` : réutiliser systématiquement le dernier onglet de cette catégorie.  
   - `smart-replace` : réutiliser le dernier onglet non épinglé (`isPinned === false`) s'il existe.  
   - `always-new-tab` : ne pas réutiliser d'onglet (hors déduplication forte).
4. Si aucun onglet cible n'est trouvé, **création d'un nouveau widget**, ajout à la liste des onglets.
5. Mise à jour du contexte associé (ID de géocache, ID de zone, `contextKey`, `alphabetId`).
6. Réinitialisation de `isPinned` à `false` pour ce nouvel état (l'onglet redevient un "preview").
7. Ajout éventuel du widget à la zone `main` du shell s'il n'est pas attaché, puis activation.

Ce schéma garantit un comportement cohérent entre catégories tout en laissant chaque gestionnaire libre de gérer son propre contexte métier.

---

## 5. Épinglage par interaction

### 5.1. Événements d'interaction

Chaque widget de contenu émet un événement global lorsqu'il détecte une interaction significative :

- **Détails de géocache** (`GeocacheDetailsWidget`)  
  Événement : `geoapp-geocache-tab-interaction`  
  Détail : `{ widgetId, geocacheId?, type: 'click' | 'scroll' | 'min-open-time' }`

- **Tableaux par zone** (`ZoneGeocachesWidget`)  
  Événement : `geoapp-zone-tab-interaction`  
  Détail : `{ widgetId, type }`

- **Plugins** (`PluginExecutorWidget`)  
  Événement : `geoapp-plugin-tab-interaction`  
  Détail : `{ widgetId, type }`

- **Alphabets** (`AlphabetViewerWidget`)  
  Événement : `geoapp-alphabet-tab-interaction`  
  Détail : `{ widgetId, type }`

Chaque gestionnaire s'abonne à l'événement correspondant dans son constructeur et délègue le traitement à une méthode `handleInteractionEvent`.

### 5.2. Décision de pin

Le gestionnaire :

1. Vérifie la présence de `widgetId` et `type` dans `event.detail`.
2. Utilise `shouldPinForInteraction(type)` pour interroger les préférences :
   - `click` → `geoApp.ui.tabs.smartReplace.interaction.clickInContent`  
   - `scroll` → `geoApp.ui.tabs.smartReplace.interaction.scroll`  
   - `min-open-time` → `geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled`
3. Recherche l'entrée d'onglet associée à `widgetId` parmi les onglets non disposés.
4. Marque l'onglet comme épinglé :

```ts
entry.isPinned = true;
```

À partir de ce moment, en mode `smart-replace`, cet onglet ne sera plus choisi comme cible de remplacement et restera ouvert tant que l'utilisateur ne le ferme pas explicitement.

### 5.3. Timers de temps minimum

Chaque widget configure éventuellement un timer pour l'interaction implicite `min-open-time` :

- Créé après le chargement effectif du contenu (géocache, zone, plugin, alphabet).
- Annulé à chaque changement de contexte ou à la destruction du widget.
- Après `geoApp.ui.tabs.smartReplaceTimeout` secondes, émet `type: 'min-open-time'`.

Ce mécanisme permet de considérer un onglet comme important même si l'utilisateur ne clique pas ou ne scrolle pas explicitement (lecture passive).

---

## 6. Points d'extension

### 6.1. Ajouter une nouvelle catégorie d'onglets

Pour introduire un nouveau type d'onglet (ex. "analyse brute", "résultats IA"), la démarche recommandée est :

1. **Préférences**  
   - Ajouter `geoApp.ui.tabs.categories.<category>` dans `geo-preferences-schema.json` avec les trois modes.  
   - Optionnel : réutiliser les préférences d'interaction existantes.

2. **Gestionnaire dédié**  
   - Créer un service `XTabsManager` dans l'extension concernée.  
   - Définir une structure d'entrée `XTabEntry { widget: XWidget; contextKey?: string; isPinned: boolean; }`.  
   - Implémenter `openX(options)` avec la logique commune décrite en section 4.  
   - Écouter un événement d'interaction `geoapp-x-tab-interaction` pour gérer l'épinglage automatique.

3. **Widget cible**  
   - Créer ou adapter `XWidget` pour :
     - Injecter `PreferenceService` si l'on souhaite utiliser `min-open-time`.  
     - Ajouter `onAfterAttach` / `onBeforeDetach` pour brancher/débrancher les listeners (clic, scroll).  
     - Émettre `geoapp-x-tab-interaction` avec `{ widgetId, type }` via `window.dispatchEvent(new CustomEvent(...))`.

4. **Intégration module frontend**  
   - Binder `XTabsManager` en singleton dans le `ContainerModule` de l'extension.  
   - Configurer un `widgetCreator` si le widget doit être instancié via un child container.

5. **Points d'entrée UI**  
   - Adapter les contributions (menus, panels, commandes) pour déléguer systématiquement l'ouverture des onglets à `XTabsManager`.

### 6.2. Bonnes pratiques

- Toujours **limiter le remplacement** au type d'onglet correspondant (ne jamais mélanger geocache / zone / plugin / alphabet).
- Utiliser une **clé de contexte** claire (`geocacheId`, `zoneId`, `plugin:<name>`, `geocache:<GC>`, `alphabetId`) pour la déduplication logique.
- Documenter chaque nouvelle catégorie dans ce fichier et ajouter des scénarios de test manuel.

---

## 7. Scénarios de test manuel

Ces scénarios permettent de valider rapidement que les trois modes et l'épinglage fonctionnent correctement.

### 7.1. Détails de géocache

1. Régler `geoApp.ui.tabs.categories.geocache` sur `smart-replace`.
2. Ouvrir successivement plusieurs géocaches depuis la vue Zones ou la carte.
3. Vérifier :
   - Sans interaction, un seul onglet est réutilisé (les détails changent).
   - Après clic/scroll ou après `smartReplaceTimeout`, l'onglet devient épinglé et les nouvelles géocaches s'ouvrent dans un autre onglet.

### 7.2. Tableaux par zone

1. Régler `geoApp.ui.tabs.categories.zone` sur `smart-replace`.
2. Cliquer sur Zone A → ouvrir le tableau.  
3. Sans interaction, cliquer sur Zone B : vérifier que l'onglet A est remplacé.  
4. Rafraîchir/scroller dans A, attendre éventuellement `smartReplaceTimeout`, puis cliquer sur Zone B : vérifier qu'un **nouvel onglet** s'ouvre pour B.

### 7.3. Plugins

1. Régler `geoApp.ui.tabs.categories.plugin` sur `smart-replace`.
2. Depuis `PluginsBrowserWidget`, ouvrir Plugin 1 : onglet preview.  
3. Scroller dans l'onglet, puis ouvrir Plugin 2 : vérifier que Plugin 1 reste ouvert et qu'un nouvel onglet est créé.
4. Tester également l'ouverture en mode géocache (depuis `GeocacheDetailsWidget`) pour vérifier que le contexte par géocache fonctionne.

### 7.4. Alphabets

1. Régler `geoApp.ui.tabs.categories.alphabet` sur `smart-replace`.
2. Ouvrir un alphabet A (ex. Albhed) depuis la liste : onglet preview.  
3. Sans interaction, ouvrir un alphabet B (ex. Alteran) : vérifier que l'onglet A est remplacé par B.  
4. Scroller/clicker dans B, puis ouvrir un alphabet C : vérifier qu'un second onglet apparaît.

### 7.5. Modes always-new-tab / always-replace

Pour chaque catégorie, tester également :

- `always-new-tab` : chaque action d'ouverture doit créer un nouvel onglet dédié (sauf réactivation sur même contexte exact).  
- `always-replace` : la catégorie ne conserve qu'un seul onglet, continuellement remplacé par la dernière ouverture.

Ces scénarios servent de base pour les tests manuels et pour la rédaction de tests automatisés éventuels.
