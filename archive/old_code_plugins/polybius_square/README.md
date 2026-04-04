# Plugin Carré de Polybe

Ce plugin implémente le chiffrement et déchiffrement utilisant le carré de Polybe, une méthode historique de chiffrement par substitution inventée par l'historien grec Polybe vers 150 av. J.-C.

## Fonctionnement du carré de Polybe

Le chiffrement utilise une grille 5×5 contenant l'alphabet (avec I et J combinés). Dans un carré de Polybe standard, les lettres sont disposées comme suit :

```
  | 1 | 2 | 3 | 4 | 5 |
--+---+---+---+---+---+
1 | A | B | C | D | E |
--+---+---+---+---+---+
2 | F | G | H | I | K |
--+---+---+---+---+---+
3 | L | M | N | O | P |
--+---+---+---+---+---+
4 | Q | R | S | T | U |
--+---+---+---+---+---+
5 | V | W | X | Y | Z |
--+---+---+---+---+---+
```

Chaque lettre est remplacée par ses coordonnées dans la grille. Par exemple, la lettre "A" devient "11", "B" devient "12", etc.

## Caractéristiques du plugin

- **Chiffrement et déchiffrement** : Conversion entre texte normal et code Polybe
- **Grille personnalisable** : Possibilité d'utiliser un mot-clé pour mélanger l'alphabet de la grille
- **Formats de sortie multiples** :
  - **numbers** : Format numérique (11, 12, 21, etc.)
  - **coordinates** : Format coordonnées ((1,1), (1,2), etc.)
  - **dots** : Format avec points (. ., .. ., etc.)
- **Mode strict ou souple** : Détection et décodage précis ou plus tolérant
- **Détection de fragments** : Capacité à reconnaître et décoder du code Polybe même s'il est intégré dans un texte plus large

## Utilisation

### Mode encodage

Pour encoder un texte en utilisant le carré de Polybe :

1. Sélectionnez le mode "encode"
2. Entrez le texte à chiffrer
3. Choisissez un format de sortie (numbers, coordinates, dots)
4. Vous pouvez également spécifier un mot-clé pour personnaliser la grille

### Mode décodage

Pour décoder un texte encodé avec le carré de Polybe :

1. Sélectionnez le mode "decode"
2. Entrez le texte chiffré
3. Si un mot-clé a été utilisé pour l'encodage, spécifiez-le
4. Choisissez entre le mode strict et smooth selon la nature du texte à décoder

## Exemples

### Encodage

- Texte original : `mystere`
- Encodage en format numérique : `32454434151451`
- Encodage en format coordonnées : `(3,2)(4,5)(4,3)(4,4)(1,5)(4,2)(1,5)`
- Encodage en format points : `... ..... .... .... . .... .`

### Décodage

Les trois formats suivants se décodent tous vers le même message "mystere" :
- `32454434151451`
- `(3,2)(4,5)(4,3)(4,4)(1,5)(4,2)(1,5)`
- `... ..... .... .... . .... .`

## Support pour le géocaching

Le plugin est particulièrement utile pour les mystères de géocaching où le carré de Polybe est souvent utilisé comme méthode de chiffrement. Les options avancées comme la personnalisation de la grille avec un mot-clé permettent de décoder même les variantes complexes de ce chiffrement.
