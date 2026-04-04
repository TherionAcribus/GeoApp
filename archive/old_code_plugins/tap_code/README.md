# Plugin Tap Code

Ce plugin implémente le chiffrement et déchiffrement utilisant le Tap Code (ou code de frappe), une méthode historique de chiffrement utilisée notamment par les prisonniers de guerre américains pendant la guerre du Vietnam pour communiquer entre eux.

## Fonctionnement du Tap Code

Le chiffrement utilise une grille 5×5 contenant l'alphabet (avec K omis ou fusionné avec C). Dans le Tap Code standard, les lettres sont disposées comme suit :

```
  | 1 | 2 | 3 | 4 | 5 |
--+---+---+---+---+---+
1 | A | B | C | D | E |
--+---+---+---+---+---+
2 | F | G | H | I | J |
--+---+---+---+---+---+
3 | L | M | N | O | P |
--+---+---+---+---+---+
4 | Q | R | S | T | U |
--+---+---+---+---+---+
5 | V | W | X | Y | Z |
--+---+---+---+---+---+
```

Chaque lettre est remplacée par deux séquences de "taps" (ou frappes) représentant d'abord le numéro de ligne, puis le numéro de colonne. Exemple : 
- La lettre "A" est représentée par 1 tap puis 1 tap (. .)
- La lettre "B" est représentée par 1 tap puis 2 taps (. ..)
- La lettre "Z" est représentée par 5 taps puis 5 taps (..... .....)

Dans la pratique historique, un tap était un coup audible (sur un mur ou une conduite d'eau par exemple), mais dans le contexte cryptographique moderne, il est représenté textuellement par des points ou des chiffres.

## Caractéristiques du plugin

- **Chiffrement et déchiffrement** : Conversion entre texte normal et code Tap
- **Formats de sortie multiples** :
  - **taps** : Format textuel avec "X" représentant les taps (ex: "X XX" pour "B")
  - **dots** : Format avec points (ex: ". .." pour "B")
  - **numbers** : Format numérique (ex: "1 2" pour "B")
- **Mode strict ou souple** : Détection et décodage précis ou plus tolérant
- **Détection de fragments** : Capacité à reconnaître et décoder du Tap Code même s'il est intégré dans un texte plus large

## Utilisation

### Mode encodage

Pour encoder un texte en utilisant le Tap Code :

1. Sélectionnez le mode "encode"
2. Entrez le texte à chiffrer
3. Choisissez un format de sortie (taps, dots, numbers)

### Mode décodage

Pour décoder un texte encodé avec le Tap Code :

1. Sélectionnez le mode "decode"
2. Entrez le texte chiffré
3. Choisissez entre le mode strict et smooth selon la nature du texte à décoder

## Exemples

### Encodage

- Texte original : `secret`
- Encodage en format taps : `XXX XX XXX XXXXX XXXX XX XXX X`
- Encodage en format dots : `... .. ... ..... .... .. ... .`
- Encodage en format numbers : `3 2 3 5 4 2 3 1`

### Décodage

Les trois formats suivants se décodent tous vers le même message "secret" :
- `XXX XX XXX XXXXX XXXX XX XXX X`
- `... .. ... ..... .... .. ... .`
- `3 2 3 5 4 2 3 1`

## Support pour le géocaching

Le plugin est particulièrement utile pour les mystères de géocaching où le Tap Code peut être utilisé comme méthode de chiffrement. La flexibilité de détection permet de décoder facilement les variantes de ce chiffrement dans divers formats.

## Implémentation technique

Ce plugin réutilise en partie le code du plugin Polybius Square, en l'adaptant aux spécificités du Tap Code qui utilise une grille fixe 5x5 avec l'absence de la lettre K (fusionnée avec C).
