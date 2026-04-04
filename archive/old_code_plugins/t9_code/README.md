# Plugin T9 Code - Version 1.0.1 (Corrigée)

Plugin de chiffrement et déchiffrement utilisant le code T9 (prédictif) des anciens téléphones mobiles.

## 🎯 Corrections apportées dans la version 1.0.1

### ✅ Problèmes résolus

1. **Scoring uniforme à 30%** → **Scoring différencié**
   - Mots prioritaires : 80-95%
   - Mots valides : 60-90%
   - Mots non vérifiés : 30%

2. **Traitement par bloc** → **Traitement mot par mot**
   - "cher ami" (24370264) fonctionne maintenant
   - Séparation automatique par les espaces (0)

3. **Priorisation incorrecte** → **Priorisation intelligente**
   - "ami" (264) apparaît maintenant en premier
   - Mots courts et courants priorisés

## 🚀 Fonctionnalités

### Encodage
Convertit du texte en code T9 :
- `AMI` → `264`
- `CHER AMI` → `24370264`
- `BONJOUR` → `2665687`

### Décodage
Convertit du code T9 en texte avec scoring intelligent :
- `264` → `AMI` (100% confiance)
- `24370264` → `CHER AMI` (97% confiance)
- `26605687` → `BON JOUR` (gestion des espaces)

## 📋 Utilisation

### Interface web
1. Sélectionnez le plugin "T9 Code"
2. Entrez le texte à traiter
3. Choisissez le mode (encode/decode)
4. Sélectionnez la langue
5. Lancez l'analyse

### API
```python
from plugins.official.t9_code.main import T9CodePlugin

plugin = T9CodePlugin()

# Décodage
result = plugin.execute({
    "text": "264",
    "mode": "decode",
    "language": "fr"
})
# Résultat: "AMI" avec 100% confiance

# Encodage
result = plugin.execute({
    "text": "AMI",
    "mode": "encode"
})
# Résultat: "264"
```

## 🎯 Mots prioritaires (géocaching)

### Français
- **AMI** (264) - 85% confiance
- **CHER** (2437) - 80% confiance
- **BON** (266) - 80% confiance
- **OUI** (684) - 85% confiance
- **NON** (666) - 85% confiance
- **MER** (637) - 80% confiance
- **TER** (837) - 80% confiance
- **FIN** (346) - 80% confiance

### Anglais
- **THE** (843) - 75% confiance
- **HELLO** (43556) - 80% confiance
- **YES** (937) - 85% confiance
- **NO** (66) - 85% confiance
- **OK** (65) - 90% confiance
- **HI** (44) - 85% confiance
- **BYE** (293) - 80% confiance

## 🔧 Améliorations techniques

### Gestion des espaces
- Normalisation automatique : `000` → `0`
- Suppression des 0 en début/fin
- Support jusqu'à 10 mots séparés

### Scoring intelligent
- **Bonus phrases courtes** : +10% (≤10 caractères)
- **Bonus mots courts** : +5% par mot ≤3 lettres
- **Score minimum élevé** : 60% pour mots valides

### Limites de sécurité
- **Longueur max** : 50 caractères
- **Timeout** : 10 secondes
- **Segments max** : 10 mots
- **Combinaisons max** : 1000 par segment

## 📊 Exemples de résultats

### Test 1 : Mot simple
```
Input: 264
Output: AMI
Confiance: 100%
Position: 1er
```

### Test 2 : Deux mots
```
Input: 24370264
Output: CHER AMI
Confiance: 97%
Mots: 2
```

### Test 3 : Espaces multiples
```
Input: 26605687
Output: BON JOUR
Confiance: 85%
Mots: 2
```

## 🧪 Tests de validation

Exécutez les tests pour vérifier le bon fonctionnement :

```bash
python plugins/official/t9_code/test_corrections.py
```

## 📝 Changelog

Voir le fichier [CHANGELOG.md](CHANGELOG.md) pour les détails complets des corrections.

## 🔄 Compatibilité

- ✅ Rétrocompatible avec l'API existante
- ✅ Même format de réponse JSON
- ✅ Mêmes paramètres d'entrée
- ✅ Amélioration transparente des performances

## 📞 Support

Pour signaler un bug ou demander une fonctionnalité, utilisez l'interface de support de MysteryAI. 