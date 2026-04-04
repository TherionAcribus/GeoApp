# Mode développement avec watchers

## 🚀 Développement rapide sans rebuild manuel

### Option 1 : Watch complet (recommandé)

**Terminal 1 : Watch de l'extension plugins**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn watch
```

**Terminal 2 : Watch de l'extension zones (si modifications)**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\zones
yarn watch
```

**Terminal 3 : Watch de l'application Theia**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn watch
```

**Terminal 4 : Server Theia**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn start
```

**Terminal 5 : Backend Flask**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
python app.py
```

---

### Option 2 : Watch extension uniquement (plus rapide)

Si vous modifiez seulement l'extension plugins, pas besoin de watcher l'app :

**Terminal 1 : Watch extension plugins**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn watch
```

**Terminal 2 : Server Theia**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn start
```

**Terminal 3 : Backend Flask**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
python app.py
```

**Recharger dans le navigateur** : `Ctrl + R` ou `F5`

---

## 🔄 Workflow de développement

1. **Démarrer les watchers** (terminaux 1-3)
2. **Démarrer Theia** (terminal 4)
3. **Faire vos modifications** dans les fichiers `.ts` ou `.tsx`
4. **Le watcher compile automatiquement** (vous verrez les logs)
5. **Recharger le navigateur** (`Ctrl + R`)
6. **Tester** vos modifications

---

## 📝 Commandes rapides

### Build complet (si besoin de repartir à zéro)
```powershell
# Extension plugins
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn run clean && yarn run build

# App Theia
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn build
```

### Arrêter les watchers
`Ctrl + C` dans chaque terminal

---

## ⚠️ Limitations

### Ce qui est surveillé automatiquement :
- ✅ Fichiers `.ts` et `.tsx`
- ✅ Changements de logique
- ✅ Nouveaux composants

### Ce qui nécessite un rebuild manuel :
- ❌ Modifications de `package.json`
- ❌ Ajout de nouvelles dépendances
- ❌ Changements dans les fichiers de configuration
- ❌ Fichiers CSS (sauf si copiés manuellement)

Pour les CSS, le watcher de l'extension plugins inclut déjà la copie automatique :
```json
"watch": "tsc -w"
```

**Note** : Les fichiers CSS sont copiés lors du build, pas en mode watch. Si vous modifiez un CSS, faites :
```powershell
cd theia-extensions/plugins
yarn run copy:assets
```

Puis rechargez le navigateur.

---

## 🎯 Avantages du mode watch

- ⚡ **10-20x plus rapide** : compilation en 1-2s au lieu de 30-60s
- 🔄 **Feedback immédiat** : voir les erreurs de compilation instantanément
- 🧪 **Itération rapide** : modifier → recharger → tester en quelques secondes
- 💻 **Multi-tâches** : continuer à coder pendant la compilation

---

## 🐛 En cas de problème

### Le watcher ne détecte pas les changements
1. Arrêter le watcher (`Ctrl + C`)
2. Nettoyer : `yarn run clean`
3. Rebuild : `yarn run build`
4. Relancer le watcher : `yarn watch`

### Erreurs de compilation persistantes
1. Arrêter tous les watchers
2. Build complet :
   ```powershell
   cd theia-blueprint
   yarn build:extensions
   cd applications/browser
   yarn build
   ```
3. Relancer les watchers

### Le navigateur ne reflète pas les changements
1. Hard refresh : `Ctrl + Shift + R` ou `Ctrl + F5`
2. Vider le cache : F12 → Network → Disable cache
3. Redémarrer le serveur Theia

---

## 📚 Scripts disponibles

### Extension plugins
```json
{
  "build": "tsc && yarn run copy:assets",
  "watch": "tsc -w",
  "clean": "rimraf lib",
  "copy:assets": "node -e \"require('fs-extra').copySync('src/browser/style', 'lib/browser/style')\""
}
```

### Extension zones
```json
{
  "build": "tsc -b",
  "watch": "tsc -w",
  "clean": "rimraf lib *.tsbuildinfo"
}
```

### Application Theia
Le watch de l'app Theia recompile le bundle Webpack automatiquement.

---

## 💡 Conseils

1. **Gardez les watchers ouverts** pendant toute votre session de développement
2. **Utilisez des terminaux séparés** pour chaque watcher (plus facile à suivre)
3. **Nommez vos terminaux** dans VS Code pour ne pas les confondre
4. **Surveillez les logs** pour détecter les erreurs de compilation
5. **Rechargez le navigateur** après chaque modification

---

## 🎉 Résultat

**Avant** : Modifier → Build (60s) → Restart (30s) → Tester = **90 secondes**

**Après** : Modifier → Watch compile (2s) → Reload (1s) → Tester = **3 secondes**

**Gain de temps : 30x plus rapide ! 🚀**
