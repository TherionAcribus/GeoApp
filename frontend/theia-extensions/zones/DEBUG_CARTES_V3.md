# 🔍 Debug : Cartes Multiples & Réactivation

**Date** : 31 octobre 2025  
**Version** : 2.3 (debug)

---

## 🐛 Problème observé

D'après les derniers logs :

1. ✅ **Zone s'ouvre** : Carte créée avec 16 géocaches
2. ✅ **Géocache s'ouvre** : Nouvelle carte créée avec 1 géocache
3. ❌ **Retour sur Zone** : **Aucun log de réactivation de carte**

### Logs observés

**Ouverture Zone** :
```
[MapWidget geoapp-map-zone-2] loadGeocaches: 16 géocaches
[MapView] Géocaches reçues en props: 16
[MapView] Ajout de 16 géocaches à la carte
```

**Ouverture Géocache** :
```
[MapWidget geoapp-map-geocache-9] loadGeocaches: 1 géocaches
[MapView] Géocaches reçues en props: 1
[MapView] Ajout de 1 géocaches à la carte
```

**Retour sur Zone** :
```
2025-10-31T18:56:08.157Z root WARN Widget was activated, but did not accept focus after 2000ms: zone.geocaches.widget
```
❌ **Pas de log `[ZoneGeocachesWidget] Réactivation de la carte zone`**

---

## 🔧 Corrections appliquées

### 1. `map-widget-factory.ts` : Chargement immédiat pour widgets existants

**Problème** : Le `setTimeout(300ms)` empêchait le chargement immédiat pour les widgets existants.

**AVANT** :
```typescript
// Activer le widget
this.shell.activateWidget(widgetId);

// Charger les géocaches après 300ms (TOUJOURS)
setTimeout(() => {
    widget.loadGeocaches(geocaches);
}, 300);
```

**APRÈS** :
```typescript
// Charger les géocaches
if (widget.isAttached) {
    // Widget existant → chargement immédiat
    widget.loadGeocaches(geocaches);
} else {
    // Nouveau widget → attendre l'init
    setTimeout(() => {
        widget.loadGeocaches(geocaches);
    }, 300);
}

// Activer APRÈS avoir chargé
this.shell.activateWidget(widgetId);
```

### 2. `zone-geocaches-widget.tsx` : Logs de débogage détaillés

**Ajouté** :
```typescript
private reactivateMap(): void {
    console.log('[ZoneGeocachesWidget] reactivateMap appelé, zoneId:', this.zoneId);
    
    const mapId = `geoapp-map-zone-${this.zoneId}`;
    const bottomWidgets = this.shell.getWidgets('bottom');
    console.log('[ZoneGeocachesWidget] Widgets dans bottom:', bottomWidgets.map(w => w.id));
    
    const existingMap = bottomWidgets.find(w => w.id === mapId);
    console.log('[ZoneGeocachesWidget] Carte trouvée:', !!existingMap);
    
    if (existingMap) {
        console.log('[ZoneGeocachesWidget] Réactivation de la carte zone:', this.zoneId);
        this.shell.activateWidget(mapId);
    } else {
        console.warn('[ZoneGeocachesWidget] Carte non trouvée dans le bottom layer');
    }
}
```

---

## 🧪 Tests à effectuer

### Test 1 : Logs de débogage

Relancez Theia et refaites la séquence :
1. Ouvrir Zone 2
2. Ouvrir Géocache GCAD85V
3. **Cliquer sur l'onglet Zone 2**

**Logs attendus** (dans la console) :
```
[ZoneGeocachesWidget] reactivateMap appelé, zoneId: 2 zoneName: Test
[ZoneGeocachesWidget] Widgets dans bottom: ['geoapp-map-zone-2', 'geoapp-map-geocache-9']
[ZoneGeocachesWidget] Carte trouvée: true ID recherché: geoapp-map-zone-2
[ZoneGeocachesWidget] Réactivation de la carte zone: 2
```

### Test 2 : Vérifier le panneau "Cartes"

Le panneau devrait maintenant afficher :
```
📋 Cartes ouvertes (2)
🗺️ Zone: Test
📍 Géocache: GCAD85V
```

### Test 3 : Vérifier les données de chaque carte

1. **Cliquer sur "Zone: Test" dans le panneau**
   - ✅ Carte active dans le bottom
   - ✅ Affiche 16 points
   
2. **Cliquer sur "Géocache: GCAD85V" dans le panneau**
   - ✅ Carte active dans le bottom
   - ✅ Affiche 1 point

---

## 🔍 Diagnostics possibles

### Si `reactivateMap` n'est pas appelé

**Symptôme** : Aucun log `[ZoneGeocachesWidget] reactivateMap appelé`

**Cause possible** :
- `onActivateRequest` n'est pas déclenchée par Theia
- Le widget n'est pas vraiment "activé"

**Solution** : Utiliser un event listener global sur l'ApplicationShell

### Si la carte n'est pas trouvée

**Symptôme** : Log `[ZoneGeocachesWidget] Carte non trouvée dans le bottom layer`

**Causes possibles** :
1. La carte a été fermée
2. L'ID ne correspond pas (erreur de construction)
3. La carte est dans un autre area

**Solution** : Vérifier avec le log des widgets dans bottom

### Si la carte est trouvée mais pas activée

**Symptôme** : 
- Log `[ZoneGeocachesWidget] Réactivation de la carte zone: 2`
- Mais la carte ne devient pas visible

**Cause** : `shell.activateWidget()` ne fonctionne pas comme prévu

**Solution** : Forcer avec `shell.revealWidget()`

---

## 📋 Checklist de débogage

Quand vous relancez Theia, vérifiez dans l'ordre :

- [ ] **Démarrage** : `[MapManagerWidget] Widget initialisé avec ID: geoapp-map-manager`
- [ ] **Ouverture Zone** : `[MapWidget geoapp-map-zone-2] loadGeocaches: X géocaches`
- [ ] **Ouverture Géocache** : `[MapWidget geoapp-map-geocache-Y] loadGeocaches: 1 géocaches`
- [ ] **Panneau visible** : Le panneau "Cartes" liste les 2 cartes
- [ ] **Clic sur Zone** : Logs de `reactivateMap` apparaissent
- [ ] **Liste widgets** : La liste des widgets dans bottom est correcte
- [ ] **Carte trouvée** : `Carte trouvée: true`
- [ ] **Activation** : La carte Zone devient active visuellement

---

## 🚀 Prochaines étapes

### Si ça ne fonctionne toujours pas

1. **Vérifier que `onActivateRequest` est appelée** :
   ```typescript
   protected onActivateRequest(msg: any): void {
       console.log('[ZoneGeocachesWidget] onActivateRequest appelé !!!');
       super.onActivateRequest(msg);
       this.reactivateMap();
   }
   ```

2. **Essayer une approche alternative** : Observer les changements d'onglets via `ApplicationShell.onDidChangeActiveWidget`

3. **Forcer l'activation** avec `revealWidget()` :
   ```typescript
   this.shell.revealWidget(mapId);
   await this.shell.activateWidget(mapId);
   ```

### Si ça fonctionne

✅ **Nettoyer les logs de debug**  
✅ **Créer la doc finale**  
✅ **Tester tous les scénarios**

---

**Status** : 🔍 En debug  
**Build** : ✅ Compiled (Done in 3.94s)

Relancez Theia et observez les nouveaux logs !


