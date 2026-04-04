# Fix CORS - Détection de Coordonnées

## 🐛 Problème

Erreur CORS lors de l'appel à `/api/detect_coordinates` :

```
Access to XMLHttpRequest at 'http://localhost:8000/api/detect_coordinates' 
from origin 'http://localhost:3000' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
It does not have HTTP ok status.
```

## 🔍 Cause

Le blueprint `coordinates_bp` n'était **pas enregistré** dans l'application Flask, donc la route `/api/detect_coordinates` n'existait pas.

## ✅ Solution

### Modification de `gc_backend/__init__.py`

```python
# Blueprints
from .blueprints.zones import bp as zones_bp
from .blueprints.geocaches import bp as geocaches_bp
from .blueprints.plugins import bp as plugins_bp, init_plugin_manager
from .blueprints.tasks import bp as tasks_bp, init_task_manager
from .blueprints.coordinates import coordinates_bp  # ✅ AJOUTÉ

app.register_blueprint(zones_bp)
app.register_blueprint(geocaches_bp)
app.register_blueprint(plugins_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(coordinates_bp)  # ✅ AJOUTÉ
```

## 🚀 Redémarrage requis

**IMPORTANT** : Redémarrer le serveur Flask pour que le blueprint soit enregistré :

```bash
# Arrêter le serveur (Ctrl+C)
# Puis relancer
cd gc-backend
python app.py
```

## ✅ Vérification

Une fois le serveur redémarré, tester :

```bash
# Test manuel de l'API
curl -X POST http://localhost:8000/api/detect_coordinates \
  -H "Content-Type: application/json" \
  -d '{"text": "N 48° 33.787'\'' E 006° 38.803'\''"}'
```

**Réponse attendue :**
```json
{
  "exist": true,
  "ddm_lat": "N 48° 33.787'",
  "ddm_lon": "E 006° 38.803'",
  "ddm": "N 48° 33.787' E 006° 38.803'"
}
```

## 🧪 Test dans Theia

1. Ouvrir Caesar
2. Texte : `KHOOR A 48° 33.787' B 006° 38.803'`
3. ✅ Cocher "Détecter les coordonnées GPS"
4. Exécuter
5. ✅ Vérifier : zone "📍 Coordonnées détectées" affichée
6. ✅ Vérifier : pas d'erreur CORS dans la console

## 📝 Routes disponibles

Après le fix, ces routes sont maintenant accessibles :

- `POST /api/detect_coordinates` : Détection de coordonnées GPS
- `POST /api/calculate_coordinates` : Calcul de coordonnées depuis formule
- `POST /api/geocaches/save/<id>/coordinates` : Sauvegarde coordonnées (deprecated)

## ✅ Résumé

- ✅ Blueprint `coordinates_bp` importé
- ✅ Blueprint enregistré dans l'application
- ✅ CORS déjà configuré pour accepter toutes les origines
- 🔄 **Redémarrage du serveur Flask requis**

