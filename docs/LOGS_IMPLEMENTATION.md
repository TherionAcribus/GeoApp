# Implémentation du système de Logs des Géocaches

Ce document décrit l'implémentation du système d'affichage des logs (commentaires) des géocaches dans l'application GeoApp/Theia.

## Vue d'ensemble

Le système de logs permet de :
- Visualiser les commentaires laissés par les géocacheurs sur une géocache
- Rafraîchir les logs depuis Geocaching.com
- Filtrer les logs par type (Found, Did Not Find, Note, etc.)
- Préparer le terrain pour des fonctionnalités futures (résumé IA, recherche, etc.)

## Architecture

### Backend (Flask)

#### Modèle de données

**Fichier** : `gc-backend/gc_backend/geocaches/models.py`

```python
class GeocacheLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), nullable=False)
    external_id = db.Column(db.String(50))  # ID sur Geocaching.com
    author = db.Column(db.String(255))
    author_guid = db.Column(db.String(100))
    text = db.Column(db.Text)
    date = db.Column(db.DateTime)
    log_type = db.Column(db.String(50))  # Found, Did Not Find, Note, etc.
    is_favorite = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime)
    updated_at = db.Column(db.DateTime)
```

#### Service de récupération des logs

**Fichier** : `gc-backend/gc_backend/services/geocaching_logs.py`

- `GeocachingLogsClient` : Client pour récupérer les logs via l'API Geocaching.com
- Utilise les cookies du navigateur (Firefox, Chrome, Edge) pour l'authentification
- Parse la réponse JSON et nettoie le texte HTML

#### Routes API

**Fichier** : `gc-backend/gc_backend/blueprints/logs.py`

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/geocaches/<id>/logs` | GET | Récupère les logs stockés (avec pagination) |
| `/api/geocaches/<id>/logs/refresh` | POST | Rafraîchit les logs depuis Geocaching.com |
| `/api/geocaches/<id>/logs/types` | GET | Liste les types de logs avec leur compte |
| `/api/geocaches/<id>/logs` | DELETE | Supprime tous les logs d'une géocache |

**Paramètres de requête** :
- `limit` : Nombre de logs à retourner (défaut: 50)
- `offset` : Offset pour la pagination (défaut: 0)
- `type` : Filtrer par type de log
- `count` : Nombre de logs à récupérer lors du refresh (défaut: 25)

### Frontend (Theia/React)

#### Widget des logs

**Fichier** : `theia-extensions/zones/src/browser/geocache-logs-widget.tsx`

- `GeocacheLogsWidget` : Widget React affichant les logs
- Peut être affiché dans le panneau droit (`right`), en bas (`bottom`) ou dans la zone principale (`main`)
- Composants internes :
  - `LogItem` : Affiche un seul log avec code couleur
  - `LogsList` : Liste paginée des logs

**Code couleur par type** :
- 🟢 **Found** : Vert
- 🔴 **Did Not Find** : Rouge
- 🔵 **Note** : Bleu
- 🟠 **Owner Maintenance** : Orange
- 🟣 **Reviewer Note** : Violet
- ⚫ **Disabled/Archived** : Gris

#### Intégration

**Fichier** : `theia-extensions/zones/src/browser/zones-frontend-contribution.ts`

- Écoute l'événement `open-geocache-logs` pour ouvrir le widget
- Affiche le widget dans le panneau droit par défaut

**Fichier** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

- Bouton "💬 Logs" ajouté dans l'en-tête des détails
- Émet l'événement `open-geocache-logs` au clic

## Utilisation

### Ouvrir les logs d'une géocache

1. Ouvrir les détails d'une géocache
2. Cliquer sur le bouton "💬 Logs" dans l'en-tête
3. Le widget des logs s'ouvre dans le panneau droit

### Rafraîchir les logs

1. Dans le widget des logs, cliquer sur "Rafraîchir"
2. Les logs sont récupérés depuis Geocaching.com
3. Les nouveaux logs sont ajoutés, les existants sont mis à jour

### Événement JavaScript

Pour ouvrir les logs programmatiquement :

```javascript
window.dispatchEvent(new CustomEvent('open-geocache-logs', {
    detail: {
        geocacheId: 123,
        gcCode: 'GC12345',
        name: 'Ma géocache'
    }
}));
```

## Normalisation des types de logs

Le système normalise automatiquement les types de logs :

| Type original | Type normalisé |
|---------------|----------------|
| `found it`, `Found It` | `Found` |
| `didn't find it`, `DNF` | `Did Not Find` |
| `write note` | `Note` |
| `webcam photo taken` | `Webcam` |
| `owner maintenance` | `Owner Maintenance` |
| `reviewer note` | `Reviewer Note` |

## Améliorations futures

1. **Filtrage** : Filtrer les logs par type, auteur, date
2. **Résumé IA** : Générer un résumé des logs avec l'IA
3. **Recherche** : Rechercher dans le texte des logs
4. **Chargement automatique** : Charger les logs lors de l'ajout d'une géocache
5. **Pagination infinie** : Scroll infini pour charger plus de logs
6. **Export** : Exporter les logs en CSV/JSON

## Fichiers créés/modifiés

### Nouveaux fichiers
- `gc-backend/gc_backend/services/geocaching_logs.py`
- `gc-backend/gc_backend/blueprints/logs.py`
- `theia-extensions/zones/src/browser/geocache-logs-widget.tsx`

### Fichiers modifiés
- `gc-backend/gc_backend/geocaches/models.py` (ajout GeocacheLog)
- `gc-backend/gc_backend/database.py` (import GeocacheLog)
- `gc-backend/gc_backend/__init__.py` (enregistrement blueprint logs)
- `theia-extensions/zones/src/browser/zones-frontend-module.ts` (enregistrement widget)
- `theia-extensions/zones/src/browser/zones-frontend-contribution.ts` (écouteur événement)
- `theia-extensions/zones/src/browser/geocache-details-widget.tsx` (bouton Logs)
