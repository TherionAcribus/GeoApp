# Plugin Tom Tom

Plugin pour encoder/décoder le code **Tom Tom** (aussi appelé **A-Tom-Tom**) qui utilise des combinaisons de barres obliques (`/` et `\`) pour représenter les lettres de l'alphabet.

## Description

Le code Tom Tom est un alphabet alternatif créé pour s'amuser par Hayden, modélisé sur le code Morse. Il utilise uniquement deux caractères :
- `/` (slash/barre oblique)
- `\` (backslash/barre oblique inversée)

## Table de correspondance

| Lettre | Code Tom Tom | Lettre | Code Tom Tom | Lettre | Code Tom Tom |
|--------|--------------|--------|--------------|--------|--------------|
| A | `/` | J | `\/` | S | `\/\` |
| B | `//` | K | `\\/` | T | `\\/\` |
| C | `///` | L | `\\\/` | U | `\//\` |
| D | `////` | M | `\//` | V | `\/\\` |
| E | `/\` | N | `\///` | W | `//\\` |
| F | `//\` | O | `/\/` | X | `\\//` |
| G | `///\` | P | `//\/` | Y | `\/\/` |
| H | `/\\` | Q | `/\\/` | Z | `/\/\` |
| I | `/\\\` | R | `/\//` |   |   |

## Sources

- [Omniglot - A-tom-tom Code](https://www.omniglot.com/conscripts/atomtom.htm)
- [dCode - Tom Tom Code](https://www.dcode.fr/tom-tom-code)

## Architecture

Ce plugin utilise l'**architecture mutualisée** pour les codes de substitution basée sur la classe `SubstitutionPluginBase`. Cette approche permet de :

1. **Réutiliser le code commun** : logique de détection, encodage, décodage, scoring
2. **Simplifier le développement** : il suffit de définir la table de substitution
3. **Maintenir la cohérence** : tous les plugins de substitution ont le même comportement
4. **Faciliter la maintenance** : corrections et améliorations centralisées

## Modes supportés

- **encode** : Convertit du texte normal en code Tom Tom
- **decode** : Convertit du code Tom Tom en texte normal  
- **detect** : Détecte la présence de code Tom Tom dans un texte

## Paramètres

- **strict/smooth** : Mode de traitement strict ou souple
- **embedded** : Permet le code intégré dans du texte
- **allowed_chars** : Caractères de séparation autorisés
- **enable_scoring** : Active l'évaluation automatique de la qualité du décodage

## Exemples

### Encodage
```
Texte : HELLO
Résultat : /\\\\ /\\ \\\/\\\\ \\\/\\\\ /\/
```

### Décodage  
```
Code : \\\\/\\ /\/ \\//
Résultat : TOM
```

## Utilisation de la classe de base

Ce plugin démontre l'utilisation de `SubstitutionPluginBase` :

```python
from substitution_base import SubstitutionPluginBase

class TomTomPlugin(SubstitutionPluginBase):
    def __init__(self):
        super().__init__("tom_tom")
        
        # Définir uniquement la table de substitution
        tom_tom_table = {
            'A': '/',
            'B': '//',
            # ... reste de la table
        }
        
        # La classe de base s'occupe du reste
        self.set_substitution_tables(tom_tom_table)
```

Cette approche permet de créer de nouveaux plugins de substitution très rapidement en ne définissant que la table de correspondance spécifique. 