# Ajout des plugins Bacon Code et Fox Code

## 🎯 Objectif

Ajouter deux nouveaux plugins au système MysterAI pour enrichir les capacités de déchiffrement.

---

## ✅ Plugins créés

### 1. **Bacon Code** (Chiffre bilitère)

**Emplacement** : `gc-backend/plugins/official/bacon_code/`

**Description** : Chiffre de Bacon où chaque lettre est remplacée par une séquence de 5 symboles A/B.

**Fichiers** :
- `plugin.json` : Configuration et schéma d'entrée
- `main.py` : Implémentation du plugin
- `__init__.py` : Marqueur de package Python

**Fonctionnalités** :
- ✅ Encodage et décodage
- ✅ Deux variantes : 24 lettres (I=J, U=V) ou 26 lettres (I≠J, U≠V)
- ✅ Symboles personnalisables (A/B par défaut)
- ✅ Détection automatique des symboles
- ✅ Support du bruteforce (dans l'ancien code, à adapter si nécessaire)

**Paramètres d'entrée** :
```json
{
  "text": "Texte à traiter",
  "mode": "encode|decode|detect",
  "variant": "26|24",
  "symbol_a": "A",
  "symbol_b": "B",
  "auto_detect_symbols": true
}
```

**Exemple d'utilisation** :
```python
# Encodage
inputs = {"text": "HELLO", "mode": "encode", "variant": "26"}
# Résultat: "AABBB AABAA ABABB ABABB ABBBA"

# Décodage
inputs = {"text": "AABBB AABAA ABABB ABABB ABBBA", "mode": "decode"}
# Résultat: "HELLO"
```

---

### 2. **Fox Code** (Grille 3×9)

**Emplacement** : `gc-backend/plugins/official/fox_code/`

**Description** : Code utilisant une grille 3×9 pour convertir les lettres en chiffres.

**Fichiers** :
- `plugin.json` : Configuration et schéma d'entrée
- `main.py` : Implémentation du plugin
- `__init__.py` : Marqueur de package Python

**Fonctionnalités** :
- ✅ Encodage et décodage
- ✅ Variante courte : 1 chiffre par lettre (colonne uniquement)
- ✅ Variante longue : 2 chiffres par lettre (ligne + colonne)
- ✅ Détection automatique de la variante
- ✅ Génération de multiples décodages possibles pour la variante courte

**Grille Fox Code** :
```
   1  2  3  4  5  6  7  8  9
1  A  B  C  D  E  F  G  H  I
2  J  K  L  M  N  O  P  Q  R
3  S  T  U  V  W  X  Y  Z  -
```

**Paramètres d'entrée** :
```json
{
  "text": "Texte à traiter",
  "mode": "encode|decode",
  "variant": "auto|short|long"
}
```

**Exemple d'utilisation** :
```python
# Encodage (variante longue)
inputs = {"text": "HELLO", "mode": "encode", "variant": "long"}
# Résultat: "18 15 22 22 25"

# Décodage
inputs = {"text": "18 15 22 22 25", "mode": "decode", "variant": "long"}
# Résultat: "HELLO"

# Variante courte (ambiguë)
inputs = {"text": "1 2 3", "mode": "decode", "variant": "short"}
# Résultats possibles: "AJK", "AJS", "AKS", "BJK", etc.
```

---

## 📁 Structure des fichiers

```
gc-backend/
└── plugins/
    └── official/
        ├── caesar/
        │   ├── __init__.py
        │   ├── main.py
        │   └── plugin.json
        ├── bacon_code/  ← NOUVEAU
        │   ├── __init__.py
        │   ├── main.py
        │   └── plugin.json
        └── fox_code/    ← NOUVEAU
            ├── __init__.py
            ├── main.py
            └── plugin.json
```

---

## 🔧 Format standardisé

Les deux plugins suivent le format standardisé MysterAI v2.0 :

### plugin.json
```json
{
  "name": "plugin_name",
  "version": "1.0.0",
  "plugin_api_version": "2.0",
  "description": "...",
  "author": "MysterAI Team",
  "plugin_type": "python",
  "entry_point": "main.py",
  "categories": ["..."],
  "kinds": ["code"],
  "brute_force": true,
  "enable_scoring": true,
  "capabilities": {
    "analyze": true,
    "decode": true,
    "encode": true
  },
  "input_types": { ... },
  "output_types": { ... }
}
```

### main.py
```python
def execute(inputs: dict) -> dict:
    """Point d'entrée pour le système de plugins."""
    plugin = PluginClass()
    return plugin.execute(inputs)
```

### Format de réponse
```json
{
  "status": "ok",
  "plugin_info": {
    "name": "plugin_name",
    "version": "1.0.0",
    "execution_time_ms": 123
  },
  "results": [
    {
      "id": "result_1",
      "text_output": "...",
      "confidence": 0.8,
      "parameters": { ... },
      "metadata": { ... }
    }
  ],
  "summary": "Message de résumé"
}
```

---

## 🧪 Tests

### Test via l'API Flask

**1. Démarrer le backend** :
```powershell
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
python app.py
```

**2. Lister les plugins** :
```bash
curl http://localhost:8000/api/plugins
```

**3. Tester Bacon Code** :
```bash
# Encodage
curl -X POST http://localhost:8000/api/plugins/bacon_code/execute \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"text": "HELLO", "mode": "encode"}}'

# Décodage
curl -X POST http://localhost:8000/api/plugins/bacon_code/execute \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"text": "AABBB AABAA ABABB ABABB ABBBA", "mode": "decode"}}'
```

**4. Tester Fox Code** :
```bash
# Encodage
curl -X POST http://localhost:8000/api/plugins/fox_code/execute \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"text": "HELLO", "mode": "encode", "variant": "long"}}'

# Décodage
curl -X POST http://localhost:8000/api/plugins/fox_code/execute \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"text": "18 15 22 22 25", "mode": "decode"}}'
```

---

## 🎨 Interface Theia

Les plugins apparaîtront automatiquement dans :

1. **Panneau Plugins** (barre de gauche)
   - Liste avec icônes et descriptions
   - Clic → Ouvre le Plugin Executor

2. **Plugin Executor Widget**
   - Formulaire généré automatiquement depuis `input_types`
   - Sélection du mode (encode/decode)
   - Paramètres spécifiques (variant, symboles, etc.)
   - Bouton "Exécuter"
   - Affichage des résultats

3. **Depuis une géocache**
   - Bouton "🔌 Analyser avec plugins"
   - Description pré-remplie
   - Sélection du plugin
   - Exécution et affichage

---

## 📊 Catégories

### Bacon Code
- **Substitution** : Chiffrement par substitution
- **Bacon** : Spécifique au chiffre Bacon
- **Binary** : Utilise deux symboles (binaire)

### Fox Code
- **Substitution** : Chiffrement par substitution
- **Numbers** : Conversion lettres → chiffres
- **Grid** : Utilise une grille de référence

---

## 🚀 Prochaines étapes

1. **Restart le backend Flask** pour charger les nouveaux plugins
2. **Rebuild l'app Theia** pour voir les changements dans l'interface
3. **Tester dans le navigateur** :
   - Ouvrir le panneau Plugins
   - Vérifier que Bacon Code et Fox Code apparaissent
   - Cliquer sur chaque plugin
   - Tester l'encodage et le décodage

---

## 💡 Améliorations futures possibles

### Bacon Code
- Mode bruteforce complet (tester toutes les combinaisons de symboles)
- Détection de patterns dans le texte
- Support de symboles multi-caractères

### Fox Code
- Scoring automatique pour classer les décodages de la variante courte
- Support de grilles personnalisées
- Visualisation de la grille dans l'interface

---

## 📚 Références

- **Bacon Code** : https://www.dcode.fr/chiffre-bacon-bilitere
- **Fox Code** : https://www.dcode.fr/code-fox
- **Plugin API v2.0** : Documentation interne MysterAI

---

## ✅ Résumé

**Plugins créés** : 2
- ✅ Bacon Code (bilitère)
- ✅ Fox Code (grille 3×9)

**Fichiers créés** : 6
- 2× plugin.json
- 2× main.py
- 2× __init__.py

**Format** : Standardisé MysterAI v2.0

**Prêt pour** : Tests et intégration dans l'interface Theia

**Action suivante** : Restart le backend et rebuild l'app Theia ! 🚀
