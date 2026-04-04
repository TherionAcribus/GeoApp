# 🚀 Guide de Démarrage Rapide - GeoApp

## Prérequis

- Python 3.9+ avec pip
- Node.js 16+ avec Yarn
- Un compte geocaching.com (pour le scraping)

## Installation & Lancement (Première Fois)

### 1. Backend Flask

```bash
# Se placer dans le dossier backend
cd gc-backend

# Créer et activer l'environnement virtuel (optionnel mais recommandé)
python -m venv .venv
.venv\Scripts\activate  # Sur Windows
# source .venv/bin/activate  # Sur Linux/Mac

# Installer les dépendances
pip install -r requirements.txt

# Lancer le serveur
python run.py
```

Le backend démarre sur `http://127.0.0.1:8000`

### 2. Frontend Theia

```bash
# Se placer dans le dossier theia-blueprint
cd theia-blueprint

# Installer les dépendances (première fois seulement)
yarn install

# Compiler les extensions et l'application
yarn build:applications:dev

# Lancer l'application
cd applications/browser
yarn start
```

L'application Theia s'ouvre sur `http://localhost:3000`

## Démarrage Rapide (Après Installation)

### Terminal 1 : Backend
```bash
cd gc-backend
python run.py
```

### Terminal 2 : Frontend
```bash
cd theia-blueprint/applications/browser
yarn start
```

## Utilisation Basique

### 1. Créer une Zone
1. Ouvrir Theia dans le navigateur (`http://localhost:3000`)
2. Dans le panneau gauche "Zones", entrer un nom de zone
3. Cliquer sur "Ajouter"

### 2. Ajouter des Géocaches
1. Cliquer sur une zone dans le panneau gauche
2. Le tableau des géocaches s'ouvre (vide)
3. Dans le formulaire en haut, entrer un code GC (ex: `GC9ABCD`)
4. Cliquer sur "Importer"
5. Attendre quelques secondes (le scraping prend du temps)
6. La géocache apparaît dans le tableau !

### 3. Explorer les Fonctionnalités
- **Trier** : Cliquer sur les en-têtes de colonnes
- **Rechercher** : Utiliser la barre de recherche en haut
- **Sélectionner** : Cocher les cases à gauche
- **Rafraîchir** : Sélectionner plusieurs caches et cliquer "Rafraîchir"
- **Supprimer** : Sélectionner et cliquer "Supprimer"
- **Pagination** : Changer le nombre de lignes affichées

## Dépannage

### Backend ne démarre pas
```bash
# Vérifier que le port 8000 n'est pas utilisé
netstat -ano | findstr :8000  # Windows
lsof -i :8000                 # Linux/Mac

# Réinstaller les dépendances
pip install --force-reinstall -r requirements.txt
```

### Frontend ne compile pas
```bash
# Nettoyer et réinstaller
cd theia-blueprint
yarn clean
rm -rf node_modules  # ou rmdir /s node_modules sur Windows
yarn install
yarn build:applications:dev
```

### Les géocaches ne s'importent pas
- Vérifier que le backend est bien démarré
- Vérifier les logs du backend pour voir les erreurs de scraping
- Vérifier que le code GC est valide (commence par "GC")
- Vérifier la connexion internet (pour scraper geocaching.com)

### Erreur CORS
- Vérifier que le backend est sur le port 8000
- Vérifier que Theia est sur le port 3000
- Les CORS sont configurés dans `gc-backend/gc_backend/__init__.py`

## Logs et Debugging

### Backend
Les logs s'affichent dans le terminal où `python run.py` est lancé.
Niveau de log configuré dans `gc-backend/gc_backend/__init__.py` (actuellement DEBUG).

### Frontend
Ouvrir les DevTools du navigateur (F12) et voir la console.

## Architecture Simplifiée

```
GeoApp/
├── gc-backend/                 # Backend Flask
│   ├── gc_backend/
│   │   ├── blueprints/        # Routes API
│   │   │   ├── zones.py       # API Zones
│   │   │   └── geocaches.py   # API Géocaches
│   │   ├── geocaches/         # Services géocaches
│   │   │   ├── models.py      # Modèles SQLAlchemy
│   │   │   ├── scraper.py     # Scraper geocaching.com
│   │   │   └── importer.py    # Import de géocaches
│   │   ├── database.py        # Config DB
│   │   ├── models.py          # Modèle Zone
│   │   └── __init__.py        # App factory
│   ├── run.py                 # Point d'entrée
│   └── requirements.txt       # Dépendances Python
│
└── theia-blueprint/            # Frontend Theia
    ├── theia-extensions/
    │   └── zones/             # Extension Zones
    │       └── src/browser/
    │           ├── zones-widget.tsx           # Widget zones (sidebar)
    │           ├── zone-geocaches-widget.tsx  # Widget tableau
    │           └── geocaches-table.tsx        # Composant table
    └── applications/
        └── browser/           # Application browser
            └── package.json   # Dépendances frontend
```

## Commandes Utiles

### Backend
```bash
# Lancer en mode debug
python run.py

# Créer la base de données (si besoin)
python -c "from gc_backend import create_app; app = create_app(); app.app_context().push(); from gc_backend.database import db; db.create_all()"

# Tester un endpoint
curl http://127.0.0.1:8000/api/zones
```

### Frontend
```bash
# Recompiler après modification d'une extension
cd theia-blueprint
yarn build:extensions

# Recompiler l'application browser
cd applications/browser
yarn build

# Nettoyer tout
yarn clean

# Mode watch (recompile auto)
cd theia-extensions/zones
yarn watch
```

## Performance

- **Scraping** : 5-15 secondes par géocache
- **Tableau** : Géré côté client, fluide jusqu'à ~500 caches
- **Base de données** : SQLite, performant jusqu'à ~10000 caches

## Sécurité

⚠️ **Cette application est pour usage personnel uniquement !**
- Pas d'authentification
- Backend accessible à tous sur localhost
- Scraping de geocaching.com sans authentification

## Support

Pour toute question, voir :
- `IMPLEMENTATION_COMPLETE.md` : Documentation complète
- `GEOCACHES_TABLE_IMPROVEMENTS.md` : Détails techniques du tableau
- Logs du backend et de la console navigateur

---

**Bon geocaching ! 🗺️📍**



