# Analyseur de Géocaches

L'analyseur de géocaches est un système de plugins intégré à MysteryAI qui permet d'analyser automatiquement le contenu d'une page de géocache pour en extraire des informations pertinentes.

## Architecture

### Composants Principaux

1. **Interface Utilisateur**
   - Bouton "Analyser" dans la page de détails de la géocache
   - Interface de plugin avec affichage des résultats
   - Support pour analyses multiples en parallèle

2. **Système de Plugins**
   - Plugin principal : `analysis_web_page`
   - Configuration via `plugin.json`
   - Exécution automatique avec l'ID de la géocache

3. **Analyseurs Spécialisés**
   - Détecteur de coordonnées (`coordinates_finder`)
   - Analyseur de formules (`formula_parser`)
   - Détecteur de textes invisibles (`color_text_detector`)
   - Détecteur de commentaires HTML (`html_comments_finder`)
   - Analyseur de textes d'images (`image_alt_text_extractor`)
   - Analyseur de points de passage (`additional_waypoints_analyzer`)

## Fonctionnalités

### 1. Détection de Coordonnées
- Recherche de coordonnées dans le texte brut
- Support de différents formats de coordonnées
- Analyse des formules mathématiques pour extraire des coordonnées

### 2. Analyse des Textes Cachés
- Détection de textes en couleur invisible
- Extraction des commentaires HTML
- Analyse des attributs alt et title des images

### 3. Points de Passage
- Analyse des waypoints additionnels
- Extraction des coordonnées des points de passage
- Identification des préfixes et noms

## Interface Utilisateur

### Affichage des Résultats
Les résultats sont organisés en sections distinctes :

1. **Coordonnées Détectées**
   - Texte original
   - Coordonnées extraites (latitude, longitude)

2. **Textes Intéressants**
   - 🎨 Textes invisibles
   - 💬 Commentaires HTML
   - 🖼️ Textes d'images

3. **Points de Passage**
   - Nom du point
   - Préfixe
   - Coordonnées

4. **Analyseurs sans Résultats**
   - Liste des analyseurs n'ayant rien trouvé
   - Aide à comprendre ce qui a été vérifié

## Intégration Technique

### Frontend
```javascript
// Déclenchement de l'analyse
function openAnalysis(geocacheId, gcCode) {
    openPluginTab('analysis_web_page', {
        geocacheId: geocacheId
    });
}
```

### Backend
```python
# Exécution du plugin
def execute(self, inputs):
    geocache_id = inputs.get('geocache_id')
    geocache = db.session.query(Geocache).get(geocache_id)
    # Analyse de la page...
    return {
        'combined_results': {
            'coordinates_finder': [...],
            'color_text_detector': {...},
            # ...
        }
    }
```

## Utilisation

1. **Lancement d'une Analyse**
   - Ouvrir la page de détails d'une géocache
   - Cliquer sur le bouton "Analyser"
   - L'analyse se lance automatiquement

2. **Interprétation des Résultats**
   - Les coordonnées détectées sont affichées en premier
   - Les textes intéressants sont regroupés par type
   - Les points de passage sont listés avec leurs détails
   - La liste des analyseurs sans résultats permet de voir ce qui a été vérifié

3. **Analyses Multiples**
   - Possibilité d'analyser plusieurs géocaches en parallèle
   - Chaque analyse a son propre onglet
   - Les résultats sont indépendants

## Maintenance et Évolution

### Ajout d'un Nouvel Analyseur
1. Créer une nouvelle classe d'analyseur
2. Implémenter la méthode `analyze`
3. Ajouter l'analyseur à la liste des analyseurs dans le plugin principal
4. Mettre à jour l'affichage des résultats dans `plugins.py`

### Debugging
- Les erreurs sont capturées et affichées dans l'interface
- Les logs détaillés sont disponibles côté serveur
- Chaque analyseur peut avoir ses propres messages de debug

## Bonnes Pratiques

1. **Performance**
   - Les analyses sont asynchrones
   - Support des analyses multiples
   - Optimisation du chargement des pages

2. **Maintenance**
   - Code modulaire avec analyseurs séparés
   - Documentation des formats de résultats
   - Tests unitaires pour chaque analyseur

3. **Interface Utilisateur**
   - Design responsive
   - Retours visuels clairs
   - Messages d'erreur explicites
