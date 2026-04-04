# Archivage des géocaches (SolvedGeocacheArchive)

Ce document résume l'implémentation de l'archive de résolution et son intégration front/back.

## Objectif

- Conserver un snapshot minimal des géocaches résolues/corrigées (coordonnées, notes, waypoints, statut, plugins, note perso) même si la géocache est supprimée.
- Restaurer automatiquement les données lors d'une réimportation de la géocache (par GC code).
- Offrir une visibilité UI via un badge et un panneau de gestion avec actions protégées.

## Schéma (backend)

- Modèle : `SolvedGeocacheArchive` (table `solved_geocache_archive`), clé naturelle `gc_code` (unique, pas de FK pour survivre à la suppression).
- Champs principaux :
  - `gc_code`, `name`, `cache_type`, `difficulty`, `terrain`
  - `solved_status` (`not_solved` | `in_progress` | `solved`)
  - `solved_coordinates_raw`, `solved_latitude`, `solved_longitude`, `original_coordinates_raw`
  - Snapshots JSON : `notes_snapshot`, `waypoints_snapshot`, `formula_data`, `resolution_plugins`, `resolution_diagnostics`
  - `personal_note`, `found`, `found_date`, `resolution_method`
  - `created_at`, `updated_at`

## Service

- `ArchiveService.sync_from_geocache(geocache, force=False)`
  - Synchronise si la géocache est `in_progress`/`solved`, corrigée, trouvée ou avec notes.
  - Respecte la préférence `geoApp.archive.autoSync.enabled` (désactivation = skip sauf `force=True`).
  - `force=True` est utilisé pour le snapshot avant suppression (filet de sécurité même si auto-sync off).
- `snapshot_before_delete` : appelé avant suppression d'une géocache.
- `get_by_gc_code`, `delete_archive`, `update_formula_data`, `add_resolution_plugin`, `get_stats`.

## Préférence (backend)

- `geoApp.archive.autoSync.enabled` (bool, défaut `true`, cible backend, catégorie `archive`).
- Désactiver est **non recommandé** : la synchro auto est coupée, mais le snapshot avant suppression reste actif.
- API :
  - `GET /api/archive/settings` â†’ `{ auto_sync_enabled }`
  - `PUT /api/archive/settings` body `{ auto_sync_enabled: bool }` (log WARNING si désactivation)

## API Archive

- `GET /api/archive/<gc_code>/status` : existence + `updated_at` + `needs_sync`.
- `POST /api/archive/<gc_code>/sync` : force la synchro depuis la géocache courante.
- `POST /api/archive/<gc_code>/restore` : restaure la géocache depuis l'archive (création/màj geocache).
- `DELETE /api/archive/<gc_code>` : supprime l'archive d'un code.
- `GET /api/archive/stats` : stats globales (total, solved, in_progress, found, par type, par méthode).
- `PUT /api/archive/<gc_code>/resolution-diagnostics` : stocke le snapshot courant du diagnostic IA / plugin executor, avec un `resume_state` utilisable pour reprendre un workflow metasolver/formule/checker et un `history_state` compact multi-tentatives.
- **Bulk delete** `DELETE /api/archive` (body JSON, confirmation obligatoire `confirm: true`):
  - `filter: "all" | "by_status" | "orphaned" | "before_date"`
  - `status` requis si `by_status`
  - `before_date` (ISO) requis si `before_date`

## Intégration backend existante

Hooks automatiques :
- Coordonnées (update/reset), statut résolu, notes (create/update), waypoints (create/update), logs "Found", exécution de plugins (tracking `resolution_plugins`), import par code (restaure l'archive).
- Snapshot avant suppression de géocache.

## Frontend Theia

### Badge Archive (GeocacheDetailsWidget)
- Appels : `GET /api/archive/<gc_code>/status`, `POST /api/archive/<gc_code>/sync`.
- États : `synced` (💾 vert), `needs_sync` (⚠️ orange), `loading` (⏳ bleu), `none` (invisible).
- Le badge apparaît quand l'archive est pertinente (résolu/en cours/corrigé ou notes). Bouton resynchroniser.

### Gestionnaire d'Archive (nouveau widget)
- Commande : `GeoApp: Gestionnaire d'archive` (`geoapp.archive.manager.open`).
- Fonctions :
  - Statistiques globales (total, résolues, en cours, trouvées).
  - Consultation des archives r?centes avec filtres (`gc_code`, statut) et pagination.
  - D?tail d'une archive s?lectionn?e avec snapshot courant et timeline `history_state`.
  - Toggle `auto_sync_enabled` avec confirmation explicite avant désactivation + bannière d'avertissement.
  - Suppression en masse : UI avec filtre (`all`, `by_status`, `orphaned`, `before_date`), double confirmation obligatoire.

### Reprise depuis le Plugin Executor
- Le panneau metasolver persiste maintenant automatiquement l'etat utile apres les etapes backend importantes (`search-answers`, `calculate-final-coordinates`, `validate-with-checker`).
- Le `resume_state` embarque notamment :
  - le texte courant
  - la classification courante
  - l'etat de l'orchestrateur
  - les reponses formule trouvees
  - les coordonnees calculees
- L'archive conserve en plus un `history_state` :
  - au plus 12 tentatives recentes
  - dedupliquees par signature d'etat
  - avec `workflow_kind`, `recorded_at`, dernier evenement et `resume_state` associe
  - le dernier resultat checker
  - les dernieres entrees du journal local
- A l'ouverture suivante du panneau, cet etat peut etre recharge automatiquement si le panneau est vide, ou restaure manuellement.
- Le Gestionnaire d'Archive permet aussi de restaurer explicitement une tentative de `history_state` dans le `Plugin Executor`, avec fallback sur le snapshot archive si la geocache n'est plus disponible en contexte live.
- Le Gestionnaire d'Archive peut aussi rejouer une etape backend automatisable d'une tentative (`execute-metasolver`, `search-answers`, `calculate-final-coordinates`, `validate-with-checker`) puis republier le snapshot mis a jour dans l'archive.
- Le rejeu n'est plus limite a "l'etape suivante" : l'utilisateur peut choisir explicitement l'etape backend ciblee parmi les etapes rejouables exposees par le plan du workflow.
- La liste des archives affiche maintenant un resume compact du dernier workflow connu et du dernier evenement utile, ce qui permet de reperer rapidement une tentative interessante sans ouvrir son detail.

## Points de sécurité / warning

- Désactiver l'auto-sync est déconseillé : seules les synchros forcées (badge) et le snapshot avant suppression resteront.
- Bulk delete est **irréversible** : confirmation serveur + double confirmation UI.

## Fichiers clés

- Backend :
  - `gc_backend/geocaches/archive_service.py`
  - `gc_backend/blueprints/archive.py`
  - `gc_backend/geocaches/models.py` (modèle)
  - `gc_backend/geocaches/importer.py` (restauration à l'import)
- Frontend :
  - `theia-extensions/zones/src/browser/geocache-details-widget.tsx` (badge)
  - `theia-extensions/zones/src/browser/archive-manager-widget.tsx` (UI gestion)
  - `theia-extensions/zones/src/browser/zones-command-contribution.ts` (commande)
  - `theia-extensions/zones/src/browser/zones-frontend-module.ts` (enregistrement)
- Préférences :
  - `shared/preferences/geo-preferences-schema.json` (clé `geoApp.archive.autoSync.enabled`)
  - `docs/PREFERENCES.md` (catégorie `archive`)

## Rappels d'usage

- Pour forcer la synchro d'une géocache : bouton badge ou `POST /api/archive/<gc_code>/sync`.
- Pour restaurer après suppression/réimport : `POST /api/archive/<gc_code>/restore` (ou `import_by_code` qui restaure automatiquement si archive présente).
- Pour nettoyer l'archive : utiliser le Gestionnaire d'Archive (double confirmation) ou l'API `DELETE /api/archive` avec `confirm: true`.

