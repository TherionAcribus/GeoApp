# Phase 3 : Extension Theia - Intégration des Plugins

## 🎯 Objectifs

Créer une interface utilisateur dans Theia pour :
1. **Visualiser** la liste des plugins disponibles
2. **Exécuter** les plugins sur les géocaches
3. **Afficher** les résultats dans un format exploitable
4. **Intégrer** avec le widget GeocacheDetails existant

---

## 📋 Fonctionnalités à implémenter

### 1. Widget "Plugins Browser" 
**Panneau latéral pour gérer les plugins**

- Liste des plugins disponibles avec :
  - Nom, version, description
  - Icône selon le type (Substitution, Transposition, etc.)
  - Statut (activé/désactivé)
  - Badge pour plugins custom vs official
  
- Actions :
  - Clic pour voir les détails d'un plugin
  - Bouton "Rafraîchir" pour redécouvrir les plugins
  - Filtres par catégorie et source (official/custom)

### 2. Widget "Plugin Executor"
**Interface d'exécution de plugins sur une géocache**

- Intégration dans `GeocacheDetailsWidget` :
  - Bouton "Analyser avec plugins" dans le détail d'une géocache
  - Ouvre un panneau dédié à l'exécution
  
- Interface d'exécution :
  - Sélection du plugin (dropdown ou liste)
  - Formulaire dynamique généré depuis le schéma du plugin
  - Pré-remplissage avec les données de la géocache
  - Bouton "Exécuter" (synchrone) et "Exécuter en arrière-plan" (asynchrone)

### 3. Widget "Plugin Results"
**Affichage des résultats d'exécution**

- Affichage structuré des résultats :
  - Status (ok, error, partial)
  - Résultats principaux (text_output, coordinates, etc.)
  - Métadonnées (temps d'exécution, plugin utilisé)
  
- Actions sur les résultats :
  - Copier le résultat
  - Appliquer aux coordonnées (si pertinent)
  - Exporter en JSON
  - Historique des exécutions

### 4. Vue "Tasks Monitor"
**Suivi des tâches asynchrones**

- Liste des tâches en cours et terminées
- Statut en temps réel (queued, running, completed, failed)
- Progression (si applicable)
- Annulation de tâches
- Notification quand une tâche se termine

---

## 🏗️ Architecture technique

### Structure des fichiers

```
theia-extensions/
└── plugins/
    ├── package.json
    ├── src/
    │   ├── browser/
    │   │   ├── plugins-frontend-module.ts         # Module principal
    │   │   ├── plugins-contribution.ts            # Contribution Theia
    │   │   ├── plugins-browser-widget.tsx         # Liste des plugins
    │   │   ├── plugin-executor-widget.tsx         # Exécution
    │   │   ├── plugin-results-widget.tsx          # Résultats
    │   │   ├── tasks-monitor-widget.tsx           # Suivi des tâches
    │   │   └── services/
    │   │       ├── plugins-service.ts             # Service API plugins
    │   │       └── tasks-service.ts               # Service API tasks
    │   └── common/
    │       ├── plugin-protocol.ts                 # Interfaces TypeScript
    │       └── task-protocol.ts                   # Interfaces tasks
    └── README.md
```

### Services backend (déjà implémentés ✅)

- `GET /api/plugins` - Liste des plugins
- `GET /api/plugins/:name` - Détails d'un plugin
- `POST /api/plugins/:name/execute` - Exécution synchrone
- `POST /api/tasks` - Créer une tâche asynchrone
- `GET /api/tasks/:id` - Statut d'une tâche
- `GET /api/tasks` - Liste des tâches

### Communication Frontend ↔ Backend

```typescript
// Service plugins
class PluginsService {
  async listPlugins(filters?: PluginFilters): Promise<Plugin[]>
  async getPlugin(name: string): Promise<PluginDetails>
  async executePlugin(name: string, inputs: PluginInputs): Promise<PluginResult>
  async discoverPlugins(): Promise<void>
}

// Service tasks
class TasksService {
  async createTask(pluginName: string, inputs: PluginInputs): Promise<Task>
  async getTaskStatus(taskId: string): Promise<TaskStatus>
  async listTasks(filters?: TaskFilters): Promise<Task[]>
  async cancelTask(taskId: string): Promise<void>
}
```

---

## 📝 Checklist d'implémentation

### Étape 1 : Créer l'extension de base
- [ ] Créer le package `theia-extensions/plugins`
- [ ] Configurer le module Theia
- [ ] Créer les interfaces TypeScript (protocol)
- [ ] Implémenter les services de communication avec l'API

### Étape 2 : Widget Plugins Browser
- [ ] Créer le composant React de liste
- [ ] Implémenter le fetch des plugins au démarrage
- [ ] Ajouter les filtres (source, catégorie, enabled)
- [ ] Icônes et badges selon les propriétés
- [ ] Action "Rafraîchir" (appel à `/discover`)

### Étape 3 : Widget Plugin Executor
- [ ] Intégrer dans GeocacheDetailsWidget
- [ ] Générer le formulaire dynamique depuis le schéma
- [ ] Pré-remplir avec les données de la géocache
- [ ] Implémenter l'exécution synchrone
- [ ] Gestion des erreurs et feedback utilisateur

### Étape 4 : Widget Plugin Results
- [ ] Affichage structuré des résultats
- [ ] Actions (copier, appliquer, exporter)
- [ ] Historique local des exécutions
- [ ] Lien vers la géocache d'origine

### Étape 5 : Tasks Monitor
- [ ] Liste des tâches avec statut
- [ ] Polling ou WebSocket pour mise à jour en temps réel
- [ ] Annulation de tâches
- [ ] Notifications système
- [ ] Nettoyage des anciennes tâches

### Étape 6 : Intégration complète
- [ ] Keybindings pour ouvrir rapidement les widgets
- [ ] Menu contextuel sur géocache : "Analyser avec plugins"
- [ ] Drag & drop de géocache vers le plugin executor
- [ ] Tests end-to-end de l'intégration

---

## 🎨 Design & UX

### Principes de design
- **Consistance** : Utiliser le même style que les widgets existants (Zones, Geocaches)
- **Feedback** : Toujours indiquer l'état (loading, success, error)
- **Performance** : Lazy loading, virtualisation des listes longues
- **Accessibilité** : Keyboard navigation, ARIA labels

### Mockup des widgets

#### Plugins Browser
```
┌─────────────────────────────────────┐
│ 🔌 Plugins                     [↻]  │
├─────────────────────────────────────┤
│ Filtres: [Tous] [Official] [Custom] │
│ Catégories: [Substitution ▾]        │
├─────────────────────────────────────┤
│ ✅ Caesar (v1.0.0)              🏅   │
│    Chiffrement par décalage          │
│                                      │
│ ✅ ROT13 (v1.0.0)               🏅   │
│    Rotation de 13 caractères         │
│                                      │
│ ⚪ Atbash (v1.0.0)              👤   │
│    Substitution inversée             │
└─────────────────────────────────────┘
```

#### Plugin Executor
```
┌─────────────────────────────────────┐
│ 🎯 Exécuter un plugin               │
├─────────────────────────────────────┤
│ Géocache: GC1234 - Mystery Cache    │
│ Plugin: [Caesar ▾]                   │
├─────────────────────────────────────┤
│ Texte: [N 48° 51.400 E 002° 21.050] │
│ Mode:  ⦿ Encoder  ○ Décoder          │
│ Shift: [13_____________________]     │
├─────────────────────────────────────┤
│        [Exécuter] [Async ⏱]          │
└─────────────────────────────────────┘
```

#### Plugin Results
```
┌─────────────────────────────────────┐
│ ✅ Résultat : Caesar                │
├─────────────────────────────────────┤
│ Status: ✓ OK (42ms)                 │
│                                      │
│ Texte encodé:                        │
│ A 48° 51.400 R 002° 21.050          │
│                          [Copier]    │
│                                      │
│ Métadonnées:                         │
│ • Shift appliqué: 13                 │
│ • Caractères traités: 26             │
├─────────────────────────────────────┤
│ [Appliquer] [Exporter JSON]          │
└─────────────────────────────────────┘
```

---

## 🧪 Tests à créer

### Tests unitaires (Jest)
- Services de communication API
- Parsing des schémas de plugins
- Génération de formulaires dynamiques
- Formatage des résultats

### Tests d'intégration
- Workflow complet : sélection géocache → exécution plugin → résultat
- Communication avec le backend réel
- Gestion des erreurs réseau

### Tests E2E (Playwright)
- Ouvrir le Plugins Browser
- Exécuter un plugin sur une géocache
- Vérifier l'affichage du résultat
- Suivre une tâche asynchrone

---

## 📊 Estimations

| Étape                        | Difficulté | Temps estimé |
|------------------------------|------------|--------------|
| 1. Extension de base         | Moyenne    | 2-3h         |
| 2. Plugins Browser           | Moyenne    | 3-4h         |
| 3. Plugin Executor           | Élevée     | 5-6h         |
| 4. Plugin Results            | Moyenne    | 2-3h         |
| 5. Tasks Monitor             | Élevée     | 4-5h         |
| 6. Intégration               | Moyenne    | 3-4h         |
| **TOTAL**                    |            | **19-25h**   |

---

## 🚀 Prochaines étapes

1. **Valider** le plan avec vous
2. **Commencer** par l'étape 1 : créer l'extension de base
3. **Itérer** étape par étape en validant chaque fonctionnalité

---

## 📚 Ressources

- [Theia Extension Development](https://theia-ide.org/docs/extensions/)
- [React dans Theia](https://github.com/eclipse-theia/theia/tree/master/examples)
- API Backend : http://localhost:5000/api/plugins (déjà opérationnelle ✅)

