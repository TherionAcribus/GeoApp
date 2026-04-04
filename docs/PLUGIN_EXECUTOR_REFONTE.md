# Refonte du Plugin Executor - Architecture à deux modes

## 📋 Analyse des problèmes actuels

### Situation actuelle

Le système actuel utilise un **seul widget** `PluginExecutorWidget` pour deux cas d'usage **très différents** :

1. **Ouverture depuis le Panel Plugins** (clic sur un plugin)
   - L'utilisateur a déjà choisi un plugin spécifique
   - Objectif : exécuter CE plugin (encoder/décoder)
   - Peut éventuellement être associé à une géocache

2. **Ouverture depuis Geocache Details** (bouton "Analyser avec plugins")
   - L'utilisateur veut analyser une géocache
   - Objectif : choisir quel plugin utiliser sur le contenu
   - Toujours associé à la géocache

### Problèmes identifiés

❌ **Comportements incohérents** lors de l'ouverture  
❌ **Confusion** entre les deux modes d'utilisation  
❌ **Un même widget essaie de gérer deux workflows différents**  
❌ **Code complexe** avec beaucoup de conditions imbriquées  
❌ **UX déroutante** pour l'utilisateur

---

## 🎯 Solution : Deux modes distincts

### Mode 1 : **PLUGIN MODE** (ouvert depuis Panel Plugins)

**Caractéristiques :**
- Plugin **pré-sélectionné** (pas de dropdown de choix)
- Options **Encoder/Décoder** disponibles
- Association géocache **optionnelle**
- Si géocache associée : accès aux actions (ajouter waypoint, modifier coords, etc.)
- Titre du widget : **"Plugin: [NomPlugin]"**

**Workflow :**
```
Panel Plugins → Clic sur "Caesar" 
  → Ouvre Plugin Executor en mode PLUGIN
  → Plugin = Caesar (affiché, non modifiable)
  → Champ texte vide
  → Option Encoder/Décoder
  → Bouton "Associer une géocache" (optionnel)
  → Exécuter
```

### Mode 2 : **GEOCACHE MODE** (ouvert depuis Geocache Details)

**Caractéristiques :**
- Géocache **toujours associée** (affichée dans l'en-tête)
- **Sélecteur de plugin** visible (l'utilisateur choisit)
- **Décoder uniquement** (pas d'option encoder)
- Texte pré-rempli avec description/énigme de la géocache
- Peut **enchaîner les plugins** (sortie d'un plugin → entrée d'un autre)
- Titre du widget : **"Analyse: [GC123AB]"**

**Workflow :**
```
Geocache Details (GC123AB) → Bouton "Analyser" 
  → Ouvre Plugin Executor en mode GEOCACHE
  → Géocache = GC123AB (affiché, non modifiable)
  → Texte = description pré-remplie
  → Dropdown : choisir un plugin
  → Mode = Décoder (forcé)
  → Exécuter
  → Résultat affiché
  → Bouton "Utiliser comme entrée pour un autre plugin"
```

---

## 🏗️ Architecture proposée

### Interface : Mode d'exécution

```typescript
/**
 * Mode d'exécution du Plugin Executor
 */
export type PluginExecutorMode = 'plugin' | 'geocache';

/**
 * Configuration initiale du widget
 */
export interface PluginExecutorConfig {
    mode: PluginExecutorMode;
    
    // Mode PLUGIN
    pluginName?: string;           // Plugin pré-sélectionné
    allowModeSelection?: boolean;  // Permettre encode/decode
    
    // Mode GEOCACHE
    geocacheContext?: GeocacheContext;  // Contexte géocache
    allowPluginChaining?: boolean;      // Permettre l'enchaînement
}
```

### Modifications du Widget

```typescript
@injectable()
export class PluginExecutorWidget extends ReactWidget {
    
    private config: PluginExecutorConfig | null = null;
    
    /**
     * Initialise le widget en mode PLUGIN
     */
    public initializePluginMode(pluginName: string): void {
        this.config = {
            mode: 'plugin',
            pluginName,
            allowModeSelection: true
        };
        this.title.label = `Plugin: ${pluginName}`;
        this.update();
    }
    
    /**
     * Initialise le widget en mode GEOCACHE
     */
    public initializeGeocacheMode(context: GeocacheContext): void {
        this.config = {
            mode: 'geocache',
            geocacheContext: context,
            allowPluginChaining: true
        };
        this.title.label = `Analyse: ${context.gcCode}`;
        this.update();
    }
    
    protected render(): React.ReactNode {
        if (!this.config) {
            return <div>Chargement...</div>;
        }
        
        return <PluginExecutorComponent
            config={this.config}
            pluginsService={this.pluginsService}
            tasksService={this.tasksService}
            messageService={this.messageService}
        />;
    }
}
```

### Composant React

```typescript
const PluginExecutorComponent: React.FC<{
    config: PluginExecutorConfig;
    pluginsService: PluginsService;
    tasksService: TasksService;
    messageService: MessageService;
}> = ({ config, pluginsService, tasksService, messageService }) => {
    
    // État adapté au mode
    const [state, setState] = React.useState<ExecutorState>({
        // ... état commun
        selectedPlugin: config.mode === 'plugin' ? config.pluginName : null,
        canSelectPlugin: config.mode === 'geocache',
        canChangeMode: config.mode === 'plugin' && config.allowModeSelection,
        geocacheContext: config.geocacheContext || null
    });
    
    return (
        <div className='plugin-executor-container'>
            {renderHeader(config, state)}
            
            {config.mode === 'geocache' && renderPluginSelector()}
            {config.mode === 'plugin' && renderPluginInfo()}
            
            {config.mode === 'plugin' && state.canChangeMode && renderModeSelector()}
            
            {renderTextInput()}
            {renderParametersForm()}
            {renderExecutionControls()}
            {renderResults()}
            
            {config.mode === 'geocache' && state.result && renderChainButton()}
        </div>
    );
};
```

---

## 🔄 Workflows détaillés

### Workflow 1 : Plugin depuis le Panel

```
1. Utilisateur ouvre Panel Plugins (barre latérale gauche)
2. Utilisateur clique sur "Caesar"
3. PluginExecutorContribution.openWithPlugin("Caesar")
4. Widget créé/réutilisé
5. widget.initializePluginMode("Caesar")
6. Interface affichée :
   ├─ Header : "Plugin: Caesar"
   ├─ Info plugin (nom, description, version)
   ├─ Sélecteur Mode : [Décoder ▼ Encoder]
   ├─ Zone texte (vide)
   ├─ Bouton "Associer une géocache" (optionnel)
   └─ Bouton Exécuter
7. Utilisateur saisit du texte ou associe une géocache
8. Exécution
9. Résultat affiché
10. Si géocache associée : actions disponibles (ajouter WP, etc.)
```

### Workflow 2 : Analyse depuis Geocache

```
1. Utilisateur ouvre Geocache Details (GC123AB)
2. Utilisateur clique "Analyser avec plugins"
3. PluginExecutorContribution.openWithContext({ gcCode: "GC123AB", ... })
4. Widget créé/réutilisé
5. widget.initializeGeocacheMode(context)
6. Interface affichée :
   ├─ Header : "Analyse: GC123AB - Nom de la cache"
   ├─ Coordonnées affichées
   ├─ Dropdown : "Choisir un plugin..."
   ├─ Zone texte (pré-remplie avec description)
   ├─ Mode = Décoder (fixé, pas d'option)
   └─ Bouton Exécuter (désactivé tant que plugin non choisi)
7. Utilisateur choisit un plugin (ex: "Caesar")
8. Formulaire de paramètres généré automatiquement
9. Utilisateur modifie si besoin et exécute
10. Résultat affiché
11. Bouton "Utiliser comme entrée pour un autre plugin"
12. Si cliqué → garde le résultat comme texte, reset le plugin
```

### Workflow 3 : Enchaînement de plugins (Geocache Mode)

```
1. Dans Geocache Mode, après une exécution réussie
2. Résultat = "BONJOUR"
3. Bouton "↪ Enchaîner avec un autre plugin" visible
4. Utilisateur clique
5. Interface se réinitialise :
   ├─ Plugin sélectionné → null
   ├─ Zone texte ← "BONJOUR" (résultat précédent)
   ├─ Résultat précédent archivé/masqué
   └─ Historique des enchaînements visible (optionnel)
6. Utilisateur choisit nouveau plugin (ex: "ROT13")
7. Exécute
8. Nouveau résultat affiché
9. Historique : Caesar → ROT13
```

---

## 🎨 Différences visuelles

### Mode PLUGIN

```
┌─────────────────────────────────────────────────┐
│ 🔌 Plugin: Caesar                           [x] │
├─────────────────────────────────────────────────┤
│ 📦 Caesar v1.0                                  │
│    Décalage alphabétique simple                 │
│                                                 │
│ 🎯 Mode d'exécution                             │
│    ○ Décoder  ○ Encoder                         │
│                                                 │
│ 📝 Texte                                        │
│ ┌─────────────────────────────────────────────┐ │
│ │                                             │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ⚙️ Paramètres                                   │
│    Décalage: [3      ]                          │
│                                                 │
│ 💡 Association géocache (optionnel)             │
│    [ Associer une géocache... ]                 │
│                                                 │
│               [  Exécuter  ]                    │
└─────────────────────────────────────────────────┘
```

### Mode GEOCACHE

```
┌─────────────────────────────────────────────────┐
│ 🎯 Analyse: GC123AB                         [x] │
├─────────────────────────────────────────────────┤
│ GC123AB - Le mystère du château                 │
│ 📍 N 48° 51.400 E 002° 21.050                   │
│                                                 │
│ 🔌 Choix du plugin                              │
│ ┌─────────────────────────────────────────────┐ │
│ │ -- Sélectionner un plugin --            ▼  │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ 📝 Texte à analyser                             │
│ ┌─────────────────────────────────────────────┐ │
│ │ Dans la description, vous trouverez...      │ │
│ │ WBSKVHM TFMWVI...                           │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ (Paramètres apparaissent après sélection plugin)│
│                                                 │
│               [  Exécuter  ]                    │
│                                                 │
│ ✅ Résultat                                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ BONJOUR MARIE                               │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│    [↪ Enchaîner avec un autre plugin]          │
│    [📍 Ajouter comme waypoint]                  │
└─────────────────────────────────────────────────┘
```

---

## 📝 Modifications de code requises

### 1. `plugin-executor-widget.tsx`

**Modifications principales :**

```typescript
// Ajouter les types
export type PluginExecutorMode = 'plugin' | 'geocache';

export interface PluginExecutorConfig {
    mode: PluginExecutorMode;
    pluginName?: string;
    geocacheContext?: GeocacheContext;
    allowModeSelection?: boolean;
    allowPluginChaining?: boolean;
}

// Remplacer les méthodes setGeocacheContext et setSelectedPlugin par :
public initializePluginMode(pluginName: string): void {
    this.config = {
        mode: 'plugin',
        pluginName,
        allowModeSelection: true
    };
    this.title.label = `Plugin: ${pluginName}`;
    this.title.iconClass = 'fa fa-puzzle-piece';
    this.update();
}

public initializeGeocacheMode(context: GeocacheContext): void {
    this.config = {
        mode: 'geocache',
        geocacheContext: context,
        allowPluginChaining: true
    };
    this.title.label = `Analyse: ${context.gcCode}`;
    this.title.iconClass = 'fa fa-search';
    this.update();
}

// Adapter le composant React pour recevoir config au lieu de context et initialPlugin
const PluginExecutorComponent: React.FC<{
    config: PluginExecutorConfig;
    // ... autres props
}> = ({ config, pluginsService, tasksService, messageService }) => {
    
    // Initialisation basée sur le mode
    const [state, setState] = React.useState<ExecutorState>({
        plugins: [],
        selectedPlugin: config.mode === 'plugin' ? config.pluginName || null : null,
        pluginDetails: null,
        formInputs: {},
        isExecuting: false,
        result: null,
        error: null,
        executionMode: 'sync',
        task: null,
        mode: config.mode,
        canSelectPlugin: config.mode === 'geocache',
        canChangeMode: config.mode === 'plugin' && config.allowModeSelection !== false
    });
    
    // Affichage conditionnel selon le mode
    return (
        <div className='plugin-executor-container'>
            {/* Header adapté au mode */}
            {config.mode === 'plugin' && renderPluginModeHeader()}
            {config.mode === 'geocache' && renderGeocacheModeHeader()}
            
            {/* Sélecteur de plugin uniquement en mode geocache */}
            {config.mode === 'geocache' && renderPluginSelector()}
            
            {/* Info plugin uniquement en mode plugin */}
            {config.mode === 'plugin' && renderPluginInfo()}
            
            {/* Sélecteur encode/decode uniquement en mode plugin */}
            {config.mode === 'plugin' && state.canChangeMode && renderModeSelector()}
            
            {/* Reste de l'interface commune */}
            {renderTextInput()}
            {renderDynamicForm()}
            {renderExecutionControls()}
            {renderResults()}
            
            {/* Bouton d'enchaînement uniquement en mode geocache */}
            {config.mode === 'geocache' && state.result && renderChainButton()}
        </div>
    );
};
```

### 2. `plugins-contribution.ts`

**Modifications :**

```typescript
export class PluginExecutorContribution extends AbstractViewContribution<PluginExecutorWidget> {
    
    /**
     * Ouvre l'executor avec un contexte de géocache (MODE GEOCACHE).
     */
    async openWithContext(context: GeocacheContext): Promise<void> {
        const widget = await this.openView({ activate: true });
        widget.initializeGeocacheMode(context);
    }
    
    /**
     * Ouvre l'executor avec un plugin pré-sélectionné (MODE PLUGIN).
     */
    async openWithPlugin(pluginName: string): Promise<void> {
        const widget = await this.openView({ activate: true });
        widget.initializePluginMode(pluginName);
    }
}
```

### 3. Association géocache en mode PLUGIN

En mode PLUGIN, si l'utilisateur souhaite associer une géocache :

```typescript
// Nouveau composant pour association optionnelle
const GeocacheAssociationPanel: React.FC<{
    onAssociate: (context: GeocacheContext) => void;
}> = ({ onAssociate }) => {
    const [showSelector, setShowSelector] = React.useState(false);
    const [selectedGC, setSelectedGC] = React.useState<string>('');
    
    return (
        <div className='geocache-association-panel'>
            {!showSelector ? (
                <button onClick={() => setShowSelector(true)}>
                    🔗 Associer une géocache
                </button>
            ) : (
                <div>
                    <input 
                        placeholder='GC Code (ex: GC123AB)'
                        value={selectedGC}
                        onChange={(e) => setSelectedGC(e.target.value)}
                    />
                    <button onClick={() => fetchAndAssociate(selectedGC, onAssociate)}>
                        Associer
                    </button>
                    <button onClick={() => setShowSelector(false)}>
                        Annuler
                    </button>
                </div>
            )}
        </div>
    );
};
```

---

## ✅ Avantages de cette architecture

1. **Clarté** : Deux modes bien distincts, pas de confusion
2. **Maintenabilité** : Code plus simple, moins de conditions imbriquées
3. **UX cohérente** : Interface adaptée à chaque cas d'usage
4. **Extensibilité** : Facile d'ajouter de nouvelles fonctionnalités par mode
5. **Debugging** : Plus facile de tracer les bugs (mode plugin vs mode geocache)

---

## 🚀 Plan d'implémentation

### Étape 1 : Refactoriser le widget
- [ ] Ajouter les types `PluginExecutorMode` et `PluginExecutorConfig`
- [ ] Remplacer `setGeocacheContext` et `setSelectedPlugin` par `initializePluginMode` et `initializeGeocacheMode`
- [ ] Adapter le composant React pour recevoir `config`

### Étape 2 : Adapter l'interface
- [ ] Créer `renderPluginModeHeader()` et `renderGeocacheModeHeader()`
- [ ] Créer `renderPluginSelector()` (mode geocache uniquement)
- [ ] Créer `renderPluginInfo()` (mode plugin uniquement)
- [ ] Créer `renderModeSelector()` (encode/decode, mode plugin uniquement)
- [ ] Créer `renderChainButton()` (mode geocache uniquement)

### Étape 3 : Gérer l'enchaînement de plugins
- [ ] Fonction `handleChainPlugin()` qui :
  - Archive le résultat précédent
  - Pré-remplit le texte avec le résultat
  - Reset le plugin sélectionné
  - Garde l'historique des enchaînements

### Étape 4 : Association géocache optionnelle (mode plugin)
- [ ] Créer composant `GeocacheAssociationPanel`
- [ ] Implémenter `fetchAndAssociate()`
- [ ] Afficher actions géocache si associée

### Étape 5 : Tests
- [ ] Tester ouverture depuis Panel Plugins
- [ ] Tester ouverture depuis Geocache Details
- [ ] Tester enchaînement de plugins
- [ ] Tester association géocache en mode plugin

---

## 📚 Référence : Code de l'ancien projet

L'ancien projet avait une approche similaire avec :
- Formulaire caché pour les plugins "Solver" (équivalent mode geocache)
- Affichage complet pour les plugins normaux (équivalent mode plugin)
- Gestion de l'association géocache avec sessionStorage
- Fonctions pour ouvrir la géocache, ajouter des waypoints, etc.

**Points à réutiliser :**
- Logique d'association géocache (sélecteur + code GC manuel)
- Fonctions de conversion de coordonnées
- Actions sur les résultats (ajouter waypoint, afficher sur carte)
- Gestion du cache des coordonnées originales

---

## 🎯 Résultat attendu

Après cette refonte :

✅ **Mode PLUGIN** : Interface claire pour exécuter UN plugin spécifique  
✅ **Mode GEOCACHE** : Interface claire pour analyser une géocache avec N plugins  
✅ **Pas de confusion** entre les deux modes  
✅ **Code maintenable** et extensible  
✅ **UX cohérente** et intuitive

