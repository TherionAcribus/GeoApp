# Plugin Gold-Bug (Scarabée d'or)

Ce plugin permet d'encoder et de décoder des messages en utilisant le chiffre du Scarabée d'or (Gold-Bug cipher), popularisé par Edgar Allan Poe.

## Principe
Chaque lettre de l'alphabet est remplacée par un symbole selon la table suivante :

| Lettre | Symbole |
|--------|---------|
| A      | 8       |
| B      | 9       |
| C      | (       |
| D      | )       |
| E      | :       |
| F      | ;       |
| G      | =       |
| H      | ?       |
| I      | /       |
| J      | 1       |
| K      | 2       |
| L      | 3       |
| M      | 4       |
| N      | 5       |
| O      | 6       |
| P      | 7       |
| Q      | 0       |
| R      | *       |
| S      | +       |
| T      | -       |
| U      | .       |
| V      | ,       |
| W      | @       |
| X      | #       |
| Y      | $       |
| Z      | %       |

## Exemples

- **Encodage** :
  - Texte : `GOLD BUG`
  - Résultat : `=6 84 98`

- **Décodage** :
  - Symboles : `:3*+`
  - Résultat : `ERS`

## Référence
- [Chiffre du Scarabée d'or sur dCode.fr](https://www.dcode.fr/scarabee-or-poe)

---
Plugin développé pour MysteryAI, architecture mutualisée de substitution. 