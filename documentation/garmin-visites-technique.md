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
