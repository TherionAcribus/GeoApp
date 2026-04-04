# Implémentation de l'éditeur de coordonnées

## Vue d'ensemble

Cette implémentation ajoute un éditeur de coordonnées complet dans le widget de détails des géocaches, permettant de :
- Afficher les coordonnées originales au format Geocaching
- Corriger les coordonnées tout en préservant les originales
- Revenir aux coordonnées originales
- Gérer le statut de résolution (non résolu, en cours, résolu)

## Architecture

### Backend (Python/Flask)

#### 1. Modèle de données (`gc_backend/geocaches/models.py`)

Nouveaux champs ajoutés au modèle `Geocache` :
- `original_coordinates_raw` (String) : Coordonnées originales au format Geocaching (ex: "N 48° 51.400 E 002° 21.050")
- `solved` (String) : Statut de résolution ('not_solved', 'in_progress', 'solved')

#### 2. Routes API (`gc_backend/blueprints/geocaches.py`)

Trois nouvelles routes :

**PUT `/api/geocaches/<id>/coordinates`**
- Met à jour les coordonnées corrigées
- Parse le format Geocaching pour calculer lat/lon
- Marque `is_corrected = True`

**POST `/api/geocaches/<id>/reset-coordinates`**
- Restaure les coordonnées originales
- Marque `is_corrected = False`

**PUT `/api/geocaches/<id>/solved-status`**
- Met à jour le statut de résolution
- Valeurs acceptées : 'not_solved', 'in_progress', 'solved'

#### 3. Scraper (`gc_backend/geocaches/scraper.py`)

Modifications :
- Fonction `decimal_to_gc_coordinates()` pour convertir décimal → format GC
- Les coordonnées originales sont **toujours** initialisées avec les coordonnées affichées
- Si des coordonnées corrigées sont détectées (userDefinedCoords), les originales sont remplacées

#### 4. Migrations

Deux migrations Alembic créées :
- `add_original_coordinates_raw.py` : Ajoute le champ `original_coordinates_raw`
- `add_solved_status.py` : Ajoute le champ `solved`

### Frontend (TypeScript/React)

#### 1. Type `GeocacheDto`

Nouveaux champs :
- `original_coordinates_raw?: string`
- `solved?: 'not_solved' | 'in_progress' | 'solved'`

#### 2. Composant `CoordinatesEditor`

Composant React fonctionnel qui gère :

**Mode affichage** :
- Affiche les coordonnées actuelles (corrigées ou originales)
- Bouton "Corriger les coordonnées" ou "Modifier" selon l'état
- Si corrigées : affiche aussi les coordonnées originales en référence

**Mode édition** :
- Champ de saisie pour les nouvelles coordonnées
- Affiche les coordonnées originales en référence
- Boutons : Enregistrer, Annuler
- Si corrigées : bouton "Revenir aux coordonnées originales"

**Statut de résolution** :
- Menu déroulant avec 3 options
- Mise à jour en temps réel via API

## Logique métier

### Initialisation des coordonnées

```
Lors du scraping :
1. Extraire coordinates_raw depuis uxLatLon (format GC affiché)
2. Initialiser original_coordinates_raw = coordinates_raw
3. Initialiser original_latitude/longitude = latitude/longitude
4. Si userDefinedCoords détecté :
   - Remplacer original_* par les vraies valeurs d'origine
   - Marquer is_corrected = True
```

### Correction des coordonnées

```
Utilisateur corrige les coordonnées :
1. Saisir nouvelles coordonnées au format GC
2. Backend parse et calcule lat/lon
3. Mise à jour coordinates_raw, latitude, longitude
4. Marquer is_corrected = True
5. original_* restent inchangées (préservées)
```

### Réinitialisation

```
Utilisateur clique "Revenir aux coordonnées originales" :
1. Copier original_coordinates_raw → coordinates_raw
2. Copier original_latitude/longitude → latitude/longitude
3. Marquer is_corrected = False
```

## Formats de coordonnées

Le système gère 4 représentations des coordonnées :

| Champ | Type | Format | Usage |
|-------|------|--------|-------|
| `coordinates_raw` | String | N 48° 51.400 E 002° 21.050 | Affichage, énigmes |
| `latitude/longitude` | Float | 48.856667, 2.350833 | Carte OpenLayers |
| `original_coordinates_raw` | String | N 48° 51.400 E 002° 21.050 | Référence, énigmes |
| `original_latitude/longitude` | Float | 48.856667, 2.350833 | Carte (originales) |

## Statut de résolution

Trois états possibles :
- **not_solved** : Énigme non résolue (défaut)
- **in_progress** : Résolution en cours
- **solved** : Énigme résolue

Ce statut est indépendant de `is_corrected` et permet de suivre la progression de la résolution.

## Cas d'usage

### Cache normale (non corrigée)

```
coordinates_raw: "N 48° 51.400 E 002° 21.050"
original_coordinates_raw: "N 48° 51.400 E 002° 21.050"
is_corrected: False
solved: "not_solved"
```

Interface :
- Affiche les coordonnées
- Bouton "Corriger les coordonnées"
- Statut : Non résolu

### Cache avec coordonnées corrigées

```
coordinates_raw: "N 48° 52.000 E 002° 22.000"
original_coordinates_raw: "N 48° 51.400 E 002° 21.050"
is_corrected: True
solved: "solved"
```

Interface :
- Affiche les coordonnées corrigées
- Affiche les coordonnées originales en référence
- Bouton "Modifier"
- Bouton "Revenir aux coordonnées originales"
- Statut : Résolu

## Installation

1. **Appliquer les migrations** :
   ```bash
   cd gc-backend
   flask db upgrade
   ```

2. **Redémarrer le backend** :
   ```bash
   python run.py
   ```

3. **Recompiler le frontend** (si nécessaire) :
   ```bash
   cd theia-blueprint
   yarn build
   ```

## Notes importantes

- Les coordonnées originales sont **toujours** remplies lors du scraping
- Le format Geocaching est préservé exactement (3 décimales pour les minutes)
- Les coordonnées originales ne sont **jamais** modifiées après le scraping initial
- Le statut de résolution est persisté en base de données
- Les modifications de coordonnées sont immédiates (pas de confirmation)

## Améliorations futures possibles

- Historique des modifications de coordonnées
- Validation du format Geocaching côté frontend
- Copier les coordonnées dans le presse-papier
- Calculateur de distance entre originales et corrigées
- Import/export des coordonnées corrigées
