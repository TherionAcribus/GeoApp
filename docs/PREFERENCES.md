# Préférences GeoApp

Ce document décrit la stratégie de gestion des préférences GeoApp commune à l'interface Theia et au backend Flask.

## Schéma partagé

- Le catalogue officiel est défini dans `shared/preferences/geo-preferences-schema.json`.
- Chaque entrée reprend le format `PreferenceSchema` de Theia et ajoute :  
  - `x-category` : famille fonctionnelle (ai, map, ui, plugins, ...).  
  - `x-targets` : `frontend`, `backend` ou les deux.  
  - `x-backendKey` : clé persistée dans `AppConfig` lorsqu'une synchronisation Flask est nécessaire.  
  - `x-tags` : métadonnées libres (diagnostic, UI hints, etc.).
- Le champ `default` sert à la fois pour Theia et pour l'API Flask.

## Nommage des clés

Toutes les clés suivent le préfixe unique `geoApp.<domaine>.<option>` pour éviter les collisions avec les préférences natives de Theia. Exemples :

- `geoApp.ai.enabled` : coupe toutes les fonctionnalités IA.  
- `geoApp.map.defaultProvider` : sélectionne l'ID du fournisseur de tuiles OpenLayers.  
- `geoApp.map.geocacheIconScale` : taille par défaut des icônes de géocaches sur la carte.  
- `geoApp.plugins.executor.timeoutSec` : timeout appliqué par le backend lors de l'exécution des plugins.

## Rôles front / back

- **Frontend uniquement** : préférences purement UI (onglets, zoom initial, clipboard watcher, etc.) stockées dans `.theia/settings.json`.
- **Backend uniquement** : préférences opérationnelles pilotant Flask (lazy mode plugins, TaskManager, workers...). Elles sont synchronisées via `/api/preferences` et persistées dans `AppConfig`.
- **Hybride** : certaines options (ex. `geoApp.ai.enabled`) sont appliquées des deux côtés pour garantir un état cohérent.

## Procédure d'ajout

1. Ajouter l'entrée dans `geo-preferences-schema.json` avec description, défaut et métadonnées.  
2. Étendre la contribution Theia (widget + `PreferenceContribution`).  
3. Si `x-targets` contient `backend`, exposer la clé dans l'API Flask (`gc_backend/utils/preferences.py`).  
4. Mettre à jour les modules concernés (React, services, PluginManager...).  
5. Ajouter des tests si la nouvelle option impacte un flux critique.  
6. Documenter brièvement l'usage dans le fichier fonctionnel approprié (`PLUGIN_BROWSER_INTEGRATION.md`, `MAP_USAGE.md`, etc.).

## Catégories actuelles

- `ai` : activation globale et granularité des assistances IA.  
- `ui` : comportement des onglets, vue par défaut.  
- `alphabets` : options d’affichage du module Alphabets (symboles, vue).  
- `map` : fournisseur de tuiles, zoom initial, taille des icônes, couches toggles.  
- `updates` : stratégie de recherche de mises à jour.  
- `search` : paramétrage du rafraîchissement automatique.  
- `checkers` : automatisation Playwright des checkers (Certitude, Geocaching.com), sessions, sécurité et options d'ouverture de page.  
- `plugins` : lazy mode, découverte, limites d'exécution.  
- `backend` : configuration générique Flask (API base URL côté front, TaskManager, workers).  
- `notes` : synchronisation de notes et affichage.  
- `archive` : archivage automatique des données de résolution des géocaches.  

## Formula Solver (préférences)

Les préférences du Formula Solver sont définies dans `shared/preferences/geo-preferences-schema.json` et utilisent les clés préfixées `geoApp.formulaSolver.*`.

Documentation de fonctionnement : `docs/FORMULA_SOLVER_FONCTIONNEMENT.md`.

- **Choix par défaut des étapes** (frontend) :
  - `geoApp.formulaSolver.formulaDetection.defaultMethod` : `algorithm | ai | manual`
  - `geoApp.formulaSolver.questions.defaultMethod` : `none | algorithm | ai`
  - `geoApp.formulaSolver.answers.defaultMode` : `manual | ai-bulk | ai-per-question`
- **Profils IA par défaut** (frontend) :
  - `geoApp.formulaSolver.ai.defaultProfile.formulaDetection` : `local | fast | strong | web`
  - `geoApp.formulaSolver.ai.defaultProfile.questions` : `local | fast | strong | web`
  - `geoApp.formulaSolver.ai.defaultProfile.answers` : `local | fast | strong | web`
- **Recherche web** (hybride front/back) :
  - `geoApp.formulaSolver.ai.webSearchEnabled` (bool)
  - `geoApp.formulaSolver.ai.maxWebResults` (int)
- **Carte** (frontend) :
  - `geoApp.formulaSolver.preview.mapOverlayEnabled` (bool) : affiche/masque l’overlay de zone estimée sur la carte pendant la résolution.

Compatibilité : l’ancienne clé `geoApp.formulaSolver.defaultMethod` reste présente et peut servir de fallback si nécessaire.

## Chat GeoApp (préférences)

Les conversations GeoApp disposent maintenant de profils IA dédiés, séparés des profils du Formula Solver.

- **Profil général du chat GeoApp** (frontend) :
  - `geoApp.chat.defaultProfile` : `local | fast | strong | web`
- **Profils par workflow** (frontend) :
  - `geoApp.chat.workflowProfile.secretCode` : `default | local | fast | strong | web`
  - `geoApp.chat.workflowProfile.formula` : `default | local | fast | strong | web`
  - `geoApp.chat.workflowProfile.checker` : `default | local | fast | strong | web`
  - `geoApp.chat.workflowProfile.hiddenContent` : `default | local | fast | strong | web`
  - `geoApp.chat.workflowProfile.imagePuzzle` : `default | local | fast | strong | web`

Règle appliquée par le bridge du chat GeoApp :

- si un workflow GeoApp est connu, le bridge privilégie le profil correspondant
- si la préférence de workflow vaut `default`, le bridge retombe sur `geoApp.chat.defaultProfile`
- si aucun agent GeoApp du profil demandé n’a de modèle prêt, le système retombe ensuite sur l’agent configuré dans Theia puis sur un agent compatible disponible

Exemples de réglages utiles :

- `secretCode = fast` pour itérer rapidement sur du metasolver
- `formula = strong` pour de meilleurs raisonnements
- `checker = web` si vous voulez favoriser un profil plus puissant sur les étapes de validation
- `hiddenContent = strong` pour mieux exploiter du HTML caché ou des indices structurés
- `imagePuzzle = strong` pour les sessions plus orientées OCR et lecture d'indices visuels

## Export GPX : Notes utilisateur

Une préférence permet de contrôler l'export des Notes GeoApp dans les fichiers GPX :

- `geoApp.gpxExport.notesMode` (string)
  - `logs` (défaut) : exporte les Notes sous forme de logs Groundspeak et les place en tête des logs.
  - `listing` : ajoute les Notes au listing (description longue).
  - `none` : n'exporte pas les Notes.

Deux préférences additionnelles contrôlent l'inclusion des logs Geocaching.com (si disponibles localement) :

- `geoApp.gpxExport.includeGeocachingLogs` (bool, défaut `true`) : inclut les logs Geocaching.com dans `groundspeak:logs`.
- `geoApp.gpxExport.maxGeocachingLogs` (int, défaut `5`) : nombre maximum de logs Geocaching.com exportés par géocache (`0` = aucun).

## Géocache : version de description par défaut

La description d'une géocache peut exister sous deux variantes :

- `original` : description issue de Geocaching.com (scraping), non modifiée.
- `modified` : description modifiée par l'utilisateur (si elle existe).

La préférence suivante contrôle la variante affichée par défaut dans le panneau de détails :

- `geoApp.geocache.description.defaultVariant` (string)
  - `auto` (défaut) : affiche la version modifiée si elle existe, sinon l'originale.
  - `original` : affiche toujours la version originale.
  - `modified` : affiche la version modifiée si elle existe, sinon l'originale.

## Checkers : garder la page ouverte

Deux préférences permettent de choisir si GeoApp doit laisser la fenêtre Chromium (Playwright) ouverte après une exécution interactive :

- `geoApp.checkers.certitudes.keepPageOpen` (bool)
- `geoApp.checkers.geocaching.keepPageOpen` (bool)

## Checkers : mode d'ouverture des liens (clic gauche)

Une préférence contrôle le comportement par défaut du clic gauche sur un lien checker dans le panneau de détails d'une géocache :

- `geoApp.checkers.linkOpenMode` (string, défaut `same-group`, **frontend uniquement**)
  - `same-group` (défaut) : ouvre le lien dans un onglet Theia (mini-browser) dans le même groupe d'onglets que le widget courant.
  - `new-group` : ouvre le lien dans un onglet Theia (mini-browser) dans un nouveau groupe d'onglets (split à droite).
  - `external-window` : ouvre le lien dans une fenêtre externe au navigateur (hors Theia).

Un **menu contextuel (clic droit)** sur chaque lien checker propose toujours les trois options, indépendamment de la préférence configurée.

## GeoCheck : fallback manuel

GeoCheck.org utilise une protection anti-bot (Anubis) qui empêche la vérification automatique. Une préférence contrôle le comportement dans ce cas :

- `geoApp.checkers.geocheck.manualFallback` (bool, défaut `true`)
  - `true` : affiche un lien cliquable pour vérifier manuellement les coordonnées dans le navigateur.
  - `false` : tente un contournement automatique (non recommandé, peut échouer).

## Synchronisation attendue

- Au démarrage du frontend, un service dédié charge les préférences backend et applique les valeurs locales.  
- Chaque modification d'une clé `x-targets` contenant `backend` déclenche un `PUT /api/preferences/<key>`.  
- Le backend expose les valeurs effectives afin que l'interface puisse reconstruire son état même après un redémarrage hors ligne.

En cas de divergence détectée (erreur réseau ou clé inconnue), la règle est de conserver la valeur locale et de notifier l'utilisateur via le widget de préférences.

## Préférences d'onglets (UI)

Les comportements des onglets principaux (détails de géocache, tableaux par zone, plugins, alphabets, cartes) sont pilotés par un groupe dédié de préférences UI :

- `geoApp.ui.tabs.categories.geocache`  
- `geoApp.ui.tabs.categories.zone`  
- `geoApp.ui.tabs.categories.plugin`  
- `geoApp.ui.tabs.categories.alphabet`  
- `geoApp.ui.tabs.categories.map`  

Chaque clé accepte trois valeurs :

- `smart-replace` : un seul onglet "preview" par catégorie est réutilisé tant qu'il n'a pas été épinglé par interaction (clic, scroll ou temps d'ouverture minimum).  
- `always-new-tab` : chaque ouverture crée un nouvel onglet, sauf lorsqu'un même contexte exact est déjà ouvert (ex. même géocache ou même alphabet), auquel cas l'onglet existant est simplement réactivé.  
- `always-replace` : la catégorie n'utilise qu'un seul onglet ; chaque nouvelle ouverture remplace le dernier onglet ouvert de ce type.

Le mode `smart-replace` s'appuie sur des événements d'interaction émis par les widgets et sur les préférences suivantes :

- `geoApp.ui.tabs.smartReplaceTimeout` : temps en secondes avant qu'un onglet soit considéré automatiquement comme "interagi".  
- `geoApp.ui.tabs.smartReplace.interaction.clickInContent` : un clic dans le contenu épingle l'onglet.  
- `geoApp.ui.tabs.smartReplace.interaction.scroll` : un scroll dans le contenu épingle l'onglet.  
- `geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled` : active la promotion automatique d'un onglet en interaction après `smartReplaceTimeout` secondes.

Pour une description détaillée de l'architecture et des scénarios de test, voir `docs/TABS_BEHAVIOR.md`.

## Alphabets : afficher la valeur des symboles

Une préférence permet d’afficher (ou non) la **valeur** sous chaque symbole dans la grille “Symboles disponibles” :

- `geoApp.alphabets.availableSymbols.showValue` (bool, défaut `false`) : affiche la valeur (ex: `a`, `b`, `1`…) sous le symbole (glyph/pictogramme).

## Géocache : ouverture des liens externes

Une préférence contrôle comment les liens externes dans les détails de géocache sont ouverts :

- `geoApp.geocache.externalLinks.openMode` (string, défaut `new-tab`)
  - `new-tab` (défaut) : ouvre les liens externes dans un nouvel onglet du navigateur.
  - `new-window` : ouvre les liens externes dans une nouvelle fenêtre du navigateur.

Cette préférence s'applique aux liens présents dans la description de la géocache. Les liens sont automatiquement interceptés et ouverts selon le mode configuré, empêchant ainsi le remplacement de l'application Theia.

## Archive de résolution

L'archive (`solved_geocache_archive`) persiste les données de résolution indépendamment de la géocache et survit à sa suppression.

### Préférence

- `geoApp.archive.autoSync.enabled` (bool, défaut `true`, **backend uniquement**)

  ⚠️ **Non recommandé à désactiver.** Contrôle la synchronisation automatique de l'archive lors des changements d'état (statut résolu, coordonnées corrigées, notes, waypoints).

  - `true` (défaut) : chaque modification pertinente est archivée automatiquement.
  - `false` : l'archivage automatique est désactivé. **Attention : le snapshot avant suppression reste toujours actif** comme filet de sécurité minimal, mais les modifications intermédiaires ne sont plus sauvegardées.

### Gestion via l'UI

Le **Gestionnaire d'Archive** (commande `GeoApp: Gestionnaire d'archive`) fournit :

- Statistiques de l'archive (total, résolues, en cours, trouvées).
- Toggle de la préférence `auto_sync_enabled` avec double confirmation avant désactivation.
- Suppression en masse avec **double confirmation obligatoire** :
  - `all` : supprime toutes les archives.
  - `by_status` : supprime par statut (`not_solved`, `in_progress`, `solved`).
  - `orphaned` : supprime les archives dont la géocache n'existe plus en base.
  - `before_date` : supprime les archives antérieures à une date ISO 8601.

### API

- `GET /api/archive/settings` — lit la préférence auto-sync.
- `PUT /api/archive/settings` — modifie la préférence auto-sync.
- `DELETE /api/archive` — suppression en masse (requiert `confirm: true` dans le body).
