# Phase 2.2 - TaskManager (Exécution Asynchrone) ✅

**Date** : 2025-11-02  
**Statut** : Terminé  
**Durée** : ~2h

---

## 📦 Fichiers créés

1. **`gc_backend/services/task_manager.py`** (~450 lignes)
   - Classe `TaskManager` avec ThreadPoolExecutor
   - Classe `TaskInfo` (dataclass complète)
   - Enum `TaskStatus` (5 états)
   - Gestion progression et annulation
   - Nettoyage automatique en thread daemon
   - Statistiques complètes

2. **`gc_backend/services/__init__.py`**
   - Exports des classes principales

3. **`gc_backend/blueprints/tasks.py`** (~350 lignes)
   - Blueprint complet avec 6 routes
   - Gestion erreurs robuste
   - Documentation intégrée

4. **`tests/test_task_manager.py`** (~400 lignes)
   - Tests unitaires TaskManager
   - Tests exécution, annulation, cleanup
   - 20+ tests

5. **`tests/test_tasks_api.py`** (~350 lignes)
   - Tests API complète
   - Tests workflow asynchrone
   - 15+ tests

6. **`gc_backend/__init__.py`** (mis à jour)
   - Intégration TaskManager (4 workers)
   - Enregistrement blueprint tasks

---

## ✅ Fonctionnalités implémentées

### TaskManager

- [x] ThreadPoolExecutor avec workers configurables
- [x] Soumission de tâches asynchrones
- [x] Suivi progression (0-100%)
- [x] Annulation douce (cancel_requested flag)
- [x] Gestion états (queued, running, completed, failed, cancelled)
- [x] Listage avec filtres (statut, plugin)
- [x] Statistiques complètes
- [x] Nettoyage automatique (thread daemon, toutes les 5 min)
- [x] Thread-safe (Lock pour accès concurrents)
- [x] Shutdown propre

### API REST (6 routes)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/api/tasks` | Crée une tâche asynchrone |
| GET | `/api/tasks/<task_id>` | Statut d'une tâche |
| POST | `/api/tasks/<task_id>/cancel` | Annule une tâche |
| GET | `/api/tasks` | Liste toutes les tâches (avec filtres) |
| GET | `/api/tasks/statistics` | Statistiques globales |
| POST | `/api/tasks/cleanup` | Nettoie les vieilles tâches |

---

## 📖 Documentation des routes

### POST /api/tasks

Crée et démarre une tâche asynchrone.

**Body JSON** :
```json
{
  "plugin_name": "caesar",
  "inputs": {
    "text": "HELLO",
    "mode": "decode",
    "brute_force": true
  }
}
```

**Réponse (201)** :
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "message": "Tâche créée et soumise pour exécution"
}
```

---

### GET /api/tasks/<task_id>

Récupère le statut d'une tâche.

**Exemple** :
```bash
GET /api/tasks/550e8400-e29b-41d4-a716-446655440000
```

**Réponse (200)** :
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "plugin_name": "caesar",
  "status": "running",
  "progress": 45.5,
  "message": "Exécution du plugin...",
  "result": null,
  "error": null,
  "created_at": "2025-11-02T08:50:00.123456",
  "started_at": "2025-11-02T08:50:00.234567",
  "finished_at": null,
  "duration_ms": 1234.56,
  "cancel_requested": false
}
```

**États possibles** :
- `queued` : En attente dans la queue
- `running` : En cours d'exécution
- `completed` : Terminée avec succès (result disponible)
- `failed` : Échouée (error disponible)
- `cancelled` : Annulée par l'utilisateur

---

### POST /api/tasks/<task_id>/cancel

Demande l'annulation d'une tâche.

**Annulation douce** : Le plugin doit vérifier périodiquement `cancel_requested` et s'arrêter proprement.

**Exemple** :
```bash
POST /api/tasks/550e8400-e29b-41d4-a716-446655440000/cancel
```

**Réponse (200)** :
```json
{
  "success": true,
  "message": "Annulation demandée pour la tâche ..."
}
```

**Réponse (400)** - Tâche déjà terminée :
```json
{
  "success": false,
  "message": "Impossible d'annuler la tâche ... (déjà terminée ou inexistante)"
}
```

---

### GET /api/tasks

Liste toutes les tâches avec filtres optionnels.

**Query Parameters** :
- `status` : Filtrer par statut (queued, running, completed, failed, cancelled)
- `plugin_name` : Filtrer par nom de plugin

**Exemples** :
```bash
GET /api/tasks
GET /api/tasks?status=running
GET /api/tasks?plugin_name=caesar
GET /api/tasks?status=completed&plugin_name=caesar
```

**Réponse (200)** :
```json
{
  "tasks": [
    {
      "task_id": "...",
      "plugin_name": "caesar",
      "status": "completed",
      ...
    }
  ],
  "total": 42,
  "filters": {
    "status": "completed",
    "plugin_name": null
  }
}
```

---

### GET /api/tasks/statistics

Récupère les statistiques globales.

**Exemple** :
```bash
GET /api/tasks/statistics
```

**Réponse (200)** :
```json
{
  "total": 150,
  "queued": 5,
  "running": 2,
  "completed": 120,
  "failed": 8,
  "cancelled": 15,
  "max_workers": 4,
  "active_workers": 7
}
```

---

### POST /api/tasks/cleanup

Nettoie les tâches terminées anciennes.

**Body JSON (optionnel)** :
```json
{
  "max_age_seconds": 1800
}
```

**Défaut** : 3600 secondes (1 heure)

**Réponse (200)** :
```json
{
  "message": "15 tâche(s) nettoyée(s)",
  "tasks_before": 100,
  "tasks_after": 85,
  "max_age_seconds": 1800
}
```

---

## 🎯 Workflow asynchrone complet

### Exemple avec curl

```bash
# 1. Créer une tâche (bruteforce Caesar)
TASK_RESPONSE=$(curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "plugin_name": "caesar",
    "inputs": {
      "text": "URYYB",
      "mode": "decode",
      "brute_force": true
    }
  }')

TASK_ID=$(echo $TASK_RESPONSE | jq -r '.task_id')
echo "Task created: $TASK_ID"

# 2. Polling du statut (boucle)
while true; do
  STATUS=$(curl -s http://localhost:5000/api/tasks/$TASK_ID | jq -r '.status')
  PROGRESS=$(curl -s http://localhost:5000/api/tasks/$TASK_ID | jq -r '.progress')
  
  echo "Status: $STATUS - Progress: $PROGRESS%"
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    break
  fi
  
  sleep 1
done

# 3. Récupérer le résultat
curl -s http://localhost:5000/api/tasks/$TASK_ID | jq '.result'
```

---

## 🏗️ Architecture TaskManager

### Composants

```
TaskManager
├── ThreadPoolExecutor (4 workers)
├── Dict[task_id, TaskInfo] (stockage tâches)
├── Lock (thread-safety)
└── Cleanup Thread (daemon, toutes les 5 min)

TaskInfo
├── task_id (UUID)
├── plugin_name
├── inputs
├── status (TaskStatus enum)
├── progress (0-100)
├── message
├── result (dict or None)
├── error (str or None)
├── timestamps (created, started, finished)
├── future (Future)
└── cancel_requested (bool)
```

### Flux d'exécution

```
1. Client: POST /api/tasks
   └─> TaskManager.submit_task()
       ├─> Créer TaskInfo (status=queued)
       ├─> Soumettre au ThreadPoolExecutor
       └─> Retourner task_id

2. Worker Thread:
   └─> _execute_task()
       ├─> Marquer status=running
       ├─> Vérifier cancel_requested
       ├─> PluginManager.execute_plugin()
       ├─> Mettre à jour progress
       └─> Marquer status=completed/failed

3. Client: GET /api/tasks/<task_id>
   └─> TaskManager.get_task_status()
       └─> Retourner TaskInfo.to_dict()

4. Client (optionnel): POST /api/tasks/<task_id>/cancel
   └─> TaskManager.cancel_task()
       └─> Marquer cancel_requested=True

5. Cleanup Thread (toutes les 5 min):
   └─> cleanup_old_tasks()
       └─> Supprimer tâches terminées > 1h
```

---

## 🧪 Tests (35+ tests)

### test_task_manager.py (20 tests)

**Basics** :
- ✅ Création TaskManager
- ✅ Soumission tâche
- ✅ Récupération statut
- ✅ Exécution réussie
- ✅ Tâche inexistante

**Annulation** :
- ✅ Annuler tâche en queue
- ✅ Annuler tâche terminée (échec attendu)
- ✅ Annuler tâche inexistante

**Listage** :
- ✅ Liste toutes tâches
- ✅ Filtre par statut
- ✅ Filtre par plugin_name

**Statistiques** :
- ✅ Récupération stats complètes
- ✅ Taille queue

**Cleanup** :
- ✅ Nettoyage vieilles tâches
- ✅ Préservation tâches actives

---

### test_tasks_api.py (15 tests)

**Création** :
- ✅ Création réussie
- ✅ plugin_name manquant
- ✅ inputs manquants
- ✅ JSON invalide

**Statut** :
- ✅ Récupération réussie
- ✅ Tâche inexistante
- ✅ Statut completed

**Annulation** :
- ✅ Annulation réussie
- ✅ Annulation tâche terminée

**Listage** :
- ✅ Liste toutes
- ✅ Filtre par statut
- ✅ Statut invalide

**Statistiques & Cleanup** :
- ✅ Récupération stats
- ✅ Nettoyage

**Intégration** :
- ✅ Workflow complet asynchrone

---

## 💡 Cas d'usage

### Exécution bruteforce Caesar

Le bruteforce teste 25 décalages. En synchrone, cela bloquerait l'UI.
En asynchrone, l'utilisateur peut suivre la progression et annuler si besoin.

```javascript
// Frontend (pseudo-code)
async function executeBruteforce(text) {
  // 1. Créer la tâche
  const response = await fetch('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      plugin_name: 'caesar',
      inputs: { text, mode: 'decode', brute_force: true }
    })
  });
  
  const { task_id } = await response.json();
  
  // 2. Polling du statut
  const pollInterval = setInterval(async () => {
    const status = await fetch(`/api/tasks/${task_id}`).then(r => r.json());
    
    // Mettre à jour UI
    updateProgress(status.progress);
    updateMessage(status.message);
    
    // Si terminé
    if (status.status === 'completed') {
      clearInterval(pollInterval);
      displayResults(status.result);
    }
    
    // Si erreur
    if (status.status === 'failed') {
      clearInterval(pollInterval);
      displayError(status.error);
    }
  }, 500); // Poll toutes les 500ms
  
  // 3. Bouton annuler
  cancelButton.onclick = async () => {
    await fetch(`/api/tasks/${task_id}/cancel`, { method: 'POST' });
    clearInterval(pollInterval);
  };
}
```

---

## 🔧 Configuration

### Nombre de workers

Par défaut : **4 workers**

Modifier dans `gc_backend/__init__.py` :
```python
task_manager = TaskManager(max_workers=8)  # 8 workers
```

**Recommandations** :
- CPU-bound : `max_workers = nombre_cores`
- I/O-bound : `max_workers = nombre_cores * 2-4`

### Nettoyage automatique

- **Fréquence** : Toutes les 5 minutes (300s)
- **Age maximum** : 1 heure (3600s)

Modifier dans `task_manager.py` :
```python
# Ligne 388 : Fréquence
time.sleep(600)  # 10 minutes

# Ligne 394 : Age maximum
self.cleanup_old_tasks(max_age_seconds=7200)  # 2 heures
```

---

## 📊 Statistiques

- **TaskManager** : ~450 lignes
- **Blueprint tasks** : ~350 lignes
- **Tests** : ~750 lignes
- **Total** : ~1550 lignes

---

## ✅ Critères de succès Phase 2.2

- [x] TaskManager avec ThreadPoolExecutor
- [x] Soumission tâches asynchrones
- [x] Suivi progression (0-100%)
- [x] Annulation douce
- [x] 6 routes API complètes
- [x] Tests exhaustifs (35+ tests)
- [x] Nettoyage automatique
- [x] Thread-safe
- [x] Statistiques complètes
- [x] Documentation complète

---

## 🎊 Phase 2 COMPLÈTE !

Avec Phase 2.1 + 2.2, nous avons maintenant :

### API REST complète (15 routes)

**Plugins** (9 routes) :
- Liste, infos, interface, exécution sync
- Discover, status, reload

**Tasks** (6 routes) :
- Création, statut, annulation
- Liste, statistiques, cleanup

### Fonctionnalités

- ✅ Exécution synchrone (plugins rapides)
- ✅ Exécution asynchrone (plugins longs)
- ✅ Progression temps réel
- ✅ Annulation
- ✅ Gestion erreurs complète
- ✅ Nettoyage automatique

### Tests

- **Phase 2.1** : 20+ tests
- **Phase 2.2** : 35+ tests
- **Total Phase 2** : 55+ tests

---

## ⏭️ Prochaine étape : Phase 3

**Extension Theia** pour l'interface utilisateur !

Nous avons maintenant un backend complet et robuste.
Il est temps de créer l'interface dans Theia pour exploiter toute cette puissance ! 🚀
