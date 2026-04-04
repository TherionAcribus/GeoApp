# Formula Solver Extension pour Theia IDE

Extension Theia pour résoudre les formules de coordonnées GPS des géocaches Mystery.

## Fonctionnalités

### 🔍 Détection automatique de formules
- Analyse de texte pour détecter les formules de coordonnées avec variables
- Support des formats : `N 47° 5E.FTN E 006° 5A.JVF`
- Extraction automatique des lettres/variables

### ❓ Extraction de questions
- Détection automatique des questions associées aux variables
- Support de plusieurs formats :
  - `A. Question ?`
  - `B: Question ?`
  - `C) Question ?`
  - `Question A:`
  - `1. (D) Question ?`

### 🔢 Calculateur de valeurs
- **Valeur** : Valeur numérique directe
- **Checksum** : Somme des chiffres (ex: 1234 → 10)
- **Checksum réduit** : Checksum récursif jusqu'à 1 chiffre (ex: 1234 → 1)
- **Longueur** : Nombre de caractères (sans espaces)

### 📍 Calcul de coordonnées
- Calcul des coordonnées finales en plusieurs formats :
  - **DDM** (Degrees Decimal Minutes) : `N 47° 53.900`
  - **DMS** (Degrees Minutes Seconds) : `N 47° 53' 54.0"`
  - **Décimal** : `47.89833333, 6.08333333`
- Calcul de la distance depuis l'origine (km et miles)

## Installation

### Prérequis
- Node.js ≥ 20
- Yarn ≥ 1.7.0
- Backend Flask en cours d'exécution sur `http://localhost:8000`

### Build

```bash
# Depuis la racine du projet
cd theia-blueprint

# Installer les dépendances
yarn

# Builder l'extension
cd theia-extensions/formula-solver
yarn build

# Builder l'application browser
cd ../../applications/browser
yarn build

# Démarrer l'application
yarn start
```

L'application sera disponible sur `http://localhost:3000`

## Utilisation

1. **Ouvrir le widget** : Menu `View > Views > Formula Solver`
2. **Détecter une formule** :
   - Coller la description de la géocache dans le textarea
   - Cliquer sur "Détecter la formule"
3. **Extraire les questions** :
   - Cliquer sur "Extraire les questions"
4. **Saisir les valeurs** :
   - Pour chaque variable, saisir la réponse
   - Sélectionner le type de calcul (Valeur, Checksum, etc.)
   - La valeur finale est calculée automatiquement
5. **Calculer** :
   - Cliquer sur "Calculer les coordonnées"
   - Les coordonnées finales s'affichent en plusieurs formats

## Architecture

```
formula-solver/
├── package.json                    # Configuration NPM
├── tsconfig.json                   # Configuration TypeScript
├── src/
│   ├── common/
│   │   └── types.ts               # Interfaces TypeScript
│   └── browser/
│       ├── formula-solver-service.ts          # Service API
│       ├── formula-solver-widget.tsx          # Widget React
│       ├── formula-solver-contribution.ts     # Contribution Theia
│       ├── formula-solver-frontend-module.ts  # Module DI
│       └── style/
│           └── index.css          # Styles CSS
└── lib/                           # Fichiers compilés (généré)
```

## API Backend

L'extension communique avec 3 endpoints :

### POST `/api/formula-solver/detect-formulas`
Détecte les formules dans un texte.

**Body** :
```json
{
  "text": "N 47° 5E.FTN E 006° 5A.JVF"
}
```

### POST `/api/formula-solver/extract-questions`
Extrait les questions pour les variables.

**Body** :
```json
{
  "text": "A. Nombre de fenêtres\nB. Année",
  "letters": ["A", "B"],
  "method": "regex"
}
```

### POST `/api/formula-solver/calculate`
Calcule les coordonnées finales.

**Body** :
```json
{
  "north_formula": "N 47° 5E.AB",
  "east_formula": "E 006° 5C.DE",
  "values": {
    "A": 3,
    "B": 5,
    "C": 1,
    "D": 2,
    "E": 8
  }
}
```

## Développement

### Mode watch
```bash
cd theia-extensions/formula-solver
yarn watch
```

### Debug
Les logs sont affichés dans la console navigateur avec le préfixe `[FORMULA-SOLVER]`.

## Roadmap (Phase 5)

- [ ] Intégration directe avec les géocaches (menu contextuel)
- [ ] Composants React avancés (FormulaInput, ResultDisplay, etc.)
- [ ] Projection des coordonnées sur la carte OpenLayers
- [ ] Création automatique de waypoints
- [ ] Vérificateurs externes (GeoCheck, Geocaching.com, Certitude)
- [ ] Sauvegarde de l'état (localStorage)
- [ ] Export des résultats (JSON, GPX)

## Licence

MIT
