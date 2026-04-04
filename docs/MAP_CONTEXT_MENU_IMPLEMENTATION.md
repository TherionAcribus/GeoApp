# 🗺️ Menu Contextuel de la Carte - Implémentation

## 🎉 Vue d'ensemble

Ajout d'un **menu contextuel** (clic droit) sur la carte des Geocaches pour afficher et copier les coordonnées du point cliqué !

## ✨ Fonctionnalités

### 📍 Menu Contextuel de la Carte

**Clic droit n'importe où sur la carte** affiche les options suivantes :

| Option | Icône | Action | Format |
|--------|-------|--------|--------|
| **Format GC** | 🌍 | Copie les coordonnées au format Geocaching | `N 48° 51.396 E 002° 21.132` |
| **Décimal** | 🔢 | Copie les coordonnées au format décimal | `48.856600, 2.352200` |

### 🎯 Comportement

- **Clic droit** : Ouvre le menu contextuel aux coordonnées du curseur
- **Clic sur une option** : Copie automatiquement les coordonnées dans le presse-papiers
- **Clic extérieur ou Échap** : Ferme le menu contextuel
- **Format automatique** : Les coordonnées sont formatées selon le standard choisi

## 📁 Fichiers Modifiés

### 1. **`map-utils.ts`**

**Nouvelle fonction ajoutée** :
```typescript
export function formatGeocachingCoordinates(lon: number, lat: number): string
```

**Features** :
- Convertit les coordonnées décimales au format Geocaching standard
- Format de sortie : `N 48° 51.396 E 002° 21.132`
- Gère les directions cardinales (N/S pour latitude, E/W pour longitude)
- Précision de 3 décimales pour les minutes (standard Geocaching)
- Formatage de la longitude avec zéros devant (ex: `002°`)

**Exemple d'utilisation** :
```typescript
const coords = formatGeocachingCoordinates(2.3522, 48.8566);
// Résultat: "N 48° 51.396 E 002° 21.132"
```

### 2. **`map-view.tsx`**

**Nouveaux imports** :
```typescript
import { mapCoordinateToLonLat, formatGeocachingCoordinates } from './map-utils';
import { ContextMenu, ContextMenuItem } from '../context-menu';
```

**Nouvel état** :
```typescript
const [contextMenu, setContextMenu] = React.useState<{
    items: ContextMenuItem[];
    x: number;
    y: number
} | null>(null);
```

**Gestionnaire d'événement** :
- Écoute l'événement `contextmenu` sur l'élément de la carte
- Empêche le menu contextuel par défaut du navigateur
- Récupère les coordonnées du clic via OpenLayers
- Convertit les coordonnées de la projection de la carte (Web Mercator) vers WGS84
- Crée les items du menu avec les deux formats de coordonnées
- Affiche le menu contextuel à la position du curseur

**Nettoyage** :
- Suppression de l'écouteur d'événement lors du démontage du composant
- Prévention des fuites mémoire

## 🎨 Design & UX

### Style du Menu Contextuel

Le menu contextuel réutilise le composant `ContextMenu` existant avec :
- **Position** : Fixed, suit le curseur de la souris
- **Background** : Variable Theia `--theia-menu-background`
- **Border** : Variable Theia `--theia-menu-border`
- **Shadow** : Box-shadow élégant pour la profondeur
- **Min-width** : 180px pour lisibilité
- **Border-radius** : 4px pour modernité

### Structure du Menu

```
📍 Coordonnées          [Titre désactivé]
─────────────────────   [Séparateur]
🌍 Format GC: N 48°...  [Cliquable - Copie]
🔢 Décimal: 48.856...   [Cliquable - Copie]
```

### Feedback Utilisateur

- **Hover** : Background `--theia-menu-selectionBackground`
- **Clic** : Copie dans le presse-papiers + log console
- **Fermeture automatique** : Après sélection d'une option

## 🚀 Utilisation

### Pour l'utilisateur

1. **Ouvrir une carte de Geocaches**
2. **Clic droit n'importe où sur la carte**
3. **Menu contextuel s'affiche** avec les coordonnées du point cliqué
4. **Cliquer sur le format souhaité** pour copier les coordonnées
5. **Les coordonnées sont dans le presse-papiers** prêtes à être collées

### Cas d'usage

- 📋 **Copier des coordonnées** pour les partager
- 🎯 **Identifier un point précis** sur la carte
- 🔍 **Obtenir les coordonnées** d'un lieu d'intérêt
- 📝 **Préparer des waypoints** pour une énigme
- 🗺️ **Planifier un itinéraire** avec des points de passage

## 🔧 Détails Techniques

### Conversion de Coordonnées

**Flux de conversion** :
```
1. Clic utilisateur (pixels écran)
   ↓
2. map.getEventPixel(event) → Pixels carte
   ↓
3. map.getCoordinateFromPixel(pixel) → Web Mercator (EPSG:3857)
   ↓
4. mapCoordinateToLonLat(coordinate) → WGS84 (lat, lon)
   ↓
5. formatGeocachingCoordinates(lon, lat) → Format GC
```

### Format Geocaching

Le format Geocaching utilise :
- **Degrés et minutes décimales** (pas de secondes)
- **3 décimales pour les minutes** (précision ~2 mètres)
- **Direction cardinale avant les degrés** (N/S E/W)
- **Zéros devant pour la longitude** (002° au lieu de 2°)

**Formule de conversion** :
```typescript
const degrees = Math.floor(decimal);
const minutes = (decimal - degrees) * 60;
const formatted = `${dir} ${degrees}° ${minutes.toFixed(3)}`;
```

### Gestion des Événements

**Prévention du menu par défaut** :
```typescript
event.preventDefault();
```

**Nettoyage approprié** :
```typescript
return () => {
    if (mapElement) {
        mapElement.removeEventListener('contextmenu', handleContextMenu);
    }
};
```

## 🎯 Avantages

✅ **Rapidité** : Accès instantané aux coordonnées  
✅ **Précision** : Coordonnées exactes du point cliqué  
✅ **Flexibilité** : Deux formats disponibles (GC et décimal)  
✅ **Copie automatique** : Un clic pour copier dans le presse-papiers  
✅ **Cohérence** : Utilise le composant ContextMenu existant  
✅ **Thèmes** : S'adapte automatiquement au thème Theia  
✅ **Intuitivité** : Pattern familier du clic droit  

## 📊 Formats de Coordonnées

### Format Geocaching (GC)
- **Exemple** : `N 48° 51.396 E 002° 21.132`
- **Usage** : Standard pour les géocaches et énigmes
- **Précision** : ~2 mètres (3 décimales sur les minutes)
- **Lisibilité** : Format familier pour les géocacheurs

### Format Décimal
- **Exemple** : `48.856600, 2.352200`
- **Usage** : GPS, applications cartographiques, API
- **Précision** : ~11 cm (6 décimales)
- **Compatibilité** : Format universel (Google Maps, etc.)

## 🔒 Sécurité & Performance

### Sécurité
- ✅ Pas d'injection possible (coordonnées numériques)
- ✅ Validation implicite par OpenLayers
- ✅ Pas d'accès réseau ou stockage

### Performance
- ✅ Calculs légers (conversions mathématiques simples)
- ✅ Pas de requête réseau
- ✅ Nettoyage approprié des écouteurs d'événements
- ✅ Pas de fuite mémoire

## 🎨 Thèmes Supportés

Le menu contextuel s'adapte automatiquement à tous les thèmes Theia :
- ✅ Light themes
- ✅ Dark themes
- ✅ High contrast themes
- ✅ Custom themes

Grâce à l'utilisation exclusive des variables CSS Theia (`--theia-*`)

## 🔄 Évolutions Futures Possibles

### Fonctionnalités Additionnelles
- 📌 **Ajouter un waypoint** à cet emplacement
- 🎯 **Centrer la carte** sur ce point
- 📏 **Mesurer une distance** depuis ce point
- 🗺️ **Créer une zone** autour de ce point
- 🔍 **Rechercher des géocaches** à proximité
- 📋 **Autres formats** : UTM, MGRS, etc.

### Améliorations UX
- 💬 **Toast notification** lors de la copie
- 📋 **Historique** des coordonnées copiées
- ⚙️ **Préférences** de format par défaut
- 🎨 **Personnalisation** des formats affichés

---

**Auteur**: Assistant IA  
**Date**: 2025-11-01  
**Version**: 1.0.0  
**Status**: ✅ Production Ready
