# Système d'Icônes de Géocaches

Ce document explique comment utiliser le système d'icônes de géocaches dans l'extension Zones de Theia.

## 📋 Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Structure des fichiers](#structure-des-fichiers)
- [Utilisation du composant GeocacheIcon](#utilisation-du-composant-geocacheicon)
- [Configuration](#configuration)
- [API de référence](#api-de-référence)
- [Exemples avancés](#exemples-avancés)

## 🎯 Vue d'ensemble

Le système d'icônes de géocaches utilise un **sprite sheet** (feuille de sprites) pour afficher efficacement les icônes des différents types de géocaches. Cette approche offre plusieurs avantages :

- ✅ **Performance** : Une seule image chargée pour toutes les icônes
- ✅ **Cohérence** : Toutes les icônes utilisent le même style visuel
- ✅ **Facilité d'utilisation** : Composant React simple à utiliser
- ✅ **Type-safe** : Configuration TypeScript complète
- ✅ **Flexible** : Support de différentes tailles et modes d'affichage

## 📁 Structure des fichiers

```
src/browser/
├── assets/
│   └── geocaching-sprite.png       # Feuille de sprites (1800x200px)
├── geocache-icon-config.ts         # Configuration et mappings
├── geocache-icon.tsx               # Composant React
└── geocaches-table.tsx             # Exemple d'utilisation
```

### Fichiers clés

- **`geocache-icon-config.ts`** : Contient la configuration du sprite sheet, les mappings de types et les fonctions utilitaires
- **`geocache-icon.tsx`** : Composant React réutilisable pour afficher les icônes
- **`assets/geocaching-sprite.png`** : Image contenant toutes les icônes (50x50px chacune)

## 🎨 Utilisation du composant GeocacheIcon

### Import

```typescript
import { GeocacheIcon } from './geocache-icon';
```

### Utilisation basique

```tsx
// Avec le type complet (tel que retourné par l'API)
<GeocacheIcon type="Traditional Cache" />

// Avec une clé d'icône
<GeocacheIcon iconKey="traditional" />

// Avec une taille personnalisée
<GeocacheIcon type="Multi-Cache" size={32} />
```

### Avec label

```tsx
// Afficher l'icône avec son label
<GeocacheIcon 
  type="Earthcache" 
  showLabel={true} 
  size={24}
/>

// Avec un style personnalisé pour le label
<GeocacheIcon 
  type="Wherigo Cache" 
  showLabel={true}
  labelStyle={{ color: 'blue', fontSize: '0.8em' }}
/>
```

### Dans un tableau

```tsx
const columns = [
  {
    header: 'Type',
    cell: ({ row }) => (
      <GeocacheIcon 
        type={row.original.cache_type} 
        size={32}
      />
    )
  }
];
```

### Propriétés du composant

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `string` | - | Type de géocache (ex: "Traditional Cache") |
| `iconKey` | `string` | - | Clé d'icône directe (ex: "traditional") |
| `size` | `number` | `24` | Taille de l'icône en pixels |
| `title` | `string` | Label du type | Titre au survol (tooltip) |
| `style` | `React.CSSProperties` | - | Styles CSS supplémentaires |
| `className` | `string` | - | Classe CSS supplémentaire |
| `showLabel` | `boolean` | `false` | Afficher le label à côté de l'icône |
| `labelStyle` | `React.CSSProperties` | - | Styles pour le label |

## ⚙️ Configuration

### Types de géocaches supportés

Le système supporte les types suivants (voir `geocache-icon-config.ts` pour la liste complète) :

| Type | Clé | Position |
|------|-----|----------|
| Traditional Cache | `traditional` | (0, 0) |
| Project APE Cache | `ape` | (100, 0) |
| Groundspeak HQ | `hq` | (200, 0) |
| Multi-Cache | `multi` | (300, 0) |
| Event Cache | `event` | (400, 0) |
| Cache In Trash Out Event | `cito` | (500, 0) |
| Mega-Event Cache | `mega` | (600, 0) |
| Giga-Event Cache | `giga` | (700, 0) |
| GPS Adventures Exhibit | `maze` | (800, 0) |
| Earthcache | `earth` | (900, 0) |
| Virtual Cache | `virtual` | (1000, 0) |
| Webcam Cache | `webcam` | (1100, 0) |
| Locationless (Reverse) Cache | `locationless` | (1200, 0) |
| Mystery Cache | `mystery` | (1300, 0) |
| Letterbox Hybrid | `letterbox` | (1400, 0) |
| Wherigo Cache | `wherigo` | (1500, 0) |

### Ajouter un nouveau type

Pour ajouter un nouveau type de géocache :

1. Ajoutez l'icône au sprite sheet (`geocaching-sprite.png`)
2. Mettez à jour la configuration dans `geocache-icon-config.ts` :

```typescript
export const GEOCACHE_SPRITE_CONFIG: GeocacheSpriteConfig = {
  // ...
  items: [
    // ... types existants
    { 
      key: 'nouveau-type',
      x: 1600,  // Position X dans le sprite
      y: 0,     // Position Y dans le sprite
      w: 50,    // Largeur
      h: 50,    // Hauteur
      label: 'Nouveau Type de Cache' 
    },
  ]
};

// Ajouter le mapping
export const CACHE_TYPE_TO_ICON_KEY: Record<string, string> = {
  // ... mappings existants
  'Nouveau Type de Cache': 'nouveau-type',
};
```

## 📚 API de référence

### Fonctions utilitaires

```typescript
import { 
  getIconByKey, 
  getIconByCacheType,
  getAllIcons 
} from './geocache-icon-config';

// Récupérer une icône par sa clé
const icon = getIconByKey('traditional');
console.log(icon?.label); // "Traditional Cache"

// Récupérer une icône par le type de cache
const icon2 = getIconByCacheType('Traditional Cache');
console.log(icon2?.x, icon2?.y); // 0, 0

// Récupérer toutes les icônes
const allIcons = getAllIcons();
console.log(allIcons.length); // 16
```

### Hook personnalisé

```typescript
import { useGeocacheIcon } from './geocache-icon';

const MyComponent: React.FC<{ cacheType: string }> = ({ cacheType }) => {
  const icon = useGeocacheIcon(cacheType);
  
  if (!icon) {
    return <div>Type inconnu</div>;
  }
  
  return (
    <div>
      <p>Type: {icon.label}</p>
      <p>Position: ({icon.x}, {icon.y})</p>
    </div>
  );
};
```

### Composant de légende

Pour afficher une légende de tous les types disponibles :

```tsx
import { GeocacheIconLegend } from './geocache-icon';

<GeocacheIconLegend 
  columns={3}
  iconSize={28}
/>
```

## 💡 Exemples avancés

### Carte avec marqueurs personnalisés

```tsx
import { getIconByCacheType, GEOCACHE_SPRITE_CONFIG } from './geocache-icon-config';

const MapMarker: React.FC<{ geocache: Geocache }> = ({ geocache }) => {
  const icon = getIconByCacheType(geocache.cache_type);
  
  if (!icon) return null;
  
  return (
    <div 
      style={{
        width: 40,
        height: 40,
        backgroundImage: `url(${GEOCACHE_SPRITE_CONFIG.url})`,
        backgroundPosition: `-${icon.x}px -${icon.y}px`,
        backgroundSize: `${GEOCACHE_SPRITE_CONFIG.sheetWidth}px ${GEOCACHE_SPRITE_CONFIG.sheetHeight}px`,
      }}
    />
  );
};
```

### Filtre par type

```tsx
import { getAllIcons } from './geocache-icon-config';
import { GeocacheIcon } from './geocache-icon';

const TypeFilter: React.FC<{ onSelect: (key: string) => void }> = ({ onSelect }) => {
  const icons = getAllIcons();
  
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {icons.map(icon => (
        <button
          key={icon.key}
          onClick={() => onSelect(icon.key)}
          title={icon.label}
        >
          <GeocacheIcon iconKey={icon.key} size={24} />
        </button>
      ))}
    </div>
  );
};
```

### Statistiques par type

```tsx
import { getIconByCacheType } from './geocache-icon-config';
import { GeocacheIcon } from './geocache-icon';

const TypeStats: React.FC<{ geocaches: Geocache[] }> = ({ geocaches }) => {
  const stats = geocaches.reduce((acc, gc) => {
    acc[gc.cache_type] = (acc[gc.cache_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return (
    <div>
      {Object.entries(stats).map(([type, count]) => (
        <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GeocacheIcon type={type} size={24} />
          <span>{type}</span>
          <strong>({count})</strong>
        </div>
      ))}
    </div>
  );
};
```

### Badge avec icône et compteur

```tsx
const TypeBadge: React.FC<{ type: string; count: number }> = ({ type, count }) => {
  return (
    <div 
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--theia-badge-background)',
        borderRadius: 12,
      }}
    >
      <GeocacheIcon type={type} size={20} />
      <span style={{ fontSize: '0.9em', fontWeight: 600 }}>{count}</span>
    </div>
  );
};
```

## 🔧 Personnalisation

### Changer la taille du sprite sheet

Si vous modifiez le sprite sheet, mettez à jour la configuration :

```typescript
export const GEOCACHE_SPRITE_CONFIG: GeocacheSpriteConfig = {
  url: './assets/geocaching-sprite.png',
  sheetWidth: 1800,  // Nouvelle largeur
  sheetHeight: 200,  // Nouvelle hauteur
  items: [
    // Mettez à jour les positions si nécessaire
  ]
};
```

### Utiliser plusieurs sprite sheets

Si vous avez besoin de plusieurs variantes (couleurs, tailles) :

```typescript
// geocache-icon-config-variants.ts
export const GEOCACHE_SPRITE_GRAYSCALE: GeocacheSpriteConfig = {
  url: './assets/geocaching-sprite-gray.png',
  sheetWidth: 1800,
  sheetHeight: 200,
  items: GEOCACHE_SPRITE_CONFIG.items, // Réutiliser les positions
};

// Composant personnalisé
export const GeocacheIconGray: React.FC<GeocacheIconProps> = (props) => {
  // Utiliser GEOCACHE_SPRITE_GRAYSCALE au lieu de GEOCACHE_SPRITE_CONFIG
};
```

## 🐛 Dépannage

### L'icône ne s'affiche pas

1. Vérifiez que le chemin du sprite sheet est correct
2. Vérifiez que le type de géocache existe dans `CACHE_TYPE_TO_ICON_KEY`
3. Ouvrez la console du navigateur pour voir les erreurs

### L'icône est mal alignée

1. Vérifiez les positions (x, y) dans la configuration
2. Vérifiez que la taille du sprite sheet est correcte

### Performance

Le système est optimisé pour la performance :
- Une seule image chargée
- Pas de manipulation du DOM
- Composants React mémoïsés

## 📝 Notes

- Les icônes sont redimensionnées proportionnellement
- Un placeholder "?" est affiché pour les types inconnus
- Le système supporte les recherches case-insensitive
- Les tooltips affichent automatiquement le label du type

---

**Auteur** : Extension Zones pour Theia  
**Version** : 1.0.0  
**Dernière mise à jour** : Octobre 2025

