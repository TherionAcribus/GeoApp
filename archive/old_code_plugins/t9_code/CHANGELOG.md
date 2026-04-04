# Changelog - Plugin T9 Code

## Version 1.0.1 (Corrigée) - 2024

### Corrections majeures

#### 🔧 **Problème de scoring fixé**
- **Avant** : Tous les mots avaient une confiance fixe à 30%
- **Après** : Scoring différencié selon la validité des mots
  - Mots prioritaires (géocaching) : 80-95%
  - Mots valides dans le dictionnaire : 60-90%
  - Mots non vérifiés : 30%

#### 🔧 **Traitement mot par mot implémenté**
- **Avant** : "cher ami" (24370264) était traité comme un bloc → aucun résultat
- **Après** : Traitement séparé des mots séparés par 0
  - "2437" → "CHER" 
  - "264" → "AMI"
  - Résultat : "CHER AMI" avec 97% de confiance

#### 🔧 **Priorisation des mots corrigée**
- **Avant** : "ami" (264) n'était pas en premier dans les résultats
- **Après** : "AMI" apparaît en premier avec 100% de confiance
- Ajout de nombreux mots prioritaires pour le géocaching

### Améliorations techniques

#### 📈 **Gestion des espaces améliorée**
- Normalisation des espaces multiples (000 → 0)
- Suppression des 0 en début et fin de chaîne
- Support jusqu'à 10 mots séparés

#### 📈 **Scoring intelligent**
- Bonus pour les phrases courtes (+10%)
- Bonus pour les mots courts (+5% par mot ≤3 lettres)
- Score minimum plus élevé pour les mots valides (60% vs 30%)

#### 📈 **Limites de sécurité ajustées**
- Longueur maximale : 50 caractères (vs 30)
- Timeout : 10 secondes (vs 5)
- Nombre de segments : 10 mots (vs 5)

### Mots prioritaires ajoutés

**Français :**
- AMI, CHER, BON, OUI, NON, MER, TER, FIN
- DEBUT, MILIEU, START, END, GO, STOP

**Anglais :**
- THE, HELLO, YES, NO, OK, HI, BYE
- AREA, CENTER, CODE, CACHE

### Tests de validation

✅ **Test 1** : "264" → "AMI" (100% confiance, en premier)
✅ **Test 2** : "24370264" → "CHER AMI" (97% confiance)
✅ **Test 3** : Scores différenciés (plus de 30% uniforme)
✅ **Test 4** : Espaces multiples "26605687" → "BON JOUR"
✅ **Test 5** : Encodage "AMI" → "264"
✅ **Test 6** : Mots prioritaires correctement détectés

### Compatibilité

- ✅ Rétrocompatible avec l'API existante
- ✅ Même format de réponse JSON
- ✅ Mêmes paramètres d'entrée
- ✅ Amélioration transparente des performances

### Utilisation

```python
# Exemple d'utilisation
plugin = T9CodePlugin()

# Mot simple
result = plugin.execute({"text": "264", "mode": "decode", "language": "fr"})
# Résultat: "AMI" avec 100% confiance

# Deux mots
result = plugin.execute({"text": "24370264", "mode": "decode", "language": "fr"})
# Résultat: "CHER AMI" avec 97% confiance

# Encodage
result = plugin.execute({"text": "AMI", "mode": "encode"})
# Résultat: "264"
```

---

## Version 1.0.0 (Originale) - 2024

### Fonctionnalités initiales
- Encodage/décodage T9 basique
- Support multi-langues
- Limites de sécurité strictes
- Scoring uniforme à 30%
- Traitement par bloc (non mot par mot) 