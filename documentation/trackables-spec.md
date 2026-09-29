# Trackables (TB) — spec de mise en œuvre

Plan du 2026-09-29. Ajoute la gestion des trackables geocaching.com dans GeoApp,
en reprenant les échanges de c:geo (`GCLogAPI`, `GCWebAPI`, `GCLoggingManager`,
`GCParser`, `LogTypeTrackable`). À implémenter lot par lot ; la doc technique
`trackables-technique.md` est écrite au fil des livraisons.

## Contexte

GeoApp sait loguer des caches, une par une ou en lot, mais ignore complètement les trackables. Aujourd'hui, le champ `trackables` du payload tRPC est toujours envoyé vide ([geocaching_submit_logs.py:326](../backend/gc_backend/services/geocaching_submit_logs.py#L326)). Aucun modèle, écran ou scraper ne parle des TBs.

Objectif : gérer les TBs de façon ergonomique en reprenant les échanges avec geocaching.com de c:geo (`GCLogAPI`, `GCWebAPI`, `GCLoggingManager`, `GCParser`, `LogTypeTrackable`).

Périmètre validé :
- actions TB au moment du log de cache, y compris en lot ;
- TBs présents dans la cache ;
- log de TB autonome ;
- fiche TB détaillée.

Ce qui reste en dehors, pour l'UI et les sources :
- Une partie se fait dans un **nouveau widget « Trackables »**. L'éditeur de logs ne garde que la section des actions.
- **geocaching.com seulement.** Le modèle porte tout de même un champ `brand` pour pouvoir ajouter GeoKrety plus tard.

Organisation : même principe que les chantiers précédents. Une spec `documentation/trackables-spec.md` découpée en lots, implémentée lot par lot, puis la doc `documentation/trackables-technique.md` au fil des livraisons.

---

## Référence c:geo : ce qu'on copie

| Besoin | Endpoint | Détails |
|---|---|---|
| Mon inventaire | `GET /api/proxy/trackables?inCollection=false&inInventory=true&take=1000&skip=N` | Tableau `[{referenceCode, name, iconUrl, trackingNumber}]`. c:geo utilise d'abord le JSON Next.js de `/live/geocache/{GC}/log` quand il y a 20 TBs ou moins. On garde le proxy seul, plus simple. |
| TBs dans une cache | `GET /api/proxy/web/v1/trackables/geocache/{GC}?take=1000&skip=N` | Réponse `{total, data:[…]}`. Pagination tant que `len(data) == take`. |
| Actions au log de cache | Champ `trackables` de `web.logs.createGeocacheLog` (déjà utilisé) | Entrées `[{"trackableCode": "TBxxx", "trackableLogTypeId": id}]` |
| Log TB autonome | `POST /api/live/v1/trpc/web.logs.createTrackableLog?batch=1` | Payload `{"0":{"referenceCode":"TBxxx","body":{images, logDate, logText, logType, trackingCode, geocacheReferenceCode?}}}`. `geocacheReferenceCode` n'est envoyé que pour « Retiré », et vaut la cache courante du TB. |
| Types autorisés pour un TB | `GET /live/trackable/{TB}/log` | Regex `"logTypes":\[([^\]]+)\]` pour les types, `"currentGeocache":\{…\}` pour la cache courante. |
| Suppression d'un log TB | `web.logs.deleteTrackableLog` | Payload `{"0":{"referenceCode": logId, "reasonText": ""}}`. Optionnel, en fin de chantier. |
| Recherche et fiche | `GET /track/details.aspx?tracker=<TB ou code de suivi>` | Scraping HTML avec les motifs `PATTERN_TRACKABLE_*` de `GCConstants.java`. |

Types de log TB (`gcApiId`) :

| Type | Id |
|---|---|
| Ne rien faire | 1 |
| Visité | 75 |
| Déposé | 14 |
| Retiré | 13 |
| Pris ailleurs | 19 |
| Note | 4 |
| Découvert | 48 |

Dans l'inventaire au log de cache, seuls « Ne rien faire », « Visité » et « Déposé » sont proposés.

Ergonomie de c:geo à reprendre :
- un bouton « Tout mettre à » ;
- la dernière action mémorisée pour chaque TB ;
- une préférence « visite auto » ;
- un avertissement au-delà de 100 visites.

**Points à vérifier en réel au lot 1** (non vérifiés chez c:geo) :
- ~~Est-ce que `/api/proxy/…` passe avec nos seuls cookies ?~~ **Oui** (vérifié le 2026-09-29) : pas de jeton bearer. Il existe aussi `GET /api/proxy/web/v1/trackables/{TB}` (JSON d'un TB, avec la cache courante), et la page de log expose un `__NEXT_DATA__` exploitable.
- Est-ce qu'il faut envoyer les entrées « Ne rien faire » (1) ? Par défaut, on ne les envoie pas.
- Quel format de `logDate` le log TB attend-il ? On reprend celui du log de cache.

---

## Lots

### Lot 1 : client backend et modèle — livré le 2026-09-29

- **Nouveau client** `backend/gc_backend/services/geocaching_trackables.py`, classe `GeocachingTrackablesClient`.
  - Il reprend le patron de `GeocachingFriendActivityClient` ([geocaching_friend_activity.py:123-188](../backend/gc_backend/services/geocaching_friend_activity.py#L123)) : session injectable, `NotAuthenticatedError` sur 401/403, `_get_reference_code()`.
  - Méthodes :
    - `fetch_my_inventory()`
    - `fetch_cache_inventory(gc_code)`
    - `lookup(code)`, qui scrape `track/details.aspx` et renvoie un TB avec sa cache courante ;
    - `fetch_log_page_info(tb_code)`, qui renvoie les types autorisés et la cache courante ;
    - `fetch_details(tb_code)`, pour la fiche et les logs de la première page.
- ~~Jeton bearer~~ : inutile, les cookies suffisent.
- **Constantes** : `TrackableLogType` et ses libellés dans `geocaching_trackables.py`.
- **Modèles SQLAlchemy** dans `backend/gc_backend/models.py`, déclarés dans `init_db` avec une migration Alembic parallèle, comme d'habitude :
  - `Trackable` : `reference_code` unique, `brand='gc'`, `name`, `icon_url`, `tracking_code` (nullable, secret), `owner`, `goal`, `current_location_kind`/`current_geocache_code`, `in_my_inventory`, `last_action_id`, `updated_at`. Cache local de l'inventaire et mémoire de la dernière action.
  - `GeocacheTrackable` : cache ↔ TB, avec `seen_at`.
- **Tests** : `backend/tests/test_geocaching_trackables.py`, avec FakeSession sur des fixtures JSON/HTML (pagination, 401, codes de suivi à 6 caractères, extraction de `logTypes` et `currentGeocache`).

### Lot 2 : actions TB au log de cache (backend)

- `submit_geocache_log(..., trackables=None)` construit `[{"trackableCode", "trackableLogTypeId"}]` et filtre les id 1.
  - Le fallback REST legacy suit le même chemin.
- La route [logs.py:532](../backend/gc_backend/blueprints/logs.py#L532) accepte `trackables: [{code, action}]`.
  - `action` vaut `visit`, `drop` ou `none`, et est mappé vers les ids côté serveur.
  - La route valide le code.
  - Après succès, elle met à jour `Trackable.last_action_id`, `in_my_inventory=False` pour les TBs déposés, et `GeocacheTrackable`.
- **Routes** dans `backend/gc_backend/blueprints/trackables.py`, préfixe `/api/trackables` :
  - `GET /inventory?refresh=` : cache DB, puis rafraîchissement GC ;
  - `GET /geocache/<gc>` ;
  - `GET /lookup?code=` ;
  - `GET /<tb>` pour la fiche ;
  - `GET /<tb>/log-info`.
- **Tests** : la forme du payload (mise à jour de l'assert de `test_geocaching_submit_logs.py:98`) et une route monkeypatchée.

### Lot 3 : section TB dans l'éditeur de logs (frontend)

- `log-editor/trackables-section.tsx`, qui se charge une fois pour tout le lot.
  - Il liste l'inventaire (icône, nom, code).
  - Chaque TB a un sélecteur Ne rien faire / Visité / Déposé.
  - Un bouton « Tout mettre à » applique une action à tous les TBs.
  - Un bouton « Rafraîchir » recharge l'inventaire.
- **En lot multi-caches** :
  - « Visité » s'applique à chaque cache du lot. C'est le comportement GC normal, un TB peut visiter plusieurs caches.
  - « Déposé » demande de choisir **une** cache cible : sélecteur par TB parmi les caches du lot, par défaut la dernière. Un TB déposé est retiré des choix pour les caches suivantes.
  - La vue par cache (`per-cache-block.tsx`) affiche un résumé en lecture seule : « 3 TB visités, TB1234 déposé ».
- **Valeurs par défaut**, dans l'ordre :
  1. la dernière action mémorisée pour ce TB (champ `last_action_id` du backend) ;
  2. sinon la préférence `geoApp.logs.trackableAutoVisit` (défaut : faux).
- **État et soumission** :
  - L'état entre dans `LogDraft` et `LogHistoryEntry` ([log-editor/types.ts](../frontend/theia-extensions/zones/src/browser/log-editor/types.ts)), pour que les brouillons survivent à un crash en plein lot.
  - `buildLogSubmissionPayload` ([submission-orchestrator.ts:97](../frontend/theia-extensions/zones/src/browser/log-editor/submission-orchestrator.ts#L97)) et `SubmitLogPayload` ([log-submit-service.ts:17](../frontend/theia-extensions/zones/src/browser/log-editor/log-submit-service.ts#L17)) reçoivent les `trackables` de la cache courante.
- **Contrôles et confirmation** :
  - Avertissement au-delà de 100 visites.
  - Le dialogue de confirmation (`buildSubmissionSummaryNode`) résume les actions TB.
- **Tests** ts-node : `trackables-submission.test.ts`, à ajouter au script `test:geoapp`. Il couvre la répartition des dépôts en lot, les défauts et le payload.

### Lot 4 : TBs présents dans la cache

- Le scraping des détails de la cache et un bouton de rafraîchissement remplissent `GeocacheTrackable` via `/api/trackables/geocache/<gc>`.
- Nouvelle section « Trackables » dans `geocache-details-widget.tsx` : liste, lien vers la fiche, action « Retirer / Découvrir ». Le clic ouvre le widget Trackables pré-rempli (lot 5).
- L'éditeur de logs affiche aussi « TBs dans cette cache » avec une case « Découvert » ou « Retiré ».
  - Ces actions ne passent pas par `createGeocacheLog` : ce sont des logs TB autonomes, envoyés après le log de cache par la file du lot 5, avec le même texte optionnel.
  - Elles demandent le code de suivi, que le site ne donne pas pour un TB qu'on n'a pas en main. Le champ est donc obligatoire, et l'action reste désactivée tant qu'il est vide.

### Lot 5 : widget « Trackables » et log autonome

- Nouveau widget `frontend/theia-extensions/zones/src/browser/trackables-widget.tsx`, avec commande et vue, câblé dans `zones-frontend-module.ts` comme les autres widgets. Trois onglets :
  1. **Mon inventaire** : liste, recherche et filtre, date de rafraîchissement, ouverture de la fiche, action rapide « Loguer ».
  2. **Loguer / Découvrir** :
     - Un champ multi-codes : collage de plusieurs codes de suivi, séparateurs libres, extraction depuis les URL `coord.info` / `?tracker=`, regex du `TravelBugConnector`.
     - Résolution de chaque code par `lookup`, avec aperçu (nom, propriétaire, localisation).
     - Choix du type parmi les types autorisés (`log-info`), date, texte commun avec les boutons IA existants de `GlobalLogEditor` si possible, cache pour « Retiré ».
     - Envoi en file avec progression et bouton stop, en réutilisant `submit-progress.tsx` et `submit-badge.tsx`. C'est le cas typique des découvertes en masse lors d'un event.
  3. **Fiche TB** : détails scrapés (propriétaire, objectif, origine, localisation, distance, image) et logs de la première page.
- **Backend** :
  - `POST /api/trackables/<tb>/logs` dans le client, avec `create_trackable_log(tb_code, tracking_code, log_type_id, text, date, geocache_code?)`. Il réutilise `_fetch_csrf_token`, `unwrap_trpc_payload` et `extract_trpc_error_info` de `geocaching_submit_logs.py`, factorisés si besoin.
  - Pour « Retiré », `geocacheReferenceCode` est déduit de `currentGeocache` quand l'utilisateur ne le fournit pas.
  - Après succès, mise à jour de l'inventaire local : un TB retiré ou pris entre dans l'inventaire.
- **Code de suivi** : il n'est stocké qu'en DB locale. Il n'apparaît jamais dans les logs applicatifs, ni dans les contextes envoyés à l'IA.

### Lot 6 (optionnel) : finitions

- Suppression d'un log TB (`deleteTrackableLog`).
- Photos sur les logs TB, par le même endpoint `logdrafts/images`.
- Export field notes avec les TBs.
- Lexique IA : entrées TB dans `shared/lexicons/geocaching-lexicon.json`.

---

## Fichiers clés

**Nouveaux fichiers**
- `backend/gc_backend/services/geocaching_trackables.py`
- `backend/gc_backend/blueprints/trackables.py`
- `log-editor/trackables-section.tsx`
- `trackables-widget.tsx`
- Tests backend et frontend
- `documentation/trackables-spec.md` et `documentation/trackables-technique.md`

**Fichiers modifiés**
- [geocaching_submit_logs.py](../backend/gc_backend/services/geocaching_submit_logs.py)
- [logs.py](../backend/gc_backend/blueprints/logs.py)
- `models.py` et `database.py` (`init_db`)
- `__init__.py` (enregistrement du blueprint)
- `geocache-log-editor-widget.tsx`
- Dans `log-editor/` : `types.ts`, `submission-orchestrator.ts`, `log-submit-service.ts`, `per-cache-block.tsx`
- `geocache-details-widget.tsx`
- `zones-frontend-module.ts`
- `zones/package.json` (script `test:geoapp`)

**Éléments existants à réutiliser**
- CSRF et tRPC : helpers de `geocaching_submit_logs.py` (l.110, 210, 233)
- Session : `get_auth_service().get_session()`
- Patrons de client : `geocaching_friend_activity.py`, et `geocaching_friend_finds.py` pour le backoff 429
- `log-history-store.ts` pour les brouillons et les préférences
- `submit-progress.tsx` pour les files d'envoi

---

## Vérification

- **Backend** : `pytest backend/tests/test_geocaching_trackables.py backend/tests/test_geocaching_submit_logs.py backend/tests/test_geocache_log_submit_storage.py`.
- **Frontend** : `npm run test:geoapp` dans `frontend/theia-extensions/zones`.
- **En réel, sur le compte de l'utilisateur**, dans l'ordre, et sur un TB personnel ou de test :
  1. `GET /api/trackables/inventory`.
  2. `GET /api/trackables/geocache/<GC connue avec TBs>`.
  3. `lookup` avec un code de suivi.
  4. Une note (type 4) sur un TB personnel, l'action la moins intrusive, pour valider `createTrackableLog`.
  5. Un log de cache avec un « Visité », puis vérification sur la page du TB.
- **Lancement de l'app** (skill run) : éditeur en lot de 2 caches, avec 1 TB visité partout et 1 TB déposé dans la 2ᵉ. Contrôler le récapitulatif de confirmation, puis la restauration du brouillon après un arrêt en cours de lot.
