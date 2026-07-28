# Carte des amis — spécification

> Afficher sur une carte GeoApp les découvertes des amis : d'abord le **flux
> d'activité** (données déjà locales, aucun réseau), puis les **trouvailles
> déduites par zone** (`friend_find`, qui n'a pas de coordonnées et demande un
> import en tâche de fond dans une zone « Amis » masquée).
>
> Complète [amis-geocaching-technique.md](amis-geocaching-technique.md).
> Rédigée le 2026-07-28. Trois lots, implémentables et livrables séparément.
>
> **✅ Les trois lots sont livrés (2026-07-28).** Cette spec est conservée comme
> trace des décisions ; la documentation vivante est aux §12 et §13 de
> [amis-geocaching-technique.md](amis-geocaching-technique.md).

---

## 0. Point de départ

Deux constats issus de l'audit du code existant, qui conditionnent tout le reste.

**Le flux d'activité est déjà géolocalisé.** La table `friend_activity` stocke
`latitude`, `longitude`, `cache_name`, `cache_reference_code`, `cache_type_id`,
`difficulty`, `terrain` ([models.py:105-120](../backend/gc_backend/models.py#L105-L120)),
et `to_dict()` les renvoie déjà. Le lot 1 ne fait donc **aucune requête vers
geocaching.com** : ni zone technique, ni import, ni cache à réchauffer.

**La carte accepte déjà des points hors base.** `MapWidget.loadGeocaches()`
prend un tableau arbitraire de `MapGeocache`, et la popup masque son bouton
« ouvrir la fiche » quand `id <= 0`
([map-view.tsx:1235](../frontend/theia-extensions/zones/src/browser/map/map-view.tsx#L1235)).
Une cache non importée s'affiche donc correctement sans travail supplémentaire.

`friend_find` (§11 de la doc technique) est le seul cas qui manque de
coordonnées : c'est l'objet du lot 3.

---

## 1. Lot 1 — Carte de l'activité des amis ✅ livré

> Livré le 2026-07-28. Documentation de référence : §12 de
> [amis-geocaching-technique.md](amis-geocaching-technique.md).
> La préférence `geoApp.friends.map.autoLoad` (lot 2) a été livrée avec, faute
> de sens à ouvrir la carte automatiquement sans pouvoir le désactiver.
> Écart assumé : l'API accepte `days`, mais l'UI ne l'envoie pas — la carte doit
> montrer exactement ce que la timeline affiche (cf. §12.4 de la doc technique).

### 1.1 Route `GET /api/friends/activity/map`

Route de lecture **purement locale**, sœur de `GET /api/friends/activity` mais
taillée pour la carte : pas de pagination, pas de `note`, pas de `action_url`.

| Param | Type | Défaut | Note |
|-------|------|--------|------|
| `author` | string | — | identique à la route de lecture |
| `log_types` | ids séparés par des virgules | — | idem |
| `include_self` | bool | `false` | idem |
| `days` | int | — | fenêtre glissante sur `log_date` |
| `limit` | int | 2000 | garde-fou, plafonné à 5000 |

**Tous les points correspondant aux filtres** sont renvoyés (décision
utilisateur) : la carte n'est pas paginée. Le plafond n'est qu'un garde-fou ;
s'il est atteint, la réponse porte `truncated: true` et l'UI le signale.

Réponse :

```json
{
  "success": true,
  "points": [
    {
      "gc_code": "GC12345",
      "name": "Le vieux pont",
      "cache_type": "Traditional",
      "latitude": 47.1234,
      "longitude": 5.4321,
      "difficulty": 2.0,
      "terrain": 1.5,
      "geocache_id": 412,
      "found": false,
      "friends": [
        { "username": "Pseudo", "log_type_id": 2, "log_date": "2026-07-26T12:52:52" }
      ],
      "last_log_date": "2026-07-26T12:52:52"
    }
  ],
  "total": 87,
  "without_coordinates": 0,
  "truncated": false
}
```

Trois traitements côté serveur, dans cet ordre :

1. **Dédoublonnage par `cache_reference_code`.** Plusieurs amis (ou plusieurs
   logs) sur la même cache = **un seul point**, les auteurs agrégés dans
   `friends`, triés par date décroissante. Sans ça, la carte empile des
   features au même endroit.
2. **Jointure avec les caches importées.** `LEFT JOIN Geocache ON gc_code` →
   `geocache_id` (réel) et `found`. Coût nul, et ça donne gratuitement la
   distinction visuelle « déjà chez moi / pas encore ».
3. **Traduction du type.** `cache_type_id` → nom lisible via
   `GEOCACHE_TYPE_MAP` ([search_client.py:253](../backend/gc_backend/geocaches/search_client.py#L253)),
   qui est le mapping déjà utilisé par le reste du projet. Un id inconnu donne
   `cache_type: null` → icône générique, jamais une erreur.

Les entrées sans `latitude`/`longitude` sont exclues et comptées dans
`without_coordinates`. En pratique c'est ~0 (un log est toujours attaché à une
cache) ; le compteur existe pour ne pas mentir silencieusement si le flux change.

### 1.2 Piège : les ids des caches non importées

`MapLayerManager.addGeocache()` fait `feature.setId(geocache.id)`
([map-layer-manager.ts:422](../frontend/theia-extensions/zones/src/browser/map/map-layer-manager.ts#L422)),
et `syncGeocaches()` diffe les features **par id**. Donner `id: 0` à toutes les
caches non importées les ferait donc entrer en collision : une seule feature
survivrait.

→ Le frontend attribue un **id négatif unique** à chaque point non importé
(compteur décroissant, stable pour une même passe de chargement). `id > 0` reste
le prédicat « cette cache est dans GeoApp », que la popup utilise déjà.

### 1.3 Contexte de carte `friends` (id stable)

`openCustomMap()` crée une **nouvelle** carte à chaque appel (« Carte 1 »,
« Carte 2 »…) : inutilisable pour une carte pilotée par des filtres, qui doit
être rechargée en place.

Ajout d'un contexte dédié, à id fixe `geoapp-map-friends` :

| Fichier | Modification |
|---------|--------------|
| [map-widget.tsx](../frontend/theia-extensions/zones/src/browser/map/map-widget.tsx) | `type: … \| 'friends'` dans `MapContext`, cas dans `generateId()` |
| [map-widget-factory.ts](../frontend/theia-extensions/zones/src/browser/map/map-widget-factory.ts) | `openFriendsMap(points)`, cas dans `generateWidgetId()` |
| [map-manager-widget.tsx:231](../frontend/theia-extensions/zones/src/browser/map/map-manager-widget.tsx#L231) | icône/libellé du nouveau type |

Comportement : le premier appel crée et attache la carte, les suivants
réutilisent le widget et appellent `loadGeocaches()`. Un changement de filtre
dans le widget d'activité recharge donc la carte **sans ouvrir d'onglet**.

### 1.4 Popup : qui a trouvé quoi

Les propriétés des features sont une liste blanche fixe
([map-layer-manager.ts:423-434](../frontend/theia-extensions/zones/src/browser/map/map-layer-manager.ts#L423-L434)) :
`note` n'est pas transmis pour les géocaches. Il faut donc ajouter un champ.

- `MapGeocache` : `friendsNote?: string`.
- `addGeocache()` / `syncGeocaches()` : le propager dans `setProperties`.
- `GeocacheFeatureProperties` : le déclarer.
- La popup l'affiche sous le titre, au même emplacement que le `note` existant.

Contenu : `« Trouvée par Pseudo1, Pseudo2 — 26/07 »` (types de log autres que 2
préfixés de leur libellé : « DNF de Pseudo3 »).

### 1.5 Widget « Activité des amis »

Dans [geocaching-friend-activity-widget.tsx](../frontend/theia-extensions/zones/src/browser/geocaching-friend-activity-widget.tsx) :

- ajouter `latitude` / `longitude` à l'interface `FriendActivity` (le backend
  les renvoie déjà, seul le typage TS les ignore) ;
- bouton **🗺 Carte** dans la barre d'outils, qui ouvre/recharge la carte des
  amis avec les filtres courants ;
- après tout changement de filtre (ami, type, fenêtre), si la carte est ouverte,
  la recharger ; si elle est fermée, ne rien faire (pas de réouverture
  intempestive) ;
- ouverture automatique à l'ouverture du widget si
  `geoApp.friends.map.autoLoad` (§2).

---

## 2. Lot 2 — Préférences ✅ livré

Deux clés, déclarées dans `shared/preferences/geo-preferences-schema.json` selon
la procédure de [preferences-ajout-rapide.md](preferences-ajout-rapide.md).

### `geoApp.friends.map.autoLoad`

```json
{
  "type": "boolean",
  "default": true,
  "title": "Ouvrir la carte des amis automatiquement",
  "description": "À l'ouverture du widget « Activité des amis », affiche la carte et charge les points correspondant aux filtres. Si désactivé, la carte n'est ouverte que sur clic du bouton « Carte ».",
  "x-ui": { "section": "Amis", "label": "Carte automatique", "order": 10,
            "keywords": ["amis", "carte", "activité"] },
  "x-category": "map",
  "x-targets": ["frontend"]
}
```

### `geoApp.friends.zone.visible`

```json
{
  "type": "boolean",
  "default": false,
  "title": "Afficher la zone « Amis » dans l'arbre",
  "description": "La zone technique « Amis » regroupe les géocaches importées automatiquement pour cartographier les trouvailles de vos amis. Masquée par défaut pour ne pas encombrer l'arbre des zones.",
  "x-ui": { "section": "Amis", "label": "Zone « Amis » visible", "order": 20,
            "advanced": true, "keywords": ["amis", "zone", "masquer"] },
  "x-category": "ui",
  "x-targets": ["frontend"]
}
```

Les deux sont **frontend uniquement** : le backend expose le drapeau, c'est le
frontend qui décide de l'afficher (§3.2). Une nouvelle section `Amis` est ajoutée
à la page Préférences ; pas de nouvelle `x-category`.

---

## 3. Lot 3 — Trouvailles déduites sur la carte ✅ livré

> Livré le 2026-07-28, conforme à la spec. Documentation de référence : §13 de
> [amis-geocaching-technique.md](amis-geocaching-technique.md).

`friend_find` ne stocke que `(friend_username, gc_code, source)` : aucune
coordonnée. Deux chemins complémentaires, à livrer dans cet ordre.

### 3.1 Les coordonnées sont gratuites à la déduction (à faire d'abord)

Au moment de la déduction `nfb` (§11.1 de la doc technique), la **recherche de
référence renvoie déjà** les coordonnées, le nom, le type et les D/T de chaque
cache de la boîte — puisque `trouvées(ami) = référence − complément`. Ces
données sont aujourd'hui jetées.

→ Ajouter `latitude`, `longitude`, `cache_name`, `cache_type` à `friend_find`,
renseignés depuis la référence lors de `store_finds(source='zone_search')`.
Pour `source='cache_logs'`, la cache est par construction déjà dans GeoApp :
les coordonnées viennent du `LEFT JOIN`.

**Conséquence : la carte des trouvailles est instantanée et hors ligne**, sans
attendre le moindre import. C'est quatre colonnes contre plusieurs minutes de
scraping à chaque consultation.

Migration : colonnes ajoutées sur une table existante → micro-migrations SQLite
de `database.py` **et** migration Alembic, comme `is_friend_log` et `is_self`.
Les lignes existantes gardent des coordonnées nulles jusqu'à la prochaine
resynchronisation de zone ; l'UI les compte sans les afficher.

### 3.2 Zone « Amis » masquée + import en tâche de fond

L'import complet reste utile pour autre chose que la carte : il transforme une
trouvaille d'ami en **vraie géocache GeoApp**, ouvrable, annotable, résoluble.

**Modèle.** Nouvelle colonne `Zone.is_hidden` (booléen, défaut `false`), même
double migration. La zone « Amis » est créée à la demande (get-or-create) avec
`is_hidden=True` et une description qui explique son rôle.

**Listing.** `GET /api/zones` exclut les zones masquées **sauf**
`?include_hidden=true`. L'arbre des zones passe le paramètre selon
`geoApp.friends.zone.visible`. Les autres consommateurs (dialogue de
déplacement, sélecteur de zone) n'y touchent pas : la zone « Amis » n'a pas à
être une cible de déplacement.

**Import.** `POST /api/friends/finds/import` , réponse en **streaming JSON ligne
par ligne**, sur le modèle exact de `import-around`
([geocaches.py:718](../backend/gc_backend/blueprints/geocaches.py#L718)) — le
frontend sait déjà consommer ce format. Corps : `{ zone_id }` (facultatif :
restreindre à une zone d'origine).

1. Codes GC de `friend_find` **absents de `Geocache`**, dédoublonnés.
2. `importer.import_by_code(zone_amis_id, code)` pour chacun, `time.sleep(0.2)`
   entre deux, progression émise à chaque cache.
3. Bilan `{created, skipped, errors}`.

Le `TaskManager` de `blueprints/tasks.py` n'est pas réutilisé : il est dédié à
l'exécution de plugins, et tous les traitements longs du projet
(import-around, synchro des trouvailles) passent par le streaming.

**Volume — le point d'attention.** Le nombre de caches à importer est borné par
la boîte englobante des zones analysées, pas par le nombre de trouvailles d'un
ami : quelques dizaines pour une zone dense, mais **plus de mille** pour une
zone dispersée (cf. le tableau de coûts §11.3 de la doc technique). À
0,2 s + une requête par cache, c'est plusieurs minutes. D'où :

- l'import est **toujours explicite ou en fond**, jamais bloquant ;
- l'UI affiche un **indicateur discret** (compteur `123/456` dans la barre
  d'outils, pas de modale) et un bouton d'arrêt ;
- au-delà de 500 caches, une confirmation annonce le nombre et la durée estimée.

**Affichage.** La carte des amis gagne un sélecteur de source :
« Activité récente » (lot 1) / « Toutes les trouvailles » (`friend_find`) /
« Les deux ». Les points issus de `friend_find` sans coordonnées ni cache
importée sont comptés et affichés comme « N trouvailles non localisables »,
avec le bouton d'import à côté.

---

## 4. Hors périmètre

- **Les caches archivées** restent invisibles de la déduction par zone (§11.2
  de la doc technique) : rien ne change ici.
- **La profondeur du flux** reste celle de `friend_activity` (~2 mois glissants
  + ce que les synchros successives ont accumulé). Décision assumée : la carte
  d'activité montre le récent, `friend_find` montre l'historique.
- Pas de couche de chaleur / densité, pas d'animation temporelle.

---

## 5. Tests

Backend, sans réseau, dans `backend/tests/` :

- `test_friend_activity_map.py` — dédoublonnage par code GC et agrégation des
  auteurs, jointure `geocache_id` présente/absente, traduction du type incluant
  un id inconnu, exclusion et comptage des entrées sans coordonnées, filtres et
  plafond `truncated`.
- `test_friend_finds.py` (existant, à étendre) — persistance des coordonnées
  issues de la référence, lignes anciennes sans coordonnées tolérées.
- `test_zones.py` (existant, à étendre) — `is_hidden` exclu par défaut de
  `GET /api/zones`, présent avec `include_hidden=true`.

Frontend : vérifier la non-collision des ids négatifs et la réutilisation du
widget `geoapp-map-friends` sur changement de filtre.
