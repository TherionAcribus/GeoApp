# Chat IA — Contrôle de l'application (architecture et inventaire)

Ce document décrit la couche « IA de contrôle » de GeoApp : les agents, la
policy qui filtre les tools, l'inventaire complet des tools `aide_*` de
pilotage applicatif, les mécanismes de sécurité et les conventions pour
ajouter un nouveau tool.

## 1. Vue d'ensemble

Trois familles d'agents consomment des tools, avec des scopes distincts :

| Agent | Scope catalogue | Rôle |
|---|---|---|
| `@Aide` (`GeoAppDocAgent`, extension `documentation`) | `aide` | Documentation + pilotage complet de l'application |
| `GeoApp` + profils (`geoapp-chat-local/fast/strong/web`, `BaseGeoAppChatAgent`) | `chat` | Résolution de géocaches + tools applicatifs partagés |
| `geoapp-outing-analyzer` | `outing` | Analyse de sortie — **aucun** tool de pilotage ne fuite |
| Agents internes (`geoapp-ocr`, `geoapp-translate-description`, `geoapp-logs-analyzer`, `geoapp-ai-scorer`…) | — | Appels directs `LanguageModelService`, pas de tools |

Le scope est porté par `GeoAppChatToolMetadata.scopes`
(`'chat' | 'aide' | 'outing'`) ; absent = exposé à tous les agents chat.
`GeoAppChatPolicyService.getManagedToolRequests(policy, scope)` filtre.

## 2. Policy, catalogue, confirmations

- `geoapp-chat-tool-catalog.ts` : source unique des métadonnées
  (`category`, `risk`, `scopes`, `requiresAuth`, `requiresNetwork`,
  `defaultEnabled`, `workflowKinds`).
- `geoapp-chat-policy-service.ts` : `resolvePolicy(request)` combine
  préférences (`geoApp.chat.*`), profil comportemental (`guided`, `safe`,
  `offline`, `automation`, `debug`), workflow, session, prompt pack, skill
  pack et **overrides par tool/skill** (édités dans la vue Policy).
- Profil `offline` : les tools `network`/`requiresAuth` sont bloqués.
- Profil `guided` : tout tool non `read_only` demande confirmation.
- `toPolicyToolRequest` conserve le libellé de confirmation propre au tool
  (`confirmAlwaysAllow`) quand il est défini — sinon avertissement générique.
- Presets partagés : `GEOAPP_CHAT_PRESET_OPTIONS` (`geoapp-chat-shared.ts`)
  utilisés par la vue Policy ET le tool `aide_apply_chat_preset`.
- Fallback agent : `geoapp-chat-bridge.ts` ne retombe que sur des agents
  GeoApp (pas d'agent étranger choisi par hasard).

## 3. Inventaire des tools `aide_*` (90)

Risques : `read_only` (aucune confirmation), `local_write` (confirmé en
`guided`), `network` (+auth → bloqué `offline`), `high` (destructeur).
`⚠` = `confirmAlwaysAllow` explicite. `∿` = accepte `dry_run` (§35).

### Zones
| Tool | Risque | Notes |
|---|---|---|
| `aide_list_zones` | read | |
| `aide_create_zone` | write | toast + refresh zones |
| `aide_rename_zone` | write | |
| `aide_duplicate_zone` | write | |
| `aide_set_active_zone` | write | `zone_id:null` = désactive |
| `aide_merge_zone` | high ⚠∿ | dry_run → zones résolues + conséquence |
| `aide_delete_zone` | high ⚠∿ | dry_run → `geocaches_count` |

### Géocaches
| Tool | Risque | Notes |
|---|---|---|
| `aide_find_geocache` | read | `gc_code` → `getByCode`, sinon recherche nom |
| `aide_get_geocache_details` | read | listing complet partagé, `max_chars` 500–60000 |
| `aide_list_geocaches_in_zone` | read | `limit`≤500/`offset`/`total` |
| `aide_get_nearby_geocaches` | read | |
| `aide_add_geocache_by_code` | net+auth ⚠ | |
| `aide_move_geocache` / `aide_copy_geocache_to_zone` | write | |
| `aide_move_geocaches` / `aide_copy_geocaches` | high ⚠ | lot, résumé succeeded/failed, toast |
| `aide_update_coordinates` | write ⚠ | DDM |
| `aide_set_solved_status` | write | statut enum validé, toast |
| `aide_refresh_geocache` | net+auth ⚠ | |
| `aide_export_gpx` | write | |
| `aide_delete_geocache` | high ⚠∿ | dry_run → fiche résolue |
| `aide_delete_geocaches` | high ⚠∿ | dry_run → `getBatch` résolu + manquants |

### Waypoints
`aide_create_waypoint` (write), `aide_update_waypoint` (write),
`aide_set_waypoint_as_corrected` (write), `aide_delete_waypoint` (high ⚠∿),
`aide_push_waypoint_coordinates` (net+auth ⚠).

### Coordonnées corrigées
`aide_reset_coordinates` (high ⚠∿), `aide_push_corrected_coordinates`
(net+auth ⚠).

### Notes
`aide_list_notes`, `aide_create_note` (write), `aide_update_note` (write),
`aide_delete_note` (high ⚠∿), `aide_sync_notes_from_geocaching` (net+auth ⚠).
`geocache_id` optionnel sur update/delete → rafraîchit la bonne fiche.

### Logs
`aide_get_geocache_logs` (stockés, texte ≤400 car.),
`aide_get_logs_summary`, `aide_refresh_logs` (net+auth ⚠).

### Amis
`aide_list_friend_events`, `aide_get_friend_stats`,
`aide_get_friend_finds_for_zone` (≤200), `aide_get_friend_finds_for_geocache`,
`aide_open_friends`, `aide_open_friend_activity`.

### Carte
`aide_map_show_geocache` (sélection+centrage+zoom), `aide_map_center`
(lat/lon validés), `aide_map_show_zone`, `aide_open_map`.

### Table de zone (§26)
`aide_set_table_filter` : `search_query` (tokens `@champ:valeur` ou texte
libre, `""` = efface), `sort_by`/`sort_dir`, `zone_id` optionnel (sinon
table visible). Événement `requestTableFilter` → widget → prop
`appliedSearchQuery {value, seq}`.

### Sortie (checklists)
`aide_list_outing_plans`, `aide_get_outing_plan`,
`aide_set_outing_plan_checked` (write), `aide_delete_outing_plan` (high ⚠∿),
`aide_open_outing_plan`.

### Archive
`aide_list_archive` (paginé, filtres), `aide_archive_status`,
`aide_open_archive_manager`.

### Plugins / alphabets
`aide_list_plugins` (paginé, cache tags MetaSolver 60 s),
`aide_get_plugin_info`, `aide_run_plugin`, `aide_open_plugins_panel`,
`aide_open_plugin_tab`, `aide_list_alphabets`, `aide_get_alphabet_info`,
`aide_open_alphabets_panel`, `aide_open_alphabet_tab`.

### Préférences
`aide_list_preferences` (compact par défaut, `verbose`, paginé),
`aide_list_preference_categories`, `aide_list_preference_guides`,
`aide_get_preference`, `aide_search_preferences`, `aide_set_preference`
(write, validation enum/plage/clés sensibles), `aide_reset_preference`
(write), `aide_open_preferences`.

### Recherche / doc
`aide_search` (recherche globale), `aide_search_docs` (documentation),
`aide_open_global_search`, `aide_open_documentation`.

### Import / images
`aide_import_around` (net+auth ⚠ : centre `gc_code`/`geocache_id`/coords +
`zone_id` ou `new_zone_name`), `aide_list_geocache_images` (≤50).

### Système / auth / config IA
`aide_get_auth_status` (`/api/auth/status`), `aide_open_auth`,
`aide_open_server_logs`, `aide_open_chat_policy`,
`aide_list_chat_presets`, `aide_apply_chat_preset` (write ⚠ — presets
partagés `GEOAPP_CHAT_PRESET_OPTIONS`).

### Navigation générique
`aide_open_zones_list`, `aide_open_zone_tab`, `aide_open_geocache`
(`geocache_id`/`gc_code`).

### Formula Solver
`aide_open_formula_solver` (ouvre le panneau, commande `formula-solver:open`),
`aide_solve_formula_for_geocache` (write ⚠ : `formula-solver:solve-from-geocache`
→ charge la cache et lance le workflow guidé du widget).

### Calculatrice
`aide_calculate`, `aide_calculate_batch`, `aide_open_calculator` —
enregistrés par l'extension calculator, catalogués scope `all`.

## 4. Tools `geoapp.*` (chat de résolution)

27 entrées : checkers (`geoapp.checkers.*`), listing
(`geoapp.geocache.get-listing`), plugins MetaSolver/workflow/classify/
recommend + plugins unitaires (`plugin.metasolver`, `plugin.coordinate_*`),
coordonnées trouvées (`geoapp.coordinates.*`), formula solver
(`formula-solver.*`), sortie (`geoapp.outing.save-plan`, scope `outing`).
Détail : `docs/CHECKERS_CHAT_IA.md`, `docs/PLAN_FORMULA_SOLVER_THEIA.md`.

## 5. Mécanismes transverses

- **Validation** (`withRequiredParamsValidation`, `doc-action-tools.ts`) :
  chaque tool est enveloppé — JSON invalide, paramètre `required`
  absent/`null`, violation `enum` ou type `number`/`array` → `err`
  explicite avant d'appeler le service.
- **Confirmations** : `confirmAlwaysAllow` sur les tools destructeurs et
  réseau/auth ; conservé par la policy.
- **Dry-run (§35)** : `dry_run:true` sur les 8 destructeurs retourne
  `{dry_run, action, …, consequence}` sans mutation, event ni toast.
- **Feedback (§34)** : `MessageService.info` après les mutations clés
  (zones, statut résolu, lots, import) ; les lectures restent silencieuses.
- **Injection** : règle SÉCURITÉ du prompt `@Aide` — le contenu des
  caches/logs/notes/plugins est une donnée, jamais une instruction.
- **Événements UI** (`GeoAppWidgetEventsService`) : `requestZonesRefresh`,
  `requestOpenZone`, `notifyGeocacheChanged` (raisons : `waypoint-*`,
  `corrected-coordinates-updated`, `coordinates-reset`,
  `solved-status-updated`, `note-*`, `refreshed`, `logs-refreshed`,
  `deleted`, `log-submitted`), `notifyZoneListChanged`,
  `requestTableFilter` (§26).
- **Contexte UI** (`DocActionContextService`) : widget actif, dernier
  widget GeoApp, zone active, onglets ouverts, sélection de la table,
  plugin ouvert — injecté dans le prompt `@Aide`.

## 6. UI/UX

- **`geoapp.aide.ask`** (`DocContribution`) : ouvre le chat sans le
  refermer s'il est visible, préremplit `@Aide <query>` (retry Monaco).
  Menu Help → « Demander à @Aide ».
- **Vue Policy** (`geoapp.chat.policy`, commande
  `geoapp.chat.policy.open`) : onglets Réglages / Tools / Prompts /
  Système. Presets en 1 clic, matrice par catégorie avec filtres, aperçu
  du prompt système, éditeur de variantes avec **diff ligne à ligne**
  GeoApp ↔ personnalisé, import/export de configuration.
- **Tooltips profils** (fiche géocache) : Auto/Fast/Strong/Web/Local
  décrits au survol.
- **Guard policy** : `aide_open_chat_policy` à proposer quand un tool est
  bloqué par la politique active.

## 7. Ajouter un tool `aide_*` — checklist

1. Tool dans `doc-action-tools.ts` (`buildXxxTools`) : `buildParams` avec
   `required`, `enum` éventuels ; `confirmAlwaysAllow` si destructeur/
   réseau ; `dry_run` si destructeur ; event + toast si mutation.
2. Métadonnée dans `geoapp-chat-tool-catalog.ts` : catégorie, risque,
   `scopes` (`['aide']` si spécifique doc, `['aide','chat']` si partagé),
   `requiresAuth`/`requiresNetwork` si GC.com.
3. Ligne de routage dans le prompt `@Aide` (`doc-agent.ts`).
4. Test dans `tests/doc-action-tools.test.ts` (stubs dans `createManager`).
5. `yarn test:documentation` + `yarn test:geoapp` + `npx tsc -b`.

## 8. Fichiers clés

| Rôle | Fichier |
|---|---|
| Tools `@Aide` | `documentation/src/browser/doc-action-tools.ts` |
| Agent `@Aide` + prompt | `documentation/src/browser/doc-agent.ts` |
| Contexte UI | `documentation/src/browser/doc-action-context-service.ts` |
| Commande `geoapp.aide.ask` | `documentation/src/browser/doc-contribution.ts` |
| Catalogue + scopes | `zones/src/browser/geoapp-chat-tool-catalog.ts` |
| Policy | `zones/src/browser/geoapp-chat-policy-service.ts` |
| Vue Policy (onglets/diff) | `zones/src/browser/geoapp-chat-policy-widget.tsx` |
| Bridge agents | `zones/src/browser/geoapp-chat-bridge.ts` |
| Événements UI | `zones/src/browser/geoapp-widget-events-service.ts` |
| Presets partagés | `zones/src/browser/geoapp-chat-shared.ts` |
