# 🗺️ Système de Cartes Contextuelles

## 🎯 Concept

Inspiré du fonctionnement des terminaux dans les IDE modernes, chaque contexte (Zone, Géocache) a maintenant **sa propre carte indépendante** dans le Bottom Layer.

## ✨ Fonctionnalités

### 📌 Une carte = Un contexte

- **Zone** → Carte affichant toutes les géocaches de la zone
- **Géocache** → Carte centrée sur la géocache + ses waypoints
- **Générale** → Carte globale (utilisable via commande)

### 🔄 Navigation automatique

Quand vous naviguez dans l'application :
- **Ouvrir une zone** → Crée/active l'onglet "Zone: Nom de la zone"
- **Cliquer sur une géocache** → Crée/active l'onglet "Géocache: GC12345"
- **Changer de zone** → Bascule vers la carte de cette zone

### 💾 Persistance

- Chaque carte reste ouverte jusqu'à fermeture manuelle
- Revenir sur une zone/géocache réactive sa carte existante
- Pas de rechargement inutile des données

## 🏗️ Architecture

### Composants principaux

#### 1. `MapWidget`

Widget de carte avec contexte intégré.

```typescript
interface MapContext {
    type: 'zone' | 'geocache' | 'general';
    id?: number;
    label: string;
}
```

**Méthodes** :
- `setContext(context)` - Définit le contexte
- `getContext()` - Récupère le contexte actuel

**ID dynamiques** :
- Zone : `geoapp-map-zone-{id}`
- Géocache : `geoapp-map-geocache-{id}`
- Générale : `geoapp-map`

#### 2. `MapWidgetFactory`

Factory gérant la création et l'ouverture des cartes.

**Méthodes principales** :

```typescript
// Ouvrir une carte pour une zone
openMapForZone(zoneId: number, zoneName: string, geocaches: any[]): Promise<MapWidget>

// Ouvrir une carte pour une géocache
openMapForGeocache(geocacheId: number, gcCode: string, geocacheData: any): Promise<MapWidget>

// Ouvrir une carte générale
openGeneralMap(geocaches?: any[]): Promise<MapWidget>

// Fermer toutes les cartes
closeAllMaps(): void

// Fermer par type
closeMapsByType(type: 'zone' | 'geocache' | 'general'): void
```

**Logique** :
1. Vérifie si une carte existe déjà pour ce contexte
2. Si oui → active la carte existante
3. Si non → crée une nouvelle carte
4. Charge les géocaches après un délai (300ms pour l'initialisation)

#### 3. Intégration dans `ZoneGeocachesWidget`

```typescript
// Au chargement d'une zone
this.mapWidgetFactory.openMapForZone(this.zoneId, this.zoneName, mapGeocaches);

// Au clic sur une géocache
this.mapWidgetFactory.openMapForGeocache(geocache.id, geocache.gc_code, geocacheData);
```

### Flux de données

```
┌─────────────────────┐
│ ZoneGeocachesWidget │
│   (Zone ouverte)    │
└──────────┬──────────┘
           │
           ├─ Charge les géocaches
           │
           v
┌─────────────────────┐
│  MapWidgetFactory   │
│ openMapForZone()    │
└──────────┬──────────┘
           │
           ├─ Cherche carte existante
           ├─ Crée si nécessaire
           │
           v
┌─────────────────────┐
│     MapWidget       │
│ Context: Zone #5    │
│ ID: geoapp-map-     │
│      zone-5         │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│     MapService      │
│ loadGeocaches()     │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│      MapView        │
│  (Rendu OpenLayers) │
└─────────────────────┘
```

## 📊 Exemples d'usage

### Scénario 1 : Navigation Zone → Géocache

```
1. Utilisateur ouvre "Zone: Forêt de Fontainebleau"
   → Onglet créé : "Zone: Forêt de Fontainebleau"
   → Affiche 15 géocaches

2. Utilisateur clique sur "GC12345"
   → Onglet créé : "Géocache: GC12345"
   → Affiche la géocache + 3 waypoints
   → Centré et zoomé sur GC12345

3. Utilisateur clique sur "GC67890"
   → Onglet créé : "Géocache: GC67890"
   → Affiche GC67890 + ses waypoints

4. Utilisateur re-clique onglet "Zone: Forêt..."
   → Revient à la vue de la zone
   → Toutes les 15 géocaches toujours affichées
```

### Scénario 2 : Plusieurs zones ouvertes

```
Bottom Layer:
├─ Zone: Forêt de Fontainebleau (12 caches)
├─ Zone: Paris Centre (8 caches)
├─ Géocache: GC12345
└─ Géocache: GC67890

→ Chaque onglet est indépendant
→ Pas de conflit entre les affichages
```

## 🎨 Apparence

### Onglets Bottom Layer

```
┌──────────────────────────────────────────────────────────┐
│ ⌄ Problems  Output  Terminal  Debug Console              │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  🗺️ Zone: Forêt  🗺️ Zone: Paris  🗺️ GC12345  🗺️ GC67890 │
│  ┌────────────┐                                          │
│  │            │                                           │
│  │    CARTE   │ ← Carte de "Zone: Forêt de Fontainebleau"│
│  │            │                                           │
│  └────────────┘                                          │
└──────────────────────────────────────────────────────────┘
```

### Titre des onglets

- **Zone** : "Zone: {Nom de la zone}"
- **Géocache** : "Géocache: {GC Code}"
- **Générale** : "Carte Générale"

### Icône

Toutes les cartes ont l'icône `fa fa-map` 🗺️

## ⚙️ Configuration

### Désactivation singleton

Pour permettre plusieurs instances de `MapWidget` :

```typescript
// zones-frontend-module.ts
bind(MapWidget).toSelf(); // PAS .inSingletonScope()
```

### Factory en singleton

La factory elle-même est singleton :

```typescript
bind(MapWidgetFactory).toSelf().inSingletonScope();
```

## 🔧 Gestion des cartes

### Fermer toutes les cartes

```typescript
this.mapWidgetFactory.closeAllMaps();
```

### Fermer par type

```typescript
// Fermer toutes les cartes de zones
this.mapWidgetFactory.closeMapsByType('zone');

// Fermer toutes les cartes de géocaches
this.mapWidgetFactory.closeMapsByType('geocache');
```

### Accès programmatique

```typescript
// Récupérer toutes les cartes ouvertes
const mapWidgets = this.shell.getWidgets('bottom')
    .filter(w => w.id.startsWith('geoapp-map'));

// Trouver une carte spécifique
const zoneMapId = `geoapp-map-zone-${zoneId}`;
const mapWidget = this.shell.getWidgets('bottom')
    .find(w => w.id === zoneMapId);
```

## 📝 Points techniques

### Délai de chargement

Un délai de **300ms** est appliqué avant de charger les géocaches :

```typescript
setTimeout(() => {
    this.mapService.loadGeocaches(geocaches);
}, 300);
```

**Raison** : La carte OpenLayers a besoin de temps pour s'initialiser complètement.

### ID uniques

Les IDs sont générés dynamiquement :

```typescript
geoapp-map                    // Carte générale
geoapp-map-zone-5             // Zone #5
geoapp-map-geocache-123       // Géocache #123
```

### Réutilisation des cartes

Si une carte existe déjà pour un contexte, elle est **réactivée** plutôt que recréée.

### Données chargées

#### Pour une zone :
- Toutes les géocaches de la zone
- Leurs waypoints
- Leurs coordonnées originales (si corrigées)

#### Pour une géocache :
- La géocache principale
- Ses waypoints
- Ses coordonnées originales (si corrigée)

## 🚀 Avantages

### ✅ Pour l'utilisateur

- **Contexte préservé** : Chaque carte garde son état
- **Navigation fluide** : Pas de rechargement au changement de contexte
- **Organisation claire** : Un onglet = Un contexte
- **Multitâche** : Plusieurs cartes ouvertes simultanément

### ✅ Pour le développeur

- **Code modulaire** : Factory pattern
- **Extensible** : Facile d'ajouter de nouveaux types de contextes
- **Maintenance** : Logique centralisée dans la factory
- **Debug** : IDs uniques facilitent l'identification

## 🔮 Évolutions futures possibles

### Nouveaux types de contextes

```typescript
// Carte pour une série (multi-cache)
openMapForSeries(seriesId: number, geocaches: any[]): Promise<MapWidget>

// Carte pour un waypoint spécifique
openMapForWaypoint(waypointId: number, waypointData: any): Promise<MapWidget>

// Carte pour un itinéraire
openMapForRoute(routeId: number, waypoints: any[]): Promise<MapWidget>
```

### Synchronisation entre cartes

- Lier plusieurs cartes pour un zoom/pan synchronisé
- Partager la sélection entre cartes

### Sauvegarde de l'état

- Sauvegarder la position/zoom de chaque carte
- Restaurer les cartes ouvertes au démarrage

### Personnalisation

- Choisir le fond de carte par contexte
- Filtres d'affichage par carte

## 📚 Références

- **Code source** : `src/browser/map/map-widget-factory.ts`
- **Widget** : `src/browser/map/map-widget.tsx`
- **Intégration** : `src/browser/zone-geocaches-widget.tsx`

---

**Résultat** : Un système de cartes moderne, flexible et intuitif ! 🗺️✨


