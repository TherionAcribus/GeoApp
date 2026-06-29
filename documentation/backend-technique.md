# Backend GeoApp - documentation technique

> Vue transverse du backend Flask GeoApp.
> Derniere mise a jour : juin 2026.

Ce document donne la carte generale du backend : demarrage Flask, base de
donnees, blueprints REST, services metier, plugins, taches asynchrones,
preferences et tests.

Les sous-systemes les plus riches ont aussi leur propre documentation :

- `documentation/plugins-technique.md`
- `documentation/preferences-technique.md`
- `documentation/formula-solver-technique.md`
- `documentation/grid-puzzle-solver-technique.md`
- `documentation/earthcoach-technique.md`
- `documentation/alphabets-technique.md`
- `documentation/chat-ia-geoapp-technique.md`

## 1. Vue d'ensemble

Le backend est une application Flask creee par factory dans
`backend/gc_backend/__init__.py`.

Son role principal est de fournir :

- une API REST locale sous `/api/*` pour l'application Theia ;
- une base SQLite via SQLAlchemy ;
- l'import, la consultation et l'enrichissement de geocaches ;
- le moteur de plugins de resolution ;
- les taches longues et les batchs ;
- les services IA ou semi-IA utilises par le frontend ;
- la persistance des preferences, notes, images, logs et etats de puzzle.

Point d'entree de developpement :

```powershell
cd backend
python run.py
```

`run.py` expose l'application sur `127.0.0.1:8000` en mode debug.

## 2. Structure principale

```text
backend/
|-- run.py
|-- requirements.txt
|-- pytest.ini
|-- gc_backend/
|   |-- __init__.py                 # create_app()
|   |-- config.py                   # configuration Flask/SQLAlchemy
|   |-- database.py                 # db SQLAlchemy + migrations legeres
|   |-- models.py                   # Zone, AppConfig
|   |-- blueprints/                 # API REST
|   |-- geocaches/                  # modeles et import/scraping geocaches
|   |-- plugins/                    # PluginManager, wrappers, scoring
|   |-- services/                   # services metier reutilisables
|   `-- utils/                      # helpers coordonnees, prefs, HTML
`-- tests/                          # tests pytest
```

Les plugins eux-memes ne sont pas dans `backend/`, mais dans :

```text
plugins/official/
plugins/custom/
```

## 3. Demarrage Flask

Le flux de `create_app()` est le suivant :

1. Creation de l'instance `Flask`.
2. Chargement de `Config`.
3. Activation de CORS pour le frontend local.
4. Installation des hooks de log HTTP `before_request` / `after_request`.
5. Initialisation SQLAlchemy via `init_db(app)`.
6. Lecture des preferences runtime utiles au demarrage.
7. Enregistrement des blueprints.
8. Creation du `PluginManager`.
9. Decouverte des plugins si `geoApp.plugins.autoDiscoverOnStart` est active.
10. Creation du `TaskManager`.
11. Installation du handler d'erreur global.

En mode test (`TESTING=1`), la base est remplacee par `sqlite:///:memory:`.

## 4. Configuration et base de donnees

### Configuration

Fichier : `backend/gc_backend/config.py`

La configuration fournit notamment :

- `SQLALCHEMY_DATABASE_URI`
- chemins locaux de stockage ;
- valeurs de securite et d'execution Flask.

### SQLAlchemy

Fichier : `backend/gc_backend/database.py`

`db = SQLAlchemy()` est l'instance globale importee par tous les modeles.

`init_db(app)` fait trois choses :

- bind SQLAlchemy a l'application ;
- importe tous les modeles pour declarer les tables ;
- appelle `db.create_all()`.

Le backend contient aussi des migrations SQLite legeres executees au demarrage
pour ajouter certaines colonnes manquantes. Flask-Migrate est configure dans
`create_app()`, mais le projet garde encore ces migrations defensives pour les
bases locales deja existantes.

## 5. Modeles principaux

| Modele | Fichier | Role |
|---|---|---|
| `Zone` | `gc_backend/models.py` | Groupe de geocaches. |
| `AppConfig` | `gc_backend/models.py` | Stockage cle/valeur pour preferences backend. |
| `Geocache` | `gc_backend/geocaches/models.py` | Cache principale, listing, coordonnees, statut, attributs. |
| `GeocacheWaypoint` | `gc_backend/geocaches/models.py` | Waypoints d'une cache. |
| `GeocacheImage` | `gc_backend/geocaches/models.py` | Images originales, uploads et variantes editees. |
| `UserObservation` | `gc_backend/geocaches/models.py` | Observations de terrain et liens images. |
| `GeocacheLoggingTask` | `gc_backend/geocaches/models.py` | Checklist/logging EarthCache ou terrain. |
| `GeocacheChecker` | `gc_backend/geocaches/models.py` | Checkers detectes ou configures. |
| `GeocacheLog` | `gc_backend/geocaches/models.py` | Logs Geocaching importes. |
| `Note` / `GeocacheNote` | `gc_backend/geocaches/models.py` | Notes utilisateur et association cache-note. |
| `GeocachePuzzleState` | `gc_backend/geocaches/models.py` | Etats sauvegardes des grilles/puzzles par geocache. |
| `SolvedGeocacheArchive` | `gc_backend/geocaches/models.py` | Archive des caches resolues. |
| `Plugin` | `gc_backend/plugins/models.py` | Metadata d'un plugin decouvert. |

Les methodes `to_dict()` sont la frontiere habituelle entre SQLAlchemy et JSON.

## 6. Blueprints REST

Les blueprints sont enregistres dans `create_app()`.

| Blueprint | Prefix / routes | Role |
|---|---|---|
| `zones.py` | `/api/zones*` | CRUD zones. |
| `geocaches.py` | `/api/geocaches*` | CRUD, import, details, scraping, deplacements. |
| `coordinates.py` | `/api/calculate_coordinates`, `/api/detect_coordinates`, `/api/geocaches/.../coordinates` | Calcul, detection et sauvegarde de coordonnees. |
| `plugins.py` | `/api/plugins*` | Catalogue, execution, metasolver, batch, scoring. |
| `tasks.py` | `/api/tasks*` | Creation, suivi, annulation et statistiques des taches longues. |
| `formula_solver.py` | `/api/formula-solver*` | Detection/resolution de formules de coordonnees. |
| `alphabets.py` | `/api/alphabets*` | Catalogue d'alphabets, ressources, fonts, detection. |
| `preferences.py` | `/api/preferences*` | Lecture/ecriture preferences backend. |
| `logs.py` | `/api/geocaches/.../logs*` et routes liees | Logs Geocaching. |
| `notes.py` | `/api/notes*`, `/api/geocaches/.../notes*` | Notes personnelles. |
| `observations.py` | `/api/geocaches/.../observations*`, `/api/observations*` | Observations terrain. |
| `logging_tasks.py` | `/api/geocaches/.../logging-tasks*`, `/api/logging-tasks*` | Taches de logging terrain. |
| `geocache_images.py` | `/api/geocaches/.../images*`, `/api/geocache-images*` | Stockage, contenu, OCR, QR, editions. |
| `checkers.py` | `/api/checkers*` | Sessions et execution de checkers. |
| `auth.py` | `/api/auth*` | Authentification Geocaching. |
| `search.py` | `/api/search*` | Recherche globale. |
| `archive.py` | `/api/archive*` | Archive des caches resolues. |
| `earthcoach_geology.py` | `/api/earthcoach/geology*` | Donnees geologiques EarthCoach. |
| `server_logs.py` | `/api/server-logs/stream` | Flux de logs serveur. |
| `puzzle_states.py` | `/api/geocaches/<id>/puzzle-states*` | Sauvegarde/restauration des ateliers de grille. |

Les endpoints doivent retourner du JSON stable et des codes HTTP explicites.
Les erreurs non gerees sont converties en JSON par le handler global, mais les
blueprints doivent de preference gerer leurs erreurs metier localement.

## 7. Services metier

Les services de `backend/gc_backend/services/` isolent la logique reutilisable.

| Service | Role |
|---|---|
| `task_manager.py` | File de taches en arriere-plan, statut, annulation. |
| `workflow_orchestrator_service.py` | Orchestration de resolution Mystery. |
| `metasolver_analysis.py` | Analyse et recommandations metasolver. |
| `listing_analysis_service.py` | Analyse de listings de geocaches. |
| `ai_scorer_service.py` | Scoring IA des resultats de plugins. |
| `formula_questions_service.py` | Questions et contexte pour le formula solver. |
| `web_search_service.py` | Recherche web backend quand necessaire. |
| `written_coordinates_service.py` | Coordonnees ecrites en toutes lettres. |
| `geocaching_auth.py` | Session et authentification Geocaching. |
| `geocaching_logs.py` | Lecture des logs Geocaching. |
| `geocaching_personal_notes.py` | Notes personnelles Geocaching. |
| `geocaching_push_coordinates.py` | Envoi de coordonnees corrigees. |
| `geocaching_submit_logs.py` | Soumission de logs. |
| `hidden_content_service.py` | Extraction de contenu cache dans listings. |
| `checkers/*` | Adaptateurs Certitude, GeoCheck, solution checker. |
| `ocr/*` | OCR local/vision et utilitaires image. |

Regle pratique : un blueprint orchestre HTTP + validation courte ; la logique
durable va dans un service ou un module dedie.

## 8. Systeme de plugins

Le `PluginManager` est cree au demarrage avec le dossier racine `plugins/`.

Responsabilites :

- scan de `plugins/official/**/plugin.json` et `plugins/custom/**/plugin.json` ;
- validation JSON Schema ;
- upsert des metadata en base ;
- lazy loading des modules Python ;
- execution normalisee ;
- cache et reload des plugins.

Les routes principales sont :

- `GET /api/plugins`
- `GET /api/plugins/<plugin_name>`
- `POST /api/plugins/<plugin_name>/execute`
- `POST /api/plugins/discover`
- `POST /api/plugins/<plugin_name>/reload`
- `POST /api/plugins/batch-execute`
- `POST /api/plugins/metasolver/*`

Voir `documentation/plugins-technique.md` pour le detail complet.

## 9. Taches longues

`TaskManager` evite de bloquer les requetes HTTP pour les traitements longs.

Il est initialise dans `create_app()` avec :

- `geoApp.tasks.autoStartBackground`
- `geoApp.tasks.maxWorkers`

Les routes `/api/tasks` permettent de :

- creer une tache ;
- lire son statut ;
- annuler ;
- lister ;
- lire les statistiques ;
- nettoyer les anciennes taches.

Les batchs plugins utilisent aussi des routes historiques dans
`/api/plugins/batch-*`.

## 10. Preferences

Le backend lit le schema partage :

```text
shared/preferences/geo-preferences-schema.json
```

Les valeurs backend sont stockees dans `AppConfig`.

La couche utilitaire est :

```text
backend/gc_backend/utils/preferences.py
```

Le frontend synchronise les preferences dont `x-targets` contient `backend`.

Voir `documentation/preferences-technique.md`.

## 11. Donnees geocaches

Les donnees geocaches viennent de plusieurs sources :

- import GPX ;
- Bookmark List Geocaching.com ;
- Pocket Query ;
- scraping/enrichissement ;
- edition locale depuis l'UI ;
- services Geocaching authentifies.

Modules importants :

- `geocaches/importer.py`
- `geocaches/bookmark_list_importer.py`
- `geocaches/pocket_query_importer.py`
- `geocaches/scraper.py`
- `geocaches/image_storage.py`
- `geocaches/image_sync.py`
- `geocaches/archive_service.py`

La table `geocache` garde les coordonnees courantes et les coordonnees
originales afin de pouvoir afficher la cache, corriger une Mystery et conserver
les informations source.

## 12. Images, OCR et contenus enrichis

Le systeme image s'appuie sur `GeocacheImage`.

Il gere :

- images issues du listing ;
- uploads utilisateur ;
- variantes derivees ;
- contenu binaire local ;
- etat d'editeur ;
- OCR ;
- detection QR ;
- tags et notes.

Les endpoints sont dans `blueprints/geocache_images.py`, les helpers de stockage
dans `geocaches/image_storage.py`, et les services OCR dans `services/ocr/`.

## 13. Logs et observabilite

La configuration Loguru est centralisee dans :

```text
backend/gc_backend/logging_config.py
```

Chaque requete `/api/*` est loggee avec :

- methode ;
- chemin ;
- origine ;
- statut ;
- duree.

`server_logs.py` expose un flux de logs pour le frontend.

## 14. Tests

Les tests sont dans `backend/tests/`.

Commandes utiles :

```powershell
cd C:\Users\fabie\Documents\Projets\GeoApp
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -q
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_plugins_api.py -q
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_grid_puzzle_solver_plugin.py -q
```

Les tests utilisent `TESTING=1` et une base SQLite en memoire via `create_app()`.

## 15. Ajouter une fonctionnalite backend

Checklist recommandee :

1. Identifier si la logique appartient a un blueprint existant, a un service ou
   a un nouveau module.
2. Ajouter ou ajuster le modele SQLAlchemy si une persistance est necessaire.
3. Garder la validation HTTP pres de la route.
4. Mettre la logique durable dans `services/`, `geocaches/`, `utils/` ou le
   plugin concerne.
5. Retourner un JSON stable avec des messages d'erreur exploitables par le
   frontend.
6. Ajouter un test backend ciblant la route ou le service.
7. Si le frontend consomme la route, mettre a jour le service TypeScript et les
   types partages correspondants.
8. Si une preference est necessaire, l'ajouter dans le schema partage puis
   verifier `documentation/preferences-ajout-rapide.md`.

## 16. Commandes utiles

Demarrer le backend :

```powershell
cd backend
.\.venv\Scripts\python.exe run.py
```

Lancer une selection de tests :

```powershell
cd C:\Users\fabie\Documents\Projets\GeoApp
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_preferences_api.py -q
```

Relancer la decouverte plugins depuis le frontend ou via API :

```http
POST /api/plugins/discover
```

Verifier rapidement les routes declarees :

```powershell
rg -n "@.*route|Blueprint\(" backend\gc_backend\blueprints
```

