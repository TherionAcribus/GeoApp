# Chargement des logs — Documentation technique

## Vue d'ensemble

Deux opérations se ressemblent et n'ont rien à voir :

| | Ce que ça fait | Coût |
|---|---|---|
| **Lire** (`GET /api/geocaches/<id>/logs`) | renvoie les logs déjà en base, paginés | gratuit, instantané |
| **Récupérer** (`POST /api/geocaches/<id>/logs/refresh`) | scrape le logbook de Geocaching.com et l'enregistre | 3 requêtes vers GC.com, quelques secondes |

Le panneau Logs a toujours lu automatiquement ; il ne récupérait que sur clic du
bouton **Rafraîchir**. Une géocache jamais rafraîchie affichait donc un panneau
vide alors que l'utilisateur venait précisément voir ses logs.

Deux préférences pilotent désormais ce premier chargement :

| Clé | Valeurs | Défaut |
|---|---|---|
| `geoApp.logs.autoFetchTrigger` | `logs-panel`, `geocache-open`, `off` | `logs-panel` |
| `geoApp.logs.initialFetchCount` | `20`, `50`, `100` (« Tout ») | `50` |

Et « Tout » ne veut pas dire *tout* : il plafonne à 100. Au-delà, c'est
l'utilisateur qui décide explicitement, dans le panneau Logs, d'aller chercher la
suite.

## Règle de déclenchement

Le chargement automatique n'a lieu que **si la géocache n'a aucun log stocké**.
Sans cette condition, chaque ouverture de fiche relancerait un scraping : en
navigation rapide, c'est un aller-retour vers Geocaching.com par cache visitée.
Une fois des logs présents, c'est **Rafraîchir** qui reprend la main.

S'y ajoutent deux garde-fous portés par `GeocacheLogsFetchService` :

- **mémoire de session** (`attempted`) : une géocache tentée ne l'est plus, même
  si elle est restée à zéro log (cache réellement sans log, ou échec réseau) ;
- **file d'attente** (`queue`) : les récupérations automatiques s'enchaînent au
  lieu de partir en parallèle.

### Qui déclenche quoi

| Préférence | Ouverture de la fiche géocache | Ouverture du panneau Logs |
|---|---|---|
| `logs-panel` (défaut) | — | récupère |
| `geocache-open` | récupère en tâche de fond | récupère **si rien n'a été fait** |
| `off` | — | — |

La case en bas à droite est un filet de sécurité volontaire : en mode
`geocache-open`, on peut arriver sur les logs sans jamais avoir ouvert la fiche
(depuis le tableau des géocaches), ou après une tâche de fond en échec. Ouvrir le
panneau Logs, c'est de toute façon demander à voir les logs.

## Pagination du logbook

L'API interne `seek/geocache.logbook` pagine par `idx` (**numéro de page**
1-based) et `num` (taille de page) — ce n'est pas un offset en nombre de logs.
`GeocachingLogsClient.fetch_logbook()` expose ça tel quel :

```py
result = client.fetch_logbook('GC12345', count=100, page=2)       # logs 101 à 200
result = client.fetch_logbook('GC12345', count=100, fetch_all=True)  # tout, par pages
```

| Constante (`services/geocaching_logs.py`) | Valeur | Rôle |
|---|---|---|
| `MAX_LOGS_PER_PAGE` | 100 | plafond de `num` : au-delà on enchaîne les pages |
| `MAX_LOGS_FETCH_ALL` | 1000 | garde-fou de `fetch_all`, signalé par `truncated` |

`fetch_all` s'arrête sur une **page incomplète**, pas sur un calcul de pages :
c'est le seul critère qui reste juste quand le total est inconnu (voir plus bas).
Les pages sont dédupliquées par `external_id`, car un log posté entre deux appels
décale la fenêtre.

Le filtre amis (`sf=true`) reste **une seule requête**, quel que soit le nombre de
pages parcourues : il porte sur toute la cache (voir
[amis-geocaching-technique.md](amis-geocaching-technique.md) § 10).

## Savoir combien de logs il reste

`logs_count` ne répond pas à la question : le rafraîchissement l'**écrase avec le
nombre de logs stockés localement**. D'où une colonne dédiée :

```py
Geocache.logs_total_available   # NULL = inconnu
```

Deux sources, par ordre de priorité :

1. `pageInfo.totalRows` de la réponse du logbook, lu par `_read_total_available()`
   — même source que les logs qu'on vient d'écrire ;
2. à défaut, le compteur de logs lu sur la page de la cache au scraping
   (`geocaches.py`, `importer.py`).

`pageInfo` n'est pas contractuel : c'est une API interne, qui a déjà changé de
forme. `_read_total_available()` accepte plusieurs graphies et renvoie `None`
sinon ; tout le code en aval sait s'en passer — l'interface masque simplement la
proposition « charger la suite ».

## API

`POST /api/geocaches/<id>/logs/refresh`

| Paramètre | Défaut | Rôle |
|---|---|---|
| `count` | 25 | taille de page |
| `page` | 1 | numéro de page 1-based |
| `all` | `false` | enchaîne les pages jusqu'au bout |

Réponse : `added`, `updated`, `replaced_local`, `friends`,
`friends_check_failed`, `total` (stock local), `total_available` (total GC.com,
`null` si inconnu), `truncated`.

`GET /api/geocaches/<id>/logs` renvoie lui aussi `total_available`, pour que le
panneau sache qu'il reste des logs **sans avoir à rescraper d'abord**.

## Frontend

| Fichier | Rôle |
|---|---|
| `geocache-logs-fetch-service.ts` | Lecture des préférences, règle de déclenchement, mémoire de session, file d'attente, appels à `/logs/refresh`. Partagé par les deux déclencheurs. |
| `geocache-logs-widget.tsx` | Panneau Logs : chargement initial, bandeau « il en reste », rafraîchissement manuel. |
| `geocache-details-widget.tsx` | `autoFetchLogsInBackground()`, branché sur `loadLogsSummary()`. |

Le chargement en tâche de fond de la fiche est **volontairement muet** :
l'utilisateur regarde la fiche, pas les logs. Le résumé des logs récents se
remplit tout seul si la récupération ramène quelque chose ; en cas d'échec, rien
n'est affiché (l'erreur part en console) — c'est une action que l'utilisateur n'a
pas demandée.

Le panneau Logs, lui, distingue les deux cas : l'automatique ne parle que s'il a
ramené des logs, le manuel annonce toujours son bilan et ses erreurs.

### Bandeau « il reste des logs »

Affiché quand `total_available - total_count > 0`, hors filtre « Amis » (qui
compte autre chose). Il propose les deux chemins :

- **Charger *n* de plus** — la page suivante, `nextPageFor(storedCount)` ;
- **Tout charger (*n*)** — `all=true`, derrière une confirmation, parce que sur
  une cache très loguée c'est long et que c'est autant de requêtes vers GC.com.

## Points d'attention

- **Ne jamais déclencher un scraping automatique sur une cache qui a déjà des
  logs.** C'est toute la différence entre un premier chargement et un
  rafraîchissement permanent.
- `logs_count` (stock local après refresh) et `logs_total_available` (total
  GC.com) répondent à deux questions différentes. Ne pas les confondre.
- `get_logs_with_friends()` n'a pas disparu : c'est un raccourci vers
  `fetch_logbook()` pour les appelants qui se moquent du total (déduction des
  trouvailles d'amis, `geocaching_friend_finds.py`).
- Un double de `GeocachingLogsClient` dans un test doit implémenter
  `fetch_logbook()`, pas seulement `get_logs_with_friends()`.

## Tests

`backend/tests/test_geocache_logs_fetch.py` :

- lecture de `totalRows`, et absence de `pageInfo` qui laisse `total_available` à
  `None` ;
- `page` qui se traduit en `idx`, `count` plafonné à `MAX_LOGS_PER_PAGE` ;
- `fetch_all` qui enchaîne les pages puis s'arrête sur le plafond ;
- route de rafraîchissement : total exposé et stocké, page suivante qui n'écrase
  pas la précédente, page au-delà de la fin qui n'est pas une erreur.

## Références code

- `backend/gc_backend/services/geocaching_logs.py`
- `backend/gc_backend/blueprints/logs.py`
- `backend/gc_backend/geocaches/models.py` (`Geocache.logs_total_available`)
- `frontend/theia-extensions/zones/src/browser/geocache-logs-fetch-service.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-widget.tsx`
- `shared/preferences/geo-preferences-schema.json` (`geoApp.logs.*`)
