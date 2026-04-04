# 🖱️ Menu Contextuel - Implémentation Complète

## 🎉 Vue d'ensemble

Ajout de **menus contextuels** (clic droit) pour les zones et géocaches dans l'arbre de navigation !

## ✨ Fonctionnalités

### 📁 Menu Contextuel des Zones

**Clic droit sur une zone** affiche les options suivantes :

| Option | Icône | Action |
|--------|-------|--------|
| **Ouvrir** | 📂 | Ouvre le tableau complet de la zone |
| **Supprimer** | 🗑️ | Supprime la zone (avec confirmation) |

### 📍 Menu Contextuel des Géocaches

**Clic droit sur une géocache** affiche les options suivantes :

| Option | Icône | Action | Note |
|--------|-------|--------|------|
| **Ouvrir** | 📖 | Ouvre les détails de la géocache | |
| **Déplacer vers...** | 📦 | Déplace vers une autre zone | Désactivé si une seule zone |
| **Supprimer** | 🗑️ | Supprime la géocache | Avec confirmation |

### 🎯 Dialog de Déplacement

Lors du choix "Déplacer vers...", un dialog élégant s'affiche :

- **Liste des zones disponibles** (exclut la zone actuelle)
- **Sélection visuelle** avec survol et highlight
- **Boutons d'action** : Annuler / Déplacer
- **Validation** : Le bouton "Déplacer" est désactivé tant qu'aucune zone n'est sélectionnée

## 📁 Nouveaux Fichiers

### 1. **`context-menu.tsx`** (110 lignes)
Composant React réutilisable pour afficher un menu contextuel

**Features** :
- Position dynamique basée sur les coordonnées du clic
- Fermeture automatique au clic extérieur
- Fermeture avec la touche `Escape`
- Support des séparateurs
- Support des items désactivés
- Support des items "danger" (rouge)
- Effets hover avec les couleurs Theia
- Z-index élevé pour superposition

### 2. **`move-geocache-dialog.tsx`** (108 lignes)
Dialog React pour sélectionner la zone de destination

**Features** :
- Overlay semi-transparent avec blur
- Dialog centré avec bordure et shadow
- Liste interactive des zones disponibles
- Sélection unique avec feedback visuel
- Filtrage automatique de la zone actuelle
- Message informatif si aucune zone disponible
- Boutons Cancel / Move avec validation

### 3. **Backend: Endpoint `/api/geocaches/<id>/move`** (PATCH)
Nouvel endpoint Flask pour déplacer une géocache

**Paramètres** :
```json
{
  "target_zone_id": 123
}
```

**Réponse** :
```json
{
  "message": "Geocache GC12345 moved successfully",
  "id": 456,
  "gc_code": "GC12345",
  "old_zone_id": 1,
  "new_zone_id": 123
}
```

**Validations** :
- ✅ La géocache doit exister
- ✅ La zone cible doit exister
- ✅ Transaction SQL avec rollback en cas d'erreur

## 🔄 Fichiers Modifiés

### **`zones-tree-widget.tsx`**

**Nouveaux états** :
```typescript
protected contextMenu: { items: ContextMenuItem[]; x: number; y: number } | null = null;
protected moveDialog: { geocache: GeocacheDto; zoneId: number } | null = null;
```

**Nouvelles méthodes** :
- `showZoneContextMenu(zone, event)` - Affiche le menu pour une zone
- `showGeocacheContextMenu(geocache, zoneId, event)` - Affiche le menu pour une géocache
- `closeContextMenu()` - Ferme le menu contextuel
- `moveGeocache(geocache, targetZoneId)` - Déplace une géocache via API
- `closeMoveDialog()` - Ferme le dialog de déplacement

**Modifications du render** :
- Ajout de `onContextMenu` sur les nœuds de zones
- Ajout de `onContextMenu` sur les nœuds de géocaches
- Affichage conditionnel du `<ContextMenu>` component
- Affichage conditionnel du `<MoveGeocacheDialog>` component

### **`geocaches.py`** (Backend)

Ajout de l'endpoint `@bp.patch('/api/geocaches/<int:geocache_id>/move')`

## 🎨 Design & UX

### Style du Menu Contextuel

- **Position** : Fixed, suit le curseur de la souris
- **Background** : Variable Theia `--theia-menu-background`
- **Border** : Variable Theia `--theia-menu-border`
- **Shadow** : Box-shadow élégant pour la profondeur
- **Min-width** : 180px pour lisibilité
- **Border-radius** : 4px pour modernité

### Style des Items

- **Hover** : Background `--theia-menu-selectionBackground`
- **Danger** : Couleur rouge `--theia-errorForeground`
- **Disabled** : Opacité 0.5 + cursor not-allowed
- **Icons** : Emojis pour identification rapide
- **Séparateurs** : Ligne subtile de 1px

### Style du Dialog

- **Overlay** : Background rgba(0,0,0,0.5) en plein écran
- **Dialog** : Centré, min-width 400px, max-width 500px
- **Zones list** : Items cliquables avec hover et sélection
- **Animations** : Transitions douces (0.2s) sur tous les états

## 🚀 Utilisation

### Pour l'utilisateur

1. **Clic droit sur une zone** → Menu contextuel
2. **Clic droit sur une géocache** → Menu contextuel avec plus d'options
3. **Choisir "Déplacer vers..."** → Dialog de sélection
4. **Sélectionner une zone** → Cliquer "Déplacer"
5. **Confirmation** → Message toast + rafraîchissement de l'arbre

### Pour le développeur

```typescript
// Afficher un menu contextuel personnalisé
protected showCustomMenu(event: React.MouseEvent): void {
    const items: ContextMenuItem[] = [
        {
            label: 'Action 1',
            icon: '🎯',
            action: () => console.log('Action 1')
        },
        { separator: true },
        {
            label: 'Action dangereuse',
            icon: '⚠️',
            danger: true,
            action: () => console.log('Danger!')
        }
    ];
    
    this.contextMenu = {
        items,
        x: event.clientX,
        y: event.clientY
    };
    this.update();
}
```

## 🔧 Gestion du Cache

Après un déplacement de géocache :
- ✅ Cache des géocaches invalidé (`this.zoneGeocaches.clear()`)
- ✅ Compteurs des zones mis à jour (`await this.refresh()`)
- ✅ Arbre rafraîchi automatiquement
- ✅ Message de confirmation affiché

## 🎯 Avantages

✅ **Productivité** : Actions rapides sans navigation  
✅ **Intuitivité** : Pattern familier (clic droit)  
✅ **Feedback** : Confirmations et messages clairs  
✅ **Flexibilité** : Déplacement entre zones facilité  
✅ **Sécurité** : Confirmations pour actions destructives  
✅ **Cohérence** : Style natif Theia  
✅ **Performance** : Invalidation intelligente du cache  

## 📊 Flux de Déplacement

```
1. Clic droit sur géocache
   ↓
2. Sélectionner "Déplacer vers..."
   ↓
3. Dialog s'affiche avec zones disponibles
   ↓
4. Sélectionner zone de destination
   ↓
5. Cliquer "Déplacer"
   ↓
6. Requête PATCH vers backend
   ↓
7. Mise à jour de la base de données
   ↓
8. Invalidation du cache frontend
   ↓
9. Rafraîchissement de l'arbre
   ↓
10. Message de confirmation
```

## 🔒 Validations

### Frontend
- ✅ L'option "Déplacer" est désactivée s'il n'y a qu'une seule zone
- ✅ La zone actuelle est exclue de la liste de destination
- ✅ Le bouton "Déplacer" est désactivé tant qu'aucune zone n'est sélectionnée

### Backend
- ✅ Vérification de l'existence de la géocache
- ✅ Vérification de l'existence de la zone cible
- ✅ Transaction SQL avec rollback automatique en cas d'erreur
- ✅ Logging de toutes les opérations

## 🐛 Gestion des Erreurs

### Frontend
```typescript
try {
    await this.moveGeocache(geocache, targetZoneId);
    this.messages.info('Succès');
} catch (e) {
    console.error('Move error', e);
    this.messages.error('Erreur lors du déplacement');
}
```

### Backend
```python
try:
    geocache.zone_id = target_zone_id
    db.session.commit()
    return jsonify({'message': 'Success'}), 200
except Exception as e:
    db.session.rollback()
    logger.error(f"Error: {e}")
    return jsonify({'error': 'Failed'}), 500
```

## 🎨 Thèmes Supportés

Le menu contextuel s'adapte automatiquement à tous les thèmes Theia :
- ✅ Light themes
- ✅ Dark themes
- ✅ High contrast themes
- ✅ Custom themes

Grâce à l'utilisation exclusive des variables CSS Theia (`--theia-*`)

---

**Auteur**: Assistant IA  
**Date**: 2025-10-27  
**Version**: 1.0.0  
**Status**: ✅ Production Ready

