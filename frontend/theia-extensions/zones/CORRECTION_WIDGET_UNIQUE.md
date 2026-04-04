# 🎯 Correction : Création de widgets vraiment uniques

**Date** : 31 octobre 2025  
**Version** : 2.4 (correction majeure)  
**Status** : ✅ Compilé avec succès

---

## 🐛 Problème identifié (CRITIQUE)

### Symptôme observé

D'après les logs utilisateur :
```
[ZoneGeocachesWidget] Widgets dans bottom: ['problems', 'geoapp-map-geocache-14', 'terminal-0']
[ZoneGeocachesWidget] Carte trouvée: false ID recherché: geoapp-map-zone-2
```

**La carte Zone a disparu !** Elle a été **remplacée** par la carte Géocache au lieu d'être **ajoutée**.

### Séquence du problème

1. **Ouverture Zone 2**
   - Création d'un widget avec ID `geoapp-map-zone-2`
   - Widget ajouté au bottom layer
   - ✅ Fonctionne

2. **Ouverture Géocache 14**
   - Appel `getOrCreateWidget(MapWidget.ID)` 
   - ❌ **Retourne le MÊME widget** que la Zone !
   - Le widget change de contexte (Zone → Géocache)
   - L'ID change (`geoapp-map-zone-2` → `geoapp-map-geocache-14`)
   - **La carte Zone est perdue !**

3. **Retour sur Zone**
   - Cherche `geoapp-map-zone-2` dans bottom
   - ❌ **Introuvable !** (remplacé par `geoapp-map-geocache-14`)

### Cause racine

**Le problème** : `getOrCreateWidget(MapWidget.ID)` retourne toujours **le même widget** !

```typescript
// ❌ AVANT (ligne 32)
widget = await this.widgetManager.getOrCreateWidget(MapWidget.ID) as MapWidget;
widget.setContext(context);  // Change l'ID du widget existant !
```

**Pourquoi ?**
- `getOrCreateWidget` cherche un widget dans le cache avec l'ID de factory (`MapWidget.ID`)
- Si un widget avec cet ID existe déjà (même avec un ID différent après `setContext`), il le retourne
- Le widget existant est **réutilisé** au lieu de créer une nouvelle instance
- Quand on fait `setContext`, l'ID du widget change, **écrasant l'ancien**

---

## ✅ Solution : Création directe via Container

### Changements apportés

#### 1. Injection du Container

```typescript
import { injectable, inject, Container } from '@theia/core/shared/inversify';

@injectable()
export class MapWidgetFactory {
    // ... autres injections ...
    
    @inject(Container)
    protected readonly container!: Container;  // ✅ AJOUTÉ
}
```

#### 2. Création directe d'une nouvelle instance

**AVANT** :
```typescript
widget = await this.widgetManager.getOrCreateWidget(MapWidget.ID) as MapWidget;
// ❌ Réutilise toujours le même widget
```

**APRÈS** :
```typescript
widget = this.container.get(MapWidget) as MapWidget;
// ✅ Crée une VRAIE nouvelle instance à chaque fois
```

### Pourquoi ça fonctionne maintenant ?

**`container.get(MapWidget)`** :
- Crée **directement** une nouvelle instance via InversifyJS
- **Bypass** le cache de `WidgetManager`
- Chaque appel retourne une **nouvelle instance indépendante**
- Chaque widget a son propre ID contextuel dès le départ

---

## 📊 Comparaison

### Avant (❌ Buggy)

```
┌─────────────────────────────┐
│ WidgetManager Cache         │
│  MapWidget.ID → [Widget #1] │  ← UN SEUL widget en cache
└─────────────────────────────┘
                 ↓
         getOrCreateWidget
                 ↓
        Retourne Widget #1  ← Toujours le même !
                 ↓
         setContext(zone)
                 ↓
        ID change → geoapp-map-zone-2
                 ↓
         setContext(geocache)
                 ↓
        ID change → geoapp-map-geocache-14  ← ÉCRASE l'ancien !
```

### Après (✅ Correct)

```
Container InversifyJS
        ↓
  container.get(MapWidget)
        ↓
   Nouvelle instance #1
        ↓
  setContext(zone)
        ↓
   ID → geoapp-map-zone-2  ← Widget indépendant

Container InversifyJS
        ↓
  container.get(MapWidget)
        ↓
   Nouvelle instance #2  ← DIFFÉRENT de #1 !
        ↓
  setContext(geocache)
        ↓
   ID → geoapp-map-geocache-14  ← Widget indépendant
```

---

## 🧪 Tests attendus

Relancez Theia et refaites la séquence :

### Scénario 1 : Ouverture Zone

**Logs attendus** :
```
[MapWidgetFactory] openMapForContext pour widgetId: geoapp-map-zone-2
[MapWidgetFactory] Création d'un NOUVEAU widget pour geoapp-map-zone-2
[MapWidgetFactory] Widget créé avec ID final: geoapp-map-zone-2
[MapWidgetFactory] Widget ajouté au bottom layer
[MapWidget geoapp-map-zone-2] loadGeocaches: 16 géocaches
```

### Scénario 2 : Ouverture Géocache

**Logs attendus** :
```
[MapWidgetFactory] openMapForContext pour widgetId: geoapp-map-geocache-14
[MapWidgetFactory] Création d'un NOUVEAU widget pour geoapp-map-geocache-14
[MapWidgetFactory] Widget créé avec ID final: geoapp-map-geocache-14
[MapWidgetFactory] Widget ajouté au bottom layer
[MapWidget geoapp-map-geocache-14] loadGeocaches: 1 géocaches
```

### Scénario 3 : Retour sur Zone

**Logs attendus** :
```
[ZoneGeocachesWidget] reactivateMap appelé, zoneId: 2 zoneName: Test
[ZoneGeocachesWidget] Widgets dans bottom: ['problems', 'geoapp-map-zone-2', 'geoapp-map-geocache-14', 'terminal-0']
                                                         ↑ PRÉSENT maintenant !
[ZoneGeocachesWidget] Carte trouvée: true ID recherché: geoapp-map-zone-2
[ZoneGeocachesWidget] Réactivation de la carte zone: 2
```

### Vérification Panneau "Cartes"

Le panneau devrait afficher :
```
📋 Cartes ouvertes (2)
🗺️ Zone: Test
📍 Géocache: GC...
```

**Et les deux doivent être cliquables !**

---

## 🎯 Résumé technique

| Aspect | Avant | Après |
|--------|-------|-------|
| Méthode création | `getOrCreateWidget()` | `container.get()` |
| Cache | Utilise le cache WidgetManager | Bypass le cache |
| Widgets créés | 1 réutilisé | X nouveaux indépendants |
| IDs | Écrasés successivement | Chacun son ID unique |
| Persistance | Perdu à chaque ouverture | Persistent tous |

---

## 🚀 Prochaine étape

**Relancez Theia** et testez :
1. Ouvrir Zone 2
2. Ouvrir Géocache
3. **Vérifier dans le panneau "Cartes"** → Vous devriez voir **les 2 cartes** !
4. Cliquer sur "Zone: Test" → Carte s'active avec 16 points
5. Cliquer sur "Géocache: ..." → Carte s'active avec 1 point

**Les deux cartes doivent coexister !** 🎉

---

**Version** : 2.4  
**Type** : Correction critique (architecture)  
**Build** : ✅ Done in 1.01s


