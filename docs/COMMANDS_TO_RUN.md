# Commandes à Exécuter - Tests du Système

**Instructions étape par étape pour tester le système**

---

## 🔧 1. Résoudre le problème de dépendances

Le problème : pytest utilise Python 3.10, mais les dépendances sont installées dans Python 3.14.

**Solution** : Installer dans le virtualenv existant

```powershell
cd c:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend

# Activer le virtualenv
.venv\Scripts\activate

# Vérifier que pip fonctionne
python -m pip --version

# Si pip ne fonctionne pas, le réinstaller
python -m ensurepip --upgrade

# Installer les dépendances
python -m pip install loguru jsonschema pytest pytest-flask

# Vérifier l'installation
python -m pip list | findstr "loguru jsonschema pytest"
```

---

## 🗄️ 2. Migration de la base de données

```powershell
# Toujours dans gc-backend avec virtualenv activé

# Vérifier que Flask fonctionne
flask --version

# Exécuter la migration
flask db upgrade

# Si erreur "No such command 'db'", vérifier que Flask-Migrate est installé
python -m pip install Flask-Migrate
```

---

## 🧪 3. Lancer les tests

### Tests Phase 1 - Backend

```powershell
# Test modèle Plugin (devrait être rapide)
pytest tests/test_plugin_model.py -v

# Test PluginManager
pytest tests/test_plugin_manager.py -v

# Test Wrappers
pytest tests/test_wrappers.py -v

# Test intégration
pytest tests/test_plugin_integration.py -v
```

### Tests Phase 2 - API REST

```powershell
# Test API Plugins
pytest tests/test_plugins_api.py -v

# Test TaskManager
pytest tests/test_task_manager.py -v

# Test API Tasks
pytest tests/test_tasks_api.py -v
```

### Tous les tests d'un coup

```powershell
# Lancer TOUS les tests (115+)
pytest tests/ -v

# Avec un rapport HTML (optionnel)
pytest tests/ -v --html=report.html --self-contained-html
```

**Résultat attendu** :
```
========== test session starts ==========
collected 115 items

tests/test_plugin_model.py ............           [10%]
tests/test_plugin_manager.py .........................  [33%]
...
========== 115 passed in 15.34s ==========
```

---

## 🚀 4. Tester l'API en live

### Démarrer l'application

```powershell
# Dans un premier terminal
cd c:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
.venv\Scripts\activate
flask run
```

**Logs attendus** :
```
* Running on http://127.0.0.1:5000
INFO - PluginManager initialisé
INFO - Découverte terminée: 1 plugins trouvés
INFO - Plugin caesar initialisé avec succès
```

### Tester les endpoints (dans un second terminal)

#### Lister les plugins
```powershell
curl http://localhost:5000/api/plugins
```

#### Détails Caesar
```powershell
curl http://localhost:5000/api/plugins/caesar
```

#### Exécuter Caesar (synchrone)
```powershell
curl -X POST http://localhost:5000/api/plugins/caesar/execute `
  -H "Content-Type: application/json" `
  -d '{\"inputs\": {\"text\": \"HELLO\", \"mode\": \"encode\", \"shift\": 13}}'
```

**Attendu** : `{"status": "ok", "results": [{"text_output": "URYYB", ...}]}`

#### Créer une tâche asynchrone
```powershell
curl -X POST http://localhost:5000/api/tasks `
  -H "Content-Type: application/json" `
  -d '{\"plugin_name\": \"caesar\", \"inputs\": {\"text\": \"HELLO\", \"mode\": \"decode\", \"brute_force\": true}}'
```

**Copier le task_id reçu !**

#### Vérifier le statut de la tâche
```powershell
# Remplacer TASK_ID par le vrai ID
curl http://localhost:5000/api/tasks/TASK_ID
```

#### Statistiques
```powershell
curl http://localhost:5000/api/tasks/statistics
```

---

## ✅ Checklist de Validation

Une fois tous les tests passés, cochez :

- [ ] Dépendances installées (loguru, jsonschema, pytest)
- [ ] Migration DB exécutée sans erreur
- [ ] Tests unitaires modèle Plugin : PASS
- [ ] Tests PluginManager : PASS  
- [ ] Tests Wrappers : PASS
- [ ] Tests intégration : PASS
- [ ] Tests API plugins : PASS
- [ ] Tests TaskManager : PASS
- [ ] Tests API tasks : PASS
- [ ] Application démarre sans erreur
- [ ] Plugin Caesar découvert
- [ ] GET /api/plugins retourne Caesar
- [ ] POST /api/plugins/caesar/execute fonctionne
- [ ] POST /api/tasks fonctionne
- [ ] Progression des tâches visible

---

## 🐛 En cas de problème

### Erreur : ModuleNotFoundError

```powershell
# Réinstaller les dépendances
python -m pip install loguru jsonschema pytest pytest-flask
```

### Erreur : Table 'plugins' doesn't exist

```powershell
# Exécuter la migration
flask db upgrade
```

### Erreur : Port 5000 already in use

```powershell
# Utiliser un autre port
flask run --port 5001
```

### Tests échouent : Plugin Caesar non trouvé

```powershell
# Vérifier que le dossier existe
dir plugins\official\caesar\

# Doit contenir : plugin.json, main.py, README.md
```

### L'application ne démarre pas

```powershell
# Mode debug pour voir les erreurs
flask run --debug
```

---

## 📊 Résultats attendus

### Si TOUT fonctionne

✅ **115 tests PASS**  
✅ **Application démarre**  
✅ **Plugin Caesar exécutable**  
✅ **API complète fonctionnelle**  
✅ **Tâches asynchrones OK**  

🎉 **SYSTÈME PRÊT POUR PRODUCTION !**

---

## ⏭️ Prochaine étape

Une fois tous les tests validés :
➡️ **Phase 3 - Extension Theia** pour créer l'interface graphique ! 🎨

---

**Bon courage !** 💪
