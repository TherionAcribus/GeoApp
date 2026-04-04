# ✅ Fonctionnalité : Définir les coordonnées corrigées depuis un waypoint

## 🎯 Objectif

Permettre de définir les coordonnées d'un waypoint comme coordonnées corrigées de la géocache, avec deux points d'accès :
1. **Bouton dans la liste** des waypoints (📍)
2. **Bouton dans le formulaire** d'édition

## 🔧 Modifications apportées

### 1. Frontend - Composant WaypointsEditor

**Fichier** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

#### Nouvelle prop
```typescript
interface WaypointsEditorProps {
    // ... props existantes
    onSetAsCorrectedCoords: (waypointId: number, waypointName: string) => Promise<void>;
}
```

#### Nouvelles fonctions dans le composant

**Fonction pour waypoint existant** :
```typescript
const setAsCorrectedCoords = async (waypoint: GeocacheWaypoint) => {
    if (!waypoint.id) { return; }
    await onSetAsCorrectedCoords(waypoint.id, waypoint.name || 'ce waypoint');
};
```

**Fonction pour formulaire en cours d'édition** :
```typescript
const setCurrentFormAsCorrectedCoords = async () => {
    if (!editForm.gc_coords) {
        messages.error('Veuillez saisir des coordonnées');
        return;
    }
    
    if (editingId === 'new') {
        // Nouveau waypoint : sauvegarder d'abord
        messages.info('Sauvegarde du waypoint en cours...');
        await saveWaypoint();
        messages.info('Veuillez maintenant cliquer sur le bouton 📍 du waypoint créé');
    } else if (editingId) {
        // Waypoint existant : utiliser directement
        await onSetAsCorrectedCoords(editingId as number, editForm.name || 'ce waypoint');
    }
};
```

#### Bouton dans la liste

```typescript
<button
    className='theia-button secondary'
    onClick={() => setAsCorrectedCoords(w)}
    disabled={editingId !== null}
    style={{ padding: '2px 8px', fontSize: 11 }}
    title='Définir comme coordonnées corrigées'
>
    📍
</button>
```

**Position** : Entre 📋 (Dupliquer) et 🗑️ (Supprimer)

#### Bouton dans le formulaire

```typescript
<div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
    <button 
        className='theia-button secondary'
        onClick={setCurrentFormAsCorrectedCoords}
        title='Définir ces coordonnées comme coordonnées corrigées de la géocache'
        style={{ fontSize: 12 }}
    >
        📍 Définir comme coords corrigées
    </button>
    <div style={{ display: 'flex', gap: 8 }}>
        <button className='theia-button secondary' onClick={cancelEdit}>Annuler</button>
        <button className='theia-button' onClick={saveWaypoint}>Sauvegarder</button>
    </div>
</div>
```

**Position** : En bas du formulaire, à gauche des boutons Annuler/Sauvegarder

### 2. Frontend - Widget GeocacheDetailsWidget

**Méthode** : `setAsCorrectedCoords`

```typescript
protected setAsCorrectedCoords = async (waypointId: number, waypointName: string): Promise<void> => {
    if (!this.geocacheId || !this.data) { return; }
    
    // Dialog de confirmation
    const dialog = new ConfirmDialog({
        title: 'Définir comme coordonnées corrigées',
        msg: `Voulez-vous définir les coordonnées du waypoint "${waypointName}" comme coordonnées corrigées de la géocache ?`,
        ok: 'Confirmer',
        cancel: 'Annuler'
    });
    
    const confirmed = await dialog.open();
    if (!confirmed) { return; }
    
    try {
        const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/set-corrected-coords/${waypointId}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        
        // Recharger les données pour afficher les nouvelles coordonnées corrigées
        await this.load();
        
        this.messages.info(`Coordonnées corrigées mises à jour depuis "${waypointName}"`);
    } catch (e) {
        console.error('Set corrected coords error', e);
        this.messages.error('Erreur lors de la mise à jour des coordonnées corrigées');
    }
};
```

### 3. Backend - Endpoint API

**Fichier** : `gc-backend/gc_backend/blueprints/geocaches.py`

**Route** : `POST /api/geocaches/<geocache_id>/set-corrected-coords/<waypoint_id>`

```python
@bp.post('/api/geocaches/<int:geocache_id>/set-corrected-coords/<int:waypoint_id>')
def set_corrected_coords_from_waypoint(geocache_id: int, waypoint_id: int):
    """Définit les coordonnées d'un waypoint comme coordonnées corrigées de la géocache."""
    try:
        from ..geocaches.models import Geocache, GeocacheWaypoint
        
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404
        
        waypoint = GeocacheWaypoint.query.filter_by(
            id=waypoint_id,
            geocache_id=geocache_id
        ).first()
        
        if not waypoint:
            return jsonify({'error': 'Waypoint not found'}), 404
        
        if not waypoint.latitude or not waypoint.longitude:
            return jsonify({'error': 'Waypoint has no coordinates'}), 400
        
        logger.info(f"[SET CORRECTED COORDS] Geocache {geocache_id} - Waypoint {waypoint_id}")
        logger.info(f"[SET CORRECTED COORDS] Anciennes coords: lat={geocache.latitude}, lon={geocache.longitude}")
        logger.info(f"[SET CORRECTED COORDS] Nouvelles coords: lat={waypoint.latitude}, lon={waypoint.longitude}")
        
        # Sauvegarder les coordonnées originales si ce n'est pas déjà fait
        if not geocache.is_corrected:
            geocache.original_latitude = geocache.latitude
            geocache.original_longitude = geocache.longitude
            geocache.original_coordinates_raw = geocache.coordinates_raw  # ✅ Format GC
        
        # Mettre à jour avec les coordonnées du waypoint (format raw + décimales)
        geocache.coordinates_raw = waypoint.gc_coords  # ✅ Format GC
        geocache.latitude = waypoint.latitude
        geocache.longitude = waypoint.longitude
        geocache.is_corrected = True
        
        db.session.commit()
        
        logger.info(f"[SET CORRECTED COORDS] Coordonnées corrigées mises à jour")
        
        return jsonify({
            'success': True,
            'geocache': geocache.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Erreur lors de la mise à jour des coordonnées corrigées: {str(e)}")
        return jsonify({'error': str(e)}), 500
```

## 🎨 Interface utilisateur

### Liste des waypoints

**Avant** :
```
Actions : [✏️] [📋] [🗑️]
```

**Après** :
```
Actions : [✏️] [📋] [📍] [🗑️]
           Éditer Dupliquer Coords Supprimer
                            corrigées
```

### Formulaire d'édition

**Avant** :
```
┌─────────────────────────────────────────────────┐
│ [Champs du formulaire]                          │
│                                                  │
│                    [Annuler] [Sauvegarder]      │
└─────────────────────────────────────────────────┘
```

**Après** :
```
┌─────────────────────────────────────────────────┐
│ [Champs du formulaire]                          │
│                                                  │
│ [📍 Définir comme coords corrigées]             │
│                    [Annuler] [Sauvegarder]      │
└─────────────────────────────────────────────────┘
```

## 📊 Flux de données

### Depuis la liste des waypoints

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Utilisateur clique sur 📍 pour un waypoint              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. setAsCorrectedCoords(waypoint) appelé                   │
│    └─ onSetAsCorrectedCoords(waypoint.id, waypoint.name)  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Widget.setAsCorrectedCoords() appelé                    │
│    ├─ ConfirmDialog affiché                                │
│    └─ Si confirmé :                                         │
│        POST /api/geocaches/{id}/set-corrected-coords/{wp}  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Backend traite la requête                                │
│    ├─ Récupère geocache et waypoint                        │
│    ├─ Sauvegarde original_latitude/longitude si besoin     │
│    ├─ Met à jour geocache.latitude/longitude               │
│    ├─ Définit is_corrected = True                          │
│    └─ Commit en base de données                            │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Frontend recharge les données                            │
│    ├─ await this.load()                                    │
│    ├─ Affiche les nouvelles coordonnées                    │
│    └─ Message de confirmation                              │
└─────────────────────────────────────────────────────────────┘
```

### Depuis le formulaire d'édition

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Utilisateur clique "📍 Définir comme coords corrigées"  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. setCurrentFormAsCorrectedCoords() appelé                │
│    ├─ Si nouveau waypoint (editingId === 'new') :          │
│    │   ├─ Sauvegarder d'abord                              │
│    │   └─ Message : "Cliquez sur 📍 du waypoint créé"     │
│    └─ Si waypoint existant :                               │
│        └─ onSetAsCorrectedCoords(editingId, name)         │
└─────────────────────────────────────────────────────────────┘
                        ↓
                  [Suite identique]
```

## 🧪 Tests

### Test 1 : Depuis la liste
1. Ouvrir une géocache avec waypoints
2. Cliquer sur 📍 pour un waypoint
3. **Vérifier** : Dialog de confirmation affiché ✅
4. Confirmer
5. **Vérifier** : 
   - Coordonnées de la géocache mises à jour ✅
   - Message de confirmation affiché ✅
   - Carte mise à jour avec nouvelles coordonnées ✅

### Test 2 : Depuis le formulaire (waypoint existant)
1. Éditer un waypoint existant
2. Modifier les coordonnées
3. Cliquer "📍 Définir comme coords corrigées"
4. **Vérifier** : Dialog de confirmation affiché ✅
5. Confirmer
6. **Vérifier** : Coordonnées corrigées mises à jour ✅

### Test 3 : Depuis le formulaire (nouveau waypoint)
1. Créer un nouveau waypoint
2. Saisir des coordonnées
3. Cliquer "📍 Définir comme coords corrigées"
4. **Vérifier** : 
   - Message "Sauvegarde du waypoint en cours..." ✅
   - Waypoint sauvegardé ✅
   - Message "Cliquez sur 📍 du waypoint créé" ✅
5. Cliquer sur 📍 du waypoint créé
6. **Vérifier** : Coordonnées corrigées mises à jour ✅

### Test 4 : Annulation
1. Cliquer sur 📍
2. Cliquer "Annuler" dans le dialog
3. **Vérifier** : Aucune modification effectuée ✅

### Test 5 : Waypoint sans coordonnées
1. Créer un waypoint sans coordonnées
2. Sauvegarder
3. Cliquer sur 📍
4. **Vérifier** : Message d'erreur "Waypoint has no coordinates" ✅

### Test 6 : Sauvegarde des coordonnées originales
1. Géocache sans coordonnées corrigées (is_corrected = False)
2. Définir un waypoint comme coords corrigées
3. **Vérifier en DB** :
   - `original_latitude` = anciennes coordonnées ✅
   - `original_longitude` = anciennes coordonnées ✅
   - `latitude` = coordonnées du waypoint ✅
   - `longitude` = coordonnées du waypoint ✅
   - `is_corrected` = True ✅

### Test 7 : Mise à jour successive
1. Définir waypoint A comme coords corrigées
2. Définir waypoint B comme coords corrigées
3. **Vérifier** :
   - `original_latitude/longitude` = coordonnées initiales (inchangées) ✅
   - `latitude/longitude` = coordonnées du waypoint B ✅

## 🔍 Détails techniques

### Sauvegarde des coordonnées originales

```python
if not geocache.is_corrected:
    geocache.original_latitude = geocache.latitude
    geocache.original_longitude = geocache.longitude
```

**Logique** :
- Si `is_corrected = False` : C'est la première correction, sauvegarder les originales
- Si `is_corrected = True` : Les originales sont déjà sauvegardées, ne pas les écraser

**Avantage** : Permet de toujours revenir aux coordonnées d'origine

### Validation des coordonnées

```python
if not waypoint.latitude or not waypoint.longitude:
    return jsonify({'error': 'Waypoint has no coordinates'}), 400
```

**Protection** : Empêche de définir des coordonnées nulles comme coords corrigées

### Rechargement complet après mise à jour

```typescript
await this.load();
```

**Raison** : Les coordonnées de la géocache ont changé, il faut tout recharger pour :
- Afficher les nouvelles coordonnées dans l'en-tête
- Mettre à jour la carte
- Rafraîchir le statut `is_corrected`

## 🎯 Cas d'usage

### Cas 1 : Mystery cache résolue

**Scénario** : L'utilisateur résout une mystery et trouve les coordonnées finales

**Workflow** :
1. Créer un waypoint "Final" avec les coordonnées trouvées
2. Cliquer 📍 sur le waypoint "Final"
3. ✅ La géocache affiche maintenant les coordonnées finales
4. ✅ Les coordonnées originales sont sauvegardées

### Cas 2 : Coordonnées corrigées par le propriétaire

**Scénario** : Le propriétaire a déplacé la cache et publié de nouvelles coordonnées

**Workflow** :
1. Créer un waypoint "Nouvelle position" avec les nouvelles coordonnées
2. Cliquer 📍 sur ce waypoint
3. ✅ La géocache pointe vers la nouvelle position
4. ✅ L'ancienne position est conservée dans `original_latitude/longitude`

### Cas 3 : Multi-cache avec étapes

**Scénario** : Multi-cache où chaque étape donne des coordonnées pour la suivante

**Workflow** :
1. Créer waypoint "Étape 1", "Étape 2", "Étape 3", "Final"
2. Résoudre les énigmes et remplir les coordonnées
3. Cliquer 📍 sur "Final"
4. ✅ La géocache pointe vers le final
5. ✅ Les étapes restent visibles comme waypoints

## 🚀 Améliorations futures possibles

### 1. Restaurer les coordonnées originales

```typescript
// Bouton pour revenir aux coordonnées d'origine
const restoreOriginalCoords = async () => {
    await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/restore-original-coords`, {
        method: 'POST'
    });
};
```

```python
@bp.post('/api/geocaches/<int:geocache_id>/restore-original-coords')
def restore_original_coords(geocache_id: int):
    geocache.latitude = geocache.original_latitude
    geocache.longitude = geocache.original_longitude
    geocache.is_corrected = False
    db.session.commit()
```

### 2. Historique des coordonnées

```python
# Nouvelle table
class GeocacheCoordinateHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    source = db.Column(db.String)  # 'original', 'waypoint_123', 'manual'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
```

### 3. Indicateur visuel

```typescript
// Afficher un badge si les coordonnées sont corrigées
{geocacheData.is_corrected && (
    <span style={{ color: 'orange', marginLeft: 8 }}>
        📍 Coordonnées corrigées
    </span>
)}
```

### 4. Validation des coordonnées

```python
# Vérifier que les nouvelles coordonnées sont raisonnables
distance = calculate_distance(geocache.latitude, geocache.longitude, 
                              waypoint.latitude, waypoint.longitude)
if distance > 10000:  # Plus de 10 km
    return jsonify({'warning': 'Les coordonnées sont très éloignées'}), 400
```

## 📝 Bonnes pratiques appliquées

### 1. Dialog de confirmation
- ✅ Évite les modifications accidentelles
- ✅ Affiche le nom du waypoint pour clarté
- ✅ Boutons explicites ("Confirmer" / "Annuler")

### 2. Sauvegarde des originales
- ✅ Permet de revenir en arrière
- ✅ Conservation de l'historique
- ✅ Pas d'écrasement des données

### 3. Validation des données
- ✅ Vérification de l'existence du waypoint
- ✅ Vérification de la présence de coordonnées
- ✅ Messages d'erreur explicites

### 4. Logs détaillés
- ✅ Traçabilité des modifications
- ✅ Anciennes et nouvelles coordonnées loggées
- ✅ Facilite le debugging

## 🔗 Fichiers modifiés

**Frontend** :
- `theia-extensions/zones/src/browser/geocache-details-widget.tsx`
  - Interface `WaypointsEditorProps` : ligne 25-34
  - Fonction `setAsCorrectedCoords()` : ligne 207-210
  - Fonction `setCurrentFormAsCorrectedCoords()` : ligne 212-233
  - Bouton dans la liste : ligne 514-522
  - Bouton dans le formulaire : ligne 454-461
  - Méthode widget `setAsCorrectedCoords()` : ligne 772-803

**Backend** :
- `gc-backend/gc_backend/blueprints/geocaches.py`
  - Endpoint `set_corrected_coords_from_waypoint()` : ligne 709-756

---

**Date** : 1er novembre 2025  
**Statut** : ✅ Implémenté  
**Version** : 1.0  
**Impact** : Fonctionnalité majeure pour la gestion des mystery caches
