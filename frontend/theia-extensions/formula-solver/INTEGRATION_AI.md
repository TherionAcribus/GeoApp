# Intégration IA dans Formula Solver

## Vue d'ensemble

Le Formula Solver supporte désormais un flux **modulaire et rejouable** : l’utilisateur peut choisir, pour chaque étape (Formule → Questions → Réponses), une méthode (algorithme / IA / manuel) et un **profil LLM** (local/fast/strong/web), puis rejouer une étape à tout moment sans perdre le reste.

## Architecture

### Backend (Flask)

#### 1. Service de Recherche Web
**Fichier**: `gc-backend/gc_backend/services/web_search_service.py`

Service pour rechercher des réponses sur Internet via l'API DuckDuckGo.

Fonctionnalités:
- Recherche sans clé API nécessaire
- Parsing et scoring des résultats
- Extraction de la meilleure réponse

#### 2. Endpoints AI / Web
**Fichier**: `gc-backend/gc_backend/blueprints/formula_solver.py`

Endpoints utilisés par GeoApp pour la recherche web (DuckDuckGo) :

- `POST /api/formula-solver/ai/search-answer` - Recherche web (1 question)
- `POST /api/formula-solver/ai/search-answers` - Recherche web batch (N questions)
- `POST /api/formula-solver/ai/suggest-calculation-type` - Suggestion de type de calcul

### Frontend (Theia)

#### 1. Profils LLM (agents internes)
**Fichier**: `src/browser/geoapp-formula-solver-agents.ts`

Agents enregistrés (configurables côté Theia AI) :

- `geoapp-formula-solver-local`
- `geoapp-formula-solver-fast`
- `geoapp-formula-solver-strong`
- `geoapp-formula-solver-web`

Le service LLM sélectionne le modèle via `LanguageModelRegistry.selectLanguageModel({ agent: <agentId>, purpose: 'formula-solving', identifier: 'default/universal' })`.

#### 2. Services & pipeline
- `src/browser/formula-solver-llm-service.ts` : appels LLM (JSON strict + nettoyage “thinking”).
- `src/browser/formula-solver-service.ts` : API backend (base URL via `geoApp.backend.apiBaseUrl`) + web search (single + batch).
- `src/browser/formula-solver-pipeline.ts` : orchestrateur rejouable (stratégies algo/IA/none/manual).
- `src/browser/strategies/*` : implémentations de stratégies par étape.

#### 3. Widget UI
**Fichier**: `src/browser/formula-solver-widget.tsx`

Le widget expose un panneau de configuration par étape (méthode + profil) et des actions “Rejouer” + “Répondre (auto/écraser)” (en masse ou par question).

#### 4. Module DI
**Fichier**: `src/browser/formula-solver-frontend-module.ts`

Enregistrement de:
- `GeoAppFormulaSolverAgentsContribution` (agents local/fast/strong/web)
- `FormulaSolverLLMService` (sélection modèle + parsing)
- `FormulaSolverPipeline` + stratégies

### Préférences

**Fichier**: `shared/preferences/geo-preferences-schema.json`

Préférences principales:
- `geoApp.formulaSolver.formulaDetection.defaultMethod` - `algorithm | ai | manual`
- `geoApp.formulaSolver.questions.defaultMethod` - `none | algorithm | ai`
- `geoApp.formulaSolver.answers.defaultMode` - `manual | ai-bulk | ai-per-question`
- `geoApp.formulaSolver.ai.defaultProfile.*` - `local | fast | strong | web` (par étape)
- `geoApp.formulaSolver.ai.webSearchEnabled` - Autoriser recherche web
- `geoApp.formulaSolver.ai.maxWebResults` - Nombre max de résultats web

Compatibilité: `geoApp.formulaSolver.defaultMethod` reste supportée comme fallback.

## Flux de Résolution avec IA

1. **Utilisateur** colle une description de géocache
2. **Utilisateur** choisit (ou garde) les méthodes/profils par étape
3. **Widget** exécute l’étape Formule (algo/IA/manuel)
4. **Widget** exécute l’étape Questions (algo/IA/aucune) et affiche les champs
5. **Utilisateur** répond manuellement OU lance une résolution IA/Web (en masse ou par question)
6. **Calcul** des coordonnées via l’algorithme (backend `/calculate`)

## Utilisation

### Pour l'Utilisateur

1. Ouvrir le widget Formula Solver
2. Coller la description de la géocache
3. Cliquer sur "Détecter la formule"
4. Ajuster les méthodes/profils et rejouer les étapes si nécessaire (Questions / Réponses)

### Configuration

Exemple (méthodes par défaut):
```json
{
  "geoApp.formulaSolver.formulaDetection.defaultMethod": "algorithm",
  "geoApp.formulaSolver.questions.defaultMethod": "algorithm",
  "geoApp.formulaSolver.answers.defaultMode": "manual"
}
```

Exemple (profils IA):
```json
{
  "geoApp.formulaSolver.ai.defaultProfile.formulaDetection": "fast",
  "geoApp.formulaSolver.ai.defaultProfile.questions": "fast",
  "geoApp.formulaSolver.ai.defaultProfile.answers": "strong"
}
```

## Dépendances

### Backend
- `requests` - Pour les appels web search

### Frontend
- `@theia/ai-core` - Pour Agent, ToolInvocationRegistry, AgentService
- Pas de dépendances supplémentaires (déjà présentes dans Theia)

## Limitations Actuelles

1. **Parsing de réponse agent**: Le parsing de la réponse de l'agent est basique et peut nécessiter des améliorations selon le format exact de réponse de l'AgentService de Theia
2. **Questions complexes**: Les questions nécessitant observation sur place ne peuvent pas être résolues automatiquement
3. **Rate limiting**: Pas de limitation de taux pour les recherches web (à implémenter si nécessaire)
4. **Coûts LLM**: Pas de tracking des tokens utilisés (à implémenter pour monitoring)

## Améliorations Futures

1. **Streaming de réponse**: Afficher les étapes en temps réel pendant la résolution
2. **Historique**: Sauvegarder l'historique des résolutions IA
3. **Feedback**: Permettre à l'utilisateur de corriger les réponses de l'IA
4. **Multi-agents**: Utiliser plusieurs agents spécialisés (détection, résolution, vérification)
5. **Cache**: Mettre en cache les résultats de recherche web
6. **Validation externe**: Intégrer GeoCheck pour valider les coordonnées finales

## Debug

### Logs Backend
Les logs sont préfixés par `[AI]`:
```
[AI] Détection formule: 1 trouvée(s), confiance moyenne: 0.92
[AI] Recherche questions: 6/6 trouvées
[AI] Recherche web: 3 résultats pour 'hauteur tour eiffel'
```

### Logs Frontend
Les logs sont préfixés par `[FORMULA-SOLVER-AI]` ou `[FORMULA-SOLVER-TOOLS]`:
```
[FORMULA-SOLVER-AI] Démarrage résolution IA...
[FORMULA-SOLVER-TOOLS] detect_formula appelé: {...}
[FORMULA-SOLVER-AI] Résultat IA: {...}
```

## Tests

Pour tester l'intégration:

1. **Backend**: Les endpoints AI peuvent être testés directement:
```bash
curl -X POST http://localhost:8000/api/formula-solver/ai/detect-formula \
  -H "Content-Type: application/json" \
  -d '{"text": "N 47° 5A.BC E 006° 5D.EF"}'
```

2. **Frontend**: 
   - Ouvrir Formula Solver
   - Activer le mode IA
   - Coller une formule simple
   - Vérifier les logs dans la console navigateur

## Compatibilité

- **Theia**: Testé avec Theia 1.65.1
- **@theia/ai-core**: Compatible avec les versions récentes supportant Agent et ToolInvocationRegistry
- **Backend**: Python 3.8+, Flask

## Auteur

Intégration IA réalisée selon le plan d'architecture défini dans `integration.plan.md`.

