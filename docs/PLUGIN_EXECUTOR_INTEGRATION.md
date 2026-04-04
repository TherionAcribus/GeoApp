# Intégration du Plugin Executor avec GeocacheDetailsWidget

## 📋 Vue d'ensemble

Le widget **Plugin Executor** permet d'exécuter des plugins sur une géocache spécifique. Pour l'utiliser depuis le widget `GeocacheDetailsWidget` (extension zones), il faut :

1. Ajouter un bouton "Analyser avec plugins" dans le header
2. Obtenir la contribution `PluginExecutorContribution` via DI
3. Ouvrir le widget avec le contexte de la géocache

---

## 🔧 Modifications à apporter

### 1. Importer les types nécessaires

Dans `theia-extensions/zones/src/browser/geocache-details-widget.tsx`, ajouter :

```typescript
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheContext } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
```

### 2. Injecter la contribution dans le widget

Ajouter l'injection de dépendance dans la classe `GeocacheDetailsWidget` :

```typescript
@injectable()
export class GeocacheDetailsWidget extends ReactWidget {
    // ... autres injections existantes
    
    @inject(PluginExecutorContribution)
    protected readonly pluginExecutorContribution!: PluginExecutorContribution;
    
    // ... reste du code
}
```

### 3. Ajouter le bouton dans le header

Dans le composant React `GeocacheDetailsComponent`, ajouter un bouton dans le header :

```tsx
const handleAnalyzeWithPlugins = () => {
    if (!geocache) return;
    
    // Créer le contexte de la géocache
    const context: GeocacheContext = {
        gcCode: geocache.gc_code,
        name: geocache.name,
        coordinates: geocache.latitude && geocache.longitude ? {
            latitude: geocache.latitude,
            longitude: geocache.longitude,
            coordinatesRaw: geocache.coordinates_raw
        } : undefined,
        description: geocache.long_description,
        hint: geocache.hint,
        difficulty: geocache.difficulty,
        terrain: geocache.terrain
    };
    
    // Ouvrir le Plugin Executor avec ce contexte
    pluginExecutorContribution.openWithContext(context);
};

// Dans le JSX du header :
<div className='geocache-header'>
    <h2>{geocache.name} ({geocache.gc_code})</h2>
    <div className='geocache-actions'>
        <button
            className='theia-button secondary'
            onClick={handleAnalyzeWithPlugins}
            title='Analyser avec les plugins'
        >
            🔌 Analyser avec plugins
        </button>
        {/* ... autres boutons existants */}
    </div>
</div>
```

### 4. Passer la contribution au composant React

Modifier la signature de `GeocacheDetailsComponent` pour recevoir la contribution :

```typescript
const GeocacheDetailsComponent: React.FC<{
    geocache: Geocache | null;
    // ... autres props
    pluginExecutorContribution: PluginExecutorContribution;
}> = ({ geocache, /* ... autres props */, pluginExecutorContribution }) => {
    // ... implémentation
};
```

Et dans la méthode `render()` du widget :

```typescript
protected render(): React.ReactNode {
    return <GeocacheDetailsComponent
        geocache={this.currentGeocache}
        // ... autres props
        pluginExecutorContribution={this.pluginExecutorContribution}
    />;
}
```

---

## 🎨 Alternative : Menu contextuel

Au lieu d'un bouton dans le header, vous pouvez aussi ajouter une action dans le menu contextuel des géocaches :

### Dans `zones-frontend-contribution.ts`

```typescript
export namespace ZonesCommands {
    // ... commandes existantes
    
    export const ANALYZE_GEOCACHE_WITH_PLUGINS = {
        id: 'zones.analyzeGeocacheWithPlugins',
        label: 'Analyser avec plugins'
    };
}

// Dans registerCommands()
registry.registerCommand(ZonesCommands.ANALYZE_GEOCACHE_WITH_PLUGINS, {
    execute: (geocache: Geocache) => {
        const context: GeocacheContext = {
            gcCode: geocache.gc_code,
            name: geocache.name,
            coordinates: geocache.latitude && geocache.longitude ? {
                latitude: geocache.latitude,
                longitude: geocache.longitude,
                coordinatesRaw: geocache.coordinates_raw
            } : undefined,
            description: geocache.long_description,
            hint: geocache.hint,
            difficulty: geocache.difficulty,
            terrain: geocache.terrain
        };
        
        this.pluginExecutorContribution.openWithContext(context);
    }
});

// Dans registerMenus()
menus.registerMenuAction(ZonesContextMenu.GEOCACHE_ACTIONS, {
    commandId: ZonesCommands.ANALYZE_GEOCACHE_WITH_PLUGINS.id,
    label: '🔌 Analyser avec plugins'
});
```

---

## 🧪 Test de l'intégration

Après implémentation :

1. **Rebuild des extensions** :
   ```bash
   cd theia-blueprint
   yarn build:extensions
   ```

2. **Rebuild de l'app** :
   ```bash
   cd applications/browser
   yarn build
   yarn start
   ```

3. **Test dans l'IDE** :
   - Ouvrir une géocache dans le widget GeocacheDetails
   - Cliquer sur "Analyser avec plugins"
   - Vérifier que le Plugin Executor s'ouvre avec les coordonnées pré-remplies
   - Sélectionner un plugin (ex: Caesar)
   - Exécuter et vérifier le résultat

---

## 📊 Workflow complet

```
GeocacheDetailsWidget
    ↓ Clic "Analyser avec plugins"
    ↓ Création du GeocacheContext
    ↓ 
PluginExecutorContribution.openWithContext(context)
    ↓ Ouverture du widget
    ↓ 
PluginExecutorWidget
    ↓ Pré-remplissage du formulaire avec contexte
    ↓ Sélection du plugin
    ↓ Exécution
    ↓ 
PluginsService.executePlugin(name, inputs)
    ↓ Appel API Flask
    ↓ 
Backend: /api/plugins/{name}/execute
    ↓ Retour du résultat
    ↓ 
Affichage dans PluginExecutorWidget
```

---

## 🚀 Prochaines étapes

Après cette intégration de base, vous pourrez :

1. **Ajouter des actions sur les résultats** :
   - Bouton "Appliquer aux coordonnées" pour mettre à jour la géocache
   - Export des résultats en JSON
   - Historique des exécutions

2. **Améliorer l'UX** :
   - Drag & drop d'une géocache vers le Plugin Executor
   - Keybinding pour ouvrir rapidement (ex: `Ctrl+Shift+P`)
   - Badge sur les plugins compatibles avec le type de géocache

3. **Tasks Monitor** (Étape 5) :
   - Suivi des exécutions asynchrones
   - Notifications quand une tâche se termine
   - Annulation de tâches en cours

---

## 📝 Notes importantes

- Le `GeocacheContext` contient toutes les infos nécessaires pour l'exécution
- Le pré-remplissage est automatique basé sur le schéma du plugin
- Les coordonnées au format Geocaching (`coordinates_raw`) sont prioritaires
- L'exécution peut être synchrone ou asynchrone selon le besoin
