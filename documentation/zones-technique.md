# Panneau des Zones (arbre de navigation) - Documentation technique

## Vue d'ensemble

Le **panneau des Zones** est l'arbre de navigation latéral de GeoApp. Il liste les **zones** (conteneurs de géocaches) et, au dépliage de chacune, ses **géocaches**. Il permet de créer/renommer/dupliquer/fusionner/supprimer une zone, d'ouvrir le tableau d'une zone ou la fiche d'une géocache, de trier zones et géocaches, de déplacer/copier une géocache d'une zone à l'autre (menu contextuel **ou** glisser-déposer), le tout au clavier comme à la souris.

Côté frontend, tout tient dans l'extension Theia `zones` ; côté backend, dans deux blueprints Flask.

```text
frontend/theia-extensions/zones/src/browser/zones-tree-widget.tsx   (widget principal)
backend/gc_backend/blueprints/zones.py                              (CRUD zones)
backend/gc_backend/blueprints/geocaches.py                          (géocaches d'une zone)
```

Le widget est un **singleton** (un seul panneau), contrairement aux widgets de détail (un onglet par géocache/zone). Il détient tout l'état de l'arbre et orchestre les appels HTTP via des services injectés.

## Architecture

### Fichiers frontend

| Fichier | Rôle |
|---|---|
| `zones-tree-widget.tsx` | `ReactWidget` Theia. Détient l'état de l'arbre (zones, dépliage, cache des géocaches, tris, focus clavier, drag & drop) et orchestre tout. Contient aussi le composant mémoïsé `GeocacheNode`. |
| `zones-service.ts` | Client HTTP des zones (`BackendApiClient`) : liste, CRUD, fusion/duplication, zone active, liste des géocaches (complète **et** allégée). |
| `geocaches-service.ts` | Client HTTP des géocaches utilisé par l'arbre pour `move`/`copy`/`delete`. |
| `context-menu.tsx` | Menu contextuel générique (items plats, séparateurs, **sous-menus**, cases cochées). |
| `move-geocache-dialog.tsx` | Dialog `listbox` de sélection d'une zone cible (déplacer / copier / fusionner), navigable au clavier. |
| `geocache-icon.tsx` | Icône SVG du type de cache (rendu dans chaque nœud géocache). |
| `zone-tabs-manager.ts` | Ouverture du tableau d'une zone (`ZoneGeocachesWidget`). |
| `geocache-tabs-manager.ts` | Ouverture de la fiche d'une géocache (`GeocacheDetailsWidget`). |
| `geoapp-widget-events-service.ts` | Bus d'événements inter-widgets (rafraîchissement des zones, changement de géocache). |
| `geoapp-preference-contribution.ts` | Enregistre auprès de Theia le tri des zones (`geoApp.zones.sort`, non exposé dans la page Préférences). |
| `style/zones-tree.css` | Styles de l'arbre (lignes, survol, focus, cible de dépôt, formulaire, tri). |

### Fichiers backend

| Fichier | Rôle |
|---|---|
| `blueprints/zones.py` | CRUD des zones, duplication, fusion, suppression en cascade, zone active. Construit aussi les métadonnées de tri (compteurs, dernières dates). |
| `blueprints/geocaches.py` | Route `GET /api/zones/<id>/geocaches` (complète, vue tableau) **et** `GET /api/zones/<id>/geocaches/tree` (allégée, arbre). |
| `models.py` | Modèle `Zone` (+ `AppConfig` pour la zone active). |
| `geocaches/models.py` | Modèle `Geocache` : le backref `zone.geocaches` est **sans cascade** (cf. suppression). |

### Injection de dépendances

`zones-frontend-module.ts` :

- `bind(ZonesTreeWidget).toSelf().inSingletonScope();` puis une `WidgetFactory` d'`id = 'zones.tree.widget'`.
- `ZonesService`, `GeocachesService`, `ZoneTabsManager`, `GeocacheTabsManager`, `GeoAppWidgetEventsService` : tous `inSingletonScope()`.

## Modèle de données

### `ZoneDto` (frontend / `zones-service.ts`)

| Champ | Type | Source |
|---|---|---|
| `id`, `name`, `description` | number / string | colonnes |
| `created_at` | string \| null | colonne |
| `geocaches_count` | number | `COUNT(geocache)` groupé |
| `latest_geocache_created_at` | string \| null | `MAX(geocache.created_at)` |
| `latest_resolution_updated_at` | string \| null | `MAX(SolvedGeocacheArchive.updated_at)` (résolutions en cours / résolues) |

Ces trois dernières valeurs servent uniquement au **tri des zones** ; elles sont calculées en deux requêtes groupées côté backend (`_build_zone_list_payload`).

### `GeocacheDto` (frontend, dans l'arbre)

L'arbre n'utilise qu'un **sous-ensemble** de la géocache :

```ts
{ id, gc_code, name, cache_type, difficulty, terrain, found, created_at? }
```

C'est le contrat exact de l'endpoint allégé (voir ci-dessous). Ne pas y ajouter de champ lourd sans raison : c'est précisément ce qui distingue cet endpoint de la vue tableau.

## API backend

| Méthode & route | Rôle |
|---|---|
| `GET /api/zones` | Liste des zones triées (nom) + métadonnées de tri. |
| `POST /api/zones` | Création. |
| `POST /api/zones/<id>/rename` (ou `PATCH /api/zones/<id>`) | Renommage. |
| `POST /api/zones/<id>/duplicate` | Duplication (géocaches + waypoints + checkers). |
| `POST /api/zones/<id>/merge` | Fusion vers une zone cible (déplace les uniques, supprime les doublons, supprime la source). |
| `DELETE /api/zones/<id>` | **Suppression en cascade** (zone + géocaches + données liées). |
| `GET /api/active-zone` / `POST /api/active-zone` | Zone active (persistée dans `AppConfig`). |
| `GET /api/zones/<id>/geocaches` | Liste **complète** des géocaches (vue tableau `ZoneGeocachesWidget`). |
| `GET /api/zones/<id>/geocaches/tree` | Liste **allégée** pour l'arbre (voir ci-dessous). |

### Endpoint allégé `/geocaches/tree`

`get_geocaches_tree_for_zone` renvoie uniquement les 7 champs affichés par l'arbre, via **une seule requête projetée** (`db.session.query(Geocache.id, …)`) — donc **aucun chargement de relation** et **aucune requête N+1** (contrairement à l'endpoint complet qui matérialise chaque géocache et charge `notes`/`waypoints` en lazy). Trié par `gc_code`.

> Règle : l'arbre passe par `ZonesService.listGeocachesTree` ; seul le tableau complet utilise `ZonesService.listGeocaches`.

## Widget de l'arbre

### État principal (`ZonesTreeWidget`)

| Champ | Rôle |
|---|---|
| `zones: ZoneDto[]` | Liste courante (remplacée à chaque `refresh`). |
| `activeZoneId` | Zone dont le tableau est ouvert (surbrillance). |
| `expandedZones: Set<number>` | Zones dépliées. |
| `zoneGeocaches: Map<number, GeocacheDto[]>` | Cache des géocaches par zone. |
| `loadingZones: Set<number>` | Zones en cours de chargement (spinner). |
| `zoneSort` / `geocacheSort` | Tris courants (voir Tri). |
| `activeItemId` / `treeFocused` | Élément actif clavier + focus de l'arbre (accessibilité). |
| `draggingGeocache` / `dropTargetZoneId` | État du glisser-déposer. |

### Rendu et mémoïsation

- Le rendu est intégralement reconstruit à chaque `update()`, mais le nœud **géocache** est extrait dans un composant `React.memo` (`GeocacheNode`). Il ne se re-rend que si **sa** géocache, son focus ou sa zone changent. Les callbacks (`onOpen`, `onContextMenu`, `onDragStart`, `onDragEnd`) sont des **champs liés stables** de la classe, indispensables pour que la comparaison superficielle de `React.memo` opère. Bénéfice : lors d'une mise à jour non liée à un nœud (navigation clavier, survol d'une autre zone…), son `<div>` et son **icône SVG** ne sont pas re-rendus.
- Les tris sont **mémoïsés** :
  - `getSortedZones` : cache à une entrée, invalidé quand la référence de `zones` ou le tri change.
  - `getSortedGeocaches` : `WeakMap` clé = tableau de géocaches (remplacé à chaque rechargement ⇒ invalidation automatique et GC-friendly).
  Cela évite de re-trier à chaque `update()` **et** à chaque frappe clavier (`getVisibleItems` est appelé sur chaque touche).

## Chargement, cache et rafraîchissement

- `loadGeocachesForZone(zoneId, { force? })` : met en cache par zone. Le **spinner** n'apparaît qu'au premier chargement ; lors d'un rafraîchissement d'une zone déjà affichée, l'ancienne liste est conservée jusqu'à l'arrivée des données fraîches (pas de flash « Chargement… »).
- `refreshExpandedZones(zoneIds?)` :
  - **ciblé** (`zoneIds` fourni) : ne recharge que ces zones (si dépliées), en **parallèle** (`Promise.all`) ; les autres zones dépliées gardent leur cache. Utilisé par déplacement/copie/fusion/suppression de géocache, qui connaissent les zones impactées.
  - **global** (`zoneIds` absent) : purge le cache des zones **repliées** puis recharge en parallèle toutes les zones **dépliées**. Utilisé par les événements externes.
- **Fraîcheur à l'affichage** : `onAfterShow` déclenche un rafraîchissement global si les données datent de plus de `REFRESH_ON_SHOW_TTL_MS` (30 s), avec garde pour éviter tout sur-fetch au démarrage.

### Événements inter-widgets (`GeoAppWidgetEventsService`)

| Signal | Effet dans l'arbre |
|---|---|
| `onDidRequestZonesRefresh` | Rafraîchissement global (sauf s'il est auto-émis, cf. `notifyZonesRefreshFromSelf`). |
| `onDidChangeGeocache` | Rafraîchissement global. |
| `notifyZoneListChanged()` | Émis par l'arbre après création/suppression/renommage/duplication/fusion. |
| `requestZonesRefresh()` | Émis par l'arbre pour notifier les onglets de zone ouverts. |
| Événement DOM `geoapp-geocache-log-submitted` | Marque une géocache `found` en place (patch local ciblé, sans refetch). |

`notifyZonesRefreshFromSelf()` pose un drapeau le temps d'émettre `requestZonesRefresh`, pour que l'arbre ignore son propre événement (il vient déjà de se mettre à jour localement).

## Tri

Deux tris **indépendants** :

- **Zones** : clé (`name`, `created_at`, `geocaches_count`, `latest_geocache_created_at`, `latest_resolution_updated_at`) + sens, via les contrôles en haut du panneau. Persisté dans `geoApp.zones.sort` (objet, enregistré par `geoapp-preference-contribution.ts` ; **non** exposé dans la page Préférences — c'est une mémoire de « dernier tri »).
- **Géocaches** (dans chaque zone) : clé (`gc_code`, `name`, `cache_type`, `created_at`) + sens, via le **sous-menu du clic droit sur une zone** (« Trier les caches par… ») **et** via la page Préférences. Persisté en deux préférences enum **exposées** :
  - `geoApp.zones.geocacheSortKey`
  - `geoApp.zones.geocacheSortDirection`

  Déclarées dans `shared/preferences/geo-preferences-schema.json` (catégorie `ui`, section « Zones »). Voir `preferences-ajout-rapide.md`.

Le tri texte utilise un `Intl.Collator` (sensibilité `base`, `numeric: true`) ; le tri date utilise le timestamp (les dates absentes sont reléguées en fin) ; départage stable par `gc_code` puis `id`.

## Interactions souris

| Action | Résultat |
|---|---|
| **Simple-clic** sur une ligne de zone | Déplie/replie (modèle « dossier »). Temporisé 250 ms pour laisser place au double-clic. |
| **Double-clic** sur une ligne de zone | Ouvre le tableau de la zone (annule le dépliage en attente). |
| Clic sur une géocache | Ouvre sa fiche (et fixe l'élément actif clavier). |
| Clic droit sur zone | Menu : Ouvrir, Renommer, Dupliquer, Fusionner vers…, **Trier les caches par ▸**, Supprimer. |
| Clic droit sur géocache | Menu : Ouvrir, Déplacer vers…, Copier vers…, Supprimer. |

La temporisation simple/double clic évite un dépliage inutile (et donc un appel réseau) quand l'utilisateur double-clique pour ouvrir.

## Glisser-déposer d'une géocache

Implémentation HTML5 DnD native.

- La géocache est `draggable`. Au `dragStart`, l'état `{ geocache, sourceZoneId }` est mémorisé **et** un type MIME custom `application/x-geoapp-geocache` + charge utile JSON sont posés dans le `dataTransfer`.
- Le **wrapper de chaque zone** (ligne + enfants) est cible de dépôt. `dragOver`/`dragEnter` valident via `dataTransfer.types` (le seul lisible pendant le drag) **ou** l'état interne, appellent `preventDefault()` + `stopPropagation()`, et surlignent la cible (`zone-node--drop-target`).
- Au `drop`, la géocache est résolue (état interne, avec repli sur la charge utile `dataTransfer`) et déplacée via `moveGeocache` (⇒ rafraîchissement **ciblé** source + cible).
- Le dépôt sur la **zone source** est sans effet (pas de surbrillance).

> **Piège résolu** : la géocache draggable ne doit **pas** déclencher de re-render synchrone dans `onMouseDown` (ex. `this.update()`), sinon le `dragStart` est avorté et le curseur reste « interdit ». La sélection de l'élément actif est donc faite dans `onClick`, pas dans `onMouseDown`. Modèle de référence fonctionnel : le réordonnancement de colonnes de `geocaches-table.tsx` (usage systématique de `stopPropagation`).

## Accessibilité et navigation clavier

L'arbre suit le pattern **WAI-ARIA tree** avec `aria-activedescendant` (robuste face au re-render complet du widget) :

- Conteneur : `role="tree"`, `tabIndex=0`, `aria-activedescendant`.
- Zone : `role="treeitem"`, `aria-level=1`, `aria-expanded` (si enfants), `aria-selected`.
- Groupe d'enfants : `role="group"` ; géocache : `role="treeitem"`, `aria-level=2`.

| Touche | Action |
|---|---|
| ↓ / ↑ | Élément visible suivant / précédent |
| → | Déplie la zone, ou descend au 1er enfant |
| ← | Replie la zone, ou remonte à la zone parente |
| Entrée / Espace | Ouvre la zone (tableau) ou la fiche géocache |
| Début / Fin | Premier / dernier élément |

`getVisibleItems()` produit la liste à plat (dans l'ordre trié affiché) qui pilote la navigation. L'anneau de focus (`--theia-focusBorder`) n'apparaît que lorsque l'arbre a réellement le focus (`treeFocused`). Le clic souris synchronise l'élément actif.

Le **dialog** de déplacement/copie/fusion (`move-geocache-dialog.tsx`) est lui aussi une `listbox` navigable (↑/↓, Début/Fin, Entrée ; Échap ferme ; double-clic valide).

## Suppression en cascade d'une zone

`DELETE /api/zones/<id>` supprime la zone **et toutes ses géocaches**.

Contexte : le backref `zone.geocaches` (dans `geocaches/models.py`) n'a **pas** de cascade et `geocache.zone_id` est `NOT NULL`. Une suppression directe de la zone déclenchait donc un `UPDATE geocache SET zone_id=NULL` ⇒ `IntegrityError 500` dès qu'elle contenait une géocache.

Correctif (`delete_zone`) : pour chaque géocache de la zone, on procède **comme la suppression unitaire** —

1. `ArchiveService.snapshot_before_delete(geocache)` (archive la résolution, keyée par `gc_code`, indépendante de la zone) ;
2. `db.session.delete(geocache)` (déclenche les cascades enfants : waypoints, checkers, logs, images, observations…) ;
3. réinitialisation de la zone active si c'était elle ;
4. suppression de la zone, `commit` ;
5. `remove_geocache_dir` best-effort (images sur disque).

La réponse renvoie `deleted_geocaches_count`. Côté frontend, la confirmation avertit quand la zone n'est pas vide. Choix délibéré : suppression **explicite** plutôt que `cascade='all, delete-orphan'` sur le backref, pour ne pas risquer d'effets de bord `delete-orphan` sur `merge_zone` (qui réassigne `zone_id` directement).

Tests : `backend/tests/test_zones_api.py` (zone vide, cascade des enfants, reset de la zone active, tri, duplication, fusion, contrat de l'endpoint allégé).

## Styles

Tout est dans `style/zones-tree.css`, appliqué sous `.theia-zones-tree-widget` :

- Lignes : `.zone-node` / `.geocache-node` (+ `:hover`, `--active`, `--focused`, `--drop-target`).
- Le **survol** est en CSS pur (plus de mutation JS de `style.background`).
- Formulaire d'ajout : `.zone-add-form` / `.zone-add-input` / `.zone-add-submit`.
- Contrôles de tri : `.zone-sort-controls` / `.zone-sort-select` / `.zone-sort-direction`.

Priorité calibrée : la zone active l'emporte sur le survol (même spécificité, règle placée après) ; le focus (outline) coexiste avec les deux.

## Points d'attention

- **Ne pas** faire pointer l'arbre vers l'endpoint complet des géocaches : cela réintroduit l'over-fetch et les requêtes N+1.
- **Ne pas** ajouter de `this.update()` (ni tout re-render synchrone) dans le `onMouseDown` d'un élément `draggable` : cela casse le glisser-déposer.
- Pour que `React.memo` reste efficace, tout nouveau callback passé à `GeocacheNode` doit être un **champ lié stable**, jamais une closure inline.
- Toute préférence de tri des géocaches destinée à l'utilisateur doit être déclarée dans le **schéma partagé** (`shared/preferences/geo-preferences-schema.json`), pas seulement dans la contribution Theia locale.
- Le tri des géocaches nécessite `created_at` dans le payload de l'arbre : le garder si l'option « Date d'ajout » doit rester fonctionnelle.
