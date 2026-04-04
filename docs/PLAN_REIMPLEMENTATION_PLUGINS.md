# Plan de Réimplémentation du Système de Plugins

**Projet** : MysterAI - Système de plugins de cryptographie/décodage pour géocaching  
**Architecture** : Flask (gc-backend) + Theia (frontend)  
**Date création** : 2025-11-02

## 📋 Table des matières
- [Vue d'ensemble](#vue-densemble)
- [Architecture cible](#architecture-cible)
- [Phase 1 - Fondations Backend](#phase-1---fondations-backend)
- [Phase 2 - Endpoints REST](#phase-2---endpoints-rest)
- [Phase 3 - Extension Theia](#phase-3---extension-theia)
- [Phase 4 - Métaplugins](#phase-4---métaplugins)
- [Phase 5 - Services avancés](#phase-5---services-avancés)
- [Phase 6 - IA & Tools](#phase-6---ia--tools)
- [Critères de succès globaux](#critères-de-succès-globaux)

---

## Vue d'ensemble

### Objectif
Réimplanter le système de plugins de chiffrement/déchiffrement dans l'architecture gc-backend (Flask) + Theia, avec exécution non bloquante, interface dynamique, métaplugins, et intégration IA.

### Principes directeurs
1. **Découpage maximal** : fichiers courts, modules indépendants
2. **Documentation systématique** : docstrings, README, commentaires
3. **Exécution asynchrone** : TaskManager pour tâches longues
4. **Contrat strict** : validation JSON Schema des plugins
5. **Évolutivité** : support plugins officiels et customs

### Ancien système analysé
- **Localisation** : `ancien_code_plugins/`
- **Composants clés** :
  - `plugin_manager.py` : découverte, chargement, exécution
  - `models/plugin_model.py` : modèle SQLAlchemy
  - `plugins/official/` : plugins exemple (bacon_code, fox_code, formula_parser)
  - `templates/` : interfaces HTML dynamiques

---

## Architecture cible

### Backend (Flask - gc-backend)
```
gc-backend/
├── gc_backend/
│   ├── plugins/
│   │   ├── __init__.py
│   │   ├── plugin_manager.py        # Découverte, chargement, cache
│   │   ├── wrappers.py               # PythonPluginWrapper, BinaryPluginWrapper
│   │   ├── models.py                 # Plugin model SQLAlchemy
│   │   └── schemas/
│   │       └── plugin.schema.json    # JSON Schema validation
│   ├── services/
│   │   ├── task_manager.py           # ThreadPoolExecutor, progression
│   │   ├── scoring_service.py        # Scoring existant/adapté
│   │   └── coordinates_service.py    # Détection coords (existant)
│   ├── blueprints/
│   │   └── plugins.py                # Routes /api/plugins/*
│   └── templates/
│       └── plugins/                  # Interfaces HTML générées
├── plugins/
│   ├── official/                     # Plugins officiels (lecture seule)
│   │   ├── bacon_code/
│   │   ├── caesar/
│   │   └── ...
│   └── custom/                       # Plugins utilisateur
└── schemas/
    └── plugin_output.schema.json     # Contrat de sortie
```

### Frontend (Theia extension)
```
theia-blueprint/theia-extensions/
└── crypto-plugins/
    ├── src/
    │   ├── browser/
    │   │   ├── crypto-plugins-contribution.ts
    │   │   ├── views/
    │   │   │   ├── plugins-list-widget.tsx      # Liste plugins
    │   │   │   ├── plugin-interface-widget.tsx   # Interface d'exécution
    │   │   │   └── plugin-results-widget.tsx     # Affichage résultats
    │   │   └── services/
    │   │       ├── plugin-api-service.ts         # Appels REST
    │   │       └── task-polling-service.ts       # Polling tasks
    │   └── common/
    │       └── protocol.ts                       # Types/interfaces
    └── package.json
```

---

## Phase 1 - Fondations Backend

**Objectif** : Structure de base + découverte + validation

### 1.1 - Structure et modèles (1-2h)

#### Fichiers à créer
- `gc-backend/gc_backend/plugins/__init__.py`
- `gc-backend/gc_backend/plugins/models.py`
- `gc-backend/gc_backend/plugins/schemas/plugin.schema.json`

#### Modèle Plugin (SQLAlchemy)
```python
class Plugin(db.Model):
    __tablename__ = 'plugins'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), unique=True, nullable=False)
    version = db.Column(db.String(32))
    plugin_api_version = db.Column(db.String(16))  # Ex: "2.0"
    description = db.Column(db.Text)
    author = db.Column(db.String(128))
    plugin_type = db.Column(db.String(32))  # python, rust, binary, wasm
    source = db.Column(db.String(16))  # official, custom
    path = db.Column(db.String(512), nullable=False)
    entry_point = db.Column(db.String(256))
    categories = db.Column(db.JSON)  # ["Substitution", "Transposition"]
    input_types = db.Column(db.JSON)
    heavy_cpu = db.Column(db.Boolean, default=False)
    needs_network = db.Column(db.Boolean, default=False)
    enabled = db.Column(db.Boolean, default=True)
    metadata_json = db.Column(db.Text)  # plugin.json complet
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)
```

#### JSON Schema validation
Créer `plugin.schema.json` pour valider les `plugin.json` :
- Champs obligatoires : name, version, plugin_api_version, entry_point
- Validation des types input_types
- Validation des catégories

**Critère de succès** : Migration DB + modèle testé

---

### 1.2 - PluginManager - Découverte (2-3h)

#### Fichier `plugin_manager.py`
Méthodes :
- `discover_plugins()` : scan `plugins/official/` et `plugins/custom/`
- `_validate_plugin_json(data)` : validation JSON Schema
- `_update_plugin_in_db(plugin_info)` : upsert en DB

#### Logique de découverte
1. Scanner récursivement les dossiers
2. Charger `plugin.json`
3. Valider contre le schéma
4. Calculer hash/mtime pour détecter les changements
5. Upsert en DB avec `source` (official/custom)
6. Supprimer les plugins qui n'existent plus

**Critère de succès** : `pytest` sur découverte + base remplie correctement

---

### 1.3 - Wrappers de plugins (2h)

#### Fichier `wrappers.py`
Classes :
- `PluginInterface` (ABC)
- `PythonPluginWrapper` : import dynamique + initialisation
- `BinaryPluginWrapper` : subprocess + JSON I/O
- (Futur : `RustPluginWrapper`, `WasmPluginWrapper`)

Reprendre la logique de l'ancien `PythonPluginWrapper` mais :
- Chargement lazy (au premier execute)
- Déchargement propre (cleanup)
- Timeout configurable

**Critère de succès** : Charger 1 plugin Python + l'exécuter

---

### 1.4 - PluginManager - Chargement & exécution (2h)

Méthodes :
- `get_plugin(name, force_reload=False)` : chargement lazy
- `execute_plugin(plugin_name, inputs)` : exécution synchrone
- `_normalize_output(result)` : normalisation vers format standard

Format de sortie standardisé (à respecter strictement) :
```json
{
  "status": "ok|error",
  "summary": "Message résumé",
  "results": [
    {
      "id": "result_1",
      "text_output": "Texte décodé",
      "confidence": 0.85,
      "scoring": { "score": 0.85, "..." },
      "coordinates": {
        "exist": true,
        "decimal": {"lat": 49.123, "lon": 2.456},
        "raw": ["N 49° 07.380 E 002° 27.360"]
      },
      "parameters": {"mode": "decode"}
    }
  ],
  "plugin_info": {
    "name": "caesar",
    "version": "1.0.0",
    "execution_time_ms": 42
  }
}
```

**Critère de succès** : Exécution d'un plugin + sortie normalisée

---

## Phase 2 - Endpoints REST

**Objectif** : API REST complète pour Theia

### 2.1 - Blueprint plugins (2h)

#### Fichier `gc_backend/blueprints/plugins.py`

Routes à implémenter :

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/plugins` | Liste tous les plugins |
| GET | `/api/plugins/<name>` | Détails d'un plugin |
| GET | `/api/plugins/<name>/interface` | HTML de l'interface |
| POST | `/api/plugins/<name>/execute` | Exécution synchrone |
| POST | `/api/plugins/discover` | Relance découverte |

#### GET /api/plugins
Retour :
```json
{
  "plugins": [
    {
      "name": "caesar",
      "version": "1.0.0",
      "plugin_api_version": "2.0",
      "categories": ["Substitution"],
      "source": "official",
      "heavy_cpu": false,
      "enabled": true
    }
  ]
}
```

Filtres query params :
- `?category=Substitution`
- `?source=official|custom`
- `?enabled=true|false`

#### GET /api/plugins/<name>/interface
Génération HTML dynamique depuis `input_types` du `plugin.json`.
Template Jinja2 réutilisable avec :
- Formulaire auto-généré
- Support tous les types : string, number, select, checkbox
- Styling Tailwind
- Boutons : Execute, Execute (async), Stop

**Critère de succès** : Tous les endpoints testés (manuel ou pytest)

---

### 2.2 - TaskManager - Exécution asynchrone (3-4h)

#### Fichier `gc_backend/services/task_manager.py`

Classe `TaskManager` :
```python
class TaskManager:
    def __init__(self, max_workers=4):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.tasks: Dict[str, TaskInfo] = {}
        
    def submit_task(self, task_id, plugin_name, inputs, callback=None):
        # Soumet tâche au ThreadPool
        # Stocke TaskInfo (status, progress, result)
        
    def get_task_status(self, task_id):
        # Retourne état actuel
        
    def cancel_task(self, task_id):
        # Annulation douce (flag is_cancelled)
        
    def cleanup_old_tasks(self, max_age_seconds=3600):
        # Nettoie les tâches terminées anciennes
```

#### Classe TaskInfo
```python
@dataclass
class TaskInfo:
    task_id: str
    plugin_name: str
    status: str  # queued, running, done, error, cancelled
    progress: float  # 0-100
    message: str
    result: Optional[Dict]
    error: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
```

#### Routes async
- `POST /api/tasks` : crée task, retourne `{task_id}`
- `GET /api/tasks/<task_id>` : status
- `POST /api/tasks/<task_id>/cancel` : annulation

**Critère de succès** : Tâche longue (bruteforce) exécutée sans bloquer + annulation OK

---

### 2.3 - WebSocket pour progression (optionnel, 2h)

Si déjà un `ws_service`, émettre événements :
- `TASK_STARTED` : `{task_id, plugin_name}`
- `TASK_PROGRESS` : `{task_id, progress, message}`
- `TASK_COMPLETED` : `{task_id, result}`
- `TASK_ERROR` : `{task_id, error}`

Sinon, utiliser polling pour MVP.

**Critère de succès** : Client Theia reçoit progression en temps réel

---

## Phase 3 - Extension Theia

**Objectif** : Interface utilisateur complète dans Theia

### 3.1 - Squelette extension (2h)

Créer extension :
```bash
cd theia-blueprint/theia-extensions
yo @theia/extension crypto-plugins
```

Structure :
- Contribution view container "Crypto Plugins"
- Vue latérale avec liste des plugins
- Commandes : `crypto-plugins.open`, `crypto-plugins.refresh`

**Critère de succès** : Extension chargée, vue visible

---

### 3.2 - Vue liste des plugins (3h)

#### Widget `PluginsListWidget`
Composant React/Preact affichant :
- Liste des plugins depuis `GET /api/plugins`
- Filtre par catégorie
- Recherche par nom
- Badges : source (official/custom), heavy_cpu
- Actions par plugin :
  - Bouton "Open" → ouvre interface
  - Bouton "Info" → détails
  - Toggle enable/disable (futur)

#### Service `PluginApiService`
Appels HTTP vers gc-backend :
```typescript
@injectable()
export class PluginApiService {
  async listPlugins(filters?: PluginFilters): Promise<Plugin[]>
  async getPlugin(name: string): Promise<Plugin>
  async getPluginInterface(name: string): Promise<string>
  async executePlugin(name: string, inputs: any): Promise<PluginResult>
}
```

**Critère de succès** : Liste chargée, filtres fonctionnels

---

### 3.3 - Widget interface plugin (4-5h)

#### Widget `PluginInterfaceWidget`
- Requête `GET /api/plugins/<name>/interface`
- Injection HTML dans le widget
- Gestion formulaire :
  - Sérialisation inputs
  - POST vers `/execute` (sync) ou `/tasks` (async)
- Affichage progression (barre + message)
- Bouton Stop → cancel task

#### Isolation CSS
Option 1 : injection directe (rapide, risque conflits)
Option 2 : iframe (isolation, plus complexe)

**Recommandation** : Commencer injection directe, migrer iframe si conflits.

**Critère de succès** : Formulaire affiché, exécution OK, résultat visible

---

### 3.4 - Widget résultats (3h)

#### Composant `PluginResultsWidget`
Affichage du résultat structuré :

1. **Résumé global**
   - Status (succès/erreur)
   - Message summary
   - Temps d'exécution

2. **Liste des résultats** (tri par confidence desc)
   - Meilleur résultat mis en avant (bordure bleue)
   - Badge confidence avec couleur :
     - Vert ≥ 80%
     - Jaune ≥ 50%
     - Orange ≥ 30%
     - Rouge < 30%
   - Texte output
   - Paramètres utilisés
   - Métadonnées

3. **Coordonnées GPS** (si présentes)
   - Affichage format DDM
   - Bouton "Centrer sur carte" → événement vers OpenLayers
   - Action "Sauvegarder comme waypoint"

4. **Actions**
   - Copier résultat
   - Copier coordonnées
   - Export JSON
   - Afficher JSON brut (toggle)

**Critère de succès** : Résultats lisibles, clic coord → carte centrée

---

### 3.5 - Intégration carte OpenLayers (2h)

Émettre événement Theia pour centrer carte :
```typescript
@injectable()
export class MapIntegrationService {
  centerOnCoordinates(lat: number, lon: number, zoom?: number)
  addWaypoint(coords: Coordinates, label: string)
}
```

**Critère de succès** : Coordonnées détectées → carte centrée automatiquement

---

## Phase 4 - Métaplugins

**Objectif** : Exécution parallèle de plusieurs plugins avec agrégation

### 4.1 - Endpoint métaplugin (3h)

#### Route `POST /api/metaplugins/run`
Payload :
```json
{
  "category": "Substitution",
  "inputs": {"text": "KHOOR", "mode": "decode"},
  "strategy": "top-k",
  "k": 3,
  "filters": {
    "source": "official",
    "exclude": ["plugin_name_to_skip"]
  }
}
```

Logique :
1. Sélectionner plugins de la catégorie
2. Lancer en parallèle via TaskManager (sous-tâches)
3. Agréger résultats :
   - **top-k** : garder top k par confidence
   - **aggregate-mean** : moyenne des scores
   - **best-of** : meilleur résultat unique
4. Dédupliquer résultats similaires

Retour :
```json
{
  "status": "ok",
  "summary": "3 plugins exécutés",
  "meta": {
    "strategy": "top-k",
    "k": 3,
    "plugins_used": ["caesar", "atbash", "rot13"]
  },
  "results": [...],
  "plugin_info": {
    "execution_time_ms": 234
  }
}
```

**Critère de succès** : Métaplugin exécute 3+ plugins en parallèle, résultats agrégés cohérents

---

### 4.2 - Vue métaplugin Theia (2h)

Widget `MetapluginWidget` :
- Sélection catégorie
- Sélection stratégie (top-k, best-of, aggregate)
- Input k (pour top-k)
- Formulaire inputs commun
- Lancement → affichage progression globale
- Résultats avec indication plugin d'origine

**Critère de succès** : UI métaplugin fluide, résultats multi-sources

---

## Phase 5 - Services avancés

### 5.1 - CoordinatesService (1-2h)

Centraliser détection coords :
- Extraction multi-formats (DD, DDM, DMS, UTM)
- Normalisation vers format standard
- Calcul confidence par pattern

Intégrer dans `PluginManager.execute_plugin()` pour normaliser automatiquement `results[].coordinates`.

**Critère de succès** : Tous formats détectés, normalisés dans résultats

---

### 5.2 - ScoringService (2-3h)

Si pas déjà présent, créer service de scoring :
- Scoring lexical (fréquence mots, Zipf)
- Détection langue
- Bonus GPS (si coords présentes)
- Bonus proximité zone cache (configurable)

Scorers empilables :
```python
class ScoringService:
    def __init__(self):
        self.scorers = [
            LexicalScorer(),
            GPSScorer(),
            ProximityScorer(cache_coords, radius_km)
        ]
    
    def score_text(self, text, context=None):
        # Agrégation scores
```

**Critère de succès** : Résultats mieux classés, bonus proximité appliqué

---

## Phase 6 - IA & Tools

### 6.1 - Tools REST pour agents (2h)

Endpoints adaptés IA :
- `GET /api/ai/plugins/list` : liste simplifiée
- `POST /api/ai/plugins/execute` : exécution avec idempotency key

Headers :
- `Idempotency-Key` : UUID pour éviter doubles exécutions
- `X-Run-ID` : identifiant de session IA

Logs structurés JSON :
```json
{
  "timestamp": "...",
  "run_id": "...",
  "plugin": "caesar",
  "task_id": "...",
  "duration_ms": 42,
  "status": "ok"
}
```

**Critère de succès** : Agent externe liste/exécute plugins, logs traçables

---

### 6.2 - MCP (optionnel, 3h)

Si besoin d'actions IDE :
- `mcp_tool.open_plugin_panel(name)`
- `mcp_tool.center_map(coords)`
- `mcp_tool.create_waypoint(coords, label)`

**Critère de succès** : Agent peut manipuler l'UI Theia

---

## Phase 7 - Migration plugins existants (variable)

### 7.1 - Adaptation format
Migrer plugins de `ancien_code_plugins/plugins/official/` :
1. Copier vers `gc-backend/plugins/official/`
2. Mettre à jour `plugin.json` :
   - Ajouter `plugin_api_version: "2.0"`
   - Ajouter `heavy_cpu` si bruteforce
3. Adapter sortie vers format standardisé
4. Tester exécution + validation

### 7.2 - Liste plugins à migrer
- bacon_code
- fox_code
- formula_parser
- (autres plugins existants)

**Critère de succès** : 5+ plugins migrés et fonctionnels

---

## Phase 8 - Qualité & Sécurité

### 8.1 - Tests (3-4h)
- Tests unitaires : `PluginManager`, `TaskManager`
- Tests d'intégration : endpoints API
- Tests E2E : Theia → backend
- Fixtures : inputs/outputs "golden"

### 8.2 - Sandbox & gouvernance (2-3h)
- Policies par plugin (heavy_cpu, needs_network)
- Safe mode : désactive customs
- Whitelist/blacklist catégories
- Timeouts configurables

### 8.3 - Documentation (2h)
- README principal
- Guide développeur plugin
- API documentation (Swagger/OpenAPI)
- Exemples d'utilisation

---

## Phase 9 - DX & Observabilité

### 9.1 - CLI manage_plugins (2h)
```bash
python manage_plugins.py discover
python manage_plugins.py validate --plugin bacon_code
python manage_plugins.py run --plugin caesar --inputs test.json
python manage_plugins.py bench
```

### 9.2 - Historique exécutions (2h)
Widget Theia "Execution History" :
- Table : timestamp, plugin, status, duration
- Filtres : plugin, date, status
- Export CSV/JSON
- Re-run avec mêmes inputs

---

## Critères de succès globaux

### Performance
- ✅ Boot backend < 2s
- ✅ Chargement liste plugins < 500ms
- ✅ Exécution plugin court < 1s
- ✅ Métaplugin (3 plugins) < 3s
- ✅ UI jamais gelée (tâches longues async)

### Fonctionnel
- ✅ 5+ plugins officiels fonctionnels
- ✅ Ajout plugin custom sans restart
- ✅ Métaplugin top-k opérationnel
- ✅ Coords détectées → carte centrée
- ✅ Annulation tâches longues

### Qualité
- ✅ 80%+ couverture tests backend
- ✅ Documentation complète
- ✅ Pas de warnings ESLint/Pylint
- ✅ Logs structurés traçables

---

## Ordre d'exécution recommandé

### Sprint 1 (1 semaine)
- Phase 1 : Fondations backend
- Phase 2.1-2.2 : Endpoints + TaskManager

### Sprint 2 (1 semaine)
- Phase 3.1-3.3 : Extension Theia + interface

### Sprint 3 (1 semaine)
- Phase 3.4-3.5 : Résultats + carte
- Phase 5 : Services avancés

### Sprint 4 (1 semaine)
- Phase 4 : Métaplugins
- Phase 7 : Migration plugins

### Sprint 5 (1 semaine)
- Phase 6 : IA Tools
- Phase 8-9 : Qualité + observabilité

---

## Fichiers à créer - Checklist

### Backend
- [ ] `gc_backend/plugins/__init__.py`
- [ ] `gc_backend/plugins/models.py`
- [ ] `gc_backend/plugins/plugin_manager.py`
- [ ] `gc_backend/plugins/wrappers.py`
- [ ] `gc_backend/plugins/schemas/plugin.schema.json`
- [ ] `gc_backend/services/task_manager.py`
- [ ] `gc_backend/blueprints/plugins.py`
- [ ] `gc_backend/templates/plugins/interface_base.html`
- [ ] `schemas/plugin_output.schema.json`
- [ ] `plugins/official/` (migration)
- [ ] `plugins/custom/` (vide initialement)
- [ ] `manage_plugins.py` (CLI)
- [ ] `tests/test_plugin_manager.py`
- [ ] `tests/test_task_manager.py`
- [ ] `docs/PLUGIN_DEVELOPMENT.md`

### Frontend
- [ ] `theia-extensions/crypto-plugins/`
- [ ] `crypto-plugins/src/browser/crypto-plugins-contribution.ts`
- [ ] `crypto-plugins/src/browser/views/plugins-list-widget.tsx`
- [ ] `crypto-plugins/src/browser/views/plugin-interface-widget.tsx`
- [ ] `crypto-plugins/src/browser/views/plugin-results-widget.tsx`
- [ ] `crypto-plugins/src/browser/views/metaplugin-widget.tsx`
- [ ] `crypto-plugins/src/browser/services/plugin-api-service.ts`
- [ ] `crypto-plugins/src/browser/services/task-polling-service.ts`
- [ ] `crypto-plugins/src/common/protocol.ts`
- [ ] `crypto-plugins/package.json`

---

**Prochaine étape** : Commencer Phase 1.1 - Création structure et modèles
