# Plugin Chiffre de Wolseley

## Description

Le chiffre de Wolseley est un chiffre de substitution réversible basé sur une clé qui génère un alphabet dérangé. Il a été utilisé par Lord commander Garnet Joseph Wolseley au 18ème siècle.

## Principe de fonctionnement

1. **Génération de l'alphabet dérangé** : À partir d'une clé (ex: `SECRET`), on génère un alphabet en commençant par les lettres de la clé sans doublons, puis en complétant avec les lettres restantes
2. **Suppression d'une lettre** : Dans sa version originale, une lettre est supprimée pour obtenir 25 lettres (J par défaut, remplacé par I)
3. **Table de substitution** : Chaque lettre en position `n` est substituée par la lettre en position `25-n` (positions inversées)
4. **Réversibilité** : Le déchiffrement est identique au chiffrement car la table est symétrique

## Exemple

**Clé** : `SECRET`

**Alphabet généré** : `SECRTABDFGHIKLMNOPQUVWXYZ` (J supprimé)

**Table de substitution** :
```
Position:  0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24
Alphabet:  S E C R T A B D F G H  I  K  L  M  N  O  P  Q  U  V  W  X  Y  Z
Substitué: Z Y X W V U Q P O N M  L  K  I  H  G  F  D  B  A  T  R  C  E  S
```

**Chiffrement** : `WOLSELEY` → `RFIZYIYE`

## Utilisation du plugin

### Paramètres

- **Texte** : Le texte à chiffrer ou déchiffrer
- **Clé** : Mot clé pour générer l'alphabet (laissez vide pour utiliser l'alphabet normal - équivalent Atbash)
- **Lettre supprimée** : 
  - `J` (remplacée par I) - par défaut
  - `V` (remplacée par U)
  - `W` (remplacée par V)
  - `Aucune` (alphabet complet de 26 lettres)
- **Mode** : `encode` ou `decode`

### Mode Bruteforce

Si aucune clé n'est fournie en mode `decode`, le plugin teste automatiquement plusieurs clés communes :
- Aucune clé (chiffre Atbash)
- SECRET, CIPHER, CODE, KEY, WOLSELEY
- ALPHABET, ENIGMA, CRYPTO, DECODE
- MYSTERE, TRESOR, CACHE, GEOCACHING, MYSTERY

## Variantes

- **Sans clé** : Le chiffre de Wolseley sans clé est identique au chiffre Atbash (avec 26 lettres)
- **Différentes lettres supprimées** : Selon les conventions historiques

## Historique

Le chiffre porte le nom de Lord commander Garnet Joseph Wolseley qui l'a utilisé au 18ème siècle, bien que l'inventeur original soit inconnu.

## Références

- [dCode - Chiffre de Wolseley](https://www.dcode.fr/chiffre-wolseley) 