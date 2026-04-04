# Formula Solver - Mode Brute Force 🚀

## 📋 Vue d'ensemble

Nouvelle fonctionnalité permettant de **tester plusieurs valeurs simultanément** pour une ou plusieurs lettres, afin de visualiser toutes les coordonnées possibles sur la carte.

**Cas d'usage typique :** Vous n'êtes pas certain de certaines valeurs et voulez tester toutes les possibilités rapidement.

## ✨ Patterns disponibles

### 1. **`*`** - Toutes les valeurs (0-9)
```
A = * → Teste : 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
```

### 2. **`<X`** - Valeurs strictement inférieures à X
```
B = <5 → Teste : 0, 1, 2, 3, 4
```

### 3. **`<=X`** - Valeurs inférieures ou égales à X
```
C = <=3 → Teste : 0, 1, 2, 3
```

### 4. **`>X`** - Valeurs strictement supérieures à X
```
D = >7 → Teste : 8, 9
```

### 5. **`>=X`** - Valeurs supérieures ou égales à X
```
E = >=6 → Teste : 6, 7, 8, 9
```

### 6. **`X<>Y`** - Valeurs strictement entre X et Y (exclusif)
```
F = 3<>7 → Teste : 4, 5, 6
```

### 7. **`X<==>Y`** - Valeurs entre X et Y inclus (inclusif)
```
G = 2<==>5 → Teste : 2, 3, 4, 5
```

### 8. **Valeur unique** - Nombre simple
```
H = 5 → Teste uniquement : 5
```

### 9. **Vide** - Utilise la valeur saisie normalement
```
I = [vide] → Utilise la valeur déjà saisie dans le champ
```

## 🎯 Exemples d'utilisation

### Exemple 1 : Une seule lettre incertaine
```
Formule : N 48°AB.CDE E 007°FG.HIJ

Valeurs saisies :
A = 2
B = 2
C = 2
D = 2
E = *  ← Pattern brute force
F = 2
G = 2
H = 2
I = 2
J = 2

Résultat : 10 combinaisons testées (E de 0 à 9)
→ 10 points affichés sur la carte
```

### Exemple 2 : Plusieurs lettres incertaines
```
Formule : N 48°AB.CDE E 007°FG.HIJ

Valeurs saisies :
A = 2
B = 2
C = <5  ← 5 valeurs
D = 2
E = 3<>6  ← 2 valeurs
F = 2
G = 2
H = 2
I = 2
J = 2

Résultat : 5 × 2 = 10 combinaisons
→ 10 points affichés sur la carte
```

### Exemple 3 : Plage restreinte
```
Formule : N 48°AB.CDE E 007°FG.HIJ

Valeurs saisies :
A = 2<==>4  ← 3 valeurs (2, 3, 4)
B = 2<==>4  ← 3 valeurs (2, 3, 4)
C = 2
D = 2
E = 2
F = 2
G = 2
H = 2
I = 2
J = 2

Résultat : 3 × 3 = 9 combinaisons
→ 9 points affichés sur la carte
```

## 🎨 Interface utilisateur

### Section Mode Brute Force

Intégrée dans "3. Calcul des coordonnées", entre la prévisualisation et les résultats :

```
┌─────────────────────────────────────────────┐
│ 🚀 Mode Brute Force     [Afficher l'aide]  │
├─────────────────────────────────────────────┤
│ A: [2]           ← Valeur actuelle: 2      │
│ B: [*]           ← Toutes les valeurs (0-9)│
│ C: [<5]          ← Valeurs < 5             │
│ D: [2<==>4]      ← Valeurs entre 2 et 4    │
│ E: [   ]         ← Pattern (ex: *)         │
├─────────────────────────────────────────────┤
│ ℹ️ 250 combinaisons                         │
├─────────────────────────────────────────────┤
│ [Calculer toutes les combinaisons]         │
└─────────────────────────────────────────────┘
```

### Panel d'aide (toggle)

```
Patterns disponibles :
• * : Toutes les valeurs de 0 à 9
• <X : Valeurs strictement inférieures à X
• <=X : Valeurs inférieures ou égales à X
• >X : Valeurs strictement supérieures à X
• >=X : Valeurs supérieures ou égales à X
• X<>Y : Valeurs strictement entre X et Y
• X<==>Y : Valeurs entre X et Y inclus

💡 Laissez vide pour utiliser la valeur saisie normalement
```

### Affichage des résultats

```
┌─────────────────────────────────────────────┐
│ ✅ Résultats Brute Force (10)              │
├─────────────────────────────────────────────┤
│ Solution 1                                  │
│ Valeurs: A=2, B=0, C=2, D=2, E=2...        │
│ N 48° 20.222 E 007° 22.222                 │
├─────────────────────────────────────────────┤
│ Solution 2                                  │
│ Valeurs: A=2, B=1, C=2, D=2, E=2...        │
│ N 48° 21.222 E 007° 22.222                 │
├─────────────────────────────────────────────┤
│ ... (scrollable)                           │
├─────────────────────────────────────────────┤
│ [Effacer les résultats]                    │
└─────────────────────────────────────────────┘
```

## 🗺️ Affichage sur la carte

### Comportement

1. **Effacement préalable** : La carte est effacée avant d'afficher les nouveaux points
2. **Affichage multiple** : Tous les points valides sont affichés simultanément
3. **Identification** : Chaque point est numéroté (Solution 1, Solution 2, etc.)
4. **Popup** : Cliquer sur un point affiche les valeurs utilisées et les coordonnées

### Événements émis

```javascript
// Effacement
window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));

// Affichage de chaque point
window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
    detail: {
        gcCode: '...',
        pluginName: 'Formula Solver (Brute Force)',
        coordinates: {
            latitude: 48.370,
            longitude: 7.370,
            formatted: 'N 48° 22.222 E 007° 22.222'
        },
        waypointTitle: 'Solution 1',
        waypointNote: 'Valeurs: A=2, B=0, C=2...',
        sourceResultText: 'N 48° 22.222 E 007° 22.222',
        replaceExisting: false  // ← Important : ne pas remplacer
    }
}));
```

## ⚙️ Limites et sécurités

### Limite de combinaisons
- **Maximum : 1000 combinaisons**
- Au-delà, le bouton "Calculer" est désactivé
- Message d'erreur affiché

### Exemple de dépassement
```
A = * (10 valeurs)
B = * (10 valeurs)
C = * (10 valeurs)
D = * (10 valeurs)

Total : 10 × 10 × 10 × 10 = 10 000 combinaisons
→ ⚠️ Maximum : 1000 (bouton désactivé)
```

### Calcul du nombre de combinaisons
```typescript
// Affichage en temps réel
count = valeurs(A) × valeurs(B) × valeurs(C) × ...

Exemple :
A=* (10) × B=<5 (5) × C=2 (1) = 50 combinaisons
```

## 🔧 Implémentation technique

### Parser de patterns : `ValueRangeParser`

**Méthode principale :**
```typescript
ValueRangeParser.parsePattern(pattern: string): number[]

Exemples :
parsePattern('*')       → [0,1,2,3,4,5,6,7,8,9]
parsePattern('<5')      → [0,1,2,3,4]
parsePattern('2<==>5')  → [2,3,4,5]
parsePattern('3<>7')    → [4,5,6]
```

**Validation :**
```typescript
ValueRangeParser.isValidPattern(pattern: string): boolean

Exemples :
isValidPattern('*')      → true
isValidPattern('<5')     → true
isValidPattern('abc')    → false
```

**Description :**
```typescript
ValueRangeParser.getPatternDescription(pattern: string): string

Exemples :
getPatternDescription('*')       → "Toutes les valeurs (0-9)"
getPatternDescription('2<==>5')  → "Valeurs entre 2 et 5 inclus"
```

### Générateur de combinaisons : `CombinationGenerator`

**Génération :**
```typescript
CombinationGenerator.generateCombinations(
    ranges: Map<string, number[]>
): Array<Record<string, number>>

Exemple :
Input:  { A: [1,2], B: [3,4] }
Output: [
    { A: 1, B: 3 },
    { A: 1, B: 4 },
    { A: 2, B: 3 },
    { A: 2, B: 4 }
]
```

**Comptage :**
```typescript
CombinationGenerator.countCombinations(ranges: Map<string, number[]>): number

Exemple :
Input:  { A: [1,2,3], B: [4,5] }
Output: 3 × 2 = 6
```

### Composant React : `BruteForceComponent`

**Props :**
```typescript
interface BruteForceComponentProps {
    letters: string[];                                    // Lettres de la formule
    values: Map<string, LetterValue>;                     // Valeurs actuelles
    onBruteForceExecute: (combinations: Array<Record<string, number>>) => void;
}
```

**État interne :**
```typescript
const [patterns, setPatterns] = useState<Map<string, string>>(new Map());
const [showHelp, setShowHelp] = useState(false);
```

### Workflow du calcul

```typescript
// 1. L'utilisateur définit les patterns
patterns.set('A', '*');
patterns.set('B', '<5');

// 2. Génération des combinaisons
const ranges = new Map([
    ['A', [0,1,2,3,4,5,6,7,8,9]],
    ['B', [0,1,2,3,4]]
]);
const combinations = CombinationGenerator.generateCombinations(ranges);
// → 10 × 5 = 50 combinaisons

// 3. Calcul de chaque combinaison
for (const combo of combinations) {
    const result = await calculateCoordinates({
        northFormula: "N 48°AB.CDE",
        eastFormula: "E 007°FG.HIJ",
        values: combo  // { A: 0, B: 0, C: 2, ... }
    });
    
    if (result.status === 'success') {
        results.push({ values: combo, coordinates: result.coordinates });
    }
}

// 4. Affichage sur la carte
results.forEach((result, index) => {
    window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
        detail: {
            waypointTitle: `Solution ${index + 1}`,
            coordinates: result.coordinates,
            // ...
        }
    }));
});
```

## 🎯 Scénarios d'utilisation

### Scénario 1 : Test rapide d'une lettre
```
Contexte : Vous hésitez entre 2, 3 ou 4 pour la lettre A

Solution :
1. Saisir toutes les autres lettres normalement
2. Pour A : saisir "2<==>4"
3. Cliquer "Calculer toutes les combinaisons"
4. Observer les 3 points sur la carte
5. Identifier visuellement le point le plus logique
```

### Scénario 2 : Élimination par limites géographiques
```
Contexte : La cache est en France, vous voulez éliminer les coordonnées aberrantes

Solution :
1. Tester une plage large pour une lettre incertaine
2. Observer les points sur la carte
3. Éliminer visuellement ceux qui tombent dans l'eau, à l'étranger, etc.
4. Réduire la plage et recalculer si besoin
```

### Scénario 3 : Checksum inconnu
```
Contexte : Une lettre est un checksum d'une valeur inconnue

Solution :
1. Pour cette lettre : saisir "*"
2. Calculer toutes les combinaisons (max 10 si une seule lettre)
3. Vérifier visuellement quel point correspond à un lieu logique
4. Valider avec un checker externe (GeoCheck)
```

## 📊 Performance

### Temps de calcul estimé

| Combinaisons | Temps estimé |
|--------------|--------------|
| 10           | < 1 seconde  |
| 50           | ~2 secondes  |
| 100          | ~5 secondes  |
| 500          | ~25 secondes |
| 1000         | ~50 secondes |

**Note :** Dépend de la latence réseau vers l'API backend.

### Optimisations

- Calculs séquentiels (pas de parallélisation pour éviter la surcharge)
- Gestion d'erreurs individuelle (une erreur n'arrête pas tout)
- Filtrage des résultats invalides
- Limite stricte à 1000 combinaisons

## 🐛 Gestion des erreurs

### Erreurs ignorées
- Coordonnées invalides pour une combinaison → ignorée, calcul continue
- Format de coordonnée incorrect → ignorée

### Erreurs bloquantes
- Aucune formule sélectionnée → arrêt
- Erreur réseau généralisée → arrêt
- Dépassement de la limite de 1000 → bouton désactivé

## 📁 Fichiers créés

```
theia-extensions/formula-solver/
├── src/
│   ├── common/
│   │   └── value-range-parser.ts          ← Parser de patterns
│   └── browser/
│       ├── components/
│       │   ├── BruteForceComponent.tsx    ← Interface brute force
│       │   └── index.ts                   ← Export
│       └── formula-solver-widget.tsx      ← Intégration
```

## 🚀 Pour tester

```bash
cd applications/browser
yarn build
yarn start
```

**Test complet :**
1. Ouvrir Formula Solver
2. Sélectionner une formule
3. Remplir les valeurs normalement
4. Pour une lettre : saisir `*`
5. Observer "10 combinaisons" affiché
6. Cliquer "Calculer toutes les combinaisons"
7. Attendre ~1 seconde
8. Voir les 10 points sur la carte !

## 💡 Astuces

1. **Commencer petit** : Testez d'abord avec peu de combinaisons (10-50)
2. **Combiner avec la prévisualisation** : Vérifiez que vos patterns sont valides avant de calculer
3. **Utiliser les plages inclusives** : `2<==>5` est plus intuitif que `1<>6`
4. **Effacer entre les tests** : Cliquez "Effacer les résultats" pour nettoyer la carte

## 🎉 Résultat final

**Workflow ultra-efficace :**
1. Remplir les valeurs certaines
2. Définir des patterns pour les incertaines
3. Un clic → Tous les points sur la carte
4. Identification visuelle rapide
5. Validation avec un checker externe

**Gain de temps énorme pour les mystères complexes !** 🚀
