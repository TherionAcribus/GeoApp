# Formula Solver — Documentation technique

> Extension Theia pour résoudre les formules de coordonnées GPS des géocaches Mystery.  
> Dernière mise à jour : juin 2025

---

## 1. Vue d'ensemble

Formula Solver est une extension Theia qui automatise la résolution de **géocaches Mystery** en 4 étapes :

1. **Détecter** la formule GPS dans le texte de la géocache
2. **Identifier** les variables (lettres) et leurs questions associées
3. **Répondre** aux questions (IA, recherche web, ou manuellement)
4. **Calculer** les coordonnées finales et créer un waypoint

L'extension est conçue avec un **pipeline modulaire** : chaque étape possède plusieurs stratégies interchangeables (algorithme, IA, manuel, web), sélectionnables par l'utilisateur via un panneau de configuration.

---

## 2. Architecture

### 2.1 Structure des fichiers

```
frontend/theia-extensions/formula-solver/
├── src/
│   ├── common/
│   │   └── types.ts                          # Types partagés (Formula, Question, LetterValue, etc.)
│   └── browser/
│       ├── formula-solver-widget.tsx          # Widget React principal (~2700 lignes)
│       ├── formula-solver-pipeline.ts         # Pipeline orchestrateur (3 étapes)
│       ├── formula-solver-config.ts           # Types de configuration (méthodes, profils)
│       ├── formula-solver-service.ts          # Client HTTP vers le backend Flask
│       ├── formula-solver-ai-service.ts       # Service IA legacy (solveWithAI complet)
│       ├── formula-solver-llm-service.ts      # Appels directs au LLM (Theia AI)
│       ├── formula-solver-tools.ts            # 5 AI tools enregistrés dans Theia
│       ├── formula-solver-contribution.ts     # Commandes, menus, toolbar Theia
│       ├── formula-solver-frontend-module.ts  # Bindings Inversify (DI)
│       ├── geoapp-formula-solver-agents.ts    # 4 agents IA (local/fast/strong/web)
│       ├── answering-context-cache.ts         # Cache LRU du contexte IA
│       ├── components/
│       │   ├── index.ts                       # Barrel export
│       │   ├── DetectedFormulasComponent.tsx   # Affichage/sélection des formules
│       │   ├── QuestionFieldsComponent.tsx     # Carte question/variable (lettre + input + boutons)
│       │   ├── FormulaPreviewComponent.tsx     # Prévisualisation coordonnées en temps réel
│       │   ├── ResultDisplayComponent.tsx      # Affichage du résultat final (coordonnées)
│       │   └── BruteForceComponent.tsx         # Interface brute force (combinaisons)
│       ├── preview/
│       │   ├── coordinate-preview-engine.ts   # Moteur de preview (validation, ranges)
│       │   └── types.ts                       # Types preview (AxisPreview, PreviewIssue, etc.)
│       ├── strategies/
│       │   ├── types.ts                       # Interfaces communes (FormulaDetectionResult, etc.)
│       │   ├── formula-detection-strategy.ts  # Interface détection
│       │   ├── algorithm-formula-detector.ts  # Détection par regex (backend)
│       │   ├── ai-formula-detector.ts         # Détection par IA (LLM)
│       │   ├── question-discovery-strategy.ts # Interface questions
│       │   ├── none-question-discovery.ts     # Pas de questions (extraction lettres seules)
│       │   ├── algorithm-question-discovery.ts# Questions par regex (backend)
│       │   ├── ai-question-discovery.ts       # Questions par IA (LLM)
│       │   ├── answering-strategy.ts          # Interface réponses
│       │   ├── ai-bulk-answering.ts           # Réponses IA en bloc
│       │   ├── ai-per-question-answering.ts   # Réponses IA par lettre (+ mode Web)
│       │   └── backend-web-search-answering.ts# Réponses par recherche web pure
│       └── utils/
│           ├── formula-fragments.ts           # Parsing/annotation des fragments de formule
│           └── value-parser.ts                # Parsing de listes de valeurs
```

### 2.2 Backend (Flask)

```
backend/gc_backend/
├── blueprints/
│   └── formula_solver.py          # Blueprint Flask (13 endpoints, préfixe /api/formula-solver)
├── services/
│   ├── web_search_service.py      # Recherche web DuckDuckGo (+ fallback HTML lite)
│   └── formula_questions_service.py # Extraction questions par regex
└── utils/
    └── coordinate_calculator.py   # Calcul des coordonnées finales
```

---

## 3. Pipeline (orchestration)

Le pipeline (`FormulaSolverPipeline`) orchestre 3 étapes indépendantes et rejouables.

### 3.1 Étape 1 — Détection de formule

| Méthode | Classe | Description |
|---------|--------|-------------|
| `algorithm` | `AlgorithmFormulaDetector` | Appelle `POST /detect-formulas` → plugin `formula_parser` (regex backend) |
| `ai` | `AiFormulaDetector` | Appelle `FormulaSolverLLMService.detectFormulasWithAI()` (prompt LLM) |
| `manual` | — | Retourne un tableau vide ; l'utilisateur ajoute la formule à la main |

**Sortie** : `FormulaDetectionResult { formulas: Formula[], meta }`.

Chaque `Formula` contient :
- `id`, `north`, `east` (ex: `"N 47° 5A.BC"`, `"E 006° 5D.EF"`)
- `confidence`, `source`, `text_output`
- `fragments` (optionnel, ajouté par `annotateFormulas()`)

### 3.2 Étape 2 — Découverte des questions

| Méthode | Classe | Description |
|---------|--------|-------------|
| `none` | `NoneQuestionDiscovery` | Extrait uniquement les lettres de la formule, sans question |
| `algorithm` | `AlgorithmQuestionDiscovery` | Appelle `POST /extract-questions` (regex backend) |
| `ai` | `AiQuestionDiscovery` | Appelle `FormulaSolverLLMService.extractQuestionsWithAI()` (prompt LLM) |

**Sortie** : `QuestionDiscoveryResult { questionsByLetter: Map<string, string>, meta }`.

### 3.3 Étape 3 — Réponses aux questions

Deux axes de configuration :
- **Engine** : `'ai'` ou `'backend-web-search'`
- **Mode** (si engine=ai) : `'ai-per-question'` ou `'ai-bulk'`

| Engine / Mode | Classe | Description |
|---------------|--------|-------------|
| `backend-web-search` | `BackendWebSearchAnswering` | Recherche web via `POST /ai/search-answers` (DuckDuckGo, extraction algorithmique) |
| `ai-per-question` | `AiPerQuestionAnswering` | LLM par lettre, avec profil IA par lettre. Support profil `'web'` |
| `ai-bulk` | `AiBulkAnswering` | LLM en un seul appel pour toutes les lettres |

**Sortie** : `AnsweringResult { answersByLetter, detailsByLetter?, meta }`.

Chaque `AnswerDetail` contient :
- `answer`, `source` (`'ai' | 'web'`), `profile`, `explanation`
- `valueType` (`'value' | 'checksum' | 'reduced' | 'length'`)
- `webResults` (si source web) : `{ text, source (URL), score, type }`
- `timestampMs`

### 3.4 Mode "Web + IA" (profil `web`)

Quand une lettre a le profil `web` en mode `ai-per-question` :
1. `AiPerQuestionAnswering._answerWithWebSearch()` est appelé
2. → Recherche web via `FormulaSolverService.searchAnswerWeb()`
3. → Les snippets web sont injectés dans le prompt LLM
4. → Le LLM extrait la réponse intelligente depuis les résultats web
5. Le profil `fast` est utilisé pour l'extraction (le web a déjà fourni l'info)

---

## 4. Agents IA & profils

4 agents Theia sont enregistrés au démarrage (`GeoAppFormulaSolverAgentsContribution`) :

| Profil | Agent ID | Usage |
|--------|----------|-------|
| `local` | `geoapp-formula-solver-local` | LLM local (LMStudio/Ollama), gratuit |
| `fast` | `geoapp-formula-solver-fast` | Cloud léger, rapide et économique |
| `strong` | `geoapp-formula-solver-strong` | Cloud puissant, meilleure qualité |
| `web` | `geoapp-formula-solver-web` | Cloud + Internet (web+IA combiné) |

Chaque agent est configuré dans les paramètres Theia → modèle de langage assigné par l'utilisateur. Le mapping `FormulaSolverAgentIdsByProfile` relie un profil à un agent ID.

Le widget expose 3 profils configurables par étape :
- `aiProfileForFormula` — étape 1
- `aiProfileForQuestions` — étape 2
- `aiProfileForAnswers` — étape 3 (défaut)

En plus, chaque lettre peut avoir son propre profil (`perQuestionProfiles`), sélectionnable via un dropdown dans la carte question.

---

## 5. Cache du contexte IA (`AnsweringContextCache`)

Avant de répondre aux questions, le pipeline construit un **contexte préparé** via `FormulaSolverLLMService.buildAnsweringContext()` :
- `geocache_summary` — résumé utile de la géocache
- `global_rules` — règles de format déduites du listing (articles, casse, etc.)
- `per_letter_rules` — règle spécifique par lettre si déductible

Ce contexte est **caché** (clé = `profile|id|title|textHash|questionsHash`) avec un LRU de 10 entrées. Il est réutilisé pour chaque lettre, ce qui :
- évite de rappeler le LLM pour chaque question
- stabilise les réponses (mêmes règles pour toute la session)

L'utilisateur peut :
- **Visualiser/éditer** le contexte JSON dans un panneau dédié
- **Forcer le recalcul** (ignore le cache)
- **Activer un override** (utiliser son propre JSON)

---

## 6. Recherche web (backend)

### 6.1 Service `WebSearchService`

Fichier : `backend/gc_backend/services/web_search_service.py`

**Moteurs** (par priorité) :
1. `duckduckgo-search` (librairie Python) — vrais résultats de recherche web
   - Instant answers (`ddgs.answers()`) : score 0.95
   - Résultats textuels (`ddgs.text()`, région `fr-fr`) : score 0.85→0.35
2. Fallback DuckDuckGo Instant Answer API (`api.duckduckgo.com`, JSON)
3. Fallback DuckDuckGo HTML Lite (`html.duckduckgo.com/html/`, scraping BeautifulSoup)

### 6.2 Nettoyage des requêtes (`_clean_query_for_search`)

Les questions de géocaching contiennent du bruit (instructions de calcul) qui pollue les recherches web. Le service nettoie automatiquement :

| Pattern retiré | Exemple |
|----------------|---------|
| Instructions checksum | "cherche son checksum réduit" |
| Instructions longueur | "nombre de lettres", "combien de lettres dans" |
| Parenthèses d'exclusion | "(pas le prénom!)" |
| Mots interrogatifs | "Quel est", "Quelle était" |
| Ponctuation parasite | `()!?;` |

**Exemple** :
```
"Quel était l'animal le plus connu lors des jeux de Moscou, cherche son nombre de lettres.(pas le prénom!)"
→ "animal le plus connu lors des jeux de Moscou"
```

### 6.3 Extraction de réponse (`extract_answer`)

Pour le mode "Internet pur" (sans IA), le service tente d'extraire algorithmiquement :
1. Si instant answer → retourner directement
2. Sinon, extraire le premier nombre du snippet le plus pertinent
3. En dernier recours, retourner le snippet entier

---

## 7. Endpoints backend

Blueprint : `formula_solver_bp`, préfixe `/api/formula-solver`

### 7.1 Endpoints principaux

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/detect-formulas` | Détecte les formules GPS (texte brut ou geocache_id) |
| POST | `/extract-questions` | Extrait les questions par regex pour des lettres données |
| POST | `/calculate` | Calcule les coordonnées finales (formule + valeurs) |
| POST | `/calculate-batch` | Calcule N combinaisons en un seul appel (brute force). Renvoie `results[]` (chaque entrée : `values`, `status`, `coordinates?`, `distance?`, `error?`), plus `success_count`/`error_count`. Limite backend : 2000 combinaisons |
| GET | `/geocache/<id>` | Récupère le texte d'une géocache pour le solver |
| POST | `/geocache/<id>/waypoint` | Crée un waypoint depuis le résultat |

### 7.2 Endpoints IA / Tools

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/ai/detect-formula` | Détection enrichie pour l'agent IA |
| POST | `/ai/find-questions` | Recherche questions pour l'agent IA |
| POST | `/ai/search-answer` | Recherche web une question (DuckDuckGo) |
| POST | `/ai/search-answers` | Recherche web batch (plusieurs questions) |
| POST | `/ai/suggest-calculation-type` | Suggère le type de calcul pour une réponse |

### 7.3 Utilitaire

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/update-description-raw` | Migration : extrait description_raw depuis description_html |

### 7.4 Helper partagé `_get_geocache_text()`

Fonction utilitaire factorisée utilisée par 3 endpoints (`detect-formulas`, `geocache/<id>`, `ai/detect-formula`). Logique de fallback :

```
1. geocache.description_raw       (texte déjà nettoyé du HTML)
2. geocache.description_html      → BeautifulSoup.get_text(strip=True)
3. geocache.description           (champ brut, dernier recours)
+ waypoints additionnels (notes)  (si include_waypoints=True)
```

---

## 8. AI Tools (pour l'agent conversationnel)

5 tools enregistrés dans Theia via `FormulaSolverToolsManager` (provider: `formula-solver`) :

| Tool | ID | Description |
|------|----|-------------|
| `detect_formula` | `formula-solver.detect-formula` | Détecte les formules GPS dans un texte |
| `find_questions_for_variables` | `formula-solver.find-questions` | Trouve les questions associées aux variables |
| `search_answer_online` | `formula-solver.search-answer` | Recherche une réponse sur Internet |
| `calculate_variable_value` | `formula-solver.calculate-value` | Calcule une valeur (checksum, longueur, etc.) |
| `calculate_final_coordinates` | `formula-solver.calculate-coordinates` | Calcule les coordonnées finales |

Ces tools permettent à l'agent conversationnel GeoApp de résoudre des géocaches en autonomie.

---

## 9. Preview en temps réel (`CoordinatePreviewEngine`)

Le moteur de preview calcule les coordonnées **en temps réel** à chaque changement de valeur, sans appeler le backend.

### 9.1 Fonctionnement

1. **Parse** la formule en template : cardinal + degrés + minutes + décimales
2. **Tokenize** chaque segment : digits (`123`), letters (`ABC`), expressions (`(A+B)`)
3. **Résout** en substituant les valeurs connues, laissant `?` pour les inconnues
4. **Calcule** les ranges min/max pour chaque segment
5. **Valide** :
   - Longueur attendue (2 digits degrés nord, 3 est, etc.)
   - Plages (degrés 0-90/180, minutes 0-59, décimales 0-999)
   - Expressions négatives ou non-entières
6. **Détecte les lettres suspectes** : identifie quelles lettres causent un dépassement de range

### 9.2 Statuts

| Statut | Signification |
|--------|---------------|
| `valid` | Coordonnée complète et dans les plages |
| `incomplete` | Lettres manquantes |
| `invalid` | Erreur détectée (range, longueur, expression) |

Les lettres suspectes sont mises en évidence rouge dans le widget.

---

## 10. Widget (`FormulaSolverWidget`)

Widget Theia (`ReactWidget`) enregistré sous l'ID `formula-solver:widget`, zone `right`, rang 300.

### 10.1 État (`FormulaSolverState`)

```typescript
interface FormulaSolverState {
    currentStep: 'detect' | 'questions' | 'values' | 'calculate';
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    text?: string;
    originLat?: number;
    originLon?: number;
    formulas: Formula[];
    selectedFormula?: Formula;
    questions: Question[];
    values: Map<string, LetterValue>;
    result?: CalculationResult;
    loading: boolean;
    error?: string;
}
```

### 10.2 Composants React extraits

| Composant | Fichier | Rôle |
|-----------|---------|------|
| `DetectedFormulasComponent` | `components/DetectedFormulasComponent.tsx` | Liste des formules détectées, sélection, édition |
| `QuestionFieldCard` | `components/QuestionFieldsComponent.tsx` | Carte par lettre : question éditable, profil IA, boutons IA/Internet, détail réponse, valeur |
| `FormulaPreviewComponent` | `components/FormulaPreviewComponent.tsx` | Preview coordonnées temps réel |
| `ResultDisplayComponent` | `components/ResultDisplayComponent.tsx` | Résultat final (coordonnées, copie, waypoint) |
| `BruteForceComponent` | `components/BruteForceComponent.tsx` | Configuration et lancement du brute force |

### 10.3 Types de valeurs (`ValueType`)

Chaque lettre a un type de calcul appliqué automatiquement :

| Type | Description | Exemple |
|------|-------------|---------|
| `value` | Nombre direct | `1867` → `1867` |
| `checksum` | Somme des chiffres (ou positions alpha A=1..Z=26) | `"Paris"` → `16+1+18+9+19 = 63` |
| `reduced` | Checksum itératif jusqu'à 1 chiffre | `63` → `9` |
| `length` | Longueur sans espaces | `"Paris"` → `5` |

Le type peut être :
- Déduit par l'IA (champ `valueType` dans `AnswerDetail`)
- Choisi manuellement via le dropdown dans la carte question
- Appliqué globalement via `globalValueType`

### 10.4 Question éditable

Le texte de chaque question est un `<input>` éditable (`defaultValue` + `key`, mode uncontrolled) permettant :
- Modifier la question avant de lancer IA ou Internet
- `Ctrl+Z` / `Ctrl+Y` natifs (historique undo préservé car pas de re-render à chaque frappe)
- La modification met à jour `this.state.questions[idx].question` sans `this.update()`

### 10.5 Liens web cliquables

Les URL des résultats web (`AnswerDetail.webResults[].source`) sont rendues comme des liens `<a>` avec `onClick → window.open(url, '_blank')` pour ouvrir dans le navigateur externe (hors Theia).

### 10.6 Brute Force

Le widget supporte un mode brute force :
1. `BruteForceComponent` génère les combinaisons de valeurs possibles pour les lettres incomplètes
2. `executeBruteForceFromCombinations()` teste toutes les combinaisons en un seul appel `/calculate-batch` (`executeBruteForceFromFields()` génère les combinaisons puis délègue à cette méthode)
3. Les résultats valides sont affichés avec boutons "Créer waypoint" / "Ajouter & valider"

---

## 11. Injection de dépendances (Inversify)

Tous les bindings sont dans `formula-solver-frontend-module.ts` :

```
Service                     → Scope
─────────────────────────── ─────────────
FormulaSolverService        → singleton (client HTTP)
FormulaSolverAIService      → singleton (service IA legacy)
FormulaSolverLLMService     → singleton (appels LLM)
AnsweringContextCache       → singleton (cache contexte)
FormulaSolverPipeline       → singleton (orchestrateur)
AlgorithmFormulaDetector    → singleton
AiFormulaDetector           → singleton
NoneQuestionDiscovery       → singleton
AlgorithmQuestionDiscovery  → singleton
AiQuestionDiscovery         → singleton
AiBulkAnswering             → singleton
AiPerQuestionAnswering      → singleton
BackendWebSearchAnswering   → singleton
FormulaSolverWidget         → singleton
FormulaSolverContribution   → singleton (commands/menus)
GeoAppFormulaSolverAgents   → singleton (agents IA)
```

---

## 12. Flux de données complet

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│   Widget (UI)   │─────▶│  Pipeline            │─────▶│  Stratégie          │
│                 │      │  detectFormula()      │      │  AlgorithmDetector  │
│  renderDetect   │      │  discoverQuestions()  │      │  AiDetector         │
│  renderQuestions │      │  answerQuestions()    │      │  WebSearchAnswering │
│  renderCalculate│      │                      │      │  AiPerQuestion      │
└────────┬────────┘      └──────────────────────┘      └─────────┬───────────┘
         │                                                        │
         │ (calcul local)                                         │
         ▼                                                        ▼
┌─────────────────┐                                   ┌─────────────────────┐
│ PreviewEngine   │                                   │ FormulaSolverService│
│ (temps réel)    │                                   │ (HTTP client)       │
│                 │                                   │         │           │
│ parse template  │                                   │         ▼           │
│ tokenize        │                                   │ ┌───────────────┐   │
│ substitute      │                                   │ │ Backend Flask │   │
│ validate ranges │                                   │ │ /api/formula- │   │
└─────────────────┘                                   │ │ solver/*      │   │
                                                      │ └───────┬───────┘   │
                                                      │         │           │
                                                      │         ▼           │
                                                      │ ┌───────────────┐   │
                                                      │ │WebSearchSvc   │   │
                                                      │ │DuckDuckGo     │   │
                                                      │ └───────────────┘   │
                                                      └─────────────────────┘

┌─────────────────┐
│ LLM Service     │◀── callLLM(prompt, task, profile)
│ (Theia AI)      │
│                 │──▶ LanguageModelRegistry.selectLanguageModel()
│ detectFormulas  │──▶ LanguageModelService.sendRequest()
│ extractQuestions│
│ buildContext    │
│ answerQuestion  │
└─────────────────┘
```

---

## 13. Commandes Theia

| Commande | ID | Description |
|----------|----|-------------|
| Ouvrir Formula Solver | `formula-solver.open` | Ouvre le panneau |
| Résoudre depuis géocache | `formula-solver.solve-from-geocache` | Charge une géocache et lance la détection |

---

## 14. Points d'extension / évolutions possibles

- ~~**Brute force batch** : ajouter un endpoint `/calculate-batch`~~ ✅ Implémenté — le brute force envoie désormais toutes les combinaisons en un seul POST au lieu de N appels séquentiels
- **Nouveaux moteurs de recherche** : ajouter Google Custom Search, Bing, etc. au `WebSearchService`
- **Persistance** : sauvegarder l'état du solver (formule + valeurs) dans la BDD pour reprendre plus tard
- **Export** : exporter les résultats (coordonnées + raisonnement) en format texte/CSV
- **Tests** : ajouter des tests unitaires pour `CoordinatePreviewEngine` et `_clean_query_for_search`
