# Restauration d’état des onglets Theia

## Objectif

Ce document décrit comment GeoApp gère **la persistance d’état des onglets** dans Theia :

- **Quels widgets** sont restaurés après redémarrage.
- **Quelles données** sont sauvegardées pour chaque onglet.
- **Comment** les onglets sont recréés via le `WidgetManager`.
- **Comment étendre** ce mécanisme à de futurs widgets.
- **Contraintes critiques** pour que la restauration fonctionne.

L’objectif est que, lorsqu’un utilisateur relance l’application, les onglets importants
(requêtes plugins, détails de géocaches, listes de géocaches par zone, alphabets)
soient **réouverts automatiquement** avec un contenu cohérent.

---

## Rappels sur le mécanisme Theia

Theia fournit plusieurs briques pour la sauvegarde/restauration de layout :

- **`ApplicationShell`**
  - Orchestration globale du layout (panneaux, onglets, widget actif…)
  - Expose `onDidAddWidget` / `onDidRemoveWidget` pour réagir aux changements d'onglets.

- **`ShellLayoutRestorer`**
  - Sérialise / désérialise la structure du layout dans le `localStorage` du navigateur
    (clé : `theia:/:_global_:layout`).
  - **Par défaut**, `storeLayout()` n'est appelé qu'à l'événement `unload` (fermeture de
    la fenêtre). Si le serveur est arrêté sans fermer le navigateur, le layout n'est
    **pas mis à jour** → les anciens onglets réapparaissent au redémarrage.
  - S'appuie sur le **`WidgetManager`** pour recréer les widgets à partir de leurs
    `constructionOptions`.

- **`WidgetManager` + `WidgetFactory`**
  - Chaque type de widget est enregistré via un `WidgetFactory` :
    - `id` (identifiant de factory : ex. `zone.geocaches.widget` ou `plugin-executor-widget`).
    - `createWidget(options)` (création concrète du widget).
  - `widgetManager.getOrCreateWidget(factoryId, options)`
    - Crée ou récupère une instance pour une paire `(factoryId, options)`.
    - Permet à `ShellLayoutRestorer` de rejouer exactement la même création.
  - **CRITIQUE** : pour les widgets multi-instances, `createWidget(options)` **doit**
    appliquer `options.instanceId` sur `widget.id` pour que l'ID du widget recréé
    corresponde exactement à celui sauvegardé dans le layout (voir section « Bug corrigé »).

- **`StatefulWidget`**
  - Interface optionnelle qu’un widget peut implémenter pour gérer son **état interne**.
  - Deux méthodes :
    - `storeState(): object | undefined`
      - Renvoie un objet **sérialisable JSON** (ou `undefined` si rien à stocker).
      - Appelé lors de la sauvegarde du layout.
    - `restoreState(oldState: object): void`
      - Reçoit l’objet précédemment sérialisé.
      - Recharge le widget (appel d’une méthode `setXXX(...)` ou `initializeXXX(...)`).

**Important :**
- Le layout (position des onglets) est restauré même si le widget n’est pas `StatefulWidget`.
- Pour que **le contenu** soit recréé correctement, le widget doit :
  1. Être créé via le **`WidgetManager`**.
  2. Implémenter `StatefulWidget` et y stocker **un minimum d’ID** (ex : `geocacheId`, `zoneId`).
  3. La **`WidgetFactory`** doit appliquer `options.instanceId` sur `widget.id` pour que
     le layout restauré puisse retrouver le bon widget (voir section « Bug corrigé »).

---

## Widgets pris en charge dans GeoApp

Les widgets suivants participent aujourd’hui au mécanisme de restauration :

- **PluginExecutorWidget** (execution de plugins)
- **GeocacheDetailsWidget** (détails d’une géocache)
- **ZoneGeocachesWidget** (table des géocaches d’une zone)
- **AlphabetViewerWidget** (visualisation / décodage d’un alphabet)

Pour chacun :

- Un **`WidgetFactory`** est enregistré dans le module frontend correspondant.
  - La factory applique `options.instanceId` sur `widget.id` lors de la création.
- Le widget implémente `StatefulWidget` et sauvegarde seulement le **contexte minimal**.
- Un **TabsManager** dédié (quand il existe) utilise le `WidgetManager` pour créer les widgets.
  - Le TabsManager synchronise son compteur `nextId` avec les widgets déjà restaurés.

---

## PluginExecutorWidget

**Fichier principal** :
- `theia-extensions/plugins/src/browser/plugin-executor-widget.tsx`

**Factory** :
- Déclarée dans `plugins-frontend-module.ts`
- `id` : `PluginExecutorWidget.ID` (= `plugin-executor-widget`)
- Applique `options.instanceId` sur `widget.id` lors de la création.

**Tabs manager** :
- `PluginTabsManager` (`plugin-tabs-manager.ts`)
- Crée les widgets via :
  - `widgetManager.getOrCreateWidget(PluginExecutorWidget.ID, { instanceId })`
- Synchronise `nextId` via `syncNextId()` au premier appel.

**État sérialisé** (`SerializedPluginExecutorState`) :

- En mode **plugin** :
  - `mode: 'plugin'`
  - `pluginName: string`

- En mode **geocache** :
  - `mode: 'geocache'`
  - `gcCode: string` (code de la géocache)
  - `pluginName?: string` (plugin pré-sélectionné)
  - `autoExecute: boolean` (indique si l'exécution auto doit être relancée)

**storeState()** :
- Ne renvoie un objet **que si `this.config` est défini**.
- Sauvegarde uniquement les informations nécessaires pour relancer `initializePluginMode`
  ou `initializeGeocacheMode`.

**restoreState()** :
- En fonction de `state.mode` :
  - `plugin` → appelle `initializePluginMode(pluginName)`.
  - `geocache` → reconstruit un `GeocacheContext` minimal à partir de `gcCode`
    et appelle `initializeGeocacheMode(context, pluginName, false)`.

Résultat :
- Au redémarrage, chaque onglet `PluginExecutorWidget` est recréé avec le même plugin
  (et éventuellement la même géocache) que lors de la dernière session.

---

## GeocacheDetailsWidget

**Fichier principal** :
- `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

**Factory** :
- Déclarée dans `zones-frontend-module.ts`
- `id` : `GeocacheDetailsWidget.ID` (= `geocache.details.widget`)
- Applique `options.instanceId` sur `widget.id` lors de la création.

**Tabs manager** :
- `GeocacheTabsManager` (`geocache-tabs-manager.ts`)
- Crée les widgets via :
  - `widgetManager.getOrCreateWidget(GeocacheDetailsWidget.ID, { instanceId })`
- Synchronise `nextId` via `syncNextId()` au premier appel.

**État sérialisé** (`SerializedGeocacheDetailsState`) :

- `geocacheId: number`

**storeState()** :
- Ne renvoie un objet que si `this.geocacheId` est défini.
- Renvoie `{ geocacheId }`.

**restoreState()** :
- Si `state.geocacheId` est un `number`, appelle :
  - `setGeocache({ geocacheId })`
  - qui se charge de **recharger toutes les données** de la géocache (description,
    coordonnées, waypoints, notes, etc.) depuis le backend.

Résultat :
- Après redémarrage, chaque onglet de détails rouvre sur la **même géocache** que précédemment.

---

## ZoneGeocachesWidget

**Fichier principal** :
- `theia-extensions/zones/src/browser/zone-geocaches-widget.tsx`

**Factory** :
- Déclarée dans `zones-frontend-module.ts`
- `id` : `ZoneGeocachesWidget.ID` (= `zone.geocaches.widget`)
- Applique `options.instanceId` sur `widget.id` lors de la création.

**Tabs manager** :
- `ZoneTabsManager` (`zone-tabs-manager.ts`)
- Crée les widgets via :
  - `widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID, { instanceId })`
- Synchronise `nextId` via `syncNextId()` au premier appel.

**État sérialisé** (`SerializedZoneGeocachesState`) :

- `zoneId: number`
- `zoneName?: string`

**storeState()** :
- Ne renvoie un objet que si `this.zoneId` est défini.
- Renvoie `{ zoneId, zoneName }`.

**restoreState()** :
- Si `state.zoneId` est un `number`, appelle :
  - `setZone({ zoneId, zoneName })`
  - qui met à jour le titre et relance `load()` pour recharger la table.

Résultat :
- Après redémarrage, les onglets de zones sont recréés et **la liste des géocaches
  est automatiquement rechargée** pour chaque zone.

---

## AlphabetViewerWidget

**Fichier principal** :
- `theia-extensions/alphabets/src/browser/alphabet-viewer-widget.tsx`

**Factory** :
- Déclarée dans `alphabets-frontend-module.ts`
- `id` : `AlphabetViewerWidget.ID_PREFIX` (= `alphabet-viewer`)
- La factory utilise un container enfant pour injecter l'`alphabetId`.
- Applique `options.instanceId` sur `widget.id` : `alphabet-viewer-<alphabetId>#<instanceId>`.

**Tabs manager** :
- `AlphabetTabsManager` (`alphabet-tabs-manager.ts`)
- Crée les widgets via :
  - `widgetManager.getOrCreateWidget(AlphabetViewerWidget.ID_PREFIX, { alphabetId, instanceId })`
- Synchronise `nextId` via `syncNextId()` au premier appel.

**État sérialisé** (`SerializedAlphabetViewerState`) :

- `alphabetId?: string`

**storeState()** :
- Ne renvoie un objet que si `this.alphabetId` est défini.
- Renvoie `{ alphabetId }`.

**restoreState()** :
- Si `state.alphabetId` est une `string`, appelle :
  - `setAlphabet(alphabetId)`
  - qui :
    - met à jour `this.alphabetId`;
    - réinitialise l'état local (`enteredChars`, historique, surlignages…);
    - recharge l'alphabet via `loadAlphabet()` et restaure le zoom local depuis `localStorage`.

Résultat :
- Après redémarrage, les onglets d'alphabets ouverts sont recréés et chacun recharge
  l'alphabet correspondant.

---

## Bonnes pratiques pour de nouveaux widgets

Pour qu’un nouveau widget participe correctement à la restauration d’état :

1. **Enregistrer un `WidgetFactory`**
   - Dans le module frontend de l’extension (`*-frontend-module.ts`).
   - Fournir un `id` stable (ex : `my.feature.widget`).
   - Implémenter `createWidget(options)` avec toutes les injections nécessaires.
   - **Pour les widgets multi-instances** : la factory **DOIT** appliquer
     `options.instanceId` sur `widget.id` :
     ```typescript
     bind(WidgetFactory).toDynamicValue(ctx => ({
         id: MyWidget.ID,
         createWidget: (options?: any) => {
             const widget = ctx.container.get(MyWidget);
             if (options?.instanceId) {
                 widget.id = `${MyWidget.ID}#${options.instanceId}`;
             }
             return widget;
         }
     })).inSingletonScope();
     ```

2. **Créer les widgets via `WidgetManager`**
   - Ne pas instancier les widgets directement avec `new` dans le code applicatif.
   - Utiliser `widgetManager.getOrCreateWidget(factoryId, options)`.
   - Pour gérer plusieurs onglets de même type :
     - Inclure un `instanceId` dans `options`.
     - La factory applique `widget.id = factoryId#instanceId`.

3. **Implémenter `StatefulWidget`** si le contenu dépend d’un contexte spécifique
   - Ajouter une interface `SerializedXXXState` avec **uniquement des IDs** ou
     des valeurs simples (éviter de stocker des objets lourds).
   - `storeState()` :
     - Vérifier que le contexte est défini (`if (!this.xxxId) return undefined;`).
     - Retourner un objet sérialisable.
   - `restoreState(oldState)` :
     - Vérifier le type des champs (`typeof state.xxxId === 'number' | 'string'`).
     - Appeler une méthode existante d’initialisation (`setXxx(...)`, `initializeXxx(...)`).

4. **Garder la logique de chargement dans des méthodes dédiées**
   - Les méthodes utilisées en `restoreState()` doivent :
     - être déjà robustes (gestion d’erreurs, spinner, etc.) ;
     - ne pas supposer de contexte global difficile à reconstruire.

5. **Synchroniser le compteur `nextId` du TabsManager**
   - Au premier appel de `createWidget()`, scanner le shell pour trouver les widgets
     déjà présents dans le shell et avancer `nextId` au-delà du plus grand instanceId existant.
   - Cela évite de réutiliser un instanceId déjà pris par un widget restauré.
   - Pattern :
     ```typescript
     private syncNextId(): void {
         if (this.nextIdSynced) return;
         this.nextIdSynced = true;
         const prefix = MyWidget.ID + '#';
         for (const w of this.shell.getWidgets('main')) {
             if (w.id.startsWith(prefix)) {
                 const num = parseInt(w.id.substring(prefix.length), 10);
                 if (!isNaN(num) && num >= this.nextId) {
                     this.nextId = num + 1;
                 }
             }
         }
     }
     ```

---

## Bug corrigé (2) : layout non mis à jour en temps réel

### Symptôme

Les onglets ouverts ou fermés dans une session ne sont pas reflétés au redémarrage :
les anciens onglets d'une session lointaine réapparaissent, les onglets récemment
fermés persistent.

### Cause racine

Theia n'appelle `ShellLayoutRestorer.storeLayout()` que lors de l'événement `unload`
(fermeture de la fenêtre du navigateur). Si le serveur Theia est arrêté (`Ctrl+C`)
sans que l'utilisateur ferme l'onglet du navigateur, l'événement `unload` n'est pas
déclenché et le layout n'est pas sauvegardé.

### Solution : `LayoutAutoSaveContribution`

Un `FrontendApplicationContribution` a été ajouté dans l'extension `zones` :
`layout-auto-save-contribution.ts`.

Il écoute `shell.onDidAddWidget` et `shell.onDidRemoveWidget`, et déclenche
`layoutRestorer.storeLayout()` avec un debounce de 2 secondes après chaque changement.

Ainsi, le layout est sauvegardé automatiquement à chaque ouverture ou fermeture d'onglet,
indépendamment de la façon dont l'application est arrêtée.

### Reset du layout (si nécessaire)

Si le layout sauvegardé est corrompu ou trop ancien, le réinitialiser dans la console
du navigateur (F12) :

```javascript
localStorage.removeItem('theia:/:_global_:layout');
location.reload();
```

Ou via la commande Theia : **View → Reset Workbench Layout**.

---

## Bug corrigé (1) : incohérence widget.id entre factory et TabsManager

### Symptôme

Après redémarrage, les onglets restaurés ne correspondaient pas à ceux de la session
précédente. Certains onglets apparaissaient vides ou avec le mauvais contenu.

### Cause racine

Le mécanisme de restauration de layout Theia sauvegarde les positions de widgets
en utilisant `widget.id` comme clé. Lors de la création normale, le **TabsManager**
assignait un ID unique (ex. `zone.geocaches.widget#3`), mais la **WidgetFactory**
créait le widget avec l'ID de base (ex. `zone.geocaches.widget`).

Lors de la restauration :
1. Le layout sérialisé contenait `widget.id = zone.geocaches.widget#3`.
2. `ShellLayoutRestorer` appelait `widgetManager.getOrCreateWidget('zone.geocaches.widget', { instanceId: 3 })`.
3. La factory créait un widget avec `this.id = 'zone.geocaches.widget'` (sans le `#3`).
4. **Mismatch** : le layout cherchait un widget avec ID `#3` mais le widget avait l'ID de base.
5. Le widget n'était pas correctement placé ou identifié → les onglets ne correspondaient pas.

Problème secondaire : le compteur `nextId` des TabsManagers démarrait à 1, pouvant
entrer en conflit avec les instanceIds de widgets restaurés.

### Correction

1. **WidgetFactory** : chaque factory multi-instances applique désormais
   `options.instanceId` sur `widget.id` lors de la création :
   ```typescript
   createWidget: (options?: any) => {
       const widget = ctx.container.get(MyWidget);
       if (options?.instanceId) {
           widget.id = `${MyWidget.ID}#${options.instanceId}`;
       }
       return widget;
   }
   ```

2. **TabsManager** : chaque TabsManager synchronise `nextId` avec les widgets
   déjà présents dans le shell au premier appel de `createWidget()` (méthode `syncNextId`).

### Fichiers modifiés

- `theia-extensions/zones/src/browser/zones-frontend-module.ts`
- `theia-extensions/plugins/src/browser/plugins-frontend-module.ts`
- `theia-extensions/alphabets/src/browser/alphabets-frontend-module.ts`
- `theia-extensions/zones/src/browser/zone-tabs-manager.ts`
- `theia-extensions/zones/src/browser/geocache-tabs-manager.ts`
- `theia-extensions/zones/src/browser/geocache-image-editor-tabs-manager.ts`
- `theia-extensions/zones/src/browser/geocache-log-editor-tabs-manager.ts`
- `theia-extensions/plugins/src/browser/plugin-tabs-manager.ts`
- `theia-extensions/alphabets/src/browser/alphabet-tabs-manager.ts`

---

## Débogage

En cas de problème de restauration d’onglets :

1. **Vérifier les logs navigateur**
   - Rechercher des erreurs liées à :
     - `ShellLayoutRestorer`
     - `Failed to restore state for widget ...`
     - erreurs dans `storeState()` / `restoreState()`.

2. **Contrôler la création via `WidgetManager`**
   - S’assurer que les widgets en question sont bien créés avec
     `widgetManager.getOrCreateWidget(...)`.

3. **Vérifier que `widget.id` est cohérent**
   - L’ID assigné par la factory **doit correspondre exactement** au format
     utilisé par le TabsManager : `factoryId#instanceId`.
   - Si les IDs divergent, le layout ne peut pas retrouver les widgets.

4. **Vérifier l’implémentation `StatefulWidget`**
   - `storeState()` ne doit pas jeter d’exception.
   - `restoreState()` doit tolérer des états partiels ou anciens (layout plus vieux).

5. **Vérifier la synchronisation `nextId`**
   - S’assurer que le TabsManager appelle `syncNextId()` avant de créer
     un nouveau widget, pour éviter les conflits d’ID avec les widgets restaurés.

6. **Vérifier que le layout est bien sauvegardé en temps réel**
   - Le `LayoutAutoSaveContribution` doit être actif (enregistré dans `zones-frontend-module.ts`).
   - Dans la console navigateur, vérifier que la clé `theia:/:_global_:layout` est présente
     et contient des widgets récents :
     ```javascript
     const l = JSON.parse(localStorage.getItem('theia:/:_global_:layout'));
     console.log(JSON.stringify(l).substring(0, 500));
     ```

7. **Réinitialiser le layout si nécessaire**
   - Si le layout est corrompu ou trop ancien :
     ```javascript
     localStorage.removeItem('theia:/:_global_:layout');
     location.reload();
     ```

Ce document sert de référence pour toute future évolution du système d’onglets
et de restauration d’état dans GeoApp.

---

## Schéma de séquence : cycle de vie d’un onglet

Diagramme textuel simplifié pour un onglet typique (ex. `GeocacheDetailsWidget`) :

```text
Utilisateur          TabsManager          WidgetManager        Widget (StatefulWidget)     Shell/Layout
     |                    |                     |                          |                   |
1.   |  action (clic)    |                     |                          |                   |
     |------------------>| openXxx(...)        |                          |                   |
2.   |                    | getOrCreateWidget  |                          |                   |
     |                    |------------------->|                          |                   |
3.   |                    |                     | createWidget(options)   |                   |
     |                    |                     |------------------------>| constructeur       |
4.   |                    |                     |                          | init(), setXxx() |
     |                    |                     |                          |------------------>| addWidget(...)
     |                    |                     |                          |                   |
5.   |                    |                     | <---- widget instance ---|                   |
     |                    |<--------------------|                          |                   |
6.   |                    | attachAndActivate() |                          |                   |
     |                    |-------------------->|                          |                   |

--- Sauvegarde du layout ---

7.   |                    |                     |                          | storeState()      |
     |                    |                     |                          |------------------>|
     |                    |                     |                          |  return { id }    |
     |                    |                     |                          |<------------------|
8.   |                    |                     |                          |                   | sérialisation du layout

--- Redémarrage de l’application ---

9.   | relance app        |                     |                          |                   | charge layout sérialisé
     |--------------------|                     |                          |                   |
10.  |                    |                     | getOrCreateWidget       |                   |
     |                    |                     |<------------------------|                   |
11.  |                    |                     | createWidget(options)   |                   |
     |                    |                     |------------------------>| constructeur       |
12.  |                    |                     |                          | init()            |
     |                    |                     |                          |------------------>| addWidget(...)
13.  |                    |                     |                          | restoreState(id)  |
     |                    |                     |                          |<------------------|
14.  |                    |                     |                          | setXxx(id)        |
     |                    |                     |                          | (recharge données)|
```

**À retenir :**

- La **clé** de restauration est la combinaison :
  - `WidgetFactory` + `WidgetManager.getOrCreateWidget(factoryId, options)`
  - + implémentation `StatefulWidget` qui sait **rejouer l’initialisation** à partir d’un
    état minimal (IDs, codes, etc.).
- Toute nouvelle fonctionnalité d’onglet doit rentrer dans ce cycle pour être
  restaurable au redémarrage.
