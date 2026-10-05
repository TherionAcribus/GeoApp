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

> **Remplacé** par la préparation de la sortie (§ 12) : `POST /api/gps-visits/import-missing`
> n'existe plus, `prepare` prend une sélection de visites et la zone de la sortie.

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

## 9. Signaler un problème (Needs Maintenance / Needs Archived)

Valable pour **tous** les logs de l'éditeur, pas seulement ceux venus du GPS.

### 9.1 Référence c:geo

Vérifié dans les sources c:geo (`ReportProblemType`, `LogUtils.createLogTaskLogic`) : le
signalement est un **second log**, envoyé **après** le log principal et **seulement s'il a
réussi**, à la même date, avec un texte selon la catégorie.

| Catégorie | Type GC | Interdite avec | Cache virtuelle |
|---|---|---|---|
| `needsMaintenance` | 45 | — | oui |
| `logFull`, `logWet`, `damaged` | 45 | DNF | non |
| `missing` | 45 | Trouvée | oui |
| `other` | 45 | — | oui |
| `archive` | 7 | — | oui |

Vérifié en lecture seule le 2026‑10‑01 : la page `/live/geocache/GC7RK9H/log` annonce les
types `2, 3, 4, 45, 7`. Aucun signalement n'a été posté pour tester : un NM est public et
prévient le propriétaire.

### 9.2 Backend

- [log_problems.py](../backend/gc_backend/services/log_problems.py) : catégories,
  `validate_problem` (combinaisons interdites, catégories à contenant sur une cache
  virtuelle, webcam ou EarthCache).
- `POST /api/geocaches/<id>/logs/report-problem`
  `{category, text, date, main_log_type}` ([logs.py](../backend/gc_backend/blueprints/logs.py)) :
  - valide avant tout appel distant (400 `INVALID_PROBLEM`) ;
  - appelle `submit_geocache_log` avec le type 45 ou 7, sans photo, TB ni point favori ;
  - enregistre le log en base (`_store_submitted_log`, type « Needs Maintenance » /
    « Needs Archived ») ;
  - note la référence sur les visites GPS NM du jour (`nm_log_reference_code`) ;
  - en cas de coupure, renvoie `UNKNOWN_REMOTE_OUTCOME` ou
    `NETWORK_FAILED_BEFORE_RESPONSE`, comme l'envoi principal.
- `logs/submit` accepte aussi `needs_maintenance` (45) et `needs_archived` (7) comme
  `logType`, pour être complet. L'éditeur ne s'en sert pas.

### 9.3 Frontend

- [problem-report.ts](../frontend/theia-extensions/zones/src/browser/log-editor/problem-report.ts)
  (pur, testé) : catégories et textes français par défaut, `problemCategoryRefusal`,
  `validateProblemReports`, `describePendingProblems` (ligne du récapitulatif),
  `sanitizeProblemReports` (restauration), `submitProblemReport` (**un seul essai** :
  toute réponse perdue donne `uncertain`).
- [problem-reports-section.tsx](../frontend/theia-extensions/zones/src/browser/log-editor/problem-reports-section.tsx),
  sous le tableau :
  - ajout d'un signalement pour une cache ;
  - catégorie (les catégories incompatibles sont grisées, avec la raison) ;
  - texte modifiable ;
  - statut (« Envoyé », « Échec », « À vérifier ») ;
  - « Pas parti, renvoyer » pour un statut à vérifier, après contrôle sur la page de la
    cache ;
  - bloc « à confirmer » pour les types proposés par le GPS.
- Textes proposés : préférence `geoApp.logs.problemTexts` (objet catégorie → texte), sinon
  textes par défaut. Le texte suit la catégorie tant qu'il n'a pas été retouché.
- État du widget : `perCacheProblem`, `perCacheProblemStatus`, `perCacheProblemReference`,
  `perCacheProblemError`, `pendingTypeConfirmation`.

### 9.4 Envoi

1. Avant la confirmation :
   - refus tant qu'un type proposé par le GPS reste « à confirmer » (NM sans « Found
     it ») ;
   - refus si un signalement a un texte vide ou une catégorie incompatible.
2. Récapitulatif : « ⚠️ Signalements : 1 × Needs Maintenance — publics, le propriétaire est
   prévenu ». Si seuls des signalements partent, le bouton devient « Envoyer les
   signalements ».
3. Boucle :
   - pour chaque cache, le log principal part s'il le faut ;
   - le signalement part ensuite si le principal est `ok`, ou si la cache est en « Ne pas
     loguer » (signalement seul, ou « déjà logué » sur Geocaching.com) ;
   - un principal en échec bloque le signalement.
4. Fin de lot :
   - bilan « Signalements : 2 envoyés, 1 à vérifier… » ;
   - l'historique est écrit dès qu'un log ou un signalement est parti ;
   - le brouillon et l'onglet restent tant qu'un signalement est à envoyer ou à vérifier.

### 9.5 Reprise sans doublon

Le brouillon (`LogDraft.problems`, champ facultatif, toujours écrit même vide) garde les
signalements, leur statut et leur référence :
- un signalement `ok` ou `uncertain` n'est jamais renvoyé ;
- un signalement retiré ne revient pas depuis le pré‑remplissage GPS, puisque le brouillon
  passe après lui.

L'historique garde la même trace (`LogHistoryEntry.problems`), à titre informatif : elle
n'est jamais réappliquée à la navigation.

### 9.6 Venant du GPS

`applyPrefill` :
- pré‑coche `needsMaintenance` pour une cache dont le GPS a noté un NM (`hasNm`) ;
- met en « à confirmer » une cache NM sans « Found it » (`needsConfirmation`).

Changer le type de la cache, ou cliquer sur « C'est bien ça », lève la confirmation.

Tests :
- `backend/tests/test_log_report_problem.py` ;
- `frontend/.../tests/problem-report.test.ts` (inscrit dans `test:geoapp`).

## 10. Rattacher une visite sans code

[gps_visit_resolution.py](../backend/gc_backend/services/gps_visit_resolution.py). Rien
n'est rattaché automatiquement : l'App propose, l'utilisateur choisit ou saisit un code.

### 10.1 Ce que Geocaching.com donne (vérifié le 2026‑10‑01, en lecture seule)

| Source | Donne | Coût |
|---|---|---|
| Recherche web `fb=<moi>&sort=founddate` | Mes trouvailles **triées** par ma date de trouvaille, mais **sans** cette date (`lastFoundDate` = dernière trouvaille tous joueurs) | 1 requête toutes les ~6 s (client cadencé des amis) |
| Recherche web dans une boîte | Caches de la zone, avec `userFound` | idem |
| `/api/proxy/web/v1/geocache/{code}` | Coordonnées, nom, `callerSpecific.found` = **ma** date de trouvaille | ~0,2 s, hors cadence |

### 10.2 Recherche rapide (par défaut)

1. **Voisines** : la visite codée juste avant et juste après, le même jour, à moins de 90
   min. Elles sont situées par la base GeoApp, sinon par leur fiche JSON.
2. **Boîte d'environ 1 km** autour du point milieu. Les codes déjà connus du fichier GPS
   (lus ou rattachés) sont exclus.
3. **Ma date de trouvaille** des candidats trouvés par moi, au plus 30 fiches, les plus
   vraisemblables d'abord, 0,15 s entre deux :

   | Écart avec le jour de la visite | Classement |
   |---|---|
   | 0 jour | « confirmé » |
   | 1 à 3 jours (log saisi en différé) | « jour proche » |
   | plus | « autre jour » |

4. Sans candidat confirmé : **seconde boîte d'environ 3 km**. La cache visitée peut être
   loin d'une voisine notée une heure avant.

Classement final : confirmé, déduit le jour même, jour proche, déduit autour du jour, sans
date, autre jour. À égalité : trouvée par moi d'abord, puis la plus proche. Une cache
jamais trouvée reste proposée (une visite sans code peut être un DNF).

### 10.3 Recherche approfondie (`?deep=1`, ~1 min)

Placement par l'ordre de mes trouvailles :

- les caches que le GPS connaît (`Found it`) servent de repères de date ;
- `first_page_not_newer` trouve la page du jour par interpolation sur les dates, avec
  une bissection une fois sur trois ;
- une trouvaille absente du fichier, coincée entre deux repères du jour, est « déduite le
  jour même » ; à la frontière du jour, « autour du jour ».

Limites : ~10 000 trouvailles accessibles (`out_of_reach` au‑delà), caches archivées
absentes de l'index.

Caches mémoire (30 min) : pages de mes trouvailles, total et fiches JSON. Une journée
compte souvent des dizaines de visites sans code : la visite suivante répond presque
immédiatement.

### 10.4 Mesures sur le compte réel

| Visite | Résultat | Durée |
|---|---|---|
| 13/06/2021 10:45, deux voisines | 1er candidat confirmé à 129 m (série « 🎣 ») | 4,5 s |
| 27/02/2022, une voisine | confirmé à 1,7 km après élargissement | 19 s |
| 19/09/2023, une voisine | confirmé à 1,6 km après élargissement | 19 s |
| 23/10/2021, 78 visites sans code, aucune voisine | approfondie : trouvailles des 25‑26/10, « jour proche » | 55 s, puis 0,1 s |

### 10.5 API et interface

- `GET /api/gps-visits/<id>/candidates[?deep=1]` →
  `{neighbours, located, search_radius_m, finds_state, candidates, authenticated}`.
  Erreurs : 401 non connecté, 429 recherche limitée.
- `POST /api/gps-visits/<id>/resolve {"gc_code", "source"}` : `source` vaut
  `neighbours`, `my_finds` ou `manual`, et `gc_code: null` détache. Refusé pour une
  visite qui a un code lu sur le GPS.
- Une visite rattachée se comporte partout comme une visite codée (liste, préparation des
  logs, retour d'envoi), via `coalesce(gc_code, resolved_gc_code)`.
- Widget :
  - « Rattacher… » sur une visite sans code ouvre un panneau qui affiche les voisines
    utilisées, puis les candidats avec badge de date, distance et type, et un bouton
    « Choisir » ;
  - le panneau propose aussi la recherche approfondie et la saisie manuelle, et rappelle
    les limites (caches archivées, Adventure Labs) ;
  - une visite rattachée affiche 🔗 et un bouton « Détacher ».

Tests :
- `backend/tests/test_gps_visit_resolution.py` (faux client de recherche et fausses
  fiches) ;
- `tests/gps-visits-model.test.ts`.

## 11. Finitions

### 11.1 Pattern `@visit_time`

[pattern-resolver.ts](../frontend/theia-extensions/zones/src/browser/log-editor/pattern-resolver.ts) :
`PatternResolutionContext.perCacheVisitTime`, rempli par l'éditeur depuis le prefill GPS
(`perCacheVisit[id].time`).

- Valeur : « 10h32 » (`formatVisitTime`).
- Sans heure, `[visit_time]` : cas d'un texte commun sans cache précise, ou d'un onglet
  qui ne vient pas du GPS. Comme pour `[cache_name]`, le trou reste visible dans
  l'aperçu.
- `perCacheVisitTime` entre dans `getPatternResolutionSignature`. La référence est
  calculée une fois par onglet, dans `setContext`, pour ne pas invalider le cache de
  résolution à chaque frappe.
- Documenté au §9.2 de `docs/LOGS_SYSTEM_TECHNICAL.md`.

### 11.2 Détection au branchement

Tant que le widget est visible (`onAfterShow` / `onAfterHide`), `detect` est appelé
toutes les 10 s. Le premier passage sert de référence : un GPS déjà branché à l'ouverture
ne déclenche rien, et « Détecter le GPS » sert à ce cas. Un fichier qui apparaît déclenche
une notification « GPS détecté : H:\Garmin\geocache_visits.txt » avec le bouton
« Importer les visites ».

### 11.3 Fuseau horaire

Préférence `geoApp.gpsVisits.timezone` (texte, avancée, cible backend, catégorie Logs,
section « Visites GPS ») :
- vide : fuseau de l'OS ;
- sinon nom IANA (« America/Montreal »), via `zoneinfo` ;
- un nom invalide est journalisé et retombe sur le fuseau de l'OS.

`tzdata==2026.4` est ajouté à `requirements.txt` : sous Windows, `zoneinfo` n'a pas de
base de fuseaux sans lui. Point d'entrée unique : `gps_visit_store.get_local_tz()`.

Tests :
- `backend/tests/test_gps_visits_timezone.py` ;
- `tests/pattern-visit-time.test.ts`.

## 12. Préparer la sortie : sélection, zone, annulation

Spec : [garmin-visites-ameliorations-spec.md](garmin-visites-ameliorations-spec.md), lot 1.

### 12.1 Sélection

- Une case par cache **cochable** (`isSelectable` : à loguer, avec un code lu ou rattaché)
  et une case par jour, à trois états (`daySelectionState`).
- La sélection (`selection`, clés d'entrée) peut couvrir plusieurs jours. Après un
  rechargement, elle oublie les lignes disparues.
- Barre d'action : « N caches sur K jours — Préparer les logs · Ignorer · Vider la
  sélection ».
- Le bouton d'un jour coche ce jour puis ouvre la préparation. Il devient « Préparer /
  changer la zone » quand le jour a déjà une zone, affichée en badge 📁.

### 12.2 Récapitulatif — `POST /api/gps-visits/prepare`

Corps : `{"visit_ids": […] | "day": "AAAA-MM-JJ", "zone_id"?}` (`prepare_selection`).

Pour chaque cache retenue, le `plan` dans la zone :
- `existing` : déjà dans la zone ;
- `copy` : connue ailleurs, sera copiée ;
- `download` : absente de l'App.

Sont laissées de côté (`excluded`) :
- les visites sans code (`without_code`, à rattacher) ;
- les visites non tentées (`unattempted`).

La réponse donne aussi `counts` et `days`. `suggested_zone_id` est la zone déjà associée
à un de ces jours (`AppConfig` `gps_visits.day_zones`), sinon la dernière zone utilisée.

### 12.3 Ajout à la zone — `POST /api/gps-visits/zone-operations`

Corps : `{"operation_id", "zone_id" | "new_zone_name", "visit_ids" | "day"}`. Réponse en flux
NDJSON (lu par `consumeImportStream`, qui expose maintenant `finalPayload`).

- La nouvelle zone est créée **dans le flux**, pour que l'annulation puisse la retirer.
  Un nom déjà pris donne 409 `zone_exists`.
- Chaque cache passe par `zone_membership.add_to_zone` :

  | Cas | Action |
  |---|---|
  | Déjà dans la zone | `existing` |
  | Connue ailleurs | `copied`, via `copy_geocache_to_zone` (ligne, waypoints, checkers), désormais aussi utilisé par `POST /api/geocaches/<id>/copy` |
  | Absente | `created` par `import_by_code` |

  `import_by_code` n'est jamais appelé sur une cache connue, car il la **déplacerait**.
- Journal : tables `gps_zone_operation` (état `running`, `done`, `cancelled` ou
  `interrupted`, `zone_created`, jours) et `gps_zone_operation_item` (code, géocache,
  action). Migration `add_gps_zone_operation_tables`.
- Fin normale : le jour est associé à la zone, et la zone devient la dernière utilisée.
  La ligne finale porte `operation`.
- Un client parti en cours de flux laisse l'opération `interrupted`.

### 12.4 Annulation — `POST /api/gps-visits/zone-operations/<id>/cancel`

- **En cours** (`running`) : réponse 202. Un drapeau mémoire est lu **entre deux
  caches** ; le flux s'arrête, retire ce qui a été ajouté, et finit par
  `{"cancelled": true, "message"}`.
- **Terminé ou interrompu** : retrait immédiat.
  - Seules les lignes `copied` et `created` sont retirées, sans archivage : elles ne
    portent aucun travail que l'original n'aurait pas.
  - La zone est supprimée si l'ajout l'a créée et qu'elle est vide.
  - L'association jour → zone est oubliée.
  - Refus (409 `undo_refused`) si un log personnel a été envoyé depuis une de ces
    lignes.
- Dans le widget :
  - « Annuler » dans le panneau, pendant l'ajout ;
  - à la fin, une notification « … — Annuler l'ajout ».

### 12.5 Éditeur de logs et copies

- `buildLogEditorOpenings` ouvre **un onglet par jour**, avec les géocaches **de la zone de
  la sortie** (`target_geocache_id`), dans l'ordre de visite.
- Avec les copies, une cache vit dans plusieurs zones. `submit_geocache_log` :
  - marque la cache trouvée dans **toutes** ses lignes (`mark_found_everywhere`) ;
  - refuse un second « Found it » si une ligne du même code est déjà trouvée
    (`found_row`).

Vérifié sur une copie de la base réelle (27/09/2026) :
- 45 caches copiées dans « Sortie du 27/09/2026 » en 1,1 s ; la 46e, non tentée, est
  laissée de côté ;
- l'annulation retire les 45 copies et la zone ; chaque cache reste dans « Slovénie ».

Tests :
- `backend/tests/test_gps_zone_operations.py` ;
- `tests/gps-visits-model.test.ts`.

## 13. Lire tout le GPS : XML, traces, GPX des caches

Spec : [garmin-visites-ameliorations-spec.md](garmin-visites-ameliorations-spec.md), lot 2.

### 13.1 `geocache_logs.xml`

`parse_logs_xml` (`garmin_visits.py`) :
- **Octets de contrôle** : le GPS les écrit dans `<code>` (``…), ils sont interdits en
  XML. Ils sont retirés avant `ElementTree`, sinon : `not well-formed (invalid token)`.
- **Libellés** : `did not find` et `needs repair` sont ramenés aux libellés du TXT
  (`CANONICAL_STATUS_LABELS`).
- **Heure** : `visited_at` est la minute UTC, comme dans le TXT. Le décalage
  (`utc_offset_minutes`) et les secondes sont gardés à part.
- **Comparaison avec le TXT sur le GPS réel** : 14 625 visites contre 14 629, dont
  14 620 communes. 4 visites n'existent que dans le TXT, et une seule heure diffère d'une
  minute.
- **Fuseaux** : UTC+1 (4 350), UTC+2 (10 069), **UTC+4 (206, un voyage)**.

Le jour local d'une visite utilise **son** décalage (`offset_tz`), sinon la préférence de
fuseau, sinon le fuseau de l'OS. Les calculs par jour (point de départ, liste,
`pending_visit_ids_of_day`, `mark_logged`) lisent une fenêtre UTC élargie de ±14 h, puis
filtrent ligne par ligne.

`import_visits` **complète** une visite connue au lieu de la recréer : même code (lu ou
vide), même résultat, minute UTC à une minute près. Le rapport compte ces visites dans
`enriched`. Résultat sur le GPS réel : 14 625 lignes complétées, aucun doublon.

### 13.2 Traces → position des visites

- **Lecteur pur** `garmin_tracks.py` : `trkpt` lus par expressions régulières.
- **Position** (`position_at`) : interpolation entre les deux points qui encadrent la
  visite (≤ 5 min d'écart), sinon le point le plus proche à moins de 2 min.
- **Fichiers lus** : seules les archives commencées le jour même ou la veille
  (`files_for_days`, d'après leur nom), plus `Current.gpx`.
- **`gps_device.position_visits`** : renseigne `latitude`, `longitude` et
  `position_source` (`track`, ou `no_track` pour ne pas réessayer), et enregistre le
  tracé du jour (`gps_track_day` : Douglas‑Peucker à 10 m, distance, début, fin).

Mesures sur le GPS réel :

| Jour | Résultat | Durée | Tracé |
|---|---|---|---|
| 27/09/2026 | 46 visites sur 46 positionnées | 0,4 s | 506 points, 140 km (trajets en voiture compris) |
| 13/06 et 23/10/2021 | 110 visites positionnées, dont les **78 visites sans code** du 23/10 | 0,2 s | — |

### 13.3 Caches des GPX du GPS

- Les **Pocket Queries** chargées sur le GPS sont les fichiers `GPX/<n>.gpx`, hors
  `-wpts`, `Waypoints_*` et traces.
- **Index léger** (`light_index`, par expressions régulières) dans `gps_device_cache` :
  code, nom, type, coordonnées, fichier, date du fichier. Seuls les fichiers dont la date
  de modification a changé sont relus (`AppConfig` `gps_visits.device_gpx_mtimes`).
  Mesure : 19 fichiers, 9 989 caches, 30 s à la première lecture sur la clé USB, 0,3 s
  ensuite.
- Une entrée de liste absente de l'App porte `device` (nom, type, date du GPX) : le
  widget affiche « Sur le GPS » et le nom de la cache.
- **Ajout à la zone** : le plan `gps` crée la cache depuis le GPX
  (`scraped_from_device` → `import_from_scraped`), avec les waypoints du `-wpts.gpx`,
  **sans réseau**. Le dernier fichier analysé reste en mémoire. Le téléchargement reste le
  repli.

### 13.4 API

| Route | Changement |
|---|---|
| `GET /api/gps-visits/detect` | `devices` : `root`, `visits_file`, `has_logs_xml`, `has_visits_txt`, `tracks_count`, `gpx_count` (`files` reste pour compatibilité) |
| `POST /api/gps-visits/import` | `{"device": root}` lit visites (XML puis TXT), GPX et traces ; multipart `files` pour un GPS en MTP (les GPX de caches déposés sont gardés dans `data/gps_device_gpx`) ; `{"path"}` reste accepté. Rapport : `enriched`, `device` (`gpx_indexed`, `positioned`, `no_track`, `positioning`). |
| `POST /api/gps-visits/position` | `{"days"?: [...]}`, sur le GPS du dernier import (409 `device_not_connected` s'il est débranché) |
| `GET /api/gps-visits/tracks?days=` | Tracés enregistrés |

Pour ne pas lire 14 ans de traces au premier import, le positionnement attend le point
de départ (`positioning: after_cutoff`). Le widget le lance juste après.

### 13.5 Interface

- « Détecter le GPS » importe tout le dossier `Garmin`. Avec plusieurs GPS branchés, un
  bouton par GPS, avec le nombre de traces et de GPX.
- Le choix de fichiers et le dépôt acceptent plusieurs fichiers `.xml`, `.txt` et
  `.gpx`.
- 📍 marque une visite positionnée sur la trace.
- Le récapitulatif annonce « 📟 N caches créées depuis les GPX du GPS ».

Tests :
- `backend/tests/test_gps_device.py` (faux dossier Garmin) ;
- `tests/gps-visits-model.test.ts`.

## 14. Carte des visites GPS

Spec : [garmin-visites-ameliorations-spec.md](garmin-visites-ameliorations-spec.md), lot 3.

### 14.1 Une carte comme les autres

- Nouveau contexte `gps-visits` de `MapWidget`, identifiant fixe
  `MapWidget.GPS_VISITS_ID` (`geoapp-map-gps-visits`), libellé « Carte des visites GPS ».
- `MapWidgetFactory.openGpsVisitsMap(points, tracés)` l'ouvre dans le **panneau des
  cartes** (bas), comme la carte des amis. L'utilisateur peut la déplacer.
- `findGpsVisitsMap()` permet de la recharger en place sans voler le focus.
- Le gestionnaire de cartes l'affiche avec le type « Visites GPS ».
- Adaptations de la carte :
  - `MapGeocache` gagne `badgeText` et `badgeColor` (pastille dessinée par
    `createGeocacheStyleFromSprite`, en haut à droite de l'icône), `popupNote` (ligne
    📟 de la popup) et `openGeocacheId` ;
  - `MapLayerManager.setTrackLines` gère une couche de tracés, en pointillés bleus
    sous les géocaches ; `MapView` reçoit `trackLines` ;
  - sur cette carte : sélection depuis la carte autorisée (comme pour une carte de zone),
    ni voisines ni « Importer autour », car les points sont des visites.

### 14.2 Contenu (`buildMapPoints`, `mapDays`)

- **Jours affichés** : ceux qui contiennent la sélection, sinon les jours dépliés.
- **Un point par entrée** :
  - identifiant : celui de la **première visite** (unique), qui sert aussi de clé à la
    sélection ;
  - pastille numérotée **par jour** dans l'ordre de visite, colorée selon le résultat
    (`GPS_STATUS_COLORS`) ; une visite sans code porte « N? » en violet ;
  - une visite loguée ou ignorée est estompée (`found`).
- **Position**, renvoyée par le backend dans `map_position` : la géocache de l'App
  (`app`), sinon les GPX du GPS (`gps`), sinon la visite sur la trace (`visit`). Une
  entrée sans position n'est pas placée, mais garde son numéro.
- **Popup** : « 27/09 11:45 — Trouvée — « Horse » ». « Ouvrir la cache » ouvre la
  géocache GeoApp (`openGeocacheId`) ; sinon un message explique qu'elle n'est pas
  encore dans l'App.
- **Tracés** : `GET /api/gps-visits/tracks`, gardés en mémoire par jour.

### 14.3 Sélection partagée

- Cocher dans la liste trace l'anneau sur la carte (`setSelectedGeocaches`, ids des
  points).
- Ctrl+clic ou menu contextuel sur la carte → `MapService.requestListSelection` avec
  l'identifiant de la carte des visites. Le widget l'écoute et coche ou décoche. Le
  tableau d'une zone ignore ces demandes : il filtre sur l'identifiant de sa carte.
- Un clic sur l'heure d'une ligne recentre la carte et met le point en évidence
  (`MapService.selectGeocache` avec `mapId`). La carte s'ouvre au besoin.
- La carte suit les rechargements, la sélection et le dépliage des jours.

Tests : `tests/gps-visits-model.test.ts` (`buildMapPoints`, `mapDays`).

## 15. Rattacher par la trace

Spec : [garmin-visites-ameliorations-spec.md](garmin-visites-ameliorations-spec.md), lot 4.

### 15.1 Une visite (`find_candidates`)

- **Position d'abord** : une visite placée sur la trace (§ 13.2) est cherchée autour de
  **sa** position, dans une boîte d'environ 300 m, puis 1 km si rien n'est confirmé
  (`POSITION_BOX_MARGINS`). La seconde boîte sert pour une mystery dont les coordonnées
  publiées sont loin de la boîte.
- **Repli** : sans position, la recherche se fait comme au § 10 (milieu des voisines,
  1 km puis 3 km).
- **Distances** : depuis la position de la visite.
- **Réponse** : `position_source` (`track` ou `neighbours`) et `position`. Les
  candidats ont leurs coordonnées et la source `track`, qui est enregistrée comme
  `resolution_source` au rattachement.
- `GET /<id>/candidates` positionne d'abord la visite si le GPS est branché et qu'elle
  n'a pas encore été cherchée sur les traces (`_position_if_possible`, 0,2 s par jour).

### 15.2 Une journée (`resolve_day`)

`POST /api/gps-visits/day-resolution {day}` ne rattache rien. Il propose seulement :

1. **Recherche** : les positions du jour sont groupées à moins d'1 km
   (`zone_boxes_from_coordinates`, marge ~400 m), avec **une** recherche paginée par
   groupe (`search_box`, 10 pages au plus). Une recherche par visite coûterait 6 s
   chacune, à cause de la limite de Geocaching.com.
2. **Confirmation** : la date de trouvaille de chaque cache trouvée par moi est lue sur
   sa fiche (`callerSpecific.found`, 150 fiches au plus, en cache).
3. **Attribution**, dans l'ordre horaire :
   - la cache confirmée (ce jour-là ou à quelques jours près) la plus proche, à moins de
     1 500 m ;
   - sinon une cache trouvée par moi à moins de 150 m ;
   - **jamais deux fois la même cache** dans la journée.
4. **Réponse** : pour chaque visite, `proposal` et jusqu'à 5 `alternatives` (avec
   distance), plus `boxes`, `candidates` et `unpositioned` (visites sans trace).

`POST /resolve-batch {items: [{visit_id, gc_code, source}]}` valide les choix en un appel.

Mesures sur le GPS réel (base copiée, lecture seule sur le site) :

| Jour | Visites sans code | Proposées « trouvée ce jour-là » | Durée |
|---|---|---|---|
| 13/06/2021 | 18 | 17, à 8–25 m de la visite | 8 s |
| 23/10/2021 | 78 | 50, aucun doublon | 26 s |

Les 28 autres visites du 23/10 n'ont pas de proposition « trouvée ce jour-là » et se
traitent une par une. Rappel : les Adventure Labs et les caches archivées n'apparaissent
pas dans la recherche.

### 15.3 Interface

- **Ligne de jour** : « 🔗 Rattacher N sans code » ouvre le panneau du jour
  (`gps-day-resolution.tsx`). Le panneau propose une liste déroulante par visite :
  ★ proposition, alternatives, « — ne pas rattacher — ».
- **Choix cochés d'office** (`defaultDayChoices`) : seulement les propositions trouvées
  ce jour-là ou à quelques jours près. Une cache trouvée un autre jour attend un choix
  explicite.
- **Bilan** (`summarizeDayResolution`) : « N trouvées ce jour-là · N à vérifier ·
  N sans proposition ».
- **Panneau d'une visite** :
  - les candidats portent une lettre (A, B…) ;
  - « 🗺️ Voir sur la carte » charge dans la carte des visites la position de la visite
    (« ? », violet) et les candidats lettrés, colorés selon leur jour de trouvaille
    (`buildResolutionPoints`, `candidateColor`, identifiants négatifs) ;
  - un Ctrl+clic sur un candidat le **pointe** : la ligne est mise en évidence et
    l'anneau s'affiche sur la carte. « Choisir » confirme.
  - Fermer le panneau remet la carte des visites.

Tests :
- backend : `tests/test_gps_visit_resolution.py` (recherche autour de la position,
  attribution sans doublon, groupes de positions) ;
- frontend : `tests/gps-visits-model.test.ts` (`testDayResolution`).

## 16. Annulations immédiates et « déjà loguée » fiable

Spec : [garmin-visites-ameliorations-spec.md](garmin-visites-ameliorations-spec.md), lot 5.

### 16.1 Annuler une action de la liste

- **Ce que renvoient les routes** :
  - `POST /state`, `/<id>/resolve` et `/resolve-batch` renvoient `previous` : l'état,
    le code rattaché et la source de chaque visite **avant** l'action
    (`gps_visit_store.snapshot`). Pour `/state`, seules les visites réellement changées
    y figurent.
  - `POST /cutoff` renvoie `previous_cutoff` (nul : aucun point de départ).
- **`POST /restore`** :
  - `{items}` remet ces trois champs et rien d'autre ;
  - une visite au code lu sur le GPS n'est jamais rattachée ;
  - `{cutoff: "AAAA-MM-JJ"}` réapplique l'ancien point de départ ;
  - `{cutoff: null}` annule le tout premier : l'historique redevient à loguer, et le
    widget redemande un point de départ.
- **Bandeau** sous l'en-tête du widget (`showNotice`, `offerListUndo`) : « 12 visites
  ignorées. [Annuler] ».
  - Il est remplacé par l'action suivante et disparaît au bout d'une minute.
  - Pas de notification Theia : avec une action, elle reste affichée jusqu'à sa
    fermeture, et elles s'empileraient.
  - Un log envoyé depuis l'éditeur retire le bandeau : « Annuler » remettrait à loguer
    une visite que le log vient de régler.
- **Actions concernées** :
  - Ignorer, Marquer loguée, Remettre à loguer (ligne, jour ou sélection) ;
  - Rattacher, Détacher, rattachement d'une journée ;
  - changement du point de départ.

### 16.2 « Vérifier sur Geocaching.com »

- **Service** `services/my_found_dates.py` : la fiche JSON de la cache porte
  `callerSpecific.found`, la date de **ma** trouvaille.
  - `sheet_lookup` lit la fiche (déplacé du blueprint) ;
  - `check_codes` lit des fiches **fraîches** (0,15 s entre deux, 150 au plus), puis
    les range dans le cache du rattachement (`remember_sheet`).
- **Route `POST /check-found {visit_ids | day}`** :
  - seules les caches à loguer qui ont un code sont lues ;
  - 401 sans session Geocaching.com : sans elle, la fiche ne dit rien de mes
    trouvailles ;
  - réponse : `same_day` (trouvée le jour de la visite, donc déjà loguée), `other_day`,
    `not_found`, `unknown` (fiche illisible), `skipped` (au-delà de 150).
- **Ce qui est gardé** :
  - sur les visites, colonnes `remote_found_on` et `remote_checked_at`
    (`record_remote_check`, migration `add_gps_visit_remote_check`) ;
  - les géocaches de l'App qui n'étaient pas trouvées le deviennent, dans toutes les
    zones.
  - `entry_dict` prend la date de l'App, sinon celle du site : le badge « Déjà loguée sur
    Geocaching.com » vaut aussi pour une cache absente de l'App.
  - Une cache vérifiée mais pas trouvée le dit dans l'infobulle de son indicateur
    (`remoteCheckNote`).
- **Widget** : « 🌐 Vérifier » sur chaque jour et dans la barre de sélection.
  - Le bilan reste affiché jusqu'à sa fermeture (`describeFoundCheck`).
  - « Marquer loguées (N) » sort les caches déjà loguées le jour même ; cette action
    s'annule comme les autres.
- **Limite** : un DNF ou une note déjà postés ne se voient pas sur la fiche. L'infobulle
  du bouton le dit.

### 16.3 Avant l'envoi d'un « Found it »

- `logs/submit` refusait déjà un second log de trouvaille (409 `ALREADY_LOGGED`) quand la
  base locale savait la cache trouvée.
- **Nouveau** : si elle l'ignore, il lit ma date de trouvaille sur la fiche
  (`my_found_dates.remote_found_date`, 5 s au plus).
  - **Trouvée** : la cache est marquée trouvée dans toutes ses zones, les visites GPS du
    jour sont réglées, et l'envoi répond 409 `ALREADY_LOGGED` **sans rien poster**.
    L'éditeur gère déjà cette réponse.
  - **Pas de session, réseau ou fiche illisible** : l'envoi se fait comme avant. La
    vérification ne bloque jamais un log.
- Seuls les types de trouvaille (Found it, Attended, Webcam) sont vérifiés.
- **Tests** : `tests/conftest.py` remplace `remote_found_date` pour tous les tests, aucun
  test ne contacte le site. `test_gps_visits_log_submit.py` vérifie qu'une trouvaille
  connue du seul site n'est pas postée une seconde fois, et qu'un DNF n'est pas vérifié.

### 16.4 Mesures (copie de la base, lecture seule sur le site)

| Jour | Caches vérifiées | Résultat | Durée |
|---|---|---|---|
| 13/06/2021 | 12 | 9 déjà loguées le jour même, 3 pas trouvées | 4,9 s |
| 27/09/2026 | 46 | 1 déjà loguée le jour même (GC9CGW6), 45 pas encore trouvées | 20,3 s |

- « Marquer loguées » puis « Annuler » remet les visites à l'identique.
- La vérification avant envoi répond en 0,25 s.

Tests :
- backend : `tests/test_gps_visits_undo.py` et `tests/test_gps_visits_log_submit.py` ;
- frontend : `tests/gps-visits-model.test.ts` (`testUndoAndFoundCheck`).

## 17. Confort : résumé du jour, reprise, filtres

Spec : [garmin-visites-ameliorations-spec.md](garmin-visites-ameliorations-spec.md), lot 6.

### 17.1 Résumé du jour

- **Backend** : chaque jour de `GET /api/gps-visits` porte `track` (`_track_summaries`,
  une requête pour tous les jours). Il contient `start` et `end` en heure locale (fuseau
  de la première visite du jour), `minutes` et `distance_m`. Il est nul sans trace.
- **Frontend** : `summarizeDayTimes` affiche « 🕘 08:55 → 18:03 · 9 h 08 · 42,3 km ».
  - La trace couvre toute la sortie, trajets en voiture compris (l'infobulle le dit).
  - Sans trace : de la première à la dernière visite, passages compris.
- **Mesures** (copie de la base) :
  - 27/09/2026 : 09:58 → 21:51, 11 h 52, 139,7 km ;
  - 23/10/2021 : 08:18 → 19:57, 27,2 km ;
  - liste de 4 jours en 0,05 s.

### 17.2 « Reprendre les logs »

- **Mémoire** : à l'ouverture des onglets de log, le widget garde par jour les
  géocaches, le titre et le pré-remplissage (`GpsLogOpening`). Clé `StorageService` :
  `geoApp.gpsVisits.logOpenings.v1`. Les ouvertures sont oubliées après 90 jours
  (`pruneLogOpenings`), comme les brouillons.
- **Quand le bouton apparaît** : « ↩️ Reprendre les logs » s'affiche sur un jour si :
  - un onglet de log est ouvert sur exactement ces géocaches
    (`GeocacheLogEditorTabsManager.findLogEditor`, comparaison par `getDraftKey`) ;
  - ou si l'éditeur a un brouillon sous la clé de ces géocaches (`LOG_DRAFTS_STORAGE_KEY`,
    désormais exportée par `log-history-store.ts`).
- **Clic** (`resumeLogEditor`) : revient à l'onglet ouvert, sinon rouvre l'éditeur.
  - Le pré-remplissage remet les repères GPS (heure, commentaire).
  - Le brouillon l'emporte sur le reste, comme à toute ouverture.
- **Mise à jour du bouton** : à chaque rechargement, et à l'ouverture ou à la
  fermeture d'un onglet de log (`onDidChangeLogEditors` du gestionnaire d'onglets,
  branché sur `ApplicationShell.onDidAddWidget` et `onDidRemoveWidget`).

### 17.3 Recherche et filtres

- **Barre au-dessus des jours** : `GeocacheFilterBar` partagée — même syntaxe que
  le tableau des géocaches (texte libre insensible casse/accents, joker `*`,
  tokens `@champ:valeur` avec autocomplétion, panneau « Filtres supplémentaires »,
  presets).
- **Texte libre** : code, code lu, nom (y compris celui des GPX du GPS),
  commentaire, heure de la visite et de ses passages, jour (ISO et libellé),
  résultat brut et traduit, type.
- **Champs filtrables** (`GPS_VISIT_FIELD_DEFINITIONS`, alias dans
  `GPS_VISIT_FIELD_ALIASES`) : `@code:`, `@nom:`, `@heure:` (opérandes `14`,
  `14h30`, `14:30` — « 14 » couvre l'heure entière, comparaison sur tous les
  passages), `@statut:` (found, dnf, unattempted, needs_maintenance, other —
  alias français : `trouvée`, `non_tentée`, `maintenance`…), `@etat:`
  (pending, logged, ignored), `@type:`, `@zone:`, `@jour:` (préfixe ISO),
  `@commentaire:`, et les booléens `@sans_code:`, `@a_importer:`, `@rattachée:`,
  `@nm:`, `@positionnée:`.
- `filterDays` retire les jours vides et compte les lignes masquées, avec « Effacer ».
- **Portée** : la liste, la carte et les boutons d'un jour portent sur les lignes
  affichées. Le résumé du jour reste celui du jour entier.

### 17.4 Repli par défaut

Un jour sans rien à loguer est replié par défaut (`isDayProcessed`, visible avec
« afficher ignorées / loguées »). Le choix de l'utilisateur l'emporte
(`collapsedDayKeys`, `dayCollapse`).

Tests :
- backend : `tests/test_gps_visits_api.py` (`test_each_day_carries_its_track_summary`) ;
- frontend : `tests/gps-visits-model.test.ts` (`testComfort`).
