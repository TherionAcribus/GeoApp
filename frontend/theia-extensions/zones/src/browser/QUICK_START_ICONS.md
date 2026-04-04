# 🚀 Guide de Démarrage Rapide - Icônes de Géocaches

Guide ultra-rapide pour commencer à utiliser les icônes de géocaches en 2 minutes !

## ✅ Ce qui a été fait

Le système d'icônes de géocaches est maintenant **entièrement configuré et prêt à l'emploi** :

- ✓ Sprite sheet placé dans `src/browser/assets/geocaching-sprite.png`
- ✓ Configuration complète avec 16 types de géocaches
- ✓ Composant React réutilisable
- ✓ Intégré dans le tableau des géocaches
- ✓ Documentation complète
- ✓ Exemples pratiques

## 🎯 Utilisation en 30 secondes

### 1. Import simple

```typescript
import { GeocacheIcon } from './geocache-icon';
```

### 2. Utilisation basique

```tsx
<GeocacheIcon type="Traditional Cache" />
```

C'est tout ! 🎉

## 📍 Où l'utiliser ?

### Dans un tableau

```tsx
{
  header: 'Type',
  cell: ({ row }) => (
    <GeocacheIcon type={row.original.cache_type} size={32} />
  )
}
```

### Dans une liste

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <GeocacheIcon type={geocache.cache_type} size={24} />
  <span>{geocache.name}</span>
</div>
```

### Sur une carte

```tsx
<GeocacheIcon type="Multi-Cache" size={40} />
```

## 🎨 Options principales

```tsx
<GeocacheIcon 
  type="Earthcache"          // Type de cache
  size={32}                  // Taille en pixels (default: 24)
  showLabel={true}           // Afficher le label (default: false)
  title="Mon tooltip"        // Tooltip personnalisé
/>
```

## 📦 Types supportés

Le système reconnaît automatiquement ces types (et plus) :

- Traditional Cache
- Multi-Cache
- Mystery Cache / Unknown Cache
- Earthcache
- Virtual Cache
- Event Cache
- Wherigo Cache
- Letterbox Hybrid
- CITO, Mega-Event, Giga-Event
- Et plus encore...

## 🔗 Fichiers importants

| Fichier | Description |
|---------|-------------|
| `geocache-icon.tsx` | Composant principal |
| `geocache-icon-config.ts` | Configuration et mappings |
| `geocache-icon.examples.tsx` | Exemples prêts à l'emploi |
| `GEOCACHE_ICONS.md` | Documentation complète |

## 💡 Exemples rapides

### Badge avec compteur

```tsx
<div style={{
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  background: 'var(--theia-badge-background)',
  borderRadius: 12,
}}>
  <GeocacheIcon type="Traditional Cache" size={20} />
  <span>42</span>
</div>
```

### Avec label

```tsx
<GeocacheIcon 
  type="Wherigo Cache" 
  size={28}
  showLabel={true}
/>
```

### Légende complète

```tsx
import { GeocacheIconLegend } from './geocache-icon';

<GeocacheIconLegend columns={3} iconSize={28} />
```

## 🛠️ Fonctions utilitaires

```typescript
import { getIconByCacheType, getAllIcons } from './geocache-icon-config';

// Récupérer les infos d'une icône
const icon = getIconByCacheType('Traditional Cache');
console.log(icon?.label); // "Traditional Cache"

// Lister tous les types
const allIcons = getAllIcons();
console.log(allIcons.length); // 16
```

## ⚡ Intégration actuelle

Le système est **déjà intégré** dans :

- ✅ **geocaches-table.tsx** : Colonne "Type" avec icônes

## 🎓 Pour aller plus loin

- Consultez `GEOCACHE_ICONS.md` pour la documentation complète
- Explorez `geocache-icon.examples.tsx` pour plus d'exemples
- Le composant supporte tous les props React standards (style, className, etc.)

## 🤝 Contribution

Pour ajouter un nouveau type :

1. Ajoutez l'icône au sprite sheet (50x50px)
2. Mettez à jour `GEOCACHE_SPRITE_CONFIG.items` dans `geocache-icon-config.ts`
3. Ajoutez le mapping dans `CACHE_TYPE_TO_ICON_KEY`

---

**C'est tout !** Vous êtes prêt à utiliser les icônes partout dans votre application. 🎉

