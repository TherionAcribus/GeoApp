# Plugin POSTNET Barcode

Plugin pour encoder et décoder les codes barres POSTNET (Postal Numeric Encoding Technique) utilisés par le service postal américain USPS de 1983 à 2013.

## Fonctionnalités

### Encodage
- Conversion de chiffres en codes barres POSTNET
- Support des formats ZIP-5, ZIP+4, ZIP+4+2 et libre
- Gestion automatique ou manuelle du checksum
- Barres de début/fin configurables
- **Nouveau :** Multiples formats visuels : `|.` (classique), `|╷` (moderne), `10` (binaire)

### Décodage
- **Auto-détection des formats** : plus besoin de spécifier le format d'entrée
- Support des formats visuels : `|.`, `|╷`, `10`, et formats mixtes
- Mode flexible pour géocaching (tolérant aux erreurs)
- **Mode bruteforce** : teste automatiquement toutes les combinaisons possibles
- Validation stricte ou souple selon les besoins

### Validation d'entrée
- **Validation intelligente** : vérification automatique de la pertinence de l'entrée
- Messages d'erreur explicites si format incorrect
- Pour l'encodage : doit contenir des chiffres
- Pour le décodage : doit contenir des barres ou du binaire

## Formats supportés

### Formats postaux standards
- **ZIP-5** : 5 chiffres → 32 barres (avec barres de début/fin et checksum)
- **ZIP+4** : 9 chiffres → 52 barres  
- **ZIP+4+2** : 11 chiffres → 62 barres

### Mode géocaching flexible
- **Longueur libre** : n'importe quel nombre de chiffres
- **Checksum optionnel** : peut être omis ou ignoré
- **Barres de début/fin optionnelles** : format compact possible

### Formats visuels

#### Format classique (pipe_dot) : `|.`
```
Exemple : |.|.|.:|.|.|
```

#### Format moderne (pipe_down) : `|╷`
```
Exemple : |╷|╷╷:|╷|╷|
```

#### Format binaire : `10`
```
Exemple : 101001011010
```

## Utilisation

### Interface utilisateur

1. **Mode** : Encode ou Decode
2. **Format de sortie** (encodage) : auto, zip5, zip9, zip11, free
3. **Format visuel des barres** : auto, |., |╷, 10
4. **Mode checksum** : auto, required, optional, none
5. **Barres de début/fin** : auto, always, never
6. **Mode bruteforce** : disponible pour le décodage

### Exemples d'utilisation

#### Encodage simple
```
Entrée : 12345
Mode : encode
Format : auto (détecté comme ZIP-5)
Sortie : |..||..|..|..||.|..|.|.|.||
```

#### Encodage avec format moderne
```
Entrée : 12345
Mode : encode
Format visuel : |╷
Sortie : |╷╷||╷╷|╷╷|╷╷||╷|╷╷|╷|╷|╷||
```

#### Décodage avec auto-détection
```
Entrée : |..||..|..|..||.|..|.|.|.||
Mode : decode
→ Auto-détection : format pipe_dot, ZIP-5 avec checksum
Sortie : 12345
```

#### Mode bruteforce
```
Entrée : ..||..|..|..||.|..|.|.|
Mode : decode
Bruteforce : activé
→ Teste automatiquement :
  - Avec/sans barres de début/fin
  - Mode strict/flexible
  - Différentes interprétations
Sortie : Plusieurs résultats triés par confiance
```

## Algorithme POSTNET

### Table d'encodage
Chaque chiffre est encodé sur 5 barres (2 hautes `|`, 3 basses `.` ou `╷`) :

| Chiffre | Pattern | Visualisation |
|---------|---------|---------------|
| 0       | 11000   | `||\.\.\. ou ||╷╷╷` |
| 1       | 00011   | `\.\.||    ou ╷╷||` |
| 2       | 00101   | `\.\.|\.   ou ╷╷|╷|` |
| 3       | 00110   | `\.\.||    ou ╷╷||╷` |
| 4       | 01001   | `\.|\.\.   ou ╷|╷╷|` |
| 5       | 01010   | `\.|\.|\. ou ╷|╷|╷` |
| 6       | 01100   | `\.||\.\.  ou ╷||╷╷` |
| 7       | 10001   | `|\.\.\.| ou |╷╷╷|` |
| 8       | 10010   | `|\.\.|\. ou |╷╷|╷` |
| 9       | 10100   | `||\.\.|\. ou ||╷╷|` |

### Calcul du checksum
Le checksum est calculé pour que la somme de tous les digits soit un multiple de 10 :
```
checksum = (10 - (somme_digits % 10)) % 10
```

### Auto-détection intelligente

Le plugin détecte automatiquement :
- **Format visuel** : `|.`, `|╷`, `10`, ou mixte
- **Présence de barres de début/fin** : teste avec et sans
- **Validité du checksum** : vérifie automatiquement
- **Longueur et format** : ZIP-5, ZIP+4, ZIP+4+2, ou libre

## Mode bruteforce

En mode bruteforce, le plugin teste automatiquement :

1. **Mode flexible ON/OFF**
2. **Barres de début/fin présentes/absentes**
3. **Différentes interprétations des patterns ambigus**

Les résultats sont triés par niveau de confiance basé sur :
- Validité du checksum
- Conformité au format POSTNET
- Présence des barres de début/fin
- Cohérence des patterns

## Messages d'erreur

### Validation d'entrée
- `"Aucun chiffre trouvé dans l'entrée. L'encodage POSTNET nécessite des chiffres."`
- `"Format non reconnu. Le décodage POSTNET nécessite des barres (|, ., ╷) ou du binaire (0, 1)."`

### Erreurs de décodage
- `"Pattern invalide: {pattern} (doit avoir exactement 2 barres hautes)"`
- `"Longueur de données invalide: {longueur} (doit être multiple de 5)"`
- `"Pattern non reconnu: {pattern}"`

## Intégration avec MysteryAI

- **Service de scoring** : Évaluation automatique de la pertinence des résultats
- **Format de sortie standardisé** : Compatible avec l'architecture MysteryAI
- **Support des coordonnées GPS** : Détection automatique dans les résultats
- **Métadonnées détaillées** : Informations complètes sur le processus de décodage

## Exemples de géocaching

### Code compact sans barres de début/fin
```
Entrée : ..|..|.||..|.|
Mode : decode, format libre, checksum none
Sortie : 234 (sans checksum)
```

### Code avec format moderne
```
Entrée : |╷╷||╷╷|╷╷|╷╷||╷|╷╷|╷|╷|╷||
Mode : decode
→ Auto-détection format |╷, ZIP-5 avec checksum
Sortie : 12345
```

### Bruteforce sur code ambigu
```
Entrée : |..|..|.||
Mode : decode, bruteforce activé
→ Résultats multiples :
  1. "123" (confiance 0.8, sans checksum, format libre)
  2. "12" (confiance 0.6, avec checksum invalide)
  3. "1234" (confiance 0.4, avec barres ajoutées)
```

## Historique des versions

### v1.2.0 (Actuelle)
- ✅ Support du format `|╷` (moderne)
- ✅ Auto-détection complète des formats
- ✅ Mode bruteforce pour le décodage
- ✅ Validation d'entrée intelligente
- ✅ Détection de format visuel automatique
- ✅ Interface utilisateur améliorée

### v1.1.0
- Support des modes flexibles pour géocaching
- Options configurables (checksum, barres de début/fin)
- Mode libre pour longueurs variables

### v1.0.0
- Implémentation de base POSTNET
- Support ZIP-5, ZIP+4, ZIP+4+2
- Formats visuels classiques

---

**Développé pour MysteryAI** - Plugin de décodage spécialisé pour les géocacheurs 