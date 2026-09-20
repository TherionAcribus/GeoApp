# Logs d'une géocache — Documentation technique

Chargement depuis Geocaching.com, pagination, et analyse IA du logbook.

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

| Route de l'analyse IA | Rôle |
|---|---|
| `GET /api/geocaches/<id>/logs/analysis` | l'analyse stockée, `analysis: null` si la cache n'en a pas (état normal) |
| `PUT /api/geocaches/<id>/logs/analysis` | enregistre ou remplace : `content` (Markdown, obligatoire), `model_id`, `analyzed_count`, `stored_count`, `total_available` |
| `DELETE /api/geocaches/<id>/logs/analysis` | supprime ; supprimer ce qui n'existe pas renvoie `deleted: false`, pas une erreur |

## Frontend

| Fichier | Rôle |
|---|---|
| `geocache-logs-fetch-service.ts` | Lecture des préférences, règle de déclenchement, mémoire de session, file d'attente, appels à `/logs/refresh`. Partagé par les deux déclencheurs. |
| `geocache-logs-widget.tsx` | Panneau Logs : chargement initial, bandeau « il en reste », rafraîchissement manuel, déclenchement de l'analyse IA. |
| `geocache-details-widget.tsx` | `autoFetchLogsInBackground()`, branché sur `loadLogsSummary()`. |
| `geocache-logs-types.ts` | Formes des logs et budget de l'analyse. Sans React ni Theia : c'est ce qui garde le module de prompt testable. |
| `geocache-logs-analysis-service.ts` | Lecture des logs à analyser, chargement/enregistrement/suppression de l'analyse. |
| `geocache-logs-analysis-prompt.ts` | Construction du message envoyé au modèle, et description du périmètre. Fonctions pures. |
| `geocache-logs-analysis-view.tsx` | Rendu du résultat : Markdown, métadonnées, avertissement de fraîcheur. |

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

## Analyse IA des logs

Trois défauts se tenaient ensemble dans l'ancien bloc d'analyse, et se corrigent
ensemble.

### Le périmètre

L'analyse portait sur `this.logs`, c'est-à-dire sur **la page affichée** : 25
logs, sur une cache qui peut en compter trois cents. Rien ne le disait, ni à
l'utilisateur, ni au modèle — qui écrivait donc « les trouveurs signalent tous
que… » en ayant lu le dernier trimestre.

Elle porte désormais sur les logs **stockés**, lus par
`collectLogsToAnalyze()` indépendamment de la pagination de la liste :

| Constante | Valeur | Rôle |
|---|---|---|
| `LOGS_ANALYSIS_MAX_LOGS` | 100 | plafond de logs soumis (les plus récents) |
| `LOGS_ANALYSIS_MAX_TEXT_LENGTH` | 1500 | coupe d'un log-fleuve, marquée `[…log tronqué]` |

C'est une lecture (`GET /logs`), pas une récupération : **aucun appel à
Geocaching.com**. Si des logs manquent en base, c'est le bandeau « il en reste »
qui propose d'aller les chercher.

Le périmètre est écrit trois fois, à trois destinataires : dans l'infobulle du
bouton (avant de dépenser un appel), dans le prompt (`PÉRIMÈTRE : …`, suivi
d'une consigne explicite de ne pas généraliser quand l'échantillon est partiel),
et sous le titre de l'analyse (« 100 logs analysés sur 250 chargés sur 300
présents sur Geocaching.com »).

### La persistance

Une analyse coûte un appel de modèle ; elle disparaissait au moindre changement
de géocache. Elle est maintenant enregistrée côté backend, **une par géocache**
(`geocache_logs_analysis`, contrainte d'unicité sur `geocache_id`) : la relancer
remplace la précédente, puisque c'est la même question posée sur des logs plus
frais.

Les compteurs enregistrés avec le texte ne sont pas décoratifs :

- `analyzed_count` / `stored_count` / `total_available` — ce que l'analyse a vu ;
- comparer `stored_count` au stock actuel dit si elle a **vieilli**. Le panneau
  affiche alors « 12 logs sont arrivés depuis cette analyse » et propose de la
  relancer : une cache réparée ou un accès fermé se joue dans les logs récents.

Si l'enregistrement échoue, le résultat est **quand même affiché** (avec un
avertissement) : le modèle a déjà répondu, perdre sa réponse faute de savoir la
ranger serait le pire des deux mondes.

### Le rendu

Le modèle répond en Markdown — on le lui demande explicitement — et le panneau le
rend avec `renderLogMarkdown()`, le même rendu que le texte des logs juste en
dessous. Avant, `white-space: pre-wrap` affichait les `##` et les `**` tels
quels.

L'en-tête du bloc porte trois actions : **replier** (local, gratuit),
**relancer** (nouvel appel au modèle) et **supprimer** (effacement en base,
derrière une confirmation — pour simplement masquer l'analyse, il y a replier).

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
- `totalCount` suit le filtre courant du panneau ; sous « Amis » il ne compte que
  les amis. L'analyse annonce et compare `storedLogsCount`, le dernier total
  complet connu — confondre les deux ferait dire au bouton « analyser les 3
  logs » d'une cache qui en a trois cents.
- L'analyse est produite par le frontend (c'est lui qui parle au modèle via
  Theia) ; le backend ne fait que la garder. Aucune route n'appelle de modèle.

## Tests

`backend/tests/test_geocache_logs_fetch.py` :

- lecture de `totalRows`, et absence de `pageInfo` qui laisse `total_available` à
  `None` ;
- `page` qui se traduit en `idx`, `count` plafonné à `MAX_LOGS_PER_PAGE` ;
- `fetch_all` qui enchaîne les pages puis s'arrête sur le plafond ;
- route de rafraîchissement : total exposé et stocké, page suivante qui n'écrase
  pas la précédente, page au-delà de la fin qui n'est pas une erreur.

`backend/tests/test_geocache_logs_analysis.py` : analyse absente qui est un état
normal, périmètre relu tel qu'il a été écrit, relance qui remplace au lieu
d'empiler, contenu vide refusé, suppression idempotente, cascade à la
suppression de la géocache.

`frontend/theia-extensions/zones/src/browser/tests/geocache-logs-analysis-prompt.test.ts` :
périmètre annoncé au modèle et avertissement d'échantillon partiel (absent quand
l'analyse voit tout), hint présent ou dit absent, coupe d'un log long sur une
frontière de mot, demande de Markdown.

## Références code

- `backend/gc_backend/services/geocaching_logs.py`
- `backend/gc_backend/blueprints/logs.py`
- `backend/gc_backend/geocaches/models.py` (`Geocache.logs_total_available`,
  `GeocacheLogsAnalysis`)
- `backend/migrations/versions/add_geocache_logs_analysis_table.py`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-fetch-service.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-widget.tsx`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-analysis-service.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-analysis-prompt.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-analysis-view.tsx`
- `shared/preferences/geo-preferences-schema.json` (`geoApp.logs.*`)
