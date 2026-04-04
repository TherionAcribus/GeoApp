# ✅ Améliorations UX : Waypoints

## 🎯 Objectifs

1. **Pré-remplir les coordonnées** : Lors de la création d'un nouveau waypoint, pré-remplir le champ avec les coordonnées de la géocache
2. **Dupliquer un waypoint** : Ajouter un bouton pour copier rapidement un waypoint existant

## 🔧 Modifications apportées

### 1. Pré-remplissage des coordonnées de la géocache

**Fichier** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

#### Avant
```typescript
const startEdit = (waypoint?: GeocacheWaypoint) => {
    if (waypoint) {
        setEditingId(waypoint.id ?? null);
        setEditForm({ ...waypoint });
    } else {
        setEditingId('new');
        setEditForm({
            prefix: '',
            lookup: '',
            name: '',
            type: '',
            latitude: undefined,
            longitude: undefined,
            gc_coords: '',  // ❌ Vide
            note: ''
        });
    }
    setCalculatedCoords('');
};
```

#### Après
```typescript
const startEdit = (waypoint?: GeocacheWaypoint) => {
    if (waypoint) {
        setEditingId(waypoint.id ?? null);
        setEditForm({ ...waypoint });
    } else {
        setEditingId('new');
        // ✅ Pré-remplir avec les coordonnées de la géocache
        setEditForm({
            prefix: '',
            lookup: '',
            name: '',
            type: '',
            latitude: undefined,
            longitude: undefined,
            gc_coords: geocacheData?.coordinates_raw || '',  // ✅ Coordonnées pré-remplies
            note: ''
        });
    }
    setCalculatedCoords('');
};
```

**Avantages** :
- ✅ Gain de temps : pas besoin de chercher les coordonnées de la géocache
- ✅ Point de départ logique pour créer un waypoint
- ✅ Facilite la création de waypoints proches de la géocache

### 2. Fonction de duplication

#### Nouvelle fonction
```typescript
/**
 * Duplique un waypoint existant
 */
const duplicateWaypoint = (waypoint: GeocacheWaypoint) => {
    setEditingId('new');
    setEditForm({
        prefix: waypoint.prefix,
        lookup: waypoint.lookup,
        name: waypoint.name ? `${waypoint.name} copy` : 'copy',  // ✅ Ajoute "copy" au nom
        type: waypoint.type,
        latitude: undefined,  // Sera recalculé depuis gc_coords
        longitude: undefined, // Sera recalculé depuis gc_coords
        gc_coords: waypoint.gc_coords,
        note: waypoint.note
    });
    setCalculatedCoords('');
};
```

**Comportement** :
- ✅ Copie tous les champs du waypoint source
- ✅ Ajoute " copy" au nom pour différencier
- ✅ Ouvre le formulaire d'édition en mode "nouveau"
- ✅ L'utilisateur peut modifier avant de sauvegarder

### 3. Nouveau bouton dans l'interface

#### Avant
```
┌─────────────────────────────────────────────────────┐
│ Prefix │ Lookup │ Nom      │ Type │ Coords │ Actions│
├─────────────────────────────────────────────────────┤
│ PK     │ 01     │ Parking  │ PKG  │ N...   │ ✏️ 🗑️  │
└─────────────────────────────────────────────────────┘
```

#### Après
```
┌──────────────────────────────────────────────────────────┐
│ Prefix │ Lookup │ Nom      │ Type │ Coords │ Actions   │
├──────────────────────────────────────────────────────────┤
│ PK     │ 01     │ Parking  │ PKG  │ N...   │ ✏️ 📋 🗑️ │
└──────────────────────────────────────────────────────────┘
```

**Code** :
```typescript
<button
    className='theia-button secondary'
    onClick={() => duplicateWaypoint(w)}
    disabled={editingId !== null}
    style={{ padding: '2px 8px', fontSize: 11 }}
    title='Dupliquer'
>
    📋
</button>
```

**Position** : Entre le bouton "Éditer" (✏️) et "Supprimer" (🗑️)

## 🎨 Cas d'usage

### Cas 1 : Créer un waypoint proche de la géocache

**Scénario** : Créer un waypoint "Parking" à 50m de la géocache

**Avant** :
1. Cliquer "+ Ajouter un waypoint"
2. Chercher les coordonnées de la géocache
3. Les copier dans le champ
4. Modifier légèrement les coordonnées
5. Sauvegarder

**Après** :
1. Cliquer "+ Ajouter un waypoint"
2. ✅ Coordonnées déjà pré-remplies !
3. Modifier légèrement les coordonnées
4. Sauvegarder

**Gain** : 2 étapes en moins

### Cas 2 : Créer plusieurs waypoints similaires

**Scénario** : Créer 5 questions avec le même type et format

**Avant** :
1. Créer "Question 1"
2. Remplir tous les champs
3. Sauvegarder
4. Cliquer "+ Ajouter un waypoint"
5. Re-saisir tous les champs similaires
6. Modifier uniquement le nom et les coordonnées
7. Répéter pour chaque question

**Après** :
1. Créer "Question 1"
2. Remplir tous les champs
3. Sauvegarder
4. Cliquer 📋 sur "Question 1"
5. ✅ Tous les champs déjà remplis !
6. Modifier uniquement le nom (déjà "Question 1 copy") et les coordonnées
7. Répéter pour chaque question

**Gain** : ~50% de temps en moins

### Cas 3 : Corriger un waypoint en gardant l'ancien

**Scénario** : Les coordonnées d'un waypoint ont changé, mais on veut garder l'ancien

**Avant** :
1. Noter les anciennes coordonnées
2. Éditer le waypoint
3. Modifier les coordonnées
4. Sauvegarder
5. Créer un nouveau waypoint "Ancien emplacement"
6. Re-saisir tous les champs
7. Sauvegarder

**Après** :
1. Cliquer 📋 sur le waypoint
2. ✅ Tous les champs copiés avec " copy" ajouté au nom
3. Modifier le nom en "Ancien emplacement"
4. Sauvegarder
5. Éditer le waypoint original
6. Modifier les coordonnées
7. Sauvegarder

**Gain** : Workflow plus fluide

## 📊 Flux de données

### Création d'un nouveau waypoint

```
┌─────────────────────────────────────────────────────────────┐
│ Utilisateur clique "+ Ajouter un waypoint"                  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ startEdit() appelé sans paramètre                           │
│   ├─ setEditingId('new')                                    │
│   └─ setEditForm({                                          │
│       gc_coords: geocacheData?.coordinates_raw || ''        │
│       // ✅ Pré-rempli avec les coordonnées de la géocache  │
│     })                                                       │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Formulaire affiché avec coordonnées pré-remplies            │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Coordonnées (format GC)                             │   │
│   │ [N 48° 38.204 E 006° 07.945]  ← Pré-rempli         │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Duplication d'un waypoint

```
┌─────────────────────────────────────────────────────────────┐
│ Utilisateur clique 📋 sur un waypoint                       │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ duplicateWaypoint(waypoint) appelé                          │
│   ├─ setEditingId('new')                                    │
│   └─ setEditForm({                                          │
│       prefix: waypoint.prefix,                              │
│       lookup: waypoint.lookup,                              │
│       name: waypoint.name + " copy",  ← Nom modifié         │
│       type: waypoint.type,                                  │
│       gc_coords: waypoint.gc_coords,                        │
│       note: waypoint.note                                   │
│     })                                                       │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Formulaire affiché avec tous les champs copiés              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Nom: [Parking copy]  ← " copy" ajouté              │   │
│   │ Type: [PKG]          ← Copié                        │   │
│   │ Coordonnées: [N 48° 38.104 E 006° 07.445] ← Copié  │   │
│   │ Note: [Près de l'entrée] ← Copié                   │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🧪 Tests

### Test 1 : Pré-remplissage des coordonnées
1. Ouvrir une géocache (ex: GCA7RV7)
2. Noter les coordonnées affichées (ex: "N 48° 38.204 E 006° 07.945")
3. Cliquer "+ Ajouter un waypoint"
4. **Vérifier** : Le champ "Coordonnées (format GC)" contient les coordonnées de la géocache ✅

### Test 2 : Duplication simple
1. Créer un waypoint "Test" avec des coordonnées spécifiques
2. Sauvegarder
3. Cliquer 📋 sur "Test"
4. **Vérifier** : 
   - Nom = "Test copy" ✅
   - Coordonnées = celles du waypoint "Test" ✅
   - Tous les autres champs copiés ✅

### Test 3 : Duplication sans nom
1. Créer un waypoint sans nom
2. Sauvegarder
3. Cliquer 📋 sur ce waypoint
4. **Vérifier** : Nom = "copy" ✅

### Test 4 : Modification après duplication
1. Dupliquer un waypoint
2. Modifier le nom et les coordonnées
3. Sauvegarder
4. **Vérifier** :
   - Nouveau waypoint créé ✅
   - Waypoint original inchangé ✅
   - Les deux waypoints sont distincts ✅

### Test 5 : Bouton désactivé pendant édition
1. Cliquer "+ Ajouter un waypoint" ou éditer un waypoint
2. **Vérifier** : Tous les boutons 📋 sont désactivés ✅
3. Annuler l'édition
4. **Vérifier** : Boutons 📋 réactivés ✅

## 🎯 Détails d'implémentation

### Gestion du nom lors de la duplication

```typescript
name: waypoint.name ? `${waypoint.name} copy` : 'copy'
```

**Logique** :
- Si le waypoint a un nom → Ajouter " copy"
- Si le waypoint n'a pas de nom → Utiliser "copy"

**Exemples** :
- "Parking" → "Parking copy"
- "Question 1" → "Question 1 copy"
- "" (vide) → "copy"
- undefined → "copy"

### Pourquoi `latitude` et `longitude` sont `undefined` ?

```typescript
latitude: undefined,
longitude: undefined,
```

**Raison** : Le backend recalcule automatiquement les coordonnées décimales depuis `gc_coords`.

**Avantage** :
- ✅ Pas de risque d'incohérence entre `gc_coords` et `latitude/longitude`
- ✅ Une seule source de vérité : `gc_coords`
- ✅ Parsing côté backend = logique centralisée

## 🚀 Améliorations futures possibles

### 1. Compteur de copies
```typescript
// "Parking copy" → "Parking copy 2" → "Parking copy 3"
const copyCount = waypoints.filter(w => w.name?.startsWith(waypoint.name + ' copy')).length;
const newName = copyCount > 0 
    ? `${waypoint.name} copy ${copyCount + 1}`
    : `${waypoint.name} copy`;
```

### 2. Dialog de confirmation pour duplication
```typescript
const dialog = new InputDialog({
    title: 'Dupliquer le waypoint',
    initialValue: `${waypoint.name} copy`,
    validate: (value) => value.trim() ? '' : 'Le nom ne peut pas être vide'
});
const newName = await dialog.open();
if (newName) {
    // Dupliquer avec le nouveau nom
}
```

### 3. Duplication multiple
```typescript
// Sélectionner plusieurs waypoints et les dupliquer en une fois
const selectedWaypoints = waypoints.filter(w => w.selected);
for (const wp of selectedWaypoints) {
    await duplicateWaypoint(wp);
}
```

### 4. Raccourci clavier
```typescript
// Ctrl+D pour dupliquer le waypoint sélectionné
useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 'd' && selectedWaypoint) {
            e.preventDefault();
            duplicateWaypoint(selectedWaypoint);
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedWaypoint]);
```

## 📝 Bonnes pratiques appliquées

### 1. Pré-remplissage intelligent
- ✅ Valeurs par défaut logiques (coordonnées de la géocache)
- ✅ Facilite le workflow utilisateur
- ✅ Réduit les erreurs de saisie

### 2. Nommage explicite
- ✅ " copy" ajouté automatiquement
- ✅ Évite les confusions entre original et copie
- ✅ Facilite l'identification

### 3. Cohérence UI
- ✅ Icône 📋 universellement reconnue pour "copier"
- ✅ Position logique entre "éditer" et "supprimer"
- ✅ Même style que les autres boutons

### 4. État désactivé pendant édition
- ✅ Évite les actions multiples simultanées
- ✅ Interface claire et prévisible

## 🔗 Fichiers modifiés

- `theia-extensions/zones/src/browser/geocache-details-widget.tsx`
  - Fonction `startEdit()` : ligne 109-128
  - Fonction `duplicateWaypoint()` : ligne 130-146 (nouvelle)
  - Bouton de duplication : ligne 466-474 (nouveau)

---

**Date** : 1er novembre 2025  
**Statut** : ✅ Implémenté et testé  
**Version** : 1.0  
**Impact** : Amélioration UX significative
