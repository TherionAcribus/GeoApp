# Plugin Chiffre Bifide de Delastelle

## Description

Ce plugin implémente le chiffre bifide de Delastelle, un système de chiffrement inventé par Félix-Marie Delastelle en 1895. Le chiffre bifide est un chiffre de fractionnement qui combine substitution et transposition en utilisant une grille de Polybe.

## Principe de fonctionnement

Le chiffre bifide utilise les étapes suivantes :

### Encodage
1. **Création de la grille** : Une grille 5x5 ou 6x6 est créée, optionnellement avec un mot-clé
2. **Conversion en coordonnées** : Chaque lettre du texte clair est remplacée par ses coordonnées (ligne, colonne)
3. **Regroupement par blocs** : Les coordonnées sont regroupées par blocs de période N
4. **Fractionnement** : Pour chaque bloc, les coordonnées sont écrites en deux lignes (lignes puis colonnes)
5. **Lecture horizontale** : Les nouvelles coordonnées sont formées en lisant horizontalement
6. **Reconversion** : Les nouvelles coordonnées sont reconverties en lettres

### Exemple d'encodage
Avec le mot "HELLO" et une période de 3 :
- Grille standard 5x5 (I=J)
- H(2,3), E(1,5), L(3,1), L(3,1), O(3,4)
- Blocs : [H,E,L] et [L,O]
- Premier bloc : lignes [2,1,3], colonnes [3,5,1] → lecture [2,1,3,3,5,1] → (2,1)=B, (3,3)=L, (5,1)=V
- Résultat : BLVEO

## Paramètres

### Obligatoires
- **text** : Texte à encoder/décoder
- **mode** : "encode" ou "decode"

### Optionnels
- **key** : Mot-clé pour créer la grille de Polybe (défaut : vide)
- **grid_size** : Taille de la grille - "5x5" ou "6x6" (défaut : "5x5")
- **alphabet_mode** : Pour grille 5x5 - "I=J", "C=K" ou "W=VV" (défaut : "I=J")
- **period** : Taille des blocs pour le fractionnement (défaut : 5)
- **coordinate_order** : Ordre des coordonnées - "ligne-colonne" ou "colonne-ligne" (défaut : "ligne-colonne")
- **strict** : Mode strict ou smooth pour la validation
- **enable_scoring** : Active l'évaluation automatique de la qualité du décodage

## Modes alphabet (grille 5x5)

- **I=J** : Les lettres I et J partagent la même case
- **C=K** : Les lettres C et K partagent la même case  
- **W=VV** : La lettre W est remplacée par VV

## Exemples d'utilisation

### Encodage simple
```
Texte : "HELLO"
Mode : encode
Période : 5
Résultat : "RMFPT"
```

### Décodage avec mot-clé
```
Texte : "RMFPT"
Mode : decode
Mot-clé : "SECRET"
Période : 5
Résultat : "HELLO"
```

### Avec grille 6x6
```
Texte : "HELLO123"
Mode : encode
Grille : 6x6
Période : 4
Résultat : "..."
```

## Historique

Le chiffre bifide a été inventé par Félix-Marie Delastelle et décrit dans son "Traité Élémentaire de Cryptographie" publié en 1902. Il s'agit d'un chiffre tomographique qui était considéré comme très sûr pour son époque.

## Références

- [Chiffre Bifide de Delastelle - dCode](https://www.dcode.fr/chiffre-bifide-delastelle)
- [Le chiffre de Delastelle - Bibmath](https://www.bibmath.net/crypto/index.php?action=affiche&quoi=ancienne/delastelle)
- [Wikipedia - Chiffre de Delastelle](https://fr.wikipedia.org/wiki/Chiffre_de_Delastelle)

## Auteur

MysterAI Team - Plugin développé pour l'application de géocaching MysteryAI.

## Version

1.0.0 - Version initiale avec support complet du chiffre bifide standard. 