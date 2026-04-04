# ✅ Amélioration : Utilisation du format GC pour les coordonnées

## 🎯 Objectif

Privilégier l'utilisation du format Geocaching.com (raw) pour les coordonnées plutôt que les coordonnées décimales, en ajoutant le champ `original_coordinates_raw` pour conserver le format d'origine.

## 🔧 Modifications apportées

### 1. Modèle de données

**Nouveau champ** : `original_coordinates_raw`

```python
class Geocache(db.Model):
    # ... champs existants
    coordinates_raw = db.Column(db.String)  # Format GC actuel (ex: "N 48° 51.402 E 002° 21.048")
    original_coordinates_raw = db.Column(db.String)  # Format GC original (sauvegardé lors de la correction)
    latitude = db.Column(db.Float)  # Décimales calculées
    longitude = db.Column(db.Float)  # Décimales calculées
    is_corrected = db.Column(db.Boolean, default=False)
    original_latitude = db.Column(db.Float)  # Décimales originales
    original_longitude = db.Column(db.Float)  # Décimales originales
```

**Avantages** :
- ✅ Conservation du format exact de Geocaching.com
- ✅ Pas de perte de précision lors des conversions
- ✅ Affichage cohérent avec le site Geocaching.com
- ✅ Possibilité de restaurer le format original

### 2. Backend - Mise à jour de `set_corrected_coords_from_waypoint`

**Fichier** : `gc-backend/gc_backend/blueprints/geocaches.py`

#### Avant
```python
# Sauvegarder les coordonnées originales si ce n'est pas déjà fait
if not geocache.is_corrected:
    geocache.original_latitude = geocache.latitude
    geocache.original_longitude = geocache.longitude

# Mettre à jour avec les coordonnées du waypoint
geocache.latitude = waypoint.latitude
geocache.longitude = waypoint.longitude
geocache.is_corrected = True
```

#### Après
```python
# Validation
if not waypoint.gc_coords:
    return jsonify({'error': 'Waypoint has no gc_coords'}), 400

# Sauvegarder les coordonnées originales si ce n'est pas déjà fait
if not geocache.is_corrected:
    geocache.original_latitude = geocache.latitude
    geocache.original_longitude = geocache.longitude
    geocache.original_coordinates_raw = geocache.coordinates_raw  # ✅ Format GC
    logger.info(f"[SET CORRECTED COORDS] Sauvegarde des coordonnées originales: {geocache.original_coordinates_raw}")

# Mettre à jour avec les coordonnées du waypoint (format raw + décimales)
geocache.coordinates_raw = waypoint.gc_coords  # ✅ Format GC
geocache.latitude = waypoint.latitude
geocache.longitude = waypoint.longitude
geocache.is_corrected = True
```

**Changements** :
1. ✅ Validation de la présence de `gc_coords`
2. ✅ Sauvegarde de `original_coordinates_raw`
3. ✅ Mise à jour de `coordinates_raw` avec le format GC du waypoint
4. ✅ Logs améliorés avec le format GC

### 3. Frontend - Composant CoordinatesEditor

**Fichier** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

Vous avez créé un nouveau composant `CoordinatesEditor` qui :
- ✅ Affiche les coordonnées au format GC
- ✅ Permet d'éditer directement au format GC
- ✅ Affiche les coordonnées originales si différentes
- ✅ Permet de revenir aux coordonnées originales
- ✅ Gère le statut de résolution (solved)

**Interface** :
```typescript
interface CoordinatesEditorProps {
    geocacheData: GeocacheDto;
    geocacheId: number;
    backendBaseUrl: string;
    onUpdate: () => Promise<void>;
    messages: MessageService;
}
```

**Fonctionnalités** :
- Affichage des coordonnées corrigées et originales
- Édition inline avec validation
- Bouton "Revenir aux coordonnées originales"
- Sélecteur de statut de résolution

### 4. Type TypeScript mis à jour

```typescript
type GeocacheDto = {
    // ... autres champs
    coordinates_raw?: string;  // Format GC actuel
    original_coordinates_raw?: string;  // Format GC original
    latitude?: number;
    longitude?: number;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    solved?: 'not_solved' | 'in_progress' | 'solved';
};
```

## 📊 Flux de données

### Définir un waypoint comme coords corrigées

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Utilisateur clique 📍 sur un waypoint                   │
│    Waypoint: gc_coords = "N 48° 51.500 E 002° 21.100"     │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Backend vérifie waypoint.gc_coords existe               │
│    ✅ Validation OK                                         │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Si is_corrected = False (première correction)           │
│    Sauvegarde :                                             │
│    ├─ original_coordinates_raw = "N 48° 51.402 E 002°..."  │
│    ├─ original_latitude = 48.8567                          │
│    └─ original_longitude = 2.3508                          │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Mise à jour avec les coordonnées du waypoint            │
│    ├─ coordinates_raw = "N 48° 51.500 E 002° 21.100"      │
│    ├─ latitude = 48.8583                                   │
│    ├─ longitude = 2.3517                                   │
│    └─ is_corrected = True                                  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Frontend affiche via CoordinatesEditor                  │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ Coordonnées (corrigées)                             │ │
│    │ N 48° 51.500 E 002° 21.100                         │ │
│    │                                                     │ │
│    │ Coordonnées originales                             │ │
│    │ N 48° 51.402 E 002° 21.048                         │ │
│    └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 🎨 Affichage dans CoordinatesEditor

### Mode affichage (coordonnées corrigées)

```
┌─────────────────────────────────────────────────────────────┐
│ Coordonnées (corrigées)              [Modifier]             │
├─────────────────────────────────────────────────────────────┤
│ N 48° 51.500 E 002° 21.100                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Coordonnées originales                                      │
├─────────────────────────────────────────────────────────────┤
│ N 48° 51.402 E 002° 21.048                                 │
└─────────────────────────────────────────────────────────────┘
```

### Mode édition

```
┌─────────────────────────────────────────────────────────────┐
│ Modifier les coordonnées                                    │
├─────────────────────────────────────────────────────────────┤
│ [N 48° 51.500 E 002° 21.100________________________]       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Coordonnées originales (référence)                          │
├─────────────────────────────────────────────────────────────┤
│ N 48° 51.402 E 002° 21.048                                 │
└─────────────────────────────────────────────────────────────┘

[Enregistrer] [Annuler]    [Revenir aux coordonnées originales]
```

## 🧪 Tests

### Test 1 : Première correction depuis un waypoint
1. Géocache avec `is_corrected = False`
2. Coordonnées actuelles : "N 48° 51.402 E 002° 21.048"
3. Waypoint avec : "N 48° 51.500 E 002° 21.100"
4. Cliquer 📍 sur le waypoint
5. **Vérifier en DB** :
   - `original_coordinates_raw` = "N 48° 51.402 E 002° 21.048" ✅
   - `coordinates_raw` = "N 48° 51.500 E 002° 21.100" ✅
   - `is_corrected` = True ✅

### Test 2 : Deuxième correction (ne pas écraser les originales)
1. Géocache déjà corrigée (`is_corrected = True`)
2. `original_coordinates_raw` = "N 48° 51.402 E 002° 21.048"
3. Waypoint avec : "N 48° 51.600 E 002° 21.200"
4. Cliquer 📍 sur le waypoint
5. **Vérifier en DB** :
   - `original_coordinates_raw` = "N 48° 51.402 E 002° 21.048" (inchangé) ✅
   - `coordinates_raw` = "N 48° 51.600 E 002° 21.200" ✅

### Test 3 : Affichage dans CoordinatesEditor
1. Ouvrir une géocache corrigée
2. **Vérifier** :
   - Titre "Coordonnées (corrigées)" ✅
   - Coordonnées actuelles affichées ✅
   - Section "Coordonnées originales" visible ✅
   - Coordonnées originales affichées ✅

### Test 4 : Waypoint sans gc_coords
1. Créer un waypoint avec latitude/longitude mais sans gc_coords
2. Cliquer 📍 sur ce waypoint
3. **Vérifier** : Erreur "Waypoint has no gc_coords" ✅

### Test 5 : Édition manuelle des coordonnées
1. Cliquer "Modifier" dans CoordinatesEditor
2. Modifier les coordonnées
3. Cliquer "Enregistrer"
4. **Vérifier** :
   - `coordinates_raw` mis à jour ✅
   - `latitude` et `longitude` recalculés ✅
   - `is_corrected` = True ✅

### Test 6 : Restauration des coordonnées originales
1. Géocache corrigée
2. Cliquer "Modifier"
3. Cliquer "Revenir aux coordonnées originales"
4. **Vérifier** :
   - `coordinates_raw` = `original_coordinates_raw` ✅
   - `is_corrected` = False ✅

## 📝 Avantages du format GC (raw)

### 1. Précision
```
Format GC : N 48° 51.402 E 002° 21.048
Décimal   : 48.8567, 2.3508

Conversion GC → Décimal → GC :
N 48° 51.402 → 48.8567 → N 48° 51.402 ✅ Exact

Mais avec arrondis :
N 48° 51.402 → 48.857 → N 48° 51.420 ❌ Perte de précision
```

### 2. Cohérence avec Geocaching.com
- ✅ Format identique au site officiel
- ✅ Copier-coller direct possible
- ✅ Pas de confusion pour l'utilisateur

### 3. Historique complet
- ✅ Conservation du format original exact
- ✅ Possibilité de restaurer sans perte
- ✅ Traçabilité des modifications

### 4. Validation plus simple
```python
# Format GC : validation par regex
pattern = r'^[NS]\s*\d+°\s*[\d.]+\s+[EW]\s*\d+°\s*[\d.]+$'
if re.match(pattern, coords):
    # Format valide
```

## 🔄 Migration des données existantes

Si vous avez des géocaches déjà corrigées sans `original_coordinates_raw`, vous pouvez créer un script de migration :

```python
# Script de migration
from gc_backend.geocaches.models import Geocache
from gc_backend import db

def migrate_original_coordinates():
    geocaches = Geocache.query.filter(
        Geocache.is_corrected == True,
        Geocache.original_coordinates_raw == None
    ).all()
    
    for gc in geocaches:
        if gc.original_latitude and gc.original_longitude:
            # Reconstituer le format GC depuis les décimales
            lat = gc.original_latitude
            lon = gc.original_longitude
            
            lat_dir = 'N' if lat >= 0 else 'S'
            lat_deg = int(abs(lat))
            lat_min = (abs(lat) - lat_deg) * 60
            
            lon_dir = 'E' if lon >= 0 else 'W'
            lon_deg = int(abs(lon))
            lon_min = (abs(lon) - lon_deg) * 60
            
            gc.original_coordinates_raw = f"{lat_dir} {lat_deg}° {lat_min:.3f} {lon_dir} {lon_deg}° {lon_min:.3f}"
            print(f"Migrated {gc.gc_code}: {gc.original_coordinates_raw}")
    
    db.session.commit()
    print(f"Migrated {len(geocaches)} geocaches")
```

## 🚀 Améliorations futures possibles

### 1. Validation du format en temps réel
```typescript
const validateGCFormat = (coords: string): boolean => {
    const pattern = /^[NS]\s*\d+°\s*[\d.]+\s+[EW]\s*\d+°\s*[\d.]+$/;
    return pattern.test(coords);
};

// Dans le composant
{!validateGCFormat(editedCoords) && (
    <div style={{ color: 'red', fontSize: 12 }}>
        Format invalide. Exemple : N 48° 51.402 E 002° 21.048
    </div>
)}
```

### 2. Conversion automatique
```typescript
// Convertir décimales → format GC
const decimalToGC = (lat: number, lon: number): string => {
    const latDir = lat >= 0 ? 'N' : 'S';
    const latDeg = Math.floor(Math.abs(lat));
    const latMin = (Math.abs(lat) - latDeg) * 60;
    
    const lonDir = lon >= 0 ? 'E' : 'W';
    const lonDeg = Math.floor(Math.abs(lon));
    const lonMin = (Math.abs(lon) - lonDeg) * 60;
    
    return `${latDir} ${latDeg}° ${latMin.toFixed(3)} ${lonDir} ${lonDeg}° ${lonMin.toFixed(3)}`;
};
```

### 3. Historique des modifications
```python
class GeocacheCoordinateHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'))
    coordinates_raw = db.Column(db.String)
    source = db.Column(db.String)  # 'waypoint_123', 'manual_edit', 'original'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
```

## 🔗 Fichiers modifiés

**Backend** :
- `gc-backend/gc_backend/blueprints/geocaches.py`
  - Fonction `set_corrected_coords_from_waypoint()` : lignes 732-750
  - Ajout validation `gc_coords`
  - Sauvegarde `original_coordinates_raw`
  - Mise à jour `coordinates_raw`

**Frontend** :
- `theia-extensions/zones/src/browser/geocache-details-widget.tsx`
  - Nouveau composant `CoordinatesEditor` : lignes 540-800
  - Type `GeocacheDto` mis à jour : ligne 817
  - Utilisation du composant dans le render : ligne 1149

**Base de données** :
- Migration ajoutant `original_coordinates_raw` au modèle `Geocache`

---

**Date** : 1er novembre 2025  
**Statut** : ✅ Implémenté  
**Version** : 2.0  
**Impact** : Amélioration majeure de la gestion des coordonnées
