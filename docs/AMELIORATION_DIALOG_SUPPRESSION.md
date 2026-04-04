# ✅ Amélioration : Dialog de confirmation pour suppression de waypoint

## 🎯 Objectif

Remplacer l'`alert()` JavaScript natif par un `ConfirmDialog` Theia pour la suppression de waypoints, conformément aux standards de l'application.

## 🔧 Modifications apportées

### 1. Import du ConfirmDialog

**Fichier** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

```typescript
import { ApplicationShell, ConfirmDialog } from '@theia/core/lib/browser';
```

### 2. Ajout de la prop `onDeleteWaypoint`

**Interface `WaypointsEditorProps`** :
```typescript
interface WaypointsEditorProps {
    waypoints?: GeocacheWaypoint[];
    geocacheId?: number;
    geocacheData?: GeocacheDto;
    backendBaseUrl: string;
    onUpdate: () => Promise<void>;
    messages: MessageService;
    onDeleteWaypoint: (id: number, name: string) => Promise<void>;  // ✅ Nouvelle prop
}
```

### 3. Simplification de la fonction `deleteWaypoint` dans le composant

**Avant** :
```typescript
const deleteWaypoint = async (id?: number) => {
    if (!geocacheId || !id) { return; }
    if (!confirm('Supprimer ce waypoint ?')) { return; }  // ❌ Alert natif
    try {
        const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/waypoints/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        await onUpdate();
        messages.info('Waypoint supprimé');
    } catch (e) {
        console.error('Delete waypoint error', e);
        messages.error('Erreur lors de la suppression du waypoint');
    }
};
```

**Après** :
```typescript
const deleteWaypoint = async (waypoint: GeocacheWaypoint) => {
    if (!waypoint.id) { return; }
    await onDeleteWaypoint(waypoint.id, waypoint.name || 'ce waypoint');
};
```

### 4. Méthode `deleteWaypoint` dans la classe `GeocacheDetailsWidget`

```typescript
/**
 * Supprime un waypoint après confirmation
 */
protected deleteWaypoint = async (waypointId: number, waypointName: string): Promise<void> => {
    if (!this.geocacheId) { return; }
    
    // ✅ Dialog Theia au lieu de confirm()
    const dialog = new ConfirmDialog({
        title: 'Supprimer le waypoint',
        msg: `Voulez-vous vraiment supprimer le waypoint "${waypointName}" ?`,
        ok: 'Supprimer',
        cancel: 'Annuler'
    });
    
    const confirmed = await dialog.open();
    if (!confirmed) { return; }
    
    try {
        const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/waypoints/${waypointId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        
        await this.load();
        this.messages.info(`Waypoint "${waypointName}" supprimé`);
    } catch (e) {
        console.error('Delete waypoint error', e);
        this.messages.error('Erreur lors de la suppression du waypoint');
    }
};
```

### 5. Passage de la méthode au composant

```typescript
<WaypointsEditor
    waypoints={d.waypoints}
    geocacheId={this.geocacheId}
    geocacheData={d}
    backendBaseUrl={this.backendBaseUrl}
    onUpdate={() => this.load()}
    messages={this.messages}
    onDeleteWaypoint={this.deleteWaypoint}  // ✅ Nouvelle prop
/>
```

### 6. Mise à jour du bouton de suppression

**Avant** :
```typescript
<button
    className='theia-button secondary'
    onClick={() => deleteWaypoint(w.id)}
    disabled={editingId !== null}
    style={{ padding: '2px 8px', fontSize: 11 }}
    title='Supprimer'
>
    🗑️
</button>
```

**Après** :
```typescript
<button
    className='theia-button secondary'
    onClick={() => deleteWaypoint(w)}  // ✅ Passe l'objet complet
    disabled={editingId !== null}
    style={{ padding: '2px 8px', fontSize: 11 }}
    title='Supprimer'
>
    🗑️
</button>
```

## 🎨 Résultat visuel

### Avant
```
┌─────────────────────────────────────┐
│ Cette page demande :                │
│ Supprimer ce waypoint ?             │
│                                     │
│         [Annuler]  [OK]             │
└─────────────────────────────────────┘
```
❌ Dialog natif du navigateur (style inconsistant)

### Après
```
┌─────────────────────────────────────┐
│ Supprimer le waypoint               │
├─────────────────────────────────────┤
│ Voulez-vous vraiment supprimer le   │
│ waypoint "Parking" ?                │
│                                     │
│         [Annuler]  [Supprimer]      │
└─────────────────────────────────────┘
```
✅ Dialog Theia (style cohérent avec l'application)

## 📋 Avantages

### 1. Cohérence visuelle
- ✅ Style uniforme avec le reste de l'application
- ✅ Respect du thème Theia (clair/sombre)
- ✅ Boutons et typographie cohérents

### 2. Meilleure UX
- ✅ Affichage du nom du waypoint dans le message
- ✅ Bouton "Supprimer" au lieu de "OK" (plus explicite)
- ✅ Message de confirmation plus détaillé

### 3. Maintenabilité
- ✅ Utilisation des composants Theia standards
- ✅ Code plus testable (pas de `confirm()` global)
- ✅ Séparation des responsabilités (composant vs widget)

### 4. Accessibilité
- ✅ Meilleure gestion du focus clavier
- ✅ Support des lecteurs d'écran
- ✅ Navigation au clavier améliorée

## 🧪 Tests

### Test 1 : Suppression confirmée
1. Ouvrir une géocache avec waypoints
2. Cliquer sur 🗑️ pour un waypoint
3. **Vérifier** : Dialog Theia s'affiche avec le nom du waypoint
4. Cliquer sur "Supprimer"
5. **Vérifier** : Waypoint supprimé, message de confirmation affiché

### Test 2 : Suppression annulée
1. Ouvrir une géocache avec waypoints
2. Cliquer sur 🗑️ pour un waypoint
3. **Vérifier** : Dialog Theia s'affiche
4. Cliquer sur "Annuler" ou appuyer sur Échap
5. **Vérifier** : Waypoint toujours présent, aucune action effectuée

### Test 3 : Waypoint sans nom
1. Créer un waypoint sans nom
2. Cliquer sur 🗑️
3. **Vérifier** : Message "Voulez-vous vraiment supprimer le waypoint "ce waypoint" ?"

### Test 4 : Édition en cours
1. Ouvrir l'édition d'un waypoint
2. **Vérifier** : Bouton 🗑️ désactivé pour les autres waypoints
3. Annuler l'édition
4. **Vérifier** : Boutons 🗑️ réactivés

## 🔄 Flux de données

```
┌─────────────────────────────────────────────────────────────┐
│ WaypointsEditor (Composant React)                           │
│                                                              │
│  [Bouton 🗑️] onClick                                        │
│       ↓                                                      │
│  deleteWaypoint(waypoint)                                   │
│       ↓                                                      │
│  onDeleteWaypoint(waypoint.id, waypoint.name)              │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ GeocacheDetailsWidget (Classe Widget)                       │
│                                                              │
│  deleteWaypoint(waypointId, waypointName)                  │
│       ↓                                                      │
│  new ConfirmDialog({ ... })                                │
│       ↓                                                      │
│  await dialog.open()                                        │
│       ↓                                                      │
│  if (confirmed) {                                           │
│      fetch DELETE /api/geocaches/{id}/waypoints/{wpId}     │
│      await this.load()                                      │
│      messages.info(...)                                     │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## 📝 Bonnes pratiques appliquées

### 1. Séparation des responsabilités
- **Composant** : Gère l'UI et les interactions utilisateur
- **Widget** : Gère la logique métier et les appels API

### 2. Props explicites
- Passage d'une fonction callback au lieu de dupliquer la logique
- Typage fort avec TypeScript

### 3. Messages contextuels
- Affichage du nom du waypoint dans la confirmation
- Message de succès personnalisé

### 4. Gestion d'erreurs
- Try/catch pour les erreurs réseau
- Messages d'erreur clairs pour l'utilisateur

## 🚀 Prochaines améliorations possibles

### 1. Animation de suppression
```typescript
// Ajouter une animation fade-out avant suppression
waypoint.classList.add('deleting');
await new Promise(resolve => setTimeout(resolve, 300));
```

### 2. Undo/Redo
```typescript
// Permettre d'annuler une suppression
const undoAction = {
    label: 'Annuler',
    action: () => this.restoreWaypoint(waypoint)
};
this.messages.info('Waypoint supprimé', undoAction);
```

### 3. Suppression multiple
```typescript
// Permettre de sélectionner et supprimer plusieurs waypoints
const selectedWaypoints = waypoints.filter(w => w.selected);
await this.deleteMultipleWaypoints(selectedWaypoints);
```

## 📚 Références

- [Theia ConfirmDialog API](https://eclipse-theia.github.io/theia/docs/next/classes/browser.ConfirmDialog.html)
- [Theia Dialog Documentation](https://theia-ide.org/docs/dialogs/)
- [React Props Best Practices](https://react.dev/learn/passing-props-to-a-component)

---

**Date** : 1er novembre 2025  
**Statut** : ✅ Implémenté et testé  
**Version** : 1.0
