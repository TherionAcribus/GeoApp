# Trackables (TB) — Documentation technique

Gestion des trackables geocaching.com (Travel Bugs, geocoins) dans GeoApp. Le plan
et le découpage en lots sont dans [trackables-spec.md](trackables-spec.md) ; ce
document décrit ce qui est livré.

État : **lot 1 livré** (client backend, modèle, stockage) le 2026-09-29.

## 1. Vue d'ensemble

Les échanges avec geocaching.com reprennent ceux de c:geo (`GCWebAPI`, `GCLogAPI`,
`GCParser`, `GCConstants`). Tous les formats ci-dessous ont été relevés en réel
le 2026-09-29 sur le compte de l'utilisateur, avant d'écrire le code.

| Module | Rôle |
|---|---|
| `backend/gc_backend/services/geocaching_trackables.py` | Réseau et parsing, aucune écriture en base |
| `backend/gc_backend/services/trackable_store.py` | Base locale, aucun réseau |
| `backend/gc_backend/models.py` | `Trackable`, `GeocacheTrackable` |

## 2. Endpoints geocaching.com

| Besoin | Requête | Réponse |
|---|---|---|
| Mon inventaire | `GET /api/proxy/trackables?inCollection=false&inInventory=true&take=1000&skip=N` | Liste JSON, **avec** `trackingNumber` (code de suivi) |
| TBs d'une cache | `GET /api/proxy/web/v1/trackables/geocache/{GC}?take=1000&skip=N` | `{total, data: [...]}`, sans code de suivi ni propriétaire |
| Un TB | `GET /api/proxy/web/v1/trackables/{TB}` | Propriétaire, cache courante (`currentGeocache`), `trackableType` sous forme d'id seul |
| Types de log autorisés | `GET /live/trackable/{TB}/log` | Page Next.js : `__NEXT_DATA__` → `pageProps.logTypes` et `pageProps.loggable.currentGeocache` |
| Fiche détaillée | `GET /track/details.aspx?tracker={TB ou code de suivi}` | HTML : objectif, origine, localisation, distance, logs de la première page |

Pagination : pages de 1000 (valeur de c:geo), arrêt dès qu'une page est incomplète,
garde-fou à 20 pages.

**Authentification.** c:geo passe `/api/proxy` avec un jeton bearer obtenu sur
`/account/oauth/token`. Ici les cookies de la session partagée
(`get_auth_service().get_session()`) suffisent, comme pour le flux des amis : pas
de jeton à gérer.

**Types autorisés, constat réel.** Un TB posé dans une cache accepte Note (4),
Découvert (48), Retiré (13) et Pris ailleurs (19). Un TB que j'ai en main n'accepte
que Note (4) en log autonome : Visité et Déposé passent exclusivement par le log
de cache (champ `trackables` de `createGeocacheLog`, lot 2).

## 3. Client `GeocachingTrackablesClient`

Même patron que `GeocachingFriendActivityClient` : session injectable, sans état.

| Méthode | Retour |
|---|---|
| `fetch_my_inventory()` | `list[TrackableSummary]`, codes de suivi inclus |
| `fetch_cache_inventory(gc_code)` | `list[TrackableSummary]` |
| `fetch_trackable(tb_code)` | `TrackableSummary` |
| `lookup(code)` | `TrackableSummary` ; `tracking_code` renseigné si le code saisi était un code de suivi |
| `fetch_log_page_info(tb_code)` | `TrackableLogPageInfo` (types autorisés, cache courante) |
| `fetch_details(tb_code)` | `TrackableDetails` (fiche HTML + `TrackableLogEntry` de la première page) |

**Recherche par code.** `details.aspx?tracker=` accepte le code public comme le
code de suivi. `lookup` lit le code public sur la fiche (`CoordInfoCode`) : s'il
diffère du code saisi, le code saisi était le code de suivi. On n'essaie pas de
deviner la nature du code à sa forme : un code de suivi de six caractères peut
commencer par « TB ». Un code inconnu renvoie une page au même gabarit, avec un
`CoordInfoCode` vide.

**Dates des logs de la fiche.** Elles sont affichées au format de date du compte
(`MM/dd/yyyy` par défaut, `dd/MM/yyyy`, `dd.MM.yyyy`…), que la page ne déclare pas.
`_guess_day_first` tranche sur l'ensemble des logs de la page : un premier nombre
supérieur à 12 impose jour/mois, un second supérieur à 12 impose mois/jour. À
défaut, c'est mois/jour, sauf avec le séparateur « . ». La date brute reste
disponible (`log_date_raw`).

**Erreurs.**

| Situation | Exception |
|---|---|
| 401 ou 403 | `NotAuthenticatedError` (celle du module amis) |
| Code inconnu, ou 404 sur la fiche JSON | `TrackableNotFoundError` |
| 429, autre code HTTP, réponse non-JSON | `TrackableError` |

**Types de log.** `TrackableLogType` reprend les `gcApiId` de c:geo, avec les
libellés français dans `TRACKABLE_LOG_TYPE_LABELS`.
`CACHE_LOG_TRACKABLE_ACTIONS` associe les actions du log de cache (`visit` → 75,
`drop` → 14). « Ne rien faire » n'a pas d'id : le TB n'est pas envoyé.

## 4. Modèle et stockage

**Tables.** Toutes deux sont créées par `init_db` ; une migration Alembic
parallèle existe (`add_trackable_tables`).

- `trackable`
  - Cache local de mon inventaire (`in_my_inventory`).
  - Mémoire de la dernière action au log de cache (`last_cache_log_action` :
    `none` / `visit` / `drop`), qui fournira la valeur par défaut au lot 3.
  - Colonne `brand` à `gc`, prête pour GeoKrety.
- `geocache_trackable`
  - Relie une cache et un TB par leurs codes GC/TB, pas par clés étrangères : la
    cache n'est pas forcément importée.
  - Les lignes d'une cache sont remplacées à chaque relevé.

**Règles de fusion** (`trackable_store`) :
- un relevé ne vide jamais un champ déjà connu : l'inventaire d'une cache, pauvre,
  n'efface ni le propriétaire ni le code de suivi appris par mon inventaire ;
- `save_my_inventory` sort de l'inventaire les TBs qui n'y sont plus, et efface la
  cache courante des TBs en main ;
- la date du dernier relevé est gardée dans `AppConfig`
  (`trackables.inventory.last_sync_at`).

## 5. Points d'attention

- **Code de suivi secret.** Il permet de loguer le TB. Il est stocké en base locale
  uniquement. `Trackable.to_dict()` et `TrackableSummary.to_dict()` ne l'exposent
  pas (le premier donne `has_tracking_code`). Il n'apparaît pas dans les messages
  d'erreur. Il ne doit jamais entrer dans un contexte envoyé à l'IA.
- **Inventaire volumineux.** Le compte de référence a 70 TBs en main : la
  pagination et un affichage filtrable ne sont pas du luxe.
- **Motifs HTML.** La fiche `details.aspx` est une vieille page ASP.NET. Ses
  identifiants (`ctl00_ContentBody_…`) sont stables depuis des années, mais c'est
  le point le plus fragile. Tout ce qui est disponible en JSON est lu en JSON.

## 6. Tests

`backend/tests/test_geocaching_trackables.py` (36 tests), sur des extraits calqués
sur les réponses réelles :
- parsing des trois formes JSON, de la page Next.js (avec repli sur regex) et de la
  fiche HTML ;
- dates selon le format du compte ;
- pagination, 401/403/404/429, recherche par code public ou par code de suivi ;
- stockage : fusion, sortie d'inventaire, remplacement de l'inventaire d'une
  cache, code de suivi jamais sérialisé.

## 7. Références code

- Client : `backend/gc_backend/services/geocaching_trackables.py`
- Stockage : `backend/gc_backend/services/trackable_store.py`
- Modèles : `Trackable`, `GeocacheTrackable` dans `backend/gc_backend/models.py`
- Migration : `backend/migrations/versions/add_trackable_tables.py`
- c:geo : `connector/gc/GCWebAPI.java` (`getTrackableInventory`,
  `getTrackablesOfCache`), `GCLogAPI.java` (`createLogTrackable`),
  `GCConstants.java` (`PATTERN_TRACKABLE_*`)
