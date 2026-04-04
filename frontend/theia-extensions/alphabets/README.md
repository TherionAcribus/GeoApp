# Extension Alphabets pour Theia

Extension Theia pour gérer et déchiffrer des alphabets personnalisés pour le géocaching.

## Fonctionnalités implémentées

### ✅ Système complet

#### Backend & Infrastructure
- **Backend API Flask** : Gestion complète des alphabets avec auto-découverte
- **Support multi-formats** : Polices TTF et images PNG/JPG
- **API REST complète** : Endpoints pour lister, rechercher, charger alphabets et ressources

#### Interface utilisateur
- **Liste des alphabets** : Panel gauche avec recherche avancée (nom, tags, README)
- **Visualisation alphabet** : Interface complète de décodage dans le panel central
- **Symboles disponibles** : Affichage par catégories (lettres, chiffres, spéciaux)
- **Saisie bidirectionnelle** : Clic sur symboles ou saisie directe dans textarea
- **Zoom indépendant** : Par section avec persistance localStorage (5 niveaux de zoom)

#### Interaction avancée
- **Drag & drop** : Réorganisation des symboles entrés par glisser-déposer
- **Menu contextuel** : Clic droit sur symboles avec actions (supprimer, dupliquer, insérer)
- **Épinglage des sections** : Symboles, texte, et coordonnées fixables en haut
- **Zoom indépendant** : Zones épinglées avec leur propre niveau de zoom

#### Historique & Persistance
- **Undo/Redo** : Historique complet avec raccourcis clavier (Ctrl+Z / Ctrl+Y)
- **Export/Import** : Sauvegarde et restauration de l'état complet (JSON)
- **Persistance automatique** : Zoom et préférences sauvegardés localement

#### Géolocalisation
- **Détection coordonnées GPS** : Automatique avec debouncing, supporte multiples formats
- **Association géocache** : Liaison avec géocache pour coordonnées d'origine
- **Calcul distance** : Automatique avec statut (OK/Warning/Far) selon limite 2 miles
- **Support multi-formats** : DD, DDM, DMS

#### Raccourcis clavier
- `Ctrl+Z` : Annuler
- `Ctrl+Y` / `Ctrl+Shift+Z` : Refaire
- `Backspace` : Supprimer le dernier symbole
- `Ctrl+Backspace` : Tout effacer
- `Ctrl+E` : Exporter l'état
- `Ctrl+I` : Importer un état

### 🚀 Améliorations futures possibles

- Affichage des coordonnées sur carte interactive (Leaflet/OpenLayers)
- Création automatique de waypoints
- Support de formats d'alphabets supplémentaires
- Tests automatisés (Jest + React Testing Library)
- Mode sombre/clair personnalisable
- Raccourcis clavier personnalisables

## Structure du projet

```
theia-extensions/alphabets/
├── src/
│   ├── browser/
│   │   ├── alphabets-contribution.ts        # Contribution principale (commandes, menus)
│   │   ├── alphabets-frontend-module.ts     # Module d'injection de dépendances
│   │   ├── alphabets-list-widget.tsx        # Liste (panel gauche)
│   │   ├── alphabet-viewer-widget.tsx       # Visualisation (panel central)
│   │   ├── font-api.d.ts                    # Types pour Font Loading API
│   │   ├── services/
│   │   │   └── alphabets-service.ts         # Service API backend
│   │   ├── components/
│   │   │   ├── coordinates-detector.tsx     # Détection coordonnées GPS
│   │   │   ├── geocache-association.tsx     # Association géocache
│   │   │   ├── symbol-item.tsx              # Item symbole (drag & drop)
│   │   │   └── symbol-context-menu.tsx      # Menu contextuel symbole
│   │   └── style/
│   │       └── alphabets.css                # Styles CSS
│   └── common/
│       └── alphabet-protocol.ts             # Types TypeScript (Alphabet, ZoomState, etc.)
├── package.json                             # Dépendances et scripts
└── tsconfig.json                            # Configuration TypeScript

gc-backend/
├── alphabets/                               # Répertoire des alphabets
│   ├── albhed/
│   │   ├── alphabet.json                    # Configuration
│   │   └── fonts/albhed.ttf                 # Police TTF
│   ├── alteran/
│   ├── arcadia/
│   └── arciela/
└── gc_backend/blueprints/
    └── alphabets.py                         # API Flask (endpoints)
```

## Utilisation

### 1. Démarrer le backend

```bash
cd gc-backend
python run.py
```

Le serveur démarre sur `http://127.0.0.1:8000`.

### 2. Démarrer Theia

```bash
cd theia-blueprint/applications/browser
yarn start
```

L'application démarre sur `http://localhost:3000`.

### 3. Ouvrir la liste des alphabets

- Menu `View > Alphabets` ou
- Icône "Alphabets" dans le panel gauche

### 4. Utiliser un alphabet

#### Décodage de base
1. **Cliquer** sur un alphabet dans la liste pour l'ouvrir
2. **Construire le message** :
   - Cliquer sur les symboles disponibles pour les ajouter
   - OU saisir directement dans le textarea "Texte décodé"
3. **Réorganiser** : Glisser-déposer les symboles entrés
4. **Éditer** : Clic droit sur un symbole pour le menu contextuel

#### Géolocalisation
1. **Association géocache** : Entrer le code GC dans le champ d'association
2. **Détection automatique** : Les coordonnées sont détectées dans le texte décodé
3. **Calcul distance** : La distance depuis la géocache est calculée automatiquement

#### Fonctionnalités avancées
- **Zoom** : Ajuster le zoom de chaque section indépendamment
- **Épinglage** : Cliquer sur l'épingle 📌 pour fixer une section en haut
- **Undo/Redo** : Utilisez Ctrl+Z / Ctrl+Y pour naviguer dans l'historique
- **Export** : Ctrl+E pour sauvegarder votre progression
- **Import** : Ctrl+I pour restaurer un état sauvegardé

#### Raccourcis utiles
- `Backspace` : Supprimer le dernier symbole
- `Ctrl+Backspace` : Tout effacer
- Les zones épinglées ont leur propre niveau de zoom

## Ajouter un nouvel alphabet

1. Créer un dossier dans `gc-backend/alphabets/mon-alphabet/`
2. Créer `alphabet.json` :

```json
{
  "name": "Mon Alphabet",
  "description": "Description de l'alphabet",
  "type": "font",
  "tags": ["fantasy", "custom"],
  "sources": [
    {
      "type": "author",
      "label": "Auteur",
      "url": "https://example.com"
    }
  ],
  "alphabetConfig": {
    "type": "font",
    "fontFile": "fonts/mon-alphabet.ttf",
    "hasUpperCase": false,
    "characters": {
      "letters": "all",
      "numbers": "all",
      "special": {
        ".": "point",
        " ": "space"
      }
    }
  }
}
```

3. Ajouter la police dans `fonts/mon-alphabet.ttf` (pour type `font`)
4. OU ajouter les images dans `images/` (pour type `images`)
5. Redémarrer le backend
6. Actualiser la liste dans Theia

## Format alphabet.json

### Champs principaux

- `name` : Nom affiché
- `description` : Description courte
- `type` : Type d'alphabet (ex: "fantasy", "sci-fi")
- `tags` : Tableau de tags pour la recherche
- `sources` : Tableau de sources/crédits

### Configuration alphabetConfig

#### Pour alphabet basé sur police

```json
"alphabetConfig": {
  "type": "font",
  "fontFile": "fonts/alphabet.ttf",
  "hasUpperCase": true,
  "characters": {
    "letters": "all",           // ou ["a", "b", "c"...]
    "numbers": "all",           // ou ["0", "1", "2"...]
    "special": {                // Optionnel
      ".": "point",
      " ": "space"
    }
  }
}
```

#### Pour alphabet basé sur images

```json
"alphabetConfig": {
  "type": "images",
  "imageFormat": "png",
  "imageDir": "images",
  "lowercaseSuffix": "lowercase",
  "uppercaseSuffix": "uppercase",
  "hasUpperCase": true,
  "characters": {
    "letters": "all",
    "numbers": "all"
  }
}
```

Les images doivent être nommées : `{caractère}_{suffix}.{format}` (ex: `a_lowercase.png`, `A_uppercase.png`)

## API Backend

### Endpoints disponibles

- `GET /api/alphabets` : Liste tous les alphabets
- `GET /api/alphabets/<id>` : Détails d'un alphabet
- `GET /api/alphabets/<id>/font` : Télécharge la police TTF
- `GET /api/alphabets/<id>/resource/<path>` : Ressource (image)
- `POST /api/alphabets/discover` : Force la redécouverte
- `POST /api/detect_coordinates` : Détecte les coordonnées dans un texte
- `POST /api/calculate_coordinates` : Calcule la distance

### Recherche

La recherche supporte plusieurs critères :

```
GET /api/alphabets?search=braille&search_in_name=true&search_in_tags=true&search_in_readme=true
```

## Développement

### Compiler l'extension

```bash
cd theia-blueprint/theia-extensions/alphabets
yarn build
```

### Compiler toute l'application

```bash
cd theia-blueprint
yarn build
```

### Structure des widgets

- **AlphabetsListWidget** : Liste dans le panel gauche
  - Recherche avec debouncing (500ms)
  - Filtres (nom, tags, README)
  - Clic pour ouvrir un alphabet

- **AlphabetViewerWidget** : Visualisation dans le panel central
  - Barre d'outils : Undo/Redo, Export/Import
  - En-tête avec infos alphabet
  - Association géocache optionnelle
  - Zone épinglée (sticky) : sections épinglées
  - Symboles entrés : drag & drop, menu contextuel, zoom indépendant
  - Texte décodé : bidirectionnel, éditable
  - Détection coordonnées : automatique avec debouncing (1s)
  - Symboles disponibles : par catégorie (lettres, chiffres, spéciaux)
  - Sources et crédits
  - Historique : 50 états max
  - Persistance : localStorage pour zoom et préférences

### Composants

- **SymbolItem** : Composant réutilisable pour symboles
  - Support police et images
  - Drag & drop
  - Menu contextuel
  - Tooltip avec position

- **SymbolContextMenu** : Menu contextuel pour symboles
  - Supprimer
  - Dupliquer
  - Insérer avant/après

- **CoordinatesDetector** : Détection de coordonnées GPS
  - Multiples formats (DD, DDM, DMS)
  - Debouncing pour optimisation
  - Affichage des résultats

- **GeocacheAssociation** : Association avec géocache
  - Chargement des coordonnées d'origine
  - Calcul automatique de distance
  - Statut visuel (OK/Warning/Far)

### Services

- **AlphabetsService** : Communication avec l'API
  - Cache des résultats (5 min)
  - Gestion des polices dynamiques
  - Détection coordonnées (POST /api/detect_coordinates)
  - Calcul distance (POST /api/calculate_coordinates)
  - Gestion des erreurs avec messages utilisateur

## Licence

MIT

