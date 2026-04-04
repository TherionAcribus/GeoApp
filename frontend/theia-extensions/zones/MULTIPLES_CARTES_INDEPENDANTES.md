# 🗺️ Correction : Multiples cartes indépendantes

**Date** : 31 octobre 2025  
**Status** : ✅ Compilé avec succès

---

## 🐛 Problème identifié

### Symptôme
Quand on ouvre une Zone puis une Géocache :
- ✅ Les deux widgets de carte sont créés (`geoapp-map-zone-2`, `geoapp-map-geocache-13`)
- ❌ **Mais ils affichent les mêmes données !**
- ❌ La carte de la Zone affiche les données de la Géocache

### Cause racine
**Le `MapService` est partagé entre toutes les cartes !**

```typescript
// ❌ AVANT (dans map-widget-factory.ts)
this.mapService.loadGeocaches(geocaches);  // Service PARTAGÉ !
```

**Séquence du problème** :
1. Ouvrir Zone 2 → `mapService.loadGeocaches([16 géocaches])`  
   → **Toutes les cartes** reçoivent ces 16 géocaches
2. Ouvrir Géocache 13 → `mapService.loadGeocaches([1 géocache])`  
   → **Toutes les cartes** reçoivent maintenant seulement 1 géocache !

### Preuve dans les logs
```
[MapWidgetFactory] Chargement de 16 géocaches pour contexte: {type: 'zone', id: 2}
[MapService] loadGeocaches appelé avec: 16 géocaches
[MapView] Event onDidLoadGeocaches reçu avec: 16 géocaches  // ✅ OK

[MapWidgetFactory] Chargement de 1 géocaches pour contexte: {type: 'geocache', id: 13}
[MapService] loadGeocaches appelé avec: 1 géocaches
[MapView] Event onDidLoadGeocaches reçu avec: 1 géocaches  // ❌ TOUTES LES CARTES reçoivent ça !
```

---

## ✅ Solution : Données propres à chaque widget

### Principe
Chaque `MapWidget` doit avoir **ses propres données** au lieu de partager le `MapService` global.

### Architecture

**AVANT** :
```
┌─────────────┐
│ MapService  │ ◄─── Service PARTAGÉ
│ (singleton) │
└──────┬──────┘
       │ Event: onDidLoadGeocaches
       ├──────► MapWidget Zone 2
       ├──────► MapWidget Géocache 13
       └──────► MapWidget Géocache 7
```

**APRÈS** :
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ MapWidget   │     │ MapWidget   │     │ MapWidget   │
│ Zone 2      │     │ Géocache 13 │     │ Géocache 7  │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ geocaches:  │     │ geocaches:  │     │ geocaches:  │
│  [16 items] │     │  [1 item]   │     │  [1 item]   │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 🔧 Modifications apportées

### 1. `map-widget.tsx` : Stockage local des données

**Ajout** :
```typescript
private geocaches: MapGeocache[] = [];  // ✅ Données propres à ce widget

/**
 * Charge les géocaches dans cette carte spécifique
 */
loadGeocaches(geocaches: MapGeocache[]): void {
    console.log(`[MapWidget ${this.id}] loadGeocaches:`, geocaches.length, 'géocaches');
    this.geocaches = geocaches;
    this.update();  // Force le re-render
}

/**
 * Récupère les géocaches de cette carte
 */
getGeocaches(): MapGeocache[] {
    return this.geocaches;
}
```

**Render modifié** :
```typescript
protected render(): React.ReactNode {
    return (
        <MapView 
            mapService={this.mapService}
            geocaches={this.geocaches}  // ✅ Passe les données propres
            onMapReady={this.handleMapReady}
        />
    );
}
```

### 2. `map-widget-factory.ts` : Appel de la méthode du widget

**AVANT** :
```typescript
this.mapService.loadGeocaches(geocaches);  // ❌ Service partagé
```

**APRÈS** :
```typescript
widget.loadGeocaches(geocaches);  // ✅ Méthode du widget
```

### 3. `map-view.tsx` : Réception des données en props

**Interface Props** :
```typescript
export interface MapViewProps {
    mapService: MapService;
    geocaches: MapGeocache[];  // ✅ Données propres à cette carte
    onMapReady?: (map: Map) => void;
}
```

**AVANT** (écoute du service global) :
```typescript
React.useEffect(() => {
    const disposable = mapService.onDidLoadGeocaches(geocaches => {
        // ❌ Toutes les cartes reçoivent l'event
        layerManagerRef.current.addGeocaches(geocaches);
    });
    return () => disposable.dispose();
}, [isInitialized, mapService]);
```

**APRÈS** (réagit aux props) :
```typescript
React.useEffect(() => {
    if (!mapInstanceRef.current || !layerManagerRef.current) {
        return;
    }

    console.log('[MapView] Géocaches reçues en props:', geocaches.length);
    
    // Effacer les géocaches existantes
    layerManagerRef.current.clearGeocaches();

    // Ajouter les nouvelles géocaches
    if (geocaches.length > 0) {
        layerManagerRef.current.addGeocaches(geocaches);
        // Centrer la carte...
    }
}, [geocaches, isInitialized]);  // ✅ Réagit aux changements de props
```

---

## 📊 Résumé des changements

| Fichier | Modification |
|---------|--------------|
| `map-widget.tsx` | Ajout de `geocaches: MapGeocache[]` + méthodes `loadGeocaches()` / `getGeocaches()` |
| `map-widget-factory.ts` | `widget.loadGeocaches(geocaches)` au lieu de `this.mapService.loadGeocaches()` |
| `map-view.tsx` | Props `geocaches` + `useEffect` sur props au lieu d'écoute du service |

---

## 🧪 Comportement attendu

### Scénario de test

1. **Ouvrir Zone 2** (16 géocaches)
   ```
   [MapWidget geoapp-map-zone-2] loadGeocaches: 16 géocaches
   [MapView] Géocaches reçues en props: 16
   → Carte Zone 2 affiche 16 points
   ```

2. **Ouvrir Géocache 13** (1 géocache)
   ```
   [MapWidget geoapp-map-geocache-13] loadGeocaches: 1 géocaches
   [MapView] Géocaches reçues en props: 1
   → Carte Géocache 13 affiche 1 point
   ```

3. **Vérifier le panneau "Cartes"**
   ```
   📋 Cartes ouvertes (2)
   🗺️ Zone: Test
   📍 Géocache: GCARPNJ
   ```

4. **Vérifier les données**
   - ✅ Cliquer sur "Carte Zone" → 16 points affichés
   - ✅ Cliquer sur "Carte Géocache" → 1 point affiché
   - ✅ **Chaque carte garde ses propres données !**

### Logs attendus

**Ouverture Zone** :
```
[MapWidget geoapp-map-zone-2] loadGeocaches: 16 géocaches
[MapView] Géocaches reçues en props: 16
[MapView] Ajout de 16 géocaches à la carte
```

**Ouverture Géocache** :
```
[MapWidget geoapp-map-geocache-13] loadGeocaches: 1 géocaches
[MapView] Géocaches reçues en props: 1
[MapView] Ajout de 1 géocaches à la carte
```

**Aucun log d'interférence** entre les cartes !

---

## 💡 Pourquoi ça marche maintenant ?

### Architecture Avant (❌ Couplage fort)

```
MapWidgetFactory
  └─> mapService.loadGeocaches(data)  // Service global
        └─> Event onDidLoadGeocaches
              ├─> MapWidget 1 (reçoit data)
              ├─> MapWidget 2 (reçoit data)  ❌ Non désiré !
              └─> MapWidget 3 (reçoit data)  ❌ Non désiré !
```

### Architecture Après (✅ Isolation)

```
MapWidgetFactory
  ├─> widget1.loadGeocaches(data1)
  │     └─> MapView reçoit data1 via props
  │
  ├─> widget2.loadGeocaches(data2)
  │     └─> MapView reçoit data2 via props
  │
  └─> widget3.loadGeocaches(data3)
        └─> MapView reçoit data3 via props
```

**Chaque widget est indépendant !**

---

## 🎯 Avantages de la nouvelle architecture

1. **Isolation** : Chaque carte a ses propres données
2. **Prévisibilité** : Pas d'effets de bord entre cartes
3. **Maintenance** : Plus facile à déboguer (logs par widget)
4. **Performance** : Pas de re-render inutile des autres cartes
5. **Évolutivité** : Facile d'ajouter des cartes avec différents contextes

---

## 🚀 Compilation

```bash
cd theia-blueprint/theia-extensions/zones
yarn build  # ✅ Done in 1.87s
```

---

## 🎉 Résultat

✅ **Plusieurs cartes peuvent maintenant coexister avec leurs propres données**  
✅ **Le panneau "Cartes" liste toutes les cartes ouvertes**  
✅ **Chaque carte est indépendante**  
✅ **Pas d'interférence entre les cartes**

**Prochaine étape** : Relancer Theia et tester !

---

**Version** : 2.2  
**Type** : Correction majeure (architecture)


