# Correction : Erreur "Invalid hook call"

## Problème rencontré

```
Error: Invalid hook call. Hooks can only be called inside of the body of a function component.
```

### Cause
Les hooks React (`useState`) étaient utilisés dans une méthode de classe (`renderWaypoints`), ce qui est interdit par les règles de React. Les hooks ne peuvent être utilisés que dans :
- Des composants fonctionnels React
- Des hooks personnalisés

## Solution appliquée

### 1. Création d'un composant fonctionnel séparé

Au lieu d'utiliser les hooks dans la méthode `renderWaypoints` de la classe `GeocacheDetailsWidget`, j'ai créé un composant fonctionnel indépendant :

```typescript
const WaypointsEditor: React.FC<WaypointsEditorProps> = ({ waypoints, geocacheId, geocacheData, backendBaseUrl, onUpdate, messages }) => {
    const [editingId, setEditingId] = React.useState<number | 'new' | null>(null);
    const [editForm, setEditForm] = React.useState<Partial<GeocacheWaypoint>>({});
    // ... autres hooks
    
    // ... logique du composant
    
    return (
        // ... JSX
    );
};
```

### 2. Déplacement des fonctions utilitaires

Les fonctions de calcul géographique ont été déplacées en dehors de la classe pour être des fonctions pures :

```typescript
function calculateAntipode(lat: number, lon: number): { lat: number; lon: number } { ... }
function calculateProjection(lat: number, lon: number, distance: number, bearing: number): { lat: number; lon: number } { ... }
function toGCFormat(lat: number, lon: number): { gcLat: string; gcLon: string } { ... }
function parseGCCoords(gcLat: string, gcLon: string): { lat: number; lon: number } | null { ... }
```

### 3. Utilisation du composant dans le render

Dans la méthode `render()` de la classe, remplacement de :
```typescript
{this.renderWaypoints(d.waypoints)}
```

Par :
```typescript
<WaypointsEditor
    waypoints={d.waypoints}
    geocacheId={this.geocacheId}
    geocacheData={d}
    backendBaseUrl={this.backendBaseUrl}
    onUpdate={() => this.load()}
    messages={this.messages}
/>
```

## Architecture finale

### Fichier: `geocache-details-widget.tsx`

```
[Types et Interfaces]
├── GeocacheWaypoint
├── GeocacheChecker
├── GeocacheDto
└── WaypointsEditorProps

[Fonctions utilitaires pures]
├── calculateAntipode()
├── calculateProjection()
├── toGCFormat()
└── parseGCCoords()

[Composant fonctionnel]
└── WaypointsEditor (utilise les hooks React)
    ├── useState pour editingId
    ├── useState pour editForm
    ├── useState pour projectionParams
    └── useState pour calculatedCoords

[Classe ReactWidget]
└── GeocacheDetailsWidget
    ├── Méthodes de cycle de vie
    ├── load()
    ├── renderRow()
    ├── renderAttributes()
    ├── renderImages()
    ├── renderCheckers()
    └── render() ← utilise <WaypointsEditor />
```

## Avantages de cette architecture

### ✅ Respect des règles de React
- Les hooks sont utilisés uniquement dans un composant fonctionnel
- Pas de violation des "Rules of Hooks"

### ✅ Séparation des responsabilités
- **Fonctions pures** : Calculs géographiques réutilisables
- **Composant fonctionnel** : Gestion de l'état et de l'UI des waypoints
- **Classe widget** : Intégration dans Theia

### ✅ Testabilité
- Les fonctions pures peuvent être testées indépendamment
- Le composant fonctionnel peut être testé avec React Testing Library
- Pas de dépendance circulaire

### ✅ Maintenabilité
- Code modulaire et bien organisé
- Chaque partie a une responsabilité claire
- Facile à comprendre et à modifier

## Leçons apprises

### ❌ À ne pas faire
```typescript
class MyWidget extends ReactWidget {
    protected renderSomething() {
        const [state, setState] = React.useState(0); // ❌ ERREUR !
        // ...
    }
}
```

### ✅ À faire
```typescript
// Composant fonctionnel séparé
const MyComponent: React.FC<Props> = (props) => {
    const [state, setState] = React.useState(0); // ✅ OK
    // ...
};

class MyWidget extends ReactWidget {
    protected render() {
        return <MyComponent {...props} />; // ✅ OK
    }
}
```

## Vérification

### Compilation TypeScript
```bash
$ yarn build
✓ Compilation réussie sans erreurs
```

### Fonctionnalités préservées
- ✅ Ajout de waypoints
- ✅ Édition de waypoints
- ✅ Suppression de waypoints
- ✅ Calcul d'antipode
- ✅ Calcul de projection
- ✅ Conversion de formats de coordonnées

## Références

- [React Hooks Rules](https://reactjs.org/docs/hooks-rules.html)
- [Invalid Hook Call Warning](https://reactjs.org/link/invalid-hook-call)
- [Theia ReactWidget Documentation](https://eclipse-theia.github.io/theia/docs/next/widgets/)

---

**Date de correction** : 1er novembre 2025  
**Fichier modifié** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`  
**Statut** : ✅ Résolu et testé
