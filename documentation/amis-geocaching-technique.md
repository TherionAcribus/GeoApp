# Amis Geocaching.com — Documentation technique

> Trois fonctionnalités autour des amis Geocaching.com :
> **(1) la liste d'amis** (scraping de `/my/myfriends.aspx`, cache mémoire,
> `GET /api/friends`, widget « Amis Geocaching »), **(2) le flux d'activité**
> (API interne du site, stockage incrémental en base, `GET/POST
> /api/friends/activity`, widget « Activité des amis ») et **(3) les logs d'amis
> sur une cache** (méthode c:geo, drapeau `is_friend_log`, filtre dans le widget
> Logs).
> Dernière mise à jour : juillet 2026.

---

## 1. Vue d'ensemble

Geocaching.com **n'expose aucune API JSON pour les amis**. La page « Your
Friends » est un formulaire ASP.NET rendu côté serveur : on la scrape avec la
session authentifiée partagée (voir
[connexion-geocaching-technique.md](connexion-geocaching-technique.md)).

```
┌────────────────────────────────┐
│  Frontend (widget Theia)       │  geocaching-friends-widget.tsx
│  GET /api/friends[?force=true] │
└───────────────┬────────────────┘
                │ REST
┌───────────────▼────────────────┐
│  blueprints/friends.py         │  401 / 502 / 500 selon l'erreur
└───────────────┬────────────────┘
                │
┌───────────────▼───────────────────────────────────┐
│  GeocachingFriendsClient (partagé)                │
│  - cache mémoire (TTL 15 min) + verrou            │
│  - parse_friends_page() : HTML -> FriendsResult   │
└───────────────┬───────────────────────────────────┘
                │ get_auth_service().get_session()
┌───────────────▼────────────────┐
│  geocaching.com                │  GET /my/myfriends.aspx
└────────────────────────────────┘
```

Le **flux d'activité** (§9) suit un chemin différent : là, geocaching.com expose
bien une API JSON interne, mais plafonnée. La lecture se fait donc en deux temps
— une synchronisation qui collecte, une lecture qui ne touche que la base :

```
   POST /api/friends/activity/sync            GET /api/friends/activity
              │                                          │
   ┌──────────▼──────────┐                    ┌──────────▼──────────┐
   │ client HTTP + parse │  ~100 max          │  table              │
   │ geocaching.com      ├──── upsert ───────►│  friend_activity    │
   └─────────────────────┘  (dédup GLxxxxx)   └─────────────────────┘
```

### Pourquoi pas la méthode c:geo ?

c:geo est la référence habituelle pour ce genre de fonctionnalité, mais **c:geo
ne récupère jamais la liste d'amis**. Pour afficher les logs d'amis sur une
cache, il appelle l'ancien endpoint logbook avec un paramètre qui laisse le
**serveur** filtrer selon la liste d'amis du compte connecté (voir §10).
C'est complémentaire, pas équivalent : ça ne donne pas la liste des amis.

---

## 2. Localisation du code

```
backend/gc_backend/services/
├── geocaching_friends.py           # Liste d'amis : client + parsing + cache mémoire
├── geocaching_friend_activity.py   # Flux d'activité : client HTTP + parsing (sans base)
├── friend_activity_store.py        # Flux d'activité : persistance incrémentale (sans réseau)
└── geocaching_logs.py              # get_logs_with_friends() : logs d'amis par cache (§10)

backend/gc_backend/
├── models.py                       # Modèle FriendActivity
└── blueprints/friends.py           # Routes REST /api/friends[...]

backend/migrations/versions/
├── add_friend_activity_table.py           # Création de la table friend_activity
└── add_geocache_log_is_friend_log.py      # Drapeau is_friend_log sur les logs

backend/tests/
├── test_geocaching_friends.py      # Parser de la liste d'amis (fixture synthétique)
├── test_friend_activity.py         # Parser du flux + stockage + routes
└── test_geocache_friend_logs.py    # Logs d'amis par cache + routes

frontend/theia-extensions/zones/src/browser/
├── geocaching-friends-widget.tsx           # Widget « Amis Geocaching »
├── geocaching-friend-activity-widget.tsx   # Widget « Activité des amis »
├── geocache-logs-widget.tsx                # Badge « ami » + filtre dans les logs d'une cache
├── zones-command-contribution.ts           # Commandes geoapp.friends[.activity].open
├── zones-menu-contribution.ts              # Entrées View > Views
├── geoapp-sidebar-contribution.ts          # Entrées du menu compte
└── zones-frontend-module.ts                # Bindings DI + WidgetFactory
```

Le blueprint est enregistré dans `gc_backend/__init__.py`, à côté de `auth_bp`.

---

## 3. Liste d'amis — source de données : `/my/myfriends.aspx`

Page HTML (~90 Ko) contenant un bloc par ami :

```html
<div class="FriendWidget">
  <div class="FriendAvatar">
    <p><img id="..._imgAvatar" src="https://img.geocaching.com/avatar/<guid>.png" /></p>
  </div>
  <div class="FriendText">
    <h4>
      <img id="..._imgMemberStatus" title="Premium Member" src="/images/icons/prem_user.gif" />
      <a id="..._lnkName" href="https://www.geocaching.com/p/?guid=<guid>">Pseudo</a></h4>
    <dl class="FriendList">
      <dt>Member Since:</dt><dd><span id="..._lblMemberSince">02/18/2015</span></dd>
      <dt>Last Online:</dt> <dd><span id="..._lblLastOnline">07/27/2026</span></dd>
      <dt>Location:</dt>    <dd><span id="..._lblLocation">not listed</span></dd>
      <dt>Found:</dt>       <dd>2,734</dd>
      <dt>Hidden:</dt>      <dd>12</dd>
    </dl>
    ...
  </div>
</div>
```

### Règles de parsing (et pourquoi)

| Donnée | Ancrage utilisé | Raison |
|--------|-----------------|--------|
| Pseudo, GUID de profil | `id` finissant par `lnkName`, `href` contenant `guid=<uuid>` | Les ids de contrôles ASP.NET sont stables |
| Premium | `imgMemberStatus` dont le `src` contient `prem` | Le `title` est traduit |
| Membre depuis / Dernière connexion / Lieu | ids `lblMemberSince`, `lblLastOnline`, `lblLocation` | **Indépendants de la langue** du compte |
| Trouvées / Posées | les `<dd>` **sans `<span>`** et purement numériques, dans l'ordre | Les libellés `Found:` / `Hidden:` sont traduits ; l'ordre, lui, est stable |
| Nombre total d'amis | onglet `lnkMyFriends` → `Your Friends (16)` | ⚠️ `window.friendsCount` n'existe **que sur le dashboard**, pas sur cette page |
| Demandes en attente | onglet `lnkPendingRequests` → `Pending Friend Requests (0)` | idem |

Normalisations appliquées : dates US `MM/DD/YYYY` → ISO `YYYY-MM-DD`, nombres
`53,860` → `53860`, `"not listed"` → `None`, avatar par défaut → `None`.

---

## 4. Liste d'amis — modèle de données

Défini dans `geocaching_friends.py`.

```python
@dataclass
class GeocachingFriend:
    username: str
    profile_guid: str | None       # GUID (pas un code PRxxxxx, cf. §9.1)
    profile_url: str | None
    avatar_url: str | None
    is_premium: bool
    member_since: str | None       # ISO 8601 (YYYY-MM-DD)
    last_online: str | None        # ISO 8601 (YYYY-MM-DD)
    location: str | None           # None si "not listed"
    finds_count: int | None
    hides_count: int | None

@dataclass
class FriendsResult:
    friends: list[GeocachingFriend]
    fetched_at: datetime
    reported_count: int | None     # compteur annoncé par la page
    pending_requests: int | None
    truncated: bool                # moins d'amis parsés que le compteur annoncé
```

Tous les champs autres que `username` sont optionnels : un profil incomplet ne
doit jamais faire échouer la récupération de toute la liste.

### Exceptions

| Exception | Quand | Traduction HTTP |
|-----------|-------|-----------------|
| `NotAuthenticatedError` | redirection vers `/account/signin` (session expirée) | 401 |
| `GeocachingFriendsError` | erreur réseau, HTTP ≠ 200, page méconnaissable | 502 |

`GeocachingFriendsError` est la classe de base ; `NotAuthenticatedError` en hérite.

---

## 5. Le client `GeocachingFriendsClient`

- **Session** : `get_auth_service().get_session()` par défaut, ou une session
  injectée (tests). Conformément à la règle générale, **aucun en-tête n'est
  muté sur la session partagée**.
- **Cache mémoire** : `CACHE_TTL = 15 min`. La liste d'amis bouge très rarement
  et la page pèse ~90 Ko : inutile de la retélécharger à chaque ouverture du
  widget. Mesure réelle : 1,2 s au premier appel, 0,3 ms ensuite.
- **Verrou** : `threading.Lock` autour de la lecture/écriture du cache — le
  backend Flask est multi-thread.
- **`invalidate_cache()`** : à appeler si l'app venait un jour à modifier la
  liste (ajout/suppression d'ami).
- **`get_friends_client()`** : accesseur du client partagé, pour que le cache
  soit mutualisé entre requêtes.
- **`parse_friends_page(html)`** est une **classmethod pure**, sans réseau :
  c'est le point d'entrée des tests.

---

## 6. Liste d'amis — API REST

### `GET /api/friends`

| Param | Valeurs | Effet |
|-------|---------|-------|
| `force` | `true` / `1` / `yes` | Ignore le cache mémoire |

Réponse 200 :

```json
{
  "success": true,
  "friends": [
    {
      "username": "Pseudo",
      "profile_guid": "b9a1e39c-52f7-40ac-ac53-cda0e3c2073c",
      "profile_url": "https://www.geocaching.com/p/?guid=b9a1e39c-...",
      "avatar_url": "https://img.geocaching.com/avatar/....png",
      "is_premium": true,
      "member_since": "2015-02-18",
      "last_online": "2026-07-27",
      "location": null,
      "finds_count": 2734,
      "hides_count": 12
    }
  ],
  "count": 16,
  "reported_count": 16,
  "pending_requests": 0,
  "truncated": false,
  "fetched_at": "2026-07-27T17:58:11.461886"
}
```

Réponses d'erreur : `{ "success": false, "error": "<code>", "error_message": "..." }`
avec `error` ∈ `not_authenticated` (401), `fetch_failed` (502), `internal_error` (500).

Le 401 est renvoyé **avant** toute requête réseau si
`get_auth_service().is_logged_in()` est faux.

---

## 7. Frontend — widget « Amis Geocaching »

`GeocachingFriendsWidget` (`ReactWidget`, ID `geocaching-friends-widget`),
ouvert dans la zone principale.

**Points d'entrée utilisateur :**

1. Menu du compte dans la sidebar (icône en bas) → **« Mes amis »** — à côté de
   « Gérer la connexion » ;
2. **View → Views → Amis Geocaching.com** ;
3. Palette de commandes : `GeoApp: Amis Geocaching.com` (`geoapp.friends.open`).

**Comportement :**

- Affichage en cartes responsives (grille `auto-fill`, min 280 px) : avatar,
  pseudo cliquable vers le profil, badge Premium, trouvées/posées, dernière
  connexion (« aujourd'hui » en vert si c'est le jour même), lieu, ancienneté.
- Filtre texte (pseudo ou lieu) et tri (pseudo / trouvailles / dernière
  connexion) appliqués **côté client**, sans requête réseau.
- Bouton **Rafraîchir** → `?force=true`.
- Rechargement automatique sur l'événement `geoapp-auth-changed` émis par le
  widget de connexion (l'écouteur est retiré dans `dispose()`).
- Bandeaux d'avertissement si `truncated` (pagination, §8) ou si
  `pending_requests > 0`.
- `this.node.tabIndex = 0` : sans cela, Theia journalise
  *« Widget was activated, but did not accept focus after 2000ms »*.
- Le `content-type` de la réponse est vérifié **avant** `response.json()` : une
  route absente renvoie la page d'erreur HTML de Flask, et le message
  `SyntaxError: Unexpected token '<'` n'aide en rien. Sur 404, le widget
  indique explicitement que le backend doit être redémarré.

---

## 8. Pièges et points d'attention

- **Pagination non gérée.** Au-delà d'un certain nombre d'amis, la page ASP.NET
  pagine via `__doPostBack` (contrôle `FriendPager`). Le cas n'a pas pu être
  observé (compte de test : 16 amis, pager vide). Le code le **détecte** —
  `truncated = len(friends) < reported_count`, plus un `logger.warning` et un
  bandeau dans l'UI — mais ne franchit pas les pages. C'est le premier point à
  traiter si un utilisateur signale des amis manquants.
- **`window.friendsCount` n'est pas sur la page amis** (seulement sur le
  dashboard) : le compteur vient de l'onglet `lnkMyFriends`. Piège vérifié en
  conditions réelles.
- **Dépendance au HTML de geocaching.com.** Les tests de caractérisation
  documentent la structure attendue ; ils utilisent une **fixture synthétique**,
  pas un dump réel — la page contient des données personnelles de tiers
  (pseudos, lieux, dates de connexion), qui n'ont rien à faire dans le dépôt.
- **Redémarrage du backend** obligatoire après l'ajout du blueprint : un
  processus Flask déjà lancé renvoie 404 en HTML sur `/api/friends`.
- **Libellés traduits** : ne jamais ancrer un parsing sur `Found:`, `Member
  Since:` etc. — la langue suit le paramétrage du compte.
- **Le flux « communauté » contient vos propres logs** : ce n'est pas un bug de
  l'API, c'est sa définition (« Show you and your friends' latest activity »).
  D'où la colonne `is_self` et le paramètre `include_self` (§9.3).
- **Le plafond du flux est silencieux** : le serveur ne signale pas qu'il a
  tronqué. Seule la comparaison au `SERVER_ITEM_CAP` permet de s'en douter — d'où
  le `warning` et l'intérêt de synchroniser souvent plutôt que profond.

---

## 9. Le flux d'activité des amis

### 9.1 La source distante

```
GET https://www.geocaching.com/api/proxy/web/v1/activities/account/{referenceCode}/api
    ?activitySince=YYYY-MM-DD&activityType=2
```

Endpoint interne du site, découvert en analysant le bundle
`dashboard-react-entry.js` — non documenté côté Groundspeak.

- `referenceCode` : le code `PRxxxxx` du compte connecté, déjà exposé par
  `UserInfo.reference_code` (§ authentification). Sans lui, le serveur répond
  **403 `user may not request another user's activities`**.
- `activityType` : **1** = moi, **2** = communauté (= mes amis **+ moi**),
  **3** = mes caches, **4** = collègues. Constantes `ACTIVITY_TYPE_*`.
- Réponse : liste (ou `{data: [...]}`) d'entrées contenant le type de log, les
  dates, **le texte du log**, le nom et le code GC de la cache, D/T, les
  coordonnées, les points favoris, le nombre d'images, et l'auteur (pseudo,
  avatar, code `PRxxxxx`).
- Variante événements, non implémentée :
  `.../activities/account/{referenceCode}/events`.

**Plafond serveur ~100 entrées** quelle que soit la profondeur demandée
(`activitySince` à -180 j ne remonte pas plus loin qu'environ 60 j). Le client
journalise un `warning` quand la réponse atteint `SERVER_ITEM_CAP` : c'est le
signal qu'il faut synchroniser plus souvent sur des fenêtres plus courtes.

> ⚠️ La page amis fournit un **GUID**, ce flux un **code `PRxxxxx`** et un
> `accountId`. La seule clé de jointure directe entre les deux est le **pseudo**.

### 9.2 Découpage du code

Deux modules volontairement séparés, chacun testable isolément :

| Module | Rôle | Dépendances |
|--------|------|-------------|
| `geocaching_friend_activity.py` | HTTP + parsing → `FriendActivityItem` | réseau, **pas** de base |
| `friend_activity_store.py` | upsert, requêtes, dernière synchro | base, **pas** de réseau |

`LOG_TYPE_LABELS` traduit les `logTypeId` (2 = « a trouvé », 3 = « n'a pas
trouvé », 9 = « participera à »…). La table est la transposition de
`window.logFormats`, exposé par le dashboard geocaching.com — donc exhaustive et
fiable, plutôt que devinée. Un id inconnu n'est pas une erreur : l'entrée est
conservée avec `log_type_label = null`.

Détail de parsing : les dates de l'API ont **7 décimales**
(`2026-07-26T12:52:52.4075283`), que `datetime.fromisoformat` refuse avant
Python 3.11 — elles sont tronquées à 6 avant conversion.

### 9.3 Stockage incrémental — table `friend_activity`

C'est la réponse au plafond serveur : on accumule localement ce que le flux
distant finit par oublier.

- **Clé de déduplication** : `log_reference_code` (GLxxxxx), unique et indexé.
- **Upsert** : une entrée déjà connue est *rafraîchie* (l'ami peut éditer son
  log) ; `first_seen_at` n'est jamais modifié, `last_seen_at` l'est.
- **`is_self`** : le flux « communauté » mélange mes logs et ceux de mes amis.
  Le drapeau est posé à la synchronisation (où l'utilisateur connecté est
  connu), ce qui garde la lecture 100 % locale. `_backfill_self_flags()` répare
  à chaque synchro les lignes dont le drapeau est `NULL` — anciennes lignes ou
  entrées sorties de la fenêtre distante.
- La colonne `is_self` a été ajoutée après coup : comme `db.create_all()` ne
  modifie pas une table existante, elle est aussi gérée par les
  **micro-migrations SQLite** de `database.py`, comme le reste du projet.

### 9.4 API REST

| Route | Rôle |
|-------|------|
| `GET /api/friends/activity` | Lit le flux **stocké** — aucune requête vers geocaching.com |
| `POST /api/friends/activity/sync` | Récupère le flux distant et l'accumule (`{"days": 7}`) |

Query params de la lecture : `limit` (max 200), `offset`, `author`,
`log_types` (ids séparés par des virgules), `include_self`.
La réponse joint `authors` (pour peupler le filtre), `log_type_labels` et
`last_sync_at`. La synchro retourne un bilan `{fetched, created, updated}`.

### 9.5 Frontend — widget « Activité des amis »

`GeocachingFriendActivityWidget` (ID `geocaching-friend-activity-widget`),
accessible depuis le menu du compte, *View → Views* et la commande
`GeoApp: Activité des amis`.

- Timeline groupée par jour (« Aujourd'hui », « Hier », puis date longue).
- Filtres ami / type de log / « Mes logs », appliqués **côté serveur** (donc
  cohérents avec la pagination) ; profondeur de synchro 7/14/30 jours.
- Pagination « Charger plus » par tranches de 50.
- Notes longues repliées derrière « Voir plus » (seuil 320 caractères).
- Réutilise `LogTypeIcon` (smiley jaune / tête bleue) pour les logs 2 et 3.
- **Synchronisation automatique** à l'ouverture si la dernière date de plus
  d'une heure — sinon le widget s'ouvre instantanément sur les données locales.

---

## 10. Logs d'amis sur une cache donnée (méthode c:geo)

C'est la fonctionnalité qui a lancé toute cette exploration : voir, sur la fiche
d'une cache, ce que mes amis en ont dit.

### 10.1 Le mécanisme

```
GET https://www.geocaching.com/seek/geocache.logbook
    ?tkn=<userToken>&idx=1&num=25&decrypt=false&sf=true
```

- `sf=true` → logs des amis · `sp=true` → mes logs · `showOwnerOnly=true` → logs
  de l'owner. **C'est le serveur qui filtre**, selon la liste d'amis du compte
  connecté : rien à croiser côté client.
- Le `userToken` s'extrait de la page de la cache (`userToken\s*=\s*'([^']+)'`).

### 10.2 `get_logs_with_friends()`

Ajoutée à `GeocachingLogsClient` (`services/geocaching_logs.py`), elle retourne
`(logs, external_ids des logs d'amis)` et **n'extrait le `userToken` qu'une
fois** pour ses deux appels au logbook — soit 3 requêtes au lieu de 4.

Subtilité qui fait tout l'intérêt du filtre serveur : `sf=true` s'applique à
**tous** les logs de la cache, pas seulement aux `num` plus récents. Un ami ayant
logué la cache il y a cinq ans ressort donc même si l'on ne télécharge que les 25
derniers logs — ces entrées hors fenêtre sont ajoutées au résultat.

### 10.3 Stockage et API

- `GeocacheLog.is_friend_log` (booléen indexé), renseigné à chaque
  `POST /api/geocaches/<id>/logs/refresh`, qui retourne aussi `friends` dans son
  bilan.
- `GET /api/geocaches/<id>/logs` accepte `friends_only=true` et retourne
  systématiquement `friends_count` — un compteur **indépendant des filtres
  courants**, pour que l'UI sache s'il y a quelque chose à filtrer sans avoir à
  faire une seconde requête.
- Colonne ajoutée sur une table existante : gérée par les micro-migrations
  SQLite de `database.py` **et** par une migration Alembic
  (`add_geocache_log_is_friend_log.py`).

### 10.4 Frontend

Dans le widget Logs de la fiche cache
([geocache-logs-widget.tsx](../frontend/theia-extensions/zones/src/browser/geocache-logs-widget.tsx)) :

- badge « ami » sous l'auteur des logs concernés ;
- bouton bascule **Amis (n)** dans l'en-tête, filtrage **côté serveur** (donc
  cohérent avec la pagination), désactivé tant qu'aucun log d'ami n'est connu ;
- le bilan de rafraîchissement mentionne le nombre de logs d'amis.

> Le drapeau n'est renseigné qu'au rafraîchissement des logs : sur une cache dont
> les logs ont été importés avant cette fonctionnalité, le bouton reste inactif
> jusqu'au prochain « Rafraîchir ».

---

## 11. Tests

Aucun test ne touche le réseau : le parsing est exposé en méthodes de classe
pures, et la synchronisation accepte un client injecté.

`test_geocaching_friends.py` (5 tests) — liste d'amis :

- parsing complet de deux amis, dont les conversions de dates/nombres ;
- détection de pagination (`truncated`) ;
- liste vide valide ;
- page inconnue → `GeocachingFriendsError` ;
- champs optionnels absents → parsing dégradé mais non bloquant.

`test_friend_activity.py` (12 tests) — flux d'activité :

- parsing d'une entrée (dont l'extraction du code `PRxxxxx` et la troncature des
  dates à 7 décimales), payload liste nue, entrée condensée, type de log inconnu,
  entrée sans `logReferenceCode` ignorée, payload aberrant → erreur ;
- synchronisation **idempotente** (deux passes → aucun doublon), rafraîchissement
  d'un log édité sans toucher `first_seen_at` ;
- marquage `is_self` et son backfill ;
- filtres, tri, pagination, `list_authors()` ;
- routes REST : lecture du flux stocké et rejet des paramètres invalides.

`test_geocache_friend_logs.py` (5 tests) — logs d'amis par cache :

- identification des logs d'amis avec **un seul** fetch du `userToken` (la
  session simulée vérifie l'ordre et les paramètres des appels) ;
- log d'ami hors fenêtre ajouté au résultat ;
- absence de logs d'amis, `userToken` introuvable → dégradation propre ;
- routes : exposition de `is_friend_log`, `friends_count` et `friends_only`.

---

## 12. Références croisées

- Authentification et session partagée —
  [connexion-geocaching-technique.md](connexion-geocaching-technique.md).
- Backend général — [backend-technique.md](backend-technique.md).
- Frontend général — [frontend-technique.md](frontend-technique.md).
