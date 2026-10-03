# Visites GPS Garmin — améliorations de l'import (spec)

Plan du 2026-10-03. Fait suite au premier chantier
([garmin-visites-spec.md](garmin-visites-spec.md), 7 lots livrés le 2026‑10‑01 ;
doc : [garmin-visites-technique.md](garmin-visites-technique.md)) et au premier essai de
l'utilisateur. À implémenter lot par lot ; la doc technique est complétée au fil des
livraisons.

## Contexte

Le premier chantier fonctionne : lecture du fichier, liste par jour, préparation des logs,
retour d'envoi, signalement NM, rattachement. Mais l'import d'une sortie manque de clarté
et de contrôle :

1. **La zone n'est pas claire.**
   - Le choix n'apparaît que si des caches manquent dans l'App. Le 27/09, les 46 caches
     sont déjà dans « Slovénie » : aucune question n'est posée.
   - Une cache déjà connue reste toujours où elle est.
   - La dernière zone est présélectionnée sans le dire.
   - Impossible de changer de zone après coup.
2. **On ne peut rien annuler.**
   - Un import en cours ne peut pas être arrêté.
   - Un import terminé ne peut pas être défait.
   - « Ignorer » et « Marquer loguée » n'ont pas d'annulation immédiate.
3. **On ne choisit pas les caches** : « Préparer les logs » prend toujours le jour entier.
4. **Il n'y a pas de carte** : le fichier des visites ne contient aucune coordonnée.
5. **Les caches pas encore importées sont anonymes** (ni nom, ni type).
6. **« Déjà loguée » repose sur la base locale**, qui ignore les logs faits ailleurs (le
   téléphone, par exemple).

### Décisions de l'utilisateur (2026‑10‑03)

- **La carte reprend les codes de l'App.** Elle s'affiche dans la zone dédiée aux cartes
  (panneau du bas, comme les cartes de zone et la carte des amis). L'utilisateur peut la
  déplacer.
- **Une cache peut être dans plusieurs zones.** Préparer une sortie **ajoute** ses caches
  à la zone demandée : une cache connue ailleurs y est copiée, jamais déplacée.
- **Annuler pendant l'ajout retire les caches déjà ajoutées** par cet ajout.

### Ce que contient le GPS (relevé en lecture seule le 2026‑10‑03, GPS en `H:`)

| Fichier | Contenu | Usage |
|---|---|---|
| `Garmin/geocache_visits.txt` | Visites, heure UTC à la minute (seule source lue aujourd'hui) | Repli |
| `Garmin/geocache_logs.xml` | Les **mêmes visites** (14 625), en UTF‑8, avec l'**heure locale, son fuseau et les secondes** : `<log><code>GC2RE4R</code><time>2021-06-13T10:37:36+02:00</time><result>found it</result><comment></comment></log>`. Les 367 visites sans code y figurent aussi (`<code></code>`). | Source principale : le jour local est exact, même en voyage |
| `Garmin/GPX/Current/Current.gpx`, `Garmin/GPX/Archive/*.gpx` | **Traces horodatées** : 795 fichiers depuis 2012, nommés `AAAA-MM-JJ HH.MM.SS Auto.gpx`. La trace du 13/06/2021 a un point à 08:40Z, pour une visite sans code à 08:45Z. Le 27/09/2026 est couvert de 07:58Z à 19:51Z. | Position de chaque visite (codée ou non), tracé de la sortie, distance |
| `Garmin/GPX/<n>.gpx` et `<n>-wpts.gpx` | Pocket Queries chargées sur le GPS (38 fichiers). `26057817.gpx` (26/09) contient les caches du 27/09. | Nom, type et coordonnées avant import ; **import sans réseau** (l'App sait déjà importer un GPX Groundspeak) |
| `Garmin/GPX/Waypoints_*.gpx` | Waypoints de l'utilisateur | Ignorés |
| `Garmin/JPEG` | Trois images de démonstration Garmin, aucune photo de l'utilisateur | Rien à en tirer |

---

## Lots

### Lot 1 : sélection, zone de la sortie et annulation de l'ajout — livré le 2026-10-03

> Mise en œuvre : les visites **non tentées** sont toujours laissées de côté, même déjà
> dans l'App (rien à loguer). Le panneau est le composant `gps-outing-preparation.tsx`.

**Sélection (frontend)**
- Une case à cocher par cache à loguer (codée ou rattachée), une par jour (« tout le
  jour »). La sélection peut couvrir plusieurs jours.
- Une barre d'action apparaît dès qu'une cache est cochée :
  « 12 caches sur 2 jours — Préparer les logs · Ignorer · Vider la sélection ».
- Le bouton « Préparer les logs » d'un jour coche ce jour, puis ouvre la préparation.

**Préparation de la sortie : un panneau toujours affiché, même si tout est connu**
- **Récapitulatif** calculé par le backend pour la sélection et la zone choisie :
  - déjà dans la zone ;
  - présentes dans d'autres zones, qui seront **ajoutées** (copiées) à la zone ;
  - à télécharger ;
  - exclues : visites sans code (à rattacher), visites non tentées absentes de l'App.
- **Zone de la sortie**, libellée comme telle :
  - une zone existante ;
  - ou « Nouvelle zone… », nommée par défaut « Sortie du 27/09/2026 » (« Sortie du 26
    au 27/09/2026 » sur plusieurs jours).
  - Valeur proposée : la zone déjà associée à ce jour, sinon la dernière utilisée,
    toujours affichée comme suggestion.
  - Le récapitulatif est recalculé à chaque changement de zone.
- Bouton « Ajouter à la zone et ouvrir l'éditeur de logs ». Pendant l'ajout : barre de
  progression, erreurs ligne à ligne, bouton **« Annuler »**.
- Le jour (ou les jours) est mémorisé avec sa zone : `AppConfig` `gps_visits.day_zones`
  (`{jour: zone_id}`). Il sert de suggestion et pour l'action « Changer la zone de cette
  sortie » de la liste, qui rouvre le même panneau.
- L'éditeur reçoit les **géocaches de la zone de la sortie**, dans l'ordre de visite. Une
  cache est loguée depuis sa ligne dans cette zone.

**Ajout à la zone (backend)**
- Nouveau service `services/zone_membership.py`, avec
  `add_to_zone(gc_code, zone_id, operation) -> (geocache, action)` :

  | Situation | Action |
  |---|---|
  | La cache est déjà dans la zone | `existing` |
  | La cache existe dans une autre zone | `copied` (copie de la ligne, des waypoints et des checkers) |
  | La cache est absente de la base | `created` (GPX du GPS au lot 2, sinon téléchargement) |

  - Le corps de `POST /api/geocaches/<id>/copy` est extrait en
    `copy_geocache_to_zone(source, zone_id)`, utilisé par les deux.
  - On n'appelle jamais `import_by_code` ni `import_from_scraped` sur une cache déjà en
    base : `_resolve_existing` la **déplacerait**.
- **Journal d'ajout** : tables `gps_zone_operation` et `gps_zone_operation_item`.
  - `gps_zone_operation` : `id` (uuid fourni par le client), `zone_id`, `zone_created`,
    `state` (`running`, `done`, `cancelled`, `interrupted`), dates.
  - `gps_zone_operation_item` : `operation_id`, `gc_code`, `geocache_id`, `action`.
- `POST /api/gps-visits/zone-operations` `{operation_id, zone_id | new_zone_name,
  visit_ids}` : flux NDJSON, comme aujourd'hui. Le flux crée la zone lui‑même, pour que
  l'annulation puisse la retirer.
- `POST /api/gps-visits/zone-operations/<id>/cancel` :
  - lève un drapeau lu **entre deux caches** ;
  - puis retire les géocaches `created` et `copied` de l'opération (suppression et
    nettoyage des images, comme `DELETE /api/geocaches/<id>`) ;
  - puis retire la zone si l'opération l'a créée et qu'elle est vide ;
  - réponse : « Annulé : 5 caches retirées, zone « Sortie du 27/09/2026 » supprimée ».
- **Annuler après coup** : la notification de fin propose « Annuler l'ajout » (même
  endpoint, opération `done`). C'est refusé si un log a été envoyé depuis une géocache de
  l'opération, car on ne retire pas une cache déjà loguée.
- Un client qui se déconnecte en cours de flux laisse l'opération `interrupted` : rien
  n'est retiré automatiquement, l'annulation reste possible.

**Copies et statut « trouvée »**
- Avec les copies, une cache vit dans plusieurs zones. Un log envoyé met aujourd'hui à
  jour la seule ligne logguée : `found` et `found_date` doivent passer à **toutes les
  lignes du même code GC**, dans `submit_geocache_log`.
- Le refus « déjà trouvée » consulte toutes ces lignes.

### Lot 2 : lire tout ce que contient le GPS — livré le 2026-10-03

> Mise en œuvre :
> - le XML porte des octets de contrôle interdits (comme le TXT) : ils sont retirés avant la
>   lecture ;
> - ses libellés (`did not find`, `needs repair`) sont ramenés à ceux du TXT ;
> - le rapprochement XML ↔ TXT se fait sur (code, résultat, minute UTC ± 1) ;
> - avant le premier point de départ, le positionnement est reporté (`after_cutoff`), puis
>   lancé par le widget dès que le point de départ est choisi.

**Source « dossier Garmin »**
- `detect` renvoie le **GPS** plutôt qu'un fichier :
  `{root, has_logs_xml, has_visits_txt, tracks_count, gpx_count}`.
- L'import lit tout le dossier `Garmin`. Seuls des chemins sous une racine détectée sont
  acceptés (même règle de sécurité qu'aujourd'hui).
- Pour les GPS sans lettre de lecteur (MTP) : « Choisir des fichiers… » accepte plusieurs
  fichiers (`.xml`, `.txt`, `.gpx`). Le glisser‑déposer aussi.

**Visites depuis `geocache_logs.xml`**
- Lecteur `parse_logs_xml(data)` dans `garmin_visits.py`. On garde l'heure, le décalage
  et les secondes.
- `GpsVisit` gagne deux colonnes : `utc_offset_minutes` et `visited_at_seconds`. Le **jour
  local d'une visite** se calcule avec **son décalage** ; à défaut, avec la préférence de
  fuseau ; à défaut, avec celui de l'OS.
- La clé d'unicité ne change pas : minute UTC, statut, rang. Un import XML après un import
  TXT **complète** les lignes existantes au lieu d'en créer.
- Le TXT reste lu s'il n'y a pas de XML.

**Traces → position des visites**
- Lecteur `garmin_tracks.py` : `trkpt` (lat, lon, time).
- Seuls sont lus les fichiers dont le nom (date de début) couvre un jour de visite pas
  encore positionné.
- Position d'une visite : interpolation entre les deux points qui encadrent son heure,
  s'ils sont à moins de 5 min d'écart. Sinon, pas de position.
- `GpsVisit` gagne `latitude`, `longitude` et `position_source` (`track`).
- Table `gps_track_day` : `day`, tracé simplifié (Douglas‑Peucker, environ 10 m, JSON),
  `distance_m`, `started_at`, `ended_at`. Le tracé sert à la carte et au résumé du jour,
  et reste disponible une fois le GPS débranché.
- Les journées antérieures au point de départ ne sont pas positionnées à l'import. Une
  action « Positionner aussi l'historique » existe pour le rattachement des anciennes
  visites.

**Caches des GPX du GPS**
- Index `gps_device_cache` : `gc_code`, `name`, `type`, `lat`, `lon`, `gpx_file`,
  `gpx_mtime`. Il est construit avec `parse_gpx_caches` (les `-wpts.gpx` donnent les
  waypoints) et rafraîchi quand un fichier change.
- La liste et le récapitulatif affichent le nom et le type des caches pas encore
  importées.
- À l'ajout, une cache absente de la base mais présente dans un GPX du GPS est créée
  **depuis le GPX**, sans réseau (même chemin que l'import GPX de zone). Le téléchargement
  page par page reste le repli.
- Ces données datent du chargement de la Pocket Query sur le GPS. La date du fichier est
  affichée (« données du GPS du 26/09 ») ; un rafraîchissement depuis le site reste
  possible après l'ajout.

### Lot 3 : carte de la sortie (zone des cartes) — livré le 2026-10-03

> Mise en œuvre :
> - les coordonnées viennent de l'App, puis des GPX du GPS, puis de la position de la
>   visite sur la trace. Le lot 2 positionne presque toutes les visites, d'où l'absence
>   de lecture des fiches à l'affichage ;
> - l'ouverture de la fiche passe par `MapGeocache.openGeocacheId`, traduit dans
>   `MapWidget` ;
> - le recentrage passe par `MapService.selectGeocache`, car `centerOnCoordinates`
>   n'est écouté par aucune carte.

- **Nouveau contexte de carte `gps-visits`** dans `MapWidgetFactory`, identifiant fixe
  (`geoapp-map-gps-visits`, « Carte des visites GPS »), sur le modèle de la carte des amis.
  - Il s'ouvre dans le panneau du bas, et l'utilisateur peut le déplacer.
  - Il est rechargé en place quand le contenu change.
  - Il s'ouvre depuis le widget (« Carte ») et au clic sur une ligne.
- **Contenu** : les caches des jours dépliés, ou de la sélection si elle existe.
  - Coordonnées, dans l'ordre : géocache GeoApp, GPX du GPS, fiche JSON
    `/api/proxy/web/v1/geocache/{code}` (déjà utilisée par le rattachement, gardée en
    cache), position de la visite sur la trace.
  - Marqueurs **numérotés dans l'ordre de visite**, colorés selon le résultat : trouvée,
    DNF, NM, non tentée. Une visite sans code est un « ? » posé à sa position sur la
    trace. Une visite loguée ou ignorée est estompée.
  - **Tracé du jour** (couche ligne) depuis `gps_track_day`.
  - Popup : nom, heure, résultat, commentaire du GPS, zone, et « Ouvrir la cache » si elle
    est dans l'App.
- **Sélection partagée**, comme entre le tableau d'une zone et sa carte :
  - l'anneau entoure les caches cochées (`setSelectedGeocaches` /
    `MapLayerManager.setListSelection`) ;
  - Ctrl+clic et le menu contextuel cochent ou décochent dans le widget
    (`MapService.requestListSelection` avec l'identifiant de cette carte ; le widget
    écoute) ;
  - un clic sur une ligne de la liste centre la carte.
- **Adaptations de la carte** :
  - `MapGeocache` gagne `label` (numéro), `markerColor` et `popupNote` (généralisation de
    `friendsNote`) ;
  - nouvelle couche de tracé ;
  - la sélection est autorisée pour ce contexte (aujourd'hui réservée aux cartes de zone :
    `isZoneMap`) ;
  - un point sans géocache GeoApp porte un identifiant négatif (l'id de sa première
    visite, en négatif) ; « Ouvrir la cache » est alors masqué.

### Lot 4 : rattachement par la trace — livré le 2026-10-03

- **Visite positionnée** :
  - la recherche se fait autour de la **position réelle** : boîte d'environ 300 m, puis
    1 km ;
  - les distances sont mesurées depuis cette position ;
  - les voisines restent le repli pour une visite non positionnée.
- **Sur la carte**, pendant le rattachement :
  - la position de la visite est marquée ;
  - les candidats sont affichés (couche temporaire) ;
  - un Ctrl+clic sur un candidat le **pointe** dans la liste ; « Choisir » confirme.
    Un clic de travers sur la carte ne rattache donc rien.
- **« Rattacher les visites sans code du jour »** :
  - pour chaque visite, dans l'ordre horaire, l'App propose le candidat confirmé le plus
    proche, **pas encore attribué** à une autre visite du jour ;
  - le résultat s'affiche en tableau (visite, cache proposée, distance, confiance) ;
  - les propositions trouvées ce jour-là (ou à quelques jours près) sont cochées
    d'office, les autres attendent un choix ;
  - « Rattacher N visites » valide tout d'un coup ; chaque ligne peut être changée ou
    laissée de côté.
  - Cible : la journée du 23/10/2021 et ses 78 visites sans code.

### Lot 5 : annulations immédiates et « déjà loguée » fiable

- **Annuler une action de la liste** : Ignorer, Marquer loguée, Rattacher, Détacher,
  changer le point de départ.
  - Le backend renvoie l'état précédent des lignes touchées.
  - Une notification « 12 visites ignorées — Annuler » le restaure, via
    `POST /api/gps-visits/restore {items: [{id, state, resolved_gc_code, …}]}`.
- **« Vérifier sur Geocaching.com »**, par jour ou pour la sélection :
  - lit ma date de trouvaille (`callerSpecific.found`, 0,2 s par cache, mise en cache) ;
  - une cache trouvée le jour même s'affiche « déjà loguée sur Geocaching.com » ;
  - « Marquer loguées (N) » les sort de la liste, avec annulation.
  - Un DNF déjà logué n'est pas détectable de cette façon : le dire dans l'aide.
- La même vérification sert dans l'éditeur, avant envoi, pour éviter un second « Found
  it ».

### Lot 6 : confort

- **Résumé du jour** dans l'en‑tête : début et fin, durée, distance (trace), trouvées,
  DNF, NM, sans code.
- **Lien avec l'éditeur de logs** : un jour qui a un onglet ouvert ou un brouillon
  affiche « Reprendre ». La clé du brouillon se calcule avec `getDraftKeyPure` sur les
  géocaches de la sortie.
- Recherche (code, nom, commentaire) et filtres (résultat, sans code, à importer).
- Un jour entièrement traité est replié par défaut.

---

## Fichiers clés

| Rôle | Fichier |
|---|---|
| Lecteurs du GPS | `backend/gc_backend/services/garmin_visits.py` (XML), `garmin_tracks.py` (nouveau), `geocaches/gpx_parser.py` (réutilisé) |
| Mémoire des visites | `backend/gc_backend/services/gps_visit_store.py`, modèle `GpsVisit` (`models.py`) |
| Ajout à une zone | `backend/gc_backend/services/zone_membership.py` (nouveau), copie extraite de `blueprints/geocaches.py` |
| Endpoints | `backend/gc_backend/blueprints/gps_visits.py` |
| Statut « trouvée » des copies | `backend/gc_backend/blueprints/logs.py` (`submit_geocache_log`) |
| Widget | `frontend/theia-extensions/zones/src/browser/gps-visits-widget.tsx`, `gps-visits-model.ts`, `gps-visits-service.ts` |
| Carte | `map/map-widget-factory.ts`, `map/map-widget.tsx`, `map/map-view.tsx`, `map/map-layer-manager.ts`, `map/map-service.ts` |
| Rattachement | `backend/gc_backend/services/gps_visit_resolution.py` |

## Vérification

- **Lot 1**, sur le 27/09/2026, zone « Sortie du 27/09/2026 » :
  - les 46 caches y sont **ajoutées** (copiées) et restent dans « Slovénie » ;
  - « Annuler » pendant l'ajout retire les copies déjà faites et la zone ;
  - un log envoyé marque la cache trouvée dans les deux zones.
- **Lot 2** :
  - l'import du dossier `H:\Garmin` lit le XML ;
  - le 27/09, les visites sont positionnées sur la trace ;
  - le tracé du jour fait une distance plausible ;
  - les caches du 27/09 sont nommées sans import, puis créées depuis `26057817.gpx` sans
    aucune requête au site.
- **Lot 3** :
  - la carte s'ouvre dans le panneau du bas, avec 46 marqueurs numérotés et le tracé ;
  - cocher dans la liste entoure la cache sur la carte, et Ctrl+clic sur la carte coche
    dans la liste.
- **Lot 4** :
  - la visite du 13/06/2021 à 10h45 est positionnée par la trace ;
  - le rattachement du 23/10/2021 propose une cache pour la plupart des 78 visites.
- **Aucun envoi réel** de log ou de NM pour tester. Les requêtes au site restent en
  lecture : fiches, recherches.
