# Plugin Multitap Code

## Description

Ce plugin permet d'encoder et de décoder des textes utilisant le code Multitap (aussi appelé code ABC), qui était utilisé sur les anciens téléphones mobiles pour écrire des SMS avec un clavier numérique.

## Fonctionnement du code Multitap

Le code Multitap associe chaque lettre de l'alphabet à une séquence de chiffres répétés, basée sur les touches d'un téléphone mobile :

| Touche | Lettres | Encodage |
|--------|---------|----------|
| 2      | ABC     | A=2, B=22, C=222 |
| 3      | DEF     | D=3, E=33, F=333 |
| 4      | GHI     | G=4, H=44, I=444 |
| 5      | JKL     | J=5, K=55, L=555 |
| 6      | MNO     | M=6, N=66, O=666 |
| 7      | PQRS    | P=7, Q=77, R=777, S=7777 |
| 8      | TUV     | T=8, U=88, V=888 |
| 9      | WXYZ    | W=9, X=99, Y=999, Z=9999 |
| 0      | Espace  | Espace=0 |

## Exemples

### Encodage
- **DCODE** → **3 222 666 3 33** (avec séparateur espace)
- **DCODE** → **3222666333** (sans séparateur)
- **HELLO** → **44 33 555 555 666** (avec séparateur espace)

### Décodage
- **3 222 666 3 33** → **DCODE**
- **44455555666** → **HELLO** (sans séparateur)

## Modes supportés

### 1. Encodage (encode)
Convertit un texte normal en code Multitap.

**Paramètres :**
- `text` : Texte à encoder
- `separator` : Type de séparateur à utiliser
  - `space` : Sépare les groupes par des espaces (ex: "3 222 666")
  - `dash` : Sépare les groupes par des tirets (ex: "3-222-666")
  - `none` : Aucun séparateur (ex: "3222666")

### 2. Décodage (decode)
Convertit un code Multitap en texte normal.

**Paramètres :**
- `text` : Code Multitap à décoder
- `separator` : Type de séparateur utilisé
  - `auto` : Détection automatique du séparateur
  - `space` : Groupes séparés par des espaces
  - `dash` : Groupes séparés par des tirets
  - `none` : Aucun séparateur

### 3. Mode Bruteforce
Teste automatiquement différents types de séparateurs pour trouver la meilleure solution.

## Utilisation en géocaching

Ce plugin est particulièrement utile pour résoudre des énigmes de géocaching qui utilisent des références aux anciens téléphones mobiles ou des séquences de chiffres répétés. Les indices peuvent inclure :

- Références aux anciens téléphones (Nokia 3310, téléphones à touches)
- Mentions de "SMS", "texto" ou "multitap"
- Séquences de chiffres avec des répétitions (2, 22, 222, 3, 33, etc.)

## Algorithme de détection automatique

Le plugin utilise un algorithme intelligent pour :

1. **Détecter le séparateur** : Analyse la présence d'espaces, tirets ou l'absence de séparateur
2. **Segmenter sans séparateur** : Utilise une approche gloutonne pour identifier les groupes valides
3. **Évaluer la qualité** : Privilégie les solutions avec moins de caractères inconnus
4. **Scoring automatique** : Intègre le système de scoring de MysteryAI pour évaluer la pertinence des résultats

## Exemples d'utilisation

### Exemple 1 : Décodage avec espace
```
Entrée : "3 222 666 3 33"
Sortie : "DCODE"
```

### Exemple 2 : Décodage sans séparateur
```
Entrée : "3222666333"
Sortie : "DCODE"
```

### Exemple 3 : Message complet
```
Entrée : "66 666 777 3 0 4 2 8"
Sortie : "NORD GAT"
```

## Historique

Le code Multitap a été standardisé sous le nom E.161 par l'ITU Telecommunication Standardization Sector (ITU-T). Il était largement utilisé avant l'avènement des écrans tactiles et du système T9 de saisie prédictive.

## Variantes supportées

Le plugin prend en charge plusieurs variantes d'écriture :
- Séparation par espaces : `222 666 3 33`
- Séparation par tirets : `222-666-3-33`
- Sans séparation : `222666333`
- Détection automatique du format

## Configuration

Le plugin est configuré avec :
- **Bruteforce activé** : Teste automatiquement différents séparateurs
- **Scoring activé** : Évalue la qualité des résultats décodés
- **Pas d'acceptation d'accents** : Convertit automatiquement les caractères accentués 