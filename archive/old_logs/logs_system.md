# Système de Logs dans MysteryAI

Ce document décrit le système permettant d'afficher et de rafraîchir les logs des géocaches depuis Geocaching.com.

## Vue d'ensemble

Le système de logs permet de visualiser les commentaires laissés par d'autres géocacheurs sur une géocache et de rafraîchir ces logs en récupérant les données directement depuis Geocaching.com à l'aide des cookies de Firefox.

## Composants du système

### 1. Modèles de données

Les logs sont stockés dans la base de données à l'aide des modèles suivants :

- `Log` : Représente un commentaire laissé sur une géocache
- `Owner` : Représente l'auteur d'un log

#### Structure du modèle Log

```python
class Log(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('owner.id'), nullable=False)
    text = db.Column(db.Text)
    date = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    log_type = db.Column(db.String(50))  # Found it, Write Note, Didn't Find it, etc.
    favorite = db.Column(db.Boolean, default=False)  # Pour les logs "favoris"
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relations
    geocache = db.relationship('Geocache', back_populates='logs')
    author = db.relationship('Owner', back_populates='logs')
```

### 2. API pour Geocaching.com

La classe `GeocachingLogs` dans `geocaching_client.py` sert à récupérer les logs depuis Geocaching.com :

```python
class GeocachingLogs:
    """Classe pour gérer les logs des geocaches"""
    
    def __init__(self, client):
        self.client = client
    
    def get_logs(self, geocode, log_type="ALL", count=10):
        """
        Récupère les logs d'un geocache
        
        Args:
            geocode (str): Code du geocache (ex: GC12345)
            log_type (str): Type de logs à récupérer (ALL, FRIENDS, OWN)
            count (int): Nombre de logs à récupérer
            
        Returns:
            list: Liste des logs récupérés
        """
        # ... implémentation ...
```

Cette classe utilise le client `GeocachingClient` qui gère l'authentification via les cookies de Firefox.

### 3. Routes et contrôleurs

#### Routes API

Les routes liées aux logs se trouvent dans `app/routes/logs.py` :

- `/api/logs/logs_panel?geocacheId=<id>` (GET) : Affiche le panneau des logs pour une géocache
- `/api/logs/refresh?geocacheId=<id>` (POST) : Rafraîchit les logs en récupérant les données depuis Geocaching.com

#### Interface utilisateur

Le panneau des logs est rendu dans le template `templates/logs_panel.html`. Il contient :

- Un affichage des logs existants
- Un bouton pour rafraîchir les logs depuis Geocaching.com

## Fonctionnement du rafraîchissement des logs

1. L'utilisateur clique sur le bouton "Rafraîchir"
2. HTMX envoie une requête POST à `/api/logs/refresh` avec l'ID de la géocache
3. Le serveur utilise `GeocachingClient` et `GeocachingLogs` pour récupérer les logs depuis Geocaching.com
4. Les logs sont enregistrés/mis à jour dans la base de données
5. Le template `logs_panel.html` est rendu avec les logs mis à jour et retourné
6. HTMX remplace le contenu du panneau avec la réponse

## Normalisation des types de logs

Le système utilise une normalisation des types de logs pour assurer la cohérence entre les différentes sources (API Geocaching, importation GPX, etc.).

### Types de logs normalisés

| Type original | Type normalisé |
|---------------|----------------|
| found it, Found It | Found |
| didn't find it, DNF | Did Not Find |
| write note | Note |
| webcam photo taken | Webcam |
| *autres* | Première lettre en majuscule |

### Implémentation de la normalisation

La normalisation est implémentée via une fonction `normalize_log_type` qui est appelée lors :
- De la récupération des logs depuis l'API Geocaching
- De l'importation des logs depuis les fichiers GPX
- Du rafraîchissement des logs via le bouton "Rafraîchir"

```python
def normalize_log_type(log_type):
    """Normalise le type de log pour avoir une cohérence dans la base de données"""
    if not log_type:
        return "Other"
    
    if log_type.lower() == "found it":
        return "Found"
    elif log_type.lower() == "didn't find it":
        return "Did Not Find"
    elif log_type.lower() == "write note":
        return "Note"
    elif log_type.lower() == "webcam photo taken":
        return "Webcam"
    else:
        return log_type.capitalize()
```

Le template d'affichage des logs prend en compte les différentes possibilités pour assurer une rétrocompatibilité avec les logs existants.

## Implémentation technique

### Affichage des logs

Le panneau des logs utilise HTMX pour charger et afficher les logs d'une géocache. Le panneau est chargé automatiquement lorsqu'une géocache est sélectionnée, via l'événement `geocacheSelected`.

```javascript
document.addEventListener('geocacheSelected', function(event) {
    const geocacheId = event.detail.geocacheId;
    
    // Charger les logs
    htmx.ajax('GET', `/api/logs/logs_panel?geocacheId=${geocacheId}`, {
        target: '#logs-panel',
        swap: 'innerHTML'
    });
});
```

### Rafraîchissement des logs

Le bouton de rafraîchissement est implémenté directement avec HTMX :

```html
<button 
    id="refresh-logs-btn" 
    class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center"
    hx-post="/api/logs/refresh?geocacheId={{ geocache_id }}"
    hx-target="#logs-panel"
    hx-swap="innerHTML"
    hx-indicator="#loading-indicator">
    <i class="fas fa-sync-alt mr-1"></i> Rafraîchir
</button>
```

## Stockage et mise à jour des logs

Lors du rafraîchissement, le système :

1. Récupère les logs depuis Geocaching.com
2. Pour chaque log :
   - Vérifie s'il existe déjà en base de données (par son ID)
   - S'il existe, met à jour les champs
   - S'il n'existe pas, crée un nouveau log
   - S'assure que l'auteur du log existe, ou le crée

## Interface graphique

Les logs sont présentés dans une liste, avec un code couleur selon leur type :
- **Vert** : "Found" (cache trouvée)
- **Rouge** : "Did Not Find" (cache non trouvée)
- **Bleu** : "Note" (note)

Chaque log affiche :
- L'auteur du log
- La date du log
- Le type de log
- Le texte du log

## Limitations et améliorations futures

Certaines améliorations possibles pour le système de logs :

1. Ajouter le support pour les images incluses dans les logs
2. Ajouter la possibilité de voir uniquement certains types de logs (filtrage)
3. Implémenter la possibilité de poster des logs directement depuis l'application
4. Ajouter une pagination pour les caches avec beaucoup de logs
5. Ajouter la possibilité de voir les logs de ses amis uniquement 