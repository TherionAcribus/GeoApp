# Test des nouveaux plugins Bacon Code et Fox Code

## 🎯 Étapes de test

### 1. Démarrer le backend Flask

```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
python app.py
```

Le backend devrait démarrer sur `http://localhost:8000`

---

### 2. Vérifier que les plugins sont chargés

**Dans les logs du backend**, vous devriez voir :
```
INFO - Chargement des plugins depuis: .../plugins
INFO - Plugin chargé: caesar v1.0.0
INFO - Plugin chargé: bacon_code v1.0.0
INFO - Plugin chargé: fox_code v1.1.0
INFO - 3 plugins chargés avec succès
```

---

### 3. Tester via l'interface Theia

**Option A : Depuis le panneau Plugins**

1. Ouvrir l'application Theia dans le navigateur
2. Cliquer sur l'icône "Plugins" dans la barre de gauche
3. Vérifier que 3 plugins apparaissent :
   - Caesar
   - Bacon Code ← NOUVEAU
   - Fox Code ← NOUVEAU

4. Cliquer sur "Bacon Code"
5. Le Plugin Executor doit s'ouvrir avec :
   - Bacon Code pré-sélectionné
   - Formulaire avec tous les champs :
     - Texte à traiter
     - Mode (encode/decode/detect)
     - Alphabet (26/24 lettres)
     - Symbole pour A
     - Symbole pour B
     - Détection automatique (checkbox)

6. Tester l'encodage :
   - Texte : `HELLO`
   - Mode : `encode`
   - Alphabet : `26 lettres`
   - Cliquer "Exécuter"
   - Résultat attendu : `AABBB AABAA ABABB ABABB ABBBA`

7. Tester le décodage :
   - Texte : `AABBB AABAA ABABB ABABB ABBBA`
   - Mode : `decode`
   - Cliquer "Exécuter"
   - Résultat attendu : `HELLO`

**Option B : Depuis une géocache**

1. Ouvrir une géocache Mystery
2. Cliquer "🔌 Analyser avec plugins"
3. Sélectionner "Bacon Code" ou "Fox Code"
4. Le texte de la description est pré-rempli
5. Modifier les paramètres si nécessaire
6. Cliquer "Exécuter"
7. Voir les résultats

---

### 4. Tests spécifiques Bacon Code

#### Test 1 : Encodage basique
```
Entrée : HELLO
Mode : encode
Variante : 26 lettres
Résultat attendu : AABBB AABAA ABABB ABABB ABBBA
```

#### Test 2 : Décodage basique
```
Entrée : AABBB AABAA ABABB ABABB ABBBA
Mode : decode
Résultat attendu : HELLO
```

#### Test 3 : Symboles personnalisés
```
Entrée : 01110 01000 10100 10100 10110
Mode : decode
Symbole A : 0
Symbole B : 1
Résultat attendu : HELLO
```

#### Test 4 : Auto-détection
```
Entrée : xyxxx yxxxx xyxyx xyxyx xyxxy
Mode : decode
Auto-détection : activée
Résultat attendu : HELLO (détecte x=A, y=B)
```

#### Test 5 : Variante 24 lettres
```
Entrée : JAVA
Mode : encode
Variante : 24 lettres
Résultat attendu : ABAAA AAAAA BAABB AAAAA
(J et I ont le même code en 24 lettres)
```

---

### 5. Tests spécifiques Fox Code

#### Test 1 : Encodage variante longue
```
Entrée : HELLO
Mode : encode
Variante : longue
Résultat attendu : 18 15 22 22 25
```

#### Test 2 : Décodage variante longue
```
Entrée : 18 15 22 22 25
Mode : decode
Variante : longue
Résultat attendu : HELLO
```

#### Test 3 : Encodage variante courte
```
Entrée : HELLO
Mode : encode
Variante : courte
Résultat attendu : 8 5 3 3 6
```

#### Test 4 : Décodage variante courte (ambiguë)
```
Entrée : 1 2 3
Mode : decode
Variante : courte
Résultats possibles :
- AJK (ligne 1 pour chaque)
- AJS (ligne 1, 1, 3)
- AKS (ligne 1, 2, 3)
- BJK (ligne 2, 1, 1)
- etc.
```

#### Test 5 : Auto-détection
```
Entrée : 18 15 22 22 25
Mode : decode
Variante : auto
Résultat attendu : HELLO (détecte variante longue)
```

---

### 6. Vérifications visuelles

#### Dans le panneau Plugins

✅ **Bacon Code** doit afficher :
- Nom : "bacon_code"
- Version : "1.0.0"
- Description : "Plugin de chiffrement et déchiffrement utilisant le chiffre Bacon..."
- Catégories : Substitution, Bacon, Binary
- Icône : 🔌 (par défaut)

✅ **Fox Code** doit afficher :
- Nom : "fox_code"
- Version : "1.1.0"
- Description : "Encodage et décodage du Fox Code..."
- Catégories : Substitution, Numbers, Grid
- Icône : 🔌 (par défaut)

#### Dans le Plugin Executor

✅ **Formulaire Bacon Code** :
- Champ texte : grande zone de texte
- Dropdown Mode : encode, decode, detect
- Dropdown Alphabet : 26 lettres, 24 lettres
- Input Symbole A : texte court
- Input Symbole B : texte court
- Checkbox Auto-détection : cochée par défaut

✅ **Formulaire Fox Code** :
- Champ texte : grande zone de texte
- Dropdown Mode : encode, decode
- Dropdown Variante : auto, courte, longue

#### Affichage des résultats

✅ **Format attendu** :
```
Status: ✓ OK

Résultat 1:
  Texte: HELLO
  Confiance: 80%
  Paramètres:
    - mode: decode
    - variant: 26
    - symbol_a: A
    - symbol_b: B
```

---

### 7. Tests d'erreur

#### Bacon Code - Symboles identiques
```
Entrée : HELLO
Symbole A : X
Symbole B : X
Résultat attendu : Erreur "Les symboles A et B doivent être distincts"
```

#### Fox Code - Mode invalide
```
Entrée : HELLO
Mode : bruteforce
Résultat attendu : Erreur "Mode 'bruteforce' non pris en charge"
```

---

### 8. Tests de performance

#### Bacon Code
```
Texte : 1000 caractères
Mode : encode
Temps attendu : < 100ms
```

#### Fox Code
```
Texte : 100 chiffres
Mode : decode (variante courte)
Temps attendu : < 500ms
Résultats : max 20 possibilités
```

---

## 🐛 Problèmes potentiels

### Plugin non trouvé
**Symptôme** : "Plugin bacon_code non disponible"

**Solutions** :
1. Vérifier que le dossier `plugins/official/bacon_code/` existe
2. Vérifier que `plugin.json` est valide (JSON bien formé)
3. Restart le backend Flask
4. Vérifier les logs du backend

### Formulaire ne s'affiche pas
**Symptôme** : Pas de champs dans le Plugin Executor

**Solutions** :
1. Vérifier que `input_types` est bien défini dans `plugin.json`
2. Rebuild l'app Theia : `cd applications/browser && yarn build`
3. Hard refresh du navigateur : `Ctrl + Shift + R`

### Erreur d'exécution
**Symptôme** : Status "error" dans les résultats

**Solutions** :
1. Vérifier les logs du backend (F12 → Network → Réponse)
2. Vérifier que les inputs sont au bon format
3. Tester directement le plugin en Python

---

## ✅ Checklist complète

### Backend
- [ ] Backend Flask démarré
- [ ] 3 plugins chargés (caesar, bacon_code, fox_code)
- [ ] Pas d'erreur dans les logs

### Interface Theia
- [ ] App Theia démarrée
- [ ] Panneau Plugins accessible
- [ ] 3 plugins visibles dans la liste
- [ ] Clic sur Bacon Code ouvre le Plugin Executor
- [ ] Clic sur Fox Code ouvre le Plugin Executor

### Bacon Code
- [ ] Encodage HELLO → AABBB...
- [ ] Décodage AABBB... → HELLO
- [ ] Symboles personnalisés fonctionnent
- [ ] Auto-détection fonctionne
- [ ] Variante 24 lettres fonctionne

### Fox Code
- [ ] Encodage HELLO → 18 15 22 22 25
- [ ] Décodage 18 15... → HELLO
- [ ] Variante courte génère plusieurs résultats
- [ ] Auto-détection fonctionne

---

## 🎉 Succès !

Si tous les tests passent, vous avez maintenant **3 plugins fonctionnels** :
1. ✅ Caesar (ROT-N)
2. ✅ Bacon Code (bilitère)
3. ✅ Fox Code (grille 3×9)

**Prochaine étape** : Ajouter d'autres plugins (Vigenère, Atbash, Base64, etc.) ! 🚀
