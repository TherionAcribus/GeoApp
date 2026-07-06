"""
Blueprint Formula Solver
Routes API pour la résolution de formules de coordonnées GPS
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, request, jsonify, current_app
from loguru import logger
from bs4 import BeautifulSoup
from gc_backend.services.formula_questions_service import formula_questions_service
from gc_backend.services.web_search_service import web_search_service
from gc_backend.utils.coordinate_calculator import CoordinateCalculator
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from sqlalchemy import text

formula_solver_bp = Blueprint('formula_solver', __name__, url_prefix='/api/formula-solver')


def _is_formula_parser_unavailable(result) -> bool:
    if not isinstance(result, dict) or result.get('status') != 'error':
        return False

    message = " ".join(
        str(result.get(key) or '')
        for key in ('error', 'summary')
    ).lower()
    return 'formula_parser' in message and (
        'non disponible' in message or 'non trouvé' in message
    )


def _execute_formula_parser(text: str):
    plugin_manager = getattr(current_app, 'plugin_manager', None)
    if plugin_manager:
        result = plugin_manager.execute_plugin('formula_parser', {'text': text})
        if not _is_formula_parser_unavailable(result):
            return result
        logger.warning("Plugin formula_parser indisponible via PluginManager, fallback direct")

    from plugins.official.formula_parser.main import execute as execute_formula_parser

    return execute_formula_parser({'text': text})


def _get_geocache_text(geocache, include_waypoints: bool = True) -> str:
    """
    Extrait le texte exploitable d'une géocache (description + waypoints).
    Utilise description_raw en priorité, fallback sur description_html (nettoyé), puis description.
    
    Args:
        geocache: Instance du modèle Geocache
        include_waypoints: Si True, inclut les notes des waypoints additionnels
        
    Returns:
        Le texte complet de la géocache
    """
    text_parts = []

    # Priorité 1 : description_raw (texte déjà nettoyé du HTML)
    description = getattr(geocache, 'description_raw', None)

    # Priorité 2 : description_html nettoyé via BeautifulSoup
    if not description:
        description = getattr(geocache, 'description_html', None)
        if description:
            description = BeautifulSoup(description, 'html.parser').get_text(strip=True)

    # Priorité 3 : champ description brut
    if not description:
        description = getattr(geocache, 'description', '') or ''

    if description:
        text_parts.append(description)

    # Ajouter les notes des waypoints additionnels
    if include_waypoints:
        additional_waypoints = getattr(geocache, 'additional_waypoints', None)
        if additional_waypoints:
            for wp in additional_waypoints:
                if wp.note:
                    text_parts.append(wp.note)

    return "\n\n".join(text_parts)

@formula_solver_bp.post('/detect-formulas')
def detect_formulas():
    """
    Détecte les formules de coordonnées dans une géocache ou un texte brut.
    
    Body JSON:
        {
            "geocache_id": 123,  // OU
            "text": "N 47° 5E.FTN E 006° 5A.JVF"
        }
    
    Returns:
        {
            "status": "success",
            "formulas": [
                {
                    "id": "result_1",
                    "north": "N 47° 5E.FTN",
                    "east": "E 006° 5A.JVF",
                    "text_output": "N 47° 5E.FTN E 006° 5A.JVF",
                    "confidence": 0.9
                }
            ],
            "summary": "1 formule détectée"
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        
        geocache_id = data.get('geocache_id')
        text = data.get('text')
        
        # Validation : au moins un paramètre requis
        if not geocache_id and not text:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre geocache_id ou text requis'
            }), 400
        
        # Cas 1 : Détection depuis une géocache
        if geocache_id:
            geocache = Geocache.query.get(geocache_id)
            if not geocache:
                return jsonify({
                    'status': 'error',
                    'error': f'Géocache {geocache_id} introuvable'
                }), 404
            
            text = _get_geocache_text(geocache)
            logger.info(f"Détection de formules pour geocache {geocache.gc_code} (id={geocache_id})")
        
        # Appeler le plugin formula_parser
        result = _execute_formula_parser(text)
        
        if result.get('status') == 'error':
            return jsonify({
                'status': 'error',
                'error': result.get('error', {}).get('message', 'Erreur inconnue')
            }), 500
        
        logger.info(f"Formules détectées : {result.get('summary')}")
        
        return jsonify({
            'status': 'success',
            'formulas': result.get('results', []),
            'summary': result.get('summary', '')
        })
    
    except Exception as e:
        logger.error(f"Erreur lors de la détection de formules : {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/extract-questions')
def extract_questions():
    """
    Extrait les questions associées aux variables d'une formule.
    
    Body JSON:
        {
            "geocache_id": 123,  // OU "text": "..."
            "letters": ["A", "B", "C", "D"],
            "method": "regex"  // ou "ai" (non supporté pour l'instant)
        }
    
    Returns:
        {
            "status": "success",
            "questions": {
                "A": "Nombre de fenêtres",
                "B": "Année de construction",
                "C": "",
                "D": "Numéro de la rue"
            },
            "found_count": 3
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        
        geocache_id = data.get('geocache_id')
        text = data.get('text')
        letters = data.get('letters', [])
        method = data.get('method', 'regex')
        
        # Validation
        if not geocache_id and not text:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre geocache_id ou text requis'
            }), 400
        
        if not letters:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre letters requis (liste de lettres)'
            }), 400
        
        if method not in ['regex', 'ai']:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre method doit être "regex" ou "ai"'
            }), 400
        
        if method == 'ai':
            return jsonify({
                'status': 'error',
                'error': 'La méthode AI n\'est pas encore implémentée. Utilisez "regex".'
            }), 400
        
        # Récupérer le contenu
        if geocache_id:
            geocache = Geocache.query.get(geocache_id)
            if not geocache:
                return jsonify({
                    'status': 'error',
                    'error': f'Géocache {geocache_id} introuvable'
                }), 404
            
            content = geocache
            logger.info(f"Extraction de questions pour geocache {geocache.gc_code}, lettres: {letters}")
        else:
            content = text
            logger.info(f"Extraction de questions depuis texte, lettres: {letters}")
        
        # Extraire les questions avec la méthode choisie
        if method == 'regex':
            questions = formula_questions_service.extract_questions_with_regex(content, letters)
        
        # Compter les questions trouvées
        found_count = len([q for q in questions.values() if q])
        
        logger.info(f"Questions extraites : {found_count}/{len(letters)}")
        
        return jsonify({
            'status': 'success',
            'questions': questions,
            'found_count': found_count,
            'method': method
        })
    
    except Exception as e:
        logger.error(f"Erreur lors de l'extraction de questions : {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/calculate')
def calculate_coordinates():
    """
    Calcule les coordonnées finales à partir d'une formule et des valeurs.
    
    Body JSON:
        {
            "north_formula": "N 47° 5E.FTN",
            "east_formula": "E 006° 5A.JVF",
            "values": {
                "A": 3,
                "E": 8,
                "F": 1,
                "J": 2,
                "N": 5,
                "T": 9,
                "V": 0
            },
            "origin_lat": 47.123,  // Optionnel (pour calculer la distance)
            "origin_lon": 6.456    // Optionnel
        }
    
    Returns:
        {
            "status": "success",
            "coordinates": {
                "latitude": 47.89833333,
                "longitude": 6.08333333,
                "ddm": "N 47° 53.900 E 006° 05.000",
                "dms": "N 47° 53' 54.0\" E 006° 05' 00.0\"",
                "decimal": "47.89833333, 6.08333333"
            },
            "distance": {
                "km": 123.45,
                "miles": 76.72
            },
            "calculation_steps": {
                "north_substituted": "N 47° 58.195",
                "east_substituted": "E 006° 53.120"
            }
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        
        north_formula = data.get('north_formula')
        east_formula = data.get('east_formula')
        values = data.get('values')
        origin_lat = data.get('origin_lat')
        origin_lon = data.get('origin_lon')
        
        # Validation
        if not north_formula or not east_formula:
            return jsonify({
                'status': 'error',
                'error': 'Paramètres north_formula et east_formula requis'
            }), 400
        
        if values is None:
            values = {}

        if not isinstance(values, dict):
            return jsonify({
                'status': 'error',
                'error': 'Paramètre values doit être un dictionnaire lettre -> valeur'
            }), 400
        
        logger.info(f"Calcul de coordonnées : N={north_formula}, E={east_formula}, values={values}")
        
        # Calculer les coordonnées
        calculator = CoordinateCalculator()
        result = calculator.calculate_coordinates(north_formula, east_formula, values)
        
        if result.get('status') == 'error':
            return jsonify(result), 400
        
        # Calculer la distance si origine fournie
        if origin_lat is not None and origin_lon is not None:
            distance_km = calculator.calculate_distance(
                origin_lat, origin_lon,
                result['coordinates']['latitude'],
                result['coordinates']['longitude']
            )
            result['distance'] = {
                'km': round(distance_km, 2),
                'miles': round(distance_km * 0.621371, 2)
            }
            logger.info(f"Distance depuis origine : {distance_km:.2f} km")
        
        logger.info(f"Coordonnées calculées : {result['coordinates']['decimal']}")
        
        return jsonify(result)
    
    except ValueError as e:
        logger.warning(f"Erreur de validation lors du calcul : {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 400
    
    except Exception as e:
        logger.error(f"Erreur lors du calcul de coordonnées : {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/calculate-batch')
def calculate_coordinates_batch():
    """
    Calcule les coordonnées pour plusieurs combinaisons de valeurs en une seule requête.

    Évite d'envoyer N requêtes séquentielles depuis le frontend (brute force).

    Body JSON:
        {
            "north_formula": "N 47° 5A.BC",
            "east_formula": "E 006° 5D.EF",
            "combinations": [
                {"A": 3, "B": 5, "C": 1, "D": 2, "E": 8},
                {"A": 3, "B": 5, "C": 1, "D": 2, "E": 9}
            ],
            "origin_lat": 47.123,  // optionnel (distance)
            "origin_lon": 6.456    // optionnel
        }

    Returns:
        {
            "status": "success",
            "results": [
                {
                    "values": {...},
                    "status": "success",
                    "coordinates": {...},
                    "distance": {...}   // si origine fournie
                },
                {
                    "values": {...},
                    "status": "error",
                    "error": "Valeurs manquantes pour les variables: F"
                }
            ],
            "success_count": 1,
            "error_count": 1
        }
    """
    # Limite de sécurité côté backend (le frontend limite déjà à 1000)
    MAX_COMBINATIONS = 2000

    try:
        data = request.get_json(silent=True) or {}

        north_formula = data.get('north_formula')
        east_formula = data.get('east_formula')
        combinations = data.get('combinations')
        origin_lat = data.get('origin_lat')
        origin_lon = data.get('origin_lon')

        if not north_formula or not east_formula:
            return jsonify({
                'status': 'error',
                'error': 'Paramètres north_formula et east_formula requis'
            }), 400

        if not isinstance(combinations, list) or not combinations:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre combinations requis (liste non vide de dictionnaires)'
            }), 400

        if len(combinations) > MAX_COMBINATIONS:
            return jsonify({
                'status': 'error',
                'error': f'Trop de combinaisons ({len(combinations)}). Maximum autorisé : {MAX_COMBINATIONS}.'
            }), 400

        has_origin = origin_lat is not None and origin_lon is not None

        calculator = CoordinateCalculator()
        results = []
        success_count = 0
        error_count = 0

        for combination in combinations:
            if not isinstance(combination, dict):
                error_count += 1
                results.append({
                    'values': combination,
                    'status': 'error',
                    'error': 'Combinaison invalide (dictionnaire attendu)'
                })
                continue

            try:
                result = calculator.calculate_coordinates(north_formula, east_formula, combination)
            except ValueError as calc_error:
                error_count += 1
                results.append({
                    'values': combination,
                    'status': 'error',
                    'error': str(calc_error)
                })
                continue

            if result.get('status') != 'success':
                error_count += 1
                results.append({
                    'values': combination,
                    'status': 'error',
                    'error': result.get('error', 'Erreur inconnue')
                })
                continue

            if has_origin:
                distance_km = calculator.calculate_distance(
                    origin_lat, origin_lon,
                    result['coordinates']['latitude'],
                    result['coordinates']['longitude']
                )
                result['distance'] = {
                    'km': round(distance_km, 2),
                    'miles': round(distance_km * 0.621371, 2)
                }

            success_count += 1
            results.append({
                'values': combination,
                'status': 'success',
                'coordinates': result['coordinates'],
                'distance': result.get('distance'),
                'calculation_steps': result.get('calculation_steps')
            })

        logger.info(
            f"Calcul batch: {len(combinations)} combinaison(s) → "
            f"{success_count} succès, {error_count} erreur(s)"
        )

        return jsonify({
            'status': 'success',
            'results': results,
            'success_count': success_count,
            'error_count': error_count
        })

    except Exception as e:
        logger.error(f"Erreur lors du calcul batch de coordonnées : {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.get('/geocache/<int:geocache_id>')
def get_geocache_for_solver(geocache_id: int):
    """
    Récupère les informations d'une geocache pour le Formula Solver.
    
    Args:
        geocache_id: ID de la geocache
        
    Returns:
        JSON avec les données de la geocache :
        {
            "id": 123,
            "gc_code": "GC12345",
            "name": "Cache Mystery",
            "description": "...",
            "latitude": 47.5,
            "longitude": 6.5
        }
    """
    try:
        # Récupérer la geocache
        geocache = Geocache.query.filter_by(id=geocache_id).first()
        
        if not geocache:
            logger.warning(f"Geocache {geocache_id} non trouvée")
            return jsonify({
                'status': 'error',
                'error': f'Geocache {geocache_id} non trouvée'
            }), 404
        
        logger.info(f"Geocache {geocache_id} ({geocache.gc_code}) récupérée pour Formula Solver")

        description = _get_geocache_text(geocache, include_waypoints=False)

        return jsonify({
            'status': 'success',
            'geocache': {
                'id': geocache.id,
                'gc_code': geocache.gc_code,
                'name': geocache.name,
                'description': description or '',
                'latitude': geocache.latitude,
                'longitude': geocache.longitude
            }
        })
        
    except Exception as e:
        logger.error(f"Erreur lors de la récupération de la geocache {geocache_id}: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/geocache/<int:geocache_id>/waypoint')
def create_waypoint_from_formula(geocache_id: int):
    """
    Crée un waypoint depuis le résultat du Formula Solver.
    
    Args:
        geocache_id: ID de la geocache
        
    Body JSON:
        {
            "name": "Solution formule",
            "latitude": 47.123,
            "longitude": 6.456,
            "note": "Formule: N 47° AB.CDE E 006° FG.HIJ\nValeurs: A=1, B=2...",
            "type": "Reference Point"  // optionnel
        }
        
    Returns:
        JSON avec le waypoint créé
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'status': 'error',
                'error': 'Pas de données fournies'
            }), 400
        
        # Validation des champs requis
        name = data.get('name')
        latitude = data.get('latitude')
        longitude = data.get('longitude')
        
        if not name or latitude is None or longitude is None:
            return jsonify({
                'status': 'error',
                'error': 'Champs requis: name, latitude, longitude'
            }), 400
        
        # Validation des coordonnées
        try:
            lat = float(latitude)
            lon = float(longitude)
            
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                raise ValueError("Coordonnées hors limites")
        except (ValueError, TypeError) as e:
            return jsonify({
                'status': 'error',
                'error': f'Coordonnées invalides: {e}'
            }), 400
        
        # Vérifier que la geocache existe
        geocache = Geocache.query.filter_by(id=geocache_id).first()
        
        if not geocache:
            return jsonify({
                'status': 'error',
                'error': f'Geocache {geocache_id} non trouvée'
            }), 404
        
        # Générer le prefix automatiquement (WP01, WP02, etc.)
        result = db.session.execute(
            text('SELECT prefix FROM waypoints WHERE geocache_id = :geocache_id ORDER BY prefix DESC'),
            {'geocache_id': geocache_id}
        )
        existing_waypoints = result.fetchall()
        
        # Extraire les numéros existants
        existing_numbers = []
        for wp in existing_waypoints:
            if wp[0] and wp[0].startswith('WP'):
                try:
                    num = int(wp[0][2:])
                    existing_numbers.append(num)
                except ValueError:
                    pass
        
        # Générer le prochain numéro
        next_number = 1
        if existing_numbers:
            next_number = max(existing_numbers) + 1
        
        prefix = f"WP{next_number:02d}"
        
        # Formater les coordonnées en DDM
        lat_deg = int(abs(lat))
        lat_min = (abs(lat) - lat_deg) * 60
        lat_dir = 'N' if lat >= 0 else 'S'
        
        lon_deg = int(abs(lon))
        lon_min = (abs(lon) - lon_deg) * 60
        lon_dir = 'E' if lon >= 0 else 'W'
        
        gc_coords = f"{lat_dir} {lat_deg}° {lat_min:.3f} {lon_dir} {lon_deg}° {lon_min:.3f}"
        
        # Créer le waypoint
        note = data.get('note', '')
        waypoint_type = data.get('type', 'Reference Point')
        
        result = db.session.execute(
            text('''
            INSERT INTO waypoints (
                geocache_id, prefix, name, type, 
                latitude, longitude, gc_coords, note
            ) VALUES (:geocache_id, :prefix, :name, :type, :latitude, :longitude, :gc_coords, :note)
            '''),
            {
                'geocache_id': geocache_id,
                'prefix': prefix,
                'name': name,
                'type': waypoint_type,
                'latitude': lat,
                'longitude': lon,
                'gc_coords': gc_coords,
                'note': note
            }
        )
        
        waypoint_id = result.lastrowid
        db.session.commit()
        
        logger.info(f"Waypoint {prefix} créé pour geocache {geocache.gc_code} (ID: {waypoint_id})")
        
        return jsonify({
            'status': 'success',
            'waypoint': {
                'id': waypoint_id,
                'prefix': prefix,
                'name': name,
                'type': waypoint_type,
                'latitude': lat,
                'longitude': lon,
                'gc_coords': gc_coords,
                'note': note
            }
        })
        
    except Exception as e:
        logger.error(f"Erreur lors de la création du waypoint: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


# ============================================================================
# ENDPOINTS AI POUR TOOLS
# ============================================================================

@formula_solver_bp.post('/ai/detect-formula')
def ai_detect_formula():
    """
    Endpoint optimisé pour l'agent IA - Détection de formule avec contexte enrichi.
    
    Body JSON:
        {
            "text": "Description de la géocache...",
            "geocache_id": 123  // optionnel
        }
    
    Returns:
        {
            "status": "success",
            "formulas": [...],
            "context": {
                "total_found": 1,
                "confidence_avg": 0.9
            }
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        text = data.get('text')
        geocache_id = data.get('geocache_id')
        
        if not text and not geocache_id:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre text ou geocache_id requis'
            }), 400
        
        # Réutiliser la logique existante
        if geocache_id:
            geocache = Geocache.query.get(geocache_id)
            if not geocache:
                return jsonify({
                    'status': 'error',
                    'error': f'Géocache {geocache_id} introuvable'
                }), 404
            
            text = _get_geocache_text(geocache)
        
        # Appeler le plugin formula_parser
        plugin_manager = current_app.plugin_manager
        result = plugin_manager.execute_plugin('formula_parser', {'text': text})
        
        if result.get('status') == 'error':
            return jsonify({
                'status': 'error',
                'error': result.get('error', {}).get('message', 'Erreur inconnue')
            }), 500
        
        formulas = result.get('results', [])
        
        # Calculer des statistiques pour l'IA
        total_found = len(formulas)
        confidence_avg = 0
        if formulas:
            confidence_avg = sum(f.get('confidence', 0) for f in formulas) / total_found
        
        logger.info(f"[AI] Détection formule: {total_found} trouvée(s), confiance moyenne: {confidence_avg:.2f}")
        
        return jsonify({
            'status': 'success',
            'formulas': formulas,
            'context': {
                'total_found': total_found,
                'confidence_avg': round(confidence_avg, 2),
                'summary': result.get('summary', '')
            }
        })
    
    except Exception as e:
        logger.error(f"[AI] Erreur détection formule: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/ai/find-questions')
def ai_find_questions():
    """
    Endpoint optimisé pour l'agent IA - Recherche de questions pour variables.
    
    Body JSON:
        {
            "text": "A. Nombre de fenêtres\nB: Année...",
            "variables": ["A", "B", "C"]
        }
    
    Returns:
        {
            "status": "success",
            "questions": {"A": "Nombre de fenêtres", "B": "Année", "C": ""},
            "found_count": 2,
            "missing": ["C"]
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        text = data.get('text')
        variables = data.get('variables', [])
        
        if not text or not variables:
            return jsonify({
                'status': 'error',
                'error': 'Paramètres text et variables requis'
            }), 400
        
        # Utiliser le service existant
        questions = formula_questions_service.extract_questions_with_regex(text, variables)
        
        # Identifier les variables sans question
        found_count = len([q for q in questions.values() if q])
        missing = [v for v in variables if not questions.get(v)]
        
        logger.info(f"[AI] Recherche questions: {found_count}/{len(variables)} trouvées")
        
        return jsonify({
            'status': 'success',
            'questions': questions,
            'found_count': found_count,
            'missing': missing
        })
    
    except Exception as e:
        logger.error(f"[AI] Erreur recherche questions: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/ai/search-answer')
def ai_search_answer():
    """
    Endpoint optimisé pour l'agent IA - Recherche de réponse sur Internet.
    
    Body JSON:
        {
            "question": "Quelle est la hauteur de la Tour Eiffel?",
            "context": "géocache Paris",  // optionnel
            "max_results": 3  // optionnel, défaut 5
        }
    
    Returns:
        {
            "status": "success",
            "results": [
                {
                    "text": "La Tour Eiffel mesure 330 mètres",
                    "source": "https://...",
                    "score": 0.9,
                    "type": "instant_answer"
                }
            ],
            "best_answer": "La Tour Eiffel mesure 330 mètres"
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        question = data.get('question')
        context = data.get('context')
        max_results = data.get('max_results', 5)
        raw = bool(data.get('raw', False))
        geocache_id = data.get('geocache_id')
        
        if not question:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre question requis'
            }), 400

        # Si aucun contexte n'est fourni mais qu'une géocache est connue, construire
        # un contexte court (nom + localisation) utile pour les recherches documentaires.
        if not context and geocache_id is not None:
            context = _build_geocache_search_context(geocache_id)
        
        # Rechercher sur le web (raw=True pour les énigmes de connaissance/listes)
        results = web_search_service.search(question, context, max_results, raw=raw)
        
        # Extraire la meilleure réponse
        best_answer = web_search_service.extract_answer(results)
        
        logger.info(f"[AI] Recherche web (raw={raw}): {len(results)} résultats pour '{question}'")
        
        return jsonify({
            'status': 'success',
            'results': results,
            'best_answer': best_answer
        })
    
    except Exception as e:
        logger.error(f"[AI] Erreur recherche web: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


def _build_geocache_search_context(geocache_id) -> str:
    """Construit un court contexte de recherche (nom + localisation) pour une géocache."""
    try:
        geocache = db.session.get(Geocache, int(geocache_id))
    except Exception:
        geocache = None
    if not geocache:
        return ''
    name = getattr(geocache, 'name', None) or ''
    return str(name).strip()


@formula_solver_bp.post('/ai/fetch-url')
def ai_fetch_url():
    """
    Endpoint pour l'agent IA - Lit le contenu textuel d'une page web.

    Body JSON:
        {
            "url": "https://...",
            "max_chars": 6000  // optionnel
        }

    Returns:
        {
            "status": "success",
            "url": "...",
            "title": "...",
            "text": "contenu textuel nettoyé",
            "truncated": false
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        url = data.get('url')
        max_chars = data.get('max_chars', 6000)

        if not url:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre url requis'
            }), 400

        try:
            max_chars = max(500, min(int(max_chars), 20000))
        except (TypeError, ValueError):
            max_chars = 6000

        result = web_search_service.fetch_page(url, max_chars=max_chars)
        status_code = 200 if result.get('status') == 'success' else 400
        logger.info(f"[AI] Lecture page web: {url} -> {result.get('status')}")
        return jsonify(result), status_code

    except Exception as e:
        logger.error(f"[AI] Erreur lecture page web: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/ai/search-answers')
def ai_search_answers():
    """
    Endpoint batch - Recherche web pour plusieurs questions.

    Body JSON:
        {
            "questions": { "A": "Question...", "B": "Question..." }  // ou liste [{id,question}]
            "context": "contexte optionnel",
            "max_results": 5
        }

    Returns:
        {
            "status": "success",
            "answers": {
                "A": { "best_answer": "...", "results": [...] },
                "B": { "best_answer": "...", "results": [...] }
            }
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        questions = data.get('questions')
        context = data.get('context')
        max_results = data.get('max_results', 5)

        if not questions:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre questions requis'
            }), 400

        items = []
        if isinstance(questions, dict):
            items = list(questions.items())
        elif isinstance(questions, list):
            for entry in questions:
                if not isinstance(entry, dict):
                    continue
                key = entry.get('id') or entry.get('letter')
                q = entry.get('question')
                if key:
                    items.append((key, q))
        else:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre questions doit être un objet ou une liste'
            }), 400

        if not items:
            return jsonify({
                'status': 'error',
                'error': 'Aucune question valide fournie'
            }), 400

        answers = {}

        # Les questions vides ont une réponse immédiate ; on ne lance de recherche
        # que pour les questions non vides.
        pending = []
        for key, question in items:
            if not question:
                answers[key] = {'best_answer': '', 'results': []}
            else:
                pending.append((key, question))

        def _run_search(question):
            results = web_search_service.search(question, context, max_results)
            best_answer = web_search_service.extract_answer(results)
            return {'best_answer': best_answer, 'results': results}

        if pending:
            # Recherches lancées en parallèle pour diviser le temps total.
            # Concurrence volontairement modérée (4 max) pour ne pas déclencher
            # le rate-limiting de DuckDuckGo.
            max_workers = min(4, len(pending))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_key = {
                    executor.submit(_run_search, question): key
                    for key, question in pending
                }
                for future in as_completed(future_to_key):
                    key = future_to_key[future]
                    try:
                        answers[key] = future.result()
                    except Exception as search_error:
                        # Une recherche en échec n'interrompt pas les autres.
                        logger.warning(f"[AI] Erreur recherche web pour '{key}': {search_error}")
                        answers[key] = {'best_answer': '', 'results': []}

        logger.info(
            f"[AI] Recherche web batch: {len(items)} question(s), "
            f"{len(pending)} recherche(s) en parallèle (max {min(4, len(pending)) if pending else 0} workers)"
        )

        return jsonify({
            'status': 'success',
            'answers': answers
        })

    except Exception as e:
        logger.error(f"[AI] Erreur recherche web batch: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/ai/suggest-calculation-type')
def ai_suggest_calculation_type():
    """
    Endpoint optimisé pour l'agent IA - Suggère le type de calcul pour une réponse.
    
    Body JSON:
        {
            "answer": "Tour Eiffel",
            "question": "Monument de Paris"  // optionnel, pour contexte
        }
    
    Returns:
        {
            "status": "success",
            "suggestions": [
                {
                    "type": "length",
                    "confidence": 0.8,
                    "result": 11,
                    "description": "Longueur du texte (sans espaces)"
                },
                {
                    "type": "checksum",
                    "confidence": 0.3,
                    "result": 0,
                    "description": "Checksum (pas de chiffres dans la réponse)"
                }
            ],
            "recommended": "length"
        }
    """
    try:
        data = request.get_json(silent=True) or {}
        answer = data.get('answer', '')
        question = data.get('question', '')
        
        if not answer:
            return jsonify({
                'status': 'error',
                'error': 'Paramètre answer requis'
            }), 400
        
        suggestions = []
        
        # 1. Longueur (sans espaces)
        length = len(answer.replace(' ', ''))
        length_confidence = 0.8 if length > 0 and length < 100 else 0.3
        suggestions.append({
            'type': 'length',
            'confidence': length_confidence,
            'result': length,
            'description': 'Longueur du texte (sans espaces)'
        })
        
        # 2. Checksum (somme des chiffres)
        import re
        digits = re.findall(r'\d', answer)
        checksum = sum(int(d) for d in digits)
        checksum_confidence = 0.7 if digits else 0.1
        suggestions.append({
            'type': 'checksum',
            'confidence': checksum_confidence,
            'result': checksum,
            'description': f'Checksum (somme de {len(digits)} chiffres)'
        })
        
        # 3. Checksum réduit
        reduced_checksum = checksum
        while reduced_checksum >= 10:
            reduced_checksum = sum(int(d) for d in str(reduced_checksum))
        suggestions.append({
            'type': 'reduced_checksum',
            'confidence': checksum_confidence * 0.9,
            'result': reduced_checksum,
            'description': 'Checksum réduit (récursif jusqu\'à 1 chiffre)'
        })
        
        # 4. Valeur directe (si c'est un nombre)
        try:
            value = int(answer.strip())
            value_confidence = 0.95
            suggestions.append({
                'type': 'value',
                'confidence': value_confidence,
                'result': value,
                'description': 'Valeur numérique directe'
            })
        except (ValueError, AttributeError):
            pass
        
        # Trier par confiance décroissante
        suggestions.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Recommander le type avec la plus haute confiance
        recommended = suggestions[0]['type'] if suggestions else 'length'
        
        question_hint = (question or '').strip()
        question_hint = (question_hint[:40] + '...') if len(question_hint) > 40 else question_hint
        logger.info(f"[AI] Suggestion calcul pour '{answer[:30]}...' (question='{question_hint}'): {recommended}")
        
        return jsonify({
            'status': 'success',
            'suggestions': suggestions,
            'recommended': recommended
        })
    
    except Exception as e:
        logger.error(f"[AI] Erreur suggestion calcul: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@formula_solver_bp.post('/update-description-raw')
def update_description_raw():
    """
    Met à jour le champ description_raw pour les géocaches existantes.

    Cette fonction parcoure toutes les géocaches qui ont description_html
    mais pas description_raw, et extrait le texte brut.
    """
    try:
        logger.info("Début mise à jour description_raw...")

        # Trouver les géocaches qui ont description_html mais pas description_raw
        geocaches_to_update = Geocache.query.filter(
            Geocache.description_html.isnot(None),
            Geocache.description_raw.is_(None)
        ).all()

        updated_count = 0

        for geocache in geocaches_to_update:
            try:
                # Extraire le texte brut du HTML
                soup = BeautifulSoup(geocache.description_html, 'html.parser')
                description_raw = soup.get_text(strip=True)

                if description_raw:
                    geocache.description_raw = description_raw
                    updated_count += 1
                    logger.debug(f"Geocache {geocache.gc_code}: description_raw mise à jour")

            except Exception as e:
                logger.warning(f"Erreur traitement geocache {geocache.gc_code}: {e}")
                continue

        # Commit des changements
        if updated_count > 0:
            db.session.commit()
            logger.info(f"Mise à jour terminée: {updated_count} géocaches mises à jour")
        else:
            logger.info("Aucune géocache à mettre à jour")

        return jsonify({
            'status': 'success',
            'updated_count': updated_count,
            'message': f'{updated_count} géocaches mises à jour avec description_raw'
        })

    except Exception as e:
        db.session.rollback()
        logger.error(f"Erreur mise à jour description_raw: {e}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


# Alias pour l'import dans __init__.py
bp = formula_solver_bp
