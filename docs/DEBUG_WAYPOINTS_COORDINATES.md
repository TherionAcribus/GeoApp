# 🔍 Debug : Coordonnées identiques des waypoints

## 🐛 Problème observé

Tous les waypoints créés ont les mêmes coordonnées décimales (celles de la géocache) malgré des coordonnées GC différentes :

```sql
415  433  Waypoint_test    48.6367333333333  6.13241666666667  N 48° 38.104 E 006° 07.445
416  433  Waypoint_test-2  48.6367333333333  6.13241666666667  N 48° 38.204 E 006° 07.000
417  433  Wp test 3        48.6367333333333  6.13241666666667  N 48° 38.204 E 006° 07.123
                           ^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^
                           Identiques !      Identiques !      Différentes !
```

## 🔍 Logs ajoutés pour investigation

### Backend (Python)

**Fichier** : `gc-backend/gc_backend/blueprints/geocaches.py`

#### Endpoint POST (création)
```python
# Logs ajoutés :
logger.info(f"[CREATE WAYPOINT] Geocache {geocache_id}")
logger.info(f"[CREATE WAYPOINT] Données reçues: {data}")
logger.info(f"[CREATE WAYPOINT] gc_coords reçu: {data.get('gc_coords')}")
logger.info(f"[CREATE WAYPOINT] latitude reçue: {data.get('latitude')}")
logger.info(f"[CREATE WAYPOINT] longitude reçue: {data.get('longitude')}")

logger.info(f"[CREATE WAYPOINT] Avant commit - waypoint.gc_coords: {waypoint.gc_coords}")
logger.info(f"[CREATE WAYPOINT] Avant commit - waypoint.latitude: {waypoint.latitude}")
logger.info(f"[CREATE WAYPOINT] Avant commit - waypoint.longitude: {waypoint.longitude}")

logger.info(f"[CREATE WAYPOINT] Après commit - ID: {waypoint.id}")
logger.info(f"[CREATE WAYPOINT] Après commit - waypoint.gc_coords: {waypoint.gc_coords}")
logger.info(f"[CREATE WAYPOINT] Après commit - waypoint.latitude: {waypoint.latitude}")
logger.info(f"[CREATE WAYPOINT] Après commit - waypoint.longitude: {waypoint.longitude}")
```

#### Endpoint PUT (modification)
```python
# Logs ajoutés :
logger.info(f"[UPDATE WAYPOINT] Waypoint {waypoint_id} - Geocache {geocache_id}")
logger.info(f"[UPDATE WAYPOINT] Données reçues: {data}")
logger.info(f"[UPDATE WAYPOINT] gc_coords reçu: {data.get('gc_coords')}")
logger.info(f"[UPDATE WAYPOINT] latitude reçue: {data.get('latitude')}")
logger.info(f"[UPDATE WAYPOINT] longitude reçue: {data.get('longitude')}")

logger.info(f"[UPDATE WAYPOINT] Avant - waypoint.gc_coords: {waypoint.gc_coords}")
logger.info(f"[UPDATE WAYPOINT] Avant - waypoint.latitude: {waypoint.latitude}")
logger.info(f"[UPDATE WAYPOINT] Avant - waypoint.longitude: {waypoint.longitude}")

logger.info(f"[UPDATE WAYPOINT] Après modif - waypoint.gc_coords: {waypoint.gc_coords}")
logger.info(f"[UPDATE WAYPOINT] Après modif - waypoint.latitude: {waypoint.latitude}")
logger.info(f"[UPDATE WAYPOINT] Après modif - waypoint.longitude: {waypoint.longitude}")

logger.info(f"[UPDATE WAYPOINT] Après commit - waypoint.gc_coords: {waypoint.gc_coords}")
logger.info(f"[UPDATE WAYPOINT] Après commit - waypoint.latitude: {waypoint.latitude}")
logger.info(f"[UPDATE WAYPOINT] Après commit - waypoint.longitude: {waypoint.longitude}")
```

### Frontend (TypeScript)

**Fichier** : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

```typescript
// Logs ajoutés dans saveWaypoint() :
console.log('[WaypointsEditor] 🔍 SAVE WAYPOINT');
console.log('[WaypointsEditor] editForm:', editForm);
console.log('[WaypointsEditor] gc_coords:', editForm.gc_coords);
console.log('[WaypointsEditor] latitude:', editForm.latitude);
console.log('[WaypointsEditor] longitude:', editForm.longitude);
console.log('[WaypointsEditor] JSON à envoyer:', JSON.stringify(editForm, null, 2));
console.log('[WaypointsEditor] URL:', url);
console.log('[WaypointsEditor] Method:', method);
console.log('[WaypointsEditor] Réponse du serveur:', result);
```

## 📋 Procédure de test

### 1. Redémarrer le backend
```bash
cd gc-backend
# Arrêter le serveur actuel (Ctrl+C)
python -m gc_backend.app
```

### 2. Recharger l'application Theia
- Fermer et relancer l'application Theia
- Ou recompiler : `cd theia-blueprint/theia-extensions/zones && yarn build`

### 3. Créer un nouveau waypoint

1. Ouvrir une géocache (ex: GCA7RV7)
2. Cliquer sur "+ Ajouter un waypoint"
3. Remplir :
   - Nom : "Test Debug"
   - Coordonnées : "N 48° 39.000 E 006° 08.500"
4. Cliquer sur "Sauvegarder"

### 4. Observer les logs

#### Console navigateur (F12)
Chercher les logs `[WaypointsEditor]` :
```
[WaypointsEditor] 🔍 SAVE WAYPOINT
[WaypointsEditor] editForm: {...}
[WaypointsEditor] gc_coords: "N 48° 39.000 E 006° 08.500"
[WaypointsEditor] latitude: ???
[WaypointsEditor] longitude: ???
```

#### Logs backend (terminal)
Chercher les logs `[CREATE WAYPOINT]` :
```
[CREATE WAYPOINT] Geocache 433
[CREATE WAYPOINT] Données reçues: {...}
[CREATE WAYPOINT] gc_coords reçu: "N 48° 39.000 E 006° 08.500"
[CREATE WAYPOINT] latitude reçue: ???
[CREATE WAYPOINT] longitude reçue: ???
```

## 🎯 Ce qu'on cherche à comprendre

### Hypothèse 1 : Frontend envoie les mauvaises coordonnées
**Symptôme attendu** :
```
[WaypointsEditor] gc_coords: "N 48° 39.000 E 006° 08.500"
[WaypointsEditor] latitude: 48.6367333333333  ← Coordonnées de la géocache !
[WaypointsEditor] longitude: 6.13241666666667 ← Coordonnées de la géocache !
```

**Cause** : Le formulaire pré-remplit avec les coordonnées de la géocache

**Solution** : Ne pas pré-remplir `latitude` et `longitude` dans `startEdit()`

### Hypothèse 2 : Frontend n'envoie pas de coordonnées décimales
**Symptôme attendu** :
```
[WaypointsEditor] gc_coords: "N 48° 39.000 E 006° 08.500"
[WaypointsEditor] latitude: undefined
[WaypointsEditor] longitude: undefined
```

**Cause** : Pas de parsing des coordonnées GC avant envoi

**Solution** : Parser les coordonnées GC avant `JSON.stringify(editForm)`

### Hypothèse 3 : Backend reçoit les bonnes données mais les perd
**Symptôme attendu** :
```
[CREATE WAYPOINT] latitude reçue: 48.65
[CREATE WAYPOINT] longitude reçue: 6.14166
[CREATE WAYPOINT] Avant commit - latitude: 48.65
[CREATE WAYPOINT] Après commit - latitude: 48.6367  ← Changé !
```

**Cause** : Trigger SQL ou problème de modèle SQLAlchemy

**Solution** : Vérifier le modèle `GeocacheWaypoint` et les triggers SQL

### Hypothèse 4 : Problème de format de données
**Symptôme attendu** :
```
[CREATE WAYPOINT] latitude reçue: "48.65"  ← String au lieu de float
```

**Cause** : Type de données incorrect

**Solution** : Convertir en float avant envoi

## 📊 Tableau de diagnostic

| Étape | Valeur attendue | Valeur observée | Status |
|-------|----------------|-----------------|--------|
| Frontend - editForm.gc_coords | "N 48° 39.000 E 006° 08.500" | ? | ⏳ |
| Frontend - editForm.latitude | 48.65 | ? | ⏳ |
| Frontend - editForm.longitude | 6.14166 | ? | ⏳ |
| Backend - data.get('gc_coords') | "N 48° 39.000 E 006° 08.500" | ? | ⏳ |
| Backend - data.get('latitude') | 48.65 | ? | ⏳ |
| Backend - data.get('longitude') | 6.14166 | ? | ⏳ |
| Backend - Avant commit | 48.65 / 6.14166 | ? | ⏳ |
| Backend - Après commit | 48.65 / 6.14166 | ? | ⏳ |
| Base de données | 48.65 / 6.14166 | 48.6367 / 6.1324 | ❌ |

## 📝 Template pour rapporter les résultats

```
### Test effectué le [DATE]

**Waypoint créé** :
- Nom : "Test Debug"
- Coordonnées GC : "N 48° 39.000 E 006° 08.500"

**Logs Frontend** :
```
[Copier les logs de la console navigateur]
```

**Logs Backend** :
```
[Copier les logs du terminal backend]
```

**Résultat en base de données** :
```sql
SELECT id, name, gc_coords, latitude, longitude 
FROM geocache_waypoint 
WHERE name = 'Test Debug';
```

**Diagnostic** :
- [ ] Les coordonnées décimales sont envoyées par le frontend
- [ ] Les coordonnées décimales sont reçues par le backend
- [ ] Les coordonnées décimales sont correctes avant commit
- [ ] Les coordonnées décimales sont correctes après commit
- [ ] Les coordonnées décimales sont correctes en base de données

**Conclusion** :
[Décrire où se situe le problème]
```

## 🔧 Actions selon le diagnostic

### Si le problème est dans le frontend
→ Implémenter le parsing des coordonnées GC avant envoi

### Si le problème est dans le backend
→ Vérifier le modèle SQLAlchemy et les triggers SQL

### Si le problème est dans la base de données
→ Vérifier les contraintes, triggers et valeurs par défaut

## 📞 Prochaines étapes

1. ✅ Logs ajoutés (frontend + backend)
2. ✅ Code compilé
3. ⏳ Redémarrer backend
4. ⏳ Recharger Theia
5. ⏳ Créer un waypoint de test
6. ⏳ Observer les logs
7. ⏳ Identifier la cause
8. ⏳ Appliquer la correction

---

**Date** : 1er novembre 2025  
**Statut** : 🔍 Investigation en cours  
**Fichiers modifiés** :
- `gc-backend/gc_backend/blueprints/geocaches.py` (logs backend)
- `theia-extensions/zones/src/browser/geocache-details-widget.tsx` (logs frontend)
