# Brute Force Inline - Multi-valeurs dans les champs 🎯

## 📋 Vue d'ensemble

Transformation du système de brute force : au lieu d'avoir une section séparée, vous pouvez maintenant saisir **plusieurs valeurs directement dans chaque champ** de réponse. Le brute force se déclenche **automatiquement** dès qu'une liste est détectée.

## ✨ Fonctionnalités

### 1. Syntaxe avec préfixe `*` (wildcard)

Le symbole `*` au début d'un champ active le mode **brute force** pour ce champ. Sans `*`, c'est une valeur simple.

**Valeur unique** (comportement normal, **pas de brute force**) :
```
A = 5
→ Une seule valeur, calcul normal
```

**Liste avec virgules** :
```
A = *2,3,4
→ Test avec A=2, puis A=3, puis A=4
```

**Plage avec tiret** :
```
A = *1-5
→ Test avec A=1, A=2, A=3, A=4, A=5
```

**Plage avec `<>`** :
```
A = *2<>9
→ Test de 2 à 9 inclus
```

**Opérateurs de comparaison** :
```
A = *<5      → Test A=0,1,2,3,4
A = *<=3     → Test A=0,1,2,3
A = *>7      → Test A=8,9
A = *>=7     → Test A=7,8,9
```

**Combinaison** :
```
A = *1-3,5,7-9
→ Test avec A=1,2,3,5,7,8,9
```

### 2. Combinaisons automatiques

Quand plusieurs champs contiennent des listes, toutes les **combinaisons** sont générées automatiquement :

```
A = *2,3
B = 1
C = *4,5

→ Génération de 4 combinaisons :
   1. A=2, B=1, C=4
   2. A=2, B=1, C=5
   3. A=3, B=1, C=4
   4. A=3, B=1, C=5
```

### 3. Indicateurs visuels

**Badge de comptage** :
- Quand une liste est détectée, un badge `* 📋 5` s'affiche dans le champ
- Le badge indique le mode brute force actif et le nombre de valeurs

**Bordure colorée** :
- Les champs avec liste ont une bordure bleue distinctive
- Les champs normaux gardent la bordure standard

**Affichage des valeurs** :
- Valeur unique : `= 5`
- Liste : `= [2,3,4]` (3 premières valeurs + `...` si plus)
- Tooltip au survol affiche toutes les valeurs

### 4. Déclenchement automatique

Dès que **tous les champs sont remplis** ET qu'au moins **un contient une liste** :
- ✅ Brute force automatique
- ✅ Calcul de toutes les combinaisons
- ✅ Affichage sur la carte
- ✅ Liste des résultats avec labels stables

Si aucune liste détectée → Calcul normal d'une seule solution

## 🎯 Exemples d'utilisation

### Exemple 1 : Test de quelques valeurs

```
Formule : N 48° 22.(A×B)(C+D) E 007° 22.(E-F)(G×H)

Saisie :
A = *2,3
B = 2
C = 2
D = 2
E = *2,3,4
F = 2
G = 2
H = 0

Résultat : 6 combinaisons (2×1×1×1×3×1×1×1)
```

### Exemple 2 : Brute force sur une seule variable

```
Formule : N 48° 22.A22 E 007° 22.022

Saisie :
A = *0-9

Résultat : 10 solutions testées
```

### Exemple 3 : Opérateurs de comparaison

```
Formule : N 48° 22.A22 E 007° 22.B22

Saisie :
A = *<5      → Teste 0,1,2,3,4
B = *>=7     → Teste 7,8,9

Résultat : 15 combinaisons (5×3)
```

### Exemple 4 : Plage avec <>

```
A = *2<>7  → [2,3,4,5,6,7]
B = *0,1   → [0,1]

Résultat : 12 combinaisons (6×2)
```

### Exemple 5 : Limite de sécurité

```
A = *0-9
B = *0-9
C = *0-9
D = *0-9

→ 10,000 combinaisons détectées
→ Limité automatiquement à 1000
→ Message d'avertissement affiché
```

## 🛠️ Implémentation technique

### 1. Parser de valeurs (`value-parser.ts`)

```typescript
export function parseValueList(input: string): ParsedValue {
    // Séparer par virgules
    const parts = input.split(',');
    
    for (const part of parts) {
        // Détecter les plages (ex: "1-5")
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        
        if (rangeMatch) {
            // Générer toutes les valeurs de la plage
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            // ...
        } else {
            // Valeur simple
            const num = parseInt(part, 10);
            // ...
        }
    }
}
```

**Exemples de parsing** :
- `"5"` → `{ values: [5], isList: false }` (valeur simple)
- `"*2,3,4"` → `{ values: [2,3,4], isList: true }`
- `"*1-5"` → `{ values: [1,2,3,4,5], isList: true }`
- `"*1-3,5,7-9"` → `{ values: [1,2,3,5,7,8,9], isList: true }`
- `"*2<>9"` → `{ values: [2,3,4,5,6,7,8,9], isList: true }`
- `"*<5"` → `{ values: [0,1,2,3,4], isList: true }`
- `"*>=7"` → `{ values: [7,8,9], isList: true }`

### 2. Type `LetterValue` étendu

```typescript
export interface LetterValue {
    letter: string;
    rawValue: string;          // "2,3,4" ou "1-5"
    value: number;              // Première valeur (pour compatibilité)
    type: ValueType;
    values?: number[];          // [2,3,4] ou [1,2,3,4,5]
    isList?: boolean;           // true si multi-valeurs
}
```

### 3. Méthode `updateValue` modifiée

```typescript
protected updateValue(letter: string, rawValue: string, type: ValueType): void {
    // Parser la valeur
    const parsed = parseValueList(rawValue);
    
    // Appliquer le type de calcul sur chaque valeur
    const calculatedValues: number[] = [];
    for (const val of parsed.values) {
        switch (type) {
            case 'checksum':
                calculatedValues.push(calculateChecksum(val.toString()));
                break;
            case 'value':
            default:
                calculatedValues.push(val);
                break;
        }
    }
    
    // Stocker avec métadonnées
    this.state.values.set(letter, {
        letter,
        rawValue,
        value: calculatedValues[0],
        type,
        values: calculatedValues,
        isList: parsed.isList
    });
    
    // Déclencher calcul automatique ou brute force
    this.tryAutoCalculateOrBruteForce();
}
```

### 4. Détection automatique

```typescript
protected tryAutoCalculateOrBruteForce(): void {
    // Vérifier si tous les champs sont remplis
    const allFilled = this.state.questions.every(q => {
        const val = this.state.values.get(q.letter);
        return val && val.rawValue.trim() !== '';
    });
    
    if (!allFilled) return;
    
    // Vérifier si au moins un champ contient une liste
    const hasLists = Array.from(this.state.values.values())
        .some(v => v.isList);
    
    if (hasLists) {
        // 🔥 Brute force automatique
        this.executeBruteForceFromFields();
    } else {
        // ✅ Calcul simple
        this.tryAutoCalculate();
    }
}
```

### 5. Génération de combinaisons

```typescript
protected generateCombinations(
    letterValuesMap: Record<string, number[]>
): Record<string, number>[] {
    const letters = Object.keys(letterValuesMap);
    const combinations: Record<string, number>[] = [];
    
    // Génération récursive
    const generate = (index: number, current: Record<string, number>) => {
        if (index === letters.length) {
            combinations.push({ ...current });
            return;
        }

        const letter = letters[index];
        const values = letterValuesMap[letter];

        for (const value of values) {
            current[letter] = value;
            generate(index + 1, current);
        }
    };

    generate(0, {});
    return combinations;
}
```

**Exemple** :
```typescript
letterValuesMap = {
    A: [2, 3],
    B: [1],
    C: [4, 5]
}

→ Génère :
[
    { A: 2, B: 1, C: 4 },
    { A: 2, B: 1, C: 5 },
    { A: 3, B: 1, C: 4 },
    { A: 3, B: 1, C: 5 }
]
```

## 🎨 Interface utilisateur

### Badge multi-valeurs

```tsx
{letterValue?.isList && letterValue?.values && (
    <div style={{
        position: 'absolute',
        right: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        backgroundColor: 'var(--theia-button-background)',
        color: 'var(--theia-button-foreground)',
        padding: '2px 6px',
        borderRadius: '3px',
        fontSize: '11px',
        fontWeight: 'bold'
    }}>
        <span className="codicon codicon-list-unordered" />
        {letterValue.values.length}
    </div>
)}
```

### Affichage des valeurs calculées

```tsx
{letterValue.isList && letterValue.values ? (
    // Liste de valeurs
    <span title={letterValue.values.join(', ')}>
        [{letterValue.values.slice(0, 3).join(',')}{
            letterValue.values.length > 3 ? '...' : ''
        }]
    </span>
) : (
    // Valeur unique
    <span>{letterValue.value}</span>
)}
```

### Bordure distinctive

```tsx
border: `1px solid ${
    letterValue?.isList 
        ? 'var(--theia-button-background)'  // Bleu pour les listes
        : hasValue 
            ? 'var(--theia-focusBorder)'     // Standard si rempli
            : 'var(--theia-input-border)'    // Standard si vide
}`
```

## 📊 Workflow complet

```
┌─────────────────────────────────────────────┐
│ 1. Utilisateur saisit dans les champs      │
│    A = 2,3                                  │
│    B = 1                                    │
│    C = 4,5                                  │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 2. Parser détecte les listes                │
│    parseValueList("2,3") → [2,3]            │
│    parseValueList("1") → [1]                │
│    parseValueList("4,5") → [4,5]            │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 3. updateValue applique le type de calcul  │
│    Pour chaque valeur de la liste           │
│    (checksum, length, etc.)                 │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 4. UI affiche les badges et bordures       │
│    A: bordure bleue + badge "📋 2"          │
│    B: bordure normale                       │
│    C: bordure bleue + badge "📋 2"          │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 5. Tous les champs remplis ?               │
│    → Oui                                    │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 6. Au moins une liste détectée ?           │
│    → Oui (A et C ont des listes)            │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 7. Brute force automatique !               │
│    generateCombinations({                   │
│      A: [2,3], B: [1], C: [4,5]            │
│    })                                       │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 8. Calcul des 4 combinaisons               │
│    A=2, B=1, C=4 → Coords 1                │
│    A=2, B=1, C=5 → Coords 2                │
│    A=3, B=1, C=4 → Coords 3                │
│    A=3, B=1, C=5 → Coords 4                │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 9. Affichage sur la carte                  │
│    4 points avec labels stables             │
│    "Solution 1", "Solution 2", ...          │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 10. Liste des résultats                    │
│     Solution 1 (A=2, B=1, C=4)             │
│     Solution 2 (A=2, B=1, C=5)             │
│     Solution 3 (A=3, B=1, C=4)             │
│     Solution 4 (A=3, B=1, C=5)             │
│                                             │
│     Chaque point peut être supprimé         │
│     (depuis la liste ou la carte)           │
└─────────────────────────────────────────────┘
```

## 🚨 Limites et sécurité

### Limite de combinaisons

Pour éviter les calculs trop longs ou les blocages :

```typescript
if (combinations.length > 1000) {
    this.messageService.warn(
        `${combinations.length} combinaisons détectées. ` +
        `Limité à 1000 pour éviter les calculs trop longs.`
    );
    combinations.splice(1000);  // Garde seulement les 1000 premières
}
```

### Parsing robuste

- Ignore les espaces : `"2, 3 , 4"` → `[2,3,4]`
- Gère les inversions : `"5-1"` → `[1,2,3,4,5]`
- Élimine les doublons : `"1,2,2,3"` → `[1,2,3]`
- Trie automatiquement : `"3,1,2"` → `[1,2,3]`

## 💡 Cas d'usage

### 1. Test d'une hypothèse

```
"Je pense que A vaut 2, 3 ou 4"
→ A = *2,3,4
→ 3 combinaisons testées
```

### 2. Élimination progressive

```
Étape 1 : A = *0-9  → 10 résultats
→ Suppression des points aberrants
→ Reste 3 candidats

Étape 2 : Affiner B = *1-3
→ 3×3 = 9 nouvelles combinaisons
```

### 3. Variables partiellement connues

```
A = 5        (certitude, valeur simple)
B = *2,3,4   (incertitude, brute force)
C = 1        (certitude, valeur simple)

→ Teste uniquement les 3 valeurs de B
```

### 4. Contraintes avec opérateurs

```
"A doit être inférieur à 5"
→ A = *<5

"B doit être supérieur ou égal à 7"
→ B = *>=7

→ Test des valeurs respectant les contraintes
```

### 5. Plages avec exclusions

```
"A entre 2 et 9"
→ A = *2<>9  → [2,3,4,5,6,7,8,9]

Plus concis que : A = *2-9
Mais identique au résultat
```

## 📁 Fichiers modifiés

```
formula-solver/
├── src/
│   ├── browser/
│   │   ├── utils/
│   │   │   └── value-parser.ts           ← NOUVEAU
│   │   ├── components/
│   │   │   └── QuestionFieldsComponent.tsx  ← MODIFIÉ (UI)
│   │   └── formula-solver-widget.tsx      ← MODIFIÉ (logique)
│   └── common/
│       └── types.ts                       ← MODIFIÉ (LetterValue)
```

## 🚀 Pour tester

```bash
cd theia-extensions/formula-solver
yarn build

cd ../../applications/browser
yarn build
yarn start
```

**Scénario de test** :
1. Ouvrir Formula Solver
2. Saisir une formule
3. Remplir les champs :
   - `A = *2,3` (avec préfixe *)
   - `B = 1` (valeur simple, sans *)
   - `C = *4,5` (avec préfixe *)
4. Observer :
   - ✅ Badges `* 📋 2` sur A et C
   - ✅ Bordures bleues sur A et C
   - ✅ Affichage `= [2,3]` et `= [4,5]`
   - ✅ Calcul automatique de 4 combinaisons
   - ✅ 4 points sur la carte
   - ✅ Liste des 4 solutions
   - ✅ Suppression individuelle fonctionnelle
   - ✅ Bouton "Ajouter et valider" disponible
   - ✅ Boutons sur chaque ligne brute force : "Créer waypoint" et "Ajouter & valider"

**Scénario test opérateurs** :
1. `A = *<5` → Badge `* 📋 5`, affiche `[0,1,2,3,4]`
2. `B = *>=7` → Badge `* 📋 3`, affiche `[7,8,9]`
3. `C = *2<>5` → Badge `* 📋 4`, affiche `[2,3,4,5]`

**Scénario mixte** :
1. `A = 5` (sans *) → Pas de badge, affichage normal `= 5`
2. `B = *2,3` (avec *) → Badge brute force
3. Résultat : 2 combinaisons uniquement (1×2)

### Bouton "Ajouter et valider"

- Disponible lorsque les coordonnées sont calculées avec succès
- Crée le waypoint immédiatement (auto-save) sans ouvrir le formulaire
- Utilise le même flux que les plugins/carte (`autoSave: true` sur l'événement `geoapp-plugin-add-waypoint`)
- Rafraîchit automatique la liste des waypoints et la carte

---

**Status :** ✅ Implémenté et testé  
**Date :** 2025-11-11  
**Extension :** formula-solver  
**Mode Brute Force :** Inline automatique
