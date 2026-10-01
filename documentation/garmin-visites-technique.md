# Visites GPS Garmin — documentation technique

Fonctionnement de l'import du fichier `geocache_visits.txt` des GPS Garmin et de la
préparation des logs à partir des visites. Spec et découpage en lots :
[garmin-visites-spec.md](garmin-visites-spec.md). Ce document est complété à chaque lot
livré.

## 1. Le fichier

Le GPS ajoute une ligne par visite de cache dans `<lecteur>\Garmin\geocache_visits.txt`
et **ne vide jamais ce fichier**. Celui de l'utilisateur couvre 2012 → 2026, avec 14 629
visites.

```
GC3E6GR,2012-11-30T18:23Z,Found it,""
GC62VNM,2019-12-29T12:05Z,Didn't find it,"



MMM
A"
```

| Colonne | Contenu | Pièges |
|---|---|---|
| 1 | Code GC | Vide (367 lignes), abîmé (`8`, `C`, `#`) ou réduit à un octet de contrôle (`\x03`, `\x04`, `\x05`) |
| 2 | Horodatage `AAAA-MM-JJTHH:MMZ` | **Vraiment en UTC** (voir 1.1) |
| 3 | Résultat | `Found it`, `Didn't find it`, `Unattempted`, `Needs Maintenance` ; d'autres libellés selon le modèle |
| 4 | Commentaire, entre guillemets | Tapé au clavier du GPS, peut s'étendre sur plusieurs lignes |

Encodage : UTF‑16 LE **sans BOM**, fins de ligne CRLF. Le lecteur accepte aussi l'UTF‑16
avec BOM, l'UTF‑8 et le cp1252.

### 1.1 Les heures sont en UTC

La base ne contenait aucun log de l'utilisateur pour vérifier directement. La preuve est
statistique : sur le fichier réel, le 5e centile des heures de visite vaut 7h45 en été
contre 8h43 en hiver (médiane : 11h20 contre 11h58). La journée de géocaching commence à la
même heure locale toute l'année : le décalage d'environ une heure est celui du passage
UTC+1 / UTC+2.

Conséquence : la **date du log** se calcule en heure locale. Une visite à 22h30Z en été
appartient au lendemain.

Le fuseau est celui de l'OS (`datetime.astimezone()` sans argument). Le backend tourne sur
la machine de l'utilisateur, et le venv n'a pas `tzdata` : `ZoneInfo('Europe/Paris')`
échoue sous Windows. Le point d'entrée unique est `gps_visit_store.get_local_tz()`, qui
renvoie `None` (fuseau de l'OS) ; les tests le remplacent par un fuseau fixe.

## 2. Lecture et réduction — `services/garmin_visits.py`

Module pur : aucune base, aucun réseau.

- `decode_visits_file(data)` : détection de l'encodage (BOM, octets nuls alternés, UTF‑8,
  repli cp1252).
- `parse_visits(data) -> ParseResult` : `csv.reader` gère le commentaire multiligne et les
  guillemets doublés.
  - Les lignes dont la date est illisible vont dans `unreadable` (numéro de ligne, contenu) :
    elles sont rapportées, jamais ignorées sans rien dire.
  - Une virgule hors guillemets dans le commentaire ajoute des colonnes : elles sont
    recollées.
  - Les visites sortent triées par heure.
- `normalize_code(raw)` : supprime blancs, caractères de contrôle et caractères invisibles,
  met en majuscules, vérifie `^GC[0-9A-Z]{1,8}$`, sinon `None`.
- `map_status(raw)` :

  | Libellé | `status` | Type de log proposé |
  |---|---|---|
  | `Found it`, `Webcam Photo Taken` | `found` | `found` |
  | `Didn't find it` | `dnf` | `dnf` |
  | `Unattempted` | `unattempted` | `skip` |
  | `Needs Maintenance` | `needs_maintenance` | `found`, à confirmer |
  | autre | `other` | `note` |

- `occurrence_keys(visits)` : clé d'unicité `(code brut, heure, statut, rang)`. Le rang
  distingue les doublons exacts : le fichier réel contient deux visites sans code le
  2020‑08‑16 à 09:52. Le fichier étant seulement complété, jamais réécrit, le rang d'une
  ligne reste stable d'un import à l'autre.
- `reduce_by_cache_day(records, tz)` : un résultat par cache et par jour local.
  - Priorité : `found` > `needs_maintenance` > `dnf` > `other` > `unattempted`. L'heure
    retenue est celle de la ligne gagnante.
  - `has_nm` : une ligne NM existe ce jour‑là. `needs_confirmation` : NM sans trouvaille
    (25 caches sur 30 dans le fichier réel).
  - Les commentaires non vides sont concaténés avec ` / `, sans doublons.
  - `passes` garde le détail (heure locale, libellé) pour l'infobulle « 4 passages ».
  - Les visites sans code ne sont jamais fusionnées.
  - Exemple réel : `GC4NKAY` le 2015‑05‑10 (Unattempted, Unattempted, DNF, Found) devient
    une trouvaille à 13:45 heure locale.

## 3. Mémoire des visites — table `gps_visit`

Modèle `GpsVisit` ([models.py](../backend/gc_backend/models.py)), créé par `create_all()`
au démarrage. Migration Alembic : `add_gps_visit_table` (après `add_trackable_tables`).

| Champ | Rôle |
|---|---|
| `raw_code` | Ce que le GPS a écrit, sans caractères de contrôle |
| `gc_code` | Code normalisé, ou `NULL` |
| `visited_at` | UTC naïf, comme le reste de la base |
| `status_raw`, `status` | Libellé du GPS, statut normalisé |
| `occurrence` | Rang parmi les doublons exacts |
| `comment` | Commentaire du GPS |
| `state` | `pending`, `logged`, `ignored` ou `history` |
| `resolved_gc_code`, `resolution_source` | Rattachement d'une visite sans code (lot 6) |
| `log_reference_code`, `nm_log_reference_code` | Logs envoyés (lots 4 et 5) |

Contrainte unique : `(raw_code, visited_at, status_raw, occurrence)`.
`effective_gc_code` vaut `gc_code`, sinon `resolved_gc_code`.

### 3.1 Règles — `services/gps_visit_store.py`

- **Import idempotent** : les clés déjà en base sont ignorées. Réimporter le même fichier
  n'ajoute rien.
- **Point de départ** (`AppConfig` `gps_visits.cutoff`) : tant qu'il n'est pas choisi,
  l'import renvoie `needs_cutoff: true`. Sans lui, des années de visites seraient proposées
  à loguer.
  - `apply_cutoff(since)` : `pending` avant minuit local de `since` → `history` ; `history`
    après → `pending`. Il est donc rappelable pour avancer ou reculer le point de départ.
    Les visites loguées ou ignorées gardent leur état.
  - Une visite nouvelle et antérieure au point de départ arrive directement en `history`
    (cas d'un second GPS).
- `history` ne se pose jamais à la main (`USER_SETTABLE_STATES`).
- **Liste groupée** (`list_grouped`) : réduction sur toutes les lignes hors historique, puis
  filtrage des groupes par état.
  - État d'un groupe : `pending` si une de ses lignes l'est, sinon `logged`, sinon
    `ignored`.
  - Les jours sont triés du plus récent au plus ancien, et limités à 90 par défaut
    (`truncated`).
  - Chaque cache est enrichie par une seule requête sur `Geocache` jointe à `Zone` : zones,
    nom, type, `found`, `found_date`. Dans `geocaches`, la plus récemment mise à jour vient
    en premier.
- Dernier import mémorisé dans `AppConfig` `gps_visits.last_import` (date, source, totaux).

## 4. API — `blueprints/gps_visits.py`

| Route | Rôle |
|---|---|
| `GET /api/gps-visits/detect` | Fichiers `Garmin\geocache_visits.txt` trouvés sur les lecteurs branchés : `{files: [{path, size, modified}]}` |
| `POST /api/gps-visits/import` | Multipart `visitsFile`, ou `{"path"}` venant de `detect`. Renvoie le bilan (`new`, `known`, `without_code`, `unreadable_count`, échantillon `unreadable`, `needs_cutoff`, `landmarks`) |
| `POST /api/gps-visits/cutoff` | `{"since": "AAAA-MM-JJ"}` → `{cutoff, to_history, to_pending}` |
| `GET /api/gps-visits` | `?state=pending,logged,ignored&from=&to=&max_days=` → `{days: [{day, entries}], truncated, counts, cutoff, last_import}` |
| `POST /api/gps-visits/state` | `{"ids": [...], "state": "pending|logged|ignored"}` |

Une entrée de `days[].entries` contient : `key`, `visit_ids`, `gc_code`, `raw_code`,
`resolved`, `day`, `time` (HH:MM local), `visited_at` (UTC), `status`, `status_raw`,
`proposed_log_type`, `has_nm`, `needs_confirmation`, `comment`, `raw_count`, `passes`,
`state`, `name`, `cache_type`, `geocaches`, `found`, `found_date`.

### 4.1 Détection du GPS

- Windows : `os.listdrives()`, en ne gardant que les lecteurs amovibles (2) et fixes (3)
  selon `GetDriveTypeW`. Un lecteur réseau déconnecté peut bloquer plusieurs secondes.
  Mesuré : 0,85 s sur la machine de l'utilisateur, GPS trouvé en `H:`.
- Autres OS : `/media/*/*`, `/media/*`, `/run/media/*/*`, `/Volumes/*`.
- Les Garmin récents en **MTP** n'ont pas de lettre de lecteur : la détection ne les voit
  pas, il faut glisser‑déposer le fichier.

### 4.2 Sécurité

- `import` par chemin n'accepte **que** un chemin renvoyé par `detect` au même moment
  (comparaison `normcase(abspath)`). Ce n'est pas un lecteur de fichier arbitraire.
- Taille bornée à 20 Mo (un fichier de 14 000 visites pèse 1,1 Mo).
- Un fichier sans aucune ligne lisible est refusé (`not_a_visits_file`).
- Le fichier réel de l'utilisateur n'est jamais committé ni utilisé comme fixture.

## 5. Tests

- `backend/tests/test_garmin_visits.py` : encodages, commentaire multiligne, guillemets
  doublés, codes vides ou abîmés, lignes illisibles, rangs des doublons, réduction
  `GC4NKAY`, NM à confirmer, `Unattempted` → `skip`, visites sans code jamais fusionnées,
  jour local d'une visite tardive.
- `backend/tests/test_gps_visits_api.py` : premier import et point de départ, réimport
  idempotent, liste groupée et enrichie, visite antérieure au point de départ, ignorer et
  restaurer, `history` refusé à la main, chemin hors `detect` refusé, fichier invalide.

## 6. Widget « Visites GPS » (frontend)

Extension `zones` :

| Fichier | Rôle |
|---|---|
| [gps-visits-model.ts](../frontend/theia-extensions/zones/src/browser/gps-visits-model.ts) | Types de l'API et règles d'affichage, sans React (testées) |
| [gps-visits-service.ts](../frontend/theia-extensions/zones/src/browser/gps-visits-service.ts) | Client de `/api/gps-visits`, sur `BackendApiClient` |
| [gps-visits-widget.tsx](../frontend/theia-extensions/zones/src/browser/gps-visits-widget.tsx) | Widget `geoapp-gps-visits-widget` |
| `style/gps-visits-widget.css` | Styles |

Ouverture : commande `geoapp.gpsVisits.open`, menu **Affichage → Vues → Visites GPS**,
ou la barre latérale (registre `geoapp-sidebar-views.ts`, gauche, rang 475, masquée par
défaut). Comme Trackables, le widget n'est pas en singleton Inversify : le
`WidgetManager` dédoublonne, et un widget fermé est recréé proprement.

### 6.1 En‑tête

- **Détecter le GPS** : appelle `detect`.
  - Aucun fichier : message qui invite au glisser‑déposer (cas des GPS en MTP).
  - Un fichier : import direct par chemin.
  - Plusieurs : un bouton par GPS.
- **Choisir le fichier…** et glisser‑déposer sur l'en‑tête : import en multipart.
- Ligne d'état : bilan du dernier import (`describeImportReport`).

### 6.2 Point de départ

Après un import qui renvoie `needs_cutoff`, un panneau propose :
- le dernier jour de visite ;
- 7 jours avant ;
- 30 jours avant ;
- une autre date.

« Changer le point de départ » (pied du widget) rouvre ce panneau, avec des repères
recalculés depuis `last_import.last_visit_day` (`buildCutoffLandmarks`, calcul en UTC pour
ne jamais perdre de jour au passage à l'heure d'été).

### 6.3 Liste

- Un bloc par jour, repliable, en‑tête collant, résumé « 12 trouvées · 1 non trouvée · 1 NM
  · 1 sans code » (`summarizeDay`).
- Une ligne par cache réduite : heure locale, statut, code (cliquable vers la fiche si la
  cache est dans l'App), nom, indicateur, « N passages » (détail en infobulle), commentaire
  du GPS.
- Indicateur (`describeCacheKnowledge`), par ordre de priorité :

  | Cas | Libellé |
  |---|---|
  | Pas de code | « Sans code » (infobulle : ce que le GPS a écrit) |
  | `found` avec `found_date` le jour de la visite | « Déjà loguée sur Geocaching.com » |
  | `found` un autre jour | « Déjà trouvée » |
  | Présente en base | « Zone X » (infobulle : toutes les zones) |
  | Absente | « À importer » |

- Actions :
  - par ligne : « Ignorer », ou « Remettre à loguer » pour une visite loguée ou ignorée ;
  - par jour : « Tout ignorer » ;
  - case « Afficher aussi les visites loguées et ignorées ».

Vérifié sur une copie de la base réelle, avec le GPS branché en `H:` :
- import de 14 629 visites en 1,0 s ;
- point de départ au 01/09/2026 : 46 visites du 27/09, toutes déjà présentes dans une
  zone ;
- réimport : 0 nouvelle visite, en 0,1 s.

Tests : `tests/gps-visits-model.test.ts`, inscrit dans `test:geoapp`.

## 7. Préparer les logs d'un jour

### 7.1 Backend

`POST /api/gps-visits/prepare {"day", "zone_id"?}` (`gps_visit_store.prepare_day`) renvoie
les caches `pending` du jour, dans l'ordre de visite, chacune avec `geocache_id` :

- la géocache de `zone_id` si la cache y est, sinon la plus récemment mise à jour ;
- `null` si la cache n'est pas en base : son code part dans `missing_codes`, sauf si elle
  n'a pas été tentée (`skipped_unattempted`, rien à importer pour rien) ;
- les visites sans code vont dans `without_code` et ne partent pas dans l'éditeur ;
- `last_zone_id` : dernière zone choisie (`AppConfig` `gps_visits.last_zone_id`).

`POST /api/gps-visits/import-missing {"zone_id", "gc_codes"}` importe en flux NDJSON, avec
les mêmes helpers que l'import d'une liste (`_progress_line`, `_bulk_import_summary`…) et
une pause de 0,2 s entre deux téléchargements.

> **Piège** : `GeocacheImporter.import_by_code` **déplace** dans la zone cible une cache qui
> existe déjà ailleurs (`_resolve_existing`). L'endpoint vérifie donc l'absence en base
> juste avant chaque import : une cache connue est comptée « déjà présente » et reste dans
> sa zone.

Une cache en échec (introuvable, délai dépassé) est signalée dans le flux (`error_item`)
sans bloquer les autres.

### 7.2 Frontend

« Préparer les logs », sur l'en‑tête d'un jour :

1. `prepare(day)`. Les visites sans code sont annoncées (« rattache‑les d'abord »).
2. S'il manque des caches : panneau de choix de zone (dernière zone présélectionnée, ou
   « Nouvelle zone… » nommée « Sortie du JJ/MM/AAAA »), puis import avec barre de
   progression et liste des erreurs. La lecture du flux est mise en commun dans
   [import-stream.ts](../frontend/theia-extensions/zones/src/browser/import-stream.ts),
   également utilisée par l'onglet d'une zone.
3. Nouvel appel à `prepare(day, zone_id)`, puis `buildLogEditorOpening` et ouverture de
   l'éditeur.

`buildLogEditorOpening` ([gps-visits-model.ts](../frontend/theia-extensions/zones/src/browser/gps-visits-model.ts))
produit :

- `geocacheIds` **dans l'ordre de visite** : c'est lui qui numérote `@cache_count` ;
- le titre « Log GPS — JJ/MM » ;
- `prefill` (`LogEditorPrefill`, [types.ts](../frontend/theia-extensions/zones/src/browser/log-editor/types.ts)) :
  `logDate`, `perCacheLogType` (type proposé) et `perCacheVisit` (`GpsVisitHint` : heure,
  libellé du GPS, commentaire, détail des passages, `hasNm`, `needsConfirmation`).

Un onglet par jour : l'éditeur n'a qu'une date par onglet.

### 7.3 Dans l'éditeur de logs

- `setContext` reçoit `prefill`. `initializeSession` appelle `applyPrefill()` **après**
  `loadGeocaches` et **avant** `restoreDraftIfAny` : un brouillon existant pour les mêmes
  caches l'emporte toujours.
- `applyPrefill` :
  - remplace la date de l'onglet par celle des visites et met `isLogDatePinned` à
    `false` pour cet onglet. La date épinglée enregistrée n'est pas touchée ;
  - applique les types proposés, assainis par `sanitizeLogTypeForGeocache` (une cache
    déjà trouvée passe en « Ne pas loguer »).
- Aide‑mémoire : badge « 📟 10:32 ⚠️ 💬 » dans la cellule du code de la table, ligne
  « 📟 10:32 — Found it — « Horse » » dans le bloc par cache. Infobulle commune :
  `describeGpsVisitHint` (helpers.ts). Le commentaire du GPS n'est **jamais** copié dans
  le texte du log.

Vérifié sur une copie de la base réelle : le 27/09/2026 donne 46 caches dans l'ordre de
visite, toutes déjà en base, avec 43 « trouvée », 2 « non trouvée » et 1 « ne pas loguer ».

## 8. Retour d'envoi

Le marquage se fait **côté backend**, dans `POST /api/geocaches/<id>/logs/submit`
([logs.py](../backend/gc_backend/blueprints/logs.py), `_mark_gps_visits_logged`). Il reste
juste même si l'onglet de log est fermé pendant l'envoi.

`gps_visit_store.mark_logged(gc_code, log_date, log_reference_code)` fait passer en
`logged` les visites `pending` :

- dont `gc_code` **ou** `resolved_gc_code` est celui de la cache ;
- dont le jour local est la date du log (bornes `local_midnight_utc`). Une visite à
  22h30Z en été appartient au lendemain et n'est pas touchée par un log daté de la veille.

| Cas | Effet |
|---|---|
| Log envoyé (`logReferenceCode`) | `logged`, avec la référence du log |
| Geocaching.com répond « déjà logué » | `logged`, sans référence |
| Refus local « déjà trouvée » avec `found_date` le jour du log | `logged`, sans référence |
| Refus local « déjà trouvée » un autre jour | rien |
| Cache en « Ne pas loguer » | rien (aucun appel) |

Best‑effort : une erreur est journalisée et annulée (`rollback`), elle ne remet jamais
en cause le log, qui est parti.

Frontend : le widget écoute l'événement existant `geoapp-geocache-log-submitted` (émis
par l'éditeur à chaque log réussi) et recharge 1 s après le dernier. Un jour entièrement
logué disparaît de la vue par défaut. Une visite indiquée « Déjà loguée sur
Geocaching.com » (`found` avec `found_date` le même jour) propose « Marquer comme
loguée ». Rien n'est automatique, car `found_date` peut dater d'une autre visite.

Tests : `backend/tests/test_gps_visits_log_submit.py`.
