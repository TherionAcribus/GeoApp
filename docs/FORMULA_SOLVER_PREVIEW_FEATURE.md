# Formula Solver - Prévisualisation et Calcul Automatique

## 📋 Vue d'ensemble

Système de prévisualisation en temps réel avec **calcul automatique** des coordonnées dès que toutes les valeurs sont remplies. Plus besoin de bouton "Calculer" !

## ✨ Fonctionnalités

### 1. **Prévisualisation en direct**
- Affichage de la formule avec substitution des lettres en temps réel
- Mise à jour immédiate à chaque changement de valeur
- Affichage séparé pour latitude (Nord) et longitude (Est)

### 2. **Validation automatique**
Trois états possibles :

#### ✅ **VALIDE** (Vert)
- Toutes les lettres sont remplies
- Les valeurs sont dans les limites acceptables
- Les coordonnées sont calculables
- Icône : ✓ Check

**Limites validées :**
- Latitude : 0° - 90° (N/S)
- Longitude : 0° - 180° (E/W)
- Minutes : 0 - 59

#### ⚠️ **INCOMPLÈTE** (Orange)
- Certaines lettres manquent encore
- Affiche les lettres manquantes
- Montre la substitution partielle
- Icône : ○ Cercle

#### ❌ **INVALIDE** (Rouge)
- Toutes les lettres sont remplies mais...
- Format de coordonnée incorrect
- Valeurs hors limites (ex: 95° de latitude)
- Minutes >= 60
- Icône : ✗ Erreur

### 3. **Calcul automatique instantané** 🚀
- **Plus besoin de bouton "Calculer"** !
- Le calcul se déclenche automatiquement dès que toutes les lettres sont remplies
- Résultats affichés instantanément sous la prévisualisation
- Déclenchement à chaque changement de valeur

**Déclencheurs :**
- `updateValue()` → vérifie si toutes les lettres sont remplies → calcul auto
- `onPartialCalculate()` → vérifie l'état complet → calcul auto

### 4. **Message de confirmation**
Quand les deux coordonnées sont valides :
```
✓ Les coordonnées complètes sont prêtes pour le calcul final !
```
Suivi immédiatement par les résultats calculés.

## 🎨 Interface utilisateur

### Organisation des sections

```
┌─────────────────────────────────────────────┐
│ 1. Détection de formule                    │
│ [Formule détectée : N 48°AB.CDE...]        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 2. Questions pour les variables             │
│ A = [2] (checksum de "abc")                │
│ B = [2] (valeur directe)                   │
│ ... etc                                    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 3. Calcul des coordonnées                  │
├─────────────────────────────────────────────┤
│ 📍 Prévisualisation en temps réel           │
│                                             │
│ ✓ Latitude : ✓ Valide                      │
│ ┌─────────────────────────────────────────┐ │
│ │ N 48° 22.222                            │ │ <- Vert
│ └─────────────────────────────────────────┘ │
│ Coordonnée valide                           │
│                                             │
│ ✓ Longitude : ✓ Valide                     │
│ ┌─────────────────────────────────────────┐ │
│ │ E 007° 22.222                           │ │ <- Vert
│ └─────────────────────────────────────────┘ │
│ Coordonnée valide                           │
│                                             │
│ ✅ Coordonnées prêtes pour le calcul !      │
├─────────────────────────────────────────────┤
│ 📊 Résultats (calcul automatique)          │
│ DDM: N 48° 22.222 E 007° 22.222            │
│ DMS: N 48° 22' 13.32" E 007° 22' 13.32"   │
│ Decimal: 48.37037, 7.37037                 │
│ [Projeter sur carte] [Créer waypoint]     │
└─────────────────────────────────────────────┘
```

## 🔧 Implémentation technique

### Composant React : `FormulaPreviewComponent`

**Props :**
```typescript
interface FormulaPreviewProps {
    formula: Formula;           // Formule à prévisualiser
    values: Map<string, LetterValue>;  // Valeurs actuelles
    onPartialCalculate?: (part: 'north' | 'east', result: string) => void;
}
```

**Logique de validation :**
1. Extraction des lettres requises (sans cardinales)
2. Vérification de complétude
3. Substitution des valeurs
4. Parsing et validation du format
5. Vérification des limites géographiques

### Intégration dans le widget

**Affichage dans la section "3. Calcul des coordonnées" :**
- Visible dès que les questions sont disponibles
- Mise à jour automatique via React state
- Résultats affichés directement en dessous

**Logique de calcul automatique :**
```typescript
// 1. L'utilisateur saisit/modifie une valeur
updateValue(letter, rawValue, type) {
    // Mettre à jour la valeur
    this.state.values.set(letter, letterValue);
    this.update();
    
    // 2. Vérifier si calcul possible
    this.tryAutoCalculate();
}

// 3. Vérification automatique
tryAutoCalculate() {
    const letters = extractLettersFromFormula(formula);
    const missingValues = letters.filter(l => !values.has(l));
    
    if (missingValues.length === 0) {
        // Toutes les lettres remplies → calcul !
        this.calculateCoordinates();
    }
}
```

**Déclencheurs multiples :**
- `updateValue()` après chaque modification
- `onPartialCalculate()` quand une demi-coordonnée est validée
- Aucun doublon grâce à la vérification de `missingValues`

## 🎯 Cas d'usage

### Exemple 1 : Formule simple
```
Formule : N 48°AB.CDE E 007°FG.HIJ

État initial :
- Latitude : ○ Incomplète (manque A,B,C,D,E)
- Longitude : ○ Incomplète (manque F,G,H,I,J)

Après saisie A=2, B=2, C=2, D=2, E=2 :
- Latitude : ✓ Valide "N 48° 22.222"
- Longitude : ○ Incomplète (manque F,G,H,I,J)
- Calcul non déclenché (lettres manquantes)

Après saisie F=2, G=2, H=2, I=2, J=2 :
- Latitude : ✓ Valide "N 48° 22.222"
- Longitude : ✓ Valide "E 007° 22.222"
- Message : "Prêtes pour le calcul final !"
- 🚀 **CALCUL AUTOMATIQUE DÉCLENCHÉ**
- Résultats affichés instantanément
- Point projeté automatiquement sur la carte
```

### Exemple 2 : Valeurs invalides
```
Formule : N 95°AB.CDE E 007°FG.HIJ

Après saisie complète :
- Latitude : ❌ Invalide "Latitude invalide : 95° (doit être entre 0° et 90°)"
- Longitude : ✓ Valide "E 007° 22.222"
```

### Exemple 3 : Minutes invalides
```
Formule : N 48°AB.CDE E 007°FG.HIJ
A=6, B=8 (donne 68 minutes)

Résultat :
- Latitude : ❌ Invalide "Minutes invalides : 68 (doit être entre 0 et 59)"
```

## 🚀 Avantages

1. **Feedback immédiat** : L'utilisateur voit directement le résultat
2. **Détection d'erreurs précoce** : Évite les calculs inutiles
3. **Guidage visuel** : Code couleur intuitif
4. **Performance** : Calcul local instantané
5. **Expérience utilisateur** : Fluidité et réactivité

## 📁 Fichiers concernés

```
theia-extensions/formula-solver/
├── src/browser/
│   ├── components/
│   │   ├── FormulaPreviewComponent.tsx  ← Nouveau composant
│   │   └── index.ts                     ← Export ajouté
│   ├── style/
│   │   ├── formula-preview.css          ← Nouveaux styles
│   │   └── index.css                    ← Import ajouté
│   └── formula-solver-widget.tsx        ← Intégration
```

## 🔄 Prochaines évolutions possibles

- [ ] Animation de transition entre états
- [ ] Copie rapide des coordonnées partielles
- [ ] Historique des calculs partiels
- [ ] Export CSV des coordonnées intermédiaires
- [ ] Tooltips explicatifs sur les erreurs
- [ ] Suggestions de correction automatique

## 📝 Notes techniques

**Regex de parsing :**
```regex
/([NSEW])?\s*(\d+)°\s*(\d+)\.(\d+)/i
```

**Limites géographiques :**
- Latitude : [-90, 90]
- Longitude : [-180, 180]
- Minutes : [0, 60[

**Performance :**
- Calcul synchrone (pas d'appel API)
- Memoization via React.useMemo (si nécessaire)
- Debouncing non requis (calculs légers)
