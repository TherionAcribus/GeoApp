# 🔌 MysterAI Plugins Extension

Extension Theia pour la gestion et l'exécution de plugins d'analyse de géocaches.

## 📦 Fonctionnalités

### Implémentées
- ✅ Services de communication avec l'API backend
- ✅ Interfaces TypeScript pour plugins et tâches
- ✅ Module d'injection de dépendances

### À venir
- 🚧 Widget Plugins Browser (liste des plugins)
- 🚧 Widget Plugin Executor (exécution de plugins)
- 🚧 Widget Plugin Results (affichage des résultats)
- 🚧 Widget Tasks Monitor (suivi des tâches asynchrones)

## 🏗️ Structure

```
plugins/
├── package.json                    # Configuration npm
├── tsconfig.json                   # Configuration TypeScript
├── src/
│   ├── browser/
│   │   ├── plugins-frontend-module.ts     # Module principal
│   │   └── services/
│   │       ├── plugins-service.ts         # API plugins
│   │       └── tasks-service.ts           # API tasks
│   └── common/
│       ├── plugin-protocol.ts             # Interfaces plugins
│       └── task-protocol.ts               # Interfaces tasks
└── README.md
```

## 🚀 Installation

### 1. Installer les dépendances

```bash
cd theia-extensions/plugins
yarn install
```

### 2. Compiler l'extension

```bash
yarn build
```

### 3. Lier l'extension au projet Theia

Dans le répertoire racine de votre application Theia :

```bash
# Ajouter l'extension au package.json
yarn add @mysterai/theia-plugins@file:./theia-extensions/plugins
```

### 4. Rebuild l'application Theia

```bash
yarn theia rebuild
```

## 🔧 Développement

### Mode watch

```bash
yarn watch
```

Les modifications seront automatiquement recompilées.

### Linter / Formatter

```bash
# Vérifier le code
yarn lint

# Formatter le code
yarn format
```

## 📡 Communication avec le backend

L'extension communique avec le backend Flask via l'API REST :

### Endpoints plugins
- `GET /api/plugins` - Liste des plugins
- `GET /api/plugins/:name` - Détails d'un plugin
- `POST /api/plugins/:name/execute` - Exécution synchrone
- `GET /api/plugins/status` - Statut des plugins
- `POST /api/plugins/discover` - Redécouvrir les plugins

### Endpoints tasks
- `POST /api/tasks` - Créer une tâche
- `GET /api/tasks/:id` - Statut d'une tâche
- `GET /api/tasks` - Liste des tâches
- `POST /api/tasks/:id/cancel` - Annuler une tâche
- `GET /api/tasks/statistics` - Statistiques

## 🧪 Tests

```bash
# Lancer les tests unitaires
yarn test

# Avec coverage
yarn test:coverage
```

## 📝 Configuration

### URL du backend

Par défaut, l'extension se connecte à `http://localhost:5000`.

Pour changer l'URL, modifier dans les fichiers de service :
- `src/browser/services/plugins-service.ts`
- `src/browser/services/tasks-service.ts`

TODO: Rendre configurable via les préférences Theia.

## 🔄 Prochaines étapes

1. **Étape 2** : Créer le widget Plugins Browser
2. **Étape 3** : Créer le widget Plugin Executor
3. **Étape 4** : Créer le widget Plugin Results
4. **Étape 5** : Créer le widget Tasks Monitor
5. **Étape 6** : Intégration complète avec GeocacheDetailsWidget

## 📚 Ressources

- [Theia Extension Development](https://theia-ide.org/docs/extensions/)
- [API Backend MysterAI](http://localhost:5000/api/plugins)
- [Documentation Phases 1 & 2](../../RECAP_FINAL_SESSION.md)

## 📄 Licence

MIT
