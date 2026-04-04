# Synchronisation Carte ↔ Waypoints

## Vue d'ensemble

Implémentation d'un système de synchronisation automatique entre l'édition des waypoints et l'affichage sur la carte. Lorsqu'un waypoint est ajouté, modifié ou supprimé, la carte associée à la géocache se met à jour automatiquement.

## Fonctionnement

### Architecture

```
┌─────────────────────────────────┐
│   GeocacheDetailsWidget         │
│                                 │
│  ┌───────────────────────────┐ │
│  │  WaypointsEditor          │ │
│  │  - Ajouter waypoint       │ │
│  │  - Modifier waypoint      │ │
│  │  - Supprimer waypoint     │ │
│  └───────────┬───────────────┘ │
│              │                  │
│              │ onUpdate()       │
│              ▼                  │
│  ┌───────────────────────────┐ │
│  │  load()                   │ │
│  │  - Recharge les données   │ │
│  │  - Appelle refresh...()   │ │
│  └───────────┬───────────────┘ │
└──────────────┼─────────────────┬───────────────────────────────┐
               │                 │                               │
               │ refreshAssociatedMap()        geoapp-plugin-add-waypoint
               ▼                 │                               │
┌─────────────────────────────────┐
│   MapWidget (carte géocache)    │
│                                 │
│  ┌───────────────────────────┐ │
│  │  loadGeocaches()          │ │
│  │  - Met à jour les layers  │ │
│  │  - Affiche les waypoints  │ │
│  └───────────────────────────┘ │
└─────────────────────────────────┘
```

### Nouvel événement « plugin → waypoint »

1. Le **Plugin Executor** détecte des coordonnées pertinentes.
2. L'utilisateur clique sur **➕ Ajouter comme waypoint** directement dans le résultat du plugin.
3. Le widget émet un `CustomEvent` :

   ```typescript
   window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
       detail: {
           gcCoords: 'N 48° 33.787, E 006° 38.803',
           pluginName: 'caesar',
           geocache: { gcCode: 'GC123AB', name: 'Demo cache' },
           waypointTitle: 'Caesar shift +1',
           waypointNote: 'HELLO WORLD N …',
           sourceResultText: 'HELLO WORLD N …',
           decimalLatitude: 48.563117,
           decimalLongitude: 6.646717,
           autoSave: false // vrai lorsque l'on clique sur "✅ Ajouter et valider"
       }
   }));
   ```

4. `GeocacheDetailsWidget` écoute cet événement et :
   - si `autoSave === true`, appelle directement l'API `POST /api/geocaches/{id}/waypoints`, recharge les données puis rafraîchit la carte ;
   - sinon, ouvre `addWaypointWithCoordinates()` avec coordonnées + titre + note préremplis.
5. Dans le cas manuel, l'utilisateur valide la création du waypoint puis la synchronisation carte ↔ widget se déroule comme décrit ci-dessous. Dans le cas auto-validé, la liste et la carte sont mises à jour immédiatement.
6. **Nouveau :** dès l'émission de l'événement, un second `CustomEvent('geoapp-map-highlight-coordinate')` est envoyé avec les coordonnées décimales. `MapService` le reçoit et demande à la carte d'afficher un marqueur temporaire centré sur la position détectée.

### Mise en évidence des coordonnées détectées

- **Conversion centralisée côté backend** : la route `POST /api/detect_coordinates` calcule désormais toujours `decimal_latitude` et `decimal_longitude` lorsqu'une coordonnée est trouvée (utilise `convert_ddm_to_decimal`). Le frontend n'a plus besoin de recalculer les valeurs.
- **Événement carte immédiat** : `plugin-executor-widget.tsx` émet `geoapp-map-highlight-coordinate` dès la détection d'un résultat, avant toute création de waypoint. Le payload inclut `gcCode`, `pluginName`, les coordonnées décimales et un drapeau `replaceExisting` (actuellement `false`).
- **Marker temporaire dédié** : `MapLayerManager` ajoute un layer `detected-coordinate` stylé différemment des waypoints. `MapView` zoome automatiquement sur le point à la réception de l'événement.
- **Logs de diagnostic** :
  - `[Plugin Executor]` / `[Coordinates Detection]` pour les conversions et dispatch d'événements,
  - `[MapService]` pour les événements reçus et la gestion du cache de la dernière coordonnée.
- **Nettoyage** : `MapService.clearHighlightedCoordinate()` supprime le marker (éventuellement déclenché par de futurs événements `geoapp-map-highlight-clear`).

### Flux de données

1. **Modification d'un waypoint** (ajout/édition/suppression)
   ```typescript
   WaypointsEditor.saveWaypoint() ou deleteWaypoint()
   ↓
   Appel API backend (POST/PUT/DELETE)
   ↓
   onUpdate() callback
   ↓
   GeocacheDetailsWidget.load()
   ```

2. **Rechargement des données**
   ```typescript
   load()
   ↓
   Fetch API: GET /api/geocaches/{id}
   ↓
   this.data = nouvelles données (avec waypoints à jour)
   ↓
   refreshAssociatedMap()
   ```

3. **Mise à jour de la carte**
   ```typescript
   refreshAssociatedMap()
   ↓
   Trouve la carte: geoapp-map-geocache-{id}
   ↓
   Fetch API: GET /api/geocaches/{id} (pour avoir les données fraîches)
   ↓
   Construit l'objet MapGeocache avec waypoints[]
   ↓
   mapWidget.loadGeocaches([mapGeocache])
   ↓
   La carte redessine les markers et waypoints
   ```

## Implémentation

### 1. Méthode `refreshAssociatedMap()`

**Fichier**: `geocache-details-widget.tsx`

```typescript
private async refreshAssociatedMap(): Promise<void> {
    if (!this.geocacheId || !this.data?.gc_code) {
        return;
    }

    const mapId = `geoapp-map-geocache-${this.geocacheId}`;
    const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
    
    if (existingMap && 'loadGeocaches' in existingMap) {
        // Recharger les données fraîches depuis l'API
        const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}`);
        const updatedData = await res.json();
        
        // Construire l'objet MapGeocache
        const mapGeocache = {
            id: updatedData.id,
            gc_code: updatedData.gc_code,
            name: updatedData.name,
            latitude: updatedData.latitude,
            longitude: updatedData.longitude,
            cache_type: updatedData.type,
            waypoints: updatedData.waypoints || []  // ← Waypoints mis à jour !
            // ... autres champs
        };
        
        // Mettre à jour la carte
        (existingMap as any).loadGeocaches([mapGeocache]);
    }
}
```

### 2. Appel dans `load()`

```typescript
protected async load(): Promise<void> {
    // ... chargement des données
    this.data = await res.json();
    
    // ✅ Rafraîchir la carte associée
    await this.refreshAssociatedMap();
    
    this.update();
}
```

### 3. Callback `onUpdate` dans WaypointsEditor

```typescript
<WaypointsEditor
    waypoints={d.waypoints}
    geocacheId={this.geocacheId}
    geocacheData={d}
    backendBaseUrl={this.backendBaseUrl}
    onUpdate={() => this.load()}  // ← Déclenche le rechargement
    messages={this.messages}
/>
```

## Comportement

### Scénarios couverts

#### ✅ Ajout d'un waypoint
1. L'utilisateur clique sur "Ajouter un waypoint"
2. Remplit le formulaire
3. Clique sur "Sauvegarder"
4. → Le waypoint est créé en base
5. → Les détails se rechargent
6. → La carte se met à jour et affiche le nouveau waypoint

#### ✅ Modification d'un waypoint
1. L'utilisateur clique sur ✏️ pour éditer
2. Modifie les coordonnées ou autres champs
3. Clique sur "Sauvegarder"
4. → Le waypoint est mis à jour en base
5. → Les détails se rechargent
6. → La carte se met à jour avec les nouvelles coordonnées

#### ✅ Suppression d'un waypoint
1. L'utilisateur clique sur 🗑️
2. Confirme la suppression
3. → Le waypoint est supprimé de la base
4. → Les détails se rechargent
5. → La carte se met à jour et retire le waypoint

#### ✅ Calculs géographiques
1. L'utilisateur calcule une projection ou un antipode
2. Applique les coordonnées calculées
3. Sauvegarde
4. → La carte affiche le waypoint à la position calculée

### Cas particuliers

#### Carte non ouverte
Si la carte de la géocache n'est pas ouverte, aucune erreur n'est levée. La méthode `refreshAssociatedMap()` vérifie l'existence de la carte avant de tenter la mise à jour.

```typescript
const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
if (existingMap && 'loadGeocaches' in existingMap) {
    // Mise à jour uniquement si la carte existe
}
```

#### Erreur de chargement
Si le rechargement des données échoue, l'erreur est loggée mais n'empêche pas l'affichage des détails :

```typescript
try {
    // ... rechargement
} catch (e) {
    console.error('[GeocacheDetailsWidget] Erreur lors du rafraîchissement de la carte:', e);
    // L'erreur ne bloque pas l'interface
}
```

## Avantages

### 🎯 Expérience utilisateur fluide
- **Synchronisation automatique** : Pas besoin de rafraîchir manuellement
- **Feedback visuel immédiat** : Les modifications sont visibles instantanément
- **Cohérence** : Les détails et la carte affichent toujours les mêmes données

### 🔄 Architecture propre
- **Séparation des responsabilités** : Chaque composant a son rôle
- **Callback pattern** : Communication claire entre composants
- **Pas de couplage fort** : Le composant WaypointsEditor ne connaît pas la carte

### 🛡️ Robustesse
- **Vérifications** : Existence de la carte avant mise à jour
- **Gestion d'erreurs** : Les erreurs n'affectent pas l'UI
- **Logs** : Traçabilité pour le debugging

## Logs de debugging

Pour suivre le flux de synchronisation :

```
[GeocacheDetailsWidget] Rafraîchissement de la carte géocache: 123
[MapWidget geoapp-map-geocache-123] loadGeocaches: 1 géocaches
[MapLayerManager] Mise à jour des markers pour 1 géocaches
[MapLayerManager] Affichage de 3 waypoints pour la géocache GC12345
```

## Tests recommandés

### Test 1 : Ajout de waypoint
- [ ] Ouvrir une géocache
- [ ] Ouvrir sa carte
- [ ] Ajouter un waypoint avec coordonnées
- [ ] Vérifier que le waypoint apparaît sur la carte

### Test 2 : Modification de coordonnées
- [ ] Éditer un waypoint existant
- [ ] Changer ses coordonnées
- [ ] Sauvegarder
- [ ] Vérifier que le marker se déplace sur la carte

### Test 3 : Suppression
- [ ] Supprimer un waypoint
- [ ] Vérifier qu'il disparaît de la carte

### Test 4 : Calcul de projection
- [ ] Créer un waypoint avec projection (ex: 100m au Nord)
- [ ] Vérifier que le waypoint est placé correctement sur la carte

### Test 5 : Sans carte ouverte
- [ ] Modifier un waypoint sans ouvrir la carte
- [ ] Vérifier qu'aucune erreur n'apparaît
- [ ] Ouvrir la carte ensuite
- [ ] Vérifier que les waypoints sont à jour

## Améliorations futures possibles

### 🎨 Feedback visuel
- [ ] Animation lors de l'ajout d'un waypoint sur la carte
- [ ] Highlight du waypoint modifié
- [ ] Notification toast "Carte mise à jour"

### ⚡ Performance
- [ ] Debounce des mises à jour multiples
- [ ] Mise à jour partielle (uniquement le waypoint modifié)
- [ ] Cache des données pour éviter les requêtes redondantes

### 🔄 Synchronisation bidirectionnelle
- [ ] Éditer un waypoint directement sur la carte (drag & drop)
- [ ] Créer un waypoint en cliquant sur la carte
- [ ] Synchroniser vers les détails

### 📡 WebSocket
- [ ] Synchronisation temps réel entre plusieurs utilisateurs
- [ ] Notifications de modifications par d'autres utilisateurs

---

**Implémenté le** : 1er novembre 2025  
**Fichiers modifiés** :
- `geocache-details-widget.tsx` : Ajout de `refreshAssociatedMap()`
- Compilation : ✅ Réussie
- Tests : En attente
