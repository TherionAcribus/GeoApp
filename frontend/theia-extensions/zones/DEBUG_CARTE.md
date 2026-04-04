# 🔍 Guide de Debug - Carte sans points

## 📋 Logs ajoutés

J'ai ajouté des logs de debug à tous les niveaux pour identifier où les données sont perdues :

1. **ZoneGeocachesWidget** - Vérifie si les données sont chargées
2. **MapService** - Vérifie si les données sont transmises
3. **MapView** - Vérifie si l'événement est reçu
4. **MapLayerManager** - Vérifie si les features sont créées et ajoutées

## 🧪 Marche à suivre pour débugger

### Étape 1 : Ouvrir la console développeur

1. Dans Theia, ouvrir **Outils de développement** (F12 ou Ctrl+Shift+I)
2. Aller dans l'onglet **Console**

### Étape 2 : Ouvrir une zone avec des géocaches

1. Ouvrir une zone dans Theia
2. Observer les logs dans la console

### Étape 3 : Analyser les logs

Vous devriez voir cette séquence de logs :

```
[ZoneGeocachesWidget] load -> rows: X
[ZoneGeocachesWidget] Géocaches avec coordonnées: Y / X
[ZoneGeocachesWidget] Première géocache: {...}
[ZoneGeocachesWidget] Envoi à la carte: Y géocaches
[ZoneGeocachesWidget] Données envoyées: {...}
[MapService] loadGeocaches appelé avec: Y géocaches
[MapService] Première géocache: {...}
[MapService] Event onDidLoadGeocaches émis
[MapView] Event onDidLoadGeocaches reçu avec: Y géocaches
[MapView] mapInstanceRef.current: true
[MapView] layerManagerRef.current: true
[MapView] Effacement des géocaches existantes
[MapView] Ajout de Y géocaches à la carte
[MapLayerManager] addGeocaches appelé avec: Y géocaches
[MapLayerManager] Géocache GCxxxxx: lon=X, lat=Y -> coord= [...]
[MapLayerManager] Features créées: Y
[MapLayerManager] Features ajoutées à la source vectorielle
[MapLayerManager] Nombre total de features dans la source: Y
[MapView] Coordonnées calculées: Y
[MapView] Extent: [...]
[MapView] Vue ajustée aux géocaches
```

## 🔍 Diagnostic selon les logs

### Cas 1 : Aucun log

**Problème** : Le code ne s'exécute pas du tout
**Solution** : 
- Vérifier que le build a réussi
- Relancer Theia
- Vider le cache du navigateur (Ctrl+Shift+R)

### Cas 2 : Logs s'arrêtent à "Géocaches avec coordonnées: 0 / X"

**Problème** : Aucune géocache n'a de coordonnées
**Solution** :
- Vérifier que les géocaches ont latitude/longitude dans la base de données
- Vérifier que le backend retourne bien `latitude` et `longitude`

### Cas 3 : Logs s'arrêtent à "Event onDidLoadGeocaches émis"

**Problème** : Le MapView n'est pas initialisé ou n'écoute pas
**Solutions** :
- Vérifier que la carte est bien ouverte (onglet "GeoApp - Carte" en bas)
- Ouvrir la carte AVANT d'ouvrir la zone
- Relancer Theia

### Cas 4 : Logs montrent "mapInstanceRef.current: false" ou "layerManagerRef.current: false"

**Problème** : La carte n'est pas initialisée
**Solutions** :
- Attendre quelques secondes après l'ouverture de la carte
- Vérifier qu'il n'y a pas d'erreur dans la console lors de l'ouverture de la carte
- Recharger la page

### Cas 5 : Tous les logs OK mais pas de points visibles

**Problèmes possibles** :
1. **Coordonnées hors de la vue actuelle** → Zoomer/dézoomer, regarder les coordonnées dans les logs
2. **Style non appliqué** → Vérifier les erreurs de chargement du sprite
3. **Layer non visible** → Problème de z-index ou d'opacité

## 🐛 Autres vérifications

### Vérifier le backend

Tester l'API directement :
```bash
curl http://localhost:5001/api/zones/1/geocaches
```

Vérifier que les géocaches ont bien `latitude`, `longitude`, `is_corrected`, `original_latitude`, `original_longitude`, et `waypoints[]`.

### Vérifier le sprite d'icônes

Dans la console, vérifier :
```javascript
// Dans la console développeur
console.log(GEOCACHE_SPRITE_CONFIG);
```

Le sprite doit avoir une URL base64 valide.

### Vérifier les couches OpenLayers

Dans la console développeur :
```javascript
// Obtenir la carte
const map = document.querySelector('.ol-viewport')?.__proto__;

// Vérifier les couches (à adapter selon la structure)
```

## 📝 Informations à fournir

Si le problème persiste, merci de me fournir :

1. **Capture d'écran de la console** avec tous les logs
2. **Une géocache exemple** (copier/coller le JSON d'une géocache depuis les logs)
3. **Réponse du backend** pour `/api/zones/{id}/geocaches`
4. **Erreurs éventuelles** dans la console

## 🎯 Test rapide

Pour tester rapidement si le problème vient des données :

1. Ouvrir la console développeur
2. Coller ce code :
```javascript
// Vérifier si le service carte existe
const mapService = window['mapService'] || null;
console.log('MapService:', mapService);

// Charger des points de test
if (mapService) {
    mapService.loadGeocaches([{
        id: 999,
        gc_code: 'GCTEST',
        name: 'Test Cache',
        cache_type: 'Traditional Cache',
        latitude: 48.8566,
        longitude: 2.3522,
        difficulty: 2,
        terrain: 2,
        found: false
    }]);
}
```

Si ce point de test s'affiche → Le problème vient des données
Si ce point ne s'affiche pas → Le problème vient du rendu

---

**Prochain pas** : Relancez Theia, ouvrez une zone, et partagez-moi les logs de la console ! 🔍


