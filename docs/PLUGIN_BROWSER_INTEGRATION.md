# Intégration du clic sur plugin dans le Plugins Browser

## 🎯 Objectif

Quand l'utilisateur clique sur un plugin dans le panneau de gauche (Plugins Browser), ouvrir automatiquement le Plugin Executor avec ce plugin pré-sélectionné.

---

## ✅ Modifications effectuées

### 1. **PluginExecutorContribution : Nouvelle méthode `openWithPlugin`**

**Fichier** : `plugins-contribution.ts`

Ajout d'une méthode pour ouvrir le Plugin Executor avec un plugin pré-sélectionné :

```typescript
/**
 * Ouvre l'executor avec un plugin pré-sélectionné.
 */
async openWithPlugin(pluginName: string): Promise<void> {
    const widget = await this.openView({ activate: true });
    widget.setSelectedPlugin(pluginName);
}
```

---

### 2. **PluginExecutorWidget : Méthode `setSelectedPlugin`**

**Fichier** : `plugin-executor-widget.tsx`

Ajout d'une propriété et d'une méthode pour supporter la pré-sélection :

```typescript
private selectedPluginName: string | null = null;

/**
 * Ouvre le widget avec un plugin pré-sélectionné (sans contexte géocache)
 */
public setSelectedPlugin(pluginName: string): void {
    this.selectedPluginName = pluginName;
    // Créer un contexte vide
    this.geocacheContext = {
        gcCode: '',
        name: 'Aucune géocache'
    };
    this.update();
}
```

---

### 3. **PluginExecutorComponent : Support du plugin initial**

**Fichier** : `plugin-executor-widget.tsx`

Ajout de la propriété `initialPlugin` au composant React :

```typescript
const PluginExecutorComponent: React.FC<{
    context: GeocacheContext;
    initialPlugin?: string | null;  // ← Nouveau
    pluginsService: PluginsService;
    tasksService: TasksService;
    messageService: MessageService;
}> = ({ context, initialPlugin, pluginsService, tasksService, messageService }) => {
    // ...
    
    // Pré-sélectionner le plugin si fourni
    React.useEffect(() => {
        if (initialPlugin) {
            setState(prev => ({
                ...prev,
                selectedPlugin: initialPlugin
            }));
        }
    }, []);
}
```

---

### 4. **PluginsBrowserWidget : Clic sur un plugin**

**Fichier** : `plugins-browser-widget.tsx`

**Import** :
```typescript
import { PluginExecutorContribution } from './plugins-contribution';
```

**Injection** :
```typescript
@inject(PluginExecutorContribution)
protected readonly pluginExecutorContribution!: PluginExecutorContribution;
```

**Gestionnaire de clic** :
```typescript
/**
 * Gère le clic sur un plugin - Ouvre le Plugin Executor avec le plugin pré-sélectionné.
 */
protected handlePluginClick = (plugin: Plugin): void => {
    console.log('Opening plugin executor for:', plugin.name);
    this.pluginExecutorContribution.openWithPlugin(plugin.name);
};
```

---

### 5. **Affichage conditionnel du contexte**

**Fichier** : `plugin-executor-widget.tsx`

Affichage différent selon qu'il y ait ou non une géocache :

```typescript
{context.gcCode ? (
    <div className='geocache-context'>
        <strong>{context.gcCode}</strong> - {context.name}
        {context.coordinates && (
            <div className='geocache-coords'>
                📍 {context.coordinates.coordinatesRaw || 
                    `${context.coordinates.latitude}, ${context.coordinates.longitude}`}
            </div>
        )}
    </div>
) : (
    <div className='geocache-context' style={{ opacity: 0.7, fontSize: '14px' }}>
        <em>Pas de géocache associée - Exécution libre</em>
    </div>
)}
```

---

## 🎬 Workflow utilisateur

### Scénario 1 : Clic depuis le Plugins Browser

1. **Utilisateur** : Ouvre le panneau "Plugins" (gauche)
2. **Utilisateur** : Clique sur le plugin "Caesar"
3. **Système** : Ouvre le Plugin Executor dans une nouvelle tab
4. **Système** : Pré-sélectionne "Caesar" dans la dropdown
5. **Système** : Affiche "Pas de géocache associée - Exécution libre"
6. **Utilisateur** : Entre ou colle du texte
7. **Utilisateur** : Clique "Exécuter"
8. **Système** : Exécute le plugin et affiche le résultat

### Scénario 2 : Clic depuis une géocache (inchangé)

1. **Utilisateur** : Ouvre une géocache Mystery
2. **Utilisateur** : Clique "🔌 Analyser avec plugins"
3. **Système** : Ouvre le Plugin Executor
4. **Système** : Pré-remplit le textarea avec la description
5. **Système** : Affiche le GC code et les coordonnées
6. **Utilisateur** : Sélectionne un plugin
7. **Utilisateur** : Clique "Exécuter"
8. **Système** : Exécute le plugin et affiche le résultat

---

## 📊 Comparaison avant/après

### Avant
```
[Clic sur Caesar dans la liste]
  ↓
Console: "Plugin clicked: caesar"
Notification: "Plugin: caesar v1.0.0"
  ↓
(Rien d'autre)
```

### Après
```
[Clic sur Caesar dans la liste]
  ↓
Plugin Executor s'ouvre
  ↓
Caesar pré-sélectionné
  ↓
Textarea vide (pas de géocache)
  ↓
Utilisateur entre du texte
  ↓
Clic "Exécuter" → Résultat affiché
```

---

## 🔧 Architecture technique

### Flux de données

```
PluginsBrowserWidget
  └─ handlePluginClick(plugin)
      └─ pluginExecutorContribution.openWithPlugin(pluginName)
          └─ widget.setSelectedPlugin(pluginName)
              ├─ Set selectedPluginName = pluginName
              ├─ Create empty geocacheContext
              └─ update() → render()
                  └─ PluginExecutorComponent
                      └─ React.useEffect() → setState({ selectedPlugin })
                          └─ Trigger loadPluginDetails()
                              └─ Formulaire généré automatiquement
```

### État du widget

```typescript
interface WidgetState {
    geocacheContext: GeocacheContext | null;
    selectedPluginName: string | null;
}
```

**Deux modes possibles** :
1. **Mode Géocache** : `geocacheContext` complet, `selectedPluginName` = null
2. **Mode Libre** : `geocacheContext` vide, `selectedPluginName` = "caesar"

---

## 🎨 Interface utilisateur

### Mode avec géocache
```
┌─────────────────────────────────────────────┐
│ 🎯 Exécuter un plugin                      │
├─────────────────────────────────────────────┤
│ GC123AB - Mystery Cache                    │
│ 📍 N 48° 51.400 E 002° 21.050             │
├─────────────────────────────────────────────┤
│ 📝 Texte à analyser                        │
│ ┌───────────────────────────────────────┐   │
│ │ Le code secret est...                 │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ Plugin: [Caesar ▾]                         │
└─────────────────────────────────────────────┘
```

### Mode libre (depuis Plugins Browser)
```
┌─────────────────────────────────────────────┐
│ 🎯 Exécuter un plugin                      │
├─────────────────────────────────────────────┤
│ Pas de géocache associée - Exécution libre │
├─────────────────────────────────────────────┤
│ 📝 Texte à analyser                        │
│ ┌───────────────────────────────────────┐   │
│ │ (Collez votre texte ici)              │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ Plugin: [Caesar ▾] ← pré-sélectionné       │
└─────────────────────────────────────────────┘
```

---

## 🐛 Points d'attention

### 1. **Contexte vide**
Quand on ouvre depuis le Plugins Browser, on crée un contexte vide :
```typescript
{
    gcCode: '',
    name: 'Aucune géocache'
}
```

**Pourquoi ?** Le composant `PluginExecutorComponent` nécessite un contexte. Un contexte vide permet de réutiliser le même composant dans les deux modes.

### 2. **Pré-remplissage du texte**
Le textarea est **pré-rempli uniquement si** :
- Une géocache est présente
- La géocache a une description, hint ou coordonnées

En mode libre (clic depuis Plugins Browser), le textarea reste **vide**.

### 3. **Double pré-sélection**
Quand on ouvre depuis une géocache avec `openWithContext()` :
- Le plugin n'est **pas** pré-sélectionné
- L'utilisateur choisit manuellement

Quand on ouvre depuis le Plugins Browser avec `openWithPlugin()` :
- Le plugin **est** pré-sélectionné
- L'utilisateur peut changer s'il veut

---

## 🚀 Améliorations futures possibles

### 1. **Historique des exécutions**
- Garder l'historique des plugins exécutés
- Bouton "Ré-exécuter"

### 2. **Favoris**
- Marquer certains plugins comme favoris
- Accès rapide depuis le Browser

### 3. **Groupes de plugins**
- Grouper par catégorie visuelle
- Couleurs différentes selon le type

### 4. **Preview rapide**
- Hover sur un plugin → Tooltip avec description
- Double-clic → Exécution immédiate (si pas de params)

### 5. **Raccourcis clavier**
- `Ctrl+Shift+P` : Ouvrir la palette de plugins
- `Ctrl+Enter` : Exécuter le plugin sélectionné

---

## 📝 Tests à effectuer

### Test 1 : Ouverture depuis Plugins Browser
1. Ouvrir le panneau "Plugins"
2. Cliquer sur "Caesar"
3. **Vérifier** : Plugin Executor s'ouvre
4. **Vérifier** : Caesar est pré-sélectionné
5. **Vérifier** : Message "Pas de géocache associée"
6. **Vérifier** : Textarea est vide

### Test 2 : Ouverture depuis une géocache
1. Ouvrir une géocache
2. Cliquer "🔌 Analyser avec plugins"
3. **Vérifier** : Plugin Executor s'ouvre
4. **Vérifier** : GC code et coords affichés
5. **Vérifier** : Textarea pré-rempli avec description
6. **Vérifier** : Aucun plugin pré-sélectionné

### Test 3 : Exécution complète depuis Browser
1. Cliquer sur "Caesar" dans le panneau Plugins
2. Coller du texte : "HELLO WORLD"
3. Cliquer "Exécuter"
4. **Vérifier** : Résultat = "URYYB JBEYQ" (ROT13)
5. **Vérifier** : Bouton copier fonctionne

### Test 4 : Changement de plugin
1. Ouvrir depuis "Caesar"
2. Changer pour "Vigenere"
3. **Vérifier** : Nouveaux paramètres affichés
4. **Vérifier** : Texte dans le textarea reste intact

---

## 🎉 Résultat

**Avant** : Cliquer sur un plugin ne faisait rien d'utile

**Après** : Cliquer sur un plugin ouvre directement l'interface d'exécution avec tout prêt ! 🚀

L'utilisateur peut maintenant **tester rapidement n'importe quel plugin** sans avoir à ouvrir une géocache au préalable.

---

## ⚙️ Préférences liées

Les préférences GeoApp pilotent désormais plusieurs comportements du Plugins Browser :

- `geoApp.backend.apiBaseUrl` définit la cible des appels HTTP réalisés par `PluginsServiceImpl`.
- `geoApp.plugins.lazyMode` contrôle le préchargement des plugins côté Flask (désactiver = temps d'ouverture quasi nul).
- `geoApp.plugins.autoDiscoverOnStart` permet d'ignorer la découverte automatique au démarrage (utile en dev/offline).
- `geoApp.plugins.executor.timeoutSec` et `geoApp.plugins.executor.allowLongRunning` fixent les limites appliquées par le `PluginManager`.

Ces réglages sont éditables dans la nouvelle vue **GeoApp ▸ Préférences** et synchronisés avec le back via `/api/preferences`.
