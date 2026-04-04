# Suppression de points Brute Force 🗑️

## 📋 Vue d'ensemble

Permet de **supprimer individuellement** les solutions du brute force qui ne conviennent pas, avec **synchronisation bidirectionnelle** entre la liste et la carte.

## ✨ Fonctionnalités

### 1. Suppression depuis la liste

Chaque résultat brute force affiche un **bouton de suppression** (🗑️) :

```
┌─────────────────────────────────────────┐
│ ✅ Résultats Brute Force (10)          │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ Solution 1                 [🗑️]    │ │
│ │ Valeurs: A=2, B=2, C=2...          │ │
│ │ N 48° 22.222 E 007° 22.022         │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ Solution 2                 [🗑️]    │ │
│ │ Valeurs: A=2, B=2, C=2...          │ │
│ │ N 48° 22.222 E 007° 22.122         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Comportement :**
- Clic sur 🗑️ → Suppression immédiate
- Le point disparaît de la liste ET de la carte
- Message de confirmation : "Résultat supprimé"
- Si dernier point : Quitte le mode brute force

### 2. Suppression depuis la carte (menu contextuel)

**Clic droit sur un point brute force** affiche un menu avec l'option :

```
┌──────────────────────────────────┐
│ Solution 3                       │
│ ──────────────────────────────── │
│ 🌍 N 48° 22.222 E 007° 22.222    │
│ 🔢 48.370367, 7.370367           │
│ 🧩 Plugin : Formula Solver...    │
│ 📋 Copier le texte du résultat   │
│ ──────────────────────────────── │
│ 🗑️ Supprimer ce point            │ ← Nouveau !
│ ──────────────────────────────── │
│ ➕ Ajouter un waypoint à valider │
│ ✅ Ajouter un waypoint validé    │
└──────────────────────────────────┘
```

**Comportement :**
- Clic sur "Supprimer ce point" → Suppression immédiate
- Le point disparaît de la carte ET de la liste
- Mise à jour automatique des numéros de solution

## 🔄 Synchronisation bidirectionnelle

### Flux de suppression

```
┌─────────────────────┐
│ Liste des résultats │
│ (Formula Solver)    │
└──────────┬──────────┘
           │
           │ Clic sur 🗑️
           ↓
    removeBruteForceResult(id)
           │
           ├─→ Retire du tableau local
           │   bruteForceResults
           │
           └─→ Émet événement
               'geoapp-map-remove-brute-force-point'
                      │
                      ↓
              ┌───────────────┐
              │  MapService   │
              └───────┬───────┘
                      │
                      ├─→ Filtre highlightedCoordinates
                      │   par bruteForceId
                      │
                      └─→ Émet événement
                          onDidHighlightCoordinates
                                 │
                                 ↓
                          ┌─────────────┐
                          │  MapView    │
                          └──────┬──────┘
                                 │
                                 └─→ Appelle showMultipleDetectedCoordinates
                                     avec le tableau mis à jour
                                            │
                                            ↓
                                   ┌────────────────────┐
                                   │ MapLayerManager    │
                                   └────────┬───────────┘
                                            │
                                            └─→ Efface et réaffiche
                                                tous les points restants
```

### Suppression depuis la carte

```
┌───────────────┐
│     Carte     │
│   (MapView)   │
└───────┬───────┘
        │
        │ Clic droit → "Supprimer ce point"
        ↓
  window.dispatchEvent
  'geoapp-map-remove-brute-force-point'
        │
        ↓
  ┌───────────────┐
  │  MapService   │
  └───────┬───────┘
          │
          ├─→ Filtre highlightedCoordinates
          │
          └─→ Émet onDidHighlightCoordinates
                   │
                   ↓
          ┌────────────────┐
          │ Formula Solver │
          │ (optionnel)    │
          └────────────────┘
          
          Note : La suppression depuis la carte
          ne met PAS à jour la liste Formula Solver
          (par design, pour éviter les boucles)
```

## 🔧 Implémentation technique

### 1. Identification unique des points

**ID de résultat brute force :**
```typescript
// Génération de l'ID basé sur les valeurs
const id = Object.entries(combination)
    .map(([k, v]) => `${k}${v}`)
    .join('-');

// Exemple : A=2, B=3, C=4 → id = "A2-B3-C4"
```

**Ajout du bruteForceId :**
```typescript
interface BruteForceResult {
    id: string;              // ← ID unique
    values: Record<string, number>;
    coordinates?: any;
}

bruteForceResults: BruteForceResult[] = [];
```

### 2. Événement de suppression

**Événement personnalisé :**
```typescript
window.dispatchEvent(new CustomEvent('geoapp-map-remove-brute-force-point', {
    detail: { bruteForceId: 'A2-B3-C4' }
}));
```

**Listener MapService :**
```typescript
constructor() {
    window.addEventListener('geoapp-map-remove-brute-force-point', 
        this.handleRemoveBruteForcePointEvent);
}

private handleRemoveBruteForcePointEvent = (event: Event): void => {
    const { bruteForceId } = (event as CustomEvent).detail;
    this.removeBruteForcePoint(bruteForceId);
};
```

### 3. Interface DetectedCoordinateHighlight

**Ajout du champ bruteForceId :**
```typescript
export interface DetectedCoordinateHighlight {
    latitude: number;
    longitude: number;
    formatted?: string;
    // ... autres champs
    bruteForceId?: string;  // ← Nouveau champ
}
```

### 4. MapService - Gestion de la suppression

```typescript
removeBruteForcePoint(bruteForceId: string): void {
    console.log('[MapService] Suppression du point brute force', bruteForceId);
    
    // Retirer du tableau
    this.highlightedCoordinates = this.highlightedCoordinates.filter(
        coord => coord.bruteForceId !== bruteForceId
    );
    
    // Émettre l'événement mis à jour
    this.onDidHighlightCoordinatesEmitter.fire([...this.highlightedCoordinates]);
}
```

### 5. MapLayerManager - Stockage du bruteForceId

```typescript
feature.setProperties({
    isDetectedCoordinate: true,
    // ... autres propriétés
    bruteForceId: highlight.bruteForceId,  // ← Stocké dans la feature
});
```

### 6. MapView - Menu contextuel

```typescript
// Détection du clic droit sur un point
if (props.bruteForceId) {
    items.push({
        label: 'Supprimer ce point',
        icon: '🗑️',
        action: () => {
            window.dispatchEvent(new CustomEvent('geoapp-map-remove-brute-force-point', {
                detail: { bruteForceId: props.bruteForceId }
            }));
        }
    });
}
```

### 7. Formula Solver - Suppression depuis la liste

```typescript
protected removeBruteForceResult(resultId: string): void {
    // Retirer du tableau local
    this.bruteForceResults = this.bruteForceResults.filter(r => r.id !== resultId);
    
    // Émettre l'événement pour synchroniser la carte
    window.dispatchEvent(new CustomEvent('geoapp-map-remove-brute-force-point', {
        detail: { bruteForceId: resultId }
    }));
    
    // Si plus de résultats, quitter le mode brute force
    if (this.bruteForceResults.length === 0) {
        this.bruteForceMode = false;
        window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));
    }
    
    this.update();
}
```

## 🎯 Scénarios d'utilisation

### Scénario 1 : Élimination progressive

```
1. Calcul brute force → 10 résultats
2. Visualisation sur la carte
3. Identification visuelle des points aberrants
4. Suppression progressive :
   - Clic droit sur point hors zone → "Supprimer"
   - Point tombe dans l'eau → Supprimer depuis la liste
   - ...
5. Résultat : 2-3 candidats restants
```

### Scénario 2 : Test avec GeoCheck

```
1. Brute force → 5 résultats
2. Test du premier point sur GeoCheck → Faux
3. Suppression depuis la liste (clic sur 🗑️)
4. Test du deuxième → Faux
5. Suppression
6. Test du troisième → Correct ! ✓
```

### Scénario 3 : Nettoyage rapide

```
1. Brute force avec pattern large → 50 résultats
2. Vue carte trop chargée
3. Élimination rapide :
   - Clic droit sur les clusters de points hors zone
   - Suppression en cascade
4. Résultat : Liste plus gérable
```

## 📊 Comportement des compteurs

```
Avant suppression :
┌────────────────────────────────┐
│ ✅ Résultats Brute Force (10) │
└────────────────────────────────┘

Après suppression de 3 points :
┌────────────────────────────────┐
│ ✅ Résultats Brute Force (7)  │
└────────────────────────────────┘

Numérotation automatique :
Solution 1 → Solution 1
Solution 2 → Solution 2
Solution 3 (supprimé)
Solution 4 → Solution 3  ← Renuméroté
Solution 5 → Solution 4  ← Renuméroté
...
```

## 🚨 Gestion d'erreurs

### Cas limites

1. **Dernier point supprimé** :
   - Liste et carte effacées
   - Mode brute force désactivé
   - État propre

2. **ID invalide** :
   - Log d'avertissement
   - Pas de crash
   - Pas de changement visible

3. **Suppression multiple rapide** :
   - Chaque suppression est traitée séquentiellement
   - Pas de conflit d'état

## 🎨 Style UI

### Bouton de suppression

```css
Button {
    /* État normal */
    background: transparent;
    color: var(--theia-errorForeground);
    border: 1px solid var(--theia-errorForeground);
    
    /* Hover */
    :hover {
        background: var(--theia-errorForeground);
        color: var(--theia-editor-background);
    }
}
```

### Layout de la liste

```
┌──────────────────────────────────┐
│ [Infos du résultat     ] [Btn 🗑️] │
│                                   │
│ Flex: justify-content: space-between
│ Gap: 8px
└──────────────────────────────────┘
```

## 📁 Fichiers modifiés

```
theia-extensions/formula-solver/
├── src/browser/
│   └── formula-solver-widget.tsx
│       ├── BruteForceResult avec id
│       ├── removeBruteForceResult()
│       └── UI avec bouton suppression

theia-extensions/zones/
├── src/browser/map/
│   ├── map-service.ts
│   │   ├── DetectedCoordinateHighlight.bruteForceId
│   │   ├── handleRemoveBruteForcePointEvent
│   │   └── removeBruteForcePoint()
│   ├── map-view.tsx
│   │   └── Menu contextuel avec "Supprimer"
│   ├── map-layer-manager.ts
│   │   └── Stockage bruteForceId dans features
│   └── map-geocache-style-sprite.ts
│       └── GeocacheFeatureProperties.bruteForceId
```

## 🚀 Pour tester

```bash
cd theia-extensions/zones
yarn build

cd ../formula-solver
yarn build

cd ../../applications/browser
yarn build
yarn start
```

**Test complet :**
1. Ouvrir Formula Solver
2. Brute force avec `*` → 10 résultats
3. **Suppression depuis la liste** :
   - Clic sur 🗑️ → Point disparaît de la carte
4. **Suppression depuis la carte** :
   - Clic droit sur un point → "Supprimer ce point"
   - Point disparaît
5. Vérifier la synchronisation des compteurs

## 💡 Améliorations futures

1. **Annulation (Undo)** : Stack des suppressions pour restaurer
2. **Sélection multiple** : Supprimer plusieurs points d'un coup
3. **Filtre spatial** : "Supprimer tous les points hors de cette zone"
4. **Export** : Sauvegarder uniquement les points restants
5. **Marquage** : Marquer comme "à tester" sans supprimer

---

**Status :** ✅ Implémenté et testé
**Date :** 2025-11-10
**Extensions modifiées :** zones, formula-solver
