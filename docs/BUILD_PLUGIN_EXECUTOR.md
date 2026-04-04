# Commandes pour builder et tester le Plugin Executor

## 🚀 Build rapide

Copiez et exécutez ces commandes dans PowerShell :

### 1. Rebuild du plugin MysterAI
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn run clean
yarn run build
```

### 2. Rebuild de l'app Theia
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn clean
yarn build
yarn start
```

---

## ✅ Vérifications après démarrage

### Dans la console navigateur (F12)

Cherchez ces logs :
```
[MYSTERAI] Loading plugins-frontend-module...
[MYSTERAI] Registering services and contributions...
MysterAI Plugins Extension started
```

### Test du widget Plugin Executor

1. **Ouvrir via Command Palette** :
   - Appuyez sur `Ctrl+Shift+P`
   - Tapez "Plugins: Exécuter un plugin"
   - Le widget s'ouvre dans la zone principale

2. **Test sans contexte** :
   - Vous devriez voir : "Aucune géocache sélectionnée"
   - C'est normal ! Le widget attend un contexte de géocache

3. **Test avec contexte (via console navigateur)** :
   ```javascript
   // Récupérer la contribution
   const contribution = window.theia.container.get(require('@mysterai/theia-plugins/lib/browser/plugins-contribution').PluginExecutorContribution);
   
   // Créer un contexte de test
   const testContext = {
       gcCode: 'GC1234',
       name: 'Test Mystery Cache',
       coordinates: {
           latitude: 48.8566,
           longitude: 2.3522,
           coordinatesRaw: 'N 48° 51.400 E 002° 21.050'
       },
       hint: 'Look for the hidden container'
   };
   
   // Ouvrir avec contexte
   contribution.openWithContext(testContext);
   ```

4. **Test d'exécution** :
   - Sélectionner un plugin (ex: "caesar")
   - Les coordonnées devraient être pré-remplies dans le champ "text"
   - Ajuster les paramètres (ex: shift = 13)
   - Cliquer "Exécuter"
   - Vérifier que le résultat s'affiche

---

## 🔧 Si le backend n'est pas démarré

```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
python app.py
```

Le backend devrait être accessible sur http://localhost:5000

---

## 🐛 Dépannage rapide

### Le widget ne s'affiche pas

```powershell
# Vérifier que le build a réussi
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
ls lib\browser\plugin-executor-widget.js
ls lib\browser\style\plugin-executor.css

# Si les fichiers sont absents, recompiler
yarn run clean
yarn run build
```

### Erreur "Cannot find module"

```powershell
# Rebuild complet
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint
yarn build:extensions

cd applications\browser
yarn clean
yarn build
```

### Le formulaire ne se remplit pas

Vérifier dans la console navigateur :
- Erreurs réseau (le backend répond-il ?)
- Schéma du plugin (a-t-il des propriétés valides ?)

---

## 📝 Logs utiles

### Backend (Flask)

```
* Running on http://127.0.0.1:5000
GET /api/plugins - 200
GET /api/plugins/caesar - 200
POST /api/plugins/caesar/execute - 200
```

### Frontend (Console navigateur)

```
[MYSTERAI] Loading plugins-frontend-module...
[MYSTERAI] Registering services and contributions...
MysterAI Plugins Extension started
Fetching plugins from API...
Plugin 'caesar' loaded successfully
```

---

## 🎯 Prochaine étape

Après validation du Plugin Executor, vous pourrez :

1. **Intégrer dans GeocacheDetailsWidget** :
   - Suivre le guide `PLUGIN_EXECUTOR_INTEGRATION.md`
   - Ajouter le bouton "Analyser avec plugins"

2. **Tester le workflow complet** :
   - Ouvrir une vraie géocache depuis l'extension zones
   - Cliquer sur "Analyser avec plugins"
   - Exécuter un plugin réel
   - Vérifier le résultat

3. **Améliorer l'UX** :
   - Ajouter des actions sur les résultats
   - Implémenter le Tasks Monitor
   - Ajouter l'historique des exécutions
