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
| `frontend/theia-extensions/zones/src/browser/geoapp-chat-bridge.ts` | Ouvre/reprend les sessions Chat IA depuis les widgets GeoApp. |
| `frontend/theia-extensions/zones/src/browser/zones-frontend-module.ts` | Wiring Inversify/Theia des services, widgets et agents. |
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

Chaque agent partage la même base technique via `BaseGeoAppChatAgent`.

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
| `formula-solver.calculate-value` | `formula` | `read_only` |
| `formula-solver.calculate-coordinates` | `formula` | `read_only` |

### Plugins dynamiques

Tout tool dont l'ID commence par `plugin.` peut être reconnu dynamiquement.

Le catalogue infère sa catégorie :

- `ocr` ou `qr` -> `image` ;
- `coord` -> `coordinates` ;
- `metasolver` -> `metasolver` ;
- sinon -> `plugins`.

Par défaut, un plugin dynamique n'est pas activé automatiquement.

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

Si aucune valeur n'est définie, le prompt pack suit le profil comportemental.

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

## 31. Résumé technique

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
