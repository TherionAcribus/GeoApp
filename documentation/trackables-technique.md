# Trackables (TB) — Documentation technique

Gestion des trackables geocaching.com (Travel Bugs, geocoins) dans GeoApp. Le plan
et le découpage en lots sont dans [trackables-spec.md](trackables-spec.md) ; ce
document décrit ce qui est livré.

État au 2026-09-29 :
- **lot 1 livré** : client backend, modèle, stockage ;
- **lot 2 livré** : TBs dans le log de cache, routes `/api/trackables`, log de TB autonome côté backend ;
- **lot 3 livré** : section « Trackables » de l'éditeur de logs.

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

## 5. Envoi des logs

### 5.1 TBs dans le log de cache

`POST /api/geocaches/<id>/logs/submit` accepte un champ `trackables` :

```json
{"text": "…", "date": "2026-09-29", "logType": "found",
 "trackables": [{"code": "TB6Q3ER", "action": "visit"},
                {"code": "TBAAA2",  "action": "drop"},
                {"code": "TBAAA3",  "action": "none"}]}
```

- **Validation** (`_parse_trackable_actions`) : code public obligatoire, action
  `visit`, `drop` ou `none`, un TB une seule fois. Sinon, 400 `INVALID_TRACKABLES`,
  avant tout envoi.
- **Envoi** : `GeocachingSubmitLogsClient.submit_geocache_log(..., trackables=[(code, id)])`
  remplit le champ `trackables` du corps tRPC au format de c:geo,
  `[{"trackableCode": "TB…", "trackableLogTypeId": 75}]`. « Ne rien faire » n'est
  pas envoyé. Le repli sur l'ancien endpoint REST garde le champ.
- **Après succès** : `trackable_store.apply_cache_log_trackable_actions` mémorise
  l'action de chaque TB, `none` compris, pour le défaut du log suivant. Un TB
  déposé sort de mon inventaire et est placé dans la cache ; un TB n'est que dans
  une cache à la fois. C'est du best-effort : le log est parti, un échec local ne
  le fait pas passer pour raté.
- **Réponse** : la route renvoie `trackables` (les actions appliquées).

### 5.2 Log de TB autonome

`POST /api/trackables/<TB>/logs` envoie un log sur un TB seul. Corps :

```json
{"logType": 13, "text": "…", "date": "2026-09-29", "trackingCode": "AB12CD", "geocacheCode": "GC1E51"}
```

- **Endpoint** : `POST /api/live/v1/trpc/web.logs.createTrackableLog?batch=1`, avec
  le corps de c:geo : `images`, `logDate`, `logText`, `logType`, `trackingCode`,
  plus `geocacheReferenceCode` pour « Retiré » (13) seulement.
- **Code de suivi** : pris dans le corps, sinon celui connu en base. Il n'est
  facultatif que pour une note (4), comme chez c:geo.
- **Cache pour « Retiré »** : prise dans le corps, sinon lue comme cache courante
  sur la page de log du TB.
- **Après succès** : `apply_trackable_log` fait entrer un TB retiré ou pris dans
  mon inventaire et le sort de sa cache, puis garde le code de suivi accepté.
- **Masquage du code de suivi** : la réponse de geocaching.com reprend le corps
  envoyé, donc le code de suivi. Il est masqué (`***`) dans l'extrait de réponse
  et dans la réponse décodée, avant les logs applicatifs, et retiré du résultat.

### 5.3 Routes `/api/trackables`

Toutes les erreurs ont le format des routes amis,
`{success: false, error, error_message}`.

| Route | Rôle | Erreurs |
|---|---|---|
| `GET /inventory[?refresh=1 | ?max_age=<s>]` | Mon inventaire depuis la base ; le site est lu au premier appel, sur `refresh`, ou si le relevé a plus de `max_age` secondes. Le bilan `sync` compte `added` (TBs entrés, y compris repris après un dépôt) et `removed`. Un relevé `max_age` raté sert la copie locale avec `sync_error` | 401 `not_authenticated`, 502 `fetch_failed` (sur `refresh` seulement) |
| `GET /geocache/<GC>[?refresh=1]` | TBs d'une cache, même logique ; date du relevé dans `AppConfig` | 400 si le code n'est pas un GC |
| `GET /lookup?code=` | Code public ou code de suivi ; `tracking_code_matched` dit si c'était un code de suivi, alors gardé en base | 404 `not_found` |
| `GET /<TB>` | `trackable` (base mise à jour) + `details` (fiche HTML, logs) | |
| `GET /<TB>/log-info` | Types autorisés, cache courante, `has_tracking_code` | |
| `POST /<TB>/logs` | Log autonome (§ 5.2) | 400 `invalid_log_type`, `missing_text`, `invalid_date`, `missing_tracking_code`, `missing_geocache` ; 502 `submit_failed`, `submit_rejected` |

## 6. Éditeur de logs : section « Trackables »

### 6.1 Ce que voit l'utilisateur

Sous le tableau des géocaches, une section repliable :
- **En-tête** : il annonce le bilan (« 70 en main · 3 visités · 1 déposé »), ce qui
  évite d'ouvrir la section quand rien n'est prévu. Il affiche aussi la date du
  dernier relevé et un bouton « ⟳ Rafraîchir ».
- **Rafraîchir** relit l'inventaire sur Geocaching.com (TB pris ou déposé ailleurs)
  et affiche un bilan (« 70 trackable(s) en main (1 entré) »). Le bouton n'est jamais
  grisé par l'envoi : c'est après un lot qu'on en a besoin.
- **Barre d'outils** :
  - un filtre (code, nom, type ; sans accents ni casse), affiché à partir de 9 TBs ;
  - « Tout mettre à » (Ne rien faire / Visité), appliqué aux TBs affichés quand le
    filtre est actif.
- **Une ligne par TB**, dans cet ordre :
  - trois boutons Rien / Visité / Déposé, **en tête de ligne**, collés au nom ;
  - l'icône, le nom et le code (lien vers la fiche du site) ;
  - en « Déposé », le choix de la géocache du lot, placé juste après le code.

  L'action était d'abord un menu déroulant rejeté à droite : sur un éditeur large, on
  ne voyait plus à quel TB il appartenait.
- **Lisibilité** : une ligne sur deux est teintée et le survol surligne la ligne. Une
  ligne en « Visité » ou « Déposé » est colorée (fond et bordure) de la couleur de
  son action.
- **Blocs par cache** : en mode « texte différent par cache », chaque bloc rappelle
  en lecture seule ce que son log fait des TBs (« 🐞 3 TB visités · TB1234 déposé »).
- **Confirmation** : le récapitulatif avant envoi liste les visites et chaque dépôt.

### 6.2 Règles du lot

La logique pure est dans `log-editor/trackables.ts`, testée sans React.

- **Types de log** : « Visité » accompagne chaque log trouvé ou note ; un DNF ne porte
  jamais de TB. « Déposé » vise une seule géocache, en « Found it », pas encore envoyée.
- **Cible de dépôt par défaut** : la dernière géocache trouvée du lot. Une cible
  devenue invalide (passée en DNF, déjà envoyée) retombe sur ce défaut.
- **Envoi** : un TB déposé est en « Ne rien faire » dans les logs d'avant, et
  disparaît des logs d'après. Il n'est plus en main.
- **Mémoire** : chaque log envoie tous les TBs encore en main, « none » compris. Le
  backend ne transmet pas « none » au site, mais le mémorise comme défaut du log
  suivant.
- **Plan figé** : le plan TB du lot est calculé une fois avant la boucle d'envoi
  (`trackablePlan`). Sans ça, une géocache envoyée sortirait du lot restant, et un
  dépôt prévu chez elle se reporterait sur la suivante.
- **Validation avant envoi** : un TB en « Déposé » sans géocache trouvée pour le
  recevoir bloque l'envoi, et la section s'ouvre.
- **Avertissement** : au-delà de 100 visites par log (seuil de c:geo), le
  récapitulatif surligne un avertissement.

### 6.3 Valeurs par défaut et brouillon

- **Action par défaut** (`defaultTrackableAction`, ordre de c:geo) : l'action
  mémorisée au dernier log (`visit` ou `none`), sinon la préférence
  `geoApp.logs.trackableAutoVisit` (défaut : faux). Un « Déposé » mémorisé n'est
  jamais repris : un TB de nouveau en main a été repris depuis.
- **Brouillon** : les choix de TB entrent dans `LogDraft.trackables`, seulement s'ils
  s'écartent des défauts. Tant que l'inventaire n'est pas chargé, les choix restaurés
  sont conservés tels quels plutôt que perdus à la première sauvegarde.
- **Chargement de l'inventaire** : il se fait après la restauration du brouillon, sans
  bloquer la rédaction, avec `max_age=900`. Un relevé de plus de 15 minutes est donc
  relu sur le site à l'ouverture de l'éditeur. En cas d'échec, la liste locale
  s'affiche avec un avertissement. Après un lot qui a visité ou déposé des TBs, la
  copie locale (déjà mise à jour par le backend) est relue.

## 7. Points d'attention

- **Code de suivi secret.** Il permet de loguer le TB. Il est stocké en base locale
  uniquement. `Trackable.to_dict()` et `TrackableSummary.to_dict()` ne l'exposent
  pas (le premier donne `has_tracking_code`). Il n'apparaît pas dans les messages
  d'erreur. Il ne doit jamais entrer dans un contexte envoyé à l'IA.
- **Inventaire volumineux.** Le compte de référence a 70 TBs en main : la
  pagination et un affichage filtrable ne sont pas du luxe.
- **Motifs HTML.** La fiche `details.aspx` est une vieille page ASP.NET. Ses
  identifiants (`ctl00_ContentBody_…`) sont stables depuis des années, mais c'est
  le point le plus fragile. Tout ce qui est disponible en JSON est lu en JSON.

## 8. Tests

`backend/tests/test_geocaching_trackables.py` (36 tests), sur des extraits calqués
sur les réponses réelles :
- parsing des trois formes JSON, de la page Next.js (avec repli sur regex) et de la
  fiche HTML ;
- dates selon le format du compte ;
- pagination, 401/403/404/429, recherche par code public ou par code de suivi ;
- stockage : fusion, sortie d'inventaire, remplacement de l'inventaire d'une
  cache, code de suivi jamais sérialisé.

`frontend/theia-extensions/zones/src/browser/tests/trackables-submission.test.ts`
(dans `npm run test:geoapp`) :
- défauts ;
- répartition sur un lot (visites, dépôt, DNF, notes, caches déjà envoyées) ;
- validation, payload, récapitulatif, filtre, restauration de brouillon.

`backend/tests/test_geocaching_submit_logs.py` (section Trackables) :
- format du champ `trackables`, et conservation par le repli REST ;
- corps de `createTrackableLog` ;
- masquage du code de suivi.

`backend/tests/test_trackables_api.py` :
- la route du log de cache avec des TBs : envoi, validation, effets en base ;
- toutes les routes `/api/trackables`, avec un client réseau simulé.

## 9. Références code

- Client : `backend/gc_backend/services/geocaching_trackables.py`
- Stockage : `backend/gc_backend/services/trackable_store.py`
- Envoi : `GeocachingSubmitLogsClient.submit_geocache_log(trackables=…)` et
  `submit_trackable_log` dans `backend/gc_backend/services/geocaching_submit_logs.py`
- Routes : `backend/gc_backend/blueprints/trackables.py`, et `_parse_trackable_actions`
  dans `backend/gc_backend/blueprints/logs.py`
- Frontend : `log-editor/trackables.ts` (logique), `log-editor/trackables-section.tsx`
  (section), intégration dans `geocache-log-editor-widget.tsx`
  (`loadTrackableInventory`, `renderTrackablesSection`, `trackablePlan`)
- Modèles : `Trackable`, `GeocacheTrackable` dans `backend/gc_backend/models.py`
- Migration : `backend/migrations/versions/add_trackable_tables.py`
- c:geo : `connector/gc/GCWebAPI.java` (`getTrackableInventory`,
  `getTrackablesOfCache`), `GCLogAPI.java` (`createLogTrackable`),
  `GCConstants.java` (`PATTERN_TRACKABLE_*`)
