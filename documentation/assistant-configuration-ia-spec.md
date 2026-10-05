# Assistant « Configurer l'IA » — spécification

> Document destiné au LLM qui implémentera le chantier. Il suppose la lecture préalable de
> `frontend/theia-extensions/documentation/docs/ia/configure.md` (fonctionnement actuel vu par
> l'utilisateur) et de `documentation/preferences-ajout-rapide.md` (conventions du schéma de
> préférences). Les numéros de ligne sont ceux du commit `1877b33`.
>
> Conventions du dépôt : commits en français au format `Domaine > description`, un commit par lot.
> Build frontend : `cd frontend && yarn build:extensions`. Chaque lot laisse l'application fonctionnelle.

## 1. Objectif

Un nouvel utilisateur doit pouvoir rendre l'IA de GeoApp fonctionnelle en moins de deux minutes,
sans connaître Theia. L'assistant fait trois choses : **obtenir un modèle qui répond**, **le
brancher sur l'alias `default/universal`**, puis **passer la main à `@Aide`**, qui sait faire tous
les réglages fins.

L'assistant est proposé au démarrage tant que l'IA n'est pas prête, et reste accessible ensuite.

Décisions déjà prises avec l'utilisateur :

- l'étape finale branche **toute l'IA d'un coup** via `default/universal`, pas le seul agent `@Aide` ;
- la première version couvre **six fournisseurs** : OpenRouter, Anthropic, OpenAI, Google, Ollama, LM Studio.

## 2. Ce qui existe et ce qui manque

### 2.1 Faits vérifiés dans le code

| Fait | Source |
|---|---|
| Tous les agents GeoApp demandent `default/universal` par défaut | `doc-agent.ts:32-34` et les autres agents ; liste des tâches dans `GEOAPP_AI_TASKS` (`geoapp-ai-model-resolution-service.ts:33-53`) |
| L'alias `default/universal` vise par défaut `anthropic/claude-opus-5`, `openai/gpt-5.6-sol`, `google/gemini-3.1-pro-preview` | `node_modules/@theia/ai-core/src/browser/frontend-language-model-alias-registry.ts:39-46` |
| **Aucun slot `openrouter/*` ni modèle local ne figure dans ces cibles** : avec une seule clé OpenRouter ou un Ollama local, aucun agent ne fonctionne tant que l'alias n'est pas modifié à la main | idem |
| L'alias s'écrit par `LanguageModelAliasRegistry.selectModelForAlias('default/universal', modelId)` ; la valeur est persistée dans `ai-features.languageModelAliases` (portée utilisateur) | même fichier, lignes 144-151 et 170-178 |
| Il n'existe pas de méthode pour retirer la sélection d'un alias : il faut réécrire la préférence `ai-features.languageModelAliases` sans l'entrée | même fichier |
| `GeoAppAiModelResolutionService` sait dire si une tâche est prête (`resolveForAgent`, `resolveAll`), lister les modèles (`getModelChoices`), remettre un agent sur son défaut (`resetTaskModel`) et notifier les changements (`onDidChange`) | `geoapp-ai-model-resolution-service.ts` |
| Les slots OpenRouter ne sont enregistrés que si `geoApp.ai.openRouter.enabled` est vrai **et** qu'une clé est saisie | `geoapp-openrouter-language-models.ts:87-92` |
| Les défauts des slots OpenRouter sont `openai/gpt-4o-mini` et `openai/gpt-4o` | `geoapp-openrouter-language-models.ts:32-37` |
| Anthropic, OpenAI et Google **découvrent** leurs modèles auprès du fournisseur dès que la clé est saisie ; les identifiants sont `anthropic/<id>`, `openai/<id>`, `google/<id>` | `@theia/ai-anthropic/src/browser/anthropic-frontend-application-contribution.ts:78-81, 133-134` et équivalents |
| Ollama n'enregistre que les modèles listés dans `ai-features.ollama.ollamaModels` ; identifiants `ollama/<nom>` | `@theia/ai-ollama/src/browser/ollama-frontend-application-contribution.ts` |
| Il n'y a pas de fournisseur LM Studio côté Theia : un modèle LM Studio de chat passe par `ai-features.openAiCustom.customOpenAiModels` (entrée `{ id, model, url, apiKey }`) ; GeoApp reconnaît le préfixe d'identifiant `lmstudio/` comme local | `@theia/ai-openai/src/browser/openai-frontend-application-contribution.ts:182-200`, `geoapp-local-model-guard.ts:128` |
| `@Aide` refuse de lire ou d'écrire toute préférence `x-sensitive` | `doc-action-tools.ts:586-718` |
| La page d'accueil est `TheiaIDEGettingStartedWidget` ; l'extension `product` ne dépend d'aucune extension GeoApp | `product/src/browser/theia-ide-getting-started-widget.tsx`, `product/package.json` |
| Aucune extension GeoApp n'utilise encore la barre d'état | recherche `StatusBar` sans résultat |

### 2.2 Clés de préférence par fournisseur

| Fournisseur | Ce que l'assistant écrit | Identifiant branché sur `default/universal` |
|---|---|---|
| OpenRouter | `geoApp.ai.openRouter.apiKey`, `geoApp.ai.openRouter.enabled = true`, `geoApp.ai.openRouter.model.strong` | `openrouter/strong` |
| Anthropic | `ai-features.anthropic.AnthropicApiKey` | `anthropic/<modèle choisi>` |
| OpenAI | `ai-features.openAiOfficial.openAiApiKey` | `openai/<modèle choisi>` |
| Google | `ai-features.google.apiKey` | `google/<modèle choisi>` |
| Ollama | `ai-features.ollama.ollamaHost`, ajout à `ai-features.ollama.ollamaModels` | `ollama/<modèle choisi>` |
| LM Studio | ajout d'une entrée à `ai-features.openAiCustom.customOpenAiModels`, `geoApp.ocr.lmstudio.baseUrl` | `lmstudio/<modèle choisi>` |

Les clés `ai-features.*` sont écrites en dur sous forme de chaînes, comme le fait déjà
`geoapp-ai-model-resolution-service.ts:1046-1049`, pour ne pas ajouter de dépendance de paquet.

Les listes (`ollamaModels`, `customOpenAiModels`) sont **complétées**, jamais remplacées : une entrée
existante de l'utilisateur ne doit pas disparaître. Une entrée de même identifiant est mise à jour.

## 3. Principes de conception

1. **L'état se déduit, il ne se mémorise pas.** « L'IA est prête » signifie : la tâche `aide`
   (agent `geoapp-doc-aide`) se résout avec le statut `ready`. Aucun drapeau « assistant déjà vu ».
   Le rappel disparaît donc tout seul si l'utilisateur configure à la main, et revient si la
   configuration casse.
2. **Un seul test, par le vrai chemin.** Le bouton « Tester » envoie une requête minimale
   (« Réponds OK ») au modèle par `LanguageModel.request`, exactement comme le fera un agent.
   Pas d'appel `fetch` direct aux API des fournisseurs depuis le navigateur : Anthropic, OpenAI et
   Google le refuseraient (CORS), et cela ne prouverait pas que Theia sait joindre le modèle.
3. **Les clés ne transitent que par l'assistant et la page Préférences.** Jamais par le chat,
   jamais dans un log, jamais dans un message d'erreur affiché.
4. **Ne rien casser de l'existant.** L'assistant ne touche ni aux affectations par agent
   (`AISettingsService`), ni aux clés des autres fournisseurs.

## 4. Ordre de livraison

| Lot | Sujet | Dépend de |
|---|---|---|
| 1 | Service de configuration (sans interface) | — |
| 2 | Widget assistant en 3 étapes + écran d'état | 1 |
| 3 | Points d'entrée : accueil, barre d'état, préférences, rappel | 1, 2 |
| 4 | `@Aide` et documentation | 2 |

---

## Lot 1 — Service de configuration

Nouveau fichier `frontend/theia-extensions/zones/src/browser/geoapp-ai-setup-service.ts`, lié en
singleton dans le module frontend de `zones`. L'extension `zones` possède déjà les dépendances
`@theia/ai-core` et `@theia/ai-openai` et le service de résolution.

### 1.1 Description des fournisseurs

Une constante `GEOAPP_AI_SETUP_PROVIDERS` décrit les six fournisseurs :

```ts
interface GeoAppAiSetupProvider {
    id: 'openrouter' | 'anthropic' | 'openai' | 'google' | 'ollama' | 'lmstudio';
    label: string;
    kind: 'cloud' | 'local';
    tagline: string;            // une phrase affichée sur la carte
    recommended?: boolean;      // OpenRouter uniquement
    keyUrl?: string;            // page où créer une clé (cloud)
    keyPreference?: string;     // préférence de la clé (cloud)
    defaultEndpoint?: string;   // local : http://localhost:11434, http://localhost:1234
    modelIdPrefix: string;      // 'anthropic/', 'ollama/', 'lmstudio/'… ('openrouter/' pour les slots)
}
```

Textes des cartes (à reprendre tels quels) :

| Fournisseur | Phrase |
|---|---|
| OpenRouter | Une seule clé donne accès aux modèles de tous les éditeurs. Paiement à l'usage. |
| Anthropic | Les modèles Claude, avec votre clé Anthropic. |
| OpenAI | Les modèles GPT, avec votre clé OpenAI. |
| Google | Les modèles Gemini, avec votre clé Google AI. |
| Ollama | Modèles installés sur cet ordinateur. Gratuit, fonctionne hors ligne. |
| LM Studio | Modèles chargés dans LM Studio sur cet ordinateur. Gratuit, fonctionne hors ligne. |

### 1.2 API du service

```ts
getStatus(): Promise<GeoAppAiSetupStatus>
readonly onDidChangeStatus: Event<GeoAppAiSetupStatus>
detectLocalProviders(): Promise<Array<{ id: 'ollama' | 'lmstudio'; endpoint: string; models: string[] }>>
getProviderState(id): { configured: boolean; endpoint?: string }   // ne renvoie jamais la clé
saveCredentials(id, { apiKey?, endpoint? }): Promise<void>
listModels(id): Promise<GeoAppAiSetupModel[]>
testModel(modelId): Promise<{ ok: true } | { ok: false; reason: GeoAppAiSetupFailure; detail?: string }>
apply(id, modelChoice): Promise<GeoAppAiSetupStatus>
resetDefaultModel(): Promise<void>
```

**`getStatus`** renvoie :

```ts
interface GeoAppAiSetupStatus {
    ready: boolean;              // tâche 'aide' au statut 'ready'
    aiEnabled: boolean;          // geoApp.ai.enabled
    dismissed: boolean;          // geoApp.ai.setup.dismissed
    defaultModelId?: string;     // modèle résolu pour default/universal
    defaultModelLabel?: string;  // pour un slot OpenRouter : le modèle réel derrière le slot
    providerId?: string;         // fournisseur déduit de defaultModelId
    tasks: GeoAppAiModelResolution[];   // resolveAll()
}
```

`onDidChangeStatus` se branche sur `GeoAppAiModelResolutionService.onDidChange`, avec un
anti-rebond de 500 ms (une saisie de clé déclenche plusieurs événements).

**Attention au démarrage.** Les fournisseurs enregistrent leurs modèles de façon asynchrone
(découverte réseau pour Anthropic, OpenAI et Google). `getStatus` appelé trop tôt renvoie
`ready: false` à tort. Le service expose donc `whenSettled: Promise<void>`, résolue quand
`preferenceService.ready` et `languageModelAliasRegistry.ready` sont résolues **et** qu'aucun
événement `languageModelRegistry.onChange` n'est survenu depuis 3 s (plafond : 10 s après le
démarrage). Les consommateurs du lot 3 attendent `whenSettled` avant d'afficher un rappel.

**`detectLocalProviders`** interroge en parallèle, avec un délai de 1,5 s :

- Ollama : `GET {hôte}/api/tags` → noms des modèles installés ;
- LM Studio : `GET {base}/v1/models` → identifiants des modèles.

Les hôtes par défaut viennent de `ai-features.ollama.ollamaHost` et `geoApp.ocr.lmstudio.baseUrl`.
Un fournisseur qui ne répond pas est simplement absent du résultat. Reprendre `fetchJson` et
`normalizeModelsEndpoint` du service de résolution (les rendre réutilisables plutôt que les copier).

**`listModels`** :

- *OpenRouter* : `GET {baseUrl}/models` (public, déjà appelé par le service de résolution).
  Chaque entrée porte `supportsTools` (présence de `tools` dans `supported_parameters`) et
  `supportsVision`. Ne garder dans la liste que les modèles avec `supportsTools` ; un modèle saisi
  à la main qui n'y figure pas reste accepté (§ 1.3).
- *Anthropic, OpenAI, Google* : `languageModelRegistry.getLanguageModels()` filtré sur le préfixe
  d'identifiant et le statut différent de `unavailable`. La découverte suit la saisie de la clé :
  attendre jusqu'à 8 s l'apparition d'au moins un modèle avant de conclure à une liste vide.
- *Ollama, LM Studio* : résultat de `detectLocalProviders`.

Les modèles sont triés avec les suggestions en tête (voir 1.3).

**`testModel`** récupère le modèle par `languageModelRegistry.getLanguageModel(modelId)` et lui
envoie une requête d'un seul message utilisateur, sans outil, avec un délai maximal de 30 s (60 s
pour un fournisseur local, dont le premier appel charge le modèle en mémoire). L'échec est classé :

| `reason` | Détection | Message affiché |
|---|---|---|
| `invalid-key` | HTTP 401 / 403 | La clé est refusée par le fournisseur. Vérifiez qu'elle est complète et active. |
| `no-credit` | HTTP 402, ou 429 avec mention de quota | Le compte n'a plus de crédit ou a atteint sa limite. |
| `model-not-found` | HTTP 404 | Ce modèle n'est pas disponible avec cette clé. |
| `unreachable` | erreur réseau, délai dépassé | Impossible de joindre le fournisseur. Pour un modèle local, vérifiez que le logiciel est lancé. |
| `not-registered` | modèle absent du registre | Le modèle n'est pas encore enregistré. Réessayez dans quelques secondes. |
| `unknown` | autre | Le modèle n'a pas répondu. (suivi de `detail`) |

`detail` est le message d'erreur brut, **passé par une fonction qui retire toute occurrence de la
clé** avant affichage ou journalisation.

**`apply`** exécute dans l'ordre, et s'arrête à la première erreur :

1. écrire les préférences du fournisseur (tableau 2.2), en portée utilisateur ;
2. attendre que le modèle cible apparaisse dans le registre avec un statut différent de `unavailable` (8 s max) ;
3. `testModel` ; en cas d'échec, **ne pas toucher à l'alias** et renvoyer l'erreur ;
4. `selectModelForAlias('default/universal', modelId)` ;
5. renvoyer `getStatus()`.

Pour OpenRouter, `modelChoice` est l'identifiant OpenRouter réel (ex. `anthropic/claude-…`) : il est
écrit dans `geoApp.ai.openRouter.model.strong` et l'alias reçoit `openrouter/strong`. Les slots
`fast`, `web` et `vision` ne sont pas modifiés.

**`resetDefaultModel`** réécrit `ai-features.languageModelAliases` sans l'entrée `default/universal`.

### 1.3 Suggestions de modèles

Constante unique `GEOAPP_AI_SETUP_SUGGESTED_MODELS: Record<ProviderId, string[]>`, dans le même
fichier. Un modèle suggéré est marqué « Recommandé » et présélectionné s'il figure dans la liste
réellement disponible ; sinon l'assistant présélectionne le premier modèle de la liste.

Contenu initial : pour Anthropic, OpenAI et Google, reprendre les cibles par défaut de Theia
(`claude-opus-5`, `gpt-5.6-sol`, `gemini-3.1-pro-preview`).

Pour OpenRouter, Ollama et LM Studio, **la liste reste vide : il n'y a pas de suggestion** (décision
de l'utilisateur du 2026-10-05). Qui utilise ces systèmes connaît le nom de son modèle et le choisit
lui-même. Conséquences :

- aucun modèle n'est présélectionné pour ces trois fournisseurs, sauf la valeur déjà enregistrée
  (`geoApp.ai.openRouter.model.strong` si elle a été modifiée par l'utilisateur, ou le modèle
  actuellement branché sur `default/universal`) ;
- le choix du modèle accepte une **saisie libre** en plus de la liste : un nom tapé à la main et
  absent de la liste est accepté tel quel, c'est `testModel` qui dira s'il est valide. Cela couvre
  un modèle OpenRouter tout juste sorti ou un modèle Ollama pas encore listé.

### 1.4 Préférence ajoutée

Dans `shared/preferences/geo-preferences-schema.json`, catégorie `ai` :

| Clé | Type | Défaut | Rôle |
|---|---|---|---|
| `geoApp.ai.setup.dismissed` | boolean | `false` | L'utilisateur a choisi « Ne plus proposer » |

`x-targets: ["frontend"]`, libellé « Ne plus proposer la configuration de l'IA », section « Général ».

### 1.5 Tests

`zones/src/browser/tests/geoapp-ai-setup-service.test.ts`, sur le modèle de
`geoapp-ai-model-resolution-service.test.ts` :

- `getStatus` : prêt / non prêt selon la résolution de la tâche `aide` ;
- `apply` OpenRouter : écrit clé + `model.strong`, sélectionne `openrouter/strong` ;
- `apply` Ollama : complète `ollamaModels` sans perdre les entrées existantes ;
- `apply` LM Studio : ajoute une entrée `customOpenAiModels` d'identifiant `lmstudio/<modèle>`, met à jour l'entrée si elle existe ;
- `apply` avec `testModel` en échec : l'alias n'est **pas** modifié ;
- classification des erreurs de `testModel` (401, 402, 404, erreur réseau) ;
- le `detail` d'une erreur ne contient jamais la clé.

**Critères d'acceptation.** Depuis la console du navigateur, sur un profil vierge, appeler `apply`
avec une clé OpenRouter valide rend `@Aide` fonctionnel dans le chat sans autre manipulation.

---

## Lot 2 — Widget assistant

Nouveau widget React `GeoAppAiSetupWidget` (identifiant `geoapp-ai-setup`), ouvert dans la zone
principale, fichier `zones/src/browser/geoapp-ai-setup-widget.tsx` + feuille de style dédiée.
Commande `geoapp.ai.setup.open`, libellé **« GeoApp : Configurer l'IA »**, visible dans la palette.

Le widget s'ouvre sur l'**écran d'état** si l'IA est prête, sur l'**étape 1** sinon.

### 2.1 Étape 1 — Choisir un fournisseur

Six cartes, en deux groupes titrés **« En ligne »** (OpenRouter, Anthropic, OpenAI, Google) et
**« Sur cet ordinateur »** (Ollama, LM Studio).

- OpenRouter porte la pastille « Recommandé ».
- À l'ouverture, `detectLocalProviders` est lancé. Une carte locale détectée affiche
  « Détecté · N modèles » ; une carte non détectée affiche « Non détecté » mais reste cliquable.
- Une carte dont le fournisseur a déjà une clé affiche « Déjà configuré ».

Sous les cartes, une ligne d'aide : « Vous hésitez ? OpenRouter convient à la plupart des usages :
une seule clé, et vous changez de modèle quand vous voulez. »

### 2.2 Étape 2 — Connexion et modèle

*Fournisseur en ligne :*

- champ **Clé API** de type mot de passe, avec bouton afficher/masquer ;
- lien « Créer une clé sur … » (`keyUrl`, ouvert dans le navigateur externe) ;
- si une clé existe déjà : le champ est vide avec l'indication « Une clé est déjà enregistrée —
  laissez vide pour la conserver ». La clé existante n'est jamais réaffichée ;
- mention fixe sous le champ : « La clé est enregistrée en clair dans les préférences de cet
  ordinateur. » (c'est le comportement actuel de Theia et de GeoApp) ;
- bouton **« Vérifier la clé »** : appelle `saveCredentials` puis `listModels`.

*Fournisseur local :*

- champ **Adresse** prérempli (`defaultEndpoint` ou valeur détectée) ;
- bouton **« Rechercher les modèles »** ;
- si rien ne répond : « Aucun serveur ne répond à cette adresse. Lancez Ollama (ou le serveur local
  de LM Studio), puis réessayez. » Pour LM Studio, ajouter : « Activez aussi l'option CORS du
  serveur local dans LM Studio. »

*Choix du modèle*, affiché une fois la liste obtenue :

- liste déroulante avec champ de recherche (OpenRouter renvoie plusieurs centaines de modèles) ;
- pour OpenRouter, Ollama et LM Studio : saisie libre acceptée, aucun modèle présélectionné, et un
  texte d'aide sous le champ — « Saisissez ou choisissez le nom du modèle, tel qu'il apparaît chez
  {fournisseur}. » (exemple de format seulement : `éditeur/modèle` pour OpenRouter) ;
- pour Anthropic, OpenAI et Google : les modèles suggérés en tête, marqués « Recommandé » ;
- pour un fournisseur local, un avertissement fixe : « `@Aide` s'appuie sur de très nombreux
  outils. Un petit modèle local peut répondre mais mal piloter l'application. Préférez un modèle
  annoncé compatible avec les appels d'outils. »

Boutons de pied : **« Retour »** et **« Tester et activer »** (désactivé sans modèle choisi).

### 2.3 Étape 3 — Activation

« Tester et activer » appelle `apply`. Pendant l'appel, afficher les quatre phases avec leur état
(en attente / en cours / fait / échec) :

1. Enregistrement de la connexion
2. Enregistrement du modèle
3. Test du modèle
4. Activation pour tous les assistants

En cas d'échec : le message du tableau 1.2, le détail repliable, et un retour possible à l'étape 2
avec les champs conservés (sauf la clé, jamais réaffichée).

En cas de succès : passage à l'écran d'état, avec un encadré « L'IA est prête » et le bouton
principal **« Essayer @Aide »**. Ce bouton ouvre le chat et y place, sans l'envoyer, le texte
`@Aide Que peux-tu faire pour moi ?`. Reprendre le mécanisme d'ouverture du chat déjà utilisé par
`geoapp-chat-bridge.ts`.

### 2.4 Écran d'état

Sert d'accueil quand l'IA est prête, et de diagnostic.

- **En-tête** : « IA prête » ou « IA non configurée », le fournisseur et le modèle par défaut
  (pour un slot OpenRouter, le modèle réel), boutons **« Changer de modèle ou de fournisseur »**
  (retour à l'étape 1) et **« Tester à nouveau »**.
- **Tableau des tâches**, à partir de `status.tasks`, en trois groupes :
  - *Assistants* : les tâches sans exigence particulière (dont `aide`, `chat-main`, `earthcoach`) ;
  - *Fonctions spécialisées* : tâches avec `requiredCapabilities` ou `optionalCapabilities`
    (vision, web, sortie structurée) ;
  - *Hors ligne* : tâches `requiresLocalModel`.

  Une tâche des deux derniers groupes qui n'est pas prête est présentée comme **« Optionnel »**, en
  gris, avec la raison (« nécessite un modèle local », « nécessite un modèle avec vision »), et
  **non comme une erreur** : avec un modèle en ligne, les tâches « Local » sont normalement
  indisponibles.
- Une tâche du premier groupe qui a une affectation propre (`source === 'agent'`) et n'est pas
  prête affiche un bouton **« Remettre sur le modèle par défaut »** (`resetTaskModel`).
- **Pied** « Aller plus loin » : trois liens — « Demander à @Aide » (ouvre le chat), « Configuration
  IA avancée » (`aiConfiguration:open`), « Préférences IA » (page Préférences, catégorie `ai`).

L'écran se rafraîchit sur `onDidChangeStatus`.

### 2.5 Accessibilité et style

Navigation complète au clavier, cartes en `role="button"` avec `tabIndex` (comme
`renderCard` dans `theia-ide-getting-started-widget.tsx:86-110`), couleurs issues des variables de
thème Theia, lisible en thème clair et sombre.

**Critères d'acceptation.**

- Profil vierge, clé OpenRouter valide : trois écrans, puis `@Aide` répond dans le chat.
- Clé fausse : message « La clé est refusée… », l'alias n'a pas changé.
- Ollama arrêté : « Non détecté » sur la carte, message clair à l'étape 2, aucune exception en console.
- Rouvrir l'assistant une fois l'IA prête : écran d'état, pas l'étape 1.
- La clé n'apparaît ni dans la console, ni dans le DOM après enregistrement, ni dans les logs du backend.

---

## Lot 3 — Points d'entrée

### 3.1 Page d'accueil

L'extension `product` ne connaît pas `zones`. Deux possibilités ; **retenir la première** :

- ajouter `theia-ide-zones-ext` aux dépendances de `product` et injecter `GeoAppAiSetupService`
  en `@optional()` dans `TheiaIDEGettingStartedWidget` ;
- (écarté : dupliquer la logique d'état dans `product`).

Vérifier que cette dépendance ne crée pas de cycle (`zones` ne doit pas dépendre de `product`).

Dans `render()` (`theia-ide-getting-started-widget.tsx:57`), entre le bandeau titre et « Accès rapide » :

- **IA non prête, non écartée, `geoApp.ai.enabled` vrai** → bandeau :
  « **L'IA n'est pas encore configurée.** Deux minutes suffisent pour activer l'assistant @Aide et
  les analyses. » avec **« Configurer l'IA »** (bouton principal), **« Plus tard »** (masque le
  bandeau jusqu'au prochain démarrage) et **« Ne plus proposer »** (`geoApp.ai.setup.dismissed = true`).
- **IA prête** → une ligne discrète : « IA prête · {modèle} » avec un lien « Modifier ».
- **Avant `whenSettled`** → rien (pas de bandeau qui apparaît puis disparaît).

Ajouter une septième carte à `WELCOME_CARDS` : commande `geoapp.ai.setup.open`, icône
`codicon-sparkle`, titre « Configurer l'IA », description « Choisir le fournisseur et le modèle
des assistants ». Elle reste affichée dans tous les cas, y compris après « Ne plus proposer ».

Le widget se met à jour sur `onDidChangeStatus`.

### 3.2 Barre d'état

Contribution `FrontendApplicationContribution` dans `zones`. Après `whenSettled`, si l'IA n'est pas
prête et `geoApp.ai.enabled` est vrai : un élément à gauche, « $(sparkle) IA à configurer », dont le
clic exécute `geoapp.ai.setup.open`. L'élément est retiré dès que l'IA est prête, et n'est pas
affiché si `geoApp.ai.setup.dismissed` est vrai.

### 3.3 Rappel quand la page d'accueil n'est pas affichée

Après `whenSettled`, si l'IA n'est pas prête, non écartée, et que le widget d'accueil n'est pas
ouvert : une notification non bloquante, **une fois par session**, « L'IA de GeoApp n'est pas encore
configurée. » avec les actions « Configurer », « Plus tard », « Ne plus proposer ».
Jamais de fenêtre modale.

### 3.4 Page Préférences

Dans `geo-preferences-widget.tsx`, en tête de la catégorie IA, à côté du bouton existant
« Configurer Agent Theia (IA) » (`openAiConfiguration`, ligne 409) : un bouton principal
**« Assistant de configuration de l'IA »** qui exécute `geoapp.ai.setup.open`. Le bouton existant
est conservé et devient secondaire.

**Critères d'acceptation.**

- Profil vierge : le bandeau apparaît sur l'accueil quelques secondes après le démarrage, sans clignotement.
- Profil déjà configuré à la main (sans passer par l'assistant) : aucun bandeau, aucune notification.
- « Ne plus proposer » : plus de bandeau, d'élément de barre d'état ni de notification aux
  démarrages suivants ; la carte et la commande restent disponibles.
- Retirer la clé dans les Préférences : le bandeau et l'élément de barre d'état reviennent sans redémarrage.

---

## Lot 4 — `@Aide` et documentation

### 4.1 Outils

Dans `doc-action-tools.ts`, sur le modèle de `aide_open_ai_configuration` (ligne 7358) :

| Outil | Rôle |
|---|---|
| `aide_open_ai_setup` | Ouvre l'assistant. Paramètre optionnel `provider` pour arriver directement à l'étape 2 de ce fournisseur. |
| `aide_get_ai_setup_status` | Renvoie `ready`, le fournisseur, le modèle par défaut et la liste des tâches non prêtes avec leur raison. Aucune clé, aucun fragment de clé. |

Les déclarer dans `geoapp-chat-tool-catalog.ts` (catégorie `navigation` pour le premier, lecture
seule pour les deux, `scopes: ['aide']`, `defaultEnabled: true`), à côté de la ligne 487.

### 4.2 Refus des clés

Les messages de refus des préférences sensibles (`doc-action-tools.ts:606, 683, 718`) et l'entrée
`sensitive` de `app-preferences-table.ts:426-446` doivent, pour les clés de fournisseurs d'IA,
ajouter : « Utilisez l'assistant de configuration de l'IA (`aide_open_ai_setup`). »

Vérifier aussi que les outils génériques `aide_get_preference` / `aide_set_preference` ne peuvent
ni lire ni écrire `ai-features.anthropic.AnthropicApiKey`, `ai-features.openAiOfficial.openAiApiKey`,
`ai-features.google.apiKey` ni `ai-features.openAiCustom.customOpenAiModels` (qui peut contenir une
clé). Si elles sont accessibles aujourd'hui, les bloquer : c'est un défaut à corriger dans ce lot.

### 4.3 Prompt système

Dans `doc-agent.ts`, compléter la ligne « Modeles IA » (ligne 167) : « Pour ajouter ou changer un
fournisseur ou une clé API : aide_open_ai_setup (les clés ne se saisissent jamais dans le chat).
aide_get_ai_setup_status donne l'état d'ensemble. »

### 4.4 Documentation utilisateur

- Nouvelle page `docs/getting-started/configurer-ia.md`, placée juste après la connexion à
  geocaching.com : pourquoi configurer l'IA, les six fournisseurs en une ligne chacun, les trois
  étapes, comment y revenir. Renvoyer vers `ia/configure.md` pour les réglages par agent.
- `docs/ia/configure.md` : ajouter en tête un encadré « Première configuration ? Utilisez
  l'assistant (`Ctrl+Shift+P` → GeoApp : Configurer l'IA). » et compléter la section Dépannage.
- `docs/depannage/problemes-frequents.md` : entrée « L'IA ne répond pas » pointant vers l'écran d'état.
- Régénérer le manifeste (`scripts/generate-docs-manifest.mjs`).

### 4.5 Documentation technique

Ajouter une section à `documentation/chat-ia-geoapp-technique.md` : rôle du service, définition de
« prêt », tableau 2.2 des clés par fournisseur, et la règle « l'état se déduit ».

### 4.6 Tests

Étendre `doc-action-tools.test.ts` : `aide_get_ai_setup_status` ne renvoie aucune clé ;
`aide_open_ai_setup` exécute la commande ; les préférences de clé `ai-features.*` sont refusées.

**Critères d'acceptation.** « @Aide, change ma clé OpenRouter » ouvre l'assistant au lieu de
refuser sèchement. « @Aide, est-ce que l'IA est bien configurée ? » décrit l'état sans exposer de clé.

---

## 5. Hors périmètre

- Stockage chiffré des clés (elles restent en clair dans les préférences, comme aujourd'hui).
- Réglage des slots OpenRouter `fast`, `web` et `vision`, et des modèles par agent : `@Aide` et la
  Configuration IA s'en chargent.
- Mise à jour des défauts obsolètes des slots OpenRouter (`openai/gpt-4o…`) : à traiter à part.
- Fournisseurs supplémentaires (Hugging Face, llamafile, endpoints personnalisés).

## 5 bis. Écarts de l'implémentation (2026-10-05)

Les quatre lots sont implémentés. Référence à jour : § 34 de `chat-ia-geoapp-technique.md`.

- **« Essayer @Aide » envoie la question** au lieu de la préremplir : le pont de chat
  (`geoapp-chat-bridge.ts`) n'a pas de mode « préremplir sans envoyer ».
- **`apply` renvoie un résultat** `{ ok, status } | { ok: false, phase, reason, detail }` et
  accepte un rappel de progression, au lieu de lever une exception.
- **Le choix du modèle est un champ avec liste de suggestions** (`<datalist>`) pour les six
  fournisseurs : recherche et saisie libre partout.
- **`geoApp.ai.setup.dismissed`** est rangée dans la section « Activation » (la section
  « Général » n'existe pas dans la catégorie IA).
- **§ 4.2** : la vérification a montré que les tools génériques d'`@Aide` n'acceptent que les
  clés du schéma GeoApp ; les clés `ai-features.*` étaient déjà inaccessibles. Un test le fige.
- L'alias s'écrit par `selectModelForAlias`, absente de l'interface publique de Theia : détectée
  à l'exécution.

## 6. Points tranchés avec l'utilisateur (2026-10-05)

1. Pas de modèles suggérés pour OpenRouter, Ollama et LM Studio : l'utilisateur saisit ou choisit
   le sien (§ 1.3).
2. Le texte proposé par « Essayer @Aide » est `@Aide Que peux-tu faire pour moi ?` pour cette
   première version (§ 2.3).

Il ne reste aucun point ouvert : les quatre lots peuvent être implémentés.
