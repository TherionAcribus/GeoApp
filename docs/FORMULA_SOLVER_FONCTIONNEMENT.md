# Formula Solver — Fonctionnement

Ce document décrit le fonctionnement du **Formula Solver** (frontend Theia + backend Flask) : objectifs, architecture, flux d’exécution, points de configuration, et debug.

## Objectif

Le Formula Solver aide à résoudre une géocache mystère en :

- détectant une **formule de coordonnées** (N/E) dans le texte,
- identifiant les **variables** (A, B, C…),
- trouvant les **questions / consignes** associées à ces variables,
- assistant la **saisie/résolution des valeurs** (manuel, IA, ou recherche web backend),
- calculant les **coordonnées finales**.

Point clé : le flux est **modulaire** et **rejouable** par étape. L’utilisateur peut relancer une étape avec une autre méthode sans repartir de zéro.

## Vue d’ensemble (architecture)

### Frontend (Theia)

Le frontend fournit :

- une **UI** (widget) et des contrôles par étape,
- un **pipeline** rejouable (orchestrateur) basé sur des stratégies,
- des services d’accès backend (regex, web search, calculate, etc.),
- une intégration LLM via **agents** (local/fast/strong/web) + parsing JSON strict,
- un cache de contexte IA (résumé + règles) pour les réponses.

Fichiers principaux :

- UI : `theia-blueprint/theia-extensions/formula-solver/src/browser/formula-solver-widget.tsx`
- Orchestration : `theia-blueprint/theia-extensions/formula-solver/src/browser/formula-solver-pipeline.ts`
- Appels LLM + prompts : `theia-blueprint/theia-extensions/formula-solver/src/browser/formula-solver-llm-service.ts`
- API backend : `theia-blueprint/theia-extensions/formula-solver/src/browser/formula-solver-service.ts`
- Stratégies : `theia-blueprint/theia-extensions/formula-solver/src/browser/strategies/*`
- Cache contexte réponses : `theia-blueprint/theia-extensions/formula-solver/src/browser/answering-context-cache.ts`
- Agents IA : `theia-blueprint/theia-extensions/formula-solver/src/browser/geoapp-formula-solver-agents.ts`

### Backend (Flask)

Le backend fournit :

- extraction **regex** des questions (support de plusieurs formats),
- recherche web (DuckDuckGo) pour répondre à des questions,
- endpoints de calcul (selon implémentation backend existante).

Fichiers principaux :

- routes : `gc-backend/gc_backend/blueprints/formula_solver.py`
- extraction regex : `gc-backend/gc_backend/services/formula_questions_service.py`
- recherche web : `gc-backend/gc_backend/services/web_search_service.py`

## Pipeline : étapes et stratégies

Le pipeline est une suite d’étapes indépendantes, chacune configurable. Chaque étape choisit une **stratégie** (pattern Strategy) selon la configuration.

### Étape 1 — Détection de formule

Objectif : produire une ou plusieurs formules candidates (N/E).

Stratégies (exemples) :

- **algorithm** : heuristiques/regex côté frontend (selon code existant)
- **ai** : LLM (détection sémantique + JSON strict)
- **manual** : saisie utilisateur (Nord + Est)

### Étape 2 — Découverte des questions / consignes

Objectif : associer à chaque lettre (A, B, C…) une consigne “question”, afin d’afficher les champs et guider la saisie.

Stratégies :

- **algorithm** : appel backend regex (`FormulaQuestionsService.extract_questions_with_regex`)
- **ai** : LLM (extraction) + heuristiques de post-traitement (ex. éviter “A=1, B=2…”)
- **none** : aucune découverte (affiche quand même les champs selon variables détectées)

Formats supportés côté regex (backend) :

- `A. ...`, `B: ...`, `C) ...`, `1. (D) ...`
- `A = ...` (très courant dans les listings mystère)

### Étape 3 — Réponses aux questions

Objectif : remplir les valeurs des lettres (ou aider à le faire).

Modes :

- **manual** : l’utilisateur saisit tout
- **ai-bulk** : LLM répond à plusieurs lettres en une fois
- **ai-per-question** : LLM répond lettre par lettre (plus contrôlable)

Engines (moteur de réponse) :

- **ai** : LLM via agents (local/fast/strong/web)
- **backend-web-search** : recherche web DuckDuckGo (single/batch) via backend

Contexte “réponse IA” (si IA) :

- Construction d’un contexte préparé : résumé + règles globales + règles par lettre
- Cache local (frontend) pour éviter de recalculer le contexte à chaque clic “Répondre”
- Possibilité de fournir des **instructions supplémentaires** et des **infos par lettre** (UI)

### Étape 4 — Calcul des coordonnées

Objectif : évaluer les expressions N/E avec les valeurs.

Notes :

- Les fragments de formule distinguent les parties “cardinal” (N/E) et “expression”.
- Les lettres (y compris `E`) peuvent être des variables dans les expressions ; les points cardinaux ne doivent pas polluer la liste des variables.

#### Prévisualisation (temps réel) : substitution / calcul / mix

Le Formula Solver affiche une **preview en temps réel** des coordonnées pendant la saisie des valeurs.

Elle supporte les cas fréquents :

- **Substitution** : `N48°AB.ABC E006°DE.DEA`
- **Calcul** : `N49°12.(A+B+C+D+E+F-62) E006°00.(G+H+I+J+K+L-516)`
- **Mix** (concat + expressions) : `N48°AB.(A+B)C E006°DE.(D+F-A)EA`

Comportement :

- Tant que des lettres manquent, la preview affiche des `?` mais reste lisible (ex: `N48°12.??3`), au lieu de “format invalide”.
- Dès qu’une sous‑expression devient calculable (toutes ses lettres connues), elle est évaluée et injectée dans la preview.
- Les contrôles de validité (degrés/minutes/décimales) sont effectués **même partiellement** via des bornes min/max.

Implémentation :

- Moteur : `theia-blueprint/theia-extensions/formula-solver/src/browser/preview/coordinate-preview-engine.ts`
- Types : `theia-blueprint/theia-extensions/formula-solver/src/browser/preview/types.ts`
- UI : `theia-blueprint/theia-extensions/formula-solver/src/browser/components/FormulaPreviewComponent.tsx`

#### “Suspects” (valeurs probablement fausses)

Quand une incohérence est détectée (ex: minutes forcément ≥ 60, résultat négatif, overflow de longueur, etc.), le moteur produit des **suspects** :

- Les suspects sont des **lettres déjà renseignées** impliquées dans l’incohérence.
- Ils sont calculés de manière **plus fine** (au niveau des digits) quand c’est possible.

UI :

- Les champs A/B/C… suspects sont **surlignés** dans la liste des questions (étape 2), pour guider la correction.

#### Overlay carte (zone estimée) — optionnel

En plus de la preview texte, GeoApp peut afficher sur la carte une **zone estimée** en temps réel :

- point (coordonnées complètes),
- ligne latitude / ligne longitude (si un seul axe est totalement déterminé),
- rectangle/bounding box (si les deux axes sont partiels).

Contrôle :

- La préférence `geoApp.formulaSolver.preview.mapOverlayEnabled` (défaut `true`) active/désactive cet overlay.
  Voir `docs/PREFERENCES.md`.

## Fonctionnement UI (widget)

Le widget expose :

- un panneau de configuration par étape (méthode + profil IA),
- des actions **Rejouer** pour relancer une étape,
- des actions de réponse :
  - **Répondre (auto)** : remplit uniquement les champs vides
  - **Répondre (écraser)** : remplace les valeurs existantes
  - **Répondre** sur une lettre (en mode per-question)
- des actions de re-détection des questions :
  - **Questions (Regex)** : force la stratégie backend regex
  - **Questions (IA)** : force la stratégie IA

### Contrôle des prompts / contexte IA (réponses)

Dans l’étape Questions, un panneau “IA : Contexte & consignes de réponse” permet :

- **Charger / rafraîchir** le contexte (cache),
- **Forcer recalcul** (ignore le cache),
- **visualiser et modifier** le contexte sous forme JSON,
- activer “**Utiliser mon contexte (override)**” pour imposer ce JSON aux stratégies de réponse IA,
- définir des **instructions supplémentaires** appliquées à chaque requête de réponse.

Chaque lettre possède aussi un champ “info complémentaire” (optionnel) injecté dans la requête de réponse de cette lettre.

## Profils IA (agents)

Le Formula Solver utilise 3 agents internes (IDs) pour permettre de changer de “capacité” de LLM :

- `geoapp-formula-solver-local` : LLM local (LMStudio/Ollama)
- `geoapp-formula-solver-fast` : rapide / économique (petit modèle)
- `geoapp-formula-solver-strong` : plus puissant
- `geoapp-formula-solver-web` : orienté web (si modèle/infra le supporte)

Le profil est sélectionnable :

- par étape (détection formule, questions, réponses) via préférences et UI,
- par lettre (override UI) en mode “ai-per-question”.

## Préférences

Voir `docs/PREFERENCES.md` (section “Formula Solver (préférences)”).

Résumé des clés principales :

- Méthodes par défaut :
  - `geoApp.formulaSolver.formulaDetection.defaultMethod` : `algorithm | ai | manual`
  - `geoApp.formulaSolver.questions.defaultMethod` : `none | algorithm | ai`
  - `geoApp.formulaSolver.answers.defaultMode` : `manual | ai-bulk | ai-per-question`
- Profils IA par défaut :
  - `geoApp.formulaSolver.ai.defaultProfile.formulaDetection` : `local | fast | strong | web`
  - `geoApp.formulaSolver.ai.defaultProfile.questions` : `local | fast | strong | web`
  - `geoApp.formulaSolver.ai.defaultProfile.answers` : `local | fast | strong | web`
- Web search :
  - `geoApp.formulaSolver.ai.webSearchEnabled`
  - `geoApp.formulaSolver.ai.maxWebResults`

## API backend utilisée

Selon les stratégies appelées :

- Extraction questions (regex) : endpoint Formula Solver backend (méthode `regex`)
- Web search :
  - `POST /api/formula-solver/ai/search-answer` (1 question)
  - `POST /api/formula-solver/ai/search-answers` (batch)

Le base URL est piloté côté frontend par la préférence `geoApp.backend.apiBaseUrl`.

## Logs / debug

### Préfixes de logs utiles

- Frontend : `[FORMULA-SOLVER]`, `[FORMULA-SOLVER-LLM]`
- Backend : logs service regex + web search (selon configuration Loguru)

### Problèmes fréquents

- **Le modèle IA renvoie des numéros (“A”: “1”)** :
  - utiliser “Questions (Regex)” si le listing suit `A = ...`,
  - ou fournir un hint dans “Aide IA (questions)”,
  - le frontend tente aussi une récupération automatique `A = ...` si l’IA renvoie un numéro.

- **Erreur de longueur de contexte (LLM local)** :
  - le texte est tronqué (début+fin) pour limiter les dépassements,
  - si le modèle est très limité, préférer `fast/strong` selon le provider ou réduire la taille du listing.

- **Résultats incohérents entre lettres** :
  - activer le contexte préparé (cache) pour stabiliser les règles,
  - utiliser “Forcer recalcul” si le listing ou les questions ont changé.

## Notes / limites

- Beaucoup de questions nécessitent une observation sur place (l’IA ne peut pas deviner).
- Les réponses IA doivent parfois respecter des formats très stricts (casse, accents, article, sans espaces, etc.) : d’où l’importance du contexte/règles et des overrides.

---

Pour les détails de l’intégration IA (agents, outils, endpoints), voir aussi :
`theia-blueprint/theia-extensions/formula-solver/INTEGRATION_AI.md`.

