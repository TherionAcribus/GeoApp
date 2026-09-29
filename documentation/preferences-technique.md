# Préférences GeoApp - documentation technique

Ce document décrit le fonctionnement technique du système de préférences GeoApp : schéma partagé, stockage Theia, synchronisation Flask, interface utilisateur et outils `@Aide`.

Pour une fiche courte destinée aux agents qui ajoutent une nouvelle préférence, voir `documentation/preferences-ajout-rapide.md`.

## Objectifs

Le système de préférences GeoApp sert à centraliser les réglages de l'application dans un catalogue unique.

Il doit permettre :

- une déclaration unique des clés, types, valeurs par défaut et métadonnées ;
- une lecture côté frontend Theia via `PreferenceService` ;
- une lecture et une persistance côté backend Flask via `AppConfig` ;
- une page dédiée, plus lisible que la page de préférences Theia native ;
- une compréhension par `@Aide`, qui doit pouvoir trouver, expliquer, ouvrir, modifier ou réinitialiser une préférence.

## Fichiers principaux

- `shared/preferences/geo-preferences-schema.json` : source officielle du catalogue.
- `frontend/theia-extensions/preferences/src/browser/geo-preferences-schema.ts` : typage TypeScript et import du schéma partagé.
- `frontend/theia-extensions/preferences/src/browser/geo-preference-store.ts` : lecture/écriture Theia, snapshot et regroupement par catégorie.
- `frontend/theia-extensions/preferences/src/browser/geo-preferences-widget.tsx` : page visuelle des préférences GeoApp.
- `frontend/theia-extensions/preferences/src/browser/services/preference-sync-service.ts` : synchronisation frontend vers backend.
- `frontend/theia-extensions/preferences/src/browser/services/preferences-api-client.ts` : client HTTP `/api/preferences`.
- `backend/gc_backend/blueprints/preferences.py` : API REST Flask.
- `backend/gc_backend/utils/preferences.py` : chargement du schéma, defaults, validation et persistance `AppConfig`.
- `frontend/theia-extensions/documentation/src/browser/doc-action-tools.ts` : outils `@Aide` pour les préférences.

## Schéma partagé

Le schéma est un JSON Schema compatible avec Theia. Chaque préférence est déclarée dans `properties` sous une clé `geoApp.*`.

Exemple minimal :

```json
"geoApp.map.defaultZoom": {
  "type": "number",
  "minimum": 2,
  "maximum": 18,
  "default": 8,
  "title": "Zoom par défaut",
  "description": "Niveau de zoom appliqué à l'ouverture de la carte.",
  "x-ui": {
    "section": "Affichage",
    "label": "Zoom initial",
    "order": 20
  },
  "x-category": "map",
  "x-targets": ["frontend", "backend"]
}
```

### Champs standards

- `type` : type JSON Schema (`boolean`, `string`, `integer`, `number`, `array`, `object`).
- `default` : valeur utilisée par Theia et par Flask si aucune valeur utilisateur n'existe.
- `title` : nom technique lisible, utile dans Theia et `@Aide`.
- `description` : description complète.
- `enum` : valeurs autorisées pour une préférence scalaire.
- `items.enum` : valeurs autorisées pour les tableaux à choix multiples.
- `minimum` / `maximum` : bornes numériques.

### Métadonnées GeoApp

- `x-category` : catégorie principale affichée dans la navigation (`ai`, `chat`, `formulaSolver`, `map`, `checkers`, `plugins`, etc.). Doit être déclarée dans `x-categories` à la racine du schéma (`{ id, label, order }`), source unique des libellés et de l'ordre des catégories.
- `x-targets` : indique où la préférence est appliquée.
  - `frontend` : stockée et lue par Theia.
  - `backend` : synchronisée vers Flask et disponible via `get_value_or_default`. À réserver aux clés réellement lues côté Python (sinon envois inutiles et badge « Flask » trompeur).
- `x-tags` : tags fonctionnels utilisés par la recherche, les guides et `@Aide`.
- `x-sensitive` : masque et protège les valeurs sensibles (champ mot de passe dans l'UI, valeur masquée par l'API et les logs backend, accès refusé à `@Aide`). Exige `x-ui.advanced: true`.
- `x-backendKey` : métadonnée de correspondance backend. La persistance actuelle reste faite sous la clé complète `geoApp.*`.

### Guides par usage

La racine du schéma porte aussi `x-guides` : tableau `{ id, label, description, categories?, sections?, keyPrefixes?, keyIncludes?, tags?, suggestedQueries? }`, source unique partagée entre la page Préférences et les outils `@Aide`. Theia tolère ces clés racine (comme `x-generated`) ; `load_preference_schema` côté Flask les ignore.

### Métadonnées UI

Chaque préférence doit avoir un bloc `x-ui`.

- `section` : sous-section affichée dans la page.
- `label` : libellé court côté utilisateur.
- `shortDescription` : description courte optionnelle affichée à la place de `description`.
- `order` : ordre dans la sous-section ; l'ordre des sous-sections suit le plus petit `order` de leurs entrées.
- `advanced` : préférence technique/risquée/rare, masquée par le filtre `Simples`. Déclaratif : il n'existe plus d'heuristique, une clé sans `advanced` est toujours « simple ».
- `enumLabels` : libellés humains pour des valeurs d'enum.
- `keywords` : mots-clés supplémentaires pour la recherche et `@Aide`.

## Frontend Theia

### Enregistrement du schéma

`geo-preferences-schema.ts` importe le JSON partagé et l'expose comme `PreferenceSchema`. Le module frontend l'enregistre auprès de Theia via la contribution de préférences.

Le type `GeoPreferenceDefinition` étend les définitions du schéma avec les champs GeoApp (`x-category`, `x-targets`, `x-ui`, etc.).

### Store

`GeoPreferenceStore` est la couche de lecture/écriture frontend.

Il fournit :

- `schema` : le schéma chargé ;
- `definitions` : liste ordonnée des préférences ;
- `getDefinition(key)` : définition d'une clé, adossée à une `Map` ;
- `definitionsByCategory` : regroupement par `x-category` ;
- `categories` / `guides` : `x-categories` et `x-guides` de la racine du schéma ;
- `getSnapshot()` : valeur effective de chaque préférence, avec fallback sur `default` ;
- `setValue(key, value, scope)` : écriture via `PreferenceService` ;
- `reset(key, scope)` : retire la clé du scope (retour au `default` du schéma, propage un `DELETE` au backend si la clé est synchronisée) ;
- `onDidChange` : événement quand une clé `geoApp.*` change.

Les valeurs frontend sont stockées dans les préférences utilisateur Theia, typiquement `.theia/settings.json`.

### Page Préférences GeoApp

`GeoPreferencesWidget` affiche une page dédiée, distincte de la page Theia native.

Fonctionnalités :

- recherche plein texte sur clé, titre, description, catégorie, section, tags, keywords, enum et valeur (non persistée entre sessions) ;
- deux contrôles de filtre : bascule `Modifiées (N)` et case « Afficher les réglages avancés » (cochée par défaut ; décochée, elle masque les `x-ui.advanced` hors recherche — une recherche réaffiche toujours ses correspondances) ;
- barre latérale unique : les catégories sont regroupées sous les guides de `x-guides` (chaque catégorie appartient au premier guide qui la cite ; les non citées vont dans « Autres »), un en-tête de guide défile jusqu'à sa première catégorie visible ;
- sous-sections issues de `x-ui.section` ;
- ouverture directe d'une catégorie, d'une clé ou d'une recherche : `revealPreference`/`revealCategory` lèvent les filtres qui masqueraient la cible (recherche incompatible effacée, avancées réaffichées, « Modifiées » désactivé si la cible ne l'est pas) et le défilement est différé jusqu'au rendu réel du DOM (`PendingRevealEffect`) ;
- état vide : rappel de la requête active et bouton « Réinitialiser les filtres » ;
- ligne normale : libellé (clé technique en info-bulle, « Copier la clé » au survol), description, contrôle — badges limités à « Avancé » et « Sensible » ; une préférence modifiée porte une barre verticale à gauche et un bouton `codicon-discard` (info-bulle « Revenir à la valeur par défaut (<défaut>) », rendu seulement si modifiée) ;
- mode développeur (case en bas de la barre latérale, persistée) : réaffiche la clé, les cibles Theia/Flask, les `x-tags`, la valeur brute des enums et les filtres Theia/Flask ;
- contrôles « compacts » (booléen, enum, nombre, texte, `select-from`) dans la colonne de droite ; contrôles « larges » (`lexicon`, `string-list`, tableau à cases, JSON) sous la description sur toute la largeur ;
- champ sensible (`x-sensitive`) : mot de passe avec bouton œil (`codicon-eye`/`codicon-eye-closed`) et indicateur « Clé définie » / « Aucune clé » ;
- champs numériques : bornes affichées (« 2 – 18 »), clamp avant écriture avec feedback temporaire (« Valeur ramenée à 18 (maximum) »), un `integer` refuse une saisie décimale ;
- mise en page pilotée par des container queries (`container-type: inline-size` sur la racine, `@container` 900px/640px) : le point de rupture suit la largeur du panneau, pas celle de la fenêtre ;
- édition directe selon le type : checkbox, select, input numérique, input texte, textarea JSON, liste de cases pour `array` + `items.enum` ;
- bouton de réinitialisation : retire la clé du scope utilisateur (retour au `default`, qui suit les évolutions du schéma).

État persisté (`storeState`) : `targetFilter`, `valueFilter`, `showAdvanced`, `devMode`, `expandedCategories`. Les anciens états contenant `searchQuery`, `complexityFilter` ou `selectedGuideId` sont tolérés à la restauration (`complexityFilter` est converti en `showAdvanced`).

Commande Theia :

```ts
geo-preferences:open
```

Options supportées :

```ts
{
  category?: string;
  key?: string;
  query?: string;
}
```

## Synchronisation frontend/backend

`PreferenceSyncService` synchronise les préférences dont `x-targets` contient `backend`.

Au démarrage :

1. Le service lit `geoApp.backend.apiBaseUrl`.
2. Il rejoue d'abord la file d'attente des écritures échouées (`localStorage`, clé
   `geoApp.preferences.pendingSync.v1`) : un seul `PATCH /api/preferences` pour les
   `set` (valeurs relues au moment de l'envoi), un `DELETE` par `reset`.
3. Il appelle ensuite `GET /api/preferences` et applique les valeurs dans
   `PreferenceService`, en ne retenant que :
   - les clés `x-targets` contenant `backend` ;
   - les clés présentes dans `storedKeys` (valeur réellement stockée par Flask, pas
     un simple défaut de schéma — une clé jamais stockée n'écrase jamais la valeur
     locale) ;
   - en excluant les clés `x-sensitive` (renvoyées masquées) et les clés qui venaient
     d'être rejouées vers le backend.

Politique : **Theia est la source de vérité** ; Flask ne l'emporte au démarrage que
pour une valeur qu'il a réellement stockée et qui n'est pas en attente d'envoi.

À chaque changement local :

1. Si la clé ne commence pas par `geoApp.`, elle est ignorée.
2. Si la clé est `geoApp.backend.apiBaseUrl`, seul le client HTTP est reconfiguré.
3. Si la clé n'a pas `backend` dans `x-targets`, elle reste locale.
4. Sinon le service lit `PreferenceService.inspect(key).globalValue` :
   - valeur présente → `PUT /api/preferences/<key>` avec `{ value }` ;
   - valeur absente (réinitialisation) → `DELETE /api/preferences/<key>`,
     qui supprime la ligne `AppConfig` au lieu d'y copier le défaut.
5. Sur erreur réseau, l'intention (`set`/`reset`) est empilée dans la file
   `pendingSync` et sera rejouée au prochain démarrage. Sur erreur HTTP (400),
   le toast affiche le `message` renvoyé par Flask.

Le flag interne `applyingRemote` évite une boucle de synchronisation quand une valeur vient du backend.

## Backend Flask

L'API est exposée par `backend/gc_backend/blueprints/preferences.py`.

Routes :

- `GET /api/preferences` : retourne toutes les valeurs effectives, `storedKeys`
  (clés ayant une ligne `AppConfig`) et `sensitiveKeys`. Les valeurs des clés
  `x-sensitive` sont remplacées par `null`.
- `GET /api/preferences?includeSchema=true` : ajoute le schéma.
- `GET /api/preferences/schema` : retourne le schéma.
- `GET /api/preferences/<key>` : retourne valeur + définition ; pour une clé
  sensible, `value` est `null` et `defined` indique si une valeur est stockée.
- `PUT /api/preferences/<key>` : modifie une préférence ; les valeurs sensibles
  sont journalisées `<masquée>` dans les logs.
- `DELETE /api/preferences/<key>` : supprime la ligne `AppConfig` (retour au
  défaut du schéma).
- `PATCH /api/preferences` : modification en lot.

La logique métier est dans `backend/gc_backend/utils/preferences.py`.

Fonctions principales :

- `load_preference_schema()` : charge le JSON partagé avec cache `lru_cache`.
- `get_preference_definition(key)` : retourne la définition.
- `is_sensitive(key)` / `list_sensitive_keys()` : clés `x-sensitive`.
- `list_stored_keys()` : clés du schéma ayant une ligne `AppConfig`.
- `list_preferences()` : retourne les valeurs persistées ou les defaults.
- `get_preference_value(key)` : retourne une valeur effective.
- `get_value_or_default(key, fallback=None)` : helper recommandé dans les modules
  backend — **renvoie la vraie valeur, y compris pour les clés sensibles**.
- `set_preference_value(key, value)` : valide, normalise, persiste dans `AppConfig`.
- `reset_preference_value(key)` : supprime la ligne `AppConfig`.

Les valeurs backend sont stockées dans `AppConfig` sous la clé complète `geoApp.*`, sérialisées en JSON.

### Types supportés côté backend

La normalisation backend gère les types scalaires (`boolean`, `integer`, `number`, `string`) avec enum et bornes, **ainsi que `array` et `object`** : `_normalize_value` route les tableaux vers `_normalize_array_value` (coercition par `items.type`, contrôle de `items.enum`, dédoublonnage si `uniqueItems`) et laisse passer les objets tels quels, sans validation de `properties`. Une préférence `array`/`object` peut donc déclarer `x-targets: ["frontend", "backend"]` sans travail préalable — c'est déjà le cas de `geoApp.alphabets.favoriteIds`. Couverture : `backend/tests/test_preferences_api.py`.

## Outils `@Aide`

Les outils sont déclarés dans `doc-action-tools.ts`.

Outils liés aux préférences :

- `aide_list_preference_categories`
- `aide_list_preference_guides`
- `aide_search_preferences(query, category?)`
- `aide_list_preferences(category?)`
- `aide_get_preference(key)`
- `aide_set_preference(key, value)`
- `aide_reset_preference(key)`
- `aide_open_preferences(category?, key?, query?)`

`@Aide` reçoit les métadonnées `x-ui`, ce qui lui permet :

- d'expliquer dans quel menu/sous-menu se trouve un réglage ;
- de distinguer une préférence courante d'une préférence avancée ;
- de proposer les valeurs possibles avec des libellés lisibles ;
- d'ouvrir directement la page sur une clé ou une recherche ;
- de refuser la lecture/modification des préférences `x-sensitive`.

## Flux de valeur

Lecture frontend :

```text
geo-preferences-schema.json
  -> geo-preferences-schema.ts
  -> GeoPreferenceStore
  -> PreferenceService.get(key, default)
  -> GeoPreferencesWidget / services frontend
```

Écriture frontend :

```text
GeoPreferencesWidget ou module frontend
  -> GeoPreferenceStore.setValue(...)
  -> PreferenceService
  -> PreferenceSyncService si x-targets contient backend
  -> PUT /api/preferences/<key>
  -> AppConfig
```

Lecture backend :

```text
module Flask
  -> get_value_or_default("geoApp.xxx", fallback)
  -> AppConfig si valeur persistée
  -> default du schéma sinon
```

Lecture `@Aide` :

```text
Tool @Aide
  -> GeoPreferenceStore
  -> snapshot + schema + x-ui
  -> réponse structurée à l'agent
```

## Conventions

### Nommage des clés

Toujours utiliser :

```text
geoApp.<domaine>.<option>
```

Exemples :

- `geoApp.map.defaultProvider`
- `geoApp.checkers.timeoutMs`
- `geoApp.chat.workflowProfile.formula`

Éviter les noms vagues comme `enabled2`, `option`, `mode`. Le nom doit rester compréhensible sans contexte.

### Catégories

Catégories connues :

```text
ai, alphabets, archive, auth, backend, chat, checkers, earthcoach,
images, logs, map, notes, ocr, plugins, search, ui, updates
```

Ajouter une catégorie seulement si elle correspond à un vrai domaine utilisateur. Sinon utiliser une catégorie existante et une nouvelle `x-ui.section`.

### Préférences avancées

Marquer `x-ui.advanced: true` pour :

- clés API et secrets ;
- chemins locaux, profils navigateur, allowlists ;
- timeouts, limites d'exécution, workers ;
- pipelines, overrides, policies ;
- options dangereuses ou rarement utiles.

### Valeurs sensibles

Marquer `x-sensitive: true` pour les clés API, tokens, secrets et identifiants.

Conséquences :

- la valeur est masquée dans `@Aide` ;
- `@Aide` refuse de la lire ou de la modifier ;
- l'UI affiche un champ `password`.

## Validation recommandée

Après modification du schéma ou du widget :

```powershell
Get-Content -Raw shared/preferences/geo-preferences-schema.json | ConvertFrom-Json | Out-Null
yarn --cwd frontend/theia-extensions/preferences build
yarn --cwd frontend/theia-extensions/documentation build
```

Si une préférence backend est ajoutée ou modifiée, vérifier aussi les tests backend concernés, par exemple :

```powershell
pytest backend/tests/test_preferences_api.py
```

## Points d'attention

- Le schéma partagé est la source de vérité. Ne créer une préférence hardcodée nulle part ailleurs.
- Ajouter `title` et `x-ui` est obligatoire pour préserver la lisibilité de l'UI et de `@Aide`.
- Pour une préférence backend, vérifier que son type est géré par `_normalize_value` (scalaires, `array`, `object`).
- Pour une enum technique, ajouter `x-ui.enumLabels`.
- Pour un nouveau domaine, penser aux guides par usage dans `GeoPreferencesWidget` et `doc-action-tools.ts`.
- Pour un comportement visible utilisateur, documenter aussi le module fonctionnel concerné.
