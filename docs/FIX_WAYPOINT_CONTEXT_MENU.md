# 🔧 Correction du Menu Contextuel des Waypoints

## 🐛 Problème Identifié

**Symptôme** : Le clic droit sur un waypoint affichait le menu contextuel normal (coordonnées) au lieu du menu contextuel spécifique au waypoint (supprimer, définir comme coords corrigées).

**Cause** : Les waypoints n'étaient pas marqués avec les propriétés `isWaypoint` et `waypointId` lors de leur création dans le `MapLayerManager`.

## ✅ Solution Appliquée

### Fichier Modifié : `map-layer-manager.ts`

**Méthode `addWaypoint`** - Ajout des propriétés manquantes :

```typescript
addWaypoint(id: number | string, name: string, lon: number, lat: number): Feature<Point> {
    const coordinate = lonLatToMapCoordinate(lon, lat);
    
    const feature = new Feature({
        geometry: new Point(coordinate)
    });

    feature.setId(`waypoint_${id}`);
    feature.setProperties({
        id: id,
        name: name,
        type: 'waypoint',
        selected: false,
        isWaypoint: true,  // ✅ AJOUTÉ : Marquer comme waypoint pour le menu contextuel
        waypointId: typeof id === 'number' ? id : undefined  // ✅ AJOUTÉ : ID numérique du waypoint
    });

    this.waypointVectorSource.addFeature(feature);
    return feature;
}
```

### Logique de Détection

**Dans `map-view.tsx`** :

```typescript
// Vérifier si on a cliqué sur une feature (géocache ou waypoint)
const feature = map.forEachFeatureAtPixel(pixel, (f) => f);

if (feature) {
    const props = feature.getProperties() as GeocacheFeatureProperties;
    
    // Si c'est un waypoint, afficher un menu contextuel spécifique
    if (props.isWaypoint && props.waypointId !== undefined) {
        // Menu contextuel du waypoint
    }
}
```

## 🎯 Comportement Attendu

### Waypoints Normaux (ID numérique)

**Propriétés** :
- `isWaypoint: true`
- `waypointId: <number>` (ex: 42)

**Menu contextuel** :
- 📌 Waypoint: [nom]
- 📍 Définir comme coordonnées corrigées
- 🗑️ Supprimer le waypoint

### Coordonnées Originales (ID string)

**Propriétés** :
- `isWaypoint: true`
- `waypointId: undefined` (car ID = "orig_123")

**Menu contextuel** :
- Menu normal des coordonnées (copier GC, copier décimal, ajouter waypoint)

**Raison** : Les coordonnées originales ne doivent pas être supprimables ou modifiables, elles sont gérées automatiquement par le système.

## 🔍 Vérification

### Test 1 : Clic droit sur un waypoint normal
1. Ouvrir une géocache avec waypoints
2. Clic droit sur un waypoint
3. ✅ **Attendu** : Menu contextuel du waypoint avec options de suppression et définition

### Test 2 : Clic droit sur les coordonnées originales
1. Ouvrir une géocache avec coordonnées corrigées
2. Clic droit sur le marqueur "Original"
3. ✅ **Attendu** : Menu contextuel normal des coordonnées

### Test 3 : Clic droit sur la carte vide
1. Ouvrir une géocache
2. Clic droit sur une zone vide de la carte
3. ✅ **Attendu** : Menu contextuel normal des coordonnées

## 📊 Propriétés des Features

### Interface `GeocacheFeatureProperties`

```typescript
export interface GeocacheFeatureProperties {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    selected?: boolean;
    isWaypoint?: boolean;  // ✅ Indique si c'est un waypoint
    waypointId?: number;   // ✅ ID du waypoint (si isWaypoint = true)
}
```

### Distinction des Types

| Type | `isWaypoint` | `waypointId` | Menu Contextuel |
|------|--------------|--------------|-----------------|
| Géocache | `false` ou `undefined` | `undefined` | Popup d'info (clic gauche) |
| Waypoint normal | `true` | `<number>` | Menu waypoint (clic droit) |
| Coordonnées originales | `true` | `undefined` | Menu coordonnées (clic droit) |
| Carte vide | N/A | N/A | Menu coordonnées (clic droit) |

## 🎨 Flux de Détection

```
Clic droit sur la carte
    ↓
Récupérer la feature au pixel cliqué
    ↓
Feature trouvée ?
    ↓ OUI
    ↓
props.isWaypoint === true ?
    ↓ OUI
    ↓
props.waypointId !== undefined ?
    ↓ OUI → Menu contextuel du waypoint
    ↓ NON → Menu contextuel des coordonnées
    ↓
    ↓ NON (Feature = géocache)
    ↓ → Pas de menu contextuel (popup au clic gauche)
    ↓
    ↓ NON (Pas de feature)
    ↓ → Menu contextuel des coordonnées
```

## ✅ Résultat

Après cette correction, le clic droit sur un waypoint affiche maintenant correctement le menu contextuel spécifique avec les options de suppression et de définition comme coordonnées corrigées.

---

**Date** : 2025-11-01  
**Status** : ✅ Corrigé et testé
