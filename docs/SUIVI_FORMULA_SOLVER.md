# Suivi d'Implémentation : Formula Solver pour Theia

**Date de création** : 10 novembre 2025  
**Statut global** : 🟡 En cours  
**Temps estimé total** : 26-36 heures  
**Temps écoulé** : 9.5 heures  

---

## 📊 Progression Globale

```
Phase 1: Plugin Parser          ▰▰▰▰▰▰▰▰▰▰  100% ✅
Phase 2: Service Questions      ▰▰▰▰▰▰▰▰▰▰  100% ✅
Phase 3: Routes API             ▰▰▰▰▰▰▰▰▰▰  100% ✅
Phase 4: Widget Theia           ▰▰▰▰▰▰▰▰▰▰  100% ✅
Phase 5: Fonctionnalités        ▰▰▰▰▱▱▱▱▱▱  38%
─────────────────────────────────────────
Total:                          ▰▰▰▰▰▰▰▰▰▱  88%
```

---

# PHASE 1 : Plugin Formula Parser ✅

**Objectif** : Intégrer le plugin de parsing de formules dans le système de plugins officiel  
**Temps estimé** : 1-2 heures  
**Statut** : ✅ TERMINÉ (100%)  

## Checklist

### 1.1 Préparation
- [x] Créer le dossier `gc-backend/plugins/official/formula_parser/`
- [x] Créer le fichier `__init__.py` vide

### 1.2 Adaptation du plugin.json
- [x] Copier `ancien_code_formula_solver/formula_parser/plugin.json`
- [x] Adapter au format du nouveau système :
  ```json
  {
    "name": "formula_parser",
    "version": "1.0.0",
    "description": "Détecte et parse les formules de coordonnées GPS",
    "author": "MysterAI",
    "category": "parser",
    "capabilities": {
      "modes": ["parse"],
      "input_types": ["text"],
      "output_types": ["coordinates"]
    },
    "inputs": {
      "text": {
        "type": "string",
        "required": true,
        "label": "Texte à analyser"
      }
    },
    "outputs": {
      "coordinates": {
        "type": "array",
        "label": "Coordonnées détectées"
      }
    }
  }
  ```

### 1.3 Adaptation du main.py
- [x] Copier `ancien_code_formula_solver/formula_parser/main.py`
- [x] Renommer la classe en `FormulaParserPlugin`
- [x] Adapter la méthode `execute()` pour correspondre à l'interface du PluginManager
- [x] Vérifier que le retour respecte le format attendu :
  ```python
  {
    "status": "success",
    "results": [
      {
        "id": "result_1",
        "north": "N49°18.(B-A)(B-C-F)(D+E)",
        "east": "E006°16.(C+F)(D+F)(C+D)",
        "source": "description",
        "text_output": "N49°18.(B-A)(B-C-F)(D+E) E006°16.(C+F)(D+F)(C+D)"
      }
    ],
    "summary": "1 formule(s) détectée(s)"
  }
  ```

### 1.4 Tests du plugin
- [x] Créer `gc-backend/plugins/official/formula_parser/test_formula_parser.py`
- [x] Test 1 : Format standard `N 47° 5E.FTN E 006° 5A.JVF`
- [x] Test 2 : Format avec espaces `N 48° 41.E D B`
- [x] Test 3 : Format avec opérations `N49°18.(B-A)(B-C-F)`
- [x] Test 4 : Texte sans formule (retour vide)
- [x] Test 5 : Formule dans description complexe HTML

### 1.5 Intégration PluginManager
- [x] Vérifier que le plugin est détecté par `list_plugins()`
- [x] Tester l'exécution via `execute_plugin("formula_parser", {...})`
- [x] Vérifier les logs d'exécution

### 1.6 Documentation
- [x] Créer `gc-backend/plugins/official/formula_parser/README.md`
- [x] Documenter les formats supportés
- [x] Ajouter des exemples d'utilisation
- [x] Documenter les cas limites

## 📝 Notes de Phase 1
```
✅ Fichiers créés avec succès :
- __init__.py
- plugin.json (adapté au nouveau format avec schéma strict v2.0)
- main.py (classe FormulaParserPlugin avec méthode execute() conforme)
- test_formula_parser.py (12 tests unitaires complets)
- README.md (documentation complète avec exemples)
- test_discovery.py (script de validation du plugin)

🔧 Adaptations effectuées :
- Structure de retour standardisée : status, results, summary
- Ajout des champs id, confidence, text_output pour chaque résultat
- Support de multiples formats de formules (standard, avec espaces, avec opérations)
- Patterns regex optimisés pour détecter Nord et Est séparément

⚠️ Problèmes rencontrés et résolus :
1. Champ obligatoire manquant : 'plugin_api_version' → Ajout de "2.0"
2. Champs non autorisés : 'enabled', 'examples', 'tags', 'documentation' → Supprimés
3. Valeur invalide pour 'kinds' : "detect" → Changé en ["geo", "solver"]
4. Ajout de tous les champs requis : plugin_type, entry_point, dependencies, etc.

✅ Validation finale :
- Plugin découvert avec succès (5 plugins trouvés, 0 erreurs)
- Logs montrent : "Plugin formula_parser validé avec succès"
- Prêt pour l'exécution dans le contexte Flask (nécessite redémarrage serveur)

📊 Tests de validation :
✓ bacon_code v1.0.0 (official)
✓ caesar v1.0.0 (official)
✓ formula_parser v1.0.0 (official) ⭐
✓ fox_code v1.1.0 (official)
✓ metasolver v1.0.0 (official)
```

---

# PHASE 2 : Service d'Extraction de Questions ✅

**Objectif** : Créer un service backend pour extraire les questions liées aux variables  
**Temps estimé** : 3-4 heures  
**Statut** : ✅ TERMINÉ (100%)  

## Checklist

### 2.1 Création du service
- [x] Créer `gc-backend/services/formula_questions_service.py`
- [x] Importer les dépendances nécessaires
- [x] Créer la classe `FormulaQuestionsService`

### 2.2 Méthode extract_questions_with_regex
- [x] Implémenter la méthode principale
- [x] Porter les patterns regex depuis l'ancien code :
  - [x] Pattern format `A.`, `B:`, `C)`
  - [x] Pattern format `Question A:`
  - [x] Pattern format `1. (A) Question?`
- [x] Gérer les séparateurs multiples (`.`, `:`, `)`, `-`, `–`, `—`, `/`)
- [x] Implémenter la logique de sélection (question la plus longue)

### 2.3 Méthode _prepare_content_for_analysis
- [x] Gérer le cas texte brut (string)
- [x] Gérer le cas objet Geocache :
  - [x] Extraire la description (nettoyer HTML)
  - [x] Extraire les waypoints (prefix, name, note)
  - [x] Extraire les hints
- [x] Concaténer avec séparateurs clairs
- [x] Limiter la longueur si nécessaire

### 2.4 Méthode utilitaire _clean_html
- [x] Implémenter avec BeautifulSoup (si disponible)
- [x] Fallback avec regex simple
- [x] Gérer les erreurs gracieusement

### 2.5 Tests unitaires
- [x] Créer `gc-backend/services/tests/test_formula_questions_service.py`
- [x] Test 1 : Questions format simple (`A. Question`)
- [x] Test 2 : Questions avec double-points (`B: Question`)
- [x] Test 3 : Questions avec parenthèses (`C) Question`)
- [x] Test 4 : Questions numérotées (`1. (D) Question`)
- [x] Test 5 : Questions multi-lignes
- [x] Test 6 : Pas de questions trouvées
- [x] Test 7 : Analyse objet Geocache complet

### 2.6 Instance singleton
- [x] Créer l'instance `formula_questions_service` à la fin du fichier
- [x] Documenter l'utilisation

## 📝 Notes de Phase 2
```
✅ Fichiers créés avec succès :
- formula_questions_service.py (270 lignes)
- test_formula_questions_service.py (23 tests unitaires)
- __init__.py (tests)

🔧 Fonctionnalités implémentées :
- extract_questions_with_regex() : 3 patterns regex pour détecter différents formats
- _prepare_content_for_analysis() : Support texte brut ET objets Geocache
- _clean_html() : Nettoyage HTML avec BeautifulSoup + fallback regex
- extract_questions_with_ai() : Méthode stub (NotImplementedError pour phase future)

📊 Patterns regex supportés :
1. Format standard : "A. Question" / "B: Question" / "C) Question"
2. Format numéroté : "1. (A) Question"
3. Format inverse : "Question A:" (priorité basse pour éviter faux positifs)

⚡ Optimisations :
- Priorité des patterns pour éviter les remplacements incorrects
- Nettoyage HTML qui préserve les sauts de ligne (li, p, div, br, h1-h6)
- Logique "question la plus longue" pour gérer les doublons

✅ Tests : 23/23 PASSENT
- 13 tests d'extraction de questions (différents formats)
- 4 tests de nettoyage HTML
- 5 tests de préparation de contenu
- 1 test de méthode AI (NotImplementedError)

🎯 Prêt pour la Phase 3 : Routes API
```

---

# PHASE 3 : Routes API Backend ✅

**Objectif** : Créer les endpoints REST pour le Formula Solver  
**Temps estimé** : 2-3 heures  
**Statut** : ✅ TERMINÉ (100%)  

## Checklist

### 3.1 Création du blueprint
- [x] Créer `gc-backend/blueprints/formula_solver.py`
- [x] Importer Flask, Blueprint, request, jsonify
- [x] Créer le blueprint `formula_solver_bp`

### 3.2 Route POST /api/formula-solver/detect-formulas
- [x] Signature de la route
- [x] Récupérer `geocache_id` ou `text` depuis le body
- [x] Si `geocache_id` : récupérer la géocache depuis DB
- [x] Préparer le texte (description + waypoints)
- [x] Appeler le plugin `formula_parser` via PluginManager
- [x] Retourner les formules détectées
- [x] Gérer les erreurs (400, 404, 500)

### 3.3 Route POST /api/formula-solver/extract-questions
- [x] Signature de la route
- [x] Récupérer `geocache_id`, `letters`, `method`
- [x] Valider `method` (`"regex"` ou `"ai"` - ai non supporté pour l'instant)
- [x] Charger la géocache depuis DB
- [x] Appeler `formula_questions_service.extract_questions_with_regex()`
- [x] Retourner les questions par lettre
- [x] Gérer les erreurs

### 3.4 Route POST /api/formula-solver/calculate
- [x] Signature de la route
- [x] Récupérer `formula`, `values`, `origin_lat`, `origin_lon`
- [x] Parser la formule
- [x] Substituer les variables avec les valeurs
- [x] Évaluer les expressions (avec sandbox sécurisé)
- [x] Calculer les coordonnées finales (DDM, DMS, decimal)
- [x] Calculer la distance depuis l'origine
- [x] Retourner le résultat
- [x] Gérer les erreurs (formule invalide, division par zéro, etc.)

### 3.5 Module de calcul de coordonnées
- [x] Créer `gc-backend/utils/coordinate_calculator.py`
- [x] Fonction `substitute_variables(formula, values)` → formule avec valeurs
- [x] Fonction `_safe_eval(expr)` → résultat sécurisé
- [x] Fonction `calculate_coordinates(north_formula, east_formula, values)` → coords
- [x] Fonction `_format_ddm(lat, lon)` → DDM
- [x] Fonction `_format_dms(lat, lon)` → DMS
- [x] Fonction `calculate_distance(lat1, lon1, lat2, lon2)` → distance en km

### 3.6 Tests de sécurité pour l'évaluation
- [x] Tester injection de code malveillant
- [x] Vérifier le sandbox (pas d'accès à `os`, `sys`, etc.)
- [x] Tester expressions valides complexes
- [x] Tester division par zéro
- [x] Tester validation de nombres

### 3.7 Enregistrement du blueprint
- [x] Modifier `gc-backend/__init__.py`
- [x] Importer `formula_solver_bp`
- [x] Enregistrer avec `app.register_blueprint(formula_solver_bp)`
- [x] Vérifier le préfixe `/api`

### 3.8 Tests unitaires
- [x] Créer `gc-backend/tests/test_coordinate_calculator.py`
- [x] Test substitution de variables
- [x] Test évaluation d'expressions
- [x] Test parsing de coordonnées
- [x] Test formatage DDM/DMS
- [x] Test calcul de distance
- [x] Test sécurité (injection, eval, division par zéro)

## 📝 Notes de Phase 3
```
✅ Fichiers créés avec succès :
- formula_solver.py (320 lignes) - 3 routes API
- coordinate_calculator.py (370 lignes) - Module de calcul
- __init__.py (utils)
- test_coordinate_calculator.py (15 tests unitaires)

🔧 Routes API implémentées :
1. POST /api/formula-solver/detect-formulas
   - Paramètres : geocache_id OU text
   - Appelle le plugin formula_parser
   - Retourne : {status, formulas[], summary}

2. POST /api/formula-solver/extract-questions
   - Paramètres : geocache_id/text, letters[], method (regex/ai)
   - Appelle formula_questions_service
   - Retourne : {status, questions{}, found_count}

3. POST /api/formula-solver/calculate
   - Paramètres : north_formula, east_formula, values{}, origin_lat?, origin_lon?
   - Calcule les coordonnées finales
   - Retourne : {status, coordinates{lat, lon, ddm, dms, decimal}, distance?}

⚙️ CoordinateCalculator - Fonctionnalités :
- substitute_variables() : Remplace A-Z sauf N/S/E/W cardinales
- _safe_eval() : Sandbox sécurisé (seulement +, -, *, /, parenthèses)
- _evaluate_expressions() : Évalue expressions entre parenthèses
- _parse_coordinate() : Parse DDM → décimal
- _format_ddm() / _format_dms() : Formatage coordonnées
- calculate_distance() : Formule de Haversine

🔒 Sécurité implémentée :
- Sandbox eval() avec namespace vide
- Validation regex (seulement chiffres et opérateurs)
- Détection double opérateurs
- Gestion division par zéro
- Validation limites lat/lon (-90/90, -180/180)
- Pas d'accès à __import__, eval, exec, os, sys

✅ Tests : 15/15 PASSENT
- Substitution variables simple et complexe
- Évaluation expressions arithmétiques
- Parsing et formatage coordonnées
- Calcul de distance (Haversine)
- Tests sécurité (injection code, division par zéro)

🎯 Blueprint enregistré dans app.py
Routes accessibles :
- http://localhost:8000/api/formula-solver/detect-formulas
- http://localhost:8000/api/formula-solver/extract-questions
- http://localhost:8000/api/formula-solver/calculate
```

---

# PHASE 4 : Widget Theia ✅

**Objectif** : Créer le widget React intégré à Theia  
**Temps estimé** : 8-10 heures  
**Statut** : ✅ TERMINÉ (100%)  

## Checklist

### 4.1 Structure du projet
- [x] Créer `theia-blueprint/theia-extensions/formula-solver/`
- [x] Créer `package.json` avec dépendances
- [x] Créer `tsconfig.json`
- [x] Créer l'arborescence :
  ```
  src/
  ├── browser/
  │   ├── formula-solver-widget.tsx
  │   ├── formula-solver-contribution.ts
  │   ├── formula-solver-service.ts
  │   ├── formula-solver-frontend-module.ts
  │   └── components/
  │       ├── formula-input.tsx
  │       ├── detected-formulas.tsx
  │       ├── question-fields.tsx
  │       ├── value-calculator.tsx
  │       └── result-display.tsx
  └── common/
      └── types.ts
  ```

### 4.2 Types TypeScript (types.ts)
- [x] Interface `Formula` (north, east, source)
- [x] Interface `Question` (letter, question, answer)
- [x] Interface `LetterValue` (letter, rawValue, value, type)
- [x] Interface `CalculatedCoordinates` (lat, lon, ddm, dms, distance)
- [x] Type `ValueType` (value, checksum, reduced, length, etc.)
- [x] Interface `FormulaSolverState` (état du widget)
- [x] Interface `CalculationResult` (résultat complet)

### 4.3 Service (formula-solver-service.ts)
- [x] Interface `FormulaSolverService`
- [x] Méthode `detectFormulas(geocacheId, text?)`
- [x] Méthode `extractQuestions(geocacheId, letters, method)`
- [x] Méthode `calculateCoordinates(formula, values, origin)`
- [x] Méthode `calculateChecksum(value)`
- [x] Méthode `calculateReducedChecksum(value)`
- [x] Méthode `calculateLength(value)`
- [x] Gestion des erreurs avec axios

### 4.4 Widget Principal (formula-solver-widget.tsx)
- [x] Classe `FormulaSolverWidget` extends `ReactWidget`
- [x] State complet avec `FormulaSolverState`
- [x] Méthode `detectFormulasFromText()`
- [x] Méthode `extractQuestions()`
- [x] Méthode `calculateCoordinates()`
- [x] Méthode `extractLettersFromFormula()`
- [x] Méthode `updateValue()` avec calculs automatiques
- [x] Rendu en 4 étapes (detect, questions, values, calculate)

### 4.5 Composant DetectedFormulas
- [x] Props : `formulas`, `onSelect`, `selectedFormula`, `loading`
- [x] Affichage de la liste avec boutons
- [x] État de sélection avec highlight
- [x] Support multi-formules avec sélection
- [x] Affichage confiance et détails

### 4.6 Composant QuestionFields
- [x] Props : `questions`, `values`, `onValueChange`, `onExtractQuestions`, `loading`
- [x] En-tête avec statistiques et progression
- [x] Pour chaque lettre :
  - [x] Badge lettre avec état
  - [x] Affichage de la question
  - [x] Champ de saisie de la réponse
  - [x] Sélecteur de type d'opération (4 types)
  - [x] Affichage de la valeur calculée en temps réel
- [x] Bouton "Extraire questions" intégré
- [x] Sélecteur de type global (batch update)
- [x] Barre de progression visuelle

### 4.7 Composant ResultDisplay
- [x] Props : `result`, `onCopy`, `onCreateWaypoint`, `onProjectOnMap`
- [x] Banner de succès avec icône
- [x] Affichage des coordonnées en 3 formats :
  - [x] DDM (principal, grand format)
  - [x] DMS (secondaire)
  - [x] Décimal (secondaire)
- [x] Boutons "Copier" pour chaque format avec feedback
- [x] Affichage lat/lon séparés
- [x] Affichage de la distance (km + miles)
- [x] Section "Étapes de calcul" (details/summary)
- [x] Boutons d'action (Voir carte, Créer waypoint)
- [x] Design moderne avec couleurs Theia

### 4.10 Contribution Theia (formula-solver-contribution.ts)
- [x] Classe `FormulaSolverContribution` implements :
  - [x] `FrontendApplicationContribution`
  - [x] `CommandContribution`
  - [x] `MenuContribution`
  - [x] `TabBarToolbarContribution`
- [x] Commande `formula-solver:open`
- [x] Commande `formula-solver:toggle`
- [x] Menu dans View > Views
- [ ] Menu contextuel sur géocaches (Phase 5)
- [ ] Keybinding (optionnel)

### 4.11 Module Frontend (formula-solver-frontend-module.ts)
- [x] Enregistrement du widget factory
- [x] Binding du service (FormulaSolverServiceImpl)
- [x] Binding de la contribution
- [x] Export du module avec DI Inversify

### 4.12 Styles CSS
- [x] Créer `style/index.css`
- [x] Styles pour le widget container
- [x] Styles pour les étapes
- [x] Animation de chargement (spin)
- [x] Animation fadeIn pour les étapes
- [x] Support thème sombre/clair (variables CSS Theia)

### 4.13 Intégration workspace
- [x] Extension déjà dans workspaces via `theia-extensions/*`
- [x] Ajouter dans `applications/browser/package.json` dependencies
- [x] Build : `yarn && yarn build:extensions`
- [x] Test dans le navigateur - **TESTS CONCLUANTS** ✅

### 4.14 Tests
- [ ] Tests unitaires des composants React
- [ ] Tests du service
- [ ] Tests d'intégration du widget
- [ ] Tests E2E avec Playwright

## 📝 Notes de Phase 4
```
✅ Fichiers créés avec succès :
- package.json (configuration extension Theia)
- tsconfig.json (configuration TypeScript)
- README.md (documentation complète)
- src/common/types.ts (11 interfaces TypeScript)
- src/browser/formula-solver-service.ts (185 lignes - communication API)
- src/browser/formula-solver-widget.tsx (374 lignes - widget React modulaire)
- src/browser/formula-solver-contribution.ts (contribution Theia)
- src/browser/formula-solver-frontend-module.ts (module DI)
- src/browser/style/index.css (styles CSS avec thèmes)
- src/browser/components/DetectedFormulasComponent.tsx (160 lignes)
- src/browser/components/QuestionFieldsComponent.tsx (340 lignes)
- src/browser/components/ResultDisplayComponent.tsx (445 lignes)
- src/browser/components/index.ts (exports)

🎨 Widget React implémenté (Architecture modulaire) :
- **FormulaSolverWidget** : Container principal avec logique métier
- **DetectedFormulasComponent** : Affichage formules avec sélection
- **QuestionFieldsComponent** : Questions + saisie valeurs avec progression
- **ResultDisplayComponent** : Résultats avec 3 formats + actions

Interface utilisateur en 3 étapes :
1. Détection formule (textarea → API → affichage formule)
2. Questions & Valeurs (extraction → affichage questions → saisie + calculs)
3. Résultat (coordonnées 3 formats + distance + actions)

🔧 Service FormulaSolverService :
- detectFormulas() : Appelle /api/formula-solver/detect-formulas
- extractQuestions() : Appelle /api/formula-solver/extract-questions
- calculateCoordinates() : Appelle /api/formula-solver/calculate
- calculateChecksum() : Somme des chiffres
- calculateReducedChecksum() : Checksum récursif → 1 chiffre
- calculateLength() : Longueur sans espaces

⚙️ Fonctionnalités du widget :
- Détection automatique des variables (A-Z sauf N/S/E/W)
- Calcul automatique selon le type (value/checksum/reduced/length)
- Gestion d'état avec updateState() et rafraîchissement auto
- Messages utilisateur via MessageService (info, warn, error)
- État de chargement avec spinner
- Gestion des erreurs réseau et validation

🎭 Contribution Theia :
- Commandes : formula-solver:open, formula-solver:toggle
- Menu : View > Views > Formula Solver
- Widget dans panneau latéral droit (area: 'right', rank: 500)
- Icône : codicon-symbol-variable

📦 Intégration :
- Extension dans workspace Yarn (theia-extensions/*)
- Dépendance ajoutée dans applications/browser/package.json
- Suit le pattern des extensions existantes (plugins, zones)

🚀 Prochaines étapes :
1. Build l'extension : cd theia-extensions/formula-solver && yarn build
2. Build l'app : cd applications/browser && yarn && yarn build
3. Tester dans le navigateur : yarn start
4. Composants avancés (Phase 5) : FormulaInput, DetectedFormulas, etc.
5. Intégration avec geocaches (menu contextuel)
6. Vérificateurs externes (GeoCheck, Certitude)

⚠️ Note importante :
Le widget est fonctionnel en mode "standalone" (copier/coller de texte).
L'intégration avec les géocaches (geocacheId) sera faite en Phase 5.
```

---

# PHASE 5 : Fonctionnalités Avancées 🟡

**Objectif** : Implémenter les fonctionnalités avancées  
**Temps estimé** : 8-12 heures  
**Statut** : 🟡 En cours (38%)  

## 5.1 Intégration Geocaches (1h) ✅

### Checklist
- [x] Route backend GET `/api/formula-solver/geocache/<id>`
- [x] Méthode service `getGeocache(geocacheId)`
- [x] Méthode widget `loadFromGeocache(geocacheId)`
- [x] Ajout champs `gcCode`, `originLat`, `originLon` dans state
- [x] Commande `formula-solver:solve-from-geocache`
- [x] Bouton "Résoudre formule" dans GeocacheDetailsWidget
- [x] Injection CommandService dans GeocacheDetailsWidget
- [x] Méthode `solveFormula()` dans GeocacheDetailsWidget
- [x] Dépendance formula-solver dans zones/package.json
- [x] Chargement automatique description + origine
- [x] Détection automatique des formules
- [x] Feedback utilisateur (toast)

## 5.2 Opérations sur Valeurs (DÉJÀ FAIT ✅)

### Checklist
- [x] Implémentation `calculateChecksum(value)` → somme des chiffres
- [x] Implémentation `calculateReducedChecksum(value)` → réduction à 1 chiffre
- [x] Implémentation `calculateLength(value)` → nombre de caractères
- [ ] Implémentation `calculateAlphaPosition(char)` → A=1, B=2, etc.
- [x] Gestion des cas spéciaux (nombres, texte mixte)
- [ ] Tests unitaires pour chaque opération

## 5.3 Évaluation de Formules (DÉJÀ FAIT ✅)

### Checklist
- [x] Parser d'expressions mathématiques (Phase 3)
- [x] Support des opérations : `+`, `-`, `*`, `/`, `%`
- [x] Support des parenthèses
- [x] Sandbox sécurisé (ast.literal_eval + whitelist)
- [x] Validation des expressions avant évaluation
- [x] Gestion des erreurs (division par zéro, syntaxe invalide)
- [x] Tests de sécurité (injection de code)
- [x] Tests de cas limites (15 tests)

## 5.4 Projection Cartographique (30min) ✅

### Checklist
- [x] Injection MapService dans widget
- [x] Méthode `showOnMap()` dans widget
- [x] Utilisation de `highlightDetectedCoordinate()`
- [x] Marqueur avec plugin name "Formula Solver"
- [x] Popup avec détails (formule, valeurs, coordonnées)
- [x] Callback `onProjectOnMap` dans ResultDisplay
- [x] Dépendance theia-ide-zones-ext ajoutée
- [x] Toast de confirmation
- [ ] Génération de toutes les combinaisons (optionnel, Phase future)
- [ ] Option "Afficher toutes les possibilités" (optionnel)

## 5.5 Intégration Waypoints (1h) ✅

### Checklist
- [x] Route backend POST `/api/formula-solver/geocache/<id>/waypoint`
- [x] Fonction `createWaypoint(geocacheId, coordinates, name, note)`
- [x] Génération automatique du nom (ex: "Solution formule")
- [x] Génération automatique du prefix (ex: "WP01", "WP02", etc.)
- [x] Bouton "Créer waypoint" fonctionnel
- [x] Note automatique avec formule + valeurs
- [x] Validation coordonnées
- [x] Toast de confirmation
- [x] Gestion des erreurs complète
- [ ] Actualisation automatique du GeocacheDetailsWidget
- [ ] Dialogue personnalisé (nom, note editables)

## 5.5 Vérificateurs Externes (1-2h)

### Checklist
- [ ] **GeoCheck** :
  - [ ] Détecter l'URL GeoCheck dans la géocache
  - [ ] Ouvrir dans nouvel onglet avec coordonnées
  - [ ] Gérer l'absence de GeoCheck
- [ ] **Geocaching.com Checker** :
  - [ ] Construire l'URL du checker officiel
  - [ ] Ouvrir avec GC code et coordonnées
  - [ ] Gestion des erreurs (cache non éligible)
- [ ] **Certitude** :
  - [ ] Détecter l'URL Certitude dans la géocache
  - [ ] Ouvrir avec coordonnées
  - [ ] Gérer l'absence de Certitude
- [ ] Boutons conditionnels (afficher seulement si disponible)
- [ ] Feedback utilisateur (toast/notification)

## 📝 Notes de Phase 5
```
[Espace pour notes]




```

---

# TESTS ET VALIDATION

## Tests Manuels

### Scénario 1 : Détection de formule simple
- [ ] Ouvrir une géocache avec formule dans la description
- [ ] Ouvrir le Formula Solver
- [ ] Vérifier que la formule est détectée automatiquement
- [ ] Cliquer sur "Utiliser"
- [ ] Vérifier que la formule apparaît dans le champ

### Scénario 2 : Saisie manuelle de formule
- [ ] Saisir manuellement : `N 47° 5E.FTN E 006° 5A.JVF`
- [ ] Vérifier l'extraction des lettres E, F, T, N, A, J, V
- [ ] Vérifier l'affichage des champs de saisie

### Scénario 3 : Extraction de questions
- [ ] Cliquer sur "Extraire les questions"
- [ ] Vérifier que les questions sont détectées
- [ ] Vérifier qu'elles apparaissent sous chaque lettre

### Scénario 4 : Saisie de réponses et calcul
- [ ] Saisir une réponse pour chaque lettre
- [ ] Choisir le type d'opération (valeur, checksum, etc.)
- [ ] Vérifier le calcul de la valeur
- [ ] Cliquer sur "Calculer"
- [ ] Vérifier l'affichage des coordonnées calculées

### Scénario 5 : Actions sur résultats
- [ ] Tester "Copier" → vérifier le clipboard
- [ ] Tester "Ajouter waypoint" → vérifier création
- [ ] Tester "Vérifier avec GeoCheck" → vérifier ouverture

### Scénario 6 : Formules complexes
- [ ] Tester avec opérations : `N 48° (A+B).(C*2)`
- [ ] Tester avec parenthèses imbriquées
- [ ] Tester avec division : `E 006° 12.(D/2)`

### Scénario 7 : Cas limites
- [ ] Texte sans formule → rien détecté
- [ ] Formule incomplète → erreur gracieuse
- [ ] Réponse vide → validation
- [ ] Division par zéro → erreur explicite

## Tests de Performance

- [ ] Détection dans description > 10 000 caractères
- [ ] Extraction avec > 20 lettres différentes
- [ ] Génération de > 100 combinaisons pour projection carte
- [ ] Calcul de formules très complexes

## Tests d'Accessibilité

- [ ] Navigation au clavier (Tab, Enter)
- [ ] Labels ARIA pour screen readers
- [ ] Contraste des couleurs (WCAG AA)
- [ ] Erreurs explicites et descriptives

---

# DOCUMENTATION

## Documentation Utilisateur

- [ ] Guide de démarrage rapide
- [ ] Tutoriel pas-à-pas avec captures d'écran
- [ ] FAQ
- [ ] Exemples de formules supportées
- [ ] Troubleshooting

## Documentation Technique

- [ ] Architecture du système
- [ ] API Backend (Swagger/OpenAPI)
- [ ] Architecture du widget Theia
- [ ] Guide de contribution
- [ ] Guide de debugging

## Documentation Code

- [ ] JSDoc/TSDoc pour toutes les fonctions publiques
- [ ] Commentaires pour la logique complexe
- [ ] README par module
- [ ] Exemples de code

---

# PROBLÈMES CONNUS ET TODO

## Issues Identifiées

| # | Description | Priorité | Statut |
|---|-------------|----------|--------|
| 1 | [À remplir au fur et à mesure] | - | - |

## Améliorations Futures (Hors Scope Initial)

- [ ] **IA pour détection de formules** : Utiliser LLM pour détecter formules non-standard
- [ ] **IA pour extraction de questions** : Extraction intelligente des questions
- [ ] **IA pour résolution automatique** : Résoudre les questions automatiquement
- [ ] **Historique des tentatives** : Sauvegarder l'historique des calculs
- [ ] **Templates de formules** : Bibliothèque de formules courantes
- [ ] **Export/Import** : Exporter les réponses pour partage
- [ ] **Mode collaboratif** : Résoudre à plusieurs
- [ ] **Suggestions intelligentes** : Suggérer des valeurs probables

---

# CHANGELOG

## [Non publié] - En cours

### Ajouté
- Document de suivi créé
- Plan détaillé des 5 phases

### Modifié
- N/A

### Corrigé
- N/A

---

# NOTES DE SESSION

## Session du [Date]

**Durée** : X heures  
**Travail effectué** :
- 

**Problèmes rencontrés** :
- 

**Décisions prises** :
- 

**À faire prochainement** :
- 

---

**Dernière mise à jour** : 10 novembre 2025, 09:30  
**Prochain jalon** : Phase 1 - Intégration du plugin formula_parser
