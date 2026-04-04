# Envoi des coordonnées corrigées vers Geocaching.com

## Vue d'ensemble

GeoApp permet d'envoyer des coordonnées résolues/corrigées directement sur Geocaching.com, évitant ainsi de devoir ouvrir le site dans un navigateur. Cette fonctionnalité est disponible :

1. **Depuis la page de la géocache** — bouton "📡 Envoyer vers GC.com" (visible uniquement si des coordonnées corrigées existent)
2. **Depuis les Actions d'un waypoint** — bouton 📡 dans la colonne Actions du tableau des waypoints

## Prérequis

- Être connecté à Geocaching.com via le module d'authentification GeoApp (voir `AUTHENTIFICATION_GEOCACHING.md`)
- Avoir des coordonnées corrigées enregistrées dans l'app (pour l'envoi depuis la géocache)
- Le waypoint doit avoir des coordonnées valides (latitude/longitude renseignées)

## Architecture

### Backend

#### Service : `gc_backend/services/geocaching_push_coordinates.py`

Classe `GeocachingPushCoordinatesClient` :

```python
from gc_backend.services.geocaching_push_coordinates import GeocachingPushCoordinatesClient

client = GeocachingPushCoordinatesClient()

# Envoyer des coordonnées corrigées
result = client.push_corrected_coordinates(gc_code="GC12345", latitude=48.123456, longitude=2.345678)
# → {'ok': True}

# Supprimer les coordonnées corrigées sur GC.com
result = client.delete_corrected_coordinates(gc_code="GC12345")
# → {'ok': True}
```

Le client utilise automatiquement la session du `GeocachingAuthService` centralisé.

#### API Geocaching.com utilisée

Même approche que **c:geo** (`GCParser.editModifiedCoordinates`) — l'API REST `/api/live/v1/` retourne un 302 pour les coordonnées corrigées.

| Opération | Méthode | URL |
|-----------|---------|-----|
| Définir coordonnées corrigées | `POST` | `https://www.geocaching.com/seek/cache_details.aspx/SetUserCoordinate` |
| Supprimer coordonnées corrigées | `POST` | `https://www.geocaching.com/seek/cache_details.aspx/ResetUserCoordinate` |

**Étape préalable :** extraction du `userToken` depuis le HTML de la page `https://www.geocaching.com/geocache/{gcCode}` avec le pattern `userToken\s*=\s*'([^']+)'` (identique à `GCConstants.PATTERN_USERTOKEN` dans c:geo).

Corps JSON pour `SetUserCoordinate` :
```json
{
  "dto": {
    "ut": "<userToken>",
    "data": { "lat": 48.123456, "lng": 2.345678 }
  }
}
```

Corps JSON pour `ResetUserCoordinate` :
```json
{
  "dto": { "ut": "<userToken>" }
}
```

#### Endpoints Flask

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/geocaches/<id>/push-corrected-coordinates` | `POST` | Envoie les coords corrigées de la géocache |
| `/api/geocaches/<id>/waypoints/<wp_id>/push-coordinates` | `POST` | Envoie les coords d'un waypoint comme coords corrigées |
| `/api/geocaches/<id>/push-corrected-coordinates` | `DELETE` | Supprime les coords corrigées sur GC.com |

**Codes de retour :**
- `200` — succès
- `400` — pas de coordonnées corrigées / code GC manquant
- `401` — non connecté à Geocaching.com
- `404` — géocache ou waypoint introuvable
- `502` — l'API Geocaching.com a renvoyé une erreur

### Frontend (Theia)

#### `CoordinatesEditor` dans `geocache-details-widget.tsx`

Bouton "📡 Envoyer vers GC.com" ajouté à côté du bouton "Modifier" :
- Visible uniquement si `isCorrected === true`
- Désactivé pendant l'envoi (indicateur ⏳)
- Appelle `POST /api/geocaches/<id>/push-corrected-coordinates`
- Messages d'erreur clairs selon le code HTTP (401, 502...)

#### `WaypointsEditorWithRef` — Actions des waypoints

Bouton 📡 ajouté dans la colonne Actions du tableau (après 📍, avant 🗑️) :
- Désactivé si le waypoint n'a pas de coordonnées (`latitude` null)
- Déclenche `pushWaypointToGeocaching(waypointId, waypointName)` sur le widget parent
- Confirmation via dialog avant l'envoi
- Appelle `POST /api/geocaches/<id>/waypoints/<wp_id>/push-coordinates`

#### Flux de données

```
Bouton 📡 (React)
  → onPushWaypointToGeocaching (prop callback)
    → GeocacheDetailsWidget.pushWaypointToGeocaching()
      → ConfirmDialog
        → POST /api/geocaches/{id}/waypoints/{wp_id}/push-coordinates
          → GeocachingPushCoordinatesClient.push_corrected_coordinates()
            → PUT https://www.geocaching.com/api/live/v1/geocaches/{gc}/correctedcoordinates
```

## Utilisation

### Depuis la page géocache (coordonnées corrigées)

1. Corriger les coordonnées de la géocache (bouton "Corriger les coordonnées")
2. Le bouton "📡 Envoyer vers GC.com" apparaît à côté de "Modifier"
3. Cliquer → les coordonnées corrigées sont envoyées à Geocaching.com instantanément

### Depuis un waypoint

1. Créer ou modifier un waypoint avec des coordonnées valides
2. Dans la colonne Actions, cliquer sur 📡
3. Une boîte de confirmation s'affiche avec le nom du waypoint et le code GC
4. Confirmer → les coordonnées du waypoint sont définies comme coordonnées corrigées sur Geocaching.com

## Ajout dans d'autres endroits de l'app

Pour intégrer cette fonctionnalité ailleurs (ex: carte, table des géocaches, formula solver) :

### Frontend

```typescript
const pushToGeocaching = async (geocacheId: number, lat: number, lon: number) => {
    const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/push-corrected-coordinates`, {
        method: 'POST',
        credentials: 'include'
    });
    const json = await res.json();
    if (!res.ok) {
        // Gérer 401 (non connecté), 400 (pas de coords corrigées), 502 (erreur GC.com)
        console.error(json.error);
    }
};
```

### Backend (Python)

```python
from gc_backend.services.geocaching_push_coordinates import GeocachingPushCoordinatesClient
from gc_backend.services.geocaching_auth import get_auth_service

auth_service = get_auth_service()
if not auth_service.is_logged_in():
    # Informer l'utilisateur de se connecter
    ...

client = GeocachingPushCoordinatesClient()
result = client.push_corrected_coordinates(gc_code, latitude, longitude)
if result.get('ok'):
    # Succès
    ...
```

## Gestion des erreurs

| Erreur | Cause probable | Solution |
|--------|---------------|----------|
| `401 Non connecté` | Session Geocaching.com expirée ou non configurée | Re-connecter via GeoApp Auth |
| `400 Aucune coordonnée corrigée` | La géocache n'a pas de coords corrigées | Corriger d'abord les coordonnées dans GeoApp |
| `502 Erreur API GC.com` | Geocaching.com a rejeté la requête | Vérifier le statut GC.com, réessayer |
| `400 Waypoint sans coordonnées` | Le waypoint n'a pas de lat/lon | Sauvegarder le waypoint avec des coordonnées valides |

## Notes importantes

1. **Pas de double sauvegarde** : cette action envoie directement les coordonnées à Geocaching.com sans modifier la base locale. Les coordonnées doivent d'abord être sauvegardées localement (ce qui est déjà le cas via l'éditeur de coordonnées).

2. **Compte Premium** : certaines fonctionnalités de Geocaching.com (ex: corrected coordinates) peuvent nécessiter un compte Premium.

3. **Idempotence** : appeler l'endpoint plusieurs fois avec les mêmes coordonnées est sans danger — Geocaching.com met simplement à jour la valeur.

4. **Annulation** : Pour supprimer les coordonnées corrigées sur GC.com (et revenir aux coordonnées originales), utiliser `DELETE /api/geocaches/<id>/push-corrected-coordinates`. Cette action n'est pas encore exposée dans l'interface utilisateur mais est disponible via l'API.
