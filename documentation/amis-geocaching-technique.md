# Amis Geocaching.com — Documentation technique

> Tout ce que GeoApp sait faire autour des amis Geocaching.com :
> **(1) la liste d'amis** (§3-7), **(2) le flux d'activité** (§9),
> **(3) les logs d'amis sur une cache** (§10), **(4) « qui a trouvé quoi »**
> (§11) et **(5) la carte des découvertes** (§12-13).
> Dernière mise à jour : septembre 2026 (pagination, synchro auto, suggestions, stats, fraîcheur, throttling adaptatif).

---

## 0. Les quatre sources de trouvailles

Le point le plus important de ce document, et celui qui a coûté le plus
d'allers-retours : **aucune source ne donne à elle seule les trouvailles d'un
ami**. Quatre chemins existent, chacun avec sa lacune propre, et ils convergent
tous vers la même table `friend_find` (§11.5).

| Source | `source` | Portée | Lacune |
|--------|----------|--------|--------|
| Flux d'activité (§9) | `activity` | ~2 mois glissants | **Condense les trouvailles** (§9.2) : une seule cache nommée par groupe |
| Recherche par profil (§11.2) | `profile_search` | ~10 000 plus récentes, monde entier | Plafond de pagination ; caches archivées absentes |
| Déduction par zone (§11.1) | `zone_search` | Tout l'historique, une boîte | Bornée géographiquement ; caches archivées absentes |
| Logs d'une cache (§10) | `cache_logs` | Une cache, y compris archivée | Une cache à la fois |

Le symptôme classique — « j'ai tous les DNF de mes amis mais pas tous les
*Found it* » — vient de la **condensation** du flux (§9.2), pas d'un bug.
Les DNF sont isolés dans le temps donc jamais regroupés ; les trouvailles, si.

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
   POST /api/friends/activity/sync            GET /api/friends/activity[/map]
              │                                          │
   ┌──────────▼──────────┐                    ┌──────────▼──────────┐
   │ client HTTP + parse │  ~100 max          │  table              │
   │ geocaching.com      ├──── upsert ───────►│  friend_activity    │
   └─────────────────────┘  (dédup GLxxxxx)   └─────────────────────┘
```

Les **trouvailles** (§11) convergent des quatre sources du §0 vers une table
unique, que la carte et le tableau de zone lisent sans jamais toucher au réseau :

```
  flux d'activité ──┐                         GET /api/friends/finds/map
  profil (fb)     ──┤   store_finds()                     │
  zone (nfb)      ──┼──── (source=…) ────► friend_find ───┤
  logs d'une cache ─┘                          │          │
                                               │   POST …/finds/import
                                               ▼          ▼
                                        zone « Amis » (masquée)
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
├── friend_activity_scheduler.py    # Flux d'activité : synchro auto en arrière-plan (§9.5)
├── geocaching_logs.py              # get_logs_with_friends() : logs d'amis par cache (§10)
└── geocaching_friend_finds.py      # Trouvailles : déduction par zone (§11), recherche
                                    #   par profil (§11.2), zone « Amis » (§13.4)

backend/gc_backend/
├── models.py                       # Zone.is_hidden, FriendActivity, FriendFind
├── database.py                     # Micro-migrations SQLite + création de la zone « Amis »
└── blueprints/friends.py           # Routes REST /api/friends[...]
    blueprints/zones.py             # GET /api/zones?include_hidden (§13.4)

backend/migrations/versions/
├── add_friend_activity_table.py           # Création de la table friend_activity
├── add_geocache_log_is_friend_log.py      # Drapeau is_friend_log sur les logs
├── add_friend_find_table.py               # Création de la table friend_find
└── add_friend_map_columns.py              # Coordonnées friend_find + zone.is_hidden (§13)

backend/tests/
├── test_geocaching_friends.py      # Parser de la liste d'amis (fixture synthétique)
├── test_friend_activity.py         # Parser du flux + stockage + routes
├── test_friend_activity_scheduler.py # Synchro auto + projection incrémentale (§9.5)
├── test_geocache_friend_logs.py    # Logs d'amis par cache + routes
├── test_friend_finds.py            # Déduction par zone, rate limit, stockage
├── test_friend_finds_suggestions.py # Suggestions « caches à faire » (§13.5)
├── test_friend_stats.py            # Statistiques croisées entre amis (§13.6)
├── test_friend_freshness.py        # Tableau de bord de fraîcheur (§13.7)
├── test_friend_finds_throttling.py # Throttling 429 adaptatif (§11.3)
├── test_friend_activity_map.py     # Agrégation cartographique du flux (§12)
└── test_friend_finds_map.py        # Coordonnées déduites, zone « Amis », import (§13)

frontend/theia-extensions/zones/src/browser/
├── geocaching-friends-widget.tsx           # Widget « Amis Geocaching »
├── geocaching-friend-activity-widget.tsx   # Widget « Activité des amis »
├── geocache-logs-widget.tsx                # Badge « ami » + filtre dans les logs d'une cache
├── geocache-friend-finds-banner.tsx        # Bandeau « N amis ont trouvé » + Message Center
├── map/map-widget-factory.ts               # openFriendsMap() : carte des amis à id fixe (§12)
├── map/map-widget.tsx                      # Contexte 'friends' (MapWidget.FRIENDS_ID)
├── map/map-layer-manager.ts                # MapGeocache.friendsNote (§12.3)
├── zones-tree-widget.tsx                   # Zone « Amis » masquée selon la préférence
├── geocaches-table.tsx                     # Colonne « Amis » du tableau de zone
├── zone-geocaches-widget.tsx               # Analyse d'une zone (progression, estimation)
├── zones-command-contribution.ts           # Commandes geoapp.friends[.activity].open
├── zones-menu-contribution.ts              # Entrées View > Views
├── geoapp-sidebar-contribution.ts          # Entrées du menu compte
└── zones-frontend-module.ts                # Bindings DI + WidgetFactory

shared/preferences/geo-preferences-schema.json
├── geoApp.friends.map.autoLoad             # Ouvrir la carte des amis automatiquement (§12.4)
├── geoApp.friends.zone.visible             # Afficher la zone « Amis » dans l'arbre (§13.4)
├── geoApp.friends.activity.autoSync        # Synchro auto du flux en arrière-plan (§9.5)
├── geoApp.friends.activity.autoSyncIntervalHours  # Intervalle entre deux syncs auto (§9.5)
└── geoApp.friends.activity.autoSyncDays    # Profondeur de chaque sync auto en jours (§9.5)
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
    pages_fetched: int = 1         # nombre de pages parcourues (pagination ASP.NET)
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
- **Pagination ASP.NET** : au-delà d'un certain nombre d'amis, la page pagine
  via `__doPostBack` (contrôle `FriendPager`). Le client parcourt
  automatiquement toutes les pages en rejouant le postback (`__VIEWSTATE` etc.),
  avec une limite de sécurité `MAX_PAGES = 50`. Déduplication par pseudo.
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
  "pages_fetched": 1,
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

- **Pagination ASP.NET gérée par postback.** Au-delà d'un certain nombre
  d'amis, la page pagine via `__doPostBack` (contrôle `FriendPager`). Le client
  parcourt automatiquement toutes les pages en rejouant le postback
  (`__VIEWSTATE`, `__EVENTTARGET`, `__EVENTARGUMENT`). La structure exacte du
  pager n'a pas pu être observée (compte de test : 16 amis, pager vide) : la
  détection du postback « page suivante » est donc **défensive** et essaie,
  dans l'ordre : un lien « Next », un lien vers `page courante + 1`, un lien
  vers n'importe quelle page supérieure, et en dernier recours un postback
  unique si la page courante n'a pas pu être identifiée. Limite de sécurité
  `MAX_PAGES = 50` ; déduplication par pseudo. Si le postback échoue (HTTP
  non-200, session expirée), on conserve ce qui a déjà été collecté. Le
  bandeau `truncated` de l'UI ne devrait plus apparaître sauf si la limite
  de sécurité est atteinte ou si la pagination échoue silencieusement.
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
  D'où la colonne `is_self` et le paramètre `include_self` (§9.4).
- **Le plafond du flux est silencieux** : le serveur ne signale pas qu'il a
  tronqué. Seule la comparaison au `SERVER_ITEM_CAP` permet de s'en douter — d'où
  le `warning` et l'intérêt de synchroniser souvent plutôt que profond.
- **Le flux condense les trouvailles** (§9.2) : plusieurs logs d'affilée
  deviennent une entrée unique dont une seule cache est nommée. C'est la cause
  du symptôme « j'ai tous les DNF mais pas tous les Found it ». Ne jamais
  présenter le flux comme la liste exhaustive des trouvailles d'un ami.
- **« Ce filtre ne marche pas » mérite d'être re-testé sous une autre forme.**
  `fb` a été catalogué inutilisable pendant des mois (§11.1) alors qu'il
  fonctionne sans boîte et avec `sort=founddate` (§11.2). Sur une API non
  documentée, un paramètre ignoré signifie « pas dans cette combinaison », pas
  « jamais ».
- **Deux vocabulaires de types de cache coexistent** : le scraper dit
  `Mega-Event`, la recherche web `MegaEvent`. La table d'icônes du frontend est
  calée sur le premier. Se tromper donne une icône générique sur tous les events,
  sans la moindre erreur (§12.1).
- **Une zone technique doit exister dès qu'on peut demander à la voir.** Créée
  seulement à l'import, la zone « Amis » restait invisible et la préférence
  semblait cassée (§13.4).
- **Les features OpenLayers sont indexées par id** : donner `0` à toutes les
  caches non importées les fait entrer en collision, une seule survit (§12.3).

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

### 9.2 Le flux n'est pas exhaustif — la condensation

> ⚠️ **Le piège le plus trompeur de toute cette fonctionnalité.**

Quand un ami logue plusieurs caches d'affilée, geocaching.com ne renvoie **pas**
une entrée par cache : il renvoie **une seule** entrée portant `isCondensed` et
`condensedCount`. Une cache est nommée, les autres ne sont transmises **nulle
part** dans la réponse — ni code GC, ni coordonnées, ni identifiant de log.

Les DNF, eux, sont presque toujours isolés dans le temps : ils apparaissent donc
tous individuellement. D'où le symptôme, constaté en conditions réelles et
parfaitement contre-intuitif :

> « J'ai tous les DNF de mes amis, mais clairement pas tous les *Found it*. »

Mesure sur un compte réel : 15 entrées de type « trouvé », dont **6 condensées
représentant 123 trouvailles**. Le flux couvrait donc ~132 trouvailles mais n'en
nommait que 15 — **117 caches invisibles**, sans le moindre message d'erreur.

`count_hidden_condensed()` somme les `condensedCount` et le champ
`condensed_hidden` de `GET /api/friends/activity` le remonte : l'interface
affiche un bandeau d'avertissement plutôt que de laisser croire le flux complet.

Ces entrées ne sont pas dépliables : les données ne sont pas dans la réponse. La
parade est d'aller chercher les trouvailles **ailleurs** — soit la déduction par
zone (§11), soit la recherche par profil (§11bis), qui est la réponse directe à
ce problème.

**Plafond serveur ~100 entrées** quelle que soit la profondeur demandée
(`activitySince` à -180 j ne remonte pas plus loin qu'environ 60 j). Le client
journalise un `warning` quand la réponse atteint `SERVER_ITEM_CAP` : c'est le
signal qu'il faut synchroniser plus souvent sur des fenêtres plus courtes.

> ⚠️ La page amis fournit un **GUID**, ce flux un **code `PRxxxxx`** et un
> `accountId`. La seule clé de jointure directe entre les deux est le **pseudo**.

### 9.3 Découpage du code

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

### 9.4 Stockage incrémental — table `friend_activity`

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

### 9.5 API REST et synchronisation automatique

| Route | Rôle |
|-------|------|
| `GET /api/friends/activity` | Lit le flux **stocké** — aucune requête vers geocaching.com |
| `POST /api/friends/activity/sync` | Récupère le flux distant et l'accumule (`{"days": 7}`) |

Query params de la lecture : `limit` (max 200), `offset`, `author`,
`log_types` (ids séparés par des virgules), `include_self`.
La réponse joint `authors` (pour peupler le filtre), `log_type_labels` et
`last_sync_at`. La synchro retourne un bilan `{fetched, created, updated,
finds_projected}`.

**Synchronisation automatique en arrière-plan** (`friend_activity_scheduler.py`) :
le flux distant est plafonné (~100 entrées, fenêtre ~60 j) — sans synchro
régulière, les entrées qui sortent de la fenêtre sont perdues. Un thread daemon
démarré au lancement du backend (hors tests/migrations) vérifie toutes les 5 min
si une synchro est nécessaire et la déclenche le cas échéant. Conditions :

- l'utilisateur est connecté à Geocaching.com ;
- la préférence `geoApp.friends.activity.autoSync` est activée (défaut : oui) ;
- la dernière synchro date de plus que `autoSyncIntervalHours` (défaut : 1 h) ;
- fenêtre de synchro : `autoSyncDays` (défaut : 7 jours).

Une synchro échouée (session expirée, réseau…) est journalisée et le thread
continue : le prochain cycle réessaiera. Le scheduler ne tourne pas pendant les
tests (`is_testing`) ni les migrations (`is_migration`).

### 9.6 Frontend — widget « Activité des amis »

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

## 11. « Qui a trouvé quoi » sur une zone — sans limite de date

Le flux d'activité (§9) plafonne à ~2 mois, et le logbook (§10) demande d'ouvrir
les caches une par une. Pour savoir d'un coup, sur toute une zone, quelles caches
chacun de mes amis a trouvées — y compris il y a dix ans — il existe un
troisième chemin.

### 11.1 Sur une zone bornée : `nfb` par complément

La recherche web `https://www.geocaching.com/api/proxy/web/search/v2` accepte
deux filtres joueur : `fb` (found by) et `nfb` (not found by). Vérifié en
conditions réelles :

- **`fb` envoyé avec une boîte et le tri par défaut est silencieusement ignoré** :
  le serveur renvoie l'index mondial entier (3 474 749 caches), exactement comme
  une requête sans filtre. c:geo l'envoie pourtant toujours
  (`GCWebAPI.WebApiSearch.addFoundBy`) : dans cette forme, ce code ne filtre
  plus rien.

  > ⚠️ Cette observation a longtemps été résumée en « `fb` ne marche pas ».
  > C'est faux : envoyé **autrement** — sans boîte et avec `sort=founddate` — il
  > fonctionne. Voir §11.2. Le raccourci a coûté plusieurs mois d'une
  > fonctionnalité qu'on croyait impossible.

- **`nfb` fonctionne** avec une boîte. Les trouvailles d'un ami sur une zone
  s'obtiennent donc **par complément** :

```
trouvées_par(ami) = caches_de_la_boîte - caches_non_trouvées_par(ami)
```

Autres paramètres utiles : `box=latMax,lonMin,latMin,lonMax`, `origin=lat,lon`,
`take`/`skip` (100 max par page ; le serveur refuse `skip+take` au-delà de
~10 000), `hb` (hidden by, qui fonctionne aussi).

### 11.2 `fb` fonctionne — mais pas comme on l'avait testé

La conclusion ci-dessus (« `fb` est silencieusement ignoré ») portait sur un
appel **avec boîte englobante et tri par défaut**. La page « Geocaches found »
d'un profil, elle, appelle la même API autrement :

```
/play/results?sort=founddate&asc=false&fb=<pseudo>
```

Deux différences décisives : **`sort=founddate`** — qui n'a de sens que si le
filtre joueur s'applique — et **aucune borne géographique**.
`search_finds_by(username)` reproduit cet appel et donne les trouvailles d'un
ami une par une, de la plus récente à la plus ancienne. C'est la réponse directe
à la condensation du flux (§9.2) : les trouvailles masquées par un groupe
sont justement les plus récentes.

> ⚠️ **Le mode d'échec de `fb` est silencieux** : aucune erreur HTTP, juste
> l'index mondial (~3,5 M) présenté comme les trouvailles de l'ami. D'où
> `FilterIgnoredError`, levée dès que le total dépasse `MAX_PLAUSIBLE_FINDS`
> (500 000 — le record mondial est de l'ordre de 200 000). Sans ce garde-fou, un
> changement côté Groundspeak nous ferait importer l'index entier sans que rien
> ne le signale.

Deux limites héritées de l'API :

- **plafond de pagination** : le serveur refuse `skip + take` au-delà de
  ~10 000 (`MAX_SKIP`). Au-delà, seules les trouvailles les plus récentes sont
  atteignables — d'où l'importance du tri décroissant ;
- **caches archivées** absentes de l'index, comme pour la déduction (§11.3).

Routes : `GET /api/friends/finds/friend/<pseudo>/estimate` (coût en une requête)
et `POST /api/friends/finds/sync-friend`. Stockage en `source='profile_search'`,
**sans `replace_scope`** : cette recherche n'étant pas exhaustive, elle n'a
aucune autorité pour supprimer une trouvaille connue par une autre source.

Côté interface, le bouton **« Compléter depuis le profil »** apparaît dans le
bandeau de condensation dès qu'un ami est sélectionné dans le filtre.

### 11.3 Ce que la déduction ne voit pas

- **Les caches archivées** sont absentes de l'index de recherche : elles
  n'apparaissent ni dans la référence ni dans le complément. Écart mesuré sur un
  ami affichant 53 860 trouvailles : le filtre n'en voit que ~28 700.
- **« Trouvée » ≠ « loguée »** : un DNF d'ami ne ressort pas ici. Seul le
  logbook par cache (§10) le donne.
- Plusieurs filtres de cette API sont réservés aux membres **Premium** (le
  comportement en compte Basic n'a pas été vérifié).

### 11.4 Le débit est la vraie contrainte

Cette API renvoie **429 « Too many requests »** très vite. L'en-tête
`Retry-After` est parfois absent, parfois présent (en secondes ou en date HTTP) :
le client le lit quand il est là, et retombe sur un backoff exponentiel avec
jitter sinon. c:geo ne retente rien et se contente d'avertir l'utilisateur.

Le client s'auto-limite donc à ~10 requêtes/minute (`MIN_INTERVAL_SECONDS = 6`)
et retente sur 429 avec une stratégie adaptative à trois niveaux :

1. **Retry-After** : si le serveur indique un délai (secondes ou date HTTP), il
   est respecté (plafonné à 5 min) ;
2. **Backoff exponentiel avec jitter** : `base × 2^attempt + jitter` (base 10 s,
   jitter 0–5 s, plafond 5 min), jusqu'à 5 tentatives ;
3. **Interval adaptatif** : après un 429, l'interval de base est doublé (plafond
   60 s) ; après 3 succès consécutifs, il décroît vers sa valeur nominale (×0.9).

Après épuisement des tentatives, `RateLimitedError` → **HTTP 429** côté API, que
l'interface traduit par un arrêt propre de l'analyse en conservant ce qui a déjà
été collecté.

La référence de zone (la recherche sans filtre) est mise en cache 10 minutes :
elle est identique pour tous les amis d'une même passe. Coût réel mesuré :

| Zone | Caches | Boîte balayée | 1er ami | Amis suivants |
|------|--------|---------------|---------|---------------|
| Rudemont (dense) | 43 | 166 | 13 s | 6 s |
| Dordogne/Gironde (dispersée) | 5 | **1 408** | 171 s | 90 s |

> ⚠️ **La géométrie de la zone fait tout.** Cinq caches éparpillées sur deux
> départements produisent une boîte englobante de 1 400 caches — et 25 minutes
> d'analyse pour un résultat quasi nul. D'où la route `…/estimate`, qui mesure la
> boîte en **une** requête ; l'interface demande confirmation quand la boîte
> dépasse 10× la taille de la zone.

Pour une zone dispersée, rafraîchir les logs des caches une à une (§10) revient
moins cher, et donne en prime les DNF et tous les amis d'un coup.

### 11.5 Stockage : `friend_find`

Table volontairement simple : `(friend_username, gc_code, source)`, contrainte
d'unicité sur le couple ami/cache. On stocke le **code GC** et non une clé
étrangère : une cache trouvée par un ami n'est pas forcément importée dans
GeoApp — le jour où on l'importe, l'information est déjà là.

Deux sources convergent vers cette table :

| `source` | Origine | Portée |
|----------|---------|--------|
| `zone_search` | complément `nfb` (§11.1) | toute la boîte, tout l'historique |
| `cache_logs` | logs d'amis au rafraîchissement (§10) | une cache, y compris archivée |
| `profile_search` | recherche par profil `fb` (§11.2) | ~10 000 trouvailles les plus récentes, sans borne géographique |
| `activity` | flux d'activité (§13.2) | les trouvailles nommées du flux récent |

`store_finds(..., replace_scope=…)` permet à une resynchronisation de corriger
une donnée devenue fausse, **sans toucher aux lignes d'une autre source** : la
déduction de zone est aveugle aux caches archivées, elle ne doit pas effacer un
log d'ami avéré.

### 11.6 API et interface

| Route | Rôle |
|-------|------|
| `GET /api/friends/finds/zone/<id>/estimate` | Coût prévisible (1 requête) |
| `POST /api/friends/finds/sync-zone` | Analyse **un** ami sur une zone |
| `GET /api/friends/finds/zone/<id>` | `{ gc_code: [pseudos] }`, purement local |
| `GET /api/friends/finds/geocache/<id>` | Amis ayant trouvé une cache + lien Message Center |

Un seul ami par appel de synchronisation : la référence étant en cache, boucler
ami par ami ne coûte presque rien de plus qu'une passe globale, tout en donnant
une **progression réelle** à l'interface et un point d'arrêt net en cas de 429.

Côté UI :
- bouton **👥 Amis** dans la barre d'outils de la zone, affichant `3/16…`
  pendant l'analyse ;
- colonne **👥** dans le tableau (nombre d'amis, pseudos en infobulle),
  activable via le sélecteur de colonnes ;
- **bandeau dans la fiche cache** : « 3 de vos amis ont trouvé cette
  géocache », chaque pseudo doublé d'un lien vers le **Message Center**
  (`/account/messagecenter?recipientId=<guid>`, GUID pris dans la liste d'amis).
  C'est le chaînon entre « je sèche sur cette mystery » et « je demande ».

---

## 12. La carte des amis

Les découvertes du flux d'activité (§9) sur une carte GeoApp. **Aucune requête
vers geocaching.com** : `friend_activity` stocke déjà `latitude`, `longitude`,
`cache_reference_code`, `cache_type_id` et les D/T. La carte lit la base, rien
d'autre.

### 12.1 `GET /api/friends/activity/map`

Sœur de `GET /api/friends/activity`, mais taillée pour la carte : **pas de
pagination** (une carte tronquée serait trompeuse), pas de `note` ni
d'`action_url`, et **un point par cache** au lieu d'un par log. Mêmes filtres
`author` / `log_types` / `include_self` que la timeline — c'est
`_filtered_query()` qui les factorise, précisément pour que les deux vues ne
puissent pas diverger — plus une fenêtre `days` optionnelle.

Trois traitements côté serveur (`friend_activity_store.query_map_points()`) :

1. **Dédoublonnage par `cache_reference_code`** : plusieurs amis sur la même
   cache donnent un seul point, les auteurs agrégés dans `friends`. Les logs
   sans code GC ne sont pas regroupés entre eux (le code du log sert de clé).
2. **Jointure avec `Geocache`** sur le code GC : `geocache_id` réel et `found`
   quand la cache est importée, `0` sinon. C'est ce qui permet à la popup
   d'ouvrir la fiche d'un clic.
3. **Traduction du `cache_type_id`** par `_cache_type_label()`, qui interroge
   d'abord `GEOCACHING_CACHE_TYPE_ID_MAP` (vocabulaire du scraper) puis, en
   repli, `GEOCACHE_TYPE_MAP` (vocabulaire de la recherche web).

> ⚠️ **Les deux vocabulaires ne coïncident pas.** La recherche web dit
> `MegaEvent`, le scraper `Mega-Event` ; la table d'icônes du frontend est calée
> sur le second. Utiliser le mauvais donne une icône générique sur tous les
> events, sans la moindre erreur visible. D'où l'ordre de priorité.

`limit` (défaut 2000, plafond 5000) n'est qu'un garde-fou, signalé par
`truncated`. Les entrées sans coordonnées sont exclues et comptées dans
`without_coordinates` : c'est censé être nul, le compteur sert à repérer une
évolution du flux distant plutôt qu'à la subir en silence.

### 12.2 Contexte de carte `friends` — identifiant fixe

`openCustomMap()` crée une **nouvelle** carte à chaque appel : inutilisable pour
une carte pilotée par des filtres, qui doit se recharger en place. D'où un
contexte dédié `type: 'friends'`, d'identifiant fixe `MapWidget.FRIENDS_ID`
(`geoapp-map-friends`) : `openFriendsMap()` crée la carte au premier appel et
recharge les points aux suivants, sans empiler d'onglets.

`isFriendsMapOpen()` permet au widget d'activité de ne recharger la carte que
si elle est ouverte : un changement de filtre ne doit pas rouvrir un onglet que
l'utilisateur vient de fermer.

### 12.3 Deux pièges de la couche OpenLayers

**Les features sont indexées par id.** `addGeocache()` fait
`feature.setId(geocache.id)` et `syncGeocaches()` diffe par id. Donner `0` à
toutes les caches non importées les ferait entrer en collision : une seule
survivrait. Le frontend leur attribue donc un **id négatif unique**
(`--syntheticId`). Le prédicat `id > 0` de la popup reste par ailleurs ce qui
distingue « cache dans GeoApp, ouvrable » de « cache seulement connue par le
flux ».

**Les propriétés des features sont une liste blanche.** Le `note` déjà affiché
par la popup n'est transmis que pour les coordonnées détectées, pas pour les
géocaches. La ligne « 👥 Trouvée par … » a donc demandé un champ dédié
`friendsNote`, propagé dans `MapGeocache`, `GeocacheFeatureProperties`,
`addGeocache()`, `applyGeocacheProperties()` **et** dans
`computeGeocacheSignature()` — sans ce dernier, un changement de filtre ne
redessinerait pas les popups.

### 12.4 Interface

Bouton **🌐 Carte** dans la barre d'outils du widget « Activité des amis ».
La carte suit ensuite les filtres (ami, type de log, « Mes logs ») et les
synchronisations. Un bandeau annonce le bilan : nombre de caches placées,
troncature éventuelle, logs sans coordonnées.

Ouverture automatique à l'ouverture du widget, réglable par la préférence
`geoApp.friends.map.autoLoad` (activée par défaut, section *Amis* de la
catégorie *Carte*).

> **Pas de fenêtre de dates par défaut.** L'API accepte `days`, mais l'interface
> ne l'envoie pas : la carte doit montrer exactement ce que la timeline affiche.
> Le sélecteur « 7 / 14 / 30 jours » de la barre d'outils règle la **profondeur
> de synchronisation**, pas l'affichage — les confondre ferait diverger les deux
> vues.

---

## 13. Les trouvailles déduites sur la carte

Le §12 cartographie le flux récent. Cette section-ci cartographie `friend_find`
(§11), c'est-à-dire **tout l'historique** — et règle son problème d'origine :
cette table ne stockait qu'un code GC, sans coordonnées.

### 13.1 Les coordonnées étaient déjà là

`trouvées(ami) = référence − complément(nfb)`. La **référence** est une
recherche web sans filtre, dont chaque enregistrement contient déjà le nom, le
type et les coordonnées de la cache. Le code n'en gardait que `code`.

`search_summaries()` remplace donc `search_codes()` comme primitive (celle-ci
délègue désormais) et retourne des `CacheSummary`. Le cache de référence stocke
ces résumés plutôt que des codes bruts ; `find_codes_found_by()` les reporte
dans `FriendFindsResult.summaries`, et `store_finds(..., summaries=…)` les écrit
dans les colonnes `latitude`, `longitude`, `cache_name`, `cache_type` de
`friend_find`.

L'extraction réutilise `GeocachingSearchClient._extract_lat_lon()` et
`_extract_extra_fields()` : les formes de la réponse (`postedCoordinates` /
`coordinates` / champs plats, `geocacheType` dict / int / chaîne) y sont déjà
toutes gérées.

> **Conséquence :** la carte des trouvailles est instantanée et hors ligne. Elle
> n'attend aucun import. Une ligne créée avant ces colonnes est **réparée à la
> resynchronisation suivante**, sans requête supplémentaire (`store_finds` ne
> remplit que ce qui est vide).

`source='cache_logs'` n'apporte pas de coordonnées : la cache est par
construction déjà dans GeoApp, la jointure les fournit.

### 13.2 Le pont flux d'activité → `friend_find`

Les deux sources de trouvailles vivaient dans deux tables qui ne se parlaient
pas. Une cache vue passer dans « Activité des amis » n'apparaissait donc **ni**
dans la colonne « 👥 » du tableau de zone, **ni** sur la carte des trouvailles,
**ni** dans l'import vers la zone « Amis ». Mesuré en conditions réelles : 11 des
12 trouvailles du flux étaient absentes de `friend_find`, dont 10 absentes de
GeoApp — donc invisibles de l'import.

`friend_activity_store.project_finds()`, appelée à chaque synchronisation,
reporte les trouvailles du flux dans `friend_find` avec `source='activity'`.
Elle est **incrémentale** : ne balaie que les lignes dont `last_seen_at` est plus
récent que la dernière projection (`LAST_PROJECTION_KEY` dans `AppConfig`). Au
premier appel (pas de timestamp), elle balaie toute la table pour rattraper
l'historique. `store_finds()` étant idempotent (upsert), projeter deux fois la
même trouvaille est inoffensif — l'incrémental évite juste de re-scanner des
milliers de lignes à chaque synchro, surtout maintenant que la synchro tourne
en arrière-plan toutes les heures.

Trois restrictions, chacune pour une raison précise :

| Restriction | Pourquoi |
|-------------|----------|
| `log_type_id == 2` seulement | « Trouvée » ≠ « loguée » (§11.3) : verser un DNF fausserait le « qui a trouvé quoi » |
| `is_self` exclu | Le flux « communauté » mélange mes propres logs (§9.4) |
| `source='activity'` | Une resynchronisation de zone ne doit pas effacer une trouvaille avérée par le flux (`replace_scope`, §11.5) |

Bénéfice secondaire : le flux **porte les coordonnées**. Une trouvaille projetée
est donc plaçable immédiatement, sans déduction de zone ni import.

La troisième source (`cache_logs`, §10) alimente déjà cette table. Les trois
convergent désormais.

### 13.3 `GET /api/friends/finds/map`

Lecture locale, sans limite de date, filtrable par `friend`. Les coordonnées
sont prises dans cet ordre : `friend_find` d'abord, la géocache importée ensuite.

Ce qui n'a ni l'une ni l'autre alimente deux compteurs volontairement
distincts : `without_coordinates` (nombre de **lignes**) et `importable`
(nombre de **caches**) — c'est ce dernier que l'interface affiche, puisque
c'est ce qu'un import aurait à télécharger.

### 13.4 La zone « Amis » et l'import de fond

Importer une trouvaille d'ami en fait une **vraie géocache GeoApp** : ouvrable,
annotable, résoluble. C'est le seul intérêt restant de l'import — la carte, elle,
n'en a plus besoin (§13.1).

- `Zone.is_hidden` (booléen indexé) marque les zones techniques.
  `get_or_create_friends_zone()` crée « Amis » masquée. Elle est appelée **au
  démarrage** (`database.py`, à côté de la zone « default ») *et* par l'import,
  qui la recrée donc si elle a été supprimée.

  > ⚠️ Piège corrigé après coup : créée uniquement à l'import, la zone n'existait
  > pas tant qu'on n'en avait pas lancé un. Activer la préférence « Zone « Amis »
  > visible » ne montrait alors **rien** — la préférence semblait cassée alors
  > qu'elle demandait bien les zones masquées. Une zone technique doit exister
  > dès qu'on peut demander à la voir, même vide.
- `GET /api/zones` **exclut** les zones masquées, sauf `?include_hidden=true`.
  Seul l'arbre passe ce paramètre, selon `geoApp.friends.zone.visible` ; les
  autres consommateurs (dialogue de déplacement, sélecteur de zone) ne le passent
  pas — « Amis » n'a pas à être une cible de déplacement.
- `POST /api/friends/finds/import` importe les codes de `list_codes_to_import()`
  (trouvailles d'amis absentes de `Geocache`, toutes zones confondues) en
  **streaming JSON ligne par ligne**, comme `import-around` : le frontend sait
  déjà consommer ce format. Le `TaskManager` n'est pas réutilisé — il est dédié à
  l'exécution de plugins.

> ⚠️ **Le volume est la contrainte.** Une requête par cache, plus la respiration
> du scraper : compter ~1,2 s l'unité. Le nombre à importer est borné par la
> boîte englobante des zones analysées, pas par le nombre de trouvailles — donc
> quelques dizaines sur une zone dense, **plus d'un millier** sur une zone
> dispersée (§11.4). D'où la confirmation au-delà de 500 caches, avec durée
> annoncée, et un bouton d'arrêt (`AbortController`) qui conserve ce qui a déjà
> été importé.

### 13.5 Suggestions « caches à faire »

`query_suggestions()` (dans `geocaching_friend_finds.py`) croise `friend_find`
et `Geocache` pour proposer des caches que vos amis ont trouvées mais que vous
n'avez pas (encore) faites. C'est l'utilisation naturelle de la table
`friend_find` : au lieu de cartographier passivement les trouvailles, on en tire
une recommandation active.

**Logique** :

- regroupement des trouvailles par code GC, avec comptage du nombre d'amis
  distincts ;
- jointure `LEFT JOIN` avec `Geocache` pour récupérer nom, type, D/T,
  coordonnées, drapeau `found` et `favorites_count` ;
- exclusion des caches déjà trouvées par moi (`found IS NULL` ou `found = False`)
  sauf si `include_found=True` ;
- tri par popularité décroissante (nombre d'amis), puis par nom.

**Route REST** :

| Route | Rôle |
|-------|------|
| `GET /api/friends/finds/suggestions` | Caches trouvées par ≥N amis mais pas par moi |

Query params : `zone_id` (filtre par zone), `min_friends` (défaut 1, max 50),
`limit` (défaut 50, max 200), `include_found` (défaut false).

**Frontend** : une section repliable « Suggestions de caches à faire » en bas du
widget « Activité des amis ». Affiche pour chaque suggestion le nombre d'amis,
le nom, le code GC, le type, D/T, les favoris, les coordonnées (si connues) et la
liste des amis. Un filtre « min. N ami(s) » permet de monter le seuil pour ne
voir que les caches les plus populaires auprès du cercle d'amis. Les caches non
importées ont un lien direct vers geocaching.com.

### 13.6 Statistiques croisées entre amis

`query_friend_stats()` (dans `geocaching_friend_finds.py`) croise trois sources
pour chaque ami :

- **``friend_find``** : nombre de trouvailles connues (déduction par zone, flux
  d'activité, logs de cache) ;
- **``FriendActivity``** : nombre de logs capturés dans le flux d'activité
  récent (tous types confondus, hors mes propres logs) ;
- **``Geocache.found``** : nombre de caches que j'ai trouvées et que cet ami a
  aussi trouvées (« en commun avec moi »).

Un ami présent dans une seule source (par exemple, vu dans le flux mais sans
trouvaille déduite) apparaît quand même, avec des compteurs à 0 pour les autres
sources.

**Route REST** :

| Route | Rôle |
|-------|------|
| `GET /api/friends/stats` | Statistiques par ami + résumé global |

Réponse : `friends` (liste triée par trouvailles décroissantes) + `summary`
(nombre d'amis, total de trouvailles distinctes, total de caches en commun, ami
le plus actif).

**Frontend** : section repliable « Statistiques » en bas du widget, avec un
tableau par ami (trouvailles, activité, en commun) et un résumé global. Cliquer
sur un pseudo filtre le flux d'activité sur cet ami.

### 13.7 Tableau de bord de fraîcheur

`query_freshness()` (dans `geocaching_friend_finds.py`) rassemble en une seule
lecture (sans réseau) l'état de toutes les sources de données « amis » :

- **Flux d'activité** : `last_sync_at`, `last_projection_at`, nombre de logs
  stockés, nombre d'amis distincts dans le flux, date du log le plus récent,
  indicateur `is_stale` (> 1 h) ;
- **Trouvailles déduites** (`friend_find`) : nombre de lignes, caches
  distinctes, amis distincts, indicateur `is_stale` ;
- **Liste d'amis** : `fetched_at`, nombre d'amis, `reported_count`,
  `truncated`, `pages_fetched` ;
- **Géocaches** : total importé, nombre trouvées, nombre dans la zone « Amis ».

**Route REST** :

| Route | Rôle |
|-------|------|
| `GET /api/friends/freshness` | État de fraîcheur de toutes les sources |

**Frontend** : panneau « Fraîcheur des données » en bas du widget, avec 4 cartes
(Flux d'activité, Trouvailles déduites, Liste d'amis, Géocaches). Chaque carte
affiche les timestamps en temps relatif (« il y a 12 min ») et un icône
⚠️ quand une source est stale. Un bouton rafraîchit le panneau à la demande.

### 13.8 Interface

Un sélecteur de source dans la barre d'outils du widget « Activité des amis » :
**Activité récente** (§12) · **Toutes les trouvailles** (`friend_find`) ·
**Les deux**.

En mode « Les deux », la fusion se fait par code GC : une cache déjà connue du
flux garde ses métadonnées (plus riches) et ne gagne que les amis que le flux
ignorait. Sans cette déduplication, un ami apparaîtrait deux fois dans la popup
d'une cache trouvée récemment.

Seul le filtre « ami » s'applique aux trouvailles déduites : cette table n'a ni
type de log ni date, la filtrer par type de log n'aurait aucun sens.

Un bandeau annonce les géocaches manquantes et propose l'import ; il se
transforme en indicateur de progression discret (message + bouton *Arrêter*)
pendant l'opération, sans modale bloquante.

Le compteur est rafraîchi par `refreshImportableCount()` **à l'ouverture du
widget**, indépendamment de la carte.

> ⚠️ Deuxième piège corrigé après coup : ce compteur n'était d'abord alimenté que
> par le chargement de la carte en mode « Toutes les trouvailles ». La seule
> porte d'entrée de l'import se trouvait donc cachée derrière un réglage
> d'affichage — la zone « Amis » restait vide sans que rien n'indique comment la
> remplir.

---

## 14. Tests

**166 tests**, aucun ne touche le réseau : le parsing est exposé en méthodes de
classe pures, la synchronisation accepte un client injecté, et les routes qui
vérifient l'authentification reçoivent un service simulé (sans quoi elles
tentent une vraie connexion à geocaching.com — piège vérifié).

> La suite backend complète compte ~96 échecs **préexistants** (plugins,
> grid-puzzle-solver), sans rapport avec les amis. Comparer à un baseline
> (`git stash`) avant de conclure à une régression.

`test_geocaching_friends.py` (17 tests) — liste d'amis :

- parsing complet de deux amis, dont les conversions de dates/nombres ;
- détection de pagination (`truncated`) ;
- liste vide valide ;
- page inconnue → `GeocachingFriendsError` ;
- champs optionnels absents → parsing dégradé mais non bloquant ;
- **pagination ASP.NET** : collecte de deux pages, arrêt sur dernière page,
  déduplication par pseudo, lien « Next » préféré, repli sur numéro de page,
  arrêt propre sur erreur HTTP, extraction des champs `__VIEWSTATE` etc.,
  détection du postback « page suivante » (avec et sans lien « Next »),
  détection du numéro de page courant, sérialisation `pages_fetched`.

`test_friend_activity.py` (12 tests) — flux d'activité :

- parsing d'une entrée (dont l'extraction du code `PRxxxxx` et la troncature des
  dates à 7 décimales), payload liste nue, entrée condensée, type de log inconnu,
  entrée sans `logReferenceCode` ignorée, payload aberrant → erreur ;
- synchronisation **idempotente** (deux passes → aucun doublon), rafraîchissement
  d'un log édité sans toucher `first_seen_at` ;
- marquage `is_self` et son backfill ;
- filtres, tri, pagination, `list_authors()` ;
- routes REST : lecture du flux stocké et rejet des paramètres invalides.

`test_friend_activity_scheduler.py` (12 tests) — synchro auto + projection incrémentale :

- **projection incrémentale** : premier appel balaie tout, second ne balaie que
  les nouvelles lignes, retour 0 sans nouvelles lignes, timestamp de projection
  persisté dans `AppConfig` ;
- **scheduler** : pas de synchro si non connecté, pas de synchro si préférence
  désactivée, synchro déclenchée si connecté + jamais synchronisé, pas de synchro
  si récente, synchro si ancienne, continuation après erreur, démarrage/arrêt
  propres, idempotence du démarrage.

`test_geocache_friend_logs.py` (5 tests) — logs d'amis par cache :

- identification des logs d'amis avec **un seul** fetch du `userToken` (la
  session simulée vérifie l'ordre et les paramètres des appels) ;
- log d'ami hors fenêtre ajouté au résultat ;
- absence de logs d'amis, `userToken` introuvable → dégradation propre ;
- routes : exposition de `is_friend_log`, `friends_count` et `friends_only`.

`test_friend_finds.py` (15 tests) — « qui a trouvé quoi » :

- boîte englobante (marge, coordonnées manquantes, zone vide) ;
- déduction par complément de `nfb`, référence récupérée **une seule fois** pour
  plusieurs amis, pagination complète et garde-fou de zone démesurée ;
- 429 retenté puis remonté (paliers fixes injectés pour les tests, le
  throttling adaptatif est testé séparément dans `test_friend_finds_throttling.py`) ;
- `store_finds` idempotent, normalisation des codes, suppression des lignes
  périmées **limitée à la même source** ;
- routes de lecture et rejet des paramètres invalides.

`test_friend_finds_suggestions.py` (16 tests) — suggestions « caches à faire » :

- exclusion des caches déjà trouvées par moi, inclusion des non trouvées ;
- caches non importées affichées avec les métadonnées du flux ;
- tri par nombre d'amis décroissant, déduplication des amis ;
- filtres `min_friends`, `zone_id`, `limit`, `include_found` ;
- liste vide sans trouvailles, coordonnées préférées de la géocache importée ;
- routes REST : lecture des suggestions, paramètres de requête, liste vide.

`test_friend_stats.py` (10 tests) — statistiques croisées entre amis :

- compteurs par ami (trouvailles, activité, caches en commun) ;
- exclusion de mes propres logs du compteur d'activité ;
- fusion d'amis présents dans une seule source (flux sans trouvaille déduite) ;
- tri par nombre de trouvailles décroissant ;
- résumé global (nombre d'amis, total distinct, total en commun, plus actif) ;
- liste vide sans données ;
- routes REST : lecture des stats, résumé vide.

`test_friend_freshness.py` (12 tests) — tableau de bord de fraîcheur :

- compteurs vides sans données (tous à 0, timestamps à None, stale=True) ;
- compteurs du flux d'activité (logs stockés, auteurs distincts, date du dernier
  log) ;
- compteurs des trouvailles déduites (lignes, caches distinctes, amis
  distincts) ;
- compteurs des géocaches (total, trouvées) ;
- lecture des timestamps depuis AppConfig (synchro, projection) ;
- indicateurs `is_stale` : True si ancien ou absent, False si récent ;
- timestamp de vérification toujours présent ;
- routes REST : lecture de l'état, état vide sans données.

`test_friend_finds_throttling.py` (16 tests) — throttling 429 adaptatif :

- backoff exponentiel avec jitter (délais croissants, plafond 5 min) ;
- lecture de l'en-tête `Retry-After` (secondes et date HTTP), plafonné ;
- `Retry-After` prioritaire sur le backoff, fallback si absent ou illisible ;
- interval adaptatif : augmente après un 429, plafonné à 60 s ;
- décroissance de l'interval après 3 succès consécutifs, jamais sous le nominal ;
- épuisement des tentatives → `RateLimitedError` ;
- rétrocompatibilité : `retry_delays` injecté utilise toujours les paliers fixes.

`test_friend_activity_map.py` (21 tests) — carte des amis :

- dédoublonnage par cache et agrégation des auteurs, date du point = celle du
  log le plus récent, logs sans code GC non fusionnés entre eux ;
- jointure GeoApp : `geocache_id`/`found` renseignés pour une cache importée,
  `0` sinon ;
- traduction des types, y compris le repli scraper → recherche web (Mega-Event,
  APE) et l'id inconnu qui n'est pas une erreur ;
- entrées sans coordonnées comptées et non placées ;
- filtres identiques à ceux de la timeline, fenêtre `days`, garde-fou `limit`
  signalé par `truncated` ;
- routes : lecture des points et rejet des paramètres invalides ;
- **condensation** (§9.2) : somme des trouvailles masquées, respect des
  filtres, exposition par la route de lecture ;
- **pont vers `friend_find`** (§13.2) : projection d'une trouvaille avec ses
  coordonnées, exclusion des DNF / notes / logs personnels / entrées sans code
  GC, idempotence, source d'origine préservée mais coordonnées complétées,
  coordonnées existantes non écrasées, bilan de synchro.

`test_friend_finds_map.py` (20 tests) — trouvailles sur la carte :

- métadonnées de la référence conservées par la déduction, `search_codes()`
  toujours fonctionnel, enregistrement réduit à son code toléré ;
- `store_finds` écrit les coordonnées **et** répare une ligne créée avant ces
  colonnes ;
- zone « Amis » créée masquée puis réutilisée, exclue de `GET /api/zones` et
  rétablie par `include_hidden=true` ;
- **recherche par profil** (§11.2) : appel conforme à la page profil (filtre
  joueur, tri par date, pas de boîte), détection du filtre ignoré à partir d'un
  total aberrant, respect de `max_results` et arrêt au plafond de pagination,
  route de synchronisation et rejet d'un pseudo manquant ;
- `list_codes_to_import()` ne retient que les caches absentes de GeoApp ;
- route carte : coordonnées de la déduction, repli sur la géocache importée,
  comptage de ce qu'un import corrigerait, regroupement et filtre par ami.

---

## 15. Références croisées

- Authentification et session partagée —
  [connexion-geocaching-technique.md](connexion-geocaching-technique.md).
- Backend général — [backend-technique.md](backend-technique.md).
- Frontend général — [frontend-technique.md](frontend-technique.md).
