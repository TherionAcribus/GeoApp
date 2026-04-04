# Analyse de page GeoApp

Ce document décrit l'architecture et le fonctionnement du système d'analyse de page intégré à GeoApp, qui permet d'analyser automatiquement les descriptions de géocaches pour y détecter des éléments cachés, des coordonnées, des waypoints et autres indices utiles.

## Vue d'ensemble

Le système d'analyse de page est un ensemble modulaire de plugins Python exécutés côté backend qui analysent le contenu HTML des descriptions de géocaches. Il peut être déclenché depuis l'interface Theia via un bouton dédié dans la vue détails d'une géocache.

### Fonctionnalités principales

- **Détection automatique** : coordonnées GPS, textes camouflés, commentaires HTML
- **Extraction de waypoints** : analyse des tables HTML et des waypoints fournis
- **Architecture modulaire** : plugins indépendants et extensibles
- **Intégration transparente** : résultats directement utilisables dans l'interface
- **Exécution automatique** : analyse complète en un clic depuis la vue géocache

## Architecture du système

### Composants principaux

#### 1. Plugin Meta `analysis_web_page`

**Emplacement** : `gc-backend/plugins/official/analysis_web_page/`

Le plugin principal orchestre l'exécution des autres plugins d'analyse selon un pipeline défini dans `plugin.json`. Il :
- Récupère le contenu HTML de la géocache depuis la base de données
- Exécute séquentiellement les sous-plugins configurés
- Agrège et normalise les résultats
- Passe les waypoints de la géocache aux plugins qui en ont besoin

**Configuration pipeline** :
```json
{
  "plugin_name": "coordinates_finder",
  "description": "Recherche de coordonnées GPS dans le texte"
},
{
  "plugin_name": "color_text_detector",
  "description": "Recherche de texte invisible (couleur = fond)"
},
{
  "plugin_name": "formula_parser",
  "description": "Recherche de formules mathématiques"
}
```

#### 2. Plugins d'analyse spécialisés

**Emplacement** : `gc-backend/plugins/official/*/`

Chaque plugin hérite d'une classe de base et implémente une méthode `execute()` qui reçoit :
- `inputs['text']` : contenu HTML à analyser
- `inputs['geocache_id']` : ID de la géocache (optionnel)
- `inputs['waypoints']` : liste des waypoints associés (optionnel)

**Plugins disponibles** :
- `coordinates_finder` : Détection de coordonnées GPS dans le texte
- `color_text_detector` : Recherche de textes camouflés (blanc sur blanc, etc.)
- `html_comments_finder` : Extraction des commentaires HTML
- `image_alt_text_extractor` : Récupération des textes alternatifs des images
- `additional_waypoints_analyzer` : Analyse des waypoints additionnels
- `formula_parser` : Détection de formules mathématiques (hérité de l'ancien système)

#### 3. Interface Theia

**Emplacement** : `theia-blueprint/theia-extensions/`

- **Widget GeocacheDetails** : Affiche les boutons d'analyse dans la vue géocache
- **Widget PluginExecutor** : Interface d'exécution avec pré-remplissage automatique
- **Contribution PluginExecutor** : Gestion de l'ouverture des widgets

**Boutons disponibles** :
- **🔍 Analyse Page** : Lance automatiquement `analysis_web_page` avec exécution immédiate
- **🔌 Analyser avec plugins** : Ouvre le sélecteur de plugins pour analyse manuelle

### Flux d'exécution

1. **Déclenchement** : Clic sur "🔍 Analyse Page" dans GeocacheDetailsWidget
2. **Préparation** : Création du contexte géocache (description HTML + waypoints)
3. **Ouverture widget** : PluginExecutorWidget s'ouvre avec `analysis_web_page` pré-sélectionné
4. **Chargement** : Récupération des détails du plugin meta
5. **Pré-remplissage** : Injection automatique des données géocache
6. **Exécution automatique** : Lancement immédiat du pipeline d'analyse
7. **Sous-exécutions** : Chaque sous-plugin traite le contenu séquentiellement
8. **Agrégation** : Combinaison des résultats dans `analysis_web_page`
9. **Affichage** : Résultats présentés avec options d'actions (ajouter waypoints, etc.)

## Utilisation en tant que développeur

### Exécution manuelle depuis le backend

```bash
# Test du plugin meta
curl -X POST http://127.0.0.1:8000/api/plugins/analysis_web_page/execute \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "geocache_id": "GCAJ7CA",
      "text": "<p>Description HTML...</p>",
      "waypoints": [...]
    }
  }'
```

### Test d'un plugin individuel

```bash
# Test du détecteur de coordonnées
curl -X POST http://127.0.0.1:8000/api/plugins/coordinates_finder/execute \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "text": "Coordonnées: N 48° 51.402 E 002° 21.048"
    }
  }'
```

### Debug des résultats

Les logs détaillés sont disponibles dans :
- **Backend** : Logs Flask avec niveaux DEBUG pour `analysis_web_page`
- **Frontend** : Console du navigateur avec préfixe `[Plugin Executor]`

## Extension du système

### Création d'un nouveau plugin d'analyse

1. **Structure du dossier** :
   ```
   gc-backend/plugins/official/mon_plugin/
   ├── plugin.json    # Configuration
   ├── main.py        # Logique d'analyse
   └── README.md      # Documentation (optionnel)
   ```

2. **plugin.json** :
   ```json
   {
     "name": "mon_plugin",
     "description": "Description de mon analyse",
     "plugin_type": "python",
     "input_types": {
       "text": {
         "type": "textarea",
         "label": "Texte à analyser",
         "required": true
       }
     },
     "output_types": {
       "results": {
         "type": "array",
         "label": "Résultats de l'analyse"
       }
     }
   }
   ```

3. **main.py** :
   ```python
   from typing import Dict, Any, List
   import logging
   from bs4 import BeautifulSoup

   logger = logging.getLogger(__name__)

   class MonPluginPlugin:
       def __init__(self):
           self.name = "mon_plugin"
           self.description = "Analyse spécialisée"

       def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
           html_content = inputs.get('text', '')
           logger.info(f"Analyse de {len(html_content)} caractères")

           results = []
           # Logique d'analyse...

           return {
               "status": "success",
               "summary": f"{len(results)} éléments trouvés",
               "results": results
           }

   plugin = MonPluginPlugin()

   def execute(inputs):
       return plugin.execute(inputs)
   ```

4. **Ajout au pipeline** :

   Modifier `gc-backend/plugins/official/analysis_web_page/plugin.json` :
   ```json
   "pipeline": [
     // ... plugins existants ...
     {
       "plugin_name": "mon_plugin",
       "description": "Description de mon analyse"
     }
   ]
   ```

5. **Rechargement** :
   ```bash
   # Forcer le rechargement du plugin meta
   curl -X POST http://127.0.0.1:8000/api/plugins/analysis_web_page/reload

   # Redécouvrir tous les plugins
   curl -X POST http://127.0.0.1:8000/api/plugins/discover
   ```

### Modification du pipeline d'analyse

Le pipeline est défini dans `plugin.json` et peut être modifié dynamiquement. L'ordre d'exécution est important car certains plugins peuvent dépendre des résultats des précédents.

### Gestion des waypoints

Les waypoints sont automatiquement passés au plugin `additional_waypoints_analyzer`. Si un nouveau plugin doit traiter les waypoints, ajouter dans `analysis_web_page/main.py` :

```python
if plugin_name == "mon_plugin_waypoints":
    plugin_inputs["waypoints"] = waypoints_input
```

## Format des résultats

Chaque plugin retourne un dictionnaire standardisé :

```python
{
  "status": "success" | "error",
  "summary": "Description textuelle des résultats",
  "results": [
    {
      "id": "identifiant_unique",
      "text_output": "Texte affiché dans l'interface",
      "coordinates": {
        "formatted": "N 48° 51.402 E 002° 21.048",
        "latitude": 48.85696667,
        "longitude": 2.3613
      },
      "confidence": 0.85,  // 0.0 à 1.0
      "metadata": {        // Données additionnelles
        "source": "html_table",
        "type": "waypoint"
      }
    }
  ]
}
```

### Intégration frontend

Les résultats sont automatiquement affichés dans PluginExecutorWidget avec :
- **Actions disponibles** : Ajouter comme waypoint, copier coordonnées
- **Tri par confiance** : Les résultats les plus fiables en premier
- **Détection automatique** : Recherche de coordonnées dans les résultats

## Dépannage

### Plugin non visible dans l'interface

1. **Vérifier la validation** : Erreurs dans `plugin.json`
   ```bash
   curl http://127.0.0.1:8000/api/plugins/status
   ```

2. **Redécouvrir les plugins** :
   ```bash
   curl -X POST http://127.0.0.1:8000/api/plugins/discover
   ```

3. **Vérifier les logs backend** : Recherche d'erreurs de validation JSON Schema

### Analyse ne trouve rien

1. **Vérifier les inputs** : Description HTML présente et waypoints fournis
2. **Logs détaillés** : Activer DEBUG dans le backend
3. **Test individuel** : Tester chaque plugin séparément

### Erreur lors de l'exécution

1. **Dépendances manquantes** : Vérifier `requirements.txt`
2. **Timeout** : Augmenter `geoApp.plugins.executor.timeoutSec`
3. **Mémoire** : Plugins lourds peuvent nécessiter plus de ressources

### Exécution automatique ne fonctionne pas

1. **Plugin non chargé** : Vérifier que `analysis_web_page` est valide
2. **Délai insuffisant** : Le délai de 500ms peut être augmenté si nécessaire
3. **État du widget** : Vérifier que tous les champs sont pré-remplis

## Métriques et performances

- **Temps d'exécution typique** : 2-5 secondes pour une analyse complète
- **Plugins les plus coûteux** : `coordinates_finder`, `color_text_detector`
- **Cache** : PluginManager garde les plugins chargés en mémoire
- **Timeout par défaut** : 60 secondes (configurable)

## Évolution future

- **Plugin de détection QR code** : Nécessite `pyzbar` et `opencv-python`
- **Analyse d'images** : Détection de stéganographie, OCR
- **Machine learning** : Classification automatique des énigmes
- **Plugins communautaires** : Système de plugins externes validés

