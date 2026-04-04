# Zones - Implémentation Backend Flask + Extension Theia

## Vue d'ensemble
- **Backend**: API REST Flask avec SQLite/SQLAlchemy pour gérer les zones
- **Frontend**: Extension Theia avec widget dans la barre latérale gauche pour afficher/ajouter/choisir des zones actives

## Lancement

### Backend (Flask)
```bash
cd gc-backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
python run.py
```
- API disponible sur `http://127.0.0.1:8000`
- Endpoints: `/api/zones` (GET/POST), `/api/active-zone` (GET/POST)
- DB SQLite créée automatiquement dans `gc-backend/data/geoapp.db` avec zone "default"

### Frontend (Theia Browser)
```bash
cd theia-blueprint
yarn
yarn build:extensions
yarn build:applications:dev
yarn --cwd applications/browser start
```
- IDE disponible sur `http://127.0.0.1:3000`
- Widget "Zones" dans barre latérale gauche

## Fonctionnalités implémentées
- ✅ CRUD zones (liste/ajout/édition/suppression côté backend)
- ✅ Sélection zone active (persistée en DB)
- ✅ Widget Theia avec formulaire d'ajout et liste cliquable
- ✅ Compteur géocaches par zone (placeholder à 0)
- ✅ Architecture modulaire (Flask blueprints, Theia extensions)

## Prochaines étapes
- Implémenter modèle Geocache et relation many-to-many avec Zone
- Remplacer compteur placeholder par vrai comptage
- Ajouter suppression/édition de zones côté widget
- Intégrer avec cartes et vues géocaches
