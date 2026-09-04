# Documentation technique - Chat IA GeoApp

## 1. Objectif

Ce document décrit l'architecture technique du Chat IA GeoApp moderne, intégré à Theia.

Il couvre :

- les agents IA GeoApp ;
- la résolution des modèles et des profils ;
- la policy effective des tools ;
- les prompt packs ;
- les skills GeoApp ;
- l'import/export de configuration ;
- la vue de diagnostic ;
- les tests ;
- les points d'extension.

Le système a été conçu pour rester compatible avec Theia. GeoApp ne remplace pas le chat IA Theia : il l'étend en utilisant ses agents, son `LanguageModelService`, son `PromptService`, son `ToolInvocationRegistry`, son système de skills et sa couche de confirmation des tools.

## 2. Fichiers principaux

| Fichier | Rôle |
|---|---|
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-agent.ts` | Déclare les agents IA GeoApp et injecte prompt + policy + tools dans les requêtes LLM. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-shared.ts` | Types, constantes, préférences, profils, résolution des workflows et helpers de session. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-tool-catalog.ts` | Catalogue des tools GeoApp exposables à l'IA. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-policy-service.ts` | Calcule la policy effective : tools actifs, bloqués, à confirmation, skills actives, diagnostics et prompt final. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-system-prompts.ts` | Déclare le prompt système GeoApp et ses variantes. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-skills.ts` | Déclare les skills GeoApp intégrées et leurs métadonnées. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-skill-seeder.ts` | Installe/rafraîchit les skills GeoApp dans le dossier de configuration Theia. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-skill-state-service.ts` | Inspecte, restaure, exporte et importe les skills GeoApp personnalisées. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-configuration-service.ts` | Gère l'import/export complet de la configuration IA GeoApp. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-policy-widget.tsx` | Interface de diagnostic et de configuration avancée. |
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-bridge.ts` | Ouvre/reprend les sessions Chat IA depuis les widgets GeoApp ; télécharge et redimensionne les images en parallèle. |
| `frontend/theia-extensions/zones/src/browser/geocache-listing-tools-manager.ts` | Enregistre le tool read-only `get_geocache_listing` (listing complet d'une géocache). |
| `frontend/theia-extensions/zones/src/browser/geoapp-outing-analyzer-agent.ts` | Agent chat `geoapp-outing-analyzer` et son enregistrement Theia. |
| `frontend/theia-extensions/zones/src/browser/outing-analysis-types.ts` | Contrat du bundle d'analyse de sortie, préréglages de détail, constantes partagées. |
| `frontend/theia-extensions/zones/src/browser/outing-analysis-prompt.ts` | Mise en forme du bundle en prompt Markdown et estimation de sa taille. |
| `frontend/theia-extensions/zones/src/browser/outing-analysis-controller.ts` | Enchaînement de l'analyse, partagé par la table de zone et le log-editor. |
| `backend/gc_backend/services/outing_analysis_service.py` | Construction du bundle : listing, hint, attributs, waypoints, santé, logs. |
| `backend/gc_backend/services/outing_health.py` | Santé d'une géocache calculée depuis ses logs locaux. |
| `backend/gc_backend/services/outing_gear_signals.py` | Traduction des attributs Geocaching.com en signaux matériel. |
| `backend/gc_backend/services/outing_lexicons.py` | Lexiques matériel et « recherche longue », FR + EN. |
| `backend/gc_backend/services/outing_geography.py` | Étendue du lot, ordre de visite, groupes de marche. |
| `backend/gc_backend/services/outing_sun.py` | Lever, coucher et crépuscules civils (NOAA, sans API). |
| `frontend/theia-extensions/zones/src/browser/zones-frontend-module.ts` | Wiring Inversify/Theia des services, widgets et agents. |
| `frontend/theia-extensions/documentation/src/browser/doc-action-tools.ts` | Tools `aide_*` propres à l'agent documentaire `@Aide`, dont les actions de gestion des zones. |
| `frontend/theia-extensions/documentation/src/browser/doc-agent.ts` | Agent `@Aide`, prompt documentaire et injection directe des tools `aide_*`. |
| `frontend/theia-extensions/documentation/docs/ia/chat-geoapp.md` | Documentation utilisateur finale. |

## 3. Architecture générale

Flux simplifié :

```text
Widget GeoApp / utilisateur
        |
        v
GeoAppChatBridge
        |
        v
ChatService Theia
        |
        v
GeoAppChatAgent
        |
        +--> GeoAppChatPolicyService
        |       +--> GeoAppAiToolCatalog
        |       +--> PreferenceService
        |       +--> PromptService
        |
        +--> PromptService Theia
        |
        v
LanguageModelService Theia
        |
        v
Modèle IA
        |
        v
Tool calls Theia
        |
        v
ChatToolRequestService / ToolInvocationRegistry / handlers GeoApp
```

Principes :

- Theia reste la source de vérité pour le chat, les agents, les modèles, les prompts, les skills et les tools.
- GeoApp ajoute une policy locale qui décide quels tools GeoApp sont réellement envoyés au modèle.
- Les décisions sont prises à chaque requête, pas globalement.
- Les préférences sont stockées dans Theia via `PreferenceService`.
- Les actions sensibles restent compatibles avec la confirmation Theia.

## 4. Agents IA GeoApp

Les agents sont déclarés dans `geoapp-chat-agent.ts`.

Agents disponibles :

| Agent | ID | Usage |
|---|---|---|
| Principal | `GeoApp` | Agent GeoApp générique. |
| Local | `geoapp-chat-local` | Modèle local ou économique. |
| Fast | `geoapp-chat-fast` | Réponses rapides. |
| Strong | `geoapp-chat-strong` | Raisonnement plus robuste. |
| Web | `geoapp-chat-web` | Cas pouvant utiliser un modèle connecté. |
| Analyse de sortie | `geoapp-outing-analyzer` | Rapport de préparation de sortie sur un lot de géocaches (voir § 31). |

Chaque agent partage la même base technique via `BaseGeoAppChatAgent`.

`geoapp-outing-analyzer` est le seul à ne pas utiliser le prompt système du chat : il a le
sien (`GEOAPP_OUTING_SYSTEM_PROMPT_ID`) et surcharge `getSystemMessageDescription()` pour
l'imposer. Il est déclaré dans `geoapp-outing-analyzer-agent.ts`, avec sa propre
`FrontendApplicationContribution` d'enregistrement — le faire enregistrer par
`GeoAppChatAgentContribution` créerait un cycle d'import, puisqu'il importe déjà
`BaseGeoAppChatAgent` depuis `geoapp-chat-agent.ts`.

### Agents internes spécialisés (non-chat)

Ces agents ne participent pas au Chat IA : ils permettent uniquement d'assigner un modèle LLM dédié à une tâche spécifique via les réglages Theia.

| Agent | ID | Fichier | Usage |
|---|---|---|---|
| GeoApp OCR | `geoapp-ocr` | `geoapp-ocr-agent.ts` | OCR vision Cloud (galerie d'images). |
| GeoApp Traduction | `geoapp-translate-description` | `geoapp-translate-description-agent.ts` | Traduction HTML des descriptions de géocaches. |
| GeoApp Logs Analyzer | `geoapp-logs-analyzer` | `geoapp-logs-analyzer-agent.ts` | Analyse des logs de géocaches. |
| GeoApp Log Writer | `geoapp-log-writer` | `geoapp-log-writer-agent.ts` | Rédaction de logs de géocaches. |
| GeoApp AI Scorer | `geoapp-ai-scorer` | `geoapp-ai-scorer-agent.ts` | Scoring IA des résultats de plugins. |

### AI Scorer - Architecture

L'**AI Scorer** (`geoapp-ai-scorer`) est un agent interne qui permet d'assigner un modèle LLM dédié au scoring des résultats de plugins.

**Problème résolu :** Le scoring algorithmique (scorer.py) peut échouer sur des textes inhabituels : mots collés, langues rares, coordonnées en toutes lettres. L'IA détecte ces cas là où les quadgrammes et les regex échouent.

**Flux :**

```
PluginResultDisplay (bouton Analyser avec IA)
  -> PluginsService.aiScoreItems()
  -> POST /api/plugins/ai-score
  -> ai_scorer_service.py (prompt + LLM + parsing JSON)
  -> LLM assigné a geoapp-ai-scorer
```

**Sortie :** identique au scoring algorithmique - `confidence` (0-1), `metadata.ai_scoring`, `coordinates` si détectées.

**Tool Chat :** `geoapp.plugins.ai.score` (nom: `ai_score_plugin_results`) - permet au Chat IA de déclencher l'analyse sur une liste de résultats.

**Fichiers :**

| Fichier | Rôle |
|---|---|
| `backend/gc_backend/services/ai_scorer_service.py` | Service Python : prompt, appel LLM, parsing. |
| `backend/gc_backend/blueprints/plugins.py` | Endpoint `POST /api/plugins/ai-score`. |
| `frontend/.../geoapp-ai-scorer-agent.ts` | Déclaration agent Theia. |
| `frontend/.../plugin-tools-manager.ts` | Tool `ai_score_plugin_results` + handler. |
| `frontend/.../plugins-service.ts` | Méthode `aiScoreItems()`. |
| `frontend/.../plugin-result-display.tsx` | Bouton Analyser avec IA dans le panneau. |
| `frontend/.../geoapp-chat-tool-catalog.ts` | Entrée catalogue `geoapp.plugins.ai.score`. |
| `frontend/.../zones-frontend-module.ts` | Binding Inversify. |

### Enregistrement dans Theia

`GeoAppChatAgentContribution.onStart()` :

1. désenregistre chaque agent GeoApp s'il existe déjà ;
2. le réenregistre auprès de `AgentService`.

Cela permet à Theia de voir les agents comme des agents IA natifs, configurables via les réglages IA Theia.

### Sélection du modèle

Tous les agents utilisent :

```ts
const GeoAppChatLanguageModelRequirements = [{
    purpose: 'chat',
    identifier: 'default/universal',
}];
```

La sélection précise du fournisseur et du modèle reste gérée par Theia.

## 5. Profils de modèle

Les profils de modèle sont séparés des profils comportementaux.

Types :

```ts
type GeoAppChatProfile = 'local' | 'fast' | 'strong' | 'web';
type GeoAppChatWorkflowProfile = 'default' | GeoAppChatProfile;
```

Préférences :

| Préférence | Description |
|---|---|
| `geoApp.chat.defaultProfile` | Profil modèle par défaut. |
| `geoApp.chat.workflowProfile.secretCode` | Profil modèle pour codes secrets. |
| `geoApp.chat.workflowProfile.formula` | Profil modèle pour formules. |
| `geoApp.chat.workflowProfile.checker` | Profil modèle pour checkers. |
| `geoApp.chat.workflowProfile.hiddenContent` | Profil modèle pour contenu caché. |
| `geoApp.chat.workflowProfile.imagePuzzle` | Profil modèle pour image/OCR. |

La fonction `resolveGeoAppChatProfileForWorkflow()` décide le profil modèle effectif.

## 6. Profils comportementaux

Les profils comportementaux répondent à la question : jusqu'où l'IA peut-elle aller automatiquement ?

Types :

```ts
type GeoAppChatBehaviorProfile =
    'guided'
    | 'safe'
    | 'offline'
    | 'automation'
    | 'debug';
```

Préférences :

| Préférence | Description |
|---|---|
| `geoApp.chat.behaviorProfile.default` | Profil comportemental par défaut. |
| `geoApp.chat.behaviorProfile.workflow.secretCode` | Override comportemental pour codes secrets. |
| `geoApp.chat.behaviorProfile.workflow.formula` | Override comportemental pour formules. |
| `geoApp.chat.behaviorProfile.workflow.checker` | Override comportemental pour checkers. |
| `geoApp.chat.behaviorProfile.workflow.hiddenContent` | Override comportemental pour contenu caché. |
| `geoApp.chat.behaviorProfile.workflow.imagePuzzle` | Override comportemental pour image/OCR. |

La fonction `resolveGeoAppChatBehaviorProfileForWorkflow()` applique :

1. le profil explicitement demandé par la session, s'il existe ;
2. le profil spécifique au workflow ;
3. le profil par défaut ;
4. `guided` comme fallback.

## 7. Workflows

Type :

```ts
type GeoAppChatWorkflowKind =
    'general'
    | 'secret_code'
    | 'formula'
    | 'checker'
    | 'hidden_content'
    | 'image_puzzle';
```

Le workflow peut venir :

- d'une classification de listing ;
- d'un orchestrateur GeoApp ;
- d'une action d'ouverture de chat ;
- d'une session existante ;
- de la vue Policy en mode preview.

Le workflow influence :

- le profil modèle ;
- le profil comportemental ;
- les tools activés ;
- les skills recommandées ;
- le titre de session ;
- le contexte injecté au chat.

### Aperçu de routage (page geocache-details)

Le badge de la page `geocache-details` affiche le workflow et le profil effectifs avant l'ouverture du chat. Pour rester léger, il n'appelle pas l'orchestrateur complet mais un endpoint dédié :

- `POST /api/plugins/workflow/preview` exécute la **même décision** que `/workflow/resolve` (classification → candidats → candidat primaire, via le helper partagé `_select_primary_workflow`), mais s'arrête avant la construction des payloads et toute exécution de plugin. Il renvoie `{workflow: {kind, confidence, reason, forced}, classification: {labels}}`.
- `GeocacheDetailsChatController.resolveRoutingPreview()` consomme cet endpoint et **met en cache** le `workflowKind` par `geocacheId`. Seule la partie réseau est mémorisée ; le profil est recalculé à chaque appel depuis les préférences courantes.
- Le cache est invalidé via `invalidateRoutingPreview()` quand le listing change (édition de waypoints/coordonnées, statut résolu, traduction).
- Au clic sur « Chat IA », le workflow est re-résolu (cache) pour éviter d'ouvrir avec un workflow encore à `general` si l'aperçu initial n'était pas terminé.

## 8. Sessions et bridge

`geoapp-chat-bridge.ts` sert à ouvrir ou reprendre une session Chat IA depuis les widgets GeoApp.

Il transporte dans les settings de session :

- `workflowKind` ;
- `preferredProfile` ;
- `preferredBehaviorProfile` ;
- `resumeState` ;
- `gcCode` ;
- `geocacheId` ;
- `sessionKind` ;
- prompt initial éventuel ;
- URLs d'images éventuelles.

Les constantes et helpers sont dans `geoapp-chat-shared.ts` :

- `GEOAPP_OPEN_CHAT_REQUEST_EVENT` ;
- `buildGeoAppOpenChatRequestDetail()` ;
- `buildGeoAppBaseSessionTitle()` ;
- `buildGeoAppChatDisplaySessionTitle()` ;
- `buildGeoAppChatPrompt()`.

## 9. Catalogue des tools

Le catalogue est implémenté par `GeoAppAiToolCatalog`.

Il lit tous les tools enregistrés dans Theia via :

```ts
ToolInvocationRegistry.getAllFunctions()
```

Puis il retient uniquement :

- les tools connus par métadonnées statiques ;
- les plugins dynamiques dont l'ID commence par `plugin.`.

### Métadonnées

Chaque entrée expose :

```ts
interface GeoAppAiToolMetadata {
    registryId: string;
    publicName: string;
    category: GeoAppAiToolCategory;
    risk: GeoAppAiToolRisk;
    provider?: string;
    workflowKinds?: GeoAppChatWorkflowKind[];
    network?: boolean;
    writesLocal?: boolean;
    requiresAuth?: boolean;
    defaultEnabled: boolean;
    description?: string;
    dynamic?: boolean;
}
```

Catégories :

- `workflow`
- `metasolver`
- `formula`
- `coordinates`
- `checkers`
- `image`
- `web`
- `plugins`
- `utility`
- `debug`

Risques :

- `read_only`
- `local_write`
- `network`
- `auth`
- `high`

### Tools statiques

Les principaux tools déclarés statiquement :

| Registry ID | Catégorie | Risque |
|---|---|---|
| `geoapp.geocache.get-listing` | `workflow` | `read_only` |
| `geoapp.checkers.run` | `checkers` | `network` |
| `geoapp.checkers.session.ensure` | `checkers` | `auth` |
| `geoapp.checkers.session.login` | `checkers` | `auth` |
| `geoapp.checkers.session.reset` | `checkers` | `auth` |
| `geoapp.plugins.workflow.resolve` | `workflow` | `read_only` |
| `geoapp.plugins.workflow.run-step` | `workflow` | `high` |
| `geoapp.plugins.listing.classify` | `workflow` | `read_only` |
| `geoapp.plugins.metasolver.recommend` | `metasolver` | `read_only` |
| `plugin.metasolver` | `metasolver` | `read_only` |
| `plugin.coordinate_projection` | `coordinates` | `read_only` |
| `plugin.coordinate_intersection` | `coordinates` | `read_only` |
| `geoapp.coordinates.save-found` | `coordinates` | `local_write` |
| `geoapp.coordinates.highlight-found` | `coordinates` | `local_write` |
| `formula-solver.detect-formula` | `formula` | `read_only` |
| `formula-solver.find-questions` | `formula` | `read_only` |
| `formula-solver.search-answer` | `web` | `network` |
| `formula-solver.fetch-url` | `web` | `network` |
| `formula-solver.calculate-value` | `formula` | `read_only` |
| `formula-solver.calculate-coordinates` | `formula` | `read_only` |
| `aide_calculate` | `utility` | `read_only` |
| `aide_calculate_batch` | `utility` | `read_only` |
| `geoapp.plugins.ai.score` | `plugins` | `network` |

### Tool de contexte `get_geocache_listing`

Le tool `geoapp.geocache.get-listing` (nom public `get_geocache_listing`) est un tool de lecture seule qui renvoie le **listing complet** d'une géocache : description intégrale, indices décodés, waypoints détaillés et checkers.

Il répond à la troncature du contexte initial du chat : `buildGeocacheChatPrompt` limite la description à 1500 caractères, or pour une mystery l'énigme est souvent dans la partie coupée. Le prompt de contexte ajoute une note quand la description est tronquée, et le prompt système invite le modèle à appeler `get_geocache_listing(geocache_id)` avant de conclure si l'énigme n'est pas entièrement visible.

Fichiers :

| Fichier | Rôle |
|---|---|
| `geocache-listing-tools-manager.ts` | Enregistre le tool et son handler (GET `/api/geocaches/{id}`). |
| `geocache-chat-prompt-shared.ts` | `buildGeocacheFullListingContext()` : formatage du listing complet (cap description 12000 car.). |
| `geoapp-chat-tool-catalog.ts` | Entrée catalogue `geoapp.geocache.get-listing`. |
| `zones-frontend-module.ts` | Binding Inversify. |

### Plugins dynamiques

Tout tool dont l'ID commence par `plugin.` peut être reconnu dynamiquement.

Le catalogue infère sa catégorie :

- `ocr` ou `qr` -> `image` ;
- `coord` -> `coordinates` ;
- `metasolver` -> `metasolver` ;
- sinon -> `plugins`.

Par défaut, un plugin dynamique n'est pas activé automatiquement.

### Tools `@Aide` de gestion des zones

L'agent documentaire `@Aide` n'utilise pas exactement la même policy que les agents `GeoApp` : il injecte directement ses tools `aide_*` via `DocActionToolsManager.buildAllTools()`, tout en les enregistrant aussi dans `ToolInvocationRegistry` pour rester visibles côté Theia.

Les tools de zones exposés à `@Aide` sont :

| Tool | Effet | Backend/service |
|---|---|---|
| `aide_list_zones` | Liste les zones disponibles. | `ZonesService.list()` |
| `aide_create_zone(name, description?)` | Crée une zone. | `POST /api/zones` |
| `aide_rename_zone(zone_id, new_name, description?)` | Renomme une zone existante. | `POST /api/zones/<id>/rename` via `ZonesService.update()` |
| `aide_duplicate_zone(zone_id, name, description?)` | Duplique une zone avec ses géocaches, waypoints et checkers. | `POST /api/zones/<id>/duplicate` via `ZonesService.duplicate()` |
| `aide_merge_zone(source_zone_id, target_zone_id)` | Fusionne une zone dans une autre, déplace les géocaches uniques, ignore les doublons déjà présents dans la cible, puis supprime la zone source. | `POST /api/zones/<id>/merge` via `ZonesService.merge()` |
| `aide_set_active_zone(zone_id)` | Définit la zone active. | `POST /api/active-zone` |
| `aide_delete_zone(zone_id, zone_name)` | Supprime une zone. | `DELETE /api/zones/<id>` avec confirmation Theia |

Pour les demandes par nom ("renomme la zone Paris", "fusionne Import GPX dans Bretagne"), le prompt de `@Aide` demande d'appeler d'abord `aide_list_zones` afin de résoudre les IDs, puis d'enchaîner l'action.

## 10. Policy effective

La policy est calculée dans `GeoAppChatPolicyService.resolvePolicy()`.

Elle contient :

```ts
interface GeoAppChatPolicy {
    behaviorProfile: GeoAppChatBehaviorProfile;
    promptPack: GeoAppChatBehaviorProfile;
    workflowKind?: GeoAppChatWorkflowKind;
    sessionKind?: GeoAppChatSessionKind;
    enabledToolIds: Set<string>;
    confirmToolIds: Set<string>;
    disabledToolIds: Set<string>;
    entries: GeoAppAiToolCatalogEntry[];
    skillPack: GeoAppChatSkillPack;
    skillEntries: GeoAppChatSkillMetadata[];
    recommendedSkillNames: GeoAppChatSkillName[];
    disabledSkillNames: Set<GeoAppChatSkillName>;
}
```

### Résolution des tools

Pour chaque tool :

1. GeoApp calcule une décision de profil ;
2. applique un éventuel override utilisateur ;
3. ajoute le tool à `enabledToolIds` ou `disabledToolIds` ;
4. ajoute le tool à `confirmToolIds` si nécessaire.

Les tools désactivés ne sont pas envoyés au modèle.

### Overrides

Préférence :

```text
geoApp.chat.toolPolicy.overrides
```

Valeurs possibles :

- `default`
- `enabled`
- `disabled`
- `confirm`

La clé recommandée est le `registryId`, pas le `publicName`.

### Confirmation Theia

Quand un tool est autorisé mais sensible, `GeoAppChatPolicyService.toPolicyToolRequest()` marque le tool pour confirmation.

Le tool reste visible pour le modèle, mais son exécution passe par la confirmation Theia.

## 11. Injection des tools dans le modèle

`BaseGeoAppChatAgent.sendLlmRequest()` surcharge la méthode Theia.

Étapes :

1. résoudre la policy de la requête ;
2. conserver les tools non gérés par GeoApp ;
3. remplacer les tools GeoApp par ceux de la policy ;
4. appeler `super.sendLlmRequest()`.

Cela évite l'ancienne approche qui mutait une liste globale de tools.

Point important :

```ts
id = tool.name
```

GeoApp normalise l'ID côté chat pour que Theia puisse faire correspondre les tool calls streamés par les modèles OpenAI-compatible. Les préférences restent stockées par `registryId`.

## 12. Prompt système

Le prompt système GeoApp est résolu via Theia `PromptService`.

Fichier :

```text
geoapp-chat-system-prompts.ts
```

Prompt pack disponible :

- `guided`
- `safe`
- `offline`
- `automation`
- `debug`

Préférence :

```text
geoApp.chat.promptPack
```

Si aucune valeur n'est définie, le prompt pack suit le profil comportemental. La préférence est enregistrée dans le schéma Theia avec la valeur `auto` par défaut : `auto` n'étant pas un profil valide, `normalizeGeoAppChatBehaviorProfile` le rejette et `resolvePolicy` retombe sur le profil comportemental. Un profil concret comme défaut de schéma figerait au contraire le prompt pack (le défaut de schéma l'emporte sur le fallback passé à `preferenceService.get`).

### Prompt final

`BaseGeoAppChatAgent.getSystemMessageDescription()` construit :

```text
prompt résolu par Theia

Politique GeoApp active :
- profil comportemental
- prompt pack
- skill pack
- workflow
- session
- skills actives
- tools exposés au modèle
- tools sensibles avec confirmation
```

Le prompt final est donc composé de deux couches :

1. le prompt pack Theia ;
2. la policy effective GeoApp.

## 13. Aperçu du prompt final

`GeoAppChatPolicyService.resolveSystemPromptPreview()` produit :

```ts
interface GeoAppChatSystemPromptPreview {
    promptVariantId: string;
    isPromptVariantCustomized: boolean;
    resolvedPromptText: string;
    policyPromptText: string;
    finalPromptText: string;
    functionToolNames: string[];
    diagnostics: GeoAppChatPolicyDiagnostic[];
}
```

La vue `GeoAppChatPolicyWidget` affiche :

- le variant de prompt ;
- l'état personnalisé ou GeoApp ;
- le prompt résolu ;
- la policy injectée ;
- le prompt final complet ;
- les tools référencés directement par le prompt ;
- les diagnostics runtime.

## 14. Diagnostics runtime

Les diagnostics sont calculés dans `GeoAppChatPolicyService.getRuntimeDiagnostics()`.

Ils signalent notamment :

- les tools statiques attendus mais absents du registry Theia ;
- l'absence du tool `getSkillFileContent` ;
- les skills GeoApp actives non découvertes par Theia ;
- l'indisponibilité de `PromptService` ;
- l'impossibilité de résoudre un prompt pack.

Ces diagnostics sont destinés au debug de configuration, pas uniquement aux erreurs bloquantes.

## 15. Skills GeoApp

Les skills sont définies dans `geoapp-chat-skills.ts`.

Skills intégrées :

| Skill | Rôle |
|---|---|
| `geoapp-formula` | Stratégie pour formules, variables et calculs de finales. |
| `geoapp-checkers` | Stratégie pour checkers, sessions et validation de coordonnées. |
| `geoapp-image-puzzle` | Stratégie pour images, OCR, QR codes et vision. |
| `geoapp-secret-code` | Stratégie pour codes secrets, metasolver et contenu caché. |
| `geoapp-coordinates` | Stratégie pour coordonnées, projection, intersection, affichage et sauvegarde. |
| `geoapp-research` | Stratégie pour les énigmes de connaissance : recherche web de faits, listes et références, et lecture des sources. |

Chaque skill contient :

```ts
interface GeoAppChatSkillMetadata {
    name: GeoAppChatSkillName;
    label: string;
    description: string;
    workflows: GeoAppChatWorkflowKind[];
    toolRegistryIds: string[];
    content: string;
}
```

### Frontmatter de skill

Chaque skill contient un frontmatter :

```yaml
---
name: geoapp-formula
description: ...
metadata:
  provider: geoapp
  version: "1"
allowedTools:
  - formula-solver.detect-formula
---
```

Puis le marqueur :

```html
<!-- geoapp-managed-skill -->
```

Ce marqueur permet de distinguer une skill gérée par GeoApp d'une skill personnalisée par l'utilisateur.

## 16. Skill packs

Type :

```ts
type GeoAppChatSkillPack = 'workflow' | 'minimal' | 'full' | 'disabled';
```

Préférence :

```text
geoApp.chat.skillPack
```

Règles :

- `workflow` active les skills adaptées au workflow ;
- `minimal` active seulement les skills essentielles ;
- `full` active toutes les skills GeoApp ;
- `disabled` désactive les skills, sauf override explicite.

### Overrides de skills

Préférence :

```text
geoApp.chat.skillPolicy.overrides
```

Valeurs :

- `default`
- `enabled`
- `disabled`

## 17. Installation et état des skills

`GeoAppChatSkillSeeder` installe les skills GeoApp dans le dossier de configuration Theia.

`GeoAppChatSkillStateService` inspecte leur état :

| État | Sens |
|---|---|
| `geoapp_default` | La skill active correspond à la version intégrée. |
| `customized` | La skill a été personnalisée par l'utilisateur. |
| `outdated` | La skill contient le marqueur GeoApp mais diffère de la version intégrée actuelle. |
| `missing` | Le fichier de skill est absent. |
| `not_discovered` | Le fichier existe mais Theia ne l'a pas encore découvert. |
| `unreadable` | Theia connaît la skill, mais son fichier ne peut pas être lu. |

Le service sait aussi :

- restaurer une skill GeoApp ;
- exporter les skills personnalisées ;
- importer une skill personnalisée ;
- demander un refresh du `SkillService` si possible.

## 18. Import/export de configuration

Le service central est `GeoAppChatConfigurationService`.

Il définit :

```ts
interface GeoAppChatConfigurationExport {
    type: 'geoapp-chat-configuration';
    version: 3;
    exportedAt: string;
    policy: Record<string, unknown>;
    promptPacks: GeoAppChatPromptPackExport[];
    skills: GeoAppChatSkillExport[];
}
```

Le format version 3 transporte :

- les préférences de policy ;
- les prompt packs GeoApp, avec contenu effectif ;
- l'état personnalisé des prompts ;
- les skills GeoApp personnalisées ;
- leur contenu.

### Export complet

Méthode :

```ts
getFullConfigurationExport()
```

Utilisée par le bouton `Exporter` de la vue Policy.

### Import complet

Méthode :

```ts
importConfiguration(serialized, options)
```

Elle accepte :

- le format complet `geoapp-chat-configuration` ;
- les anciens exports contenant seulement les clés de policy.

Elle applique :

1. les préférences connues ;
2. les prompt packs marqués `isCustomized: true` ;
3. les skills marquées `isCustomized: true`.

Les prompt packs non personnalisés ne sont pas réécrits.

Les skills GeoApp standard ne sont pas réécrites.

### Aperçu avant import

Méthode :

```ts
previewConfiguration(serialized)
```

Retourne :

- format ;
- version ;
- date d'export ;
- nombre de préférences ;
- clés de préférences ;
- prompt packs personnalisés ;
- skills personnalisées.

La vue Policy affiche cet aperçu sous le champ d'import.

## 19. Vue Policy Chat IA GeoApp

Fichier :

```text
geoapp-chat-policy-widget.tsx
```

ID widget :

```text
geoapp.chat.policy
```

Commande :

```text
geoapp.chat.policy.open
```

La vue permet :

- d'appliquer un **preset combiné** (profil comportemental par défaut + prompt pack + skill pack en un clic) ;
- de voir le **modèle résolu pour chaque agent** GeoApp (chat et internes) via `LanguageModelRegistry` ;
- de prévisualiser une policy pour un workflow ;
- de changer le skill pack ;
- de voir tools actifs, bloqués et à confirmation ;
- de filtrer les tools ;
- d'éditer les overrides ;
- de voir les skills actives ;
- de restaurer/exporter une skill personnalisée ;
- d'éditer, importer, exporter et reset les prompt packs ;
- de comparer un prompt actif à la version GeoApp ;
- de voir le prompt final ;
- de voir les diagnostics runtime ;
- d'importer/exporter la configuration complète.

### Presets combinés

Quatre presets règlent les trois axes de configuration d'un seul clic, en écrivant les préférences correspondantes (`geoApp.chat.behaviorProfile.default`, `geoApp.chat.promptPack`, `geoApp.chat.skillPack`) :

| Preset | Comportement | Prompt pack | Skill pack |
|---|---|---|---|
| Découverte | `guided` | `guided` | `workflow` |
| Autonome | `automation` | `automation` | `full` |
| Prudent | `safe` | `safe` | `minimal` |
| Hors-ligne | `offline` | `offline` | `minimal` |

Le preset actif (celui dont les trois préférences correspondent) est mis en évidence. Appliquer un preset remet l'aperçu comportemental sur `Préférence effective`.

### Modèles par agent

Un panneau liste les agents GeoApp (chat et internes) et résout le modèle effectif de chacun via `LanguageModelRegistry.selectLanguageModel`, en respectant le `purpose` propre à l'agent (`chat`, ou `vision-ocr` pour l'OCR). Il répond à la question « quel modèle pour quoi ? » sans parcourir les réglages IA Theia un par un. Un bouton `Rafraîchir` relance la résolution (l'assignation des modèles se fait, elle, dans « Config IA Theia »).

### Matrice des tools

Filtres :

- recherche texte ;
- statut ;
- risque ;
- catégorie ;
- recommandation de skill.

La colonne `Skills` indique si une skill active recommande un tool.

Si une skill recommande un tool bloqué, la vue l'affiche explicitement.

### Éditeur de prompt packs

Actions :

- `Éditer dans Theia` ;
- `Reset GeoApp` ;
- `Exporter` ;
- `Importer comme personnalisation`.

Comparaison :

- lignes actives ;
- caractères actifs ;
- lignes GeoApp ;
- caractères GeoApp ;
- première ligne différente.

## 20. Préférences et valeurs par défaut

Les valeurs par défaut de la configuration moderne sont dans :

```text
GEOAPP_CHAT_POLICY_DEFAULTS
```

Définies dans `geoapp-chat-configuration-service.ts`.

Valeurs :

| Clé | Défaut |
|---|---|
| `geoApp.chat.behaviorProfile.default` | `guided` |
| `geoApp.chat.behaviorProfile.workflow.secretCode` | `default` |
| `geoApp.chat.behaviorProfile.workflow.formula` | `default` |
| `geoApp.chat.behaviorProfile.workflow.checker` | `default` |
| `geoApp.chat.behaviorProfile.workflow.hiddenContent` | `default` |
| `geoApp.chat.behaviorProfile.workflow.imagePuzzle` | `default` |
| `geoApp.chat.promptPack` | `guided` |
| `geoApp.chat.skillPack` | `workflow` |
| `geoApp.chat.skillPolicy.overrides` | `{}` |
| `geoApp.chat.toolPolicy.overrides` | `{}` |

`GEOAPP_CHAT_POLICY_DEFAULTS` sert à l'import/export et au reset (il réécrit `geoApp.chat.promptPack` en `guided`).

### Schéma de préférences Theia

Les préférences `geoApp.chat.*` sont aussi déclarées dans un schéma Theia (`geoapp-preference-contribution.ts`), ce qui les rend visibles, décrites et validées dans l'éditeur de Settings. Les enums correspondent aux valeurs acceptées (profils modèle, profils comportementaux, `default`/`enabled`/`disabled`/`confirm` pour les overrides).

Défauts de schéma notables :

- `geoApp.chat.defaultProfile` : `fast` ;
- `geoApp.chat.behaviorProfile.default` : `guided` ;
- les overrides de workflow (`workflowProfile.*`, `behaviorProfile.workflow.*`) : `default` ;
- `geoApp.chat.promptPack` : `auto` (voir §12) ;
- `geoApp.chat.skillPack` : `workflow` ;
- `geoApp.chat.toolPolicy.overrides` / `skillPolicy.overrides` : `{}`.

## 21. Wiring Theia

Fichier :

```text
zones-frontend-module.ts
```

Bindings principaux :

```ts
bind(GeoAppAiToolCatalog).toSelf().inSingletonScope();
bind(GeoAppChatPolicyService).toSelf().inSingletonScope();
bind(GeoAppChatConfigurationService).toSelf().inSingletonScope();
bind(GeoAppChatPolicyWidget).toSelf().inSingletonScope();
bind(GeoAppChatSkillSeeder).toSelf().inSingletonScope();
bind(GeoAppChatSkillStateService).toSelf().inSingletonScope();
bind(GeoAppChatAgentContribution).toSelf().inSingletonScope();
bind(GeoAppChatAgent).toSelf().inSingletonScope();
bind(ChatAgent).toService(GeoAppChatAgent);
```

Chaque agent profilé est aussi bindé à `ChatAgent`.

## 22. Tests

Commande :

```bash
yarn --cwd frontend/theia-extensions/zones test:geoapp
```

Tests exécutés :

| Test | Couverture |
|---|---|
| `geocache-chat-prompt-shared.test.ts` | Prompt contexte géocache historique. |
| `geoapp-chat-shared.test.ts` | Helpers de profils, workflows, sessions et prompts. |
| `geoapp-chat-policy-service.test.ts` | Catalogue, policy, profils, overrides, diagnostics, prompt preview. |
| `geoapp-chat-configuration-service.test.ts` | Import/export complet, preview d'import, compat legacy. |
| `geoapp-chat-agent.test.ts` | Tools envoyés au modèle et prompt final agent. |
| `geoapp-chat-bridge.test.ts` | Ouverture/reprise de sessions Chat IA. |
| `outing-analysis-prompt.test.ts` | Mise en forme du prompt de sortie, sections omises, niveaux de détail. |
| `outing-analysis-controller.test.ts` | Plafond, déduplication, titre de session, avertissements, préférences, pré-vol de fraîcheur des logs, ordre rafraîchissement/collecte, relance actionnable. |
| `geoapp-outing-analyzer-agent.test.ts` | Identité de l'agent, contenu du prompt système, repli. |

Backend :

```bash
cd backend && python -m pytest tests/test_outing_analysis.py tests/test_outing_geography.py tests/test_outing_logs_status.py -q
```

| Test | Couverture |
|---|---|
| `test_outing_analysis.py` | Santé, signaux matériel, extraction lexicale, validation de l'endpoint. |
| `test_outing_geography.py` | Haversine, étendue, ordre de visite, groupes de marche, éphémérides solaires. |
| `test_outing_logs_status.py` | Verdicts du pré-vol, alignement des seuils sur `outing_health`, endpoint. |

Build :

```bash
yarn --cwd frontend/theia-extensions/zones build
```

Documentation utilisateur :

```bash
yarn --cwd frontend/theia-extensions/documentation build
```

## 23. Ajouter un nouveau tool GeoApp

Étapes recommandées :

1. Enregistrer le tool dans Theia via `ToolInvocationRegistry`.
2. Choisir un `registryId` stable.
3. Ajouter une entrée dans `STATIC_TOOL_METADATA` si le tool doit être géré par GeoApp.
4. Définir :
   - catégorie ;
   - risque ;
   - workflows ;
   - `network` ;
   - `writesLocal` ;
   - `requiresAuth` ;
   - `defaultEnabled`.
5. Ajouter le tool aux skills concernées si nécessaire.
6. Ajouter ou mettre à jour les tests de policy.
7. Vérifier dans la vue Policy que le tool apparaît correctement.

Règle importante :

- préférences et overrides : utiliser `registryId` ;
- tool call côté modèle : Theia peut recevoir `publicName`.

## 24. Ajouter une nouvelle skill GeoApp

Étapes :

1. Ajouter un nom dans `GeoAppChatSkillNames`.
2. Ajouter une entrée dans `GeoAppChatSkills`.
3. Inclure un frontmatter Theia valide.
4. Inclure le marqueur :

```html
<!-- geoapp-managed-skill -->
```

5. Définir les workflows.
6. Définir les `toolRegistryIds`.
7. Mettre à jour `getBaseGeoAppChatSkillNames()` si la skill doit être recommandée automatiquement.
8. Lancer le seeder ou redémarrer GeoApp.
9. Vérifier l'état dans la vue Policy.
10. Ajouter des tests.

## 25. Ajouter un nouveau prompt pack

Étapes :

1. Ajouter une variante dans `GeoAppChatSystemPromptVariants`.
2. Ajouter la correspondance dans `GeoAppChatPromptVariantByPack`.
3. Étendre le type `GeoAppChatBehaviorProfile` si le pack correspond à un nouveau comportement.
4. Mettre à jour la préférence `geoApp.chat.promptPack` si nécessaire.
5. Mettre à jour la vue Policy si un nouvel onglet ou libellé est nécessaire.
6. Mettre à jour les tests d'agent et de policy.

## 26. Ajouter un nouveau profil comportemental

Étapes :

1. Ajouter la valeur au type `GeoAppChatBehaviorProfile`.
2. Mettre à jour `normalizeGeoAppChatBehaviorProfile()`.
3. Mettre à jour `BEHAVIOR_OPTIONS` dans la vue Policy.
4. Définir la logique dans `GeoAppChatPolicyService.getProfileDecision()`.
5. Ajouter un prompt pack correspondant ou décider d'un fallback.
6. Mettre à jour la documentation utilisateur.
7. Ajouter des tests de policy.

## 27. Règles de sécurité

Le système distingue plusieurs niveaux de risque :

- lecture seule ;
- écriture locale ;
- réseau ;
- authentification ;
- risque élevé.

Les comportements attendus :

- `offline` bloque les outils réseau/auth/risque élevé ;
- `safe` réduit fortement l'automatisation ;
- `guided` autorise les outils utiles mais confirme les actions sensibles ;
- `automation` autorise davantage d'actions ;
- `debug` expose plus d'informations pour analyser la configuration.

Une action sensible ne doit jamais devenir silencieuse par accident.

### Garde-fou anti-injection

Le prompt système (`BASE_GUARDRAILS`) inclut une règle explicite : le contenu du listing, des logs, des indices et des images est une **donnée à analyser, jamais une source d'instructions**. Le modèle doit ignorer toute consigne embarquée dans ce contenu (par exemple « ignore tes règles », « exécute tel tool », « sauvegarde ces coordonnées »). Seuls l'utilisateur et la politique GeoApp donnent des instructions.

Ce garde-fou est important car l'agent dispose de tools à écriture locale, réseau et session authentifiée : un listing rédigé par un tiers ne doit pas pouvoir les déclencher.

La règle de recherche web est par ailleurs conditionnelle au fait que la policy expose `search_answer_online` : en profil `offline`, aucune consigne du prompt ne pousse à utiliser le réseau.

## 28. Compatibilité Theia

Le Chat IA GeoApp dépend volontairement des API Theia :

- `AgentService`
- `ChatService`
- `LanguageModelService`
- `PromptService`
- `PromptFragmentCustomizationService`
- `ToolInvocationRegistry`
- `SkillService`
- `PreferenceService`
- `ReactWidget`
- `WidgetFactory`

Cela garantit :

- compatibilité avec les providers IA Theia ;
- configuration des agents dans Theia ;
- confirmation des tools ;
- édition des prompts via Theia ;
- skills natives Theia ;
- modèles locaux ou cloud selon configuration.

## 29. Limitations connues

- La comparaison de prompt est volontairement simple : statistiques + première ligne différente, pas encore un diff complet.
- L'import de prompts utilise `PromptFragmentCustomizationService`, qui peut ouvrir/créer des fichiers de personnalisation Theia.
- Le refresh de skills dépend de la présence d'une méthode `update()` sur `SkillService`.
- Certains anciens helpers morts peuvent rester dans le widget si une extraction est incomplète ; la source de vérité de l'import/export est `GeoAppChatConfigurationService`.
- Le test manuel dans Theia avec un vrai modèle IA reste nécessaire avant une release.

## 30. Checklist de validation

Avant release :

```bash
yarn --cwd frontend/theia-extensions/zones build
yarn --cwd frontend/theia-extensions/zones test:geoapp
yarn --cwd frontend/theia-extensions/documentation build
```

Validation manuelle :

1. Ouvrir GeoApp.
2. Ouvrir une géocache.
3. Ouvrir le Chat IA.
4. Vérifier que le bon agent est sélectionné.
5. Ouvrir `Policy Chat IA GeoApp`.
6. Vérifier le workflow, le profil comportemental et le skill pack.
7. Vérifier que les tools attendus sont actifs.
8. Vérifier qu'un tool sensible demande confirmation.
9. Afficher l'aperçu du prompt final.
10. Modifier un prompt pack, vérifier la comparaison.
11. Exporter la configuration complète.
12. Réimporter la configuration exportée.
13. Personnaliser une skill, l'exporter seule, puis la réimporter.
14. Tester une question réelle sur une cache.

## 31. Analyse de sortie

L'analyse de sortie répond à une question différente de la résolution d'énigme : non pas
« où est la cache ? », mais « qu'est-ce que j'emporte et combien de temps ça va prendre ? ».
Elle porte sur un **lot** de géocaches et produit un rapport dans le Chat.

### Points d'entrée

| Point d'entrée | Portée |
|---|---|
| Barre d'actions de `geocaches-table.tsx` (bouton « Analyser IA ») | La sélection cochée |
| En-tête du log-editor (bouton « Analyser la sortie ») | **Toute** la liste à loguer |

Le log-editor n'a pas de sélection de lignes : sa liste *est* la sortie du jour, ce qui en
fait le point d'entrée le plus direct.

### Flux

```text
Table de zone / log-editor
        |
        v
OutingAnalysisController.runInteractive()      date, détail, pré-vol, progression, messages
        |
        +--> decideLogsRefresh()               POST /api/geocaches/analysis-logs-status
        |            |                         (local : deux requêtes SQL, aucun scraping)
        |            v
        |    outing_logs_status.build_logs_status()
        |            |
        |            v
        |    refreshLogsFor()                  POST /api/geocaches/<id>/logs/refresh
        |                                      séquentiel, annulable, échec non bloquant
        v
OutingAnalysisController.analyze()             sans UI, testable seul
        |
        +--> GeocachesService.fetchAnalysisBundle()
        |            |
        |            v
        |    POST /api/geocaches/analysis-bundle
        |            |
        |            v
        |    outing_analysis_service.build_analysis_bundle()
        |            +--> outing_gear_signals.build_gear_signals()
        |            +--> outing_gear_signals.build_waypoint_signals()
        |            +--> outing_health.compute_health()
        |            +--> outing_lexicons.find_gear_mentions()   logs + listing + hint
        |            +--> outing_gear_signals.resolve_signals_from_text()
        |            +--> outing_geography.build_geography()
        |            |        +--> outing_sun.compute_sun_times()
        |            +--> outing_time_estimate.estimate_geocache_time()   par cache
        |            +--> outing_time_estimate.build_time_budget()        sortie entière
        |
        +--> buildBudgetedOutingPrompt()          palier par cache + plafond de tokens
        |            +--> decideTiers()            rich / lean, cache par cache
        |            +--> buildOutingAnalysisPrompt()
        |            +--> estimateOutingPromptSize()   prompt système compris
        |
        v
GeoAppChatBridge (session `libre`, agent `geoapp-outing-analyzer`)
```

### Le pré-vol : rafraîchir avant, pas regretter après

Une santé calculée sur des logs absents ne vaut rien, et une santé calculée sur des logs
vieux de deux ans décrit un passé arrêté. La spec initiale se contentait de le **signaler
après coup** — « X cache(s) sans logs locaux » — au motif que ces caches ne sont connues
qu'une fois le bundle collecté. La prémisse était juste pour le bundle, fausse pour le
fait lui-même : *combien de logs a cette cache, et de quand date leur collecte* se lit en
une requête agrégée, sans listing, sans logs, sans calcul solaire et sans le moindre appel
à geocaching.com.

D'où un endpoint séparé, `POST /api/geocaches/analysis-logs-status`
(`services/outing_logs_status.py`), interrogé entre le choix du niveau de détail et la
collecte :

| Verdict | Condition | Ce qu'il coûte de l'ignorer |
|---|---|---|
| `none` | aucun log en base | Santé non évaluable, la cache est muette dans le rapport |
| `stale` | dernière collecte > `LOGS_STALE_DAYS` (180 j) | Santé rassurante mais périmée — le pire des deux |
| `fresh` | le reste | — |

Deux propriétés tiennent tout le reste :

- **Les seuils sont ceux d'`outing_health`**, importés et non recopiés (`LOGS_STALE_DAYS`,
  `_as_utc`, `_days_since`). Le pré-vol et la santé du bundle doivent rendre le même
  verdict sur la même cache, sinon on proposerait un rafraîchissement dont le rapport ne
  dirait rien, ou l'inverse.
- **La date de collecte est `max(updated_at, created_at)` sur les logs**, agrégée en SQL
  plutôt que calculée après chargement : sur soixante caches et des milliers de lignes,
  c'est la différence entre une requête et un transfert complet.

Le dialogue qui s'ensuit ne s'ouvre que s'il y a quelque chose à dire — aucun `pick`
quand tout est frais. Trois issues : rafraîchir puis analyser, analyser sans rafraîchir,
ou échapper, ce qui annule tout comme sur les deux pickers précédents.

Le rafraîchissement lui-même (`refreshLogsFor()`) est **séquentiel** : chaque appel scrape
un logbook, et soixante requêtes de front reviendraient à marteler geocaching.com. Un
échec isolé ne rompt pas la série et ressort en avertissement — analyser avec dix caches
rafraîchies sur douze vaut mieux que ne pas analyser — mais une annulation, elle, remonte
et coupe l'analyse qui devait suivre : c'est un seul bouton, donc un seul geste d'arrêt.
La profondeur de collecte est réglable (`geoApp.outing.analysis.refreshLogsCount`, 25 par
défaut).

L'avertissement d'origine n'a pas disparu pour autant : il sert de filet quand le pré-vol
a été décliné ou n'a pas pu s'exécuter, et porte alors l'action **« Rafraîchir et
relancer »**, qui rafraîchit puis renvoie une seconde analyse dans la même session de
chat. Cette relance est **détachée** du retour de `runInteractive()` : les deux widgets
appelants gardent leur bouton « Analyser IA » désactivé jusqu'à ce retour, et une
notification porteuse d'action reste affichée tant que personne ne la ferme — l'attendre
suspendrait l'interface à un clic facultatif. La première analyse est terminée, elle le
dit ; la seconde, si elle vient, ouvre sa propre barre de progression. Il ne la porte
**que** si aucun rafraîchissement n'a été tenté sur ces caches-là :
une cache qui n'a pas de logs sur geocaching.com non plus n'en aura pas davantage au
second essai, et reproposer le geste ouvrirait une boucle. La phrase est produite par
`describeMissingLogs()` des deux côtés, ce qui permet de retrouver l'avertissement à
remplacer par comparaison exacte plutôt que par recherche de motif.

Enfin, l'indisponibilité du pré-vol n'empêche jamais une analyse : l'appel est enveloppé,
son échec journalisé, et le parcours reprend là où il était. C'est un confort, pas un
verrou.

### Ce que contient le bundle

Le bundle ne se limite pas à ce que geocaching.com publie : il ramasse aussi le travail
déjà fait par l'utilisateur, qui est souvent la meilleure source disponible.

| Source | Champs | Pourquoi elle compte |
|---|---|---|
| Listing, hint, attributs | `listing_excerpt`, `hint`, `attributes`, `gear_signals` | Le socle |
| Balayage lexical du listing et du hint | `gear_mentions_in_listing`, `gear_mentions_in_hint` | Le matériel nommé dans le texte **complet**, pour quelques tokens : survit à la troncature de l'extrait comme à sa suppression |
| Statut de trouvaille | `found`, `found_date` | Une cache déjà trouvée dans la sélection est presque toujours une erreur de sélection |
| Note personnelle geocaching.com | `personal_note` | « Parking rue X », « prévoir 2 personnes », solutions partielles : aucune autre source ne les porte |
| Notes GeoApp | `notes` (5 max, les plus récentes), `notes_count` | Repérages et solutions partielles saisis dans l'app |
| Questions d'EarthCache | `logging_tasks`, `logging_tasks_photo_required` | La checklist terrain : oublier une observation oblige à revenir |
| Waypoints | `prefix`, `name`, `type`, `coordinates`, `note_excerpt` | Un « Parking » sans coordonnées ne mène nulle part ; le type `Parking Area` lève lui-même un signal contextuel |
| Logs | `is_friend_log`, `is_favorite` en plus du texte | Un log d'ami est une source identifiée, donc plus fiable |
| Estimation de temps | `time_estimate` par cache, `time_budget` pour la sortie | Un chiffre cohérent d'une cache à l'autre, que l'IA ajuste au lieu de l'inventer |

Trois conséquences dans le prompt :

- les caches déjà trouvées remontent dans la section « Fiabilité des données » (liste
  `already_found`) **et** en alerte dans le bloc de la cache, comme les mystery non
  résolues. Elles ne sont jamais retirées d'office : refaire une multi ou accompagner
  quelqu'un sont des raisons valables, et c'est à l'utilisateur de trancher ;
- la note personnelle et les notes GeoApp sont rendues **avant** le listing, et le prompt
  système en fait la source prioritaire ;
- un waypoint sans coordonnées est rendu « coordonnées absentes » plutôt qu'omis : c'est
  un point à récupérer avant de partir, pas un silence.

Deux nettoyages sont appliqués au passage, parce que le prompt est un format ligne à
ligne : le type de waypoint arrive parfois du scraping avec un retour à la ligne et une
parenthèse orpheline (`Parking Area)\n    `), et geocaching.com stocke `???` dans
`gc_coords` pour un waypoint dont les coordonnées ne sont pas publiées — c'est une
absence, pas une valeur.

### Principe : déterministe d'abord, IA ensuite

Tout ce qui est calculable est calculé côté Python et transmis comme un fait ; l'IA ne
fait que ce qu'elle seule sait faire, lire du texte libre.

| Calculé (backend) | Déduit (IA) |
|---|---|
| Santé : DNF consécutifs, ancienneté de la trouvaille, maintenance en attente | Nature précise de l'outil requis |
| Drapeaux matériel issus des attributs | Type de matériel de grimpe |
| Sélection des logs pertinents par lexique | Priorisation, arbitrages de journée |
| Temps sur place par cache, trajet, budget de la sortie | Correction de ces durées quand le texte en dit plus |
| Matériel nommé dans le listing et le hint, drapeaux pré-résolus | Ce qui n'est que suggéré, sous-entendu, ou dit autrement |
| Mystery non résolue, cache déjà trouvée, waypoints, statut | Contraintes implicites du listing |
| Fraîcheur de la collecte de logs | Ce qu'il faut en conclure sur la fiabilité |

### Signaux matériel : l'attribut est une question, pas une réponse

`build_gear_signals()` produit trois natures d'entrées :

| Nature | `resolved` | `resolved_from` | Exemple | Rôle |
|---|---|---|---|---|
| Matériel auto-suffisant | `true` | `attribute` | `flashlight`, `uv_light`, `scuba` | L'attribut dit tout |
| Matériel **non résolu** | `false` | `null` | `special_tool`, `climbing`, `field_puzzle` | Pose une question à l'IA |
| Matériel **pré-résolu** | `true` | `listing` / `hint` | `special_tool` + « canne à pêche » dans le listing | Le backend a répondu à la question |
| Contexte | `true` | `attribute` / `waypoint` | `fee`, `stealth`, `not_available_24h` | Organisation, pas équipement |

L'attribut « Outil spécial requis » ne dit pas *quel* outil : canne à pêche, aimant,
crochet, matériel de crochetage… De même `climbing` ne distingue pas l'échelle du matériel
arboricole ou spéléo. Le backend lève donc un drapeau, que le prompt rend comme
`(NON RÉSOLU)`, et le prompt système impose à l'IA de le résoudre en trois niveaux :
**confirmé** (avec citation de la source), **probable** (avec le faisceau d'indices), ou
**non identifié** (réponse valide, qui recommande la trousse polyvalente).

Ce marqueur `(NON RÉSOLU)` est un **contrat entre deux fichiers** :
`outing-analysis-prompt.ts` l'écrit, `geoapp-chat-system-prompts.ts` le cherche. Il doit
correspondre au caractère près, accents compris — c'est pourquoi le prompt système de
sortie est accentué, contrairement à ses voisins. Un test verrouille la correspondance.
Même contrat pour le marqueur inverse, `résolu depuis le listing`.

**Pré-résolution** — `resolve_signals_from_text()` referme un drapeau quand le balayage du
listing ou du hint nomme un objet capable de l'expliquer. Le rendu change alors de nature :
`special_tool (résolu depuis le listing : fishing_rod)` au lieu de `(NON RÉSOLU : …)`, et
le libellé « nature à déterminer » disparaît, puisque la nature est déterminée.

La correspondance drapeau → objets (`_SIGNAL_GEAR_CANDIDATES`) est **volontairement
étroite** : une lampe ou des gants ne referment pas « outil spécial requis », parce que ces
objets ont leur propre attribut et qu'une réponse fausse rendue avec l'assurance d'un
calcul est pire qu'une question laissée ouverte. `climbing` ne se referme que sur du
matériel de grimpe ; `field_puzzle` et `teamwork` ne se referment jamais — aucun mot du
lexique ne dit quelle énigme ni combien de bras.

Deux limites assumées :

- le balayage est **lexical, pas sémantique** : il voit que le mot est écrit, pas qu'il est
  écrit en positif. C'est exactement le risque que court l'IA en lisant le listing elle-même,
  d'où le choix d'annoncer la source (`résolu depuis le listing`) plutôt qu'un fait sans
  provenance ;
- les **logs ne pré-résolvent rien**. Ils sont nombreux, parfois contradictoires, et leur
  extrait est déjà transmis avec ses `matched` : l'IA peut les citer avec une date et un
  auteur, ce qu'un compteur agrégé ne permettrait pas. Seuls le listing et le hint, écrits
  par le propriétaire, font autorité ici.

**Résolution du slug d'attribut** — `Geocache.attributes` est hétérogène :

1. `base_filename` (scraping) : slug stable, **suffixe `-yes`/`-no` inclus**
   (`flashlight-yes`, `UV-no`, `s-tool-yes`) ;
2. `gc_attribute_id` (import GPX) ;
3. `name` en dernier recours, par mots-clés distinctifs FR + EN.

`name` est un libellé **localisé** (« Flashlight required » ou « Lampe torche requise »
selon la langue du compte au moment du scraping) : il ne peut jamais servir de clé
primaire.

### Sélection des logs : deux listes, deux questions

- `recent_logs` : les N derniers, pour l'état actuel de la cache ;
- `gear_logs` : ceux qui mentionnent du matériel, **sur tout l'historique local**.

La seconde est le cœur du dispositif. Un log de 2019 disant « il faut une canne à pêche »
ne sortirait jamais d'une troncature aux N plus récents, et c'est pourtant l'information
la plus utile de la fiche. Le filtrage passe par `GEAR_LEXICON` (FR + EN, comparaison sur
texte normalisé sans accents), le classement par nombre de mentions puis par date.

`search_effort_logs` applique la même mécanique avec `SEARCH_EFFORT_LEXICON`, pour repérer
les caches qui font perdre du temps sur place.

### Le même lexique sur le listing et le hint

`GEAR_LEXICON` ne sert pas qu'à trier les logs : il balaie aussi le **listing complet** et
le **hint**, et les clés trouvées voyagent dans `gear_mentions_in_listing` et
`gear_mentions_in_hint`.

Trois propriétés en découlent :

- le balayage porte sur le texte **entier**, pas sur l'extrait transmis. Une mention placée
  après trois paragraphes d'histoire locale tombe hors de la troncature ; elle est repérée
  quand même ;
- il **coûte zéro token de listing** : ce qui part dans le prompt, c'est une liste de clés ;
- en **mode léger**, où `listing_chars = 0` supprime purement le listing, c'est la seule
  chose que l'IA saura du texte du propriétaire. Avant ce balayage, un drapeau « outil
  spécial requis » y était insoluble dès lors que la réponse n'était pas dans les logs.

Le prompt les rend sur une ligne unique, avant le contexte :
`- Matériel nommé dans le texte (repérage GeoApp) — listing : fishing_rod, ladder ; hint : magnet`.
Le prompt système la désigne comme une source citable au niveau **CONFIRMÉ**, au même titre
que le listing lui-même.

**Faux positifs** : plusieurs termes ont été retirés du lexique après confrontation aux
logs réels (« perche » ↔ « perché » une fois les accents retirés, « pile » ↔ « à midi
pile », « combinaison » ↔ celle d'un cadenas). Règle retenue : mieux vaut manquer une
mention que noyer l'IA sous des extraits hors sujet.

### Santé

`compute_health()` renvoie un niveau (`ok`, `watch`, `risky`, `very_risky`, `unknown`) et
les raisons qui l'expliquent, depuis les logs locaux uniquement.

Le cas important est `unknown` : sans log local — la géocache n'a jamais été rafraîchie —
la santé n'est **pas** bonne, elle est inconnue. Le bundle liste ces caches dans
`without_local_logs`, le prompt les nomme dans une section « Fiabilité des données »
placée **avant** les données, et le prompt système interdit d'en tirer une conclusion.
Aucun rafraîchissement n'est déclenché : on signale, on n'agit pas.

**Fraîcheur de la collecte** — un second cas trompe autant que l'absence de logs : des
logs *périmés*. Une cache « saine » dont les logs ont été récupérés il y a quatorze mois a
pu accumuler trois DNF depuis. Le bloc de santé distingue donc deux dates que l'on confond
facilement :

| Champ | Question à laquelle il répond |
|---|---|
| `last_log_date`, `days_since_last_log` | Quand la cache a-t-elle été visitée pour la dernière fois ? |
| `logs_fetched_at`, `days_since_logs_fetched` | Jusqu'à quand a-t-on regardé ? |
| `logs_stale` | La collecte dépasse-t-elle `LOGS_STALE_DAYS` (180 jours) ? |

`logs_fetched_at` vaut `max(updated_at, created_at)` sur les logs : le rafraîchissement
réassigne texte et type des logs connus, ce qui repousse l'horodatage quand quelque chose
a changé. Un refresh qui ne ramène rien de nouveau ne touche aucune ligne, donc
l'ancienneté calculée est **majorée, jamais minorée** — on se trompe du côté prudent.

Le niveau, lui, n'est pas dégradé par la péremption : les DNF comptés restent des DNF et
les dates de logs restent exactes. C'est la **complétude** qui est en cause, pas le calcul.
La péremption est donc rendue comme un fait — une raison dans `health.reasons`, la liste
`stale_logs` en tête du bundle, un avertissement dans le dialogue — et le prompt système
impose la même prudence que pour `unknown`.

### Géographie, ordre de visite et lumière du jour

Les coordonnées étaient en base depuis toujours et n'arrivaient jusqu'à l'IA que sous forme
de texte par cache. Le prompt système lui interdisait donc — à raison — d'énoncer la
moindre distance : elle n'aurait pu que l'inventer. `build_geography()` calcule ce qui est
calculable et le transmet en un bloc unique, `bundle.geography`, rendu dans la section
« Géographie et lumière du jour » du prompt, **avant** les fiches.

| Champ | Contenu | À quoi il sert dans le rapport |
|---|---|---|
| `centroid`, `bounding_box`, `max_pair_distance_km` | Étendue du lot | Dire en une ligne si la sortie tient dans un village ou traverse un département |
| `route` | Ordre de visite : `legs` avec `leg_km` et `cumulative_km`, `total_km`, `longest_leg_km` | Point de départ de la section « Temps et priorisation » |
| `walking_clusters` | Groupes reliés par des sauts de moins de 400 m | Où se gare la voiture, et ce qui s'enchaîne à pied |
| `sun` | Lever, coucher, crépuscules civils, durée du jour | La borne de la journée : nombre de caches réalisables, place des caches de nuit, statut de la frontale |
| `excluded` | Caches hors du calcul, avec leur raison | Expliquer une absence de l'ordre de visite, qui passerait sinon pour un oubli |

**Toutes les distances sont à vol d'oiseau.** Aucun réseau routier n'est consulté, aucun
dénivelé n'est connu. Le bloc porte `crow_flies: true`, le prompt le répète en clair sous
la section, et le prompt système en fait une règle : les seules distances autorisées sont
celles-là, et la seule conversion en durée est celle que GeoApp a faite lui-même dans la
section « Temps estimé », avec son facteur de détour annoncé.

**Une mystery non résolue est écartée du calcul**, au même titre qu'une cache sans
coordonnées : ses coordonnées publiées sont un leurre placé jusqu'à trois kilomètres du
vrai final. La faire entrer dans un centroïde ou dans un ordre de visite reviendrait à
calculer soigneusement sur une donnée fausse — le seul cas où un chiffre est pire que pas
de chiffre. Elle ressort dans `excluded` avec la raison `unsolved_mystery`, et ses
coordonnées publiées restent visibles dans sa propre fiche.

**Ordre de visite** — plus proche voisin relancé depuis *chaque* départ possible, puis
amélioré par 2-opt sur chemin ouvert. À soixante points au maximum, le surcoût est
invisible et cela supprime le choix arbitraire d'un point de départ, qui pèse lourd sur la
qualité d'un chemin glouton. Le résultat n'est pas optimal et ne prétend pas l'être :
`strategy` le nomme, le prompt l'annonce comme indicatif, et le prompt système invite
explicitement à le réordonner dès qu'une contrainte le demande — cache de nuit à la tombée
du jour, commerce fermé le midi, marée. Le chemin est **ouvert** : une sortie s'arrête à la
dernière cache, et le bundle ne sait pas où est restée la voiture.

**Groupes de marche** — lien simple sous `WALKING_CLUSTER_KM` (400 m, la séparation
minimale imposée par geocaching.com entre deux caches). Le lien simple est le bon modèle :
une série de caches le long d'un sentier forme une seule marche même si ses extrémités sont
éloignées. Une cache isolée ne forme pas de groupe et n'est pas listée.

**Éphémérides** — `outing_sun.compute_sun_times()` transcrit le *NOAA Solar Calculator* :
pas d'API, pas de dépendance, une précision de l'ordre de la minute aux latitudes
tempérées. Le calcul est fait au centroïde ; sur une zone de quelques kilomètres, l'écart
entre deux caches se compte en secondes. Les heures locales sont celles **du poste**, avec
le décalage calculé pour le jour de la sortie (l'heure d'été est donc prise en compte) ;
les heures UTC partent aussi, pour qu'une sortie à l'étranger reste interprétable. Au-delà
des cercles polaires, `polar_state` vaut `polar_day` ou `polar_night` : l'absence d'heure
de coucher y est un fait, pas une donnée manquante.

**La date de sortie est une entrée utilisateur.** `runInteractive()` la demande avant le
niveau de détail (Aujourd'hui / Demain / Après-demain / saisie libre `AAAA-MM-JJ`), et elle
part au backend dans `outing_date`. Jusqu'ici elle valait toujours « aujourd'hui » : une
sortie préparée le mercredi pour le samedi recevait la mauvaise durée de journée. Une date
illisible est ignorée plutôt que rejetée — elle ne pilote que le calcul solaire, et refuser
l'analyse entière serait disproportionné.

### Estimation de temps déterministe

Le rapport parlait de « caches chronophages » sans jamais avancer un chiffre : l'IA n'avait
aucune base pour en produire un. Or un modèle qui estime des durées au fil du texte se
contredit d'une cache à l'autre — trente minutes pour une T4 ici, dix pour une T4 là, sans
que rien ne les distingue. `outing_time_estimate.py` calcule donc les durées **avant**
l'IA, avec la même grille pour toutes les caches.

**Temps sur place** (`time_estimate` sur chaque géocache) — voiture garée à retour à la
voiture, trajet exclu. Contributions additives, chacune nommée dans `components` :

| Terme | Barème |
|---|---|
| Base par type | Traditional 10, Multi / Letterbox 15 (+ étapes), Wherigo 20, Mystery 15, EarthCache 15, Event 60, CITO 90, Mega 90, Giga 120 |
| Étapes | 10 min par waypoint de type étape / final / question ; une multi sans waypoint publié en présume 2 |
| Difficulté | 0 à 45 min selon la note (progression plus que linéaire) |
| Terrain | 0 à 45 min selon la note |
| Marche annoncée | `hike_short` 10, `hike_med` 35, `hike_long` 90, `hiking` 15 — un seul compte, le plus long |
| Signaux | Plongée 30, embarcation 25, énigme sur place 15, grimpe 15, nage 15, gué 10, outil spécial 5, équipe 5, discrétion 5 |
| Recherche longue | 10 / 15 / 20 min selon 1, 2 ou 3+ logs du lexique `search_effort` |
| Questions sur place | 4 min par question non répondue (plafond 24), + 5 si une photo est exigée |

Quatre décisions valent d'être connues :

- **Sur une mystery, la difficulté note l'énigme, pas la fouille.** Elle est résolue à la
  maison : le supplément de D est ramené à 40 % (`MYSTERY_DIFFICULTY_FACTOR`), sans quoi une
  D5 déjà résolue coûterait une heure sur le terrain.
- **Sans conteneur à trouver, pas de temps de recherche.** EarthCache, virtuelle, webcam et
  événements ignorent la difficulté : leur temps est celui de l'observation.
- **Une multi sans waypoint publié en présume deux** (`ASSUMED_STAGES`). Les étapes se
  découvrent en chemin, donc l'absence de waypoints est la norme — et sous-estimer une multi
  est l'erreur la plus fréquente d'une préparation de sortie. Connaître le final ne réduit
  pas ce plancher : les étapes qui y mènent existent toujours.
- **Une fourchette, pas un chiffre.** `low_minutes` / `high_minutes` encadrent l'estimation
  à ±20 %, ±30 % ou ±50 % selon `confidence`, et `confidence_reasons` dit pourquoi :
  drapeau matériel non résolu, énigme sur place, aucun log local, étapes présumées, D≥4.
  Une confiance basse n'abaisse pas la durée, elle élargit l'incertitude. Seuls les signaux
  qui pèsent sur la durée entament la confiance : une lampe frontale change le sac, pas
  l'horaire.

**Budget de la sortie** (`time_budget`) — somme des temps sur place, plus un temps de
trajet déduit de `geography.route`. C'est le **seul endroit du projet** où une distance à
vol d'oiseau devient une durée : une étape de moins de 400 m est marchée (3,5 km/h, détour
×1,25), au-delà elle est roulée (45 km/h, détour ×1,3, plus 3 min d'arrêt). Toutes ces
hypothèses partent dans `travel.assumptions` et sont écrites en clair dans le prompt, pour
que le modèle puisse les discuter au lieu de les subir. Sans ordre de visite calculable,
`travel` vaut `null` et le total le dit — un trajet inventé serait pire qu'un total franc.

`already_found_minutes` et `unsolved_mystery_minutes` sont **offerts, pas retranchés** :
refaire une multi avec quelqu'un est légitime, une mystery peut être résolue le soir même.
Le rapport peut alors dire « 6 h 30, ou 5 h 15 si l'on retire les deux caches déjà
trouvées » — ce que le calcul ne décide pas à la place de l'utilisateur.

Le prompt rend le tout dans une section « Temps estimé », après la géographie et avant les
fiches, et chaque fiche porte sa propre ligne avec le détail de son calcul. Ce détail n'est
pas décoratif : c'est ce qui autorise le modèle à **corriger** le chiffre plutôt qu'à le
recopier. Voir qu'une multi coûte quarante-cinq minutes dont vingt d'étapes présumées, c'est
savoir exactement quel terme discuter quand le listing en annonce six. La règle 11 du prompt
système lui demande d'ajuster en disant quel terme il corrige et pourquoi.

`method` (`geoapp_heuristic_v1`) accompagne le budget : deux analyses du même lot à six mois
d'écart doivent pouvoir se comparer, ou expliquer pourquoi elles divergent.

### Sessions

Le contrôleur ouvre une session `libre` sans `geocacheId` ni `gcCode` : l'appariement du
bridge repose donc entièrement sur le titre,
`SORTIE - <zone> - <AAAA-MM-JJ> (<n> caches)`. La date est celle de la **sortie**, pas
celle de la préparation : deux analyses visant le même samedi reprennent la même
conversation, même préparées à deux jours d'intervalle.

### Préférences

| Préférence | Défaut | Rôle |
|---|---|---|
| `geoApp.outing.analysis.detailLevel` | `standard` | Niveau proposé en premier dans le sélecteur |
| `geoApp.outing.analysis.recentLogsCount` | `5` | Logs récents par cache |
| `geoApp.outing.analysis.gearLogsCount` | `8` | Logs « matériel » par cache |
| `geoApp.outing.analysis.warnAboveCount` | `25` | Seuil d'avertissement sur le volume |
| `geoApp.outing.analysis.adaptiveBudget` | `true` | Palier de détail décidé cache par cache |
| `geoApp.outing.analysis.maxPromptTokens` | `30000` | Plafond dur du prompt, prompt système compris |
| `geoApp.outing.analysis.refreshLogsCount` | `25` | Logs récupérés par cache au rafraîchissement du pré-vol |

### Budget de tokens adaptatif

Le niveau de détail ne décide plus « listing ou pas » pour tout le lot, mais **combien on
paie pour une cache qui le mérite**. L'information n'est pas répartie uniformément : une
traditionnelle D1/T1 saine n'a rien à dire que ses attributs ne disent déjà, tandis qu'une
T5 à drapeau `special_tool` NON RÉSOLU ne se prépare pas sans son texte. Un régime uniforme
choisit donc toujours mal : trop cher pour les unes, trop pauvre pour les autres.

`outing-analysis-budget.ts` sépare deux décisions.

**1. Le palier, cache par cache** (`decideTier`). Une cache passe au palier `rich` —
listing et logs — dès qu'une règle se déclenche ; sinon elle reste `lean` : attributs,
hint, santé, temps estimé et matériel repéré par balayage, sans listing.

| Règle | Poids | Pourquoi le texte est nécessaire |
|---|---|---|
| Drapeau matériel non résolu | 100 | Sans texte, la réponse est impossible, pas seulement moins fine |
| Santé très risquée / risquée | 70 / 55 | Comprendre ce qui casse |
| Questions à répondre sur place | 50 | Les questions d'EarthCache vivent dans le listing |
| Aucun log local | 45 | Le listing est la seule source qui reste |
| Cache à étapes (multi, letterbox, Wherigo, EarthCache) | 40 | Le déroulé est dans le texte |
| Santé à surveiller | 30 | |
| Contexte contraignant (`challenge`, `partnership`, `not_available_24h`, `fee`, `risk`, `bonus`, `hike_long`) | 30 | L'énoncé de la condition n'existe que dans le texte |
| Terrain ≥ 3,5 / difficulté ≥ 3,5 | 25 / 20 | |
| Estimation de temps peu fiable | 15 | |

Les poids ne sont pas des probabilités : ils ne servent qu'à **ordonner les
rétrogradations**. Une mystery non résolue n'est volontairement pas un motif — on n'ira
pas, et son listing est le plus long et le moins exploitable du lot.

Le palier `lean` n'est acceptable que grâce au balayage lexical du lot 7 : le matériel
nommé dans le listing **complet** remonte de toute façon, et les drapeaux qu'il referme
aussi.

**2. Le plafond dur** (`buildBudgetedOutingPrompt`). Le prompt est estimé prompt système
compris, puis rétrogradé par étapes tant qu'il dépasse `maxPromptTokens` :

1. listing retiré des caches sans particularité (mode complet uniquement) ;
2. listing des caches signalées raccourci à 900 caractères ;
3. rétrogradation `rich → lean`, **par priorité croissante** : la cache la moins signalée
   perd son listing en premier ;
4. logs récents ramenés à 2 par cache ;
5. logs matériel ramenés à 4 ;
6. plus aucun log récent ;
7. un seul log matériel par cache signalée.

L'ordre suit une règle : on sacrifie d'abord le redondant, jamais l'unique. Le listing est
le poste le plus lourd et le plus redondant — son matériel a déjà été extrait — donc il
part le premier. Attributs, santé, géographie et temps estimés ne sont jamais touchés.

Si le plafond reste dépassé après toutes les étapes, l'analyse **part quand même** avec un
avertissement : refuser après que l'utilisateur a attendu la collecte serait le pire des
deux mondes, et le levier restant — réduire la sélection — lui est dit.

**Collecte.** Le serveur ignore les paliers : `collectionOptionsForPlan()` lui demande le
maximum dont le plan pourra avoir besoin (`listing_chars` du palier `rich`), et la coupe
par cache se fait à la rédaction. C'est ce qui permet de rétrograder sans second
aller-retour. Le mode léger demande donc désormais 1200 caractères de listing au serveur,
là où il en demandait zéro.

**La section « Couverture des données ».** Elle est la contrepartie obligatoire de la
stratégie mixte, et le prompt système en fait sa règle 12. Sans elle, une cache sans
listing se lirait comme une cache dont l'information manque, alors que c'est l'inverse :
GeoApp l'a lue et n'y a rien trouvé. La section écrit cette différence, annonce combien de
caches ont reçu leur listing, et nomme les rétrogradations subies. Elle disparaît quand
`adaptiveBudget` est désactivé, puisqu'il n'y a alors rien d'inégal à expliquer.

**Estimation de taille.** `estimateOutingPromptSize(prompt, { systemPromptChars })` compte
désormais le message système — prompt de l'agent **et** description de policy, qui partent
dans la même requête. La première version ne comptait que les données et sous-évaluait
l'envoi de plusieurs milliers de tokens. `OutingPromptSize` distingue `chars` (données),
`systemPromptChars` et `totalChars` ; `approxTokens` porte sur le total.

### Garde-fous

- Plafond de 60 géocaches, vérifié côté front avant l'appel réseau
  (`MAX_OUTING_ANALYSIS_GEOCACHES`) et côté backend
  (`MAX_ANALYSIS_GEOCACHE_IDS`).
- Ordre de grandeur observé : 3 caches en mode standard ≈ 7 600 caractères, soit ~2 100
  tokens estimés.
- Une géocache introuvable ne fait pas échouer l'appel : elle ressort dans `missing`.

### Limite connue

Sur une partie du parc, les colonnes `hints` et `hints_decoded` sont **inversées** en base
(le clair dans `hints`, son ROT13 dans `hints_decoded`). `_resolve_hint()` contourne le
problème en retenant le candidat qui ressemble le plus à de la langue naturelle. La donnée
elle-même n'est pas corrigée : `to_dict()` et la page de détails restent affectés.

## 32. Plan de sortie : le rapport hors du chat

Le § 31 produit un rapport. Ce paragraphe-ci décrit ce qu'il devient : le rapport ne vit
plus seulement dans la conversation, il est capturé sous forme structurée, stocké, coché,
exporté, et il alimente des badges dans les deux tables de géocaches.

La distinction à garder en tête : le **rapport** est du texte rédigé pour être lu ; le
**plan** est la même substance sous une forme qu'une machine consomme. Ils voyagent
ensemble et se stockent ensemble, mais ils ne servent pas à la même chose.

### Flux

```text
Session Chat (agent geoapp-outing-analyzer)
        |
        +--> [voie 1] tool save_outing_plan          structure seule, pendant la reponse
        |            |
        |            v
        |    OutingPlanCaptureService.capture(source: 'tool')
        |
        +--> [voie 2] reponse terminee
                     |
                     v
             GeoAppChatBridge.observeResponse()      contribution GeoAppChatResponseObserver
                     |
                     v
             OutingPlanResponseObserver
                     +--> extractOutingPlanBlock()   bloc JSON en fin de reponse
                     |        +--> capture(source: 'parsed', markdown: texte complet)
                     +--> sinon : attachMarkdown()   le plan existe deja, il lui manque le texte
                              |
                              v
                     POST /api/outing-plans  ->  outing_plan_schema.validate_plan()
                              |
                              v
                        table outing_plan
                              |
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
  Panneau « Sortie »    Badges des tables      Export Markdown
  (checklist cochee)    (colonne outing_flags)  (fiche / rapport)
```

### Deux voies de capture, volontairement redondantes

La règle 14 du prompt système demande au modèle **les deux** : le tool `save_outing_plan`,
puis un bloc JSON clôturé en toute fin de réponse. Ce n'est pas une précaution paresseuse :
les deux voies ne portent pas la même chose et n'échouent pas dans les mêmes cas.

| | Tool `save_outing_plan` | Bloc JSON de fin de réponse |
|---|---|---|
| Structure | oui, schéma typé | oui, forme libre à valider |
| Texte rédigé | **non** | oui : toute la réponse est lue |
| Échoue quand | le modèle l'oublie, la policy le retire | la génération est coupée |
| Coût | une confirmation Theia (profil `guided`) | quelques centaines de tokens de sortie |

La conséquence importante est dans la deuxième ligne : **seule la lecture de la réponse
peut attacher le rapport rédigé**, puisque le tool ne transmet que la structure. Quand un
plan existe déjà et que la réponse ne porte pas de bloc, l'observateur se contente donc
d'attacher le texte (`PATCH /api/outing-plans/<id>` avec `markdown`).

Les deux voies écrivent sous la même clé `(zone_name, outing_date)` : la seconde écriture
remplace la première au lieu de la doubler. La capture est idempotente par construction.

### L'identité de la sortie n'est jamais demandée au modèle

Zone, date et liste de codes GC sont connues de façon certaine côté front, au moment où
l'analyse part. `OutingAnalysisController.analyze()` les enregistre dans
`OutingPlanCaptureService` **avant** d'ouvrir la session — la réponse peut arriver vite — et
la capture les retrouve ensuite.

`resolveContext()` arbitre entre les sorties connues, du critère le plus sûr au plus
faible : la date annoncée par le modèle si elle correspond à une sortie lancée, sinon le
recouvrement de codes GC le plus large, sinon la dernière sortie lancée. Le dernier critère
est presque toujours le bon — une analyse répond dans la minute — mais il cesse de l'être
dès que deux analyses se chevauchent.

Le motif de toute cette mécanique : une date recopiée de travers par un modèle rangerait le
plan sous la mauvaise sortie, et **rien ne le signalerait**. Le libellé de zone est celui du
titre de session, `resolveZoneLabel()`, pour que la conversation et le plan ne décrivent pas
la même sortie sous deux clés.

### Le serveur normalise, il ne rejette presque jamais

`outing_plan_schema.validate_plan()` ramène ce qui arrive à une forme fixe :

| Entrée | Sortie |
|---|---|
| `certainty: "peut-être"` | `precaution`, le défaut le plus prudent |
| `severity`, `kind`, `flags` hors vocabulaire | ramenés au défaut, ou jetés pour les drapeaux |
| `minutes: "45 min"` | `45`, borné à 24 h |
| `gc_code: "gcabc"` | `GCABC` ; illisible → écarté, compté dans `warnings` |
| Deux lignes « lampe frontale » | fusionnées, certitude la plus forte, union des codes |
| `time_budget` sans total | total calculé depuis sur place + trajet |

Le seul refus est le **plan vide** — ni checklist, ni alerte, ni détail par cache. Le
stocker ferait croire à une analyse aboutie. Partout ailleurs, la règle est qu'un rapport
amputé vaut mieux qu'un rapport rejeté : le texte est déjà sous les yeux de l'utilisateur
dans le chat, et refuser la capture ne lui rend aucun service. Chaque coupe part dans
`warnings`, que l'UI affiche.

### Les drapeaux par cache sont dérivés, pas seulement recopiés

`_derive_flags()` complète `per_cache[].flags` depuis les alertes et le matériel listé :

| Source | Drapeau ajouté |
|---|---|
| Alerte `severity: blocking` | `blocking` |
| Alerte `kind: health` | `risky_health` |
| Alerte `kind: access` / `schedule` / `gear` / `data` | `access` / `time_window` / `gear_required` / `stale_data` |
| Alerte `unsolved_mystery` / `already_found` | `blocking` |
| `gear` non vide | `gear_required` |

Une alerte bloquante sur GCXXXX crée au besoin l'entrée `per_cache` correspondante. Les
badges des tables lisent ces drapeaux : les faire dépendre de la discipline du modèle à
répéter deux fois la même information les rendrait intermittents, ce qui est pire
qu'absents.

### Stockage

Table `outing_plan`, clé métier `(zone_name, outing_date)` — la même que le titre de session
du chat. Relancer l'analyse d'une sortie remplace son plan, exactement comme elle reprend la
même conversation.

| Colonne | Rôle |
|---|---|
| `payload` | Le plan normalisé, JSON en texte |
| `markdown` | Le rapport rédigé, quand il a pu être attaché |
| `gc_codes` | Les caches du lot, pour la recherche par code |
| `checked` | Les clés de checklist cochées |
| `source` | `tool` ou `parsed` — diagnostic : tout en `parsed` signale un tool non exposé |

**L'état coché survit à une relance** pour les lignes dont la clé n'a pas bougé : relancer
une analyse ne doit pas vider un sac à moitié fait. La clé est le slug du libellé,
`normalize_key()` côté Python et `normalizeChecklistKey()` côté TypeScript, avec un test de
chaque côté pour qu'elles coïncident. Une reformulation du modèle (« lampe frontale » vers
« frontale ») perd la coche : c'est le prix d'une clé lisible, et la perte est visible.

### Endpoints

| Route | Rôle |
|---|---|
| `POST /api/outing-plans` | Upsert. Renvoie le plan normalisé et les `warnings` |
| `GET /api/outing-plans` | Liste, filtrable par date et zone. Le Markdown est omis |
| `GET /api/outing-plans/<id>` | Détail, Markdown compris |
| `PATCH /api/outing-plans/<id>` | `checked` et/ou `markdown` |
| `DELETE /api/outing-plans/<id>` | Suppression |
| `POST /api/outing-plans/flags` | Drapeaux pour un lot de codes GC : ce que lisent les tables |

`/flags` répond par le plan **le plus récent** qui parle de chaque code, et renvoie son
identité avec — un badge doit pouvoir dire de quelle analyse il vient. Le filtrage se fait
en Python sur les cinquante plans les plus récents : `gc_codes` est du JSON en colonne
texte, que SQLite ne sait pas indexer, et le volume est de l'ordre de la dizaine.

### Le point d'extension `GeoAppChatResponseObserver`

Le bridge sait ouvrir une session et attendre sa réponse ; il n'a pas à savoir ce qu'on veut
en faire. `sendRequest()` renvoie une `ChatRequestInvocation`, dont `responseCompleted` est
attendu **sans bloquer l'ouverture de session** — une génération dure des dizaines de
secondes. Chaque observateur est isolé : l'un qui lève ne prive pas les autres de
l'événement, et ne fait pas remonter d'erreur dans un chat qui, lui, a réussi.

`OutingPlanResponseObserver` ne s'active que sur une session de sortie, reconnue à son agent
épinglé ou, à défaut, au préfixe `SORTIE - ` de son titre — une session reprise peut avoir
perdu son épinglage sans cesser d'être la même préparation.

### Le tool est déclaré `local_write`, sans tricher

`geoapp.outing.save-plan` écrit en base. Sous le profil `guided`, le défaut, il passe donc
par une confirmation Theia au premier appel, avec l'option « toujours autoriser ». Le
déclarer `read_only` pour épargner un clic viderait de son sens la colonne « écrit en
local » du panneau Policy. Un test verrouille l'appariement entre l'`id` du tool et la clé
du catalogue : un identifiant qui diverge ferait sortir le tool de la policy GeoApp, donc
d'une écriture en base soumise à confirmation.

### Panneau « Sortie »

Commande `GeoApp: Checklist de sortie`. Il affiche le plan tel que le serveur l'a normalisé
— il n'invente rien — et y ajoute la provenance : quelle sortie, quand, sur combien de
caches, et par quelle voie de capture. La seule interaction structurante est la case à
cocher : elle bascule immédiatement à l'écran et le serveur suit, parce qu'une case qui
attend un aller-retour donne l'impression de ne pas répondre. En cas d'échec, l'état revient
à celui du serveur et l'erreur est dite.

Une capture pendant que le panneau est ouvert s'y affiche : c'est exactement le moment où
l'utilisateur regarde le résultat de son analyse. Hors du panneau, une notification propose
de l'ouvrir, avec une fenêtre de silence d'une minute par plan — le double appel tool + bloc
est le cas nominal, notifier deux fois serait du bruit.

### Badges dans les tables

Colonne `outing_flags` (« Sortie ») dans la table de zone, et badges collés au code GC dans
le tableau du log-editor, dont le jeu de colonnes est fixe et déjà dense. Les deux tirent de
`POST /api/outing-plans/flags`, par l'intermédiaire d'un cache qui mémorise **aussi les
absences** : une table se redessine à chaque tri, à chaque filtre et à chaque sélection, et
une table dont aucune cache n'est couverte rappellerait le serveur à chaque rendu. Le cache
est vidé à chaque écriture de plan, et les deux widgets écoutent `onDidChangePlans`.

**L'infobulle nomme la sortie d'origine et sa date.** Ces drapeaux viennent d'un modèle, pas
d'un calcul GeoApp, et le log-editor affiche justement sa liste longtemps après l'analyse.
Un badge « santé risquée » lu comme un fait calculé serait plus trompeur que pas de badge.

### Export : deux documents, pas un

| Document | Contenu | Quand |
|---|---|---|
| **Rapport** (`plan.markdown`) | Le texte du modèle : il argumente, il cite ses sources | Relecture la veille |
| **Fiche** (`buildOutingPlanMarkdown()`) | Checklist avec ses cases, alertes, ordre, budget | Ce qu'on emporte |

La fiche est toujours disponible, puisqu'elle se génère depuis la structure. Le rapport peut
manquer — le tool ne le transmet pas — et c'est un cas expliqué à l'utilisateur, pas masqué
par un fichier vide. Le pied de la fiche nomme l'analyse, sa date, son modèle et le nombre
de caches, et rappelle que les recommandations viennent d'un modèle : emportée sur le
terrain trois semaines plus tard, elle n'a plus aucun autre contexte.

### Ce qui a été écarté

- **Note GeoApp par cache** : écrire `per_cache` en note système sur chaque géocache. Ces
  notes repartiraient dans le bundle de la prochaine analyse (§ 31, « Ce que contient le
  bundle »), et l'IA relirait sa propre sortie comme une source utilisateur. Le faire
  supposerait de les filtrer à la collecte.
- **Note de zone** : le modèle `Note` de GeoApp est attaché à une géocache, pas à une zone.
  La table `outing_plan` joue ce rôle avec sa propre clé métier.

### Limites connues

- Si ni le tool ni le bloc n'aboutissent, il n'y a pas de plan : le rapport reste dans la
  conversation, et aucun bouton ne le repêche manuellement.
- Le bloc JSON coûte quelques centaines de tokens de sortie, redondants avec le tool quand
  les deux fonctionnent. Le plafond du lot 10 (§ 31) porte sur l'entrée et ne s'y applique
  pas.
- Un plan écrit depuis une autre fenêtre ne rafraîchit pas les badges de celle-ci : le cache
  est par session front.

## 33. Résumé technique

Le Chat IA GeoApp moderne repose sur une séparation claire :

- agents modèles : choix du modèle ;
- profils comportementaux : degré d'automatisation ;
- catalogue : inventaire enrichi des tools ;
- policy : décision effective par requête ;
- prompt packs : consignes système ;
- skills : stratégies spécialisées ;
- configuration service : sauvegarde/restauration ;
- policy widget : diagnostic et contrôle utilisateur.

Cette architecture permet de faire évoluer le chat sans recoder la liste des tools ou le prompt système à chaque changement. Elle garde Theia au centre du système, tout en ajoutant une couche GeoApp spécialisée pour les besoins du géocaching.
