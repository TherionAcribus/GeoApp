from typing import Iterator, Optional, Dict, List
import ast
import re
import logging
from flask import Blueprint, request, jsonify, current_app
from werkzeug.exceptions import HTTPException
import traceback

logger = logging.getLogger(__name__)
# Le niveau de log est piloté par la configuration applicative : ne pas forcer DEBUG
# ici (ce module est appelé par le scorer pour chaque candidat bruteforce).
logger.debug("Coordinates blueprint loaded")
try:
    from pyproj import Geod
except ModuleNotFoundError:  # pragma: no cover
    Geod = None

coordinates_bp = Blueprint('coordinates', __name__)

# Seuils de la règle géocaching des "2 miles" (distance cache <-> point posté).
# Extraits en constantes pour éviter les valeurs magiques ; pourront être exposés
# en préférence utilisateur si le besoin se confirme.
DISTANCE_WARNING_MILES = 2.0
DISTANCE_FAR_MILES = 2.5

# Distance max (en caractères) tolérée entre les composantes latitude et
# longitude d'une même paire. Au-delà, ce sont vraisemblablement deux
# coordonnées indépendantes (waypoints, étapes...) qu'il ne faut pas apparier.
MAX_COORD_PAIR_GAP = 40


def _error_response(log_message: str, exception: Exception, status: int = 500):
    """
    Journalise le détail complet de l'exception côté serveur mais ne renvoie
    qu'un message générique au client.

    Renvoyer ``str(exception)`` brut peut faire fuiter des détails internes
    (chemins, messages de driver, etc.), potentiellement exposés sur le réseau
    local (le backend écoute sur ``0.0.0.0`` en développement). On conserve la
    clé ``error`` attendue par le frontend de ce blueprint.
    """
    logger.exception("%s: %s", log_message, exception)
    return jsonify({
        "error": f"{log_message}. Consultez les logs backend pour plus de détails."
    }), status


DDM_COMPONENT_REGEX = re.compile(
    r'([NSWE])\s*(\d{1,3})\s*(?:[°º]|deg|degrees)?\s*([0-5]?\d(?:[.,]\d+)?)\s*[\'\'’′]?'
)


def _ddm_component_to_decimal(component: str) -> float:
    """Convertit une composante DDM (ex: "N 48° 39.286'") en décimal."""
    if not component:
        raise ValueError("Composante DDM vide")

    match = DDM_COMPONENT_REGEX.search(component.strip())
    if not match:
        raise ValueError(f"Format DDM invalide: {component}")

    direction, degrees_str, minutes_str = match.groups()
    degrees = int(degrees_str)
    minutes = float(minutes_str.replace(',', '.'))

    if minutes < 0 or minutes >= 60:
        raise ValueError(f"Minutes hors bornes: {minutes}")

    direction = direction.upper()
    if direction in ('N', 'S') and not 0 <= degrees <= 90:
        raise ValueError(f"Latitude hors bornes: {degrees}")
    if direction in ('E', 'W') and not 0 <= degrees <= 180:
        raise ValueError(f"Longitude hors bornes: {degrees}")

    decimal = degrees + (minutes / 60.0)
    if direction in ('S', 'W'):
        decimal = -decimal

    return round(decimal, 8)


def convert_ddm_to_decimal(lat_ddm: str, lon_ddm: str) -> Dict[str, Optional[float]]:
    """Convertit deux coordonnées DDM (latitude, longitude) en décimal."""
    latitude = None
    longitude = None

    try:
        latitude = _ddm_component_to_decimal(lat_ddm)
    except Exception as exc:
        logger.debug("convert_ddm_to_decimal: impossible de convertir la latitude '%s': %s", lat_ddm, exc)

    try:
        longitude = _ddm_component_to_decimal(lon_ddm)
    except Exception as exc:
        logger.debug("convert_ddm_to_decimal: impossible de convertir la longitude '%s': %s", lon_ddm, exc)

    return {
        "latitude": latitude,
        "longitude": longitude
    }


# Découpe une chaîne DDM combinée "N 48° 39.286 E 006° 11.685" en (lat, lon).
_ORIGIN_COMBINED_REGEX = re.compile(r"^([NS][^NSWE]+?)[\s,]+([EW].+)$", re.IGNORECASE)

# Extraction de la direction cardinale d'une coordonnée d'origine (première
# lettre N/S ou E/W du DDM). Compilées une fois : chemin chaud du scorer.
_ORIGIN_LAT_DIR_REGEX = re.compile(r'([NS])')
_ORIGIN_LON_DIR_REGEX = re.compile(r'([EW])')


def _normalize_origin_coords(origin) -> Optional[Dict[str, str]]:
    """
    Normalise des coordonnées d'origine en dict ``{ddm_lat, ddm_lon}``.

    Accepte deux formes, car les appelants (front, batch, scorer) envoient
    indifféremment :
      - un dict ``{"ddm_lat": "N 48° 39.286'", "ddm_lon": "E 006° 11.685'"}`` ;
      - une chaîne DDM combinée ``"N 48° 39.286 E 006° 11.685"`` (ex: le champ
        ``coordinatesRaw`` d'une géocache côté front).

    Retourne ``None`` si l'entrée est vide ou impossible à interpréter, sans
    lever d'exception (les directions cardinales/distance restent alors sur leurs
    valeurs par défaut plutôt que de faire échouer la détection).
    """
    if not origin:
        return None

    if isinstance(origin, dict):
        ddm_lat = str(origin.get("ddm_lat") or "").strip()
        ddm_lon = str(origin.get("ddm_lon") or "").strip()
        if ddm_lat and ddm_lon:
            return {"ddm_lat": ddm_lat, "ddm_lon": ddm_lon}
        return None

    if isinstance(origin, str):
        match = _ORIGIN_COMBINED_REGEX.match(origin.strip())
        if match:
            return {
                "ddm_lat": match.group(1).strip(),
                "ddm_lon": match.group(2).strip(),
            }
        return None

    return None


def _normalize_written_languages(raw) -> List[str]:
    """Normalise le paramètre written_languages (str CSV ou liste) en liste de codes.

    Retombe sur ``['fr']`` si l'entrée est vide/invalide.
    """
    if isinstance(raw, str):
        parts = [p.strip().lower() for p in raw.split(',') if p.strip()]
    elif isinstance(raw, list):
        parts = [str(x).strip().lower() for x in raw if str(x).strip()]
    else:
        parts = []
    return parts or ['fr']


# Extraction des parties latitude/longitude d'une formule (lettres variables
# et chiffres acceptés). Compilées une fois : endpoint + helpers en appellent.
_FORMULA_LAT_REGEX = re.compile(r'([NS])\s*([A-Z0-9]+)°\s*([A-Z0-9]+)\.([A-Z0-9()x*/+-]+)')
_FORMULA_LON_REGEX = re.compile(r'([EW])\s*([A-Z0-9]+)°\s*([A-Z0-9]+)\.([A-Z0-9()x*/+-]+)')


@coordinates_bp.route('/api/calculate_coordinates', methods=['POST'])
def calculate_coordinates():
    """
    Calcule les coordonnées à partir d'une formule.
    Peut calculer partiellement les coordonnées même si toutes les variables ne sont pas définies.
    
    Vérifie également que les coordonnées sont au format standard de géocaching:
    - Exactement 3 chiffres après le point pour les décimales des minutes
    - Si plus de 3 chiffres, erreur indiquée (valeurs incorrectes)
    - Si moins de 3 chiffres, complète avec des zéros (ex: 94 devient 094)
    
    Exemple de données attendues:
    {
        "formula": "N48° 39.(8/4)(27/9)(2x2x2) E06°11.(3x2)(16x2/4)(25/5)",
        "variables": {"A": 5, "B": 10, ...},  # optionnel
        "origin_lat": "N48° 40.123",  # optionnel
        "origin_lon": "E06° 10.456"   # optionnel
    }
    
    Retourne:
    {
        "coordinates": "N48° 39.286 E06°11.685",
        "latitude": "N48° 39.286",
        "longitude": "E06°11.685",
        "status": "complete" | "partial" | "error",
        "lat_status": {
            "status": "complete" | "partial" | "error",
            "message": "Message d'erreur détaillé si applicable"
        },
        "lon_status": {
            "status": "complete" | "partial" | "error",
            "message": "Message d'erreur détaillé si applicable"
        },
        "distance_from_origin": {
            "meters": 1234.56,
            "miles": 0.76,
            "status": "ok" | "warning" | "far"
        },  # optionnel, présent uniquement si origin_lat et origin_lon sont fournis
        "decimal_latitude": 48.586,
        "decimal_longitude": 6.195
    }
    """
    try:
        data = request.get_json()
        formula = data.get('formula', '')
        variables = data.get('variables', {})
        origin_lat = data.get('origin_lat')
        origin_lon = data.get('origin_lon')
        
        if not formula:
            return jsonify({"error": "Aucune formule fournie"}), 400
        
        logger.debug('Calcul des coordonnées pour la formule: %s', formula)
        logger.debug('Variables fournies: %s', variables)
        
        # Extraire les parties de latitude et longitude (accepte lettres et chiffres)
        lat_match = _FORMULA_LAT_REGEX.search(formula)
        lon_match = _FORMULA_LON_REGEX.search(formula)
        
        if not lat_match or not lon_match:
            logger.error('Format de formule invalide: lat_match=%s, lon_match=%s', lat_match, lon_match)
            return jsonify({"error": "Format de formule invalide"}), 400
        
        # Substitution et calcul pour chaque partie
        lat_dir, lat_deg_raw, lat_min_raw, lat_decimal_raw = lat_match.groups()
        lon_dir, lon_deg_raw, lon_min_raw, lon_decimal_raw = lon_match.groups()
        
        logger.debug('Parties de latitude: dir=%s, deg=%s, min=%s, decimal=%s', lat_dir, lat_deg_raw, lat_min_raw, lat_decimal_raw)
        logger.debug('Parties de longitude: dir=%s, deg=%s, min=%s, decimal=%s', lon_dir, lon_deg_raw, lon_min_raw, lon_decimal_raw)
        
        # Appliquer la substitution sur chaque partie
        lat_deg = _process_formula_part(lat_deg_raw, variables)
        lat_min = _process_formula_part(lat_min_raw, variables)
        lat_decimal = _process_formula_part(lat_decimal_raw, variables)
        lon_deg = _process_formula_part(lon_deg_raw, variables)
        lon_min = _process_formula_part(lon_min_raw, variables)
        lon_decimal = _process_formula_part(lon_decimal_raw, variables)
        
        logger.debug('Valeurs calculées: lat_deg=%s, lat_min=%s, lat_decimal=%s', lat_deg, lat_min, lat_decimal)
        logger.debug('Valeurs calculées: lon_deg=%s, lon_min=%s, lon_decimal=%s', lon_deg, lon_min, lon_decimal)
        
        # Statuts individuels
        def part_status(val, label):
            # Vérifie si la valeur contient encore des lettres (résolution partielle)
            if isinstance(val, str) and re.search(r'[A-Z]', val):
                # Vérifier si c'est une expression avec des parenthèses qui n'a pas pu être évaluée
                if '(' in val and ')' in val:
                    return ("error", f"La partie {label} contient une expression mathématique non évaluable: {val}")
                return ("partial", f"La partie {label} contient encore des lettres")
            
            # Vérifie si la valeur est une expression entre parenthèses (erreur de calcul)
            if isinstance(val, str) and val.startswith('(') and val.endswith(')'):
                # C'est une expression qui n'a pas pu être calculée comme un entier
                return ("error", f"L'expression {val} dans {label} ne donne pas un nombre entier. Vérifiez vos valeurs.")
            
            # Vérifie si la valeur est négative
            if isinstance(val, (int, float)):
                if int(val) < 0:
                    return ("error", f"La partie {label} est négative")
                
                # Vérification spécifique pour la partie décimale des minutes (format de géocaching)
                if "décimales" in label:
                    # Convertir en chaîne pour vérifier le nombre de chiffres
                    val_str = str(val)
                    
                    # Si on a plus de 3 chiffres, c'est une erreur en géocaching
                    if len(val_str) > 3:
                        return ("error", f"La partie {label} a plus de 3 chiffres ({val_str}). Ceci indique une erreur dans vos valeurs, car en géocaching, il faut exactement 3 chiffres après le point.")
            
            return ("complete", "")
        
        lat_deg_status, lat_deg_msg = part_status(lat_deg, "degrés latitude")
        lat_min_status, lat_min_msg = part_status(lat_min, "minutes latitude")
        lat_decimal_status, lat_decimal_msg = part_status(lat_decimal, "décimales latitude")
        lon_deg_status, lon_deg_msg = part_status(lon_deg, "degrés longitude")
        lon_min_status, lon_min_msg = part_status(lon_min, "minutes longitude")
        lon_decimal_status, lon_decimal_msg = part_status(lon_decimal, "décimales longitude")
        
        # Statut global pour chaque coordonnée
        lat_status = {"status": "complete", "message": ""}
        lon_status = {"status": "complete", "message": ""}
        
        for st, msg in [(lat_deg_status, lat_deg_msg), (lat_min_status, lat_min_msg), (lat_decimal_status, lat_decimal_msg)]:
            if st == "error":
                lat_status = {"status": "error", "message": msg}
                break
            elif st == "partial" and lat_status["status"] != "error":
                lat_status = {"status": "partial", "message": msg}
        for st, msg in [(lon_deg_status, lon_deg_msg), (lon_min_status, lon_min_msg), (lon_decimal_status, lon_decimal_msg)]:
            if st == "error":
                lon_status = {"status": "error", "message": msg}
                break
            elif st == "partial" and lon_status["status"] != "error":
                lon_status = {"status": "partial", "message": msg}
        
        # Statut global
        global_status = "complete"
        if lat_status["status"] != "complete" or lon_status["status"] != "complete":
            if lat_status["status"] == "error" or lon_status["status"] == "error":
                global_status = "error"
            else:
                global_status = "partial"
        
        # Formatage final
        def format_part(val, digits):
            if isinstance(val, (int, float)):
                # Convertir en chaîne
                val_str = str(val)
                
                # Pour les décimales (quand digits=3), on s'assure d'avoir au moins 3 chiffres
                # mais on ne tronque pas s'il y en a plus (pour afficher l'erreur)
                if digits == 3:
                    # Pour des valeurs avec moins de 3 chiffres, on complète avec des zéros
                    if len(val_str) < 3:
                        val_str = val_str.zfill(digits)
                    # Si plus de 3 chiffres, on laisse tel quel pour montrer l'erreur
                else:
                    # Pour les autres parties (degrés, minutes), on utilise simplement zfill
                    val_str = val_str.zfill(digits)
                
                return val_str
            
            # Si ce n'est pas un nombre, le retourner tel quel
            return str(val)
        
        lat_formatted = f"{lat_dir}{format_part(lat_deg,2)}° {format_part(lat_min,2)}.{format_part(lat_decimal,3)}"
        lon_formatted = f"{lon_dir}{format_part(lon_deg,3)}° {format_part(lon_min,2)}.{format_part(lon_decimal,3)}"
        
        logger.debug('Coordonnées formatées: %s %s', lat_formatted, lon_formatted)
        
        result = {
            "coordinates": f"{lat_formatted} {lon_formatted}",
            "latitude": lat_formatted,
            "longitude": lon_formatted,
            "status": global_status,
            "lat_status": lat_status,
            "lon_status": lon_status
        }
        
        # Ajouter les coordonnées décimales pour l'affichage automatique sur la carte
        if global_status == "complete":
            try:
                decimal_coords = convert_ddm_to_decimal(lat_formatted, lon_formatted)
                result["decimal_latitude"] = decimal_coords["latitude"]
                result["decimal_longitude"] = decimal_coords["longitude"]
                logger.debug('Coordonnées décimales calculées: lat=%s, lon=%s', decimal_coords['latitude'], decimal_coords['longitude'])
            except Exception as e:
                logger.warning('Erreur lors de la conversion en coordonnées décimales: %s', str(e))
                # Ne pas faire échouer l'appel si la conversion échoue
        
        # Si nous avons des coordonnées d'origine et que les coordonnées calculées sont complètes, 
        # calculer la distance entre les deux
        logger.debug("Vérification des conditions pour le calcul de distance:")
        logger.debug('- origin_lat: %s (%s)', origin_lat, type(origin_lat).__name__ if origin_lat else 'None')
        logger.debug('- origin_lon: %s (%s)', origin_lon, type(origin_lon).__name__ if origin_lon else 'None')
        logger.debug('- global_status: %s', global_status)
        logger.debug('- lat_decimal_value: %s (%s)', lat_decimal, type(lat_decimal).__name__)
        logger.debug('- lon_decimal_value: %s (%s)', lon_decimal, type(lon_decimal).__name__)
        
        if origin_lat and origin_lon and global_status == "complete" and isinstance(lat_decimal, (int, float)) and isinstance(lon_decimal, (int, float)):
            try:
                logger.debug("Conditions remplies pour calculer la distance entre les coordonnées")
                logger.debug('Origin lat: %s, Origin lon: %s', origin_lat, origin_lon)
                logger.debug('Destination lat: %s, Destination lon: %s', lat_formatted, lon_formatted)
                distance_info = calculate_distance_between_coords(
                    origin_lat=origin_lat,
                    origin_lon=origin_lon,
                    dest_lat=lat_formatted,
                    dest_lon=lon_formatted
                )
                result["distance_from_origin"] = distance_info
                logger.debug('Distance calculée: %s', distance_info)
            except Exception as e:
                logger.error('Erreur lors du calcul de la distance: %s', str(e))
                traceback.print_exc()
        else:
            logger.debug('Calcul de distance impossible: origin_lat=%s, origin_lon=%s, global_status=%s', origin_lat, origin_lon, global_status)
            logger.debug('lat_decimal_value est de type %s: %s', type(lat_decimal).__name__, lat_decimal)
            logger.debug('lon_decimal_value est de type %s: %s', type(lon_decimal).__name__, lon_decimal)
        
        logger.debug('Résultat final: %s', result)
        return jsonify(result)
        
    except Exception as e:
        return _error_response("Erreur lors du calcul des coordonnées", e)

def calculate_distance_between_coords(origin_lat, origin_lon, dest_lat, dest_lon):
    """
    Calcule la distance entre deux coordonnées au format DDM
    
    Args:
        origin_lat (str): Latitude d'origine au format DDM (ex: "N48° 40.123")
        origin_lon (str): Longitude d'origine au format DDM (ex: "E06° 10.456")
        dest_lat (str): Latitude de destination au format DDM (ex: "N48° 39.286")
        dest_lon (str): Longitude de destination au format DDM (ex: "E06°11.685")
        
    Returns:
        dict: Dictionnaire contenant la distance en mètres, en miles et un statut
    """
    logger.debug("*** DÉBUT CALCUL DISTANCE ***")
    logger.debug('Origine: %s %s', origin_lat, origin_lon)
    logger.debug('Destination: %s %s', dest_lat, dest_lon)
    
    # Convertir les coordonnées DDM en format décimal
    origin_coords = convert_ddm_to_decimal(origin_lat, origin_lon)
    dest_coords = convert_ddm_to_decimal(dest_lat, dest_lon)
    
    logger.debug('Origine (décimal): lat=%s, lon=%s', origin_coords['latitude'], origin_coords['longitude'])
    logger.debug('Destination (décimal): lat=%s, lon=%s', dest_coords['latitude'], dest_coords['longitude'])
    
    if not origin_coords['latitude'] or not origin_coords['longitude'] or not dest_coords['latitude'] or not dest_coords['longitude']:
        logger.error("Conversion des coordonnées en décimal impossible")
        raise ValueError("Impossible de convertir les coordonnées en format décimal")
    
    # Calculer la distance avec Geod
    if Geod is None:
        raise RuntimeError(
            "Le module 'pyproj' n'est pas installé. "
            "Installez-le pour activer le calcul de distance (pip install pyproj)."
        )
    geod = Geod(ellps="WGS84")
    _, _, distance_m = geod.inv(
        origin_coords['longitude'], origin_coords['latitude'],
        dest_coords['longitude'], dest_coords['latitude']
    )
    
    # Convertir en miles (1 mile = 1609.344 mètres)
    distance_miles = distance_m / 1609.344
    
    logger.debug('Distance calculée: %s mètres (%s miles)', distance_m, distance_miles)
    
    # Déterminer le statut selon la règle géocaching des "2 miles"
    # (voir DISTANCE_WARNING_MILES / DISTANCE_FAR_MILES).
    status = "ok"
    if distance_miles > DISTANCE_FAR_MILES:
        status = "far"
        logger.debug("Statut: FAR - Distance > %s miles", DISTANCE_FAR_MILES)
    elif distance_miles > DISTANCE_WARNING_MILES:
        status = "warning"
        logger.debug("Statut: WARNING - Distance entre %s et %s miles", DISTANCE_WARNING_MILES, DISTANCE_FAR_MILES)
    else:
        logger.debug("Statut: OK - Distance < %s miles", DISTANCE_WARNING_MILES)
    
    logger.debug("*** FIN CALCUL DISTANCE ***")
    
    return {
        "meters": round(distance_m, 2),
        "miles": round(distance_miles, 2),
        "status": status
    }

def _process_formula_part(formula_part, variables):
    """
    Traite une partie de formule (généralement la partie décimale des minutes)
    et remplace les variables par leurs valeurs si disponibles.
    
    Args:
        formula_part: Partie de la formule à traiter (peut être une expression entre parenthèses)
        variables: Dictionnaire des variables avec leurs valeurs
        
    Returns:
        Le résultat calculé ou l'expression partiellement résolue
    """
    logger.debug("_process_formula_part: Traitement de '%s' avec variables %s", formula_part, variables)
    
    # Si ce n'est pas une expression entre parenthèses initiale, mais peut contenir des sous-expressions
    if not formula_part.startswith('('):
        # Si c'est juste un chiffre, le retourner directement
        if formula_part.isdigit():
            return int(formula_part)
        
        # Si la formule contient des lettres majuscules, la traiter comme une expression
        if re.search(r'[A-Z]', formula_part):
            logger.debug("Détection de lettres dans '%s', traitement comme expression", formula_part)
            # Remplacer les lettres par leurs valeurs si disponibles
            expression = formula_part
            has_letters_with_values = False
            
            for var, value in variables.items():
                if var in expression:
                    has_letters_with_values = True
                    expression = expression.replace(var, str(value))
            
            # Si aucune lettre n'a été remplacée, retourner l'expression telle quelle
            if not has_letters_with_values:
                logger.debug("Aucune variable disponible pour '%s', retour tel quel", formula_part)
                return formula_part
            
            # Si l'expression contient des parenthèses après le remplacement, essayer de résoudre les sous-expressions
            if '(' in expression and ')' in expression:
                # Chercher toutes les sous-expressions entre parenthèses simples
                sub_expr_pattern = r'\(([^()]+)\)'
                while re.search(sub_expr_pattern, expression):
                    # Évaluer la sous-expression
                    expression = re.sub(sub_expr_pattern, lambda m: str(_evaluate_math_expression(m.group(1).replace('x', '*'))), expression)
                    
                    # Si l'expression contient un marqueur d'erreur, arrêter le traitement
                    if 'ERR:' in expression:
                        # Extraire et retourner l'expression originale avec parenthèses
                        parts = expression.split(':')
                        if len(parts) >= 3:
                            return f"({parts[2]})"
                
                # Si après résolution des sous-expressions il ne reste plus de lettres, évaluer l'expression complète
                if not re.search(r'[A-Z]', expression):
                    result = _evaluate_math_expression(expression)
                    # Vérifier si le résultat contient un marqueur d'erreur
                    if isinstance(result, str) and result.startswith('ERR:'):
                        # Extraire et retourner l'expression originale avec parenthèses
                        parts = result.split(':')
                        if len(parts) >= 3:
                            return f"({parts[2]})"
                    logger.debug('Résultat final: %s', result)
                    return result
        
        # Sinon, retourner tel quel
        return formula_part
    
    # Si la partie commence et se termine par des parenthèses, vérifier si c'est une concaténation de sous-expressions
    # Exemple: (A+B)(C-D)(E/2)
    if re.fullmatch(r'(\([^()]+\))+', formula_part):
        sub_expressions = re.findall(r'\(([^()]+)\)', formula_part)
        evaluated_parts = []
        has_error = False
        rebuilt_on_error = []
        for sub in sub_expressions:
            sub_expr = sub.replace('x', '*')
            # Remplacer les variables
            for var, value in variables.items():
                if var in sub_expr:
                    sub_expr = sub_expr.replace(var, str(value))
            # Si des lettres restent, on ne peut pas évaluer cette sous-expression
            if re.search(r'[A-DF-Z]', sub_expr):
                has_error = True
                rebuilt_on_error.append(f'({sub_expr})')
                continue
            # Évaluer la sous-expression
            sub_result = _evaluate_math_expression(sub_expr)
            if isinstance(sub_result, str) and sub_result.startswith('ERR:'):
                has_error = True
                # Conserver la sous-expression fautive telle quelle avec parenthèses
                rebuilt_on_error.append(f'({sub_expr})')
            else:
                evaluated_parts.append(str(sub_result))
                rebuilt_on_error.append(str(sub_result))
        # Si une erreur ou une lettre non résolue existe, retourner l'expression reconstruite entre parenthèses
        if has_error:
            return '(' + ''.join(rebuilt_on_error) + ')'
        # Sinon, concaténer les résultats numériques et retourner un entier pour permettre le formatage (zfill)
        concatenated = ''.join(evaluated_parts) if evaluated_parts else ''
        try:
            return int(concatenated) if concatenated != '' else 0
        except ValueError:
            # Fallback prudente
            return '(' + ''.join(rebuilt_on_error) + ')'

    # Cas standard: une seule parenthèse englobante, traiter comme expression unique
    # Extraire l'expression entre parenthèses
    expression = formula_part[1:-1] if formula_part.endswith(')') else formula_part[1:]
    
    # Remplacer les multiplications 'x' par '*' pour l'évaluation
    expression = expression.replace('x', '*')
    
    # Remplacer les variables par leurs valeurs
    for var, value in variables.items():
        if var in expression:
            expression = expression.replace(var, str(value))
    
    # Vérifier si toutes les variables ont été remplacées
    # Si l'expression contient encore des lettres majuscules (sauf E pour notation scientifique)
    if re.search(r'[A-DF-Z]', expression):
        # Retourner l'expression partiellement résolue
        return f"({expression})"
    
    # Évaluer l'expression mathématique
    result = _evaluate_math_expression(expression)
    # Vérifier si le résultat contient un marqueur d'erreur
    if isinstance(result, str) and result.startswith('ERR:'):
        # Extraire et retourner l'expression originale avec parenthèses
        parts = result.split(':')
        if len(parts) >= 3:
            return f"({parts[2]})"
    return result

# Opérateurs autorisés dans l'évaluateur arithmétique sûr.
# La puissance (Pow) est volontairement exclue : la regex de parsing de formule
# ne l'autorise pas, et elle permettrait des expressions coûteuses (ex: 9**9**9).
_SAFE_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_SAFE_UNARYOPS = (ast.UAdd, ast.USub)


def _safe_eval_arithmetic(expression: str) -> float:
    """
    Évalue une expression purement arithmétique (+ - * / et parenthèses) sans
    utiliser eval(). Remplace l'ancien eval() qui exposait le endpoint
    /api/calculate_coordinates à de l'exécution de code arbitraire.

    Lève ValueError si l'expression contient autre chose que des nombres et les
    opérateurs autorisés.
    """
    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError as exc:
        raise ValueError(f"Expression invalide: {expression}") from exc

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise ValueError(f"Constante non numérique: {node.value!r}")
            return node.value
        if isinstance(node, ast.BinOp) and isinstance(node.op, _SAFE_BINOPS):
            left = _eval(node.left)
            right = _eval(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            return left / right
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, _SAFE_UNARYOPS):
            operand = _eval(node.operand)
            return operand if isinstance(node.op, ast.UAdd) else -operand
        raise ValueError(f"Élément non autorisé dans l'expression: {ast.dump(node)}")

    return _eval(tree)


def _evaluate_math_expression(expression):
    """
    Évalue une expression mathématique et vérifie que le résultat est un entier.

    Args:
        expression: L'expression mathématique à évaluer (sans lettres, uniquement des chiffres et opérateurs)

    Returns:
        Le résultat arrondi si c'est un nombre entier ou proche d'un entier
        Sinon, retourne l'expression originale entre parenthèses avec un marqueur d'erreur
    """
    logger.debug("_evaluate_math_expression: Évaluation de '%s'", expression)

    try:
        # Évaluer l'expression via un évaluateur AST restreint (pas d'eval())
        result = _safe_eval_arithmetic(expression)
        logger.debug('_evaluate_math_expression: Résultat brut = %s', result)
        
        # Vérifier si le résultat est un nombre
        if isinstance(result, (int, float)):
            # Vérifier si c'est un entier ou très proche d'un entier (tolérance pour les erreurs de virgule flottante)
            if abs(result - round(result)) < 1e-10:
                return round(result)
            else:
                # Si c'est une valeur décimale significative, signaler l'erreur mais ne pas lever d'exception
                error_msg = f"L'expression '{expression}' donne un résultat non entier: {result}"
                logger.error('%s', error_msg)
                # Retourner l'expression originale avec un marqueur spécial pour la gestion des erreurs
                return f"ERR:NONINTEGER:{expression}"
    except Exception as e:
        logger.error("Impossible d'évaluer l'expression '%s': %s", expression, str(e))
        # Retourner l'expression originale avec un marqueur d'erreur
        return f"ERR:SYNTAX:{expression}"
    
    return result

# ------------------------------------------------------------------------------
# Utilitaires de validation des composantes DDM
# ------------------------------------------------------------------------------

def _is_valid_degrees_minutes(lat_deg: int, lat_min: float, lon_deg: int, lon_min: float) -> bool:
    """
    Valide les bornes des degrés et minutes pour une coordonnée DDM.
    - Latitude degrés: 0 à 90
    - Longitude degrés: 0 à 180
    - Minutes: 0 à < 60
    """
    try:
        if lat_deg < 0 or lat_deg > 90:
            return False
        if lon_deg < 0 or lon_deg > 180:
            return False
        if lat_min < 0 or lat_min >= 60:
            return False
        if lon_min < 0 or lon_min >= 60:
            return False
        return True
    except Exception:
        return False


def _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec) -> bool:
    """Valide des composantes deg/min/millièmes séparées (min et sec/millièmes).

    Reconstitue les minutes décimales (``min.sec``) puis délègue à
    ``_is_valid_degrees_minutes``. Retourne False sur toute entrée non numérique.
    """
    try:
        return _is_valid_degrees_minutes(
            int(lat_deg), float(f"{lat_min}.{lat_sec}"),
            int(lon_deg), float(f"{lon_min}.{lon_sec}"),
        )
    except (TypeError, ValueError):
        return False


def _format_ddm_minutes(min_str: str) -> str:
    """Normalise une chaîne de minutes en ``MM.ddd`` (format géocaching).

    - complète la partie entière à 2 chiffres (zfill) ;
    - complète/tronque la partie décimale à exactement 3 chiffres ;
    - ``"5"`` -> ``"05.000"``, ``"32.46"`` -> ``"32.460"``, ``"32.4636"`` -> ``"32.463"``.

    La virgule décimale éventuelle doit avoir été remplacée par un point en amont.
    """
    if '.' in min_str:
        whole, dec = min_str.split('.', 1)
        return f"{whole.zfill(2)}.{dec.ljust(3, '0')[:3]}"
    return f"{min_str.zfill(2)}.000"


def _canonical_ddm_component(ddm_str: str, deg_digits: int) -> Optional[str]:
    """Re-formate une composante DDM au format canonique ``X DD° MM.ddd'``.

    Utilisé dans ``_finalize_detection`` pour garantir une représentation unique
    quel que soit le détecteur gagnant : degrés complétés à ``deg_digits``
    chiffres (2 pour une latitude, 3 pour une longitude), minutes normalisées
    par ``_format_ddm_minutes``.

    Retourne ``None`` si la chaîne n'est pas interprétable : l'appelant conserve
    alors la chaîne d'origine (on ne casse jamais une détection valide).
    """
    if not ddm_str:
        return None
    match = DDM_COMPONENT_REGEX.search(str(ddm_str).strip())
    if not match:
        return None
    direction, degrees, minutes = match.groups()
    minutes = minutes.replace(',', '.')
    return f"{direction.upper()} {degrees.zfill(deg_digits)}° {_format_ddm_minutes(minutes)}'"

# ------------------------------------------------------------------------------
# Fonction utilitaire pour formater une chaîne de chiffres en DDM
# ------------------------------------------------------------------------------

def _format_coordinate(coord_str: str, expected_deg_digits: int) -> str:
    """
    Transforme une chaîne de chiffres en une chaîne formatée en DDM.
    
    Exemple :
      - Pour la latitude "4833787" (expected_deg_digits=2), cela donne "48° 33.787'".
      - Pour la longitude "00638803" (expected_deg_digits=3), cela donne "006° 38.803'".
    
    :param coord_str: La chaîne de chiffres (sans séparateur).
    :param expected_deg_digits: Nombre de chiffres pour la partie degrés (2 pour la latitude, 3 pour la longitude).
    :return: La coordonnée formatée en DDM.
    :raises ValueError: Si la chaîne est trop courte.
    """
    logger.debug("_format_coordinate: Formatage de '%s' avec %s chiffres pour les degrés", coord_str, expected_deg_digits)
    
    if len(coord_str) < expected_deg_digits + 2:
        logger.debug('_format_coordinate: Erreur - Chaîne trop courte (%s < %s)', len(coord_str), expected_deg_digits + 2)
        raise ValueError("Chaîne de coordonnées trop courte pour le format attendu.")
    
    # Les degrés sont les premiers chiffres
    deg = coord_str[:expected_deg_digits]
    # Les deux chiffres suivants correspondent à la partie entière des minutes
    minutes_int = coord_str[expected_deg_digits:expected_deg_digits+2]
    # Le reste (s'il existe) correspond à la partie décimale des minutes
    decimal_part = coord_str[expected_deg_digits+2:]
    
    logger.debug('_format_coordinate: Décomposition - degrés=%s, minutes_int=%s, decimal_part=%s', deg, minutes_int, decimal_part)
    
    if decimal_part:
        minutes = f"{minutes_int}.{decimal_part}"
    else:
        minutes = minutes_int
        
    result = f"{deg}° {minutes}'"
    logger.debug('_format_coordinate: Résultat formaté: %s', result)
    return result

# ------------------------------------------------------------------------------
# Détection du format DMM classique (par exemple "N 48° 33.787' E 006° 38.803'")
# ------------------------------------------------------------------------------

# Pattern DDM « classique » : N/S deg° min[.,]dec E/W deg° min[.,]dec.
_DETECT_DMM_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})\s*[°º]\s*(\d{1,2}(?:[.,]\d+)?)[\'"]?\s*'
    r'([EW])\s*(\d{1,3})\s*[°º]\s*(\d{1,2}(?:[.,]\d+)?)[\'"]?'
)


def _iter_dmm_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """Itère tous les candidats DMM valides (un match invalide ne masque plus les suivants)."""
    logger.debug("_iter_dmm_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_dmm_coordinates: Regex utilisée: %s', _DETECT_DMM_REGEX)
    for match in _DETECT_DMM_REGEX.finditer(text):
        logger.debug('_iter_dmm_coordinates: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min = match.groups()
        # Uniformiser la virgule décimale éventuelle avant conversion/formatage
        lat_min = lat_min.replace(',', '.')
        lon_min = lon_min.replace(',', '.')
        # Normaliser minutes en float pour validation bornes
        try:
            lat_min_f = float(lat_min)
            lon_min_f = float(lon_min)
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_f, int(lon_deg), lon_min_f):
                logger.debug("_iter_dmm_coordinates: Bornes invalides, candidat suivant")
                continue
        except Exception:
            continue
        ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}'"
        ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}'"
        logger.debug('_iter_dmm_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)
        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_dmm_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat DMM valide (compat : API historique en façade de l'itérateur)."""
    return next(_iter_dmm_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format avec tabulations et espaces (ex: "N 48 ° 32 . 296 E 6 ° 40 . 636")
# ------------------------------------------------------------------------------

# Pattern plus souple qui accepte des variations dans les espaces et la
# ponctuation (DOTALL conservé du code d'origine).
_DETECT_TABSPACE_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})\s*°\s*(\d{1,2})\s*[.,]\s*(\d{1,3})\s*'
    r'([EW])\s*(\d{1,3})\s*°\s*(\d{1,2})\s*[.,]\s*(\d{1,3})',
    re.DOTALL,
)


def _iter_tabspace_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format avec tabulations et espaces, par exemple :
      - "N    48 ° 32 .  296\nE    6  ° 40 .  636"
      - "N\t48 ° 32 . 296\r\nE\t6 ° 40 . 636"

    Ce format est plus souple et accepte des variations dans les espaces et la ponctuation.
    """
    logger.debug("_iter_tabspace_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_tabspace_coordinates: Regex utilisée: %s', _DETECT_TABSPACE_REGEX)
    for match in _DETECT_TABSPACE_REGEX.finditer(text):
        logger.debug('_iter_tabspace_coordinates: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()

        # Formatage des coordonnées
        try:
            lat_min_f = float(f"{lat_min}.{lat_sec}")
            lon_min_f = float(f"{lon_min}.{lon_sec}")
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_f, int(lon_deg), lon_min_f):
                logger.debug("_iter_tabspace_coordinates: Bornes invalides, candidat suivant")
                continue
        except Exception:
            continue

        ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_sec}'"
        ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_sec}'"

        logger.debug('_iter_tabspace_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_tabspace_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « tabspace » valide (compat : façade de l'itérateur)."""
    return next(_iter_tabspace_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format variant (ex : "NORD 4833787 EST 638803")
# ------------------------------------------------------------------------------

# Le pattern autorise espaces, retours à la ligne ou "/" comme séparateurs.
_DETECT_VARIANT_REGEX = re.compile(
    r"(?P<lat_dir>[NS])\s*[/\n\s]*\s*(?P<lat>\d{7})\s*(?P<lon_dir>[EW])\s*[/\n\s]*\s*(?P<lon>\d{6,8})"
)


def _iter_variant_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format variant, par exemple :
      - "NORD 4833787 EST 638803"
      - "NORD\n4833787\nEST\n638803"
      - "Nord / 4833787 / Est / 638803"

    Le texte est déjà normalisé : les mots cardinaux sont réduits à une lettre
    (N/S et E/W acceptés). Pour la latitude, on attend une chaîne de 7 chiffres,
    et pour la longitude une chaîne de 6 à 8 chiffres.
    Si la longitude comporte moins de 8 chiffres, on la complète avec des zéros à gauche.
    """
    logger.debug("_iter_variant_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_variant_coordinates: Pattern utilisé: %s', _DETECT_VARIANT_REGEX)
    for match in _DETECT_VARIANT_REGEX.finditer(text):
        logger.debug('_iter_variant_coordinates: Match trouvé! Groupes: %s', match.groupdict())
        lat_dir_raw = match.group("lat_dir")
        lon_dir_raw = match.group("lon_dir")
        lat_digits  = match.group("lat")
        lon_digits  = match.group("lon")

        logger.debug('_iter_variant_coordinates: Directions brutes: lat=%s, lon=%s', lat_dir_raw, lon_dir_raw)
        logger.debug('_iter_variant_coordinates: Digits: lat=%s, lon=%s', lat_digits, lon_digits)

        # Les lettres normalisées sont déjà canoniques ; .upper() par sécurité
        lat_dir = lat_dir_raw.upper()
        lon_dir = lon_dir_raw.upper()

        logger.debug('_iter_variant_coordinates: Directions normalisées: lat=%s, lon=%s', lat_dir, lon_dir)

        try:
            # Pour la latitude, si nécessaire, compléter à 7 chiffres
            if len(lat_digits) < 7:
                lat_digits = lat_digits.zfill(7)
            ddm_lat = f"{lat_dir} " + _format_coordinate(lat_digits, expected_deg_digits=2)
            logger.debug('_iter_variant_coordinates: Latitude formatée: %s', ddm_lat)
        except ValueError as e:
            logger.debug('_iter_variant_coordinates: Erreur lors du formatage de la latitude: %s', e)
            ddm_lat = None

        try:
            # Pour la longitude, compléter à 8 chiffres si nécessaire
            if len(lon_digits) < 8:
                lon_digits = lon_digits.zfill(8)
            ddm_lon = f"{lon_dir} " + _format_coordinate(lon_digits, expected_deg_digits=3)
            logger.debug('_iter_variant_coordinates: Longitude formatée: %s', ddm_lon)
        except ValueError as e:
            logger.debug('_iter_variant_coordinates: Erreur lors du formatage de la longitude: %s', e)
            ddm_lon = None

        if ddm_lat and ddm_lon:
            logger.debug('_iter_variant_coordinates: Coordonnées complètes détectées: %s %s', ddm_lat, ddm_lon)
            yield {
                "span": [match.start(), match.end()],
                "exist": True,
                "ddm_lat": ddm_lat,
                "ddm_lon": ddm_lon,
                "ddm": f"{ddm_lat} {ddm_lon}"
            }
        else:
            logger.debug("_iter_variant_coordinates: Coordonnées incomplètes, candidat suivant")


def _detect_variant_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « variant » valide (compat : façade de l'itérateur)."""
    return next(_iter_variant_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format spécifique avec tabulations et points (ex: "N\t48 ° 32 . 296\nE\t6 ° 40 . 636")
# ------------------------------------------------------------------------------

# Pattern très spécifique au format « tabpoint ».
# Le séparateur latitude/longitude est borné : au plus MAX_COORD_PAIR_GAP
# caractères non numériques. Les chiffres sont interdits dans le gap pour
# éviter de traverser une autre coordonnée ; sans cette borne, une latitude
# et une longitude très éloignées (waypoints distincts) étaient appariées.
# La borne est interpolée à la compilation (une seule fois au chargement).
# re.DOTALL inutile : le gap [^\d] matche déjà les retours à la ligne.
_DETECT_SPECIFIC_TABPOINT_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})\s*°\s*(\d{1,2})\s*\.\s*(\d{1,3})'
    rf'[^\d]{{0,{MAX_COORD_PAIR_GAP}}}'
    r'([EW])\s*(\d{1,3})\s*°\s*(\d{1,2})\s*\.\s*(\d{1,3})'
)


def _iter_specific_tabpoint_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format très spécifique avec tabulations et points, comme dans l'exemple :
      - "N\t48 ° 32 .  296\r\nE\t6  ° 40 .  636"
    N/S et E/W acceptés.

    Cette fonction est optimisée pour ce format particulier.
    """
    logger.debug("_iter_specific_tabpoint_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_specific_tabpoint_coordinates: Regex utilisée: %s', _DETECT_SPECIFIC_TABPOINT_REGEX)
    for match in _DETECT_SPECIFIC_TABPOINT_REGEX.finditer(text):
        logger.debug('_iter_specific_tabpoint_coordinates: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()

        if not _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec):
            logger.debug("_iter_specific_tabpoint_coordinates: Bornes invalides, candidat suivant")
            continue

        # Formatage des coordonnées
        ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_sec}'"
        ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_sec}'"

        logger.debug('_iter_specific_tabpoint_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_specific_tabpoint_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « tabpoint » valide (compat : façade de l'itérateur)."""
    return next(_iter_specific_tabpoint_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection simplifiée pour le format exact de l'exemple
# ------------------------------------------------------------------------------

# Séquences de chiffres consécutifs (extraction des composantes par ligne).
_DIGITS_RUN_REGEX = re.compile(r'\d+')


def _iter_simplified_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Détection simplifiée pour le format exact de l'exemple.
    Cette fonction utilise une approche plus directe : logique ligne-par-ligne,
    elle produit au plus UN candidat, sans ``span`` (le résultat porte sur les
    deux premières lignes, pas sur un fragment contigu ; ``_finalize_detection``
    gère ``span=None`` en retombant sur le texte complet).
    """
    logger.debug("_iter_simplified_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])

    # Extraction des lignes
    lines = text.strip().split('\n')
    logger.debug('_iter_simplified_coordinates: Lignes extraites: %s', lines)

    if len(lines) >= 2:
        # Vérifier si la première ligne commence par N/S et la deuxième par E/W
        # (le texte normalisé porte déjà les lettres cardinales en majuscules).
        lat_line = lines[0].strip()
        lon_line = lines[1].strip()

        logger.debug("_iter_simplified_coordinates: Ligne latitude: '%s'", lat_line)
        logger.debug("_iter_simplified_coordinates: Ligne longitude: '%s'", lon_line)

        if lat_line[:1] in ('N', 'S') and lon_line[:1] in ('E', 'W'):
            lat_dir = lat_line[0]
            lon_dir = lon_line[0]
            # Extraction des nombres de la latitude
            lat_parts = _DIGITS_RUN_REGEX.findall(lat_line)
            lon_parts = _DIGITS_RUN_REGEX.findall(lon_line)

            logger.debug('_iter_simplified_coordinates: Parties latitude: %s', lat_parts)
            logger.debug('_iter_simplified_coordinates: Parties longitude: %s', lon_parts)

            if len(lat_parts) >= 3 and len(lon_parts) >= 3:
                lat_deg, lat_min, lat_sec = lat_parts[0], lat_parts[1], lat_parts[2]
                lon_deg, lon_min, lon_sec = lon_parts[0], lon_parts[1], lon_parts[2]

                if not _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec):
                    logger.debug("_iter_simplified_coordinates: Bornes invalides, rejet")
                    return

                # Formatage des coordonnées
                ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_sec}'"
                ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_sec}'"

                logger.debug('_iter_simplified_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

                yield {
                    "exist": True,
                    "ddm_lat": ddm_lat,
                    "ddm_lon": ddm_lon,
                    "ddm": f"{ddm_lat} {ddm_lon}"
                }
                return

    logger.debug("_iter_simplified_coordinates: Aucune coordonnée détectée")


def _detect_simplified_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Candidat « simplified » éventuel (compat : façade de l'itérateur)."""
    return next(_iter_simplified_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection ultra-flexible pour tout format avec N/E et degrés
# ------------------------------------------------------------------------------

# Composantes « flexibles » : lettre cardinale + degrés (°/deg/degrees) +
# minutes + décimales, en deux recherches indépendantes (lat puis lon).
_DETECT_FLEXIBLE_LAT_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})(?:\s*[°º]|\s+deg|\s+degrees)\s*(\d{1,2})(?:[.,]\s*|\s+)(\d{1,3})',
    re.IGNORECASE,
)
_DETECT_FLEXIBLE_LON_REGEX = re.compile(
    r'([EW])\s*(\d{1,3})(?:\s*[°º]|\s+deg|\s+degrees)\s*(\d{1,2})(?:[.,]\s*|\s+)(\d{1,3})',
    re.IGNORECASE,
)


def _iter_flexible_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère toutes les paires latitude/longitude « flexibles » valides du texte.

    Contrairement à l'ancienne version (un seul ``search`` par composante), on
    apparie ici CHAQUE latitude avec CHAQUE longitude dont l'écart bidirectionnel
    reste sous MAX_COORD_PAIR_GAP : une première paire trop éloignée ou hors
    bornes ne masque plus les combinaisons valides suivantes. Si des lat/lon
    existent mais qu'aucune paire ne respecte le gap, aucun candidat n'est émis
    (comportement historique conservé).
    """
    logger.debug("_iter_flexible_coordinates: Analyse du texte: '%s'", text)

    # Recherche de toutes les composantes N/S et E/W + degrés
    lat_matches = list(_DETECT_FLEXIBLE_LAT_REGEX.finditer(text))
    lon_matches = list(_DETECT_FLEXIBLE_LON_REGEX.finditer(text))

    logger.debug('_iter_flexible_coordinates: %s match latitude, %s match longitude',
                 len(lat_matches), len(lon_matches))

    for lat_match in lat_matches:
        for lon_match in lon_matches:
            # Les deux composantes doivent être proches l'une de l'autre (dans
            # n'importe quel ordre : le format "E ... N ..." est aussi accepté).
            # Au-delà de MAX_COORD_PAIR_GAP caractères, ce sont vraisemblablement
            # deux coordonnées indépendantes qu'il ne faut pas apparier.
            gap = max(lon_match.start() - lat_match.end(),
                      lat_match.start() - lon_match.end(), 0)
            if gap > MAX_COORD_PAIR_GAP:
                continue

            lat_dir, lat_deg, lat_min, lat_sec = lat_match.groups()
            lon_dir, lon_deg, lon_min, lon_sec = lon_match.groups()

            if not _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec):
                logger.debug("_iter_flexible_coordinates: Bornes invalides, paire suivante")
                continue

            # Formatage des coordonnées (lettres canoniques en majuscules)
            ddm_lat = f"{lat_dir.upper()} {lat_deg}° {lat_min}.{lat_sec}'"
            ddm_lon = f"{lon_dir.upper()} {lon_deg}° {lon_min}.{lon_sec}'"

            logger.debug('_iter_flexible_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

            yield {
                "span": [min(lat_match.start(), lon_match.start()), max(lat_match.end(), lon_match.end())],
                "exist": True,
                "ddm_lat": ddm_lat,
                "ddm_lon": ddm_lon,
                "ddm": f"{ddm_lat} {ddm_lon}"
            }


def _detect_flexible_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « flexible » valide (compat : façade de l'itérateur)."""
    return next(_iter_flexible_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format NORD/EST avec chiffres séparés par des espaces
# ------------------------------------------------------------------------------

# Pattern pour détecter la lettre cardinale suivie de chiffres séparés par
# des espaces (les mots « nord/est/sud/ouest… » ont été blankés en amont).
_DETECT_NORD_EST_REGEX = re.compile(
    r'([NS])\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})(?:\s+|\s*[/\n]\s*)([EW])\s+(\d{1,3})\s+(\d{1,2})\s+(\d{1,3})'
)


def _iter_nord_est_format(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format NORD/EST avec chiffres séparés par des espaces, par exemple :
      - "NORD 48 32 296 EST 6 40 636"
      - "Nord 48 32 296 Est 6 40 636"

    Ce format est spécifique aux coordonnées normalisées après décodage :
    les mots cardinaux y sont déjà réduits à leur lettre (N/S et E/W acceptés).
    """
    logger.debug("_iter_nord_est_format: Analyse du texte: '%s'", text)
    logger.debug('_iter_nord_est_format: Regex utilisée: %s', _DETECT_NORD_EST_REGEX)
    for match in _DETECT_NORD_EST_REGEX.finditer(text):
        logger.debug('_iter_nord_est_format: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()

        if not _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec):
            logger.debug("_iter_nord_est_format: Bornes invalides, candidat suivant")
            continue

        # Formatage des coordonnées
        ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_sec}'"
        ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_sec}'"

        logger.debug('_iter_nord_est_format: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_nord_est_format(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « nord/est » valide (compat : façade de l'itérateur)."""
    return next(_iter_nord_est_format(text), None)

# ------------------------------------------------------------------------------
# Détection du format NORD/EST avec variations
# ------------------------------------------------------------------------------

# Extraction des nombres après la lettre cardinale (les mots « nord/est… »
# ont déjà été réduits à N/S/E/W par la normalisation amont). La lettre
# doit être isolée — ni précédée ni suivie d'une lettre — pour ne pas la
# lire dans un mot capitalisé (« Session 48 32 296 Errors 6 40 636 »).
_DETECT_NE_VAR_NORD_REGEX = re.compile(
    r'(?<![^\W\d_])([NS])(?![^\W\d_])[^\d]*(\d{1,2})[^\d]*(\d{1,2})[^\d]*(\d{1,3})'
)
_DETECT_NE_VAR_EST_REGEX = re.compile(
    r'(?<![^\W\d_])([EW])(?![^\W\d_])[^\d]*(\d{1,3})[^\d]*(\d{1,2})[^\d]*(\d{1,3})'
)


def _iter_nord_est_variations(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format NORD/EST avec diverses variations possibles, par exemple :
      - "NORD 48 32 296 EST 6 40 636"
      - "NORD48 32 296EST6 40 636"
      - "NORD48.32.296 EST6.40.636"

    Cette fonction est très flexible et tolérante aux variations de format.
    Après normalisation, les mots cardinaux sont des lettres : N/S et E/W acceptés.
    Comme _iter_flexible_coordinates, toutes les paires lat/lon sous le gap
    MAX_COORD_PAIR_GAP sont émises (l'ancien code ne testait que le premier
    match de chaque composante).
    """
    logger.debug("_iter_nord_est_variations: Analyse du texte: '%s'", text)

    # Extraction des nombres après la lettre cardinale (les mots « nord/est… »
    # ont déjà été réduits à N/S/E/W par la normalisation amont).
    nord_matches = list(_DETECT_NE_VAR_NORD_REGEX.finditer(text))
    est_matches = list(_DETECT_NE_VAR_EST_REGEX.finditer(text))

    logger.debug('_iter_nord_est_variations: %s match NORD, %s match EST',
                 len(nord_matches), len(est_matches))

    for nord_match in nord_matches:
        for est_match in est_matches:
            # Même règle que _iter_flexible_coordinates : les deux composantes
            # doivent être proches (dans n'importe quel ordre), sinon ce sont
            # vraisemblablement deux coordonnées indépendantes.
            gap = max(est_match.start() - nord_match.end(),
                      nord_match.start() - est_match.end(), 0)
            if gap > MAX_COORD_PAIR_GAP:
                continue

            lat_dir, lat_deg, lat_min, lat_sec = nord_match.groups()
            lon_dir, lon_deg, lon_min, lon_sec = est_match.groups()

            if not _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec):
                logger.debug("_iter_nord_est_variations: Bornes invalides, paire suivante")
                continue

            # Formatage des coordonnées
            ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_sec}'"
            ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_sec}'"

            logger.debug('_iter_nord_est_variations: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

            yield {
                "span": [min(nord_match.start(), est_match.start()), max(nord_match.end(), est_match.end())],
                "exist": True,
                "ddm_lat": ddm_lat,
                "ddm_lon": ddm_lon,
                "ddm": f"{ddm_lat} {ddm_lon}"
            }


def _detect_nord_est_variations(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « nord/est variations » valide (compat : façade de l'itérateur)."""
    return next(_iter_nord_est_variations(text), None)

# ------------------------------------------------------------------------------
# Détection du format DMS (degrés, minutes, secondes)
# ------------------------------------------------------------------------------

# Pattern du format DMS (degrés, minutes, secondes).
_DETECT_DMS_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:\.\d+)?)[\"\']*\s*'
    r'([EW])\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:\.\d+)?)[\"\']*'
)


def _iter_dms_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format DMS (degrés, minutes, secondes), par exemple :
      - "N 48° 51' 24.12\" E 002° 17' 26.1\""

    Ce format est couramment utilisé dans le géocaching.
    """
    logger.debug("_iter_dms_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_dms_coordinates: Regex utilisée: %s', _DETECT_DMS_REGEX)
    for match in _DETECT_DMS_REGEX.finditer(text):
        logger.debug('_iter_dms_coordinates: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()

        # Convertir DMS en DDM
        try:
            lat_min_decimal = int(lat_min) + float(lat_sec) / 60
            lon_min_decimal = int(lon_min) + float(lon_sec) / 60
            # Valider les bornes (degrés + minutes reconstituées), comme les autres
            # détecteurs. Rejette p.ex. secondes >= 60 (=> minutes >= 60) ou degrés
            # hors plage.
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_decimal, int(lon_deg), lon_min_decimal):
                logger.debug("_iter_dms_coordinates: Bornes invalides, candidat suivant")
                continue
        except (TypeError, ValueError):
            continue

        # Formatage des coordonnées
        ddm_lat = f"{lat_dir} {lat_deg}° {lat_min_decimal:.3f}'"
        ddm_lon = f"{lon_dir} {lon_deg}° {lon_min_decimal:.3f}'"

        logger.debug('_iter_dms_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_dms_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat DMS valide (compat : façade de l'itérateur)."""
    return next(_iter_dms_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format avec chiffres romains
# ------------------------------------------------------------------------------

# Motif des chiffres romains. Après normalisation, les mots cardinaux sont
# des lettres : N/S et E/W acceptés (re.IGNORECASE pour les chiffres romains
# en minuscules).
_DETECT_ROMAN_REGEX = re.compile(
    r'([NS])\s+((?:[IVXLCDM]+)\s+(?:[IVXLCDM]+)\s+(?:[IVXLCDM]+))\s+([EW])\s+((?:[IVXLCDM]+)\s+(?:[IVXLCDM]+)\s+(?:[IVXLCDM]+))',
    re.IGNORECASE,
)


def _iter_roman_numerals_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées avec des chiffres romains, par exemple :
      - "NORD XLVIII XXXII CCXCVI EST VI XL DCXXXVI"
      - "N XLVIII° XXXII.CCXCVI' E VI° XL.DCXXXVI'"

    Cette fonction convertit d'abord les chiffres romains en chiffres arabes.
    """
    logger.debug("_iter_roman_numerals_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])

    # Dictionnaire de conversion des chiffres romains
    roman_to_arabic = {
        'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000,
        'IV': 4, 'IX': 9, 'XL': 40, 'XC': 90, 'CD': 400, 'CM': 900
    }

    # Fonction pour convertir un nombre romain en nombre arabe
    def roman_to_int(roman: str) -> int:
        i, result = 0, 0
        while i < len(roman):
            # Vérifier les sous-chaînes de 2 caractères
            if i + 1 < len(roman) and roman[i:i+2] in roman_to_arabic:
                result += roman_to_arabic[roman[i:i+2]]
                i += 2
            else:
                # Vérifier les caractères individuels
                if roman[i] in roman_to_arabic:
                    result += roman_to_arabic[roman[i]]
                i += 1
        return result

    # Rechercher les motifs de chiffres romains (pattern compilé en module).
    logger.debug('_iter_roman_numerals_coordinates: Pattern utilisé: %s', _DETECT_ROMAN_REGEX)

    for match in _DETECT_ROMAN_REGEX.finditer(text):
        logger.debug('_iter_roman_numerals_coordinates: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_romans, lon_dir, lon_romans = match.groups()

        # Extraire les chiffres romains individuels
        lat_parts = lat_romans.split()
        lon_parts = lon_romans.split()

        if len(lat_parts) >= 3 and len(lon_parts) >= 3:
            try:
                # Convertir les chiffres romains en chiffres arabes
                lat_deg = roman_to_int(lat_parts[0])
                lat_min = roman_to_int(lat_parts[1])
                lat_sec = roman_to_int(lat_parts[2])

                lon_deg = roman_to_int(lon_parts[0])
                lon_min = roman_to_int(lon_parts[1])
                lon_sec = roman_to_int(lon_parts[2])

                logger.debug('_iter_roman_numerals_coordinates: Conversion - lat: %s %s %s, lon: %s %s %s', lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec)

                if not _valid_dms_parts(lat_deg, lat_min, lat_sec, lon_deg, lon_min, lon_sec):
                    logger.debug("_iter_roman_numerals_coordinates: Bornes invalides, candidat suivant")
                    continue

                # Formatage des coordonnées (lettres canoniques en majuscules)
                ddm_lat = f"{lat_dir.upper()} {lat_deg}° {lat_min}.{lat_sec}'"
                ddm_lon = f"{lon_dir.upper()} {lon_deg}° {lon_min}.{lon_sec}'"

                logger.debug('_iter_roman_numerals_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

                yield {
                    "span": [match.start(), match.end()],
                    "exist": True,
                    "ddm_lat": ddm_lat,
                    "ddm_lon": ddm_lon,
                    "ddm": f"{ddm_lat} {ddm_lon}"
                }
            except Exception as e:
                logger.debug('_iter_roman_numerals_coordinates: Erreur lors de la conversion: %s', e)


def _detect_roman_numerals_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « chiffres romains » valide (compat : façade de l'itérateur)."""
    return next(_iter_roman_numerals_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format numérique pur (ex: "4912123 00612123")
# ------------------------------------------------------------------------------

# Deux groupes de chiffres séparés par un espace : 7 chiffres (latitude)
# puis 6 à 8 chiffres (longitude).
_DETECT_NUMERIC_ONLY_REGEX = re.compile(r'(\d{7})\s+(\d{6,8})')


def _iter_numeric_only(text: str, origin_coords: Optional[Dict[str, str]] = None) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format numérique pur, sans lettres cardinales ni symboles.
    Format attendu: "4912123 00612123" ou "4912123 612123" ou "4912123 0612123"
    pour N 49° 12.123' E 006° 12.123'

    La première partie représente la latitude: 2 chiffres degrés + 2 chiffres minutes + 3 chiffres décimales
    La deuxième partie représente la longitude: 3 chiffres degrés (avec éventuellement des 0 en tête) + 2 chiffres minutes + 3 chiffres décimales

    Si origin_coords est fourni, utilise les directions cardinales de ces coordonnées (N/S, E/W)
    plutôt que de supposer N et E par défaut.
    """
    logger.debug("_iter_numeric_only: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug("_iter_numeric_only: Coordonnées d'origine: %s", origin_coords)

    # Pattern pour capturer deux groupes de chiffres séparés par un espace
    # Premier groupe: exactement 7 chiffres (latitude)
    # Deuxième groupe: 6 à 8 chiffres (longitude)
    logger.debug('_iter_numeric_only: Pattern utilisé: %s', _DETECT_NUMERIC_ONLY_REGEX)

    for match in _DETECT_NUMERIC_ONLY_REGEX.finditer(text):
        logger.debug('_iter_numeric_only: Match trouvé! Groupes: %s', match.groups())
        lat_digits = match.group(1)
        lon_digits = match.group(2)

        logger.debug('_iter_numeric_only: Latitude digits: %s, Longitude digits: %s', lat_digits, lon_digits)
        # Anti-faux-positifs: rejeter les groupes purement binaires (0/1)
        try:
            has_lat_nonbinary = any(ch in '23456789' for ch in lat_digits)
            has_lon_nonbinary = any(ch in '23456789' for ch in lon_digits)
            if not has_lat_nonbinary or not has_lon_nonbinary:
                logger.debug("_iter_numeric_only: Groupes composés uniquement de 0/1 détectés, candidat suivant")
                continue
        except Exception:
            continue

        try:
            # Pour la latitude
            lat_deg = lat_digits[0:2]
            lat_min = lat_digits[2:4]
            lat_dec = lat_digits[4:7]

            # Pour la longitude, nous devons nous assurer que les 3 premiers chiffres représentent les degrés
            # mais en tenant compte des zéros en tête possibles

            # Compléter la longitude avec des zéros en tête si nécessaire pour avoir 8 chiffres
            padded_lon_digits = lon_digits.zfill(8)
            logger.debug('_iter_numeric_only: Longitude avec padding: %s', padded_lon_digits)

            # Maintenant nous pouvons découper correctement
            lon_deg = padded_lon_digits[0:3]
            lon_min = padded_lon_digits[3:5]
            lon_dec = padded_lon_digits[5:8]

            logger.debug('_iter_numeric_only: Découpage - lon_deg=%s, lon_min=%s, lon_dec=%s', lon_deg, lon_min, lon_dec)

            # Déterminer les directions cardinales (N/S, E/W) en fonction des coordonnées d'origine
            lat_dir = "N"  # Direction par défaut
            lon_dir = "E"  # Direction par défaut

            if origin_coords and 'ddm_lat' in origin_coords and 'ddm_lon' in origin_coords:
                try:
                    # Extraire les directions des coordonnées d'origine
                    origin_lat_match = _ORIGIN_LAT_DIR_REGEX.search(origin_coords['ddm_lat'])
                    origin_lon_match = _ORIGIN_LON_DIR_REGEX.search(origin_coords['ddm_lon'])

                    if origin_lat_match:
                        lat_dir = origin_lat_match.group(1)
                        logger.debug('Direction latitude depuis origine: %s', lat_dir)

                    if origin_lon_match:
                        lon_dir = origin_lon_match.group(1)
                        logger.debug('Direction longitude depuis origine: %s', lon_dir)
                except Exception as e:
                    logger.warning("Erreur lors de l'extraction des directions depuis les coordonnées d'origine: %s", e)
                    # En cas d'erreur, on garde les directions par défaut

            # Validation bornes
            try:
                if not _is_valid_degrees_minutes(int(lat_deg), float(f"{lat_min}.{lat_dec}"), int(lon_deg), float(f"{lon_min}.{lon_dec}")):
                    logger.debug("_iter_numeric_only: Bornes invalides, candidat suivant")
                    continue
            except Exception:
                continue

            # Formatage des coordonnées
            ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_dec}'"
            ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_dec}'"

            logger.debug('_iter_numeric_only: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

            yield {
                "span": [match.start(), match.end()],
                "exist": True,
                "ddm_lat": ddm_lat,
                "ddm_lon": ddm_lon,
                "ddm": f"{ddm_lat} {ddm_lon}"
            }
        except Exception as e:
            logger.error('_iter_numeric_only: Erreur lors du formatage: %s', e)
            traceback.print_exc()


def _detect_numeric_only_coordinates(text: str, origin_coords: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « numérique pur » valide (compat : façade de l'itérateur)."""
    return next(_iter_numeric_only(text, origin_coords), None)

# ------------------------------------------------------------------------------
# Détection du format compact sans séparateurs (ex: "N4812123E00612123")
# ------------------------------------------------------------------------------

# Format compact : direction latitude, 7 chiffres, direction longitude,
# 6-8 chiffres, espaces optionnels entre les composants.
_DETECT_COMPACT_REGEX = re.compile(r'([NS])\s*(\d{7})\s*([EW])\s*(\d{6,8})', re.IGNORECASE)


def _iter_compact_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format compact sans séparateurs entre les composants, par exemple :
      - "N4812123E00612123"
      - "N 4812123 E 00612123"
      - "N4812123 E00612123"
      - "S4812123W00612123"

    Ce format est très compact et ne contient pas de symboles de degrés ni de minutes.
    """
    logger.debug("_iter_compact_coordinates: Analyse du texte: '%s...' (tronqué)", text[:100])

    # Pattern pour détecter le format compact
    # Capture: direction latitude, 7 chiffres, direction longitude, 6-8 chiffres
    # Accepte des espaces optionnels entre les composants
    logger.debug('_iter_compact_coordinates: Regex utilisée: %s', _DETECT_COMPACT_REGEX)

    for match in _DETECT_COMPACT_REGEX.finditer(text):
        logger.debug('_iter_compact_coordinates: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_digits, lon_dir, lon_digits = match.groups()

        logger.debug('_iter_compact_coordinates: Latitude: %s%s, Longitude: %s%s', lat_dir, lat_digits, lon_dir, lon_digits)
        # Anti-faux-positifs: rejeter les groupes purement binaires (0/1)
        try:
            has_lat_nonbinary = any(ch in '23456789' for ch in lat_digits)
            has_lon_nonbinary = any(ch in '23456789' for ch in lon_digits)
            if not has_lat_nonbinary or not has_lon_nonbinary:
                logger.debug("_iter_compact_coordinates: Groupes composés uniquement de 0/1 détectés, candidat suivant")
                continue
        except Exception:
            continue

        try:
            # Pour la latitude
            lat_deg = lat_digits[0:2]
            lat_min = lat_digits[2:4]
            lat_dec = lat_digits[4:7]

            # Pour la longitude, compléter avec des zéros en tête si nécessaire
            padded_lon_digits = lon_digits.zfill(8)
            lon_deg = padded_lon_digits[0:3]
            lon_min = padded_lon_digits[3:5]
            lon_dec = padded_lon_digits[5:8]

            # Validation bornes
            try:
                if not _is_valid_degrees_minutes(int(lat_deg), float(f"{lat_min}.{lat_dec}"), int(lon_deg), float(f"{lon_min}.{lon_dec}")):
                    logger.debug("_iter_compact_coordinates: Bornes invalides, candidat suivant")
                    continue
            except Exception:
                continue

            # Formatage des coordonnées
            ddm_lat = f"{lat_dir} {lat_deg}° {lat_min}.{lat_dec}'"
            ddm_lon = f"{lon_dir} {lon_deg}° {lon_min}.{lon_dec}'"

            logger.debug('_iter_compact_coordinates: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

            yield {
                "span": [match.start(), match.end()],
                "exist": True,
                "ddm_lat": ddm_lat,
                "ddm_lon": ddm_lon,
                "ddm": f"{ddm_lat} {ddm_lon}"
            }
        except Exception as e:
            logger.error('_iter_compact_coordinates: Erreur lors du formatage: %s', e)
            traceback.print_exc()


def _detect_compact_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « compact » valide (compat : façade de l'itérateur)."""
    return next(_iter_compact_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format DDM avec points à la place du symbole °
# Exemple : "N50.02.117 e004.52.677"
# ------------------------------------------------------------------------------

# DDM avec des points à la place du symbole ° et du séparateur décimal
# (lettres cardinales en majuscule ou minuscule).
_DETECT_DMM_DOT_REGEX = re.compile(
    r'([ns])\s*(\d{1,2})\.(\d{2})\.(\d{3})\s*'  # Latitude : dir, deg, minutes, décimales
    r'([ew])\s*(\d{1,3})\.(\d{2})\.(\d{3})',    # Longitude : dir, deg, minutes, décimales
    re.IGNORECASE,
)


def _iter_dmm_dot_separator(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées DDM où les séparateurs de degrés et minutes sont des points :
      - N50.02.117 e004.52.677
    Les lettres cardinales peuvent être en majuscule ou minuscule.
    """
    logger.debug("_iter_dmm_dot_separator: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_dmm_dot_separator: Regex utilisée: %s', _DETECT_DMM_DOT_REGEX)
    for match in _DETECT_DMM_DOT_REGEX.finditer(text):
        logger.debug('_iter_dmm_dot_separator: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lat_dec, lon_dir, lon_deg, lon_min, lon_dec = match.groups()

        # Normaliser les directions
        lat_dir = lat_dir.upper()
        lon_dir = lon_dir.upper()

        try:
            lat_min_f = float(f"{lat_min}.{lat_dec}")
            lon_min_f = float(f"{lon_min}.{lon_dec}")
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_f, int(lon_deg), lon_min_f):
                logger.debug("_iter_dmm_dot_separator: Bornes invalides, candidat suivant")
                continue
        except Exception:
            continue

        ddm_lat = f"{lat_dir} {lat_deg.zfill(2)}° {lat_min}.{lat_dec}'"
        ddm_lon = f"{lon_dir} {lon_deg.zfill(3)}° {lon_min}.{lon_dec}'"

        logger.debug('_iter_dmm_dot_separator: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)
        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_dmm_dot_separator(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM à points » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_dot_separator(text), None)
# ------------------------------------------------------------------------------
# Détection de paire décimale (ex: "48.8566, 2.3522" ou "-33.8688 151.2093")
# ------------------------------------------------------------------------------

def _decimal_to_ddm(value: float) -> tuple:
    """Convertit une valeur décimale (signée) en couple ``(degrés, minutes)``.

    Travaille sur la valeur absolue : l'hémisphère (signe) est géré par l'appelant.
    Ex : ``48.8566`` -> ``(48, 51.396)``.
    """
    magnitude = abs(value)
    deg = int(magnitude)
    minutes = (magnitude - deg) * 60.0
    return deg, minutes


# Lettre cardinale suivie d'un chiffre : en présence de celle-ci, les
# détecteurs DDM/DMS prennent le relais (le détecteur décimal s'abstient).
_CARDINAL_THEN_DIGIT_REGEX = re.compile(r'[NSEWnsew]\s*\d')
# Paire de degrés décimaux : 3 à 8 décimales par valeur, séparateur
# virgule/point-virgule/espace, signe optionnel.
_DETECT_DECIMAL_PAIR_REGEX = re.compile(
    r'(?<![\d.])(-?\d{1,3}\.\d{3,8})\s*[,;]?\s+(-?\d{1,3}\.\d{3,8})(?![\d.])'
)


def _iter_decimal_pair(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les paires de coordonnées en degrés décimaux, par exemple :
      - "48.8566, 2.3522"
      - "-33.8688 151.2093"
    Exige 3 à 8 décimales par valeur (évite les faux positifs type "3.14, 2.71"),
    et l'absence de lettres cardinales (sinon d'autres détecteurs s'en chargent).
    Le signe détermine l'hémisphère (S/W).
    """
    logger.debug("_iter_decimal_pair: Analyse du texte")

    if _CARDINAL_THEN_DIGIT_REGEX.search(text):
        # Présence de lettres cardinales : laisser les détecteurs DDM/DMS gérer.
        return

    for match in _DETECT_DECIMAL_PAIR_REGEX.finditer(text):
        try:
            lat = float(match.group(1))
            lon = float(match.group(2))
        except (TypeError, ValueError):
            continue

        if abs(lat) > 90 or abs(lon) > 180:
            logger.debug("_iter_decimal_pair: Hors bornes, candidat suivant")
            continue

        lat_dir = 'N' if lat >= 0 else 'S'
        lon_dir = 'E' if lon >= 0 else 'W'
        lat_deg, lat_min = _decimal_to_ddm(lat)
        lon_deg, lon_min = _decimal_to_ddm(lon)

        ddm_lat = f"{lat_dir} {lat_deg:02d}° {lat_min:06.3f}'"
        ddm_lon = f"{lon_dir} {lon_deg:03d}° {lon_min:06.3f}'"

        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}",
            # Décimales déjà connues : évite un aller-retour de conversion
            "decimal_latitude": round(lat, 8),
            "decimal_longitude": round(lon, 8),
        }


def _detect_decimal_pair(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « paire décimale » valide (compat : façade de l'itérateur)."""
    return next(_iter_decimal_pair(text), None)


# ------------------------------------------------------------------------------
# Détection avec direction en SUFFIXE (ex: "48° 51.234' N 2° 17.567' E")
# ------------------------------------------------------------------------------

# DDM avec direction cardinale en suffixe (listings internationaux).
_DETECT_DMM_SUFFIX_REGEX = re.compile(
    r'(\d{1,2})\s*[°º]?\s*(\d{1,2}(?:[.,]\d+)?)\s*[\'′]?\s*([NS])'
    r'[\s,]+'
    r'(\d{1,3})\s*[°º]?\s*(\d{1,2}(?:[.,]\d+)?)\s*[\'′]?\s*([EW])'
)


def _iter_dmm_suffix_direction(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les DDM où la direction cardinale suit la valeur, par exemple :
      - "48° 51.234' N 2° 17.567' E"
      - "48 51.234 N, 2 17.567 E"
    Fréquent sur les listings internationaux.
    """
    logger.debug("_iter_dmm_suffix_direction: Analyse du texte")
    for match in _DETECT_DMM_SUFFIX_REGEX.finditer(text):
        lat_deg, lat_min_raw, lat_dir, lon_deg, lon_min_raw, lon_dir = match.groups()
        lat_min_raw = lat_min_raw.replace(',', '.')
        lon_min_raw = lon_min_raw.replace(',', '.')

        try:
            if not _is_valid_degrees_minutes(int(lat_deg), float(lat_min_raw), int(lon_deg), float(lon_min_raw)):
                logger.debug("_iter_dmm_suffix_direction: Bornes invalides, candidat suivant")
                continue
        except (TypeError, ValueError):
            continue

        ddm_lat = f"{lat_dir} {lat_deg.zfill(2)}° {_format_ddm_minutes(lat_min_raw)}'"
        ddm_lon = f"{lon_dir} {lon_deg.zfill(3)}° {_format_ddm_minutes(lon_min_raw)}'"
        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}",
        }


def _detect_dmm_suffix_direction(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM suffixe » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_suffix_direction(text), None)


# DMS avec direction cardinale en suffixe (converti en DDM comme
# _detect_dms_coordinates).
_DETECT_DMS_SUFFIX_REGEX = re.compile(
    r'(\d{1,2})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NS])'
    r'[\s,]+'
    r'(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([EW])'
)


def _iter_dms_suffix_direction(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les DMS (degrés/minutes/secondes) avec direction en suffixe :
      - "48°51'24.1\" N 2°17'26\" E"
    Convertit les secondes en minutes décimales (comme _iter_dms_coordinates).
    """
    logger.debug("_iter_dms_suffix_direction: Analyse du texte")
    for match in _DETECT_DMS_SUFFIX_REGEX.finditer(text):
        lat_deg, lat_min, lat_sec, lat_dir, lon_deg, lon_min, lon_sec, lon_dir = match.groups()
        try:
            lat_min_dec = int(lat_min) + float(lat_sec) / 60.0
            lon_min_dec = int(lon_min) + float(lon_sec) / 60.0
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_dec, int(lon_deg), lon_min_dec):
                logger.debug("_iter_dms_suffix_direction: Bornes invalides, candidat suivant")
                continue
        except (TypeError, ValueError):
            continue

        ddm_lat = f"{lat_dir} {int(lat_deg):02d}° {lat_min_dec:06.3f}'"
        ddm_lon = f"{lon_dir} {int(lon_deg):03d}° {lon_min_dec:06.3f}'"
        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}",
        }


def _detect_dms_suffix_direction(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DMS suffixe » valide (compat : façade de l'itérateur)."""
    return next(_iter_dms_suffix_direction(text), None)


# Fonction principale de détection multi-format
# ------------------------------------------------------------------------------

# Découpe un ``ddm`` combiné « N 48° 33.787' E 006° 38.803' » en (lat, lon)
# pour les détecteurs qui ne renseignent que la chaîne combinée. Proche de
# _ORIGIN_COMBINED_REGEX mais greedy (le lat n'est pas lazy) : ne pas unifier.
_DDM_SPLIT_REGEX = re.compile(r"^([NS][^NSWE]+)[\s,]+([EW].+)$", re.IGNORECASE)


def _finalize_detection(result: Dict, source: str, confidence: float, text: str) -> Dict:
    """Post-traitement commun d'un candidat retenu : provenance, confiance,
    conversion décimale (centralisée côté backend), et métadonnées de provenance.
    """
    result["source"] = source
    result["confidence"] = confidence

    # Composantes DDM : certains détecteurs ne renseignent que le ``ddm``
    # combiné ; on extrait alors lat/lon depuis celui-ci.
    ddm_lat = result.get("ddm_lat")
    ddm_lon = result.get("ddm_lon")

    if (not ddm_lat or not ddm_lon) and result.get("ddm"):
        combined_match = _DDM_SPLIT_REGEX.match(result["ddm"].strip())
        if combined_match:
            ddm_lat = ddm_lat or combined_match.group(1).strip()
            ddm_lon = ddm_lon or combined_match.group(2).strip()

    # Représentation canonique unique, indépendante du détecteur gagnant :
    # « N 48° 33.787' » / « E 006° 38.803' » (degrés zfillés, minutes MM.ddd).
    # En cas d'échec de re-formatage on conserve les chaînes d'origine.
    if ddm_lat and ddm_lon:
        try:
            canon_lat = _canonical_ddm_component(ddm_lat, 2)
            canon_lon = _canonical_ddm_component(ddm_lon, 3)
        except Exception as e:
            logger.debug("_finalize_detection: normalisation DDM impossible: %s", e)
            canon_lat = canon_lon = None
        if canon_lat and canon_lon:
            ddm_lat, ddm_lon = canon_lat, canon_lon
            result["ddm_lat"] = ddm_lat
            result["ddm_lon"] = ddm_lon
            result["ddm"] = f"{ddm_lat} {ddm_lon}"

    # Conversion décimale centralisée (évite de la recalculer côté frontend),
    # effectuée sur les chaînes normalisées.
    if result.get("decimal_latitude") is None or result.get("decimal_longitude") is None:
        if ddm_lat and ddm_lon:
            try:
                decimal_coords = convert_ddm_to_decimal(ddm_lat, ddm_lon)
            except Exception as e:
                logger.debug("detect_gps_coordinates: Erreur conversion DDM->décimal: %s", e)
                decimal_coords = {}

            if decimal_coords.get('latitude') is not None and decimal_coords.get('longitude') is not None:
                result.setdefault('decimal_latitude', decimal_coords['latitude'])
                result.setdefault('decimal_longitude', decimal_coords['longitude'])

    # matched_text = fragment réellement matché dans le texte (via le span fourni par
    # le détecteur), et non plus le texte entier. Rétro-compat : si aucun span valide
    # n'est fourni (détecteurs multi-lignes sans objet match), on retombe sur le texte
    # complet et span reste None.
    span = result.get("span")
    if (
        isinstance(span, (list, tuple)) and len(span) == 2
        and isinstance(span[0], int) and isinstance(span[1], int)
        and 0 <= span[0] <= span[1] <= len(text)
    ):
        start, end = int(span[0]), int(span[1])
        result["span"] = [start, end]
        result["matched_text"] = text[start:end]
    else:
        result["span"] = None
        result["matched_text"] = text

    result["extract"] = {"plugin": source, "version": "1.0"}
    return result


# Lettre cardinale isolée placée devant un nombre ("n48", "O 002") ou derrière
# une valeur ("51.234 n", "27\" o"). « Isolée » = ni précédée ni suivie d'une
# lettre, pour ne pas toucher aux mots ("nord", "est", "ou 5").
_CARDINAL_PREFIX_REGEX = re.compile(r"(?<![^\W\d_])([nsewoO])(?=\s*\d)")
_CARDINAL_SUFFIX_REGEX = re.compile(r"(?<=[\d'′\"″°º])(\s*)([nsewoO])(?![^\W_])")

# Mots cardinaux entiers (fr/en/de/es/it), insensibles à la casse. On ne les
# réécrit que dans un contexte numérique pour épargner le français courant
# (« il est », « le nord de la France ») :
#   - préfixe : le mot est suivi d'un début de nombre ou de chiffre romain
#     (« north 48 », « NORD XLVIII », « est/6 ») ;
#   - suffixe : le mot suit une fin de nombre ou un symbole
#     (« 33.787 north », « 48° sud »).
# NB : la classe [IVXLCDM] couvre le détecteur de chiffres romains.
# NB2 : un chiffre collé compte comme bord de mot (« NORD48… », « 296EST6… » —
# formats collés historiques) : (?=\d|\b) / (?:(?<=\d)|\b) remplacent le \b.
_CARDINAL_WORDS = r"nord|north|sud|süd|south|est|east|ost|ouest|oeste|ovest|west"
_CARDINAL_WORD_PREFIX_REGEX = re.compile(
    rf"\b({_CARDINAL_WORDS})(?=\d|\b)(?=[\s/:.,;°]*[\dIVXLCDM])",
    re.IGNORECASE,
)
_CARDINAL_WORD_SUFFIX_REGEX = re.compile(
    rf"(?<=[\d'′\"″°º])(\s*)(?:(?<=\d)|\b)({_CARDINAL_WORDS})(?=\d|\b)",
    re.IGNORECASE,
)

# Lettre canonique de chaque mot cardinal. Aucun n'est ambigu (« ost » = Est
# allemand, « ouest/oeste/ovest » = Ouest) : ils ne passent PAS par la logique
# « O » -> o_letter/o_direction_assumed réservée à la lettre O isolée.
_CARDINAL_WORD_LETTERS = {
    "nord": "N", "north": "N",
    "sud": "S", "süd": "S", "south": "S",
    "est": "E", "east": "E", "ost": "E",
    "ouest": "W", "oeste": "W", "ovest": "W", "west": "W",
}

# Condition nécessaire à TOUS les détecteurs : un chiffre arabe quelque part,
# ou un chiffre romain joignable à une lettre/mot cardinal. Un seul scan avant
# de lancer les ~18 regex — court-circuite la prose pure et les chaînes
# décodées sans chiffres (cas majoritaire du bruteforce).
#
# Le détecteur de chiffres romains est le SEUL chemin 100 % sans chiffre arabe ;
# il est très laxiste (re.IGNORECASE, aucune borne de mot : « S » dans « NOS »
# matche). Le gate est donc évalué en trois étapes paresseuses :
#   1. \d                        — couvre tous les autres détecteurs ; scan
#      ultra-rapide qui court-circuite tout texte chiffré ;
#   2. [NSEWnsew]\s+[IVXLCDM]    — lettre cardinale (même incluse dans un mot,
#      d'où l'absence de lookbehind : le détecteur romain n'a pas de borne) +
#      espaces + début de romain. IGNORECASE couvre les romains minuscules
#      (« n xlviii … », détectés aujourd'hui) ;
#   3. _CARDINAL_WORD_PREFIX_REGEX — « NORD XLVIII » : la normalisation
#      transforme le mot en lettre, puis le détecteur romain prend le relais.
#      Pré-filtrée par _GATE_CARDINAL_TOKENS (substring C-rapide) car cette
#      regex à lookaheads coûte ~200 µs/10k chars.
# La détection écrite (toutes lettres) n'est PAS concernée : elle est gérée
# au niveau endpoint via WrittenCoordinatesService, pas ici.
_GATE_DIGIT_REGEX = re.compile(r"\d")
_GATE_ROMAN_LETTER_REGEX = re.compile(r"[NSEWnsew]\s+[IVXLCDM]", re.IGNORECASE)
_GATE_CARDINAL_TOKENS = tuple(dict.fromkeys(_CARDINAL_WORDS.split("|")))


def _normalize_cardinal_letters(text: str, origin_coords: Optional[Dict[str, str]]) -> tuple:
    """Met en forme canonique les lettres cardinales, sans changer la longueur.

    Les détecteurs attendent pour la plupart N/S/E/W en majuscules. Deux
    écritures courantes leur échappaient :
      - les minuscules : ``n48 51.234 e002 21.456`` ;
      - le ``O`` de « Ouest » (français, espagnol, italien, portugais) :
        ``N48 51.234 O002 21.456``.

    ``O`` est ambigu : c'est l'Ouest en français mais l'Est (« Ost ») en
    allemand. Si des coordonnées d'origine sont connues, ``O`` prend leur
    hémisphère (un final est toujours du même côté que sa cache) ; sinon il vaut
    Ouest, et la réponse le signale (``o_direction_assumed``).

    Une passe MOTS précède les passes lettres : les mots cardinaux entiers en
    contexte numérique (« North 48 … », « SUD XLVIII … ») sont réduits à leur
    première lettre canonique, le reste blanké en espaces. Pas de chevauchement
    possible avec les passes lettres : la première lettre d'un mot est suivie
    d'une lettre, jamais d'un chiffre.

    Chaque remplacement se fait caractère pour caractère : les ``span`` renvoyés
    par les détecteurs restent valables sur le texte d'origine.

    Returns:
        (texte normalisé, positions des ``O`` convertis, lettre retenue pour ``O``,
        True si cette lettre est une hypothèse faute d'origine).
    """
    o_letter, assumed = 'W', True
    if origin_coords:
        origin_lon = _ORIGIN_LON_DIR_REGEX.search(str(origin_coords.get('ddm_lon') or '').upper())
        if origin_lon:
            o_letter, assumed = origin_lon.group(0), False

    chars = list(text)
    o_positions: List[int] = []

    def _canonical(pos: int) -> None:
        if chars[pos] in 'oO':
            chars[pos] = o_letter
            o_positions.append(pos)
        else:
            chars[pos] = chars[pos].upper()

    def _blank_word(start: int, end: int) -> None:
        # 1re lettre -> direction canonique, reste -> espaces (même longueur).
        # Ces mots ne sont PAS ambigus : pas de passage par o_positions/o_letter.
        chars[start] = _CARDINAL_WORD_LETTERS.get(
            text[start:end].lower(), text[start].upper())
        for i in range(start + 1, end):
            chars[i] = ' '

    # Passe MOTS d'abord : « north »/« SUD »… en contexte numérique deviennent
    # « N    »/« S   »… que les détecteurs lisent comme des lettres cardinales.
    for match in _CARDINAL_WORD_PREFIX_REGEX.finditer(text):
        _blank_word(match.start(1), match.end(1))
    for match in _CARDINAL_WORD_SUFFIX_REGEX.finditer(text):
        _blank_word(match.start(2), match.end(2))

    for match in _CARDINAL_PREFIX_REGEX.finditer(text):
        _canonical(match.start(1))
    for match in _CARDINAL_SUFFIX_REGEX.finditer(text):
        _canonical(match.start(2))

    return ''.join(chars), o_positions, o_letter, assumed


def _no_detection_result() -> Dict[str, Optional[str]]:
    """Schéma « aucune coordonnée trouvée » — dict frais à chaque appel."""
    return {
        "exist": False,
        "ddm_lat": None,
        "ddm_lon": None,
        "ddm": None,
        "source": None,
        "confidence": 0.0,
        "matched_text": None,
        "span": None,
        "extract": None
    }


def detect_gps_coordinates(text: str, include_numeric_only: bool = False, origin_coords: Optional[Dict[str, str]] = None, include_written: bool = False) -> Dict[str, Optional[str]]:
    """
    Recherche des coordonnées GPS dans un texte en testant plusieurs formats.

    Args:
        text (str): Le texte dans lequel rechercher des coordonnées
        include_numeric_only (bool): Si True, inclut la détection de coordonnées au format numérique pur (sans lettres cardinales ni symboles)
        origin_coords (Optional[Dict[str, str]]): Coordonnées d'origine au format DDM (optionnel)
        include_written (bool): DÉPRÉCIÉ / ignoré. La détection en toutes lettres est
            désormais gérée exclusivement par l'endpoint via WrittenCoordinatesService
            (langues respectées, pas de double exécution). Conservé pour compat de signature.

    Le dictionnaire retourné contient :
      - 'exist': True si une coordonnée a été trouvée, sinon False.
      - 'ddm_lat': Latitude formatée en DDM.
      - 'ddm_lon': Longitude formatée en DDM.
      - 'ddm': Latitude et longitude combinées.
    """
    logger.debug(
        "detect_gps_coordinates: Début de la détection sur texte de %s caractères, "
        "extrait: '%s...' (tronqué), include_numeric_only=%s, origin_coords=%s, include_written=%s",
        len(text), text[:100], include_numeric_only, origin_coords, include_written,
    )

    prepared = _prepare_detection_context(text, origin_coords)
    if prepared is None:
        return _no_detection_result()
    normalized_text, o_positions, o_letter, o_assumed, origin_coords = prepared

    # Détecteurs ordonnés par confiance décroissante (voir _DETECTORS_SORTED et
    # _detector_iterators) : on peut s'ARRÊTER au premier détecteur qui produit
    # un candidat — c'est nécessairement celui de plus haute confiance. Chaque
    # itérateur renvoie son premier match VALIDE : un match hors bornes ne
    # masque plus les candidats suivants du même détecteur. Chemin chaud : le
    # scorer appelle cette fonction pour chaque candidat bruteforce, on ne
    # lance donc pas les ~18 itérateurs complets (contrairement à
    # detect_all_gps_coordinates).
    detectors = _detector_iterators(origin_coords, include_numeric_only)

    for confidence, _order, iter_func, source in detectors:
        result = next(iter_func(normalized_text), None)
        if result and result.get("exist"):
            logger.debug("detect_gps_coordinates: retenu %s (%.2f)", source, confidence)
            result = _finalize_detection(result, source, confidence, text)
            span = result.get("span")
            if o_assumed and span and any(span[0] <= pos < span[1] for pos in o_positions):
                # « O » lu comme Ouest faute de coordonnées d'origine (Ost = Est en allemand).
                result["o_direction_assumed"] = o_letter
            return result

    # NB : la détection en toutes lettres (written) n'est plus faite ici. Elle est
    # entièrement pilotée par l'endpoint via WrittenCoordinatesService, qui respecte
    # les langues demandées (l'ancien chemin interne était figé sur 'fr' et pouvait
    # relancer le plugin une seconde fois).
    logger.debug("detect_gps_coordinates: Aucune coordonnée GPS détectée")
    return _no_detection_result()


def _prepare_detection_context(text: str, origin_coords) -> Optional[tuple]:
    """Gatekeeper + normalisations communes aux détections simple et multiple.

    Retourne ``None`` si le gatekeeper exclut toute coordonnée possible, sinon
    le tuple ``(texte normalisé, positions des « O », lettre retenue pour « O »,
    drapeau d'hypothèse, coordonnées d'origine normalisées)``.
    """
    # Gatekeeper : sans chiffre arabe ni motif romain possible, AUCUN détecteur
    # ne peut matcher — on évite le passage des ~18 regex (cas majoritaire sur
    # texte décodé sans coordonnée). Étapes paresseuses, du moins cher au plus
    # cher (voir les commentaires des constantes).
    gate_ok = (
        _GATE_DIGIT_REGEX.search(text)
        or _GATE_ROMAN_LETTER_REGEX.search(text)
    )
    if not gate_ok:
        # Chemin « mots cardinaux + romain » : pré-filtre substring avant la
        # regex à lookaheads (coûteuse sur un long texte sans mot cardinal).
        lowered = text.lower()
        gate_ok = (
            any(w in lowered for w in _GATE_CARDINAL_TOKENS)
            and _CARDINAL_WORD_PREFIX_REGEX.search(text)
        )
    if not gate_ok:
        logger.debug("_prepare_detection_context: Gatekeeper — aucun motif de coordonnée possible")
        return None

    # Accepte un dict {ddm_lat, ddm_lon} ou une chaîne DDM combinée (coordinatesRaw)
    origin_coords = _normalize_origin_coords(origin_coords)

    # Les détecteurs lisent un texte aux lettres cardinales normalisées (même
    # longueur) ; matched_text reste extrait du texte d'origine.
    normalized_text, o_positions, o_letter, o_assumed = _normalize_cardinal_letters(text, origin_coords)

    return normalized_text, o_positions, o_letter, o_assumed, origin_coords


def _detector_iterators(origin_coords, include_numeric_only: bool):
    """Table des itérateurs de candidats à exécuter (ordre confiance décroissante).

    ``_DETECTORS_SORTED`` contient déjà les détecteurs standard ; le détecteur
    « numérique pur » (optionnel, dépend de origin_coords) est injecté ici avec
    confiance 0.90 et priorité (order -1) sur les détecteurs à lettres
    cardinales de même confiance. Copie triée : la constante de module n'est
    jamais mutée.
    """
    if not include_numeric_only:
        return _DETECTORS_SORTED
    logger.debug("_detector_iterators: Détection de coordonnées numériques pures activée")
    return sorted(
        _DETECTORS_SORTED + [(
            0.90, -1,
            lambda t: _iter_numeric_only(t, origin_coords),
            _detect_numeric_only_coordinates.__name__,
        )],
        key=lambda d: (-d[0], d[1]),
    )


def _spans_overlap(span_a, span_b) -> bool:
    """Vrai si deux spans ``[start, end)`` se recoupent."""
    return span_a[0] < span_b[1] and span_b[0] < span_a[1]


def _is_duplicate_candidate(finalized: Dict, results: List[Dict]) -> bool:
    """Dédup d'un candidat finalisé contre les résultats déjà retenus.

    - Spans qui se recoupent : même fragment matché par deux détecteurs ->
      doublon (le premier retenu gagne, donc la plus haute confiance,
      l'itération se faisant par confiance décroissante).
    - Résultat sans ``span`` (détecteur « simplified ») : impossible de
      comparer les positions — on déduplique alors sur le ``ddm`` identique.
      Deux mentions de la même coordonnée à des positions différentes (spans
      disjoints) restent en revanche des résultats distincts.
    """
    span = finalized.get("span")
    for other in results:
        other_span = other.get("span")
        if span is not None and other_span is not None:
            if _spans_overlap(span, other_span):
                return True
        elif other.get("ddm") is not None and other.get("ddm") == finalized.get("ddm"):
            return True
    return False


def detect_all_gps_coordinates(text: str, include_numeric_only: bool = False,
                               origin_coords=None) -> List[Dict]:
    """Retourne TOUTES les coordonnées détectées dans le texte.

    Contrairement à :func:`detect_gps_coordinates` (early-stop au premier
    détecteur qui matche, pour le chemin chaud du scorer), cette fonction
    exécute TOUS les détecteurs et collecte tous les candidats valides :

    - même pipeline : gatekeeper, normalisation des lettres/mots cardinaux,
      itération par confiance décroissante (``_DETECTORS_SORTED`` +
      « numeric_only » éventuel) ;
    - chaque candidat passe par ``_finalize_detection`` (schéma identique à
      ``detect_gps_coordinates`` : exist/source/confidence/span/matched_text/
      ddm*/decimal_*, plus ``o_direction_assumed`` le cas échéant) ;
    - déduplication : un candidat dont le ``span`` recoupe celui d'un résultat
      déjà retenu est écarté (le premier rencontré — donc le plus confiant —
      gagne) ; les résultats sans ``span`` sont dédupliqués par ``ddm``
      identique ;
    - tri final par ``(-confidence, span[0] ou 0)``.

    Retourne une liste (vide si rien n'est détecté — ce n'est PAS le dict
    « not found » de ``_no_detection_result``).
    """
    logger.debug(
        "detect_all_gps_coordinates: Début sur texte de %s caractères, "
        "include_numeric_only=%s, origin_coords=%s",
        len(text), include_numeric_only, origin_coords,
    )

    prepared = _prepare_detection_context(text, origin_coords)
    if prepared is None:
        return []
    normalized_text, o_positions, o_letter, o_assumed, origin_coords = prepared

    detectors = _detector_iterators(origin_coords, include_numeric_only)

    results: List[Dict] = []
    for confidence, _order, iter_func, source in detectors:
        for candidate in iter_func(normalized_text):
            if not candidate or not candidate.get("exist"):
                continue
            finalized = _finalize_detection(candidate, source, confidence, text)
            if _is_duplicate_candidate(finalized, results):
                logger.debug(
                    "detect_all_gps_coordinates: candidat %s écarté (doublon)",
                    source,
                )
                continue
            span = finalized.get("span")
            if o_assumed and span and any(span[0] <= pos < span[1] for pos in o_positions):
                # « O » lu comme Ouest faute de coordonnées d'origine.
                finalized["o_direction_assumed"] = o_letter
            results.append(finalized)

    results.sort(key=lambda r: (-r.get("confidence") or 0.0, (r.get("span") or [0, 0])[0]))
    logger.debug("detect_all_gps_coordinates: %s coordonnée(s) détectée(s)", len(results))
    return results

# Nouvelle route API pour détecter les coordonnées dans un texte
@coordinates_bp.route('/api/detect_coordinates', methods=['POST'])
def detect_coordinates_in_text():
    """
    Analyse un texte pour détecter des coordonnées GPS.
    
    Attend un JSON avec:
    - 'text': Texte à analyser
    - 'include_numeric_only' (optionnel): Si True, active la détection de coordonnées au format numérique pur
    - 'include_written' (optionnel): Si True, active la détection de coordonnées écrites en toutes lettres
    - 'origin_coords' (optionnel): Coordonnées d'origine au format DDM pour déterminer les directions cardinales
      Format attendu: {'ddm_lat': 'N 48° 40.123\'', 'ddm_lon': 'E 06° 10.456\''}
    
    Retourne :
    {
        "exist": true/false,
        "ddm_lat": "Latitude formatée",
        "ddm_lon": "Longitude formatée",
        "ddm": "Coordonnées combinées"
    }
    """
    try:
        data = request.get_json()
        logger.debug(
            "detect_coordinates_in_text called (keys=%s, text_len=%s)",
            list(data.keys()) if isinstance(data, dict) else None,
            len(str(data.get('text', ''))) if isinstance(data, dict) else 0,
        )
        if not data or 'text' not in data:
            return jsonify({"error": "Le champ 'text' est requis"}), 400
            
        text = data['text']
        # Récupérer le paramètre include_numeric_only (False par défaut)
        include_numeric_only = data.get('include_numeric_only', False)
        # Récupérer le paramètre include_written (False par défaut)
        include_written = data.get('include_written', False)
        written_languages = data.get('written_languages', ['fr'])
        written_max_candidates = data.get('written_max_candidates', 20)
        written_include_deconcat = data.get('written_include_deconcat', True)
        # Récupérer les coordonnées d'origine (None par défaut) et les normaliser
        # (accepte un dict {ddm_lat, ddm_lon} ou une chaîne DDM combinée)
        origin_coords = _normalize_origin_coords(data.get('origin_coords'))

        logger.debug("Analyse du texte pour detecter des coordonnees: %r", text[:50])
        logger.debug("Detection de format numerique pur activee: %s", include_numeric_only)
        logger.debug("Detection de coordonnees ecrites activee: %s", include_written)
        logger.debug("Coordonnees d'origine fournies: %s", origin_coords)
        
        result = detect_gps_coordinates(
            text,
            include_numeric_only=include_numeric_only,
            origin_coords=origin_coords,
            include_written=include_written,
        )

        if not include_written:
            return jsonify(result)

        enriched = dict(result or {})
        enriched['written'] = {
            'enabled': True,
            'attempted': False,
            'languages': written_languages,
            'max_candidates': written_max_candidates,
            'include_deconcat': written_include_deconcat,
            'candidates': [],
            'combined_results': {},
        }

        if enriched.get('exist'):
            return jsonify(enriched)

        try:
            from gc_backend.services import WrittenCoordinatesService

            plugin_manager = getattr(current_app, 'plugin_manager', None)
            if plugin_manager is None:
                raise RuntimeError("PluginManager non initialisé")
            service = WrittenCoordinatesService(plugin_manager)

            langs = _normalize_written_languages(written_languages)

            try:
                max_cand = int(written_max_candidates)
            except Exception:
                max_cand = 20

            wr = service.find(
                text,
                languages=langs,
                max_candidates=max_cand,
                include_deconcat=bool(written_include_deconcat),
                origin_coords=origin_coords,
            )

            enriched['written']['attempted'] = True
            enriched['written']['candidates'] = wr.candidates
            enriched['written']['combined_results'] = wr.combined_results

            if wr.exist and wr.primary_coordinates:
                merged = dict(wr.primary_coordinates)
                merged['written'] = enriched['written']
                return jsonify(merged)

            return jsonify(enriched)
        except Exception as e:
            enriched['written']['attempted'] = True
            enriched['written']['error'] = str(e)
            return jsonify(enriched)
        
    except Exception as e:
        return _error_response("Erreur lors de la detection des coordonnees", e)


# Limites de sécurité du batch (évite les payloads abusifs).
_BATCH_MAX_TEXTS = 1000
_BATCH_MAX_TOTAL_CHARS = 2_000_000
# Plafond de textes soumis à la détection écrite (exécution du plugin, coûteuse).
_BATCH_WRITTEN_CAP = 30


@coordinates_bp.route('/api/detect_coordinates_batch', methods=['POST'])
def detect_coordinates_batch():
    """
    Détecte des coordonnées GPS dans un lot de textes, en une seule requête.

    Évite les N allers-retours HTTP de la détection front result-par-result.

    Attend un JSON avec :
    - 'texts' (list[str])                : textes à analyser (obligatoire)
    - 'include_numeric_only' (bool)      : format numérique pur
    - 'include_written' (bool)           : détection en toutes lettres (plafonnée)
    - 'written_languages' (list|str)     : langues pour la détection écrite
    - 'written_max_candidates' (int)
    - 'written_include_deconcat' (bool)
    - 'origin_coords' (dict|str)         : coordonnées d'origine (directions cardinales)

    Retourne : {"results": [<schéma /api/detect_coordinates>, ...]} aligné sur
    l'index d'entrée de 'texts', plus 'written_truncated' si le plafond écrit a été
    atteint.
    """
    try:
        data = request.get_json()
        if not isinstance(data, dict) or 'texts' not in data:
            return jsonify({"error": "Le champ 'texts' (liste) est requis"}), 400

        texts = data.get('texts')
        if not isinstance(texts, list):
            return jsonify({"error": "'texts' doit être une liste"}), 400
        if len(texts) > _BATCH_MAX_TEXTS:
            return jsonify({"error": f"Trop de textes (max {_BATCH_MAX_TEXTS})"}), 400

        texts = ["" if t is None else str(t) for t in texts]
        if sum(len(t) for t in texts) > _BATCH_MAX_TOTAL_CHARS:
            return jsonify({"error": "Charge de texte trop volumineuse"}), 400

        include_numeric_only = bool(data.get('include_numeric_only', False))
        include_written = bool(data.get('include_written', False))
        written_languages = _normalize_written_languages(data.get('written_languages', ['fr']))
        try:
            written_max_candidates = int(data.get('written_max_candidates', 20))
        except (TypeError, ValueError):
            written_max_candidates = 20
        written_include_deconcat = bool(data.get('written_include_deconcat', True))
        origin_coords = _normalize_origin_coords(data.get('origin_coords'))

        logger.debug(
            "detect_coordinates_batch: %d textes, numeric_only=%s, written=%s",
            len(texts), include_numeric_only, include_written,
        )

        # Service de détection écrite (instancié une seule fois, en lazy)
        written_service = None
        if include_written:
            try:
                from gc_backend.services import WrittenCoordinatesService
                plugin_manager = getattr(current_app, 'plugin_manager', None)
                if plugin_manager is not None:
                    written_service = WrittenCoordinatesService(plugin_manager)
            except Exception as e:
                logger.warning("detect_coordinates_batch: service écrit indisponible: %s", e)

        written_attempts = 0
        written_truncated = False
        cache: Dict[str, Dict] = {}

        def _detect_one(text: str) -> Dict:
            nonlocal written_attempts, written_truncated
            base = detect_gps_coordinates(
                text,
                include_numeric_only=include_numeric_only,
                origin_coords=origin_coords,
            )
            # Détection écrite uniquement si le regex n'a rien trouvé, et plafonnée
            if base.get('exist') or not include_written or written_service is None:
                return base
            if written_attempts >= _BATCH_WRITTEN_CAP:
                written_truncated = True
                return base
            written_attempts += 1
            try:
                wr = written_service.find(
                    text,
                    languages=written_languages,
                    max_candidates=written_max_candidates,
                    include_deconcat=written_include_deconcat,
                    origin_coords=origin_coords,
                )
                if wr.exist and wr.primary_coordinates:
                    return dict(wr.primary_coordinates)
            except Exception as e:
                logger.debug("detect_coordinates_batch: written find a échoué: %s", e)
            return base

        results: List[Dict] = []
        for text in texts:
            # Déduplication : les textes identiques ne sont détectés qu'une fois
            if text in cache:
                results.append(cache[text])
                continue
            detected = _detect_one(text)
            cache[text] = detected
            results.append(detected)

        return jsonify({
            "results": results,
            "count": len(results),
            "unique_count": len(cache),
            "written_truncated": written_truncated,
        })

    except Exception as e:
        return _error_response("Erreur detect_coordinates_batch", e)


# DDM sans symbole ° : le séparateur degrés/minutes est un ou plusieurs
# espaces ; minutes avec ou sans décimales.
_DETECT_DMM_NO_DEGREE_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})\s+(\d{1,2}(?:[.,]\d+)?)\s*'  # Latitude
    r'([EW])\s*(\d{1,3})\s+(\d{1,2}(?:[.,]\d+)?)'      # Longitude
)


def _iter_dmm_no_degree_symbol(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées DDM où le symbole ° est absent, par exemple :
      - "N 38 32.460 W 075 43.659"
      - "N38 32.460 W075 43.659"
    Le séparateur entre degrés et minutes est simplement un ou plusieurs espaces.
    """
    logger.debug("_iter_dmm_no_degree_symbol: Analyse du texte: '%s...' (tronqué)", text[:100])

    # Regex tolérante aux espaces optionnels après la direction et au formatage varié.
    # Latitude : N/S, 1-2 chiffres degrés, espace(s), minutes avec/sans décimales
    # Longitude : E/W, 1-3 chiffres degrés, espace(s), minutes avec/sans décimales
    logger.debug('_iter_dmm_no_degree_symbol: Regex utilisée: %s', _DETECT_DMM_NO_DEGREE_REGEX)
    for match in _DETECT_DMM_NO_DEGREE_REGEX.finditer(text):
        logger.debug('_iter_dmm_no_degree_symbol: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min = match.groups()

        # Remplacer la virgule éventuelle par un point pour les décimales
        lat_min = lat_min.replace(',', '.')
        lon_min = lon_min.replace(',', '.')

        # S'assurer que les valeurs minutes ont bien 3 décimales (format géocaching)
        lat_min_fmt = _format_ddm_minutes(lat_min)
        lon_min_fmt = _format_ddm_minutes(lon_min)

        # Validation des bornes
        try:
            lat_min_f = float(lat_min_fmt)
            lon_min_f = float(lon_min_fmt)
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_f, int(lon_deg), lon_min_f):
                logger.debug("_iter_dmm_no_degree_symbol: Bornes invalides, candidat suivant")
                continue
        except Exception:
            continue

        ddm_lat = f"{lat_dir} {lat_deg.zfill(2)}° {lat_min_fmt}'"
        ddm_lon = f"{lon_dir} {lon_deg.zfill(3)}° {lon_min_fmt}'"

        logger.debug('_iter_dmm_no_degree_symbol: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)
        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_dmm_no_degree_symbol(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM sans ° » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_no_degree_symbol(text), None)

# ----------------------------------------------------------------------------
# Détection du format DMM sans ° ni . (ex : "N 38 32 460 W 075 43 659")
# ----------------------------------------------------------------------------

# DDM sans symbole ° ni point décimal : N/S deg min dec, E/W deg min dec,
# séparés par des espaces.
_DETECT_DMM_NO_SYMBOL_REGEX = re.compile(
    r'([NS])\s*(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})\s*'  # Latitude
    r'([EW])\s*(\d{1,3})\s+(\d{1,2})\s+(\d{1,3})'      # Longitude
)


def _iter_dmm_no_symbol_no_dot(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées DDM sans symbole ° ni point décimal :
      - "N 38 32 460 W 075 43 659"
    Séquence attendue :
      N/S  deg  min  dec   E/W  deg   min  dec
    avec espaces comme séparateurs.
    """
    logger.debug("_iter_dmm_no_symbol_no_dot: Analyse du texte: '%s...' (tronqué)", text[:100])
    logger.debug('_iter_dmm_no_symbol_no_dot: Regex utilisée: %s', _DETECT_DMM_NO_SYMBOL_REGEX)
    for match in _DETECT_DMM_NO_SYMBOL_REGEX.finditer(text):
        logger.debug('_iter_dmm_no_symbol_no_dot: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lat_dec, lon_dir, lon_deg, lon_min, lon_dec = match.groups()

        # Mise en forme des composantes minutes + décimales
        lat_min_fmt = lat_min.zfill(2)
        lon_min_fmt = lon_min.zfill(2)
        lat_dec_fmt = lat_dec.ljust(3, '0')[:3]
        lon_dec_fmt = lon_dec.ljust(3, '0')[:3]

        # Validation des bornes
        try:
            lat_min_f = float(f"{lat_min_fmt}.{lat_dec_fmt}")
            lon_min_f = float(f"{lon_min_fmt}.{lon_dec_fmt}")
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_f, int(lon_deg), lon_min_f):
                logger.debug("_iter_dmm_no_symbol_no_dot: Bornes invalides, candidat suivant")
                continue
        except Exception:
            continue

        ddm_lat = f"{lat_dir} {lat_deg.zfill(2)}° {lat_min_fmt}.{lat_dec_fmt}'"
        ddm_lon = f"{lon_dir} {lon_deg.zfill(3)}° {lon_min_fmt}.{lon_dec_fmt}'"

        logger.debug('_iter_dmm_no_symbol_no_dot: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)
        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_dmm_no_symbol_no_dot(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM sans symbole » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_no_symbol_no_dot(text), None)

# ------------------------------------------------------------------------------
# Détection du format géocaching standard (ex: "N29 02.879 W98 01.304")
# ------------------------------------------------------------------------------

# Format géocaching standard : Direction + degrés + espace + minutes.décimales
# (sans symbole ° ni apostrophe).
_DETECT_GEOCACHING_REGEX = re.compile(
    r'([NS])(\d{1,2})\s+(\d{1,2}\.\d{1,3})\s+([EW])(\d{1,3})\s+(\d{1,2}\.\d{1,3})'
)


def _iter_geocaching_standard_format(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format géocaching standard, par exemple :
      - "N29 02.879 W98 01.304"
      - "N48 33.787 E006 38.803"
    Format : Direction + Degrés + Espace + Minutes.Décimales + Espace + Direction + Degrés + Espace + Minutes.Décimales
    """
    logger.debug("_iter_geocaching_standard_format: Analyse du texte: '%s...' (tronqué)", text[:100])

    # Regex spécialement conçue pour le format géocaching standard
    # Accepte : N/S + 1-2 chiffres + espace + minutes.décimales + espace + E/W + 1-3 chiffres + espace + minutes.décimales
    logger.debug('_iter_geocaching_standard_format: Regex utilisée: %s', _DETECT_GEOCACHING_REGEX)
    for match in _DETECT_GEOCACHING_REGEX.finditer(text):
        logger.debug('_iter_geocaching_standard_format: Match trouvé! Groupes: %s', match.groups())
        lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min = match.groups()

        # Formatage des coordonnées (s'assurer que les minutes ont 3 décimales)
        lat_min_fmt = _format_ddm_minutes(lat_min)
        lon_min_fmt = _format_ddm_minutes(lon_min)

        # Validation des bornes
        try:
            lat_min_f = float(lat_min_fmt)
            lon_min_f = float(lon_min_fmt)
            if not _is_valid_degrees_minutes(int(lat_deg), lat_min_f, int(lon_deg), lon_min_f):
                logger.debug("_iter_geocaching_standard_format: Bornes invalides, candidat suivant")
                continue
        except Exception:
            continue

        ddm_lat = f"{lat_dir} {lat_deg.zfill(2)}° {lat_min_fmt}'"
        ddm_lon = f"{lon_dir} {lon_deg.zfill(3)}° {lon_min_fmt}'"

        logger.debug('_iter_geocaching_standard_format: Coordonnées formatées: %s %s', ddm_lat, ddm_lon)

        yield {
            "span": [match.start(), match.end()],
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": f"{ddm_lat} {ddm_lon}"
        }


def _detect_geocaching_standard_format(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « géocaching standard » valide (compat : façade de l'itérateur)."""
    return next(_iter_geocaching_standard_format(text), None)


# ------------------------------------------------------------------------------
# Table des détecteurs — construite et triée UNE SEULE FOIS au chargement.
#
# _DETECTOR_CONFIDENCE associe <itérateur de candidats _iter_*> -> score de
# confiance (0-1) ; plus la valeur est élevée, plus le format est considéré
# fiable. Ces valeurs peuvent être ajustées facilement pour faire évoluer la
# pondération sans toucher au reste du code. L'ordre de déclaration du dict
# sert de tie-break à confiance égale.
#
# _DETECTORS_SORTED = tuples (confiance, ordre, itérateur, nom) triés par
# (-confiance, ordre), consommés par detect_gps_coordinates (early-stop sur le
# premier candidat) et detect_all_gps_coordinates (tous les candidats). Le nom
# reconstitue celui du wrapper historique « _detect_* » (convention de nommage
# _iter_X <-> _detect_X) : il sert de valeur ``source`` dans les résultats et
# reste donc stable vis-à-vis de l'extérieur. Défini ici, après la dernière
# définition de détecteur, car il référence les fonctions par nom.
# ------------------------------------------------------------------------------
_DETECTOR_CONFIDENCE = {
    _iter_geocaching_standard_format:    0.96,  # Nouvelle fonction avec haute priorité
    _iter_dmm_dot_separator:             0.95,
    _iter_compact_coordinates:           0.95,
    _iter_dmm_coordinates:               0.95,
    _iter_dmm_suffix_direction:          0.93,
    _iter_dms_coordinates:               0.92,
    _iter_dms_suffix_direction:          0.90,
    _iter_roman_numerals_coordinates:    0.90,
    _iter_tabspace_coordinates:          0.90,
    _iter_dmm_no_degree_symbol:          0.90,
    _iter_nord_est_variations:           0.88,
    _iter_nord_est_format:               0.85,
    _iter_dmm_no_symbol_no_dot:          0.85,
    _iter_specific_tabpoint_coordinates: 0.82,
    _iter_decimal_pair:                  0.80,
    _iter_simplified_coordinates:        0.80,
    _iter_flexible_coordinates:          0.75,
    _iter_variant_coordinates:           0.70,
}

_DETECTORS_SORTED = sorted(
    (
        (conf, order, func, func.__name__.replace("_iter_", "_detect_", 1))
        for order, (func, conf) in enumerate(_DETECTOR_CONFIDENCE.items())
    ),
    key=lambda d: (-d[0], d[1]),
)


@coordinates_bp.errorhandler(Exception)
def handle_coordinates_error(error):
    """Capture toutes les erreurs non gérées dans ce blueprint."""
    if isinstance(error, HTTPException):
        return error
    return _error_response("Erreur non geree dans le blueprint coordinates", error)
