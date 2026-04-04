
# Plugin Chiffrement par Modulo

Ce plugin implémente le chiffrement par modulo, une technique de cryptographie basée sur l'arithmétique modulaire.

## Principe de fonctionnement

Le chiffrement par modulo utilise l'arithmétique modulaire sur des nombres pour chiffrer un texte :

### Encodage
1. **Conversion** : Les caractères sont convertis en nombres (ex: A=1, B=2, ..., Z=26)
2. **Chiffrement** : Pour chaque nombre `N` à encoder, on génère un nombre aléatoire `R` tel que `R mod M = N`
3. **Résultat** : On obtient une série de grands nombres

**Exemple** :
- Texte : "HELLO"
- Conversion A1Z26 : H=8, E=5, L=12, L=12, O=15
- Avec modulo 26 : 8 devient 654 (car 654 mod 26 = 8), 5 devient 135 (car 135 mod 26 = 5), etc.

### Décodage
1. **Modulo** : On applique l'opération modulo M sur chaque nombre chiffré
2. **Conversion** : On reconvertit les nombres obtenus en caractères

**Exemple** :
- Nombres chiffrés : 654, 135, 298, 324, 171
- Modulo 26 : 8, 5, 12, 12, 15
- Reconversion : HELLO

## Paramètres

### Modulo (N)
Valeurs supportées :
- **26** : Standard pour l'alphabet latin (A-Z)
- **27** : Alphabet + espace
- **36** : Alphabet + chiffres (A-Z, 0-9)
- **37** : Alphabet + chiffres + espace
- **128** : Table ASCII étendue
- **256** : Table ASCII complète

### Mapping Alphabet
- **A1Z26** : A=1, B=2, ..., Z=26 (standard)
- **A0Z25** : A=0, B=1, ..., Z=25 (informatique)

## Modes de fonctionnement

### Encode
Convertit un texte en série de nombres chiffrés.

### Decode
Décode une série de nombres pour retrouver le texte original.

### Bruteforce
Teste automatiquement différentes valeurs de modulo pour trouver la bonne combinaison.

## Formats d'entrée supportés

Le plugin accepte plusieurs formats pour les nombres :
- Séparés par virgules : `654,135,298,324,171`
- Séparés par espaces : `654 135 298 324 171`
- Séparés par tirets : `654-135-298-324-171`
- Format compact : `654135298324171` (division automatique)

## Exemples d'utilisation

### Chiffrement simple
- **Entrée** : "DCODE"
- **Modulo** : 26
- **Mapping** : A1Z26
- **Sortie** : `654,965,561,732,941`

### Déchiffrement
- **Entrée** : `654,965,561,732,941`
- **Modulo** : 26
- **Mapping** : A1Z26
- **Sortie** : "DCODE"

## Scoring automatique

Le plugin intègre un système de scoring automatique qui évalue la pertinence du texte décodé en analysant :
- La fréquence des mots dans la langue française
- La présence de coordonnées GPS
- La structure linguistique du texte

## Notes techniques

- Le chiffrement génère des nombres aléatoirement grands pour renforcer la sécurité
- Le déchiffrement est déterministe : même entrée = même sortie
- Compatible avec le système de plugins MysteryAI
- Support du mode bruteforce avec scoring automatique 