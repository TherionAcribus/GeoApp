# Guide d'utilisation de la carte OpenLayers

## 🗺️ Introduction

Le système de carte GeoApp permet d'afficher et d'interagir avec les géocaches sur une carte interactive basée sur OpenLayers.

## ✨ Fonctionnalités implémentées

### Affichage

- ✅ Carte interactive OpenLayers dans le Bottom Layer
- ✅ Affichage des géocaches avec icônes personnalisées par type
- ✅ **Affichage des géocaches voisines** (dans un rayon de 5km autour d'une géocache sélectionnée)
- ✅ **Affichage des zones d'exclusion** (cercles de 161m autour des géocaches selon des règles spécifiques)
- ✅ Clustering automatique pour les performances (>500 géocaches)
- ✅ Multiple fonds de carte (OSM, Topo, Satellite, etc.)
- ✅ Contrôles de zoom, plein écran, échelle

### Synchronisation

- ✅ Chargement automatique des géocaches d'une zone
- ✅ Clic sur une ligne du tableau → centrage automatique sur la carte
- ✅ Ouverture automatique de la carte au besoin
- ✅ Sélection visuelle de la géocache active
- ✅ Surbrillance de la géocache sélectionnée

### Performance

- ✅ Clustering adaptatif selon le niveau de zoom
- ✅ Désactivation du clustering aux zooms proches (>15)
- ✅ Cache des icônes chargées
- ✅ Gestion optimale du cycle de vie (resize, dispose)

## 🎯 Comment utiliser

### Ouvrir la carte

**Méthode 1 : Commande**
1. Ouvrez la palette de commandes (`Ctrl+Shift+P`)
2. Tapez "GeoApp: Afficher la carte"
3. Appuyez sur Entrée

**Méthode 2 : Menu**
- Via `View > GeoApp Map` (si ajouté au menu)

**Méthode 3 : Raccourci**
- `Ctrl+M` (si configuré)

### Naviguer

- **Zoom** : Molette de la souris ou boutons +/-
- **Pan** : Clic gauche + glisser
- **Plein écran** : Bouton en haut à droite

### Changer le fond de carte

Utilisez le sélecteur en haut de la carte :
- **OpenStreetMap** : Carte standard (par défaut)
- **OpenStreetMap France** : Version française
- **OpenTopoMap** : Carte topographique
- **Satellite (ESRI)** : Vue satellite
- **OpenCycleMap** : Orientée cyclisme
- **Humanitarian** : Version humanitaire HOT

### Interagir avec les géocaches

**Depuis le tableau :**
1. Ouvrez une zone avec des géocaches
2. Cliquez sur une ligne du tableau
3. La carte s'ouvre automatiquement (si fermée)
4. La géocache est centrée et mise en surbrillance

**Sur la carte :**
- Les géocaches sont représentées par leurs icônes officielles
- Les géocaches trouvées apparaissent en transparence (60%)
- La géocache sélectionnée a un cercle bleu autour

**Menu contextuel :**
- **Clic droit** sur une géocache pour ouvrir son menu contextuel
- **"Ouvrir la cache"** : ouvre la page de détails de la géocache dans un nouvel onglet
- **Carte associée** : crée automatiquement une carte spécifique à cette géocache (même comportement que le tableau)

### Afficher les géocaches voisines

Pour voir les autres géocaches dans un rayon de 5km autour d'une géocache spécifique :

1. **Sélectionnez une géocache** en cliquant dessus dans le tableau ou sur la carte
2. **Activez l'affichage** en cochant la case "Géocaches voisines (5km)" dans la barre d'outils de la carte
3. Les géocaches voisines apparaissent automatiquement avec un style plus discret (plus petites et plus transparentes)
4. **Désactivez** la case pour masquer les géocaches voisines

Cette fonctionnalité vous aide à :
- Évaluer la densité de géocaches dans une zone
- Identifier les coordonnées suspectes (trop isolées ou trop proches d'autres caches)
- Planifier vos sorties de géocaching

### Afficher les zones d'exclusion (161m)

Pour analyser les zones impossibles pour les coordonnées corrigées :

1. **Activez l'affichage** en cochant la case "Zones d'exclusion (161m)" dans la barre d'outils
2. Des cercles de 161m (précision GPS) s'affichent automatiquement autour des géocaches éligibles
3. **Chaque couleur représente un type différent** de zone d'exclusion

#### Règles d'affichage des cercles :

- **🟢 Cercle vert** : Géocaches Traditional (toujours affichées - coordonnées fiables)
- **🟡 Cercle jaune** : Géocaches Mystery/Wherigo avec coordonnées corrigées (coordonnées fiables)
- **🟠 Cercle orange** : Géocaches Multi-Cache (coordonnées potentiellement fiables)
- **🟣 Cercle violet** : Géocaches Letterbox (coordonnées potentiellement fiables)

#### Logique derrière ces règles :

- **Traditional** : Les coordonnées sont toujours bonnes, donc zone d'exclusion garantie
- **Mystery/Wherigo** : Les coordonnées ne sont bonnes que si elles ont été corrigées
- **Multi/Letterbox** : Les coordonnées peuvent être bonnes ou nécessiter correction

#### Utilisation pratique :

Ces cercles indiquent les **zones où il est IMPOSSIBLE** de placer une nouvelle géocache ou des coordonnées corrigées, car :
- Aucune géocache ne peut être à moins de 161m d'une autre
- Les coordonnées GPS ont une précision d'environ 161m dans les meilleures conditions

Cela vous aide à :
- **Valider des coordonnées corrigées** (elles ne doivent pas tomber dans ces cercles)
- **Comprendre pourquoi** certaines coordonnées semblent impossibles
- **Planifier l'emplacement** de nouvelles géocaches

### Clustering

Quand plusieurs géocaches sont proches :
- Un cercle avec un nombre apparaît
- La taille du cercle indique le nombre de géocaches
- Zoomez pour voir les géocaches individuellement
- Le clustering se désactive automatiquement au zoom 15+

## 🏗️ Architecture technique

### Services et composants

```
MapService (singleton)
  ↓ événements
MapWidget (Bottom Layer)
  ↓ contient
MapView (React + OpenLayers)
  ↓ utilise
MapLayerManager
  ↓ gère
- Couche de tuiles (fond de carte)
- Couche vectorielle (géocaches + clustering)
- Couche waypoints (future)
```

### Flux de données

```
ZoneGeocachesWidget.load()
  → MapService.loadGeocaches()
  → MapView écoute onDidLoadGeocaches
  → MapLayerManager.addGeocaches()
  → Affichage sur la carte

ZoneGeocachesWidget.handleRowClick()
  → MapService.selectGeocache()
  → MapView écoute onDidSelectGeocache
  → MapLayerManager.selectGeocache()
  → Centrage + surbrillance
```

## 🔧 Configuration

### Ajouter un fond de carte

Éditez `map-tile-providers.ts` :

```typescript
{
    id: 'mon-fond',
    name: 'Mon Fond de Carte',
    attribution: '© Mon Provider',
    createSource: () => new XYZ({
        url: 'https://mon-serveur/{z}/{x}/{y}.png'
    })
}
```

### Modifier le clustering

Éditez `map-clustering.ts` :

```typescript
export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
    distance: 50,              // Distance en pixels
    minDistance: 20,           // Distance minimale
    disableClusteringAtZoom: 15  // Désactiver à ce zoom
};
```

### Personnaliser les styles

Éditez `map-geocache-style-sprite.ts` :

```typescript
export function createGeocacheStyleFromSprite(feature, resolution) {
    // Modifier scale, opacity, anchor (centré sur [0.5, 0.5]), etc.
}
```

## 🚀 Fonctionnalités futures

Les éléments suivants sont préparés mais pas encore implémentés :

### Interactions bidirectionnelles (Phase 2)

- [ ] Clic sur un marker → sélection dans le tableau
- [ ] Menu contextuel sur les markers
- [ ] Info-bulle au survol des markers

### Modification des points (Phase 3)

- [ ] Ajout de waypoints par clic
- [ ] Déplacement de points par drag & drop
- [ ] Édition des coordonnées corrected
- [ ] Dessin de zones/trajets

### Main Layer (Phase 4)

- [ ] Ouverture de la carte dans le Main Layer
- [ ] Carte pleine page avec plus de contrôles
- [ ] Export de la vue (image, GPX)

### Waypoints (Phase 5)

- [ ] Affichage des waypoints de géocaches
- [ ] Couche dédiée avec styles différenciés
- [ ] Gestion CRUD des waypoints

## 📝 Notes techniques

### Systèmes de coordonnées

- **Backend/DB** : WGS84 (EPSG:4326) - latitude/longitude
- **OpenLayers** : Web Mercator (EPSG:3857) - x/y
- Conversion automatique via `map-utils.ts`

### Gestion mémoire

- La carte est détruite proprement au `dispose()`
- Les écouteurs d'événements sont nettoyés
- Le clustering libère automatiquement les features

### Performance

Avec >500 géocaches :
- Le clustering est **essentiel**
- Temps de chargement : ~200-500ms
- Rendu fluide grâce à WebGL (si disponible)

### Cycle de vie du widget

```
Constructor
  → init() (postConstruct)
  → render() → MapView
  → onActivateRequest() → updateSize()
  → onResize() → updateSize()
  → dispose() → cleanup
```

## 🐛 Dépannage

### La carte ne s'affiche pas

1. Vérifiez la console du navigateur
2. Vérifiez que OpenLayers est bien installé : `npm list ol`
3. Vérifiez que le MapWidget est enregistré dans `zones-frontend-module.ts`

### Les icônes ne s'affichent pas

1. Vérifiez que les icônes sont découpées dans `assets/geocache-icons/`
2. Vérifiez les noms de fichiers (doivent correspondre aux clés)
3. Un fallback (cercles colorés) est utilisé si les icônes manquent

### La carte ne se centre pas sur les géocaches

1. Vérifiez que les géocaches ont des coordonnées (latitude/longitude)
2. Vérifiez la console pour les erreurs de conversion
3. Essayez de recharger les données

### Les performances sont lentes

1. Vérifiez que le clustering est activé
2. Réduisez le nombre de géocaches affichées
3. Changez le fond de carte (OSM est plus rapide que Satellite)

## 📚 Références

- [Documentation OpenLayers](https://openlayers.org/en/latest/doc/)
- [Theia Widget Guide](https://theia-ide.org/docs/composing_applications/)
- [Geocaching Icon Guide](../GEOCACHE_ICONS.md)

---

## ⚙️ Préférences utiles

- `geoApp.map.defaultProvider` : sélectionne le fournisseur de tuiles appliqué à l'ouverture (synchronisé avec le sélecteur de la barre d'outils).
- `geoApp.map.defaultZoom` : définit le zoom initial injecté dans `MapView`.
- `geoApp.map.showNearbyGeocaches` et `geoApp.map.showExclusionZones` : définissent l'état des deux toggles (toute modification est automatiquement reflétée dans les préférences).
- `geoApp.map.clipboardWatcher` : réservé à l'activation future du watcher presse-papiers.

Tous ces réglages se configurent depuis **GeoApp ▸ Préférences** et sont persistés dans `.theia/settings.json`. Les préférences pertinentes sont également propagées au backend via `/api/preferences`.
