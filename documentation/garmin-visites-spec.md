# Visites GPS Garmin — spec de mise en œuvre

Plan du 2026-10-01. Permet de loguer une sortie à partir du fichier `geocache_visits.txt`
que les GPS Garmin écrivent à chaque visite de cache. Il ajoute aussi le signalement
« Needs Maintenance » / « Needs Archived » à l'éditeur de logs. À implémenter lot par lot ;
la doc technique `garmin-visites-technique.md` est écrite au fil des livraisons.

## Contexte

Sur le terrain, le GPS enregistre une ligne par visite : le code GC, l'heure, le résultat
(trouvée, non trouvée…) et un éventuel commentaire tapé sur l'appareil. Aujourd'hui, pour
loguer sa journée, il faut retrouver à la main les caches visitées, les ajouter à une zone,
puis les sélectionner une par une dans l'éditeur de logs.

Objectif : brancher le GPS (ou déposer le fichier), voir les visites pas encore loguées,
regroupées par jour, puis ouvrir l'éditeur de logs pré‑rempli. Celui‑ci reçoit les caches
dans l'ordre de visite, la date, le type de log par cache et le commentaire du GPS en
aide‑mémoire.

Périmètre validé avec l'utilisateur :
- le **Needs Maintenance** est géré de bout en bout, jusqu'à l'envoi sur Geocaching.com ;
- la **zone** qui reçoit les caches manquantes est **choisie par l'utilisateur** ;
- les **visites sans code** sont **rattachées si possible**, toujours avec la confirmation
  de l'utilisateur.

Organisation : même principe que les chantiers précédents. Cette spec est implémentée lot
par lot ; chaque lot livré est marqué « — livré le AAAA-MM-JJ » dans son titre.

---

## Le fichier : ce qu'on a constaté sur un fichier réel

Analyse du fichier de l'utilisateur (`geocache_visits.txt`, à la racine du dépôt, **non
versionné** : ne pas le committer, il sert d'exemple réel pour les tests manuels).

| Point | Constat | Conséquence |
|---|---|---|
| Encodage | UTF‑16 LE **sans BOM**, fins de ligne CRLF | Détecter UTF‑16 (BOM ou octets nuls alternés), avec repli UTF‑8 pour les autres modèles. |
| Format | CSV à 4 colonnes : `code,AAAA-MM-JJTHH:MMZ,statut,"commentaire"` | Utiliser le module `csv`, pas un `split(',')`. |
| Commentaire | Entre guillemets, **peut contenir des retours à la ligne**. 10 lignes non vides sur 14 629 (« Horse », « 1 », « MMM »…) | C'est un pense‑bête tapé au clavier du GPS : on l'affiche, on ne s'en sert pas comme texte de log. |
| Volume | 14 629 visites, de 2012‑11‑30 à 2026‑09‑27 : **le fichier n'est jamais vidé** | Il faut se souvenir de ce qui a déjà été traité (table `gps_visit`). |
| Ordre | Déjà trié par date | Ne pas en dépendre : trier à la lecture. |
| Statuts | `Found it` 13 440, `Didn't find it` 1 095, `Unattempted` 64, `Needs Maintenance` 30 (+ 5 lignes vides, issues du commentaire multiligne) | D'autres modèles écrivent d'autres libellés (`Write note`…) : statut inconnu → `other`, conservé tel quel, jamais une erreur. |
| Codes vides | **367** visites sans code, surtout de 2021 à 2023 | Lot 6 (rattachement). |
| Codes abîmés | `8`, `C`, `#`, et des codes précédés d'un caractère invisible | Nettoyer les blancs et caractères invisibles, mettre en majuscules. Ce qui ne correspond pas à `^GC[0-9A-Z]+$` devient une visite **sans code**, avec le texte brut conservé. |
| Doublons | 324 codes apparaissent plusieurs fois. Ex. `GC4NKAY` le 2015‑05‑10 : Unattempted 11:38, Unattempted 11:39, DNF 11:42, Found 11:45 | Garder toutes les lignes, mais **réduire à un résultat par cache et par jour** pour préparer les logs (voir plus bas). |
| Fuseau | Le suffixe `Z` est **vrai** : les heures sont en UTC. Preuve statistique : le début de journée est ~1 h plus tôt en été qu'en hiver (5e centile 7h45 contre 8h43), ce qui correspond au décalage UTC+2 / UTC+1 | Convertir en heure locale pour trouver la **date du log**. Fuseau de l'OS par défaut ; préférence au lot 7 si besoin. |

Correspondance des statuts :

| Statut Garmin | `status` | Type de log proposé |
|---|---|---|
| `Found it` | `found` | `found` |
| `Didn't find it` | `dnf` | `dnf` |
| `Unattempted` | `unattempted` | `skip` (la cache reste visible mais n'est pas envoyée) |
| `Needs Maintenance` | `needs_maintenance` | `found` + signalement NM pré‑coché, marqué « à confirmer » (voir le lot 5) |
| autre | `other` | `note` |

**Réduction par cache et par jour** : quand une cache a plusieurs lignes le même jour (en
heure locale), l'ordre de priorité est `found` > `needs_maintenance` > `dnf` > `other` >
`unattempted`. L'heure retenue est celle de la ligne gagnante ; si une ligne NM existe ce
jour‑là, le signalement est pré‑coché même quand `found` gagne. Les commentaires non vides
de toutes les lignes du jour sont concaténés.

Sur ce fichier : 5 des 30 caches NM ont aussi une ligne `Found it`. Les 25 autres n'ont que
NM : sur le Garmin, choisir NM remplace probablement le résultat de la visite. D'où le
`found` « à confirmer » plutôt qu'un choix silencieux.

---

## Référence c:geo pour le signalement de problème

Vérifié dans les sources c:geo (`ReportProblemType.java`, `LogUtils.createLogTaskLogic`) :

- le signalement est un **second log** distinct du log principal ;
- il est envoyé **après** le log principal, et **seulement si celui‑ci a réussi** ;
- il porte la **même date** que le log principal, et un texte fixe selon la catégorie ;
- son type est **45 (Needs Maintenance)**, ou **7 (Needs Archived)** pour « à archiver ».

| Catégorie (`code` c:geo) | Type | Texte c:geo | Interdit avec |
|---|---|---|---|
| `needsMaintenance` | 45 | This geocacher reported that there is a problem with this cache. | — |
| `logFull` | 45 | This geocacher reported that the logbook is full. | DNF |
| `logWet` | 45 | This geocacher reported that the logbook is wet. | DNF |
| `damaged` | 45 | This geocacher reported that the container is damaged. | DNF |
| `missing` | 45 | This geocacher reported that the cache might be missing. | Found, Webcam |
| `other` | 45 | This geocacher reported that there is a problem with this cache. | — |
| `archive` | 7 | This geocacher reported that this geocache should be archived. A community volunteer reviewer has been notified. | — |

Les catégories `logFull`, `logWet` et `damaged` ne sont pas proposées pour une cache virtuelle.

**À vérifier en réel au lot 5, sans jamais créer de faux signalement** : un NM est public
et notifie le propriétaire, aucun test ne doit donc en poster pour voir. Deux vérifications
sans effet de bord :
1. ~~lire le `__NEXT_DATA__` de `/live/geocache/{GC}/log` (déjà exploité pour les TBs) pour
   confirmer que 45 et 7 figurent dans les types de log autorisés~~ **Fait le 2026-10-01** :
   `GC7RK9H` annonce `"logTypes":[{"value":2},{"value":3},{"value":4},{"value":45},{"value":7}]` ;
2. au prochain vrai signalement de l'utilisateur, faire l'envoi depuis l'App, puis
   contrôler le log obtenu sur la page de la cache.

Le payload tRPC `web.logs.createGeocacheLog` est le même que pour un log normal, avec
`logType` à 45 ou 7.

---

## Lots

### Lot 1 : lecture du fichier et mémoire des visites (backend) — livré le 2026-10-01

- **Lecteur pur** `backend/gc_backend/services/garmin_visits.py` : aucune dépendance à
  Flask, à SQLAlchemy ni au réseau.
  - `parse_visits(data: bytes) -> list[RawVisit]` : `RawVisit` porte `raw_code`, `gc_code`
    (normalisé, ou `None` si invalide), `visited_at` (datetime UTC avec fuseau),
    `status_raw`, `status`, `comment` et `line_no`.
  - Les lignes illisibles (date invalide, colonnes manquantes) sont **comptées et
    renvoyées** dans un rapport, jamais ignorées sans rien dire.
  - `reduce_by_cache_day(visits, tz)` applique la réduction décrite plus haut. Elle renvoie
    pour chaque groupe le jour local, le statut gagnant, l'heure, le drapeau NM et les
    commentaires concaténés.
- **Table `gps_visit`**, créée par le même mécanisme que la table `trackable` :
  - champs : `id`, `raw_code`, `gc_code` (nullable), `visited_at` (UTC), `status_raw`,
    `status`, `comment`, `state`, `resolved_gc_code`, `resolution_source`,
    `log_reference_code`, `nm_log_reference_code`, `imported_at`, `updated_at` ;
  - clé d'unicité : `(raw_code, visited_at, status_raw, occurrence)`, pour qu'un réimport
    du même fichier n'ajoute rien. `occurrence` est le rang d'une ligne parmi ses doublons
    exacts : le fichier réel contient deux visites sans code à la même minute
    (2020‑08‑16 09:52), qui seraient sinon fusionnées ;
  - `state` ∈ `pending` (à loguer), `logged`, `ignored`, `history` (antérieure au point de
    départ choisi).
- **Endpoints** dans un nouveau blueprint `blueprints/gps_visits.py` :
  - `GET /api/gps-visits/detect` : cherche `<lecteur>:\Garmin\geocache_visits.txt` sur les
    lecteurs présents (Windows : `os.listdrives()`, seulement les lecteurs amovibles et
    fixes, pour ne pas bloquer sur un lecteur réseau déconnecté ; autres OS : `/media`,
    `/Volumes`). Les Garmin récents en MTP n'ont pas de lettre de lecteur : pour eux, le
    glisser‑déposer.
    Renvoie les chemins trouvés avec la taille et la date de modification. Le backend tourne
    sur la machine de l'utilisateur, il a accès aux lecteurs.
  - `POST /api/gps-visits/import` : reçoit soit un fichier (multipart), soit
    `{"path": "<chemin renvoyé par detect>"}`. Le chemin doit faire partie de ce que
    `detect` trouve au même moment : aucun chemin arbitraire. Insère les nouvelles visites et
    renvoie le bilan : nouvelles, déjà connues, sans code, illisibles.
  - **Premier import** : tant qu'aucun point de départ n'a été choisi, l'import renvoie
    `needs_cutoff: true` avec la date de la dernière visite et des repères (début de la
    dernière semaine, du dernier mois). Le frontend demande alors le point de départ, puis
    appelle `POST /api/gps-visits/cutoff {"since": "AAAA-MM-JJ"}` : tout ce qui précède
    passe en `history` d'un coup.
  - `GET /api/gps-visits?state=pending&from=&to=` : visites groupées par jour local, déjà
    réduites. Chaque cache est enrichie de ce que la base sait d'elle : présente dans une
    ou plusieurs zones (id, zone, nom), `found`, `found_date`.
  - `POST /api/gps-visits/state {"ids": [...], "state": "ignored" | "pending"}`.
- **Tests** `backend/tests/test_garmin_visits.py` :
  - UTF‑16 sans BOM, UTF‑16 avec BOM, UTF‑8 ;
  - commentaire multiligne et guillemets doublés ;
  - code vide, `8` et code précédé d'un caractère invisible ;
  - statut inconnu ;
  - réduction de l'exemple `GC4NKAY` ;
  - visite à 22h30Z en été, dont le jour local est le lendemain ;
  - réimport idempotent.
  Le fichier réel n'est **pas** un fixture : il contient des données personnelles. Les
  fixtures sont de petits échantillons synthétiques.

### Lot 2 : widget « Visites GPS » (frontend) — livré le 2026-10-01

- Nouveau widget dans l'extension `zones` : `gps-visits-widget.tsx`, id
  `geoapp-gps-visits-widget`, commande `geoapp.gpsVisits.open`.
  - L'inscrire dans le registre des vues latérales, `sidebar/geoapp-sidebar-views.ts`,
    comme Trackables.
  - Ajouter une entrée de menu **Affichage → Vues**.
- **En‑tête** : bouton « Détecter le GPS », zone de dépôt du fichier (même composant
  visuel que `import-gpx-dialog.tsx`), et le bilan du dernier import.
- **Premier import** : panneau « À partir de quand veux‑tu loguer ? » dans le widget
  (pas de dialogue modal), avec les repères du backend et un champ date. Le texte explique
  que les visites plus anciennes sont gardées en historique sans être proposées. Un bouton
  « Changer le point de départ » le rouvre plus tard.
- **Liste** groupée par jour, le plus récent en haut. Chaque jour se replie et affiche son
  nombre de caches. Chaque ligne affiche :
  - l'heure locale, le code et le nom (si la cache est connue) ;
  - un badge de statut : trouvée, non trouvée, pas tentée, NM, autre ;
  - le commentaire GPS ;
  - un indicateur : « dans l'App (zone X) », « à importer » ou « déjà trouvée sur
    Geocaching.com » ;
  - le nombre de lignes brutes réduites (« 4 passages »), avec le détail en infobulle.
- Les visites **sans code** apparaissent à leur place chronologique, en grisé. Le bouton
  « Rattacher… » arrive avec le lot 6.
- **Actions** :
  - par ligne : « Ignorer » ;
  - par jour : « Tout ignorer », « Préparer les logs » (lot 3) ;
  - un filtre « Afficher les visites ignorées / loguées ».
- Vocabulaire : « visite », « loguer », « ignorer ». Pas de « field note », de « draft » ni
  de « pending » dans l'UI.

### Lot 3 : préparer les logs d'une journée — livré le 2026-10-01

- **Choix de la zone** au clic sur « Préparer les logs », seulement si au moins une cache
  du jour manque en base. C'est un panneau dans le widget, comme le point de départ. Liste des zones existantes, plus « Nouvelle zone… » (nom proposé :
  « Sortie du JJ/MM/AAAA »).
  - La dernière zone choisie est mémorisée (`AppConfig`, clé `gps_visits.last_zone_id`) et
    présélectionnée la fois suivante.
- **Import des caches manquantes** : endpoint en flux
  `POST /api/gps-visits/import-missing {"zone_id", "gc_codes"}`, qui reprend le patron
  d'`import-bookmark-list` (progression ligne par ligne, `GeocacheImporter.import_by_code`,
  même temporisation).
  - Une cache introuvable sur Geocaching.com (archivée, code faux) est signalée et exclue,
    sans bloquer les autres.
  - Une cache présente dans **plusieurs zones** : on prend celle de la zone choisie si elle
    y est, sinon la plus récemment mise à jour. Pas de copie.
  - `import_by_code` **déplace** une cache déjà en base dans la zone cible : il n'est
    appelé que pour les codes absents de la base, vérifiés juste avant.
  - Une cache absente de la base et seulement « pas tentée » n'est pas importée
    (`skipped_unattempted`).
- **Ouverture de l'éditeur** : `OpenGeocacheLogEditorOptions` et `setContext` reçoivent un
  `prefill` optionnel :
  ```ts
  interface LogEditorPrefill {
      source: 'gps-visits';
      logDate: string;                                   // AAAA-MM-JJ, jour local
      perCacheLogType: Record<number, LogTypeValue>;
      perCacheVisit: Record<number, GpsVisitHint>;       // heure, libellé, commentaire,
  }                                                      // passages, NM, à confirmer
  ```
  Implémenté avec un seul `perCacheVisit` (`GpsVisitHint`) au lieu de quatre tables
  parallèles : le lot 5 en tire le signalement NM et le « à confirmer », le lot 7 l'heure.
  - `geocacheIds` est passé **dans l'ordre chronologique des visites** : c'est lui qui
    pilote `@cache_count`.
  - Le titre de l'onglet est « Log GPS — JJ/MM ».
  - Dans `initializeSession`, le prefill s'applique **après** `loadGeocaches` et **avant**
    `restoreDraftIfAny`. Un brouillon existant pour ce même ensemble de caches l'emporte
    donc toujours sur le prefill.
  - La date du prefill **remplace la date épinglée** pour cet onglet, sans modifier
    l'épinglage enregistré.
- **Affichage dans l'éditeur** : dans chaque bloc de cache, une ligne discrète
  « 📟 10:32 — Found it — "Horse" ». Le commentaire n'est **jamais** copié dans le texte
  du log.
- **Plusieurs jours** sélectionnés : un onglet par jour, puisque l'éditeur n'a qu'une date
  par onglet. Ne pas ajouter de date par cache.
- Les caches déjà trouvées (`already_found`) restent soumises à l'avertissement existant.

### Lot 4 : retour d'envoi — livré le 2026-10-01

- Dans `POST /api/geocaches/<id>/logs/submit`, après un envoi réussi, les `gps_visit` en
  `pending` de cette cache passent en `logged`, avec le `log_reference_code` :
  - même `gc_code`, ou même `resolved_gc_code` ;
  - même jour local que la date du log.
  C'est fait **côté backend**, pour que l'état soit juste même si l'onglet est fermé
  pendant l'envoi.
- Une cache envoyée en `skip` ne change pas d'état.
- Le widget se rafraîchit à la fermeture de l'onglet de log. Un jour entièrement logué
  disparaît de la vue par défaut.
- **Déjà loguée ailleurs** : une visite `pending` dont la cache a `found = true`, avec
  `found_date` le même jour, est affichée « déjà loguée sur Geocaching.com ». Une action
  « Marquer comme loguée » la sort de la liste. Rien d'automatique : `found_date` peut dater
  d'une autre visite.

### Lot 5 : signaler un problème (NM / NA) dans l'éditeur de logs — livré le 2026-10-01

> **Écarts à la mise en œuvre** :
> - le signalement passe par un endpoint séparé, `POST /api/geocaches/<id>/logs/report-problem`,
>   et non par un champ de `logs/submit`. Une reprise renvoie ainsi seulement ce qui manque
>   (log principal parti, NM en échec). L'ordre « principal d'abord » est tenu par la
>   boucle d'envoi de l'éditeur. **Aucun nouvel essai automatique** du NM : une issue
>   incertaine passe en « à vérifier » ;
> - le brouillon garde `LogDraft` en version 2, avec un champ facultatif `problems` (sans
>   changement de sens des champs existants, pas besoin de version 3) ;
> - la saisie se fait dans une section « Signaler un problème » sous le tableau (valable
>   en mode texte commun comme par cache), plutôt que dans chaque bloc de cache.

Ce lot sert à **tous** les logs, pas seulement à ceux qui viennent du GPS.

- **Backend** :
  - `logs/submit` accepte un champ optionnel `problem: {"category": "<code c:geo>",
    "text": "<texte>"}`.
  - Ordre d'envoi :
    1. le log principal ;
    2. **seulement s'il a réussi**, le second log de type 45 ou 7, avec la même date et
       le texte fourni.
  - La réponse donne les deux résultats séparément : `log_reference_code` et
    `problem: {submitted, log_reference_code, error}`. Un échec du signalement **ne
    remet pas en cause** le log principal.
  - **Log principal `skip` + signalement** : seul le signalement part. C'est utile pour
    les NM sans trouvaille.
  - Valider les combinaisons interdites du tableau c:geo (ex. `missing` avec `found`) :
    erreur 400 explicite.
  - `_store_submitted_log` enregistre aussi le log NM en base.
  - Le mapping texte accepte `needs_maintenance` → 45 et `needs_archived` → 7.
- **Frontend** :
  - Dans chaque bloc de cache, un bouton « ⚠ Signaler un problème » qui déplie :
    - la catégorie ;
    - un texte modifiable, pré‑rempli avec le texte de la catégorie. Les textes par
      défaut sont en **français**, modifiables en préférence (catégorie Logs). Les textes
      anglais de c:geo sont la référence de sens.
  - Les catégories interdites avec le type de log courant sont grisées, avec une
    infobulle.
  - **Envoi sans doublon** : brouillon (`LogDraft`, version 3) et historique mémorisent le
    signalement et son statut **séparément** du log principal. Une reprise après plantage
    ne renvoie ni un log principal déjà parti, ni un NM déjà parti. Même logique que
    `dropResults` des TBs.
  - Le récapitulatif avant envoi (`log-submit-service.ts`) annonce les signalements :
    « 2 signalements Needs Maintenance seront aussi envoyés (publics, notifient le
    propriétaire) ».
- **Venant du GPS** :
  - une visite NM pré‑coche le signalement en catégorie `needsMaintenance` ;
  - si la cache n'a **pas** de ligne `Found it` ce jour‑là, le type `found` est marqué
    « à confirmer » (badge orange). L'envoi du lot est **refusé** tant qu'une cache
    « à confirmer » n'a pas été touchée : changement de type, ou clic sur le badge pour
    valider.

### Lot 6 : rattacher les visites sans code — livré le 2026-10-01

> **Écarts à la mise en œuvre** (vérifications en réel du 2026‑10‑01) :
> - la recherche de mes trouvailles ne renvoie **pas** ma date de trouvaille
>   (`lastFoundDate` est la dernière trouvaille tous joueurs confondus). En revanche, la
>   fiche JSON `/api/proxy/web/v1/geocache/{code}` la donne (`callerSpecific.found`), en
>   0,2 s. Elle donne aussi les coordonnées d'une voisine absente de la base ;
> - la recherche rapide (voisines, zone d'environ 1 km puis 3 km, date de trouvaille
>   confirmée) prend 1 à 20 s. Le placement par l'ordre de mes trouvailles, cadencé à
>   6 s par requête, coûte environ une minute : c'est un second bouton, utile quand
>   aucune voisine n'est située.

Le rattachement n'est **jamais automatique** : l'App propose des candidats, l'utilisateur
choisit, saisit un code à la main, ou ignore.

- **Endpoint** `GET /api/gps-visits/<id>/candidates` :
  1. **Par voisinage** : prendre les visites codées du même jour, juste avant et juste
     après (dans une fenêtre de ±60 min). Pour leurs coordonnées (base, ou import léger
     via la recherche), lancer une recherche web (`/api/proxy/web/search/v2`, client
     existant de `geocaching_friend_finds.py`) dans une boîte de ~1 km autour.
     - Exclure les codes déjà présents dans le fichier.
     - Classer par distance au point milieu entre les deux voisins, puis par statut
       « trouvée par moi », si la recherche le donne.
  2. **Par mes trouvailles** : `search_finds_by(<mon pseudo>)` donne mes trouvailles de la
     plus récente à la plus ancienne. **À vérifier en réel avant de coder** : est‑ce que
     chaque enregistrement contient la date de trouvaille ? Logguer les clés d'une vraie
     réponse.
     - Si la date y est : candidates = mes trouvailles de ce jour‑là absentes du fichier.
       C'est le meilleur signal.
     - Sinon, cette source sert seulement à marquer « trouvée par moi » les candidats du
       point 1.
- **Limites à afficher** :
  - les caches archivées ne sont pas dans l'index de recherche ;
  - une Adventure Lab ne se logue pas sur geocaching.com : si c'en est une, « Ignorer »
    est la bonne réponse.
- **UI** : le bouton « Rattacher… » ouvre une liste de candidats avec nom, type, distance
  et « trouvée par moi ? ». Un champ permet aussi la saisie manuelle d'un code GC.
  - Le choix écrit `resolved_gc_code` et `resolution_source` (`neighbours`, `my_finds` ou
    `manual`).
  - La visite se comporte ensuite comme une visite codée.
- **Coût réseau** : une recherche par visite sans code. Tout rattachement est déclenché
  par l'utilisateur, jamais un balayage des 367 visites d'un coup.

### Lot 7 (optionnel) : finitions

- **Pattern `@visit_time`** dans l'éditeur, qui insère l'heure de visite du GPS
  (« trouvée à 10h32 »). Il est vide hors prefill GPS. À documenter avec les autres
  patterns (§9 de `LOGS_SYSTEM_TECHNICAL.md`).
- **Détection au branchement** : pendant que le widget est ouvert, `detect` est appelé
  toutes les 10 s. Quand un GPS apparaît, une notification propose « Importer les
  visites ».
- **Préférence de fuseau** pour la conversion UTC → local (par défaut : celui de l'OS),
  pour un utilisateur qui logue au retour d'un voyage.

---

## Fichiers clés

| Rôle | Fichier |
|---|---|
| Lecteur du fichier | `backend/gc_backend/services/garmin_visits.py` (nouveau) |
| Endpoints visites | `backend/gc_backend/blueprints/gps_visits.py` (nouveau) |
| Modèle `GpsVisit` | `backend/gc_backend/models.py` ou `geocaches/models.py`, à côté de `Trackable` |
| Import par code (réutilisé) | `backend/gc_backend/blueprints/geocaches.py` (`/api/geocaches/add`, `import-bookmark-list`) |
| Envoi des logs | `backend/gc_backend/blueprints/logs.py` (`submit_geocache_log`, `_store_submitted_log`), `services/geocaching_submit_logs.py` |
| Recherche web | `backend/gc_backend/services/geocaching_friend_finds.py` (`search_finds_by`, `search_summaries`) |
| Widget | `frontend/theia-extensions/zones/src/browser/gps-visits-widget.tsx` (nouveau) |
| Registre des vues | `frontend/theia-extensions/zones/src/browser/sidebar/geoapp-sidebar-views.ts` |
| Ouverture de l'éditeur | `geocache-log-editor-tabs-manager.ts`, `geocache-log-editor-widget.tsx` (`setContext`, `initializeSession`) |
| Types de l'éditeur | `log-editor/types.ts` (`LogDraft` v3, `LogHistoryEntry`, `ProblemReport`) |
| Récapitulatif d'envoi | `log-editor/log-submit-service.ts`, `log-editor/submission-orchestrator.ts` |

## Vérification

- Lots 1‑2 : importer le vrai `geocache_visits.txt` et choisir comme point de départ le
  2026‑09‑01. Il doit rester 46 visites, toutes du 27/09/2026 (lignes brutes, avant
  réduction). Réimporter le même fichier : 0 nouvelle visite.
- Lot 3 : préparer le 27/09/2026. L'onglet s'ouvre avec les caches dans l'ordre horaire, la
  date du 27/09 et les types pré‑remplis. Avec un brouillon existant pour ces caches, le
  brouillon l'emporte.
- Lot 4 : après envoi, les visites du jour passent en `logged` et le jour disparaît.
- Lot 5 : contrôler le payload et l'ordre des deux appels avec des tests du backend qui
  simulent Geocaching.com. **Aucun NM de test sur le vrai site.**
- Lot 6 : sur une visite sans code de 2021 entourée de visites codées, au moins un
  candidat plausible ; la saisie manuelle fonctionne.
- `pytest backend/tests/test_garmin_visits.py` et les tests de l'éditeur de logs existants
  restent verts.
