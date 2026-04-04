# Référence rapide - Syntaxe Brute Force avec `*` ⚡

## 🎯 Principe de base

**Sans `*`** → Valeur simple, calcul normal  
**Avec `*`** → Brute force, plusieurs valeurs testées

## 📚 Syntaxe complète

| Syntaxe | Description | Exemple | Résultat |
|---------|-------------|---------|----------|
| `5` | Valeur simple | `A = 5` | Une valeur: 5 |
| `*2,3,4` | Liste | `A = *2,3,4` | [2, 3, 4] |
| `*1-5` | Plage tiret | `A = *1-5` | [1, 2, 3, 4, 5] |
| `*2<>9` | Plage `<>` | `A = *2<>9` | [2, 3, 4, 5, 6, 7, 8, 9] |
| `*<5` | Inférieur strict | `A = *<5` | [0, 1, 2, 3, 4] |
| `*<=3` | Inférieur ou égal | `A = *<=3` | [0, 1, 2, 3] |
| `*>7` | Supérieur strict | `A = *>7` | [8, 9] |
| `*>=7` | Supérieur ou égal | `A = *>=7` | [7, 8, 9] |
| `*1-3,5,7-9` | Combinaison | `A = *1-3,5,7-9` | [1, 2, 3, 5, 7, 8, 9] |
| `*0-9` | Tous les chiffres | `A = *0-9` | [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] |

## 💡 Exemples rapides

### Valeur simple
```
A = 5
→ Pas de brute force, calcul classique
```

### Liste de valeurs
```
A = *2,3,4
→ Teste 3 valeurs
```

### Plage
```
A = *0-5
→ Teste 6 valeurs (0,1,2,3,4,5)
```

### Comparaison
```
A = *<5
→ Teste tous < 5 (0,1,2,3,4)
```

### Combinaison multi-champs
```
A = *2,3      (2 valeurs)
B = 1         (1 valeur)
C = *4,5      (2 valeurs)

→ 4 combinaisons (2×1×2)
```

## 🎨 Indicateurs visuels

| État | Badge | Bordure | Affichage |
|------|-------|---------|-----------|
| Valeur simple | Aucun | Normale | `= 5` |
| Brute force | `* 📋 3` | Bleue | `= [2,3,4]` |

## ⚡ Raccourcis courants

| Besoin | Syntaxe | Valeurs |
|--------|---------|---------|
| Tous les chiffres | `*0-9` | 10 valeurs |
| Chiffres pairs | `*0,2,4,6,8` | 5 valeurs |
| Chiffres impairs | `*1,3,5,7,9` | 5 valeurs |
| Première moitié | `*0-4` | 5 valeurs |
| Seconde moitié | `*5-9` | 5 valeurs |
| Petites valeurs | `*<5` | 5 valeurs |
| Grandes valeurs | `*>=5` | 5 valeurs |

## 🚨 Limites

- **Maximum : 1000 combinaisons** (protection anti-blocage)
- **Plage numérique : 0-9** pour les opérateurs de comparaison
- **Tri automatique** : les valeurs sont triées
- **Doublons éliminés** : chaque valeur unique

## 🔧 Tips

✅ **Utiliser `*` uniquement quand nécessaire** : gain de clarté  
✅ **Tester progressivement** : commencer petit, augmenter si besoin  
✅ **Combiner avec valeurs fixes** : réduire l'espace de recherche  
✅ **Supprimer les points inutiles** : affiner progressivement  

❌ **Éviter trop de listes** : explosion combinatoire  
❌ **Ne pas oublier le `*`** : sans préfixe = valeur simple  

## 📖 Voir aussi

- `BRUTE_FORCE_INLINE.md` - Documentation complète
- `PLAN_FORMULA_SOLVER_THEIA.md` - Architecture générale

---

**Version :** 2.0 avec préfixe `*`  
**Date :** 2025-11-11
