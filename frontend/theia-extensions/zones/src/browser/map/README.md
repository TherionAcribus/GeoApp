# 🗺️ Module Carte - Documentation technique

## 📁 Structure du module

```
map/
├── map-widget.tsx                    Widget Theia (conteneur)
├── map-widget-factory.ts             Factory pour cartes multiples
├── map-view.tsx                      Vue React + OpenLayers
├── map-service.ts                    Service d'état partagé
├── map-layer-manager.ts              Gestion des couches
├── map-utils.ts                      Utilitaires (conversions)
├── map-tile-providers.ts             Fonds de carte
├── map-geocache-style.ts             Styles clustering
├── map-geocache-style-sprite.ts      Styles sprite sheet
├── map-clustering.ts                 Config clustering
├── map-widget.css                    Styles CSS
└── index.ts                          Exports
```

## 🏗️ Architecture

### Flux de données

```
MapWidgetFactory
    ↓ (crée/active)
MapWidget (contexte: zone/geocache)
    ↓ (contient)
MapView (React + OpenLayers)
    ↓ (écoute)
MapService (état partagé)
    ↓ (utilise)
MapLayerManager (couches OpenLayers)
```

## 📦 Fichiers détaillés

### 1. `map-widget.tsx`

**Rôle** : Widget Theia conteneur pour la carte

**Classe** : `MapWidget extends ReactWidget`

**Responsabilités** :
- Gestion du contexte (zone/géocache)
- Intégration dans le Bottom Layer de Theia
- Gestion du cycle de vie (resize, activation, dispose)

**API publique** :
```typescript
setContext(context: MapContext): void
getContext(): MapContext
```

**ID dynamiques** :
- `geoapp-map` (générale)
- `geoapp-map-zone-{id}`
- `geoapp-map-geocache-{id}`

### 2. `map-widget-factory.ts`

**Rôle** : Factory pour créer et gérer les cartes multiples

**Classe** : `MapWidgetFactory`

**Responsabilités** :
- Créer ou réutiliser les widgets de carte
- Gérer le cycle de vie des cartes
- Activer la bonne carte selon le contexte

**API publique** :
```typescript
openMapForZone(zoneId, zoneName, geocaches): Promise<MapWidget>
openMapForGeocache(geocacheId, gcCode, geocacheData): Promise<MapWidget>
openGeneralMap(geocaches?): Promise<MapWidget>
closeAllMaps(): void
closeMapsByType(type): void
```

**Pattern** : Factory + Singleton

### 3. `map-view.tsx`

**Rôle** : Composant React qui affiche la carte OpenLayers

**Composant** : `MapView` (React.FC)

**Responsabilités** :
- Initialiser OpenLayers
- Gérer les interactions utilisateur
- Écouter les événements du MapService
- Afficher les popups d'information

**Props** :
```typescript
{
    mapService: MapService;
    onMapReady: (map: any) => void;
}
```

**Hooks utilisés** :
- `useRef` : mapInstanceRef, layerManagerRef, overlayRef, popupRef
- `useState` : isInitialized, currentProvider, popupData
- `useEffect` : initialisation, événements, resize

### 4. `map-service.ts`

**Rôle** : Service singleton pour l'état partagé de la carte

**Classe** : `MapService` (injectable)

**Responsabilités** :
- Stocker les géocaches chargées
- Gérer la sélection d'une géocache
- Émettre des événements pour les listeners
- Gérer le fond de carte actif

**API publique** :
```typescript
// Événements
onDidLoadGeocaches: Event<MapGeocache[]>
onDidSelectGeocache: Event<SelectedGeocache | null>
onDidChangeTileProvider: Event<string>
onDidChangeView: Event<MapViewState>

// Méthodes
loadGeocaches(geocaches): void
selectGeocache(geocache): void
changeTileProvider(providerId): void
updateView(center, zoom): void
```

**Pattern** : Service + Observer (EventEmitter)

### 5. `map-layer-manager.ts`

**Rôle** : Gestion des couches OpenLayers

**Classe** : `MapLayerManager`

**Responsabilités** :
- Gérer les couches (tile, geocaches, waypoints)
- Ajouter/supprimer des features
- Gérer la sélection
- Activer/désactiver le clustering

**API publique** :
```typescript
// Couches
changeTileLayer(providerId): void

// Géocaches
addGeocache(geocache): Feature
addGeocaches(geocaches): void
removeGeocache(id): void
clearGeocaches(): void
selectGeocache(id): void
unselectAll(): void

// Waypoints
addWaypoint(id, name, lon, lat): Feature
clearWaypoints(): void

// Clustering
setClusteringEnabled(enabled): void
```

**Couches gérées** :
- `tileLayer` : Fond de carte
- `geocacheLayer` : Géocaches (vectorielle)
- `waypointLayer` : Waypoints (vectorielle)

### 6. `map-utils.ts`

**Rôle** : Fonctions utilitaires

**Fonctions** :
```typescript
lonLatToMapCoordinate(lon: number, lat: number): Coordinate
mapCoordinateToLonLat(coord: Coordinate): [number, number]
calculateExtent(coordinates: Coordinate[]): Extent | null
```

**Projections** :
- `EPSG:4326` : WGS84 (lon/lat)
- `EPSG:3857` : Web Mercator (OpenLayers)

### 7. `map-tile-providers.ts`

**Rôle** : Configuration des fonds de carte

**Providers disponibles** :
```typescript
osm          // OpenStreetMap
satellite    // Esri Satellite
topo         // OpenTopoMap
cycle        // CyclOSM
```

**API** :
```typescript
getTileProviders(): TileProvider[]
createTileLayer(providerId?): any
```

**Structure** :
```typescript
interface TileProvider {
    id: string;
    name: string;
    description: string;
    createSource: () => any;
}
```

### 8. `map-geocache-style.ts`

**Rôle** : Styles pour le clustering

**Fonctions** :
```typescript
createClusterStyle(feature, resolution): Style
```

**Style** :
- Cercles avec nombre de géocaches
- Couleur selon le nombre
- Taille adaptative

### 9. `map-geocache-style-sprite.ts`

**Rôle** : Styles avec sprite sheet officiel

**Fonctions** :
```typescript
createGeocacheStyleFromSprite(feature, resolution): Style | Style[]
createWaypointStyleFromSprite(feature, resolution): Style
```

**Features** :
- Icônes depuis sprite Geocaching.com
- Sélection avec halo jaune
- Opacité réduite si trouvée
- Ancrage au centre de l'icône (pour les disques)

**Interface** :
```typescript
interface GeocacheFeatureProperties {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    selected?: boolean;
}
```

### 10. `map-clustering.ts`

**Rôle** : Configuration du clustering OpenLayers

**Configuration** :
```typescript
CLUSTER_CONFIG = {
    distance: 40,          // Distance de regroupement
    minDistance: 20        // Distance minimale
}
```

**Fonction** :
```typescript
createClusterSource(vectorSource): any
```

### 11. `map-widget.css`

**Rôle** : Styles CSS pour la carte

**Classes** :
```css
.geoapp-map-widget         /* Conteneur principal */
.map-container             /* Conteneur carte */
.ol-attribution            /* Attribution */
.ol-zoom                   /* Boutons zoom */
.ol-control                /* Contrôles généraux */
```

### 12. `index.ts`

**Rôle** : Exports publics du module

**Exports** :
```typescript
export { MapWidget, MapContext } from './map-widget';
export { MapWidgetFactory } from './map-widget-factory';
export { MapView } from './map-view';
export { MapService } from './map-service';
export { MapLayerManager } from './map-layer-manager';
// ... autres exports
```

## 🔗 Dépendances

### Externes
- `ol` (OpenLayers 9.0.0)
- `@theia/core`
- `react`
- `inversify`

### Internes
- `../geocache-icon-config` : Configuration sprite
- `../geocaches-table` : Types Geocache/Waypoint

## 🎯 Points d'entrée

### Pour créer une carte

```typescript
@inject(MapWidgetFactory)
protected readonly mapWidgetFactory!: MapWidgetFactory;

// Ouvrir une carte pour une zone
await this.mapWidgetFactory.openMapForZone(zoneId, zoneName, geocaches);

// Ouvrir une carte pour une géocache
await this.mapWidgetFactory.openMapForGeocache(geocacheId, gcCode, geocacheData);
```

### Pour interagir avec le service

```typescript
@inject(MapService)
protected readonly mapService!: MapService;

// Charger des géocaches
this.mapService.loadGeocaches(geocaches);

// Écouter les événements
this.mapService.onDidLoadGeocaches(geocaches => {
    console.log('Géocaches chargées:', geocaches);
});
```

## 🔧 Configuration

### Activer/désactiver le clustering

```typescript
layerManager.setClusteringEnabled(false); // Désactiver (défaut)
layerManager.setClusteringEnabled(true);  // Activer
```

### Changer le fond de carte

```typescript
mapService.changeTileProvider('satellite');
```

### Personnaliser les styles

Modifier `map-geocache-style-sprite.ts` pour changer :
- Taille des icônes
- Opacité
- Halo de sélection
- Ancrage

## 🐛 Debug

### Logs disponibles

Tous les fichiers principaux ont des logs préfixés :
- `[MapWidget]`
- `[MapWidgetFactory]`
- `[MapView]`
- `[MapService]`
- `[MapLayerManager]`

### Activer les logs

Les logs sont actuellement actifs. Pour les désactiver, voir `../../NETTOYAGE_LOGS.md`.

### Vérifier l'état

```typescript
// Dans la console développeur
const mapService = ... // obtenir le service
console.log(mapService.getLoadedGeocaches());
console.log(mapService.getSelectedGeocache());
```

## 📝 Conventions de code

### Nommage

- **Classes** : PascalCase (`MapWidget`)
- **Interfaces** : PascalCase avec I si ambiguïté (`MapContext`)
- **Méthodes publiques** : camelCase (`loadGeocaches`)
- **Méthodes privées** : camelCase avec préfixe (`_initMap`)
- **Constantes** : UPPER_SNAKE_CASE (`CLUSTER_CONFIG`)

### Organisation

- **1 classe = 1 fichier**
- **Interfaces en début de fichier**
- **Méthodes publiques avant privées**
- **Documentation JSDoc pour API publique**

### Types

- Utiliser `any` pour les types OpenLayers problématiques
- Commenter la raison avec `// OpenLayers 9 type issue`

## 🚀 Évolutions futures

### Court terme
- [ ] Système de debug avec flag
- [ ] Tests unitaires
- [ ] Gestion des erreurs réseau

### Moyen terme
- [ ] Édition de waypoints sur la carte
- [ ] Mesure de distances
- [ ] Export d'images

### Long terme
- [ ] Cartes hors-ligne
- [ ] Synchronisation temps réel
- [ ] Couches personnalisées

## 📚 Documentation complète

Pour la documentation complète, voir :
- `../../CARTES_CONTEXTUELLES.md`
- `../../INTEGRATION_CARTE_COMPLETE.md`
- `../../INDEX_DOCUMENTATION.md`

---

**Module stable et production-ready** ✅  
**Version** : 1.0.0  
**Dernière mise à jour** : Aujourd'hui


