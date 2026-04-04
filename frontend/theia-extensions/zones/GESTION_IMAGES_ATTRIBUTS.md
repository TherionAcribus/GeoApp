# Gestion des Images d'Attributs de Géocaches

## Vue d'ensemble

Les icônes d'attributs de géocaches sont gérées via un système d'encodage en base64, similaire au sprite des icônes de géocaches. Cette approche garantit que les images sont toujours disponibles sans problème de chemin ou de bundling Webpack.

## Architecture

### Structure des fichiers

```
zones/
├── src/browser/
│   ├── assets/
│   │   └── geocache-attributes/     # Images PNG sources (139 icônes)
│   │       ├── danger-yes.png
│   │       ├── danger-no.png
│   │       ├── ticks-yes.png
│   │       └── ...
│   ├── geocache-attributes-icons-data.ts  # Fichier généré (base64)
│   └── geocache-details-widget.tsx        # Utilisation des icônes
└── scripts/
    └── generate-attribute-icons-data.js   # Script de génération
```

### Fichiers clés

1. **`assets/geocache-attributes/`** : Dossier contenant les images PNG sources
2. **`geocache-attributes-icons-data.ts`** : Fichier TypeScript généré contenant toutes les images encodées en base64
3. **`generate-attribute-icons-data.js`** : Script Node.js pour générer le fichier de données
4. **`geocache-details-widget.tsx`** : Widget qui affiche les icônes

## Convention de nommage des images

Les images suivent une convention stricte :

```
{nom-attribut}-{yes|no}.png
```

**Exemples** :
- `danger-yes.png` : Attribut "danger" présent
- `danger-no.png` : Attribut "danger" absent
- `ticks-yes.png` : Attribut "ticks" présent
- `parking-no (1).png` : Attribut "parking" absent (note : le "(1)" est géré)

### Règles importantes

- Le suffixe `-yes` ou `-no` est **obligatoire**
- Le nom de base doit correspondre au `base_filename` fourni par le backend
- Si `base_filename` n'est pas fourni, le nom est généré à partir du nom de l'attribut (minuscules, sans espaces)

## Génération du fichier de données

### Commande

```bash
cd theia-blueprint/theia-extensions/zones
node scripts/generate-attribute-icons-data.js
```

### Processus

1. Le script lit tous les fichiers `.png` du dossier `assets/geocache-attributes/`
2. Chaque image est encodée en base64
3. Un fichier TypeScript est généré avec :
   - Un objet `ATTRIBUTE_ICONS_DATA` contenant toutes les data URLs
   - Une fonction `getAttributeIconUrl(filename)` pour récupérer les URLs
   - Une fonction `hasAttributeIcon(filename)` pour vérifier l'existence

### Sortie du script

```
Génération des données pour 139 icônes d'attributs...
✓ Fichier généré: C:\...\geocache-attributes-icons-data.ts
✓ 139 icônes encodées en base64
```

### Fichier généré

```typescript
/**
 * Données des icônes d'attributs de géocaches encodées en base64
 * Ce fichier est généré automatiquement par scripts/generate-attribute-icons-data.js
 * NE PAS MODIFIER MANUELLEMENT
 */

export const ATTRIBUTE_ICONS_DATA: Record<string, string> = {
    'danger-yes': 'data:image/png;base64,iVBORw0KGgo...',
    'danger-no': 'data:image/png;base64,iVBORw0KGgo...',
    // ... 137 autres icônes
};

export function getAttributeIconUrl(filename: string): string | undefined {
    return ATTRIBUTE_ICONS_DATA[filename];
}

export function hasAttributeIcon(filename: string): boolean {
    return filename in ATTRIBUTE_ICONS_DATA;
}
```

## Utilisation dans le code

### Import

```typescript
import { getAttributeIconUrl } from './geocache-attributes-icons-data';
```

### Récupération d'une icône

```typescript
// L'attribut contient déjà le suffixe -yes ou -no dans base_filename
const iconUrl = getAttributeIconUrl(attribute.base_filename);

// Si base_filename n'existe pas, construire le nom
const iconFilename = attribute.base_filename || 
    `${attribute.name.toLowerCase().replace(/\s+/g, '')}-${attribute.is_negative ? 'no' : 'yes'}`;
const iconUrl = getAttributeIconUrl(iconFilename);
```

### Affichage dans React

```tsx
protected renderAttributes(attrs?: GeocacheAttribute[]): React.ReactNode {
    if (!attrs || attrs.length === 0) { return undefined; }
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {attrs.map((a, idx) => {
                const iconUrl = this.getAttributeIconUrlFromAttribute(a);
                const tooltipText = `${a.is_negative ? 'No ' : ''}${a.name}`;
                
                if (!iconUrl) {
                    // Fallback textuel si l'image n'est pas trouvée
                    return (
                        <span key={idx} style={{
                            border: '1px solid var(--theia-foreground)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontSize: 12,
                            opacity: a.is_negative ? 0.7 : 1
                        }} title={tooltipText}>
                            {a.is_negative ? 'No ' : ''}{a.name}
                        </span>
                    );
                }
                
                return (
                    <img 
                        key={idx}
                        src={iconUrl}
                        alt={tooltipText}
                        title={tooltipText}
                        style={{
                            width: 24,
                            height: 24,
                            opacity: a.is_negative ? 0.7 : 1,
                            cursor: 'help'
                        }}
                    />
                );
            })}
        </div>
    );
}
```

## Ajout de nouvelles icônes

### Procédure

1. **Ajouter les images PNG** dans `src/browser/assets/geocache-attributes/`
   - Respecter la convention de nommage : `{nom}-yes.png` et `{nom}-no.png`
   - Taille recommandée : 24x24 pixels ou multiples
   - Format : PNG avec transparence

2. **Régénérer le fichier de données** :
   ```bash
   node scripts/generate-attribute-icons-data.js
   ```

3. **Recompiler le projet** :
   ```bash
   npm run build
   ```

4. **Redémarrer l'application** pour voir les changements

### Exemple complet

```bash
# 1. Ajouter les images
cp new-attribute-yes.png src/browser/assets/geocache-attributes/
cp new-attribute-no.png src/browser/assets/geocache-attributes/

# 2. Régénérer
node scripts/generate-attribute-icons-data.js

# 3. Compiler
npm run build

# 4. L'icône est maintenant disponible
```

## Modification d'icônes existantes

1. **Remplacer l'image** dans `assets/geocache-attributes/`
2. **Régénérer** le fichier de données
3. **Recompiler** le projet

**Important** : Ne jamais modifier manuellement `geocache-attributes-icons-data.ts`, il sera écrasé lors de la prochaine génération.

## Avantages de cette approche

### ✅ Avantages

- **Pas de problème de chemin** : Les images sont embarquées dans le code
- **Pas de requêtes HTTP** : Chargement instantané
- **Bundling simplifié** : Webpack n'a pas besoin de gérer les assets
- **Déploiement facile** : Tout est dans le bundle JavaScript
- **Cache navigateur** : Les images sont cachées avec le code

### ⚠️ Inconvénients

- **Taille du bundle** : Augmente la taille du fichier JavaScript (~200KB pour 139 icônes)
- **Régénération nécessaire** : Chaque modification d'image nécessite une régénération
- **Lisibilité** : Le fichier généré est illisible (mais ne doit pas être lu)

## Dépannage

### Les icônes ne s'affichent pas

1. **Vérifier que le fichier a été régénéré** :
   ```bash
   node scripts/generate-attribute-icons-data.js
   ```

2. **Vérifier la compilation** :
   ```bash
   npm run build
   ```

3. **Vérifier la console du navigateur** :
   - Rechercher les warnings : `Attribute icon not found: xxx.png`

4. **Vérifier le nom de fichier** :
   - Le `base_filename` doit correspondre exactement au nom du fichier (sans `.png`)
   - Respecter la casse

### Erreur lors de la génération

```
Error: ENOENT: no such file or directory
```

**Solution** : Vérifier que le dossier `assets/geocache-attributes/` existe et contient des fichiers PNG.

### Icône manquante (fallback textuel affiché)

1. **Vérifier que l'image existe** dans `assets/geocache-attributes/`
2. **Vérifier le nom** : doit correspondre au `base_filename` de l'attribut
3. **Régénérer** le fichier de données
4. **Recompiler** le projet

## Performances

### Taille du fichier généré

- **139 icônes** : ~250KB de code TypeScript
- **Après compilation** : ~200KB de JavaScript
- **Après minification** : ~150KB
- **Après gzip** : ~50KB

### Impact sur le chargement

- **Premier chargement** : +50KB (gzippé)
- **Chargements suivants** : 0KB (cache navigateur)
- **Affichage** : Instantané (pas de requête HTTP)

## Alternatives considérées

### 1. Import direct avec require()

```typescript
const icon = require('./assets/geocache-attributes/danger-yes.png');
```

**Problème** : Nécessite une configuration Webpack complexe pour gérer les imports dynamiques.

### 2. Sprite sheet

```typescript
background-position: -24px -48px;
```

**Problème** : Difficile à maintenir avec 139 icônes, nécessite un outil de génération de sprite.

### 3. Chargement dynamique

```typescript
<img src="/assets/danger-yes.png" />
```

**Problème** : Nécessite de copier les assets lors du build, problèmes de chemin dans Theia.

## Conclusion

L'approche par encodage base64 est la plus adaptée pour ce projet car :

- ✅ Simple à mettre en œuvre
- ✅ Fiable (pas de problème de chemin)
- ✅ Performante (pas de requêtes HTTP)
- ✅ Facile à maintenir (script de génération automatique)

Le seul inconvénient (taille du bundle) est négligeable comparé aux avantages, surtout avec la compression gzip.
