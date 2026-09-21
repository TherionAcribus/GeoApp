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

## Combien de trouvailles, et le pourcentage de favoris

`logs_total_available` compte **tous les types de log** : trouvailles, DNF, notes,
maintenances. Ce n'est donc pas le dénominateur du pourcentage de favoris, que
Geocaching.com calcule sur les seules trouvailles. Et `logs_count` l'est encore
moins : divisé par lui, GC8QY1G affichait *200 %* (102 PF pour 51 logs stockés).

D'où une troisième colonne :

```py
Geocache.finds_count        # trouvailles annoncées par GC.com, NULL = inconnu
Geocache.favorites_percent  # favorites_count / finds_count, NULL = non calculable
```

`favorites_percent` est **dérivé mais stocké** : l'App doit pouvoir trier et
filtrer dessus en SQL. Il ne s'écrit jamais à la main, toujours via
`Geocache.update_favorites_percent()`, à appeler après toute écriture de
`favorites_count` ou `finds_count`.

Trois sources pour `finds_count`, par ordre de fraîcheur :

1. le logbook, quand il est **intégralement stocké** en local
   (`logs_count >= logs_total_available`) : on compte les `FIND_LOG_TYPES` en base.
   Logbook partiel : on n'y touche pas, ça sous-estimerait le total ;
2. les compteurs par type de log de la page de la cache, lus au scraping — c'est
   la source de départ, disponible **sans parcourir le logbook** ;
3. l'envoi d'un log depuis l'App, qui incrémente le compteur comme le site vient
   de le faire.

Les compteurs de la page vivent dans `span#ctl00_ContentBody_lblFindCounts`, une
icône par type de log suivie de son nombre :

```html
<img src="/images/logtypes/2.png" alt="Found it">165&nbsp;&nbsp;<img src="/images/logtypes/3.png" ...>4
```

`scraper.parse_log_type_counts()` en tire `(logtype_id, alt, title, count)` par
icône. Deux lectures de ce même bloc :

- `FIND_LOGTYPE_IDS = (2, 10, 11)` — « Found it », « Attended » (events) et
  « Webcam Photo Taken » — additionnés dans `finds_count` ;
- `ARCHIVE_LOGTYPE_ID = 5`, qui marque la cache archivée (c'était déjà le seul
  usage du bloc avant cette colonne).

`FIND_LOG_TYPES = ('Found', 'Attended', 'Webcam')` dans `models.py` est le miroir
côté base de `FIND_LOGTYPE_IDS`, après normalisation par
`GeocacheLog.normalize_log_type()`.

Côté frontend, `favoritePercent()` (`log-editor/geocache-loader.ts`) prend le
`favorites_percent` du backend ; sur une cache jamais re-scrapée, il retombe sur
`logs_total_available` et signale la valeur comme approximative (préfixe `~`).
Il ne divise **jamais** par `logs_count`.

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
| `geocache-log-images-service.ts` | Préférence de téléchargement, file d'attente sérialisée, mémoire des logs déjà tentés, appels à `/images/store`. |
| `geocache-log-images.tsx` | Vignettes, bandeau « N photos jointes » avec bouton, visionneuse modale (flèches, Échap). |
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

## Photos jointes aux logs

Le logbook accompagne chaque log d'un tableau `Images` que le parseur ignorait.
Ce n'est pas anecdotique : sur une cache fréquentée, **un quart des logs porte
une photo** (50 sur 200 relevés sur GC103E), et c'est souvent l'information la
plus utile avant d'aller sur le terrain — vue du site, état du conteneur,
spoiler.

### La forme réelle de `Images`

Constatée en réel, parce que rien ne la documente côté Geocaching.com :

```json
{
  "ImageID": 103296230,
  "ImageGuid": "2dd2667c-8c1f-4ebb-b39b-452af9bd1987",
  "Name": "Bild 1",
  "Descr": "",
  "FileName": "2dd2667c-8c1f-4ebb-b39b-452af9bd1987.jpg",
  "Created": "09/07/2026",
  "LogID": 1383323441,
  "CacheID": 4158,
  "ImageUrl": null
}
```

Deux pièges : **`ImageUrl` est toujours nul** et `ImageCount` aussi — seul
`FileName` permet de retrouver la photo. Et les photos n'apparaissent jamais en
`<img>` dans `LogText` (ce qui serait de toute façon sans effet, `_clean_log_text`
supprimant toutes les balises).

Quatre variantes sont servies, **toutes sans authentification** :

| URL | Poids |
|---|---|
| `img.geocaching.com/<FileName>` | ~970 Ko (l'original) |
| `img.geocaching.com/cache/log/large/<FileName>` | ~100 Ko |
| `img.geocaching.com/cache/log/display/<FileName>` | ~14 Ko |
| `img.geocaching.com/cache/log/thumb/<FileName>` | ~3 Ko |

`large` est retenue (`LOG_IMAGE_URL_PREFIX`) : l'original coûterait dix fois plus
pour un écran qui ne l'exploite pas, et `display` est trop dégradé pour un
spoiler qu'on agrandit. **Un seul fichier par photo** — comme ailleurs dans le
projet, la vignette est un redimensionnement CSS, pas un second fichier.

### Connaître n'est pas stocker

C'est toute la structure de la fonctionnalité, et la raison d'être de la table
`geocache_log_image` :

| État | Ce qui existe | Ce que ça coûte |
|---|---|---|
| **connue** | une ligne en base : URL, titre, légende, date | rien — `/logs/refresh` le fait déjà |
| **stockée** (`stored`) | le fichier sur disque | une requête vers GC.com, ~100 Ko |

Le rafraîchissement ne fait *jamais* que le premier : sur une cache à 3000 logs,
tout télécharger représenterait plusieurs centaines de mégaoctets que personne
n'a demandés.

`display_url` ne vaut quelque chose **que** si la photo est stockée. `source_url`
est renvoyée au front, mais uniquement pour un lien « ouvrir sur
Geocaching.com » : l'afficher dans un `<img>` viderait la préférence de son sens
— elle ne couperait plus que l'écriture disque, pas le trafic.

### La préférence

| Clé | Valeurs | Défaut |
|---|---|---|
| `geoApp.logs.downloadImages` | `true` / `false` | `true` |

Activée, le panneau télécharge les photos des **logs affichés** au fil du
chargement (pas tout le stock), en sérialisant les appels dans
`GeocacheLogImagesService`. Désactivée, chaque log annonce « 3 photos jointes »
avec un bouton : rien ne part vers Geocaching.com tant qu'on ne clique pas.

### Table et stockage

`geocache_log_image`, séparée de `geocache_image` à dessein : ces photos parlent
d'une visite, pas de la cache. Les verser dans la table existante noierait la
galerie, l'éditeur d'image et l'OCR sous des centaines de vignettes.

Fichiers dans `backend/data/log_images/<geocache_id>/<image_id>.<ext>`, via
`image_storage.py` réutilisé tel quel — ses gardes (anti-SSRF, détection du type
par magic bytes, plafond de 15 Mo) valent ici aussi. Les fonctions ont gagné un
paramètre `root` à valeur par défaut, donc aucun appelant existant ne change.

| Route | Rôle |
|---|---|
| `POST /api/geocaches/<id>/logs/<log_id>/images/store` | télécharge et range les photos d'**un** log ; rejouable, ignore ce qui est déjà stocké |
| `GET /api/geocache-log-images/<image_id>/content` | sert le fichier stocké |
| `DELETE /api/geocaches/<id>/logs/images` | efface les fichiers d'une géocache ; les lignes restent, les photos redeviennent « connues » |

`/logs/refresh` renvoie en plus `images_added`.

Le `store` est volontairement limité à un log, ce qui le rend acceptable dans le
thread Flask — là où un « toute la cache » deviendrait une requête interminable
et non annulable. C'est le front qui enchaîne, log par log.

### Ce qui se casse facilement ici

- **`delete_geocache_logs` supprime en masse**, donc hors ORM : la cascade
  `GeocacheLog.images` ne s'applique pas. Les lignes de photos et leurs fichiers
  sont effacés explicitement, sans quoi ils survivraient à leurs logs.
- **Le placement des vignettes dans la carte est structurel.** Elles sont rendues
  hors du bloc `geoapp-log-card__text`, qui est mesuré au montage (`scrollHeight`
  contre `--geoapp-log-collapsed-height`) pour décider du bouton « Voir plus » :
  des images arrivant en asynchrone fausseraient cette mesure après coup.
- **La relation est en `lazy='selectin'`.** Avec le `lazy=True` par défaut, une
  page de 25 à 50 logs déclencherait autant de requêtes qu'elle affiche de logs.
- Une photo retirée de Geocaching.com reste consultable si elle avait été
  téléchargée — c'est l'intérêt du stockage hors ligne. Une photo qui échoue
  n'emporte pas les autres photos du même log.

## Points d'attention

- **Ne jamais déclencher un scraping automatique sur une cache qui a déjà des
  logs.** C'est toute la différence entre un premier chargement et un
  rafraîchissement permanent.
- `logs_count` (stock local après refresh), `logs_total_available` (total GC.com,
  tous types) et `finds_count` (trouvailles GC.com) répondent à trois questions
  différentes. Ne pas les confondre — le pourcentage de favoris se divise par le
  troisième, et par lui seul.
- Vider les logs d'une cache remet `logs_count` à 0 mais **laisse `finds_count`
  en place** : ce compteur décrit le site, pas le stock local.
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

`backend/tests/test_geocache_favorites_percent.py` : pourcentage calculé sur les
trouvailles et non sur les logs stockés (le cas GC8QY1G), valeur laissée inconnue
sans `finds_count` ou sur une cache que personne n'a trouvée, effacée quand elle
redevient incalculable, `finds_count` dérivé d'un logbook complet et laissé
intact sur un logbook partiel, champs exposés par `/api/geocaches/batch`.

`backend/tests/test_geocaching_scraper.py` : lecture des compteurs par type de
log — trouvailles simples, somme « Attended »/« Webcam », séparateur de milliers,
absence de compteurs qui laisse `None` plutôt que 0, détection d'archivage
préservée.

`backend/tests/test_geocache_logs_analysis.py` : analyse absente qui est un état
normal, périmètre relu tel qu'il a été écrit, relance qui remplace au lieu
d'empiler, contenu vide refusé, suppression idempotente, cascade à la
suppression de la géocache.

`backend/tests/test_geocache_log_images.py` : lecture du tableau `Images`, refus
d'un `FileName` qui tenterait une traversée, rafraîchissement idempotent et sans
téléchargement, stockage rejouable, échec isolé d'une photo, garde
anti-traversée sur `/content`, cascade et purge disque.

`frontend/theia-extensions/zones/src/browser/tests/geocache-log-images.test.ts` :
quelles photos restent à télécharger, y compris sur un log partiellement stocké.

`frontend/theia-extensions/zones/src/browser/tests/geocache-logs-analysis-prompt.test.ts` :
périmètre annoncé au modèle et avertissement d'échantillon partiel (absent quand
l'analyse voit tout), hint présent ou dit absent, coupe d'un log long sur une
frontière de mot, demande de Markdown.

## Références code

- `backend/gc_backend/services/geocaching_logs.py`
- `backend/gc_backend/blueprints/logs.py`
- `backend/gc_backend/geocaches/models.py` (`Geocache.logs_total_available`,
  `Geocache.finds_count`, `Geocache.favorites_percent`,
  `Geocache.update_favorites_percent()`, `FIND_LOG_TYPES`, `GeocacheLogsAnalysis`)
- `backend/gc_backend/geocaches/scraper.py` (`parse_log_type_counts()`,
  `FIND_LOGTYPE_IDS`)
- `frontend/theia-extensions/zones/src/browser/log-editor/geocache-loader.ts`
  (`favoritePercent()`, `formatFavoritePercent()`)
- `backend/migrations/versions/add_geocache_logs_analysis_table.py`
- `backend/migrations/versions/add_geocache_log_image_table.py`
- `backend/gc_backend/geocaches/image_storage.py` (racine `log_images`, paramètre `root`)
- `frontend/theia-extensions/zones/src/browser/geocache-logs-fetch-service.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-widget.tsx`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-analysis-service.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-analysis-prompt.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-logs-analysis-view.tsx`
- `frontend/theia-extensions/zones/src/browser/geocache-log-images-service.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-log-images.tsx`
- `shared/preferences/geo-preferences-schema.json` (`geoApp.logs.*`)
