# Guide de Tests - Système de Plugins MysterAI

**Date** : 2025-11-02

---

## 🎯 Objectif

Tester le système complet :
- Phase 1 : Fondations Backend (PluginManager, Wrappers, Plugin Caesar)
- Phase 2 : API REST (Routes plugins + tasks)

---

## 📋 Prérequis

### 1. Installer les dépendances

```bash
cd gc-backend
.venv\Scripts\activate  # Sur Windows
# ou
source .venv/bin/activate  # Sur Linux/Mac

pip install loguru jsonschema pytest pytest-flask
```

### 2. Vérifier la base de données

```bash
# Si vous n'avez pas encore de DB ou besoin de reset
flask db upgrade
```

---

## 🧪 Tests Unitaires

### Tests Phase 1 - Backend

```bash
# Tests du modèle Plugin
pytest tests/test_plugin_model.py -v

# Tests du PluginManager
pytest tests/test_plugin_manager.py -v

# Tests des Wrappers
pytest tests/test_wrappers.py -v

# Tests d'intégration
pytest tests/test_plugin_integration.py -v
```

### Tests Phase 2 - API REST

```bash
# Tests API Plugins
pytest tests/test_plugins_api.py -v

# Tests TaskManager
pytest tests/test_task_manager.py -v

# Tests API Tasks
pytest tests/test_tasks_api.py -v
```

### Tous les tests

```bash
# Lancer TOUS les tests
pytest tests/ -v

# Avec coverage
pytest tests/ -v --cov=gc_backend --cov-report=html

# Tests rapides (sans les tests lents)
pytest tests/ -v -m "not slow"
```

---

## 🚀 Tests Fonctionnels (API Live)

### 1. Démarrer l'application

```bash
cd gc-backend
flask run
```

L'application devrait :
- ✅ Démarrer sur http://127.0.0.1:5000
- ✅ Découvrir automatiquement les plugins
- ✅ Logger les plugins trouvés

**Logs attendus** :
```
INFO - PluginManager initialisé avec répertoire: ...
INFO - Découverte terminée: 1 plugins trouvés
INFO - Plugin caesar initialisé avec succès
```

### 2. Tester l'API Plugins

#### Liste des plugins
```bash
curl http://localhost:5000/api/plugins
```

**Attendu** : Liste avec plugin Caesar

#### Infos du plugin Caesar

curl http://localhost:5000/api/plugins/caesar
```

**Attendu** : Détails complets du plugin

#### Interface HTML du plugin
```bash
curl http://localhost:5000/api/plugins/caesar/interface
```

**Attendu** : HTML complet avec formulaire

#### Exécuter Caesar (synchrone)
```bash
curl -X POST http://localhost:5000/api/plugins/caesar/execute \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "text": "HELLO",
      "mode": "encode",
      "shift": 13
    }
  }'
```

**Attendu** :
```json
{
  "status": "ok",
  "results": [
    {
      "text_output": "URYYB",
      ...
    }
  ],
  ...
}
```

#### Statut des plugins
```bash
curl http://localhost:5000/api/plugins/status
```

**Attendu** : Liste avec statut loaded, enabled, etc.

### 3. Tester l'API Tasks (Asynchrone)

#### Créer une tâche
```bash
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "plugin_name": "caesar",
    "inputs": {
      "text": "HELLO",
      "mode": "decode",
      "brute_force": true
    }
  }'
```

**Attendu** :
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "message": "Tâche créée..."
}
```

**Copier le task_id !**

#### Récupérer le statut de la tâche
```bash
# Remplacer TASK_ID par le task_id reçu
curl http://localhost:5000/api/tasks/TASK_ID
```

**Attendu** :
```json
{
  "task_id": "...",
  "status": "running",  // ou "completed"
  "progress": 45.5,
  "result": null  // ou le résultat si completed
}
```

#### Lister toutes les tâches
```bash
curl http://localhost:5000/api/tasks
```

#### Statistiques
```bash
curl http://localhost:5000/api/tasks/statistics
```

**Attendu** :
```json
{
  "total": 1,
  "queued": 0,
  "running": 0,
  "completed": 1,
  "max_workers": 4
}
```

---

## ✅ Checklist de Tests

### Backend (Phase 1)

- [ ] Migration DB exécutée sans erreur
- [ ] Plugin Caesar découvert au démarrage
- [ ] Tests unitaires modèle Plugin : PASS
- [ ] Tests unitaires PluginManager : PASS
- [ ] Tests unitaires Wrappers : PASS
- [ ] Tests intégration : PASS
- [ ] Plugin Caesar exécutable (encode/decode)
- [ ] Mode bruteforce fonctionnel (25 résultats)

### API REST (Phase 2)

- [ ] GET /api/plugins : retourne liste
- [ ] GET /api/plugins/caesar : retourne détails
- [ ] GET /api/plugins/caesar/interface : retourne HTML
- [ ] POST /api/plugins/caesar/execute : exécution OK
- [ ] GET /api/plugins/status : retourne statuts
- [ ] POST /api/tasks : crée tâche et retourne task_id
- [ ] GET /api/tasks/<id> : retourne statut
- [ ] GET /api/tasks : liste tâches
- [ ] GET /api/tasks/statistics : retourne stats
- [ ] Tests API plugins : PASS
- [ ] Tests TaskManager : PASS
- [ ] Tests API tasks : PASS

---

## 🐛 Troubleshooting

### Erreur : ModuleNotFoundError

```bash
pip install loguru jsonschema pytest pytest-flask
```

### Erreur : Table 'plugins' doesn't exist

```bash
flask db upgrade
```

### Erreur : Port 5000 déjà utilisé

```bash
# Utiliser un autre port
flask run --port 5001
```

### Tests échouent : Plugin Caesar non trouvé

Vérifier que le dossier existe :
```bash
ls gc-backend/plugins/official/caesar/
```

Doit contenir : `plugin.json`, `main.py`, `README.md`

### L'app ne démarre pas

Vérifier les logs :
```bash
flask run --debug
```

---

## 📊 Résultats Attendus

### Tests Unitaires

```
========== test session starts ==========
collected 115 items

tests/test_plugin_model.py ............           [10%]
tests/test_plugin_manager.py .........................  [33%]
tests/test_wrappers.py ...............             [46%]
tests/test_plugin_integration.py ..........        [55%]
tests/test_plugins_api.py ....................      [73%]
tests/test_task_manager.py ....................     [91%]
tests/test_tasks_api.py ...............            [100%]

========== 115 passed in 15.34s ==========
```

### API Live

Tous les endpoints doivent répondre avec status 200 (ou 201 pour POST /api/tasks).

---

## 🎉 Succès !

Si tous les tests passent :
- ✅ **Backend complet et fonctionnel**
- ✅ **API REST opérationnelle**
- ✅ **Plugin Caesar exécutable**
- ✅ **Système asynchrone fonctionnel**

**Système prêt pour Phase 3 (Extension Theia) !** 🚀
