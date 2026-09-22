# MyGeoApp

> Un atelier de travail pour le géocaching — et surtout pour la résolution de caches mystères.
> *A geocaching workbench, focused on solving mystery caches.*

**[🇫🇷 Français](#-français) · [🇬🇧 English](#-english)**

---

## 🇫🇷 Français

### Présentation

**MyGeoApp** est un projet **personnel**, développé sur mon temps libre pour mes propres besoins de géocacheur : gérer mes caches, préparer mes sorties, et surtout venir à bout des mystères.

Il est publié librement : **utilisez-le, modifiez-le, forkez-le**, il est là pour ça. Je serai simplement ravi de savoir qu'il sert à quelqu'un.

L'application est construite sur **[Eclipse Theia](https://theia-ide.org)** (la plateforme derrière Theia IDE) : elle en reprend l'ergonomie — panneaux latéraux, onglets, palette de commandes, préférences — avec des extensions maison dédiées au géocaching. Le backend est une API **Flask** locale avec une base **SQLite**.

### ⚠️ À lire avant de se lancer

- **Le programme est en cours de développement.** Ce n'est pas un logiciel fini : il reste beaucoup de bugs à corriger, de fonctions à terminer, et le graphisme est encore assez brut.
- **Le schéma de la base de données évolue.** Des modifications à venir peuvent **casser une base existante**. Sauvegardez `backend/data/geoapp.db` si vos données comptent pour vous, et attendez-vous à devoir repartir de zéro de temps en temps.
- **MyGeoApp n'utilise pas l'API officielle de Groundspeak.** Comme c:geo et d'autres outils, l'application ouvre une session authentifiée sur `geocaching.com` et lit les pages du site. Conséquences : cela peut cesser de fonctionner du jour au lendemain si le site change, et il vous appartient de rester raisonnable dans le volume de requêtes et de respecter les conditions d'utilisation de Geocaching.com. Vos identifiants restent sur votre machine (trousseau système).
- L'application tourne **en local**, sur votre machine, avec vos données.

### Fonctionnalités principales

**Gestion des géocaches**
- Organisation en **zones** (dossiers thématiques) : créer, trier, fusionner, dupliquer, glisser-déposer.
- Import depuis **GPX**, **pocket queries**, **listes de favoris**, **autour d'un point**, ou par code GC.
- Tableau de zone triable et filtrable (langage de filtres avec opérateurs : type, D/T, favoris, trouvailles…).
- Fiche détaillée par cache : description mise en forme, attributs, waypoints, coordonnées, galerie d'images.
- Export GPX.

**Résolution de mystères**
- Plus de **100 plugins** de déchiffrement : chiffres classiques (César, Vigenère, Morse, Braille, ADFGVX, Playfair, Enigma…), encodages (Base64, hexadécimal, binaire), codes visuels, stéganographie, analyse d'images, OCR…
- **MetaSolver** : lance en série plusieurs plugins sur un fragment de texte et classe les résultats.
- **Scoring** : les sorties des plugins (y compris en brute-force) sont notées par vraisemblance linguistique et présence de coordonnées.
- **Formula Solver** : extraction et résolution des formules de coordonnées, avec aide IA ou recherche web pour répondre aux questions du listing.
- **Alphabets** : plus de 80 alphabets et systèmes de symboles consultables, avec transcription assistée.
- **Grid Puzzle Solver** : solveur de grilles (Sudoku et variantes) basé sur Z3.
- **Exécution par lot** : appliquer un plugin à toute une sélection de caches.
- **Archive de résolution** : journal de vos tentatives, coordonnées testées, résultats.
- Détection automatique de coordonnées dans les textes, waypoints calculés, carte interactive OpenLayers.

**Intelligence artificielle (optionnelle, avec vos propres clés API)**
- Fournisseurs configurables : OpenAI, Anthropic, Ollama, OpenRouter, Google…
- **Chat IA GeoApp** : assistant conscient du contexte de la cache ouverte, capable d'utiliser les outils de l'application.
- **@Aide** : agent qui répond sur l'utilisation du logiciel *et* exécute des actions (ouvrir un widget, créer une zone, etc.).
- **@EarthCoach** : agent spécialisé EarthCaches (géologie, préparation de terrain, observations structurées).
- **Analyse de sortie** : à partir d'une sélection de caches, génère une checklist matériel, une estimation de temps, des alertes et une priorisation (heure de coucher du soleil incluse).
- Agents spécialisés : traduction des listings, OCR des images, analyse des logs, résolution de formules.

**Geocaching.com**
- Connexion (identifiants ou cookies du navigateur), session persistante, mot de passe dans le trousseau système.
- Récupération des **logs** d'une cache et analyse IA du logbook.
- **Notes personnelles** : import et envoi vers GC.com.
- **Publication de logs** (à l'unité ou par lot), envoi des coordonnées corrigées.
- **Amis** : liste d'amis, flux d'activité, « qui a trouvé quoi », carte des découvertes.

**Confort**
- Documentation utilisateur intégrée (icône 📖 ou `Shift+F1`) avec recherche plein texte.
- Recherche globale dans vos géocaches.
- Notes Markdown par cache, préférences détaillées, disposition des panneaux mémorisée.

### Prérequis

| Outil | Version |
|---|---|
| Python | 3.10+ (testé en 3.14) |
| Node.js | ≥ 22 |
| Yarn | 1.x (`yarn@1.22`, **pas** Yarn 2+) |

### Installation

```powershell
git clone https://github.com/TherionAcribus/GeoApp.git
cd GeoApp
```

**1. Backend Python**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate          # Linux/macOS : source .venv/bin/activate
pip install -r requirements.txt

# Optionnel : nécessaire seulement pour les checkers (Certitude, GeoCheck…)
playwright install chromium
```

La base SQLite (`backend/data/geoapp.db`) est créée automatiquement au premier démarrage.

**2. Frontend Theia**

```powershell
cd frontend
yarn install
yarn build          # première compilation : comptez plusieurs minutes
```

### Lancement

Deux serveurs doivent tourner **en même temps**, dans deux terminaux.

**Terminal 1 — serveur Python (API, port 8000)**

```powershell
cd backend
.venv\Scripts\activate
python run.py
```

→ `http://127.0.0.1:8000`

**Terminal 2 — serveur Node/Theia (interface, port 3000)**

```powershell
cd frontend/applications/browser
yarn start
```

→ ouvrez ensuite **http://localhost:3000** dans votre navigateur.

Pour utiliser un autre port : `yarn start --port 3001` (pensez alors à ajuster les origines CORS autorisées dans `backend/gc_backend/__init__.py`).

### Développement

Le navigateur charge le bundle webpack, pas les fichiers compilés des extensions : après une modification, il faut **rebuilder l'application**, pas seulement l'extension.

```powershell
# Terminal 3 : recompilation continue (extensions + bundle)
cd frontend
yarn watch
```

Puis `Ctrl+R` dans le navigateur. Sinon, `yarn build` depuis `frontend/` refait tout.

Tests :

```powershell
cd backend && pytest tests/ -v      # backend
cd frontend && yarn test            # frontend
```

La documentation technique détaillée se trouve dans [`documentation/`](documentation/) (architecture backend, plugins, IA, coordonnées, logs, amis…).

### Contribuer / me contacter

Si vous installez MyGeoApp, **n'hésitez vraiment pas à me contacter** : retours d'usage, bugs, idées, corrections, contributions de code — tout m'intéresse. Le projet a été écrit pour un seul utilisateur, il ne progressera qu'avec des regards extérieurs.

- Ouvrez une [issue](https://github.com/TherionAcribus/GeoApp/issues) ou une pull request
- Ou passez par mon profil GitHub : [@TherionAcribus](https://github.com/TherionAcribus)

### Licence

MIT (voir [`frontend/LICENSE`](frontend/LICENSE)). Eclipse Theia est une marque de l'Eclipse Foundation. MyGeoApp n'est affilié ni à Groundspeak, ni à Geocaching.com.

---

## 🇬🇧 English

> **Note — the interface is currently French only.** All labels, menus, documentation and AI prompts are written in French. Nothing prevents the application from being translated: if some of you are interested in another language, get in touch and we will set up proper internationalisation.

### Overview

**MyGeoApp** is a **personal project**, written in my spare time for my own geocaching needs: managing caches, preparing outings, and above all cracking mystery caches.

It is released openly: **use it, modify it, fork it** — that is what it is here for. I would simply be glad to know it is useful to someone.

The application is built on **[Eclipse Theia](https://theia-ide.org)** (the platform behind Theia IDE), so it inherits its ergonomics — side panels, tabs, command palette, preferences — with custom extensions dedicated to geocaching. The backend is a local **Flask** API backed by **SQLite**.

### ⚠️ Read this first

- **This is a work in progress.** It is not finished software: expect bugs, half-done features, and fairly rough visuals.
- **The database schema keeps changing.** Upcoming changes may **break an existing database**. Back up `backend/data/geoapp.db` if your data matters, and be ready to start over now and then.
- **MyGeoApp does not use the official Groundspeak API.** Like c:geo and other tools, it opens an authenticated session on `geocaching.com` and reads the website's pages. This means it may break overnight if the site changes, and it is up to you to keep your request volume reasonable and to respect Geocaching.com's terms of use. Your credentials stay on your machine (system keyring).
- Everything runs **locally**, on your machine, with your data.

### Main features

**Cache management**
- Organisation into **zones** (thematic folders): create, sort, merge, duplicate, drag & drop.
- Import from **GPX**, **pocket queries**, **bookmark lists**, **around a point**, or by GC code.
- Sortable and filterable zone table (filter language with operators: type, D/T, favourites, finds…).
- Detailed cache view: formatted description, attributes, waypoints, coordinates, image gallery.
- GPX export.

**Mystery solving**
- Over **100 decoding plugins**: classic ciphers (Caesar, Vigenère, Morse, Braille, ADFGVX, Playfair, Enigma…), encodings (Base64, hex, binary), visual codes, steganography, image analysis, OCR…
- **MetaSolver**: runs several plugins over a text fragment and ranks the results.
- **Scoring**: plugin outputs (brute-force included) are ranked by linguistic plausibility and coordinate detection.
- **Formula Solver**: extracts and solves coordinate formulas, with AI or web search to answer the listing's questions.
- **Alphabets**: 80+ alphabets and symbol systems, with assisted transcription.
- **Grid Puzzle Solver**: Z3-based solver for Sudoku and its variants.
- **Batch execution**: apply a plugin to a whole selection of caches.
- **Solving archive**: a log of your attempts, tested coordinates and results.
- **Checkers**: verify found coordinates (Certitude, GeoCheck…) through Playwright.
- Automatic coordinate detection in text, computed waypoints, interactive OpenLayers map.

**AI (optional, with your own API keys)**
- Configurable providers: OpenAI, Anthropic, Ollama, OpenRouter, Google…
- **GeoApp AI Chat**: an assistant aware of the open cache's context, able to drive the application's tools.
- **@Aide**: answers questions about the software *and* performs actions (open a widget, create a zone…).
- **@EarthCoach**: EarthCache specialist (geology, field preparation, structured observations).
- **Outing analysis**: from a selection of caches, produces a gear checklist, a time estimate, warnings and a priority order (sunset time included).
- Dedicated agents: listing translation, image OCR, log analysis, formula solving.

**Geocaching.com**
- Login (credentials or browser cookies), persistent session, password stored in the system keyring.
- **Log** retrieval for a cache, plus AI analysis of the logbook.
- **Personal cache notes**: import from and push to GC.com.
- **Log publishing** (single or batch), corrected-coordinate upload.
- **Friends**: friend list, activity feed, "who found what", map of their finds.

**Quality of life**
- Built-in user documentation (📖 icon or `Shift+F1`) with full-text search.
- Global search across your caches.
- Markdown notes per cache, fine-grained preferences, remembered panel layout.

### Requirements

| Tool | Version |
|---|---|
| Python | 3.10+ (tested on 3.14) |
| Node.js | ≥ 22 |
| Yarn | 1.x (`yarn@1.22`, **not** Yarn 2+) |

### Installation

```powershell
git clone https://github.com/TherionAcribus/GeoApp.git
cd GeoApp
```

**1. Python backend**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt

# Optional: only needed for the checkers (Certitude, GeoCheck…)
playwright install chromium
```

The SQLite database (`backend/data/geoapp.db`) is created automatically on first run.

**2. Theia frontend**

```powershell
cd frontend
yarn install
yarn build          # first build takes several minutes
```

### Running the app

Two servers must run **at the same time**, in two terminals.

**Terminal 1 — Python server (API, port 8000)**

```powershell
cd backend
.venv\Scripts\activate
python run.py
```

→ `http://127.0.0.1:8000`

**Terminal 2 — Node/Theia server (UI, port 3000)**

```powershell
cd frontend/applications/browser
yarn start
```

→ then open **http://localhost:3000** in your browser.

To use another port: `yarn start --port 3001` (remember to adjust the allowed CORS origins in `backend/gc_backend/__init__.py`).

### Development

The browser loads the webpack bundle, not the extensions' compiled files: after a change you must **rebuild the application**, not just the extension.

```powershell
# Terminal 3: continuous rebuild (extensions + bundle)
cd frontend
yarn watch
```

Then hit `Ctrl+R` in the browser. Otherwise `yarn build` from `frontend/` rebuilds everything.

Tests:

```powershell
cd backend && pytest tests/ -v      # backend
cd frontend && yarn test            # frontend
```

Detailed technical documentation lives in [`documentation/`](documentation/) — in French (backend architecture, plugins, AI, coordinates, logs, friends…).

### Contributing / getting in touch

If you install MyGeoApp, **please do get in touch**: feedback, bug reports, ideas, fixes, code contributions — all of it is welcome. The project was written for a single user; it will only improve with outside eyes.

- Open an [issue](https://github.com/TherionAcribus/GeoApp/issues) or a pull request
- Or reach me through my GitHub profile: [@TherionAcribus](https://github.com/TherionAcribus)

### License

MIT (see [`frontend/LICENSE`](frontend/LICENSE)). Eclipse Theia is a trademark of the Eclipse Foundation. MyGeoApp is not affiliated with Groundspeak or Geocaching.com.
