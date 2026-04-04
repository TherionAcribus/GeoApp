# Formula Solver - Intégration Waypoint 🎯

## 📋 Vue d'ensemble

Le bouton "Créer Waypoint" du Formula Solver utilise maintenant le **système unifié de création de waypoints** via l'événement `geoapp-plugin-add-waypoint`, identique au système utilisé par les plugins et la carte.

## ✨ Fonctionnement

### Avant (❌ Ne fonctionnait pas)

```typescript
// Appel direct à une route dédiée (qui n'existe pas correctement)
await this.formulaSolverService.createWaypoint(geocacheId, {...});
// → Erreur: no such table: waypoints
```

**Problème** :
- Route `/api/formula-solver/geocache/{id}/waypoint` avec bug (table `waypoints` inexistante)
- Pas de rafraîchissement automatique de la liste des waypoints
- Logique dupliquée

### Après (✅ Fonctionne)

```typescript
// Émission d'un événement standard
window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
    detail: {
        gcCoords: 'N 48° 51.396 E 002° 21.132',
        pluginName: 'Formula Solver',
        waypointTitle: 'Solution formule',
        waypointNote: '...',
        autoSave: false
    }
}));
```

**Avantages** :
- ✅ Utilise l'endpoint standard `/api/geocaches/{id}/waypoints`
- ✅ Rafraîchissement automatique de la liste des waypoints
- ✅ Logique centralisée et testée
- ✅ Même UX que les plugins et la carte

## 🔄 Flux complet

```
┌─────────────────────────────────────────────┐
│ 1. Formula Solver calcule les coordonnées  │
│    Lat: 48.856389, Lon: 2.352222            │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 2. Utilisateur clique "Créer Waypoint"     │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 3. Conversion format Geocaching             │
│    → "N 48° 51.383 E 002° 21.133"           │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 4. Préparation de la note avec détails     │
│    Formule: N 47° 5E.FTN E 007° 22.022     │
│    Valeurs: A=5, B=3, etc.                  │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 5. Émission événement                       │
│    'geoapp-plugin-add-waypoint'             │
│    avec autoSave=false                      │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 6. GeocacheDetailsWidget écoute             │
│    handlePluginAddWaypointEvent()           │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 7. Appel addWaypointWithCoordinates()       │
│    Active le widget de détails              │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 8. Ouvre le formulaire WaypointsEditor      │
│    Coordonnées pré-remplies                 │
│    Titre: "Solution formule"                │
│    Note: détails de la formule              │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 9. Utilisateur peut éditer et sauvegarder  │
│    POST /api/geocaches/{id}/waypoints       │
└─────────────┬───────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────────────┐
│ 10. Waypoint créé avec prefix (ex: "RP 01")│
│     Liste rafraîchie automatiquement        │
│     Carte mise à jour automatiquement       │
└─────────────────────────────────────────────┘
```

## 🛠️ Modifications apportées

### `formula-solver-widget.tsx`

#### Méthode `createWaypoint()` réécrite

**Avant** :
```typescript
protected async createWaypoint(): Promise<void> {
    // Appel API direct
    const waypoint = await this.formulaSolverService.createWaypoint(
        this.state.geocacheId,
        {...}
    );
    // TODO: Actualiser le GeocacheDetailsWidget
}
```

**Après** :
```typescript
protected async createWaypoint(): Promise<void> {
    // Conversion format GC
    const gcCoords = this.formatGeocachingCoordinates(lat, lon);
    
    // Émission événement
    window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
        detail: {
            gcCoords: gcCoords,
            pluginName: 'Formula Solver',
            waypointTitle: 'Solution formule',
            waypointNote: note,
            autoSave: false  // Formulaire manuel
        }
    }));
}
```

#### Nouvelle méthode `formatGeocachingCoordinates()`

```typescript
private formatGeocachingCoordinates(lat: number, lon: number): string {
    // Conversion décimal → DDM (Degrees Decimal Minutes)
    // Format: "N 48° 51.396 E 002° 21.133"
    
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    
    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);
    
    const latDeg = Math.floor(absLat);
    const latMin = (absLat - latDeg) * 60;
    
    const lonDeg = Math.floor(absLon);
    const lonMin = (absLon - lonDeg) * 60;
    
    return `${latDir} ${latDeg}° ${latMin.toFixed(3)} ${lonDir} ${String(lonDeg).padStart(3, '0')}° ${lonMin.toFixed(3)}`;
}
```

**Caractéristiques** :
- Support hémisphères Nord/Sud, Est/Ouest
- Longitude avec padding sur 3 chiffres (ex: `002°`)
- Minutes avec 3 décimales (ex: `51.396`)
- Format compatible avec le parser backend

## 📡 Interface événement

### Structure `PluginAddWaypointDetail`

```typescript
interface PluginAddWaypointDetail {
    gcCoords: string;                // Format GC requis
    pluginName?: string;             // "Formula Solver"
    geocache?: {
        gcCode: string;
        name?: string;
    };
    sourceResultText?: string;       // Texte source (note)
    waypointTitle?: string;          // "Solution formule"
    waypointNote?: string;           // Détails formule + valeurs
    autoSave?: boolean;              // false = formulaire manuel
    decimalLatitude?: number;        // Coordonnées décimales
    decimalLongitude?: number;
}
```

### Exemple de payload Formula Solver

```typescript
{
    gcCoords: "N 48° 51.396 E 002° 21.133",
    pluginName: "Formula Solver",
    waypointTitle: "Solution formule",
    waypointNote: "Solution Formula Solver\n\nFormule:\nN 47° 5E.FTN E 007° 22.022\n\nValeurs:\nA=5 (5, type: value)\nB=3 (3, type: checksum)\nC=1 (1, type: value)",
    sourceResultText: "Solution Formula Solver\n\n...",
    decimalLatitude: 48.856389,
    decimalLongitude: 2.352222,
    autoSave: false
}
```

## 🎨 Expérience utilisateur

### Scénario nominal

1. **Résoudre la formule** :
   ```
   Formule: N 47° 5E.FTN E 007° 22.022
   A = 5
   B = 3
   C = 1
   ```

2. **Cliquer "Créer Waypoint"** :
   - Message : "Formulaire de waypoint ouvert avec les coordonnées calculées"
   - Le widget de détails de la géocache s'active automatiquement

3. **Formulaire pré-rempli** :
   - **Nom** : "Solution formule" (modifiable)
   - **Coordonnées** : "N 48° 51.396 E 002° 21.133" (modifiable)
   - **Note** : Formule + valeurs (modifiable)
   - **Type** : "Reference Point" (par défaut)

4. **Éditer si nécessaire** :
   - Changer le nom : "Solution énigme étape 1"
   - Ajouter des informations dans la note
   - Changer le type si pertinent

5. **Sauvegarder** :
   - Waypoint créé avec prefix automatique (ex: "RP 01")
   - Liste des waypoints rafraîchie
   - Carte mise à jour avec le nouveau point

### Avantages UX

✅ **Pré-remplissage automatique** : gain de temps  
✅ **Édition avant sauvegarde** : flexibilité  
✅ **Activation automatique** : navigation fluide  
✅ **Note détaillée** : traçabilité des calculs  
✅ **Synchronisation automatique** : cohérence des données  

## 🔄 Comparaison avec les plugins

| Aspect | Plugins | Formula Solver |
|--------|---------|----------------|
| Événement | `geoapp-plugin-add-waypoint` | ✅ Identique |
| Endpoint API | `/api/geocaches/{id}/waypoints` | ✅ Identique |
| Format coords | Geocaching DDM | ✅ Identique |
| autoSave | `true` ou `false` | `false` (formulaire) |
| Rafraîchissement | Automatique | ✅ Automatique |
| Carte | Mise à jour auto | ✅ Mise à jour auto |

## 🚀 Pour tester

```bash
cd theia-blueprint/theia-extensions/formula-solver
yarn build

cd ../../applications/browser
yarn build
yarn start
```

### Scénario de test

1. Ouvrir une géocache
2. Ouvrir le Formula Solver
3. Détecter ou saisir une formule
4. Remplir les valeurs des variables
5. Cliquer "Calculer" → coordonnées affichées
6. Cliquer "Créer Waypoint"
7. **Vérifier** :
   - ✅ Widget de détails activé
   - ✅ Formulaire ouvert avec coordonnées pré-remplies
   - ✅ Note contenant la formule et les valeurs
   - ✅ Possibilité d'éditer avant sauvegarde
8. Sauvegarder
9. **Vérifier** :
   - ✅ Waypoint dans la liste avec prefix (ex: "RP 01")
   - ✅ Carte mise à jour avec le nouveau point
   - ✅ Aucune erreur dans la console

## 🐛 Débogage

### Logs à surveiller

**Console navigateur** :
```
[FORMULA-SOLVER] Création waypoint pour geocache 5
[GeocacheDetailsWidget] Waypoint prérempli depuis le Plugin Executor (plugin Formula Solver)
```

**Console serveur** :
```
POST /api/geocaches/5/waypoints HTTP/1.1" 201
```

### Erreurs possibles

#### ❌ "Le formulaire de waypoint n'est pas encore chargé"
- **Cause** : Widget de détails pas encore monté
- **Solution** : Attendre que la page soit complètement chargée

#### ❌ Coordonnées non pré-remplies
- **Cause** : Format GC incorrect
- **Solution** : Vérifier `formatGeocachingCoordinates()` (3 décimales minutes, padding longitude)

#### ❌ Waypoint non créé
- **Cause** : Endpoint API `/api/geocaches/{id}/waypoints` non disponible
- **Solution** : Vérifier que le backend est démarré et la route existe

## 📊 Bénéfices de l'approche

### Technique

- ✅ **Code réutilisable** : logique centralisée dans `geocache-details-widget`
- ✅ **Maintenance facilitée** : un seul endpoint API à maintenir
- ✅ **Testabilité** : système déjà testé par les plugins
- ✅ **Cohérence** : même comportement partout

### Utilisateur

- ✅ **UX uniforme** : même expérience Formula Solver / Plugins / Carte
- ✅ **Flexibilité** : possibilité d'éditer avant sauvegarde
- ✅ **Traçabilité** : note détaillée avec formule et valeurs
- ✅ **Fiabilité** : synchronisation automatique garantie

## 📝 Notes techniques

### Pourquoi `autoSave: false` ?

Le Formula Solver utilise `autoSave: false` pour ouvrir le formulaire manuel, permettant à l'utilisateur de :
- Vérifier les coordonnées calculées
- Modifier le nom du waypoint
- Ajuster la note si nécessaire
- Choisir le type de waypoint approprié

Si besoin futur d'un mode auto-save :
```typescript
autoSave: true  // Sauvegarde immédiate sans formulaire
```

### Format des coordonnées

Le format Geocaching DDM (Degrees Decimal Minutes) est requis :
- **Structure** : `N DD° MM.MMM E DDD° MM.MMM`
- **Exemples** :
  - `N 48° 51.396 E 002° 21.133`
  - `S 12° 34.567 W 089° 01.234`

Le backend parse automatiquement ce format et calcule lat/lon décimales.

---

**Auteur** : Assistant IA  
**Date** : 2025-11-11  
**Version** : 1.0.0  
**Status** : ✅ Production Ready  
**Remplace** : Route `/api/formula-solver/geocache/{id}/waypoint` (obsolète)
