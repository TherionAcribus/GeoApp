# Waypoints Éditables - Implémentation

## Vue d'ensemble

Implémentation d'un système complet de gestion des waypoints dans les détails des géocaches, permettant l'ajout, la modification et la suppression de waypoints avec des outils de calcul géographique intégrés.
- Sauvegarde automatique après ajout/modification.
- Synchronisation carte ↔ widget.
- Bouton « ➕ Ajouter comme waypoint » côté Plugin Executor qui pré-remplit automatiquement le formulaire (événement `geoapp-plugin-add-waypoint`).
  - Titre proposé : « Résultat <nom du plugin> »
  - Note proposée : texte brut du résultat du plugin
- Bouton « ✅ Ajouter et valider » côté Plugin Executor qui crée immédiatement le waypoint via l'API (POST) puis recharge la liste et la carte.
- Calculs intégrés : antipode, projections (distance + azimut) avec conversion automatique au format Geocaching.
- Définition rapide d'un waypoint comme coordonnées corrigées de la géocache.
- Création instantanée d'un waypoint depuis le **Plugin Executor** quand une coordonnée est détectée, avec titre et note préremplis.
  - Mode manuel (préremplissage) ou mode auto-validé (création directe + rafraîchissement).

## Fonctionnalités Implémentées

### 1. Interface Utilisateur (Frontend - React/TypeScript)

**Fichier modifié:** `src/browser/geocache-details-widget.tsx`

#### Composant d'édition des waypoints
- **Affichage en tableau** avec colonnes : Préfixe, Lookup, Nom, Type, Coordonnées, Note, Actions
- **Bouton "Ajouter un waypoint"** toujours visible
- **Mode édition inline** avec formulaire contextuel

#### Formulaire d'édition
Champs disponibles :
- Préfixe (ex: "WP")
- Lookup (code du waypoint)
- Nom du waypoint
- Type (Parking, Question, Final, etc.)
- Coordonnées au format Geocaching (N 48° 51.402, E 002° 21.048)
- Note (texte libre)

#### Outils de calcul géographique

##### Calcul d'antipode
- Calcule le point diamétralement opposé sur Terre
- Bouton "Calculer l'antipode"
- Résultat affiché au format Geocaching

##### Calcul de projection
Paramètres configurables :
- **Distance** : valeur numérique
- **Unité** : mètres, kilomètres ou miles
- **Angle** : 0-359° (0° = Nord)
- Bouton "Calculer la projection"

##### Application des résultats
- Les coordonnées calculées s'affichent dans un champ "Résultat"
- Bouton "Appliquer" pour transférer les coordonnées dans le formulaire
- Les coordonnées sont automatiquement converties en format décimal et GC

#### Actions disponibles
- ✏️ **Éditer** : Ouvre le formulaire d'édition pré-rempli
- 🗑️ **Supprimer** : Supprime le waypoint après confirmation
- **Annuler** : Ferme le formulaire sans sauvegarder
- **Sauvegarder** : Enregistre les modifications via l'API

### 2. Fonctions de Calcul Géographique

#### `calculateAntipode(lat, lon)`
Calcule l'antipode d'un point :
```typescript
lat_antipode = -lat
lon_antipode = lon > 0 ? lon - 180 : lon + 180
```

#### `calculateProjection(lat, lon, distance, bearing)`
Calcule une projection géographique en utilisant la formule de Haversine :
- Rayon terrestre : 6371000 mètres
- Conversion en radians pour les calculs trigonométriques
- Retour en degrés décimaux

#### `toGCFormat(lat, lon)`
Convertit des coordonnées décimales en format Geocaching :
- Exemple : 48.8567 → N 48° 51.402

#### `parseGCCoords(gcLat, gcLon)`
Parse les coordonnées au format Geocaching vers décimal :
- Regex : `/([NS])\s*(\d+)°\s*([\d.]+)/`
- Gestion des directions N/S/E/W

### 3. Backend API (Python/Flask)

**Fichier modifié:** `gc-backend/gc_backend/blueprints/geocaches.py`

#### Endpoints ajoutés

##### POST `/api/geocaches/<geocache_id>/waypoints`
Crée un nouveau waypoint
- **Body JSON** : `{ prefix, lookup, name, type, latitude, longitude, gc_coords, note }`
- **Retour** : Waypoint créé avec son ID (201)

##### PUT `/api/geocaches/<geocache_id>/waypoints/<waypoint_id>`
Met à jour un waypoint existant
- **Body JSON** : Champs à modifier
- **Retour** : Waypoint mis à jour (200)

##### DELETE `/api/geocaches/<geocache_id>/waypoints/<waypoint_id>`
Supprime un waypoint
- **Retour** : `{ success: true }` (200)

#### Gestion des erreurs
- Vérification de l'existence de la géocache
- Vérification de l'existence du waypoint
- Rollback automatique en cas d'erreur
- Logs détaillés pour le debugging

### 4. Modèle de Données

**Fichier existant:** `gc-backend/gc_backend/geocaches/models.py`

#### Classe `GeocacheWaypoint`
```python
class GeocacheWaypoint(db.Model):
    id: Integer (PK)
    geocache_id: Integer (FK)
    prefix: String(20)
    lookup: String(50)
    name: String(255)
    type: String(100)
    latitude: Float
    longitude: Float
    gc_coords: String(100)
    note: Text
```

Relation : `geocache.waypoints` (cascade delete)

## Architecture Respectée

### Principes suivis
✅ **Modularité** : Composant React autonome avec logique encapsulée
✅ **Documentation** : Commentaires JSDoc sur toutes les fonctions
✅ **Gestion d'erreurs** : Try/catch avec messages utilisateur clairs
✅ **Style Theia** : Utilisation des classes CSS Theia natives
✅ **API RESTful** : Endpoints standards CRUD
✅ **Validation** : Vérification des coordonnées avant calcul

### Respect des règles du projet
- ✅ Code découpé en petites fonctions
- ✅ Documentation complète
- ✅ Gestion d'erreurs systématique
- ✅ Pas de style inline (sauf nécessaire pour React)
- ✅ Logs backend pour traçabilité

## Utilisation

### Pour ajouter un waypoint
1. Ouvrir les détails d'une géocache
2. Cliquer sur "Ajouter un waypoint"
3. Remplir les champs (les coordonnées de la géocache sont pré-remplies)
4. Optionnel : Utiliser les outils de calcul
5. Cliquer sur "Sauvegarder"

### Pour modifier un waypoint
1. Cliquer sur ✏️ dans la ligne du waypoint
2. Modifier les champs souhaités
3. Optionnel : Recalculer les coordonnées
4. Cliquer sur "Sauvegarder"

### Pour supprimer un waypoint
1. Cliquer sur 🗑️ dans la ligne du waypoint
2. Confirmer la suppression

### Calculs géographiques
1. En mode édition, entrer des coordonnées de départ
2. Pour l'antipode : Cliquer sur "Calculer l'antipode"
3. Pour une projection :
   - Entrer distance, unité et angle
   - Cliquer sur "Calculer la projection"
4. Cliquer sur "Appliquer" pour utiliser les coordonnées calculées

## Tests à effectuer

- [ ] Création d'un waypoint avec coordonnées manuelles
- [ ] Création d'un waypoint avec calcul d'antipode
- [ ] Création d'un waypoint avec projection (100m à 45°)
- [ ] Modification d'un waypoint existant
- [ ] Suppression d'un waypoint
- [ ] Vérification de la persistance après rechargement
- [ ] Test avec différentes unités (m, km, miles)
- [ ] Test avec angles variés (0°, 90°, 180°, 270°)

## Notes techniques

### Format des coordonnées
Le système gère deux formats :
- **Décimal** : 48.8567, 2.3508 (stocké en DB)
- **Geocaching** : N 48° 51.402, E 002° 21.048 (affiché)

### Conversion automatique
Lors de l'application de coordonnées calculées, le système :
1. Parse le format GC vers décimal
2. Met à jour les deux champs (`gc_coords` et `latitude`/`longitude`)

### État React
Le composant utilise `useState` pour :
- `editingId` : ID du waypoint en cours d'édition ou 'new'
- `editForm` : Données du formulaire
- `projectionParams` : Paramètres de projection
- `calculatedCoords` : Résultat des calculs

## Améliorations futures possibles

- [ ] Validation des coordonnées en temps réel
- [ ] Prévisualisation sur carte lors de l'édition
- [ ] Import/export de waypoints
- [ ] Templates de waypoints (Parking, Question, etc.)
- [ ] Historique des modifications
- [ ] Calcul de distance entre waypoints
- [ ] Support des formats de coordonnées additionnels (UTM, etc.)
