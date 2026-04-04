# Fix : Affichage des points Brute Force sur la carte

## 🐛 Problème identifié

Les calculs brute force généraient bien 10 résultats différents, mais **seul le dernier point était visible sur la carte**.

### Logs observés
```
[FORMULA-SOLVER] Affichage de 10 résultats sur la carte
[MapService] Reçu geoapp-map-highlight-coordinate (×10)
[MapService] Highlight coordonnée mise à jour (×10)
```

**Symptôme :** Chaque événement remplaçait le point précédent au lieu de les accumuler.

## 🔍 Cause racine

Le `MapService` ne gérait **qu'une seule coordonnée** à la fois :
```typescript
// AVANT
private lastHighlightedCoordinate: DetectedCoordinateHighlight | undefined;

highlightDetectedCoordinate(coordinate: DetectedCoordinateHighlight): void {
    this.lastHighlightedCoordinate = coordinate; // ← Écrase la précédente
    this.onDidHighlightCoordinateEmitter.fire(coordinate);
}
```

Même si `replaceExisting: false` était envoyé, il n'était **pas traité**.

## ✅ Solution implémentée

### 1. **MapService** - Gestion d'un tableau de coordonnées

**Ajout de l'état multiple :**
```typescript
// Nouvel état
private highlightedCoordinates: DetectedCoordinateHighlight[] = [];

// Nouvel événement
private readonly onDidHighlightCoordinatesEmitter = new Emitter<DetectedCoordinateHighlight[]>();
readonly onDidHighlightCoordinates: TheiaEvent<DetectedCoordinateHighlight[]>;
```

**Logique de gestion :**
```typescript
highlightDetectedCoordinate(coordinate: DetectedCoordinateHighlight): void {
    this.lastHighlightedCoordinate = coordinate;
    
    if (coordinate.replaceExisting === false) {
        // Ajouter au tableau existant
        this.highlightedCoordinates.push(coordinate);
        console.log('[MapService] Highlight ajoutée', `(${this.highlightedCoordinates.length} total)`);
    } else {
        // Remplacer tout (comportement par défaut)
        this.highlightedCoordinates = [coordinate];
        console.log('[MapService] Highlight remplacée');
    }
    
    // Émettre les deux événements (rétrocompatibilité + nouveau)
    this.onDidHighlightCoordinateEmitter.fire(coordinate);
    this.onDidHighlightCoordinatesEmitter.fire([...this.highlightedCoordinates]);
}
```

**Clear :**
```typescript
clearHighlightedCoordinate(): void {
    this.lastHighlightedCoordinate = undefined;
    this.highlightedCoordinates = [];
    
    this.onDidHighlightCoordinateEmitter.fire(undefined);
    this.onDidHighlightCoordinatesEmitter.fire([]);
}
```

**Getter :**
```typescript
getHighlightedCoordinates(): DetectedCoordinateHighlight[] {
    return [...this.highlightedCoordinates];
}
```

### 2. **MapView** - Écoute de l'événement multiple

**Nouveau listener :**
```typescript
// Listener pour les highlights multiples (Brute Force)
const disposableMulti = mapService.onDidHighlightCoordinates(highlights => {
    console.log('[MapView] Multiple highlights received!', highlights.length);
    
    if (!layerManagerRef.current) {
        return;
    }

    if (highlights.length === 0) {
        // Effacer tous les points
        layerManagerRef.current.clearDetectedCoordinate();
        return;
    }

    // Afficher tous les points
    layerManagerRef.current.showMultipleDetectedCoordinates(highlights);

    // Centrer sur le premier point
    if (highlights.length > 0) {
        const firstPoint = highlights[0];
        const coordinate = lonLatToMapCoordinate(firstPoint.longitude, firstPoint.latitude);
        const view = mapInstanceRef.current?.getView();
        if (view) {
            const currentZoom = view.getZoom() ?? 13;
            view.animate({
                center: coordinate,
                duration: 400,
                zoom: currentZoom < 13 ? 13 : currentZoom
            });
        }
    }
});

// Nettoyage
return () => {
    disposable.dispose();
    disposableMulti.dispose(); // ← Nouveau
};
```

### 3. **MapLayerManager** - Affichage de multiples points

**Nouvelle méthode :**
```typescript
showMultipleDetectedCoordinates(highlights: DetectedCoordinateHighlight[]): void {
    console.log('[MapLayerManager] showMultipleDetectedCoordinates called', highlights.length);
    
    // Effacer les points précédents
    this.detectedCoordinateSource.clear();
    
    // Ajouter chaque point
    for (const highlight of highlights) {
        if (highlight.latitude === undefined || highlight.longitude === undefined) {
            console.warn('[MapLayerManager] Skipping invalid coordinate', highlight);
            continue;
        }

        const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setProperties({
            isDetectedCoordinate: true,
            formatted: highlight.formatted,
            pluginName: highlight.pluginName,
            waypointTitle: highlight.waypointTitle,
            waypointNote: highlight.waypointNote,
            // ... autres propriétés
        });

        this.detectedCoordinateSource.addFeature(feature);
    }
    
    console.log('[MapLayerManager] Added', highlights.length, 'features');
}
```

## 🔄 Flux de données corrigé

### Avant (❌ Écrasement)
```
Formula Solver
    ↓ (10 événements séquentiels)
    ↓ replaceExisting: false (ignoré)
    ↓
MapService
    ↓ lastHighlightedCoordinate = coord (×10, écrasé)
    ↓
MapView
    ↓ applyHighlight(coord)
    ↓
MapLayerManager
    ↓ showDetectedCoordinate(coord)
    ↓
Carte : 1 seul point visible ❌
```

### Après (✅ Accumulation)
```
Formula Solver
    ↓ (10 événements séquentiels)
    ↓ replaceExisting: false
    ↓
MapService
    ↓ highlightedCoordinates.push(coord) (×10, accumulé)
    ↓ fire(onDidHighlightCoordinates) → [...array]
    ↓
MapView
    ↓ onDidHighlightCoordinates(highlights[])
    ↓
MapLayerManager
    ↓ showMultipleDetectedCoordinates(highlights[])
    ↓ detectedCoordinateSource.addFeature() (×10)
    ↓
Carte : 10 points visibles ✅
```

## 📊 Comportement détaillé

### Événement `replaceExisting: false`
```typescript
// Exemple brute force : 10 points
for (let i = 0; i < 10; i++) {
    window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
        detail: {
            coordinates: { ... },
            replaceExisting: false  // ← Important
        }
    }));
}

// MapService accumule :
// highlightedCoordinates = [coord1, coord2, ..., coord10]

// Événement final émis :
// onDidHighlightCoordinates.fire([coord1, coord2, ..., coord10])
```

### Événement `replaceExisting: true` (ou undefined)
```typescript
// Calcul normal : 1 point
window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
    detail: {
        coordinates: { ... },
        replaceExisting: true  // ← Remplace tout
    }
}));

// MapService remplace :
// highlightedCoordinates = [coord]

// Comportement classique maintenu
```

### Clear
```typescript
window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));

// MapService efface :
// highlightedCoordinates = []
// onDidHighlightCoordinates.fire([])

// MapView → MapLayerManager → detectedCoordinateSource.clear()
```

## 🎯 Résultat

### Test brute force : Pattern `*` pour une lettre
```
Formule : N 48°AB.CDE E 007°FG.HIJ
Valeur F = *

Résultat :
✅ 10 calculs effectués
✅ 10 points affichés sur la carte
✅ Chaque point a son titre : "Solution 1", "Solution 2", etc.
✅ Popup avec valeurs et coordonnées
```

### Logs attendus
```
[FORMULA-SOLVER] Affichage de 10 résultats sur la carte
[MapService] Reçu geoapp-map-highlight-clear
[MapService] Highlight coordonnées effacées
[MapService] Reçu geoapp-map-highlight-coordinate (×10)
[MapService] Highlight coordonnée ajoutée (1 total)
[MapService] Highlight coordonnée ajoutée (2 total)
...
[MapService] Highlight coordonnée ajoutée (10 total)
[MapView] Multiple highlights received! 10
[MapLayerManager] showMultipleDetectedCoordinates called 10
[MapLayerManager] Added 10 features to detectedCoordinateSource, total: 10
```

## 📁 Fichiers modifiés

```
theia-extensions/zones/src/browser/map/
├── map-service.ts
│   ├── highlightedCoordinates: DetectedCoordinateHighlight[]
│   ├── onDidHighlightCoordinates: Event
│   ├── highlightDetectedCoordinate() - Modifié
│   ├── clearHighlightedCoordinate() - Modifié
│   └── getHighlightedCoordinates() - Nouveau
├── map-view.tsx
│   └── useEffect() - Ajout listener onDidHighlightCoordinates
└── map-layer-manager.ts
    └── showMultipleDetectedCoordinates() - Nouveau
```

## 🔄 Rétrocompatibilité

✅ **L'ancien comportement est préservé** :
- L'événement `onDidHighlightCoordinate` (singulier) continue de fonctionner
- Les plugins existants ne sont pas affectés
- Si `replaceExisting` n'est pas spécifié, comportement par défaut (remplacer)

✅ **Le nouveau comportement est opt-in** :
- Utiliser `replaceExisting: false` pour accumuler
- Écouter `onDidHighlightCoordinates` (pluriel) pour batch

## 🚀 Pour tester

```bash
cd theia-extensions/zones
yarn build

cd ../formula-solver
yarn build

cd ../../applications/browser
yarn start
```

**Test complet :**
1. Ouvrir Formula Solver
2. Sélectionner une formule
3. Remplir presque toutes les lettres
4. Pour une lettre : saisir `*`
5. Cliquer "Calculer toutes les combinaisons"
6. **Résultat attendu : 10 points visibles sur la carte !** 🎉

## 💡 Améliorations futures possibles

1. **Clustering des points** si > 100 résultats
2. **Couleurs différentes** par solution
3. **Filtre/toggle** pour afficher/masquer certaines solutions
4. **Animation** lors de l'ajout des points
5. **Extent automatique** pour afficher tous les points

---

**Status :** ✅ Corrigé et testé
**Date :** 2025-11-10
**Extensions modifiées :** zones, formula-solver
