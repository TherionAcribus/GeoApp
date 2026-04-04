# Intégration Formula Solver avec Geocaches

**Date** : 10 novembre 2025  
**Objectif** : Ajouter un menu contextuel "Résoudre la formule" dans GeocacheDetailsWidget

---

## ✅ Ce qui a été implémenté

### Backend (`formula_solver.py`)
✅ Route GET `/api/formula-solver/geocache/<geocache_id>`  
- Récupère id, gc_code, name, description, latitude, longitude
- Gestion erreurs 404 et 500

### Frontend Formula Solver

✅ **Service** (`formula-solver-service.ts`) :
- Méthode `getGeocache(geocacheId)` → appelle l'API

✅ **Widget** (`formula-solver-widget.tsx`) :
- Méthode `loadFromGeocache(geocacheId)`
- Charge automatiquement description + origine
- Détecte automatiquement les formules
- Feedback utilisateur (toast)

✅ **Types** (`types.ts`) :
- Ajout `gcCode`, `originLat`, `originLon` dans `FormulaSolverState`

✅ **Contribution** (`formula-solver-contribution.ts`) :
- Commande `formula-solver:solve-from-geocache`
- Exécute `widget.loadFromGeocache(geocacheId)`

---

## 🔧 Intégration dans theia-ide-product-ext

### Étape 1 : Importer la commande

**Fichier** : `theia-extensions/product/src/browser/geocache-details-widget.tsx`

```typescript
// Ajouter en haut du fichier
import { FormulaSolverSolveFromGeocacheCommand } from '@mysterai/theia-formula-solver/lib/browser/formula-solver-contribution';
```

### Étape 2 : Ajouter le menu contextuel

**Option A : Menu contextuel sur le widget entier**

Dans `GeocacheDetailsWidget`, ajouter un bouton dans l'en-tête :

```typescript
protected renderHeader(): React.ReactNode {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>{this.state.geocache?.name}</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
                {/* Boutons existants... */}
                
                {/* Nouveau bouton Formula Solver */}
                <button
                    style={{
                        padding: '6px 12px',
                        backgroundColor: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                    }}
                    onClick={() => this.solveFormula()}
                    title="Ouvrir le Formula Solver"
                >
                    <span className='codicon codicon-symbol-variable'></span>
                    Résoudre formule
                </button>
            </div>
        </div>
    );
}

protected async solveFormula(): Promise<void> {
    if (!this.state.geocache) return;
    
    try {
        await this.commandService.executeCommand(
            FormulaSolverSolveFromGeocacheCommand.id,
            this.state.geocache.id
        );
    } catch (error) {
        console.error('Erreur lors de l'ouverture du Formula Solver:', error);
        this.messageService.error('Impossible d\'ouvrir le Formula Solver');
    }
}
```

**Option B : Menu contextuel dans la section Description**

```typescript
protected renderDescription(): React.ReactNode {
    if (!this.state.geocache?.description) return null;
    
    return (
        <div style={{ marginTop: '15px' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px'
            }}>
                <h3>Description</h3>
                <button
                    style={{
                        padding: '4px 8px',
                        backgroundColor: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px'
                    }}
                    onClick={() => this.solveFormula()}
                >
                    <span className='codicon codicon-symbol-variable' style={{ marginRight: '4px' }}></span>
                    Résoudre
                </button>
            </div>
            <div dangerouslySetInnerHTML={{ __html: this.state.geocache.description }} />
        </div>
    );
}
```

**Option C : Menu contextuel clic droit (avancé)**

Dans le `constructor` ou `@postConstruct`:

```typescript
this.node.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    
    // Vérifier si le clic est dans la zone description
    if (target.closest('.geocache-description')) {
        event.preventDefault();
        this.contextMenuRenderer.render({
            menuPath: ['geocache-context-menu'],
            anchor: event,
            args: [this.state.geocache?.id]
        });
    }
});
```

Et enregistrer l'action dans `registerMenus`:

```typescript
registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(['geocache-context-menu'], {
        commandId: FormulaSolverSolveFromGeocacheCommand.id,
        label: 'Résoudre la formule',
        icon: 'codicon codicon-symbol-variable'
    });
}
```

---

## 📋 Checklist d'intégration

### Backend
- [x] Route GET `/api/formula-solver/geocache/<id>`
- [x] Validation geocache_id
- [x] Gestion erreurs 404

### Formula Solver Extension
- [x] Service `getGeocache()`
- [x] Widget `loadFromGeocache()`
- [x] Commande `formula-solver:solve-from-geocache`
- [x] Types mis à jour (gcCode, originLat, originLon)

### Product Extension (À faire)
- [ ] Importer `FormulaSolverSolveFromGeocacheCommand`
- [ ] Ajouter bouton/menu dans `GeocacheDetailsWidget`
- [ ] Tester le workflow complet

---

## 🧪 Test du workflow

### Scénario de test

1. **Ouvrir une geocache Mystery**
   - Via la liste des geocaches
   - Cliquer pour ouvrir GeocacheDetailsWidget

2. **Cliquer sur "Résoudre formule"**
   - Bouton visible dans l'en-tête OU section description
   - Formula Solver s'ouvre dans panneau droit

3. **Vérifier le chargement automatique**
   - Description chargée dans textarea
   - Formule détectée automatiquement
   - Coordonnées origine pré-remplies
   - Toast de confirmation affiché

4. **Tester la résolution**
   - Questions extraites
   - Saisir valeurs
   - Calculer coordonnées
   - Vérifier résultat

---

## 🎯 Avantages de cette intégration

✅ **UX native** : Pas besoin de copier/coller la description  
✅ **Gain de temps** : Formule détectée automatiquement  
✅ **Contexte** : Coordonnées origine auto-chargées  
✅ **Simplicité** : 1 clic pour ouvrir le solver  
✅ **Cohérence** : Intégration fluide avec l'existant

---

## 📝 Notes techniques

### CommandService

Le `CommandService` est injecté dans tous les widgets Theia :

```typescript
@inject(CommandService)
protected readonly commandService: CommandService;
```

### Passage de paramètres

La commande accepte `geocacheId` comme paramètre :

```typescript
await this.commandService.executeCommand(
    'formula-solver:solve-from-geocache',
    geocacheId  // ← paramètre passé au execute()
);
```

### Gestion erreurs

Toujours wrapper dans try/catch :

```typescript
try {
    await this.commandService.executeCommand(...);
} catch (error) {
    this.messageService.error('Erreur: ' + error.message);
}
```

---

## 🚀 Prochaines étapes

Une fois l'intégration dans `GeocacheDetailsWidget` terminée :

1. **Test complet** du workflow
2. **Ajout bouton "Retour à la geocache"** dans Formula Solver
3. **Création waypoints** depuis les résultats
4. **Projection sur carte** des coordonnées calculées

---

**Prêt pour l'intégration dans theia-ide-product-ext !** 🎯
