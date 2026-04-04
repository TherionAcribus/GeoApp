# Plugin Chiffre des Nihilistes

## Description
Ce plugin implémente le chiffre des Nihilistes, une méthode de chiffrement utilisée par les révolutionnaires russes à la fin du 19ème siècle. Il s'agit d'un surchiffrement du carré de Polybe, combinant à la fois une transposition en nombres et une addition avec une clé secrète.

## Fonctionnement

### Principe du chiffre des Nihilistes
Le chiffre des Nihilistes fonctionne en deux étapes principales :

1. **Conversion en coordonnées de Polybe** : Chaque lettre du message est convertie en coordonnées numériques (ligne, colonne) selon une grille de Polybe.
2. **Surchiffrement par addition** : Les coordonnées obtenues sont ensuite additionnées avec les coordonnées d'une clé secrète (répétée autant de fois que nécessaire).

### Étapes de chiffrement
1. Créer une grille de Polybe (généralement 5x5 ou 6x6) avec les lettres de l'alphabet
   - Pour une grille 5x5, on fusionne généralement I/J ou on exclut une lettre peu utilisée
   - Pour une grille 6x6, on peut inclure les 26 lettres plus les chiffres 0-9
2. Convertir chaque lettre du texte en paire de coordonnées (ligne, colonne)
3. Convertir chaque lettre de la clé secrète en paire de coordonnées de la même manière
4. Additionner les paires de coordonnées du message avec celles de la clé (en répétant la clé si nécessaire)
5. Le résultat peut être noté soit en séparant les nombres, soit en les concaténant

### Étapes de déchiffrement
1. Séparer le message chiffré en paires de nombres
2. Soustraire les coordonnées de la clé des paires de nombres
3. Convertir chaque paire résultante en la lettre correspondante dans la grille de Polybe

## Exemples

### Exemple de chiffrement
Supposons que nous voulons chiffrer "KREMLIN" avec la clé "VODKA" en utilisant une grille de Polybe standard.

1. Grille de Polybe (5x5, sans J) :
```
  | 1 2 3 4 5
--+-----------
1 | A B C D E
2 | F G H I K
3 | L M N O P
4 | Q R S T U
5 | V W X Y Z
```

2. Conversion du message "KREMLIN" en coordonnées : 
   - K = (2,5)
   - R = (4,2)
   - E = (1,5)
   - M = (3,2)
   - L = (3,1)
   - I = (2,4)
   - N = (3,3)

   Résultat : 25 42 15 32 31 24 33

3. Conversion de la clé "VODKA" en coordonnées :
   - V = (5,1)
   - O = (3,4)
   - D = (1,4)
   - K = (2,5)
   - A = (1,1)

   Résultat : 51 34 14 25 11 (répété si nécessaire)

4. Addition des coordonnées :
   - 25 + 51 = 76
   - 42 + 34 = 76
   - 15 + 14 = 29
   - 32 + 25 = 57
   - 31 + 11 = 42
   - 24 + 51 = 75
   - 33 + 34 = 67

   Message chiffré (avec séparation) : 76 76 29 57 42 75 67
   Message chiffré (concaténé) : 7676295742 7567

### Exemple de déchiffrement
Pour déchiffrer "76 76 29 57 42 75 67" avec la clé "VODKA" :

1. Soustraire les coordonnées de la clé :
   - 76 - 51 = 25 → K
   - 76 - 34 = 42 → R
   - 29 - 14 = 15 → E
   - 57 - 25 = 32 → M
   - 42 - 11 = 31 → L
   - 75 - 51 = 24 → I
   - 67 - 34 = 33 → N

2. Le message déchiffré est "KREMLIN"

## Particularités et variantes

Le chiffre des Nihilistes présente plusieurs avantages :
- Difficulté d'analyse fréquentielle (chiffre polyalphabétique)
- Double protection par la grille et la clé
- Possibilité d'utiliser différentes tailles de grille ou alphabets

Variantes possibles :
- Utilisation d'une grille avec un alphabet désordonné (basé sur un mot-clé)
- Utilisation de coordonnées colonne-ligne au lieu de ligne-colonne
- Ajout d'une valeur supplémentaire constante aux résultats des additions

## Utilité dans le géocaching
Le chiffre des Nihilistes est parfaitement adapté aux énigmes de géocaching car :
- Il requiert une clé secrète et une grille spécifique
- Il produit des séries de nombres qui peuvent être camouflés dans d'autres éléments
- Il a une connotation historique qui peut être intégrée à un thème russe ou révolutionnaire
- Sa difficulté peut être modulée selon le contexte de la cache

## Limitations
- Nécessite de connaître précisément la grille et la clé pour déchiffrer
- Si la clé est courte et se répète, cela peut réduire la sécurité du chiffrement
- Sensible aux erreurs de transcription

## Notes d'implémentation
Ce plugin utilise la structure du carré de Polybe comme base, avec l'ajout des fonctionnalités d'addition et de soustraction nécessaires au surchiffrement. Il permet également de choisir entre un format de sortie séparé ou concaténé.
