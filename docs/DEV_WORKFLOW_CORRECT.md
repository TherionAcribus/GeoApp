# Workflow de développement correct pour Theia

## ❌ Problème identifié

Le **watcher TypeScript seul ne suffit pas** pour voir les changements dans l'application Theia.

### Pourquoi ?

```
Extension TypeScript (.tsx)
  ↓ yarn watch (compile)
Extension JavaScript (.js) dans theia-extensions/plugins/lib/
  ↓ ⚠️ PAS UTILISÉ DIRECTEMENT PAR L'APP
Application Theia bundle (Webpack)
  ↓ yarn build (bundle)
Bundle final dans applications/browser/lib/
  ↓ ✅ UTILISÉ PAR LE NAVIGATEUR
```

**Le navigateur charge le bundle Webpack**, pas les fichiers individuels de l'extension.

---

## ✅ Solution : Deux options

### Option 1 : Build complet (lent mais sûr)

**À chaque modification** :

```powershell
# 1. Build l'extension (si pas de watcher)
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn build

# 2. Build l'application (obligatoire)
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn build

# 3. Restart le serveur
yarn start
```

**Temps total : ~60-90 secondes**

---

### Option 2 : Watch de l'application (plus rapide)

**Terminal 1 : Watch de l'extension**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn watch
```

**Terminal 2 : Watch de l'application Theia**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn watch
```

**Terminal 3 : Serveur Theia**
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn start
```

**Workflow** :
1. Modifier un fichier `.tsx`
2. Attendre 2-5s (les deux watchers compilent)
3. Recharger le navigateur (`Ctrl + R`)

**Temps : ~5 secondes**

---

## 🚀 Option recommandée : Watch application

C'est la meilleure option pour le développement actif.

### Mise en place

**1. Arrêter le serveur actuel** (`Ctrl + C` dans le terminal)

**2. Lancer les 3 terminaux** :

**Terminal 1 - Extension watch** :
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn watch
```

**Terminal 2 - App watch** :
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn watch
```

**Terminal 3 - Serveur** :
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn start
```

**3. Développer** :
- Modifier `plugins-browser-widget.tsx`
- Voir les logs de compilation dans Terminal 1 et 2
- Recharger le navigateur

---

## 📊 Comparaison des options

| Méthode | Temps par changement | Ressources CPU | Recommandé |
|---------|---------------------|----------------|------------|
| Build complet | 60-90s | Faible | ❌ Trop lent |
| Watch extension seul | ∞ (ne marche pas) | Faible | ❌ Inutile |
| Watch extension + app | 5s | Élevé | ✅ Optimal |
| Build extension + build app | 30-40s | Moyen | ⚠️ Acceptable |

---

## 🎯 Workflow actuel à suivre

**Vous avez actuellement** :
- ✅ Terminal 1 : Extension watch (actif)
- ⏳ Build de l'app en cours (ID 824)

**Après le build (dans ~1 minute)** :

1. **Restart le serveur** :
   ```powershell
   cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
   yarn start
   ```

2. **Ouvrir l'app dans le navigateur**

3. **Tester** :
   - Ouvrir le panneau Plugins (gauche)
   - Vérifier le label : "Catégorieeeeee:"
   - Cliquer sur "Caesar"
   - Vérifier que le Plugin Executor s'ouvre

---

## 🔍 Vérification que ça marche

### Test 1 : Label modifié
- Panneau Plugins → Filtres
- Doit afficher "Catégorieeeeee:" (avec les "e")

### Test 2 : Clic sur plugin
- Panneau Plugins → Clic sur "Caesar"
- Le Plugin Executor doit s'ouvrir
- Caesar doit être pré-sélectionné
- Message : "Pas de géocache associée - Exécution libre"

### Test 3 : Console logs
- F12 → Console
- Clic sur Caesar
- Doit afficher : `Opening plugin executor for: caesar`

---

## 💡 Pour la suite

**Si vous voulez le hot reload automatique** (sans `Ctrl + R`) :

Il faudrait configurer Webpack avec Hot Module Replacement (HMR), mais c'est complexe pour Theia.

**Recommandation** : Garder le workflow avec `Ctrl + R`, c'est rapide et fiable.

---

## 🐛 Debugging

### Le label ne change pas
- ✅ Vérifier que le watcher extension compile
- ✅ Vérifier que le watcher app compile (si actif)
- ✅ Rebuild l'app : `yarn build`
- ✅ Restart le serveur
- ✅ Hard refresh : `Ctrl + Shift + R`

### Le clic ne marche pas
- ✅ Vérifier les logs console (F12)
- ✅ Vérifier que `PluginExecutorContribution` est bien injecté
- ✅ Rebuild complet
- ✅ Vérifier les erreurs dans la console

### Erreur "command already registered"
- ⚠️ Normal au reload, ignorez

---

## 📝 Résumé

**Pour voir vos changements** :

```
Modifier .tsx
  ↓
yarn watch (extension) → compile en 2s
  ↓
yarn build (app) → bundle en 30s
  ↓
yarn start → restart serveur
  ↓
Recharger navigateur
  ↓
✅ Changements visibles !
```

**OU avec watch app** :

```
Modifier .tsx
  ↓
yarn watch (extension) → 2s
  ↓
yarn watch (app) → 3s
  ↓
Recharger navigateur (Ctrl + R)
  ↓
✅ Changements visibles !
```

---

## 🎉 Prochaine étape

**Attendez que le build se termine** (ID 824, ~1 minute)

Puis :
1. Restart le serveur
2. Testez le clic sur Caesar
3. Ça devrait marcher ! 🚀
