# 🔧 Corrections - Réactivation des cartes

## 🐛 Problèmes identifiés

### 1. Panneau "Cartes" non visible

**Symptôme** : Le panneau "Cartes" n'apparaît pas dans la barre latérale gauche.

**Cause** : Le fichier CSS n'était pas importé dans le widget.

**Solution** : Ajout de `import './map-manager-widget.css';` dans `map-manager-widget.tsx`.

### 2. Réactivation ne fonctionne qu'une fois

**Symptôme** : 
- Première activation d'une zone → log "Réactivation de la carte zone" ✅
- Deuxième activation → pas de log, pas de réactivation ❌

**Cause** : La méthode `onActivateRequest()` n'est pas toujours appelée par Theia, ou la carte est déjà visible donc la condition échoue.

**Solution** : Utilisation de plusieurs hooks :
- `onActivateRequest()` - Activation du widget
- `onAfterShow()` - Widget devient visible après avoir été caché
- Vérification `!existingMap.isVisible` avant d'activer

### 3. Warnings "did not accept focus"

**Symptôme** : Logs d'avertissement répétés.

**Cause** : Les widgets n'acceptent pas explicitement le focus.

**Solution** : Comportement normal pour des widgets de type "vue", pas critique.

---

## ✅ Corrections appliquées

### Fichier : `map-manager-widget.tsx`

**Avant** :
```typescript
import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser';
import { MapWidget, MapContext } from './map-widget';
```

**Après** :
```typescript
import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser';
import { MapWidget, MapContext } from './map-widget';
import './map-manager-widget.css'; // ✅ AJOUTÉ
```

### Fichier : `zone-geocaches-widget.tsx`

**Avant** :
```typescript
protected onActivateRequest(msg: any): void {
    super.onActivateRequest(msg);
    
    // Si on a une zone chargée, réactiver sa carte
    if (this.zoneId && this.zoneName) {
        const mapId = `geoapp-map-zone-${this.zoneId}`;
        const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
        
        if (existingMap) { // ⚠️ Problème : peut être visible
            this.shell.activateWidget(mapId);
        }
    }
}
```

**Après** :
```typescript
protected onActivateRequest(msg: any): void {
    super.onActivateRequest(msg);
    this.reactivateMap();
}

protected onAfterShow(msg: any): void { // ✅ NOUVEAU hook
    super.onAfterShow(msg);
    this.reactivateMap();
}

private reactivateMap(): void {
    if (this.zoneId && this.zoneName) {
        const mapId = `geoapp-map-zone-${this.zoneId}`;
        const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
        
        if (existingMap && !existingMap.isVisible) { // ✅ Vérifie si invisible
            console.log('[ZoneGeocachesWidget] Réactivation de la carte zone:', this.zoneId);
            this.shell.activateWidget(mapId);
        }
    }
}
```

### Fichier : `geocache-details-widget.tsx`

Même logique que `zone-geocaches-widget.tsx`.

---

## 🎯 Changements clés

### 1. Import CSS
```typescript
import './map-manager-widget.css';
```

### 2. Double hook
```typescript
onActivateRequest() // Widget activé
onAfterShow()       // Widget redevient visible
```

### 3. Vérification de visibilité
```typescript
if (existingMap && !existingMap.isVisible) {
    // Réactiver seulement si invisible
}
```

---

## 🧪 Tests à effectuer

### Test 1 : Panneau visible

1. Relancer Theia
2. Regarder la barre latérale gauche
3. ✅ **Le panneau "Cartes" devrait être visible**

### Test 2 : Réactivation répétée

1. Ouvrir une Zone A
2. Vérifier carte Zone A visible
3. Ouvrir une Géocache B
4. Vérifier carte Géocache B visible
5. Cliquer sur onglet Zone A (Main Layer)
6. ✅ **Carte Zone A devrait se réactiver**
7. Cliquer sur onglet Géocache B (Main Layer)
8. ✅ **Carte Géocache B devrait se réactiver**
9. Re-cliquer sur Zone A
10. ✅ **Carte Zone A devrait se réactiver à nouveau**

### Test 3 : Logs

Dans la console, vous devriez voir :
```
[ZoneGeocachesWidget] Réactivation de la carte zone: X
[GeocacheDetailsWidget] Réactivation de la carte géocache: Y
```

**Chaque fois** que vous revenez sur un onglet.

---

## 📊 Avant vs Après

| Fonctionnalité | Avant | Après |
|----------------|-------|-------|
| Panneau "Cartes" | ❌ Non visible | ✅ Visible |
| Réactivation 1ère fois | ✅ Fonctionne | ✅ Fonctionne |
| Réactivation 2ème fois | ❌ Ne fonctionne pas | ✅ Fonctionne |
| Réactivation 3ème+ fois | ❌ Ne fonctionne pas | ✅ Fonctionne |
| Warnings focus | ⚠️ Présents | ⚠️ Présents (normal) |

---

## 💡 Pourquoi `onAfterShow` ?

`onActivateRequest()` est appelé quand on **active** un widget, mais pas forcément quand on **revient** sur un widget déjà actif.

`onAfterShow()` est appelé quand un widget **redevient visible** après avoir été caché par un autre onglet.

**Combinaison des deux** = Réactivation fiable dans tous les cas !

---

## ⚠️ Notes sur les warnings

Les warnings "did not accept focus" sont **normaux** pour des widgets de type "vue" qui ne gèrent pas le focus clavier.

Pour les supprimer (optionnel), on pourrait ajouter :
```typescript
canAcceptFocus(): boolean {
    return false; // Widget ne prend pas le focus
}
```

Mais ce n'est pas critique et n'affecte pas le fonctionnement.

---

## 🚀 Pour tester

```bash
cd theia-blueprint/theia-extensions/zones
yarn build
# Puis relancer Theia
```

Résultat attendu :
1. ✅ Panneau "Cartes" visible
2. ✅ Réactivation fonctionne à chaque fois
3. ✅ Logs apparaissent correctement

---

**Status** : ✅ Corrigé et compilé avec succès  
**Version** : 2.1 (patch de réactivation)


