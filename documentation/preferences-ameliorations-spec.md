# Préférences GeoApp — spec des améliorations (audit du 2026-09-29)

Ce document est destiné au LLM qui implémentera les corrections. Il suppose la lecture préalable de
`documentation/preferences-technique.md` (architecture) et `documentation/preferences-ajout-rapide.md`
(conventions du schéma). Les numéros de ligne sont ceux du commit `7ae2afa`.

## Périmètre audité

| Fichier | Rôle |
|---|---|
| `shared/preferences/geo-preferences-schema.json` | catalogue (167 préférences, 18 catégories) |
| `frontend/theia-extensions/preferences/src/browser/geo-preferences-widget.tsx` | page Préférences (1 790 lignes) |
| `frontend/theia-extensions/preferences/src/browser/geo-preference-store.ts` | lecture/écriture Theia |
| `frontend/theia-extensions/preferences/src/browser/services/preference-sync-service.ts` | synchro Theia → Flask |
| `frontend/theia-extensions/preferences/src/browser/services/preferences-api-client.ts` | client HTTP |
| `frontend/theia-extensions/preferences/src/browser/style/geo-preferences.css` | styles |
| `frontend/theia-extensions/documentation/src/browser/doc-action-tools.ts` | outils `@Aide` |
| `backend/gc_backend/blueprints/preferences.py`, `backend/gc_backend/utils/preferences.py` | API et persistance Flask |

L'ensemble est sain : schéma complet (toutes les clés ont `title`, `default`, `x-ui.section`,
`x-ui.label`, `x-targets` ; toutes les enums ont des `enumLabels`), `PreferenceItem` mémoïsé avec
callbacks stables, cache de recherche, synchro avec retry. Les problèmes relevés sont surtout
**un défaut de confidentialité**, **deux cas de perte de réglage**, **une page trop chargée** et
**de la logique en double qui dérive**.

## Ordre de livraison

| Lot | Sujet | Priorité | Risque |
|---|---|---|---|
| 1 | Secrets et fiabilité de la synchro | haute | moyen (touche le démarrage) |
| 2 | Nettoyage du schéma et source unique des guides | haute | faible |
| 3 | Navigation, filtres et liens profonds | moyenne | faible |
| 4 | Lisibilité des lignes et mise en page | moyenne | faible |
| 5 | Performance du rendu et simplification | basse | faible |
| 6 | Fonctionnalités complémentaires (optionnel) | basse | faible |

Livrer lot par lot, un commit par lot. Chaque lot doit laisser l'application fonctionnelle.

---

## Lot 1 — Secrets et fiabilité de la synchro

### 1.1 La clé API OpenRouter est écrite en clair dans les logs du backend

**Constat.** `backend/gc_backend/blueprints/preferences.py:72` :

```py
logger.info('Préférence {} mise à jour -> {}', key, value)
```

`geoApp.ai.openRouter.apiKey` est `x-sensitive: true` **et** `x-targets: ["frontend", "backend"]`
(le backend la lit dans `blueprints/plugins.py:5639` et les plugins `vision_ocr` / `vision_describe`).
Chaque saisie de la clé l'écrit donc dans les fichiers de log, que `blueprints/server_logs.py`
diffuse en plus à l'interface. Un utilisateur qui partage ses logs pour un diagnostic partage sa clé.

`GET /api/preferences` et `GET /api/preferences/<key>` renvoient aussi la valeur en clair. Le CORS
est restreint à `localhost:3000` (`gc_backend/__init__.py:45`), donc un site tiers ne peut pas la
lire ; le risque est limité aux processus locaux, mais rien ne justifie de l'exposer.

**À faire.**

1. Dans `utils/preferences.py`, ajouter `is_sensitive(key) -> bool` (lit `x-sensitive` dans la définition).
2. Log de `PUT` : pour une clé sensible, journaliser `'<masquée>'` (ou seulement « définie / vidée »).
   Idem pour le `PATCH` en lot (aujourd'hui il ne logue que les clés : c'est correct, le garder).
3. `GET /api/preferences` et `GET /api/preferences/<key>` : remplacer la valeur d'une clé sensible
   par `None` et ajouter un champ `sensitiveKeys: [...]` dans la réponse de liste. Ne pas toucher
   `get_value_or_default` : les modules backend doivent continuer à lire la vraie valeur.
4. `PreferenceSyncService.pullFromBackend` doit **ignorer les clés sensibles** (sinon le masquage
   du point 3 écraserait la clé côté Theia par `null`). Le sens Theia → Flask reste inchangé : la
   clé continue d'être poussée au backend quand l'utilisateur la modifie.

**Critères d'acceptation.** Saisir une clé OpenRouter dans la page : le log backend ne contient
pas la clé ; `curl localhost:8000/api/preferences` ne la contient pas ; un OCR via OpenRouter
fonctionne toujours ; après redémarrage, la clé est toujours présente dans la page.

**Tests.** Étendre `backend/tests/test_preferences_api.py` : masquage en `GET` liste et unitaire,
`get_value_or_default` renvoie la valeur réelle, le log (capturer loguru via un sink de test) ne
contient pas la valeur.

### 1.2 Une modification faite backend arrêté est écrasée au démarrage suivant

**Constat.** Scénario reproductible :

1. Backend arrêté (ou pas encore prêt). L'utilisateur passe `geoApp.checkers.timeoutMs` à 60000.
2. `onPreferenceChanged` échoue, affiche un toast « La valeur reste appliquée localement ».
3. Au démarrage suivant, `pullFromBackend` (`preference-sync-service.ts:95`) récupère la valeur
   Flask (l'ancienne, ou le `default` si jamais stockée) et l'applique dans Theia : **la modification
   de l'utilisateur est perdue sans avertissement**, et le toast lui avait affirmé le contraire.

Deuxième cause du même effet : `list_preferences()` (`utils/preferences.py:24`) renvoie le `default`
pour toute clé non stockée, sans le signaler. Une valeur saisie à la main dans `.theia/settings.json`
pour une clé que Flask n'a jamais stockée est donc remplacée par le défaut au démarrage.

**À faire.**

1. **File d'attente des envois échoués.** Dans `PreferenceSyncService`, quand `apiClient.update`
   échoue sur une erreur réseau (`isBackendUnreachable`), ajouter la clé à un ensemble `pendingKeys`
   persisté dans `localStorage` (clé `geoApp.preferences.pendingSync.v1`, lectures/écritures dans
   un `try/catch`). Ne pas stocker les valeurs : au moment du vidage, relire la valeur courante
   dans `PreferenceService` (la dernière écriture gagne).
2. **Vidage avant le pull.** Dans `doInitialize`, une fois le backend joignable : envoyer les clés en
   attente en **une seule** requête `PATCH /api/preferences` (la méthode `updateBulk` du client
   existe déjà et n'est utilisée nulle part), vider `pendingKeys` en cas de succès, puis seulement
   faire le pull. Le pull ignore les clés qui étaient en attente.
3. **Distinguer valeur stockée et défaut.** `GET /api/preferences` ajoute `storedKeys: [...]` (clés
   ayant une ligne `AppConfig`). Le pull n'applique **que** les clés de `storedKeys`. Une clé non
   stockée côté Flask ne doit jamais écraser la valeur Theia.
4. Adapter le texte du toast d'échec : « … sera envoyée au backend dès qu'il sera joignable ».

Politique résultante, à documenter dans `preferences-technique.md` (section « Synchronisation ») :
Theia est la source de vérité ; Flask ne l'emporte au démarrage que pour une valeur qu'il a
réellement stockée et qui n'est pas en attente d'envoi.

**Critères d'acceptation.** Rejouer le scénario ci-dessus : la valeur 60000 survit au redémarrage
et arrive dans `AppConfig`. Un seul `PATCH` est émis même avec plusieurs clés en attente.

### 1.3 « Réinitialiser » fige l'ancien défaut

**Constat.** `handleResetPreference` (`geo-preferences-widget.tsx:1381`) écrit une **copie du
défaut** comme valeur utilisateur, au lieu de retirer la clé de `settings.json`. Côté Flask, le défaut
est ensuite stocké dans `AppConfig`. Conséquence : si une mise à jour de GeoApp change le `default`
d'une préférence, un utilisateur qui l'avait « réinitialisée » reste bloqué sur l'ancien défaut, et la
page affiche la ligne comme « Modifiée ». Même défaut dans `aide_reset_preference`
(`doc-action-tools.ts:474-475`, qui écrit une copie de `def.default`).

**À faire.**

1. Frontend : réinitialiser avec `store.setValue(key, undefined, PreferenceScope.User)`, ce qui
   retire la clé du scope utilisateur.
2. Backend : ajouter `DELETE /api/preferences/<key>` qui supprime la ligne `AppConfig`
   (`reset_preference_value(key)` dans `utils/preferences.py`) ; client : `apiClient.reset(key)`.
3. `PreferenceSyncService.onPreferenceChanged` : aujourd'hui il lit la valeur via
   `preferenceService.get(key, default)`, donc un retrait arrive comme « valeur = défaut » et
   serait poussé en `PUT`. Utiliser `preferenceService.inspect(key)?.globalValue` : `undefined` →
   `DELETE`, sinon `PUT`. La file du point 1.2 doit gérer les deux cas (stocker l'intention, pas
   seulement la clé : `pendingKeys` devient une map `clé → 'set' | 'reset'`).
4. Aligner `aide_reset_preference` sur la même méthode (idéalement une méthode
   `GeoPreferenceStore.reset(key)` utilisée par les deux).

**Critères d'acceptation.** Après « Réinitialiser », la clé n'apparaît plus dans
`.theia/settings.json` ni dans la table `app_config`.

### 1.4 Message d'erreur trompeur sur un refus de validation

`notifySyncError` (`preference-sync-service.ts:187`) dit toujours « vérifiez que le backend est
démarré ». Sur une réponse `400` (valeur refusée par `_normalize_value`), afficher plutôt le
`message` renvoyé par Flask : « Valeur refusée par le backend pour « <label> » : <message> ». Utiliser
le libellé `x-ui.label` plutôt que la clé technique dans les deux messages.

---

## Lot 2 — Nettoyage du schéma et source unique des guides

### 2.1 « Activer les fonctions IA » est classée avancée par erreur

`isAdvancedPreference` (`geo-preferences-widget.tsx:1764`) retombe sur une heuristique quand
`x-ui.advanced` est absent. Sur les 167 clés, **92 n'ont pas `advanced`** ; l'heuristique n'en classe
que deux comme avancées :

- `geoApp.ai.enabled` — à cause du tag `safety`. C'est l'interrupteur principal de l'IA : le filtre
  « Simples » le masque. **Bug.**
- `geoApp.map.geocoding.geoapifyApiKey` — à cause de `x-sensitive`. Voulu.

**À faire.** Ajouter `"advanced": true` explicite sur `geoapifyApiKey`, `"advanced": false` sur
`geoApp.ai.enabled`, puis **supprimer l'heuristique** : `advanced` vaut `Boolean(x-ui.advanced)`.

### 2.2 Code mort de classement des sections

Les 167 clés ont un `x-ui.section`. Les fallbacks de `toPreferenceSectionLabel` (l. 1681-1758) ne
servent donc jamais : réduire la méthode à `definition['x-ui']?.section ?? 'Général'`.

`compareSubsections` (l. 1642) ordonne les sous-sections selon une liste en dur ; les sections
ajoutées depuis (`Journal`, `Traduction`, `Lexique géocaching`, `Zones`, `Recherche d'adresse`,
`Chargement`, `Envoi`, `AI Scorer`, `Amis`, `Alphabets`, `Reponse`) tombent dans un tri alphabétique
après les autres. Remplacer par : ordre d'une sous-section = plus petit `x-ui.order` de ses entrées
(ce qui suit l'intention déjà exprimée dans le schéma), puis libellé. Supprimer la liste en dur.
Vérifier visuellement que l'ordre obtenu reste sensé pour `ai`, `chat`, `ui`, `logs` et ajuster les
`order` du schéma si besoin.

Corriger la faute de section `Reponse` → `Réponse` (catégorie `earthcoach`).

### 2.3 40 préférences sont synchronisées vers Flask sans y être lues

75 clés déclarent `backend` dans `x-targets`. Une recherche de chaque clé dans
`backend/gc_backend/**/*.py` et `plugins/**/*.py` n'en trouve que 35. Les 40 autres provoquent un
`PUT` à chaque modification, une ligne `AppConfig` inutile, un tag « Flask » trompeur dans la page,
et elles faussent le filtre « Flask ».

Liste à auditer (aucune occurrence trouvée côté Python, y compris par construction dynamique de clé) :

```text
geoApp.ai.enabled                        geoApp.ai.formulaSolverAssist
geoApp.ai.openRouter.enabled             geoApp.ai.openRouter.model.fast
geoApp.ai.openRouter.model.web           geoApp.ai.mapHints
geoApp.formulaSolver.ai.webSearchEnabled geoApp.formulaSolver.ai.maxWebResults
geoApp.ui.defaultPage                    geoApp.ui.tabs.restoreBehavior
geoApp.ui.tabs.maxOpen                   geoApp.map.defaultProvider
geoApp.map.defaultZoom                   geoApp.map.showExclusionZones
geoApp.map.showNearbyGeocaches           geoApp.map.autoAddWaypoints
geoApp.map.clipboardWatcher              geoApp.updates.autoCheck
geoApp.updates.channel                   geoApp.images.storage.defaultMode
geoApp.search.autoRefreshDelay           geoApp.plugins.executor.maxParallelRuns
geoApp.metasolver.defaultProfile         geoApp.metasolver.profiles.{common,alpha_only,numeric_only,symbols_only}.{decode,detect}
geoApp.alphabets.listPreferences         geoApp.alphabets.favoriteIds
geoApp.alphabets.recentIds               geoApp.notes.gcPersonalNote.autoSyncMode
geoApp.checkers.geocheck.manualFallback  geoApp.auth.geocaching.method
geoApp.auth.geocaching.browserSource     geoApp.auth.geocaching.rememberCredentials
geoApp.auth.geocaching.autoLogin
```

**À faire.** Pour chaque clé : re-vérifier par `grep` (Python **et** tout endroit où le backend
recevrait la valeur autrement que par `get_value_or_default`, p. ex. lecture de `AppConfig` ou clé
passée en paramètre par le frontend). Si Flask ne la lit pas, retirer `backend` de `x-targets`. Ne
pas purger les lignes `AppConfig` existantes (inoffensives). Consigner dans le message de commit la
liste des clés conservées et pourquoi.

⚠️ `geoApp.auth.geocaching.*` et `geoApp.metasolver.profiles.*` sont les plus susceptibles d'être
lues par un chemin indirect : les vérifier avec un soin particulier avant de les retirer.

### 2.4 Guides par usage : deux copies qui ont déjà divergé

`PREFERENCE_GUIDES` existe dans `geo-preferences-widget.tsx:92` **et** dans
`doc-action-tools.ts:69`. Elles ont déjà dérivé :

- le guide `friends` (« Amis ») n'existe pas côté `@Aide` ;
- le guide `map` couvre les catégories `['map']` dans la page et `['map', 'ai']` pour `@Aide`.

**À faire.** Déplacer les guides dans le schéma partagé, à la racine, sous `x-guides` (tableau
`{ id, label, description, categories, sections?, keyPrefixes?, keyIncludes?, tags?, suggestedQueries? }`),
à côté d'un `x-categories` (`{ id, label, order }`) qui remplace `CATEGORY_LABELS` et
`CATEGORY_ORDER` du widget. Le widget et `doc-action-tools.ts` lisent tous deux le schéma via
`GeoPreferenceStore` (le store est déjà injecté dans les outils `@Aide`). `load_preference_schema`
côté Flask ignore ces champs : rien à faire côté backend, mais vérifier que Theia tolère des clés
racine inconnues dans un `PreferenceSchema` (sinon les exposer depuis un second fichier
`shared/preferences/geo-preferences-ui.json`).

Supprimer au passage l'entrée morte `formulaSolver` de `CATEGORY_LABELS` (aucune préférence n'a
cette catégorie). **Décision à soumettre à l'utilisateur, ne pas l'implémenter d'office** : les 10
réglages Formula Solver sont rangés dans « Intelligence artificielle » (section « Formula Solver »)
et un onzième dans « Carte ». Une catégorie `formulaSolver` dédiée serait plus facile à trouver.

### 2.5 Test de cohérence du schéma

Il n'existe aucun test qui empêche les régressions ci-dessus. Ajouter
`backend/tests/test_preferences_schema.py` (pytest, déjà outillé) qui vérifie, pour chaque clé :

- préfixe `geoApp.` ;
- `title`, `description`, `default`, `x-category`, `x-targets`, `x-ui.section`, `x-ui.label` présents ;
- `default` valide pour son propre type (passer par `_normalize_value`) ;
- `enum` ⇒ `x-ui.enumLabels` couvrant toutes les valeurs ; idem `items.enum` ;
- `x-category` présent dans `x-categories` ; chaque catégorie couverte par au moins un guide ;
- `x-ui.optionsFrom` désigne des clés existantes, et une `select-from` a un `order` supérieur à sa source
  lorsqu'elles sont dans la même section ;
- `x-sensitive` ⇒ `x-ui.advanced: true`.

Mettre à jour la checklist de `preferences-ajout-rapide.md` pour mentionner ce test.

---

## Lot 3 — Navigation, filtres et liens profonds

### 3.1 Trois systèmes de navigation qui se recouvrent

En haut de la page : une barre d'état, la recherche, **6 boutons de filtre**, **10 boutons de guide** ;
à gauche : **18 catégories**. Les guides sont presque tous des regroupements de catégories : la page
propose deux fois la même navigation, et la barre d'outils mange une part importante de la hauteur
avant la première préférence.

**À faire.** Fusionner guides et catégories dans la barre latérale : chaque guide devient un
en-tête de groupe, avec ses catégories en dessous (une catégorie appartient au premier guide qui la
cite dans `x-guides`). Cliquer un en-tête de groupe fait défiler jusqu'à sa première catégorie.
Supprimer la rangée de boutons de guide de la barre d'outils et l'état `selectedGuideId` (et son
entrée dans `storeState`/`restoreState`, en tolérant l'ancien état restauré). Les guides restent
exposés tels quels à `@Aide`.

### 3.2 Filtres : remplacer 6 boutons par 2 contrôles

- **Theia / Flask** : information d'implémentation, sans intérêt pour l'utilisateur. Les déplacer
  dans un mode développeur (voir 4.1) ou les supprimer.
- **Simples / Avancées** : deux boutons mutuellement exclusifs pour un seul axe. Les remplacer par
  une case « Afficher les réglages avancés », avec le nombre masqué (« 75 réglages avancés masqués »).
  Quand la recherche est active, montrer aussi les avancées qui correspondent (grisées ou
  badge « Avancé »), pour qu'une recherche ne donne jamais « aucun résultat » à tort.
  **Valeur par défaut à soumettre à l'utilisateur** (recommandation : masquées par défaut ; c'est
  45 % de la page).
- **Modifiées** : à garder, c'est le filtre le plus utile. En faire une bascule avec compteur
  (« Modifiées (12) »), le compteur remplaçant celui de la barre d'état.
- **Toutes** : bug actuel, le bouton s'affiche actif (`geo-preferences-widget.tsx:969`) dès que
  `valueFilter` et `targetFilter` valent `all`, même si « Simples » ou un guide est actif. Il
  disparaît avec la refonte ; s'il est conservé, son état actif doit tenir compte de tous les filtres.

La barre d'état (« API Flask : http://localhost:8000 · 160 / 167 préférences affichées ») est à
retirer du haut de page : l'URL est déjà une préférence (`geoApp.backend.apiBaseUrl`), le compteur
peut aller en bas de la barre latérale.

### 3.3 État vide sans issue

« Aucune préférence ne correspond aux filtres actifs. » (l. 1023) : ajouter un bouton
« Réinitialiser les filtres » (efface recherche et filtres) et, si une recherche est active, rappeler
la requête.

### 3.4 Un lien profond peut ne rien montrer

`geo-preferences:open { key }` est utilisé par `@Aide` (`aide_open_preferences`), EarthCoach, la
barre latérale GeoApp et le menu des zones.

1. **Filtres qui masquent la cible.** La recherche et les filtres sont restaurés d'une session à
   l'autre (`storeState`). Si « Simples » est actif, ou si une ancienne recherche traîne,
   `revealPreference(key)` (l. 876) surligne une ligne qui n'est pas rendue : rien ne se passe à
   l'écran. Idem `revealCategory` si tous les éléments de la catégorie sont filtrés.
   **À faire** : avant de révéler une clé, retirer les filtres qui la cachent (effacer la recherche si
   elle ne correspond pas, afficher les avancées si la clé l'est, désactiver « Modifiées » si elle ne
   l'est pas). Ne pas persister `searchQuery` dans `storeState` : une recherche d'une session
   précédente n'a pas de raison d'être rejouée.
2. **Défilement lancé avant le rendu.** `revealPreference` et `focusCategory` appellent `update()`
   puis cherchent l'élément dans un `setTimeout(0)`. `update()` passe par la boucle de messages
   Lumino puis par le rendu React, qui ne sont pas garantis terminés à ce moment ; si la catégorie était
   repliée, l'élément n'existe pas encore. **À vérifier en conditions réelles**, puis fiabiliser :
   stocker une `pendingReveal` et l'exécuter après le rendu effectif (dans un `useLayoutEffect` d'un
   composant racine, ou en réessayant sur quelques `requestAnimationFrame` jusqu'à trouver le nœud).

---

## Lot 4 — Lisibilité des lignes et mise en page

### 4.1 Trop de métadonnées techniques par ligne

Chaque ligne affiche : libellé, **clé technique** (`<code>geoApp.x.y</code>`), contrôle, bouton
« Réinitialiser » (grisé sur 90 % des lignes), description, puis jusqu'à 9 badges : catégorie
(redondante avec l'en-tête de section), « Défaut »/« Modifiée », « Flask », « Theia », « Avancé »,
« Sensible », et 4 `x-tags` (`global`, `safety`…) qui ne parlent qu'aux développeurs.

**À faire.**

- Mode normal : libellé, description, contrôle. Badges limités à « Avancé » (si les avancées sont
  affichées) et « Sensible ».
- Préférence modifiée : barre verticale colorée à gauche de la ligne (au lieu du badge) et un bouton
  icône `codicon-discard` avec info-bulle « Revenir à la valeur par défaut (<défaut lisible>) »,
  **rendu seulement si la ligne est modifiée**.
- Clé technique : dans l'info-bulle du libellé, plus une action « Copier la clé » (icône au survol).
- Mode développeur : une case en bas de la barre latérale, mémorisée par `storeState`, qui réaffiche
  la clé, les cibles Theia/Flask, les `x-tags` et les filtres Theia/Flask.

### 4.2 Libellés d'enum suffixés par la valeur brute

`enumOptionLabel` (l. 248) produit « Icône trouvée (found-icon) », « OpenStreetMap (osm) ». Ne plus
ajouter la valeur brute en mode normal (la garder en mode développeur). Toutes les enums du schéma
ont des `enumLabels` : la table `ENUM_VALUE_LABELS` (l. 175) ne sert plus qu'en repli ; la conserver
comme repli, mais le test du lot 2.5 garantit qu'elle ne sert jamais pour les clés actuelles.

### 4.3 Éditeurs larges coincés dans une colonne à 42 %

`.geo-preference-main` place le contrôle dans une colonne `minmax(260px, 42%)`. C'est adapté à une
case, un menu ou un champ court, pas à l'éditeur de lexique (`min-width: min(560px, 100%)`), à la
liste de chaînes, aux zones JSON ni aux 18 cases de `geoApp.geocaches.table.visibleColumns`, qui s'y
retrouvent tassés.

**À faire.** Classer les contrôles en « compacts » (booléen, enum, nombre, texte, `select-from`) et
« larges » (`lexicon`, `string-list`, tableau à cases, JSON). Les larges sont rendus sous la
description, sur toute la largeur de la ligne, avec le bouton de réinitialisation dans l'en-tête de
la ligne. Les cases de `visibleColumns` passent en grille multi-colonnes.

### 4.4 Point de rupture basé sur la fenêtre, pas sur le panneau

`@media (max-width: 900px)` (`geo-preferences.css:778`) teste la largeur de la **fenêtre**. La page
s'ouvre dans un panneau Theia qui peut être étroit dans une fenêtre large (éditeur scindé) : la mise
en deux colonnes reste alors active et tout se tasse. Remplacer par des container queries :
`container-type: inline-size` sur `.geo-preferences-root`, puis `@container (max-width: 900px)` pour
la barre latérale et `@container (max-width: 640px)` pour les lignes. Electron/Chromium de Theia 1.76
les supporte.

### 4.5 Champ sensible

Ajouter un bouton œil (`codicon-eye` / `codicon-eye-closed`) pour afficher temporairement la valeur
d'un champ `password`, et un indicateur « Clé définie » / « Aucune clé » lisible sans révéler la
valeur.

### 4.6 Retour sur les nombres hors bornes

Theia borne silencieusement les nombres à la lecture (`PreferenceValidationService.validateNumber`) :
saisir 500 pour `geoApp.map.defaultZoom` (max 18) écrit 500 dans `settings.json`, affiche 18, sans
explication. `commitNumericDraft` (l. 1288) doit borner lui-même avant d'écrire et afficher sous le
champ « Valeur ramenée à 18 (maximum) » pendant quelques secondes. Afficher aussi les bornes en
indication (`2 – 18`) à côté des champs numériques. Pour un `integer`, refuser une saisie décimale
au lieu de la tronquer (`parseInt('12.7')` donne 12 aujourd'hui).

---

## Lot 5 — Performance du rendu et simplification

Gain attendu : modéré (la page reste utilisable aujourd'hui), mais le code en sort plus simple.
Mesurer avant/après avec le React Profiler sur une frappe dans un champ texte.

### 5.1 Chaque frappe dans un champ texte redessine toute la page

Les brouillons texte/nombre vivent dans le widget (`textDrafts`, l. 698) : chaque frappe appelle
`this.update()`, qui relance `buildSections` (filtre + tri des 167 clés), `modifiedCount` et
`isModified` pour chaque ligne. `isModified` fait un `JSON.stringify` de la valeur et du défaut, et il
est appelé jusqu'à trois fois par clé et par rendu (compteur, filtre, prop) — y compris sur la valeur
du lexique.

**À faire.**

- Déplacer le brouillon dans `PreferenceItem` (état local, comme `StringListEditor` le fait déjà) :
  le widget ne reçoit plus que la valeur validée. Supprimer `textDrafts`, `onDraftChange`,
  `onDraftKeyDown` et l'astuce qui relit la clé dans `event.currentTarget.id`.
- Mémoïser `isModified` par `snapshotVersion` (une `Map<clé, boolean>` recalculée à la demande).
- Mémoïser le résultat de `buildSections` sur (`snapshotVersion`, filtres, requête).
- `resolveDynamicOptions` (l. 1214) fait un `definitions.find` par source et par rendu : exposer
  `GeoPreferenceStore.getDefinition(key)` adossé à une `Map`, et l'utiliser aussi dans
  `revealPreference` et `PreferenceSyncService.getCurrentValue`.

### 5.2 Découper le fichier du widget

`geo-preferences-widget.tsx` fait 1 790 lignes. Sortir :

- `geo-preference-item.tsx` : `PreferenceItem`, `StringListEditor`, helpers de rendu ;
- `geo-preference-filters.ts` : fonctions pures de filtrage, recherche, tri, regroupement
  (testables sans DOM) ;
- le widget ne garde que l'état, les handlers et la mise en page.

### 5.3 Tests frontend

L'extension `preferences` n'a aucun test. Une fois les fonctions pures extraites, ajouter des tests
(même outillage que `zones/src/browser/tests/`) pour : filtres et recherche, ordre des sous-sections,
« révéler une clé retire les filtres qui la cachent », et la réconciliation de la synchro (file
d'attente, `storedKeys`, clés sensibles ignorées au pull, reset → `DELETE`).

---

## Lot 6 — Fonctionnalités complémentaires (optionnel, à valider avec l'utilisateur)

- **Exporter / importer** les préférences GeoApp modifiées en JSON (sans les clés sensibles par
  défaut, case à cocher pour les inclure). Utile avant une réinstallation ou pour passer d'un poste à
  l'autre. L'import valide chaque clé contre le schéma et affiche un résumé avant d'appliquer.
- **Réinitialiser une catégorie** : action dans l'en-tête de section, avec confirmation listant les
  réglages concernés.
- **Surlignage des correspondances** de la recherche dans le libellé et la description.

---

## Documentation à mettre à jour

À chaque lot, tenir à jour `documentation/preferences-technique.md` (synchro, reset, masquage,
`x-guides` / `x-categories`, mode développeur) et `documentation/preferences-ajout-rapide.md`
(checklist : plus besoin de toucher `CATEGORY_LABELS` / `CATEGORY_ORDER` ni les deux copies des
guides ; nouveau test de schéma). `docs/PREFERENCES.md` est l'ancienne doc : vérifier qu'elle ne
contredit pas les changements, sinon la faire pointer vers `documentation/`.

## Validation

```powershell
Get-Content -Raw shared/preferences/geo-preferences-schema.json | ConvertFrom-Json | Out-Null
yarn --cwd frontend/theia-extensions/preferences build
yarn --cwd frontend/theia-extensions/documentation build
pytest backend/tests/test_preferences_api.py backend/tests/test_preferences_schema.py
```

Puis contrôle manuel dans l'application : ouverture de la page, recherche, bascule des avancées,
lien profond depuis `@Aide` (« ouvre le réglage du zoom de la carte ») avec un filtre actif,
réinitialisation d'une préférence Flask, modification backend arrêté puis redémarrage.
