from typing import Dict, List
import ast
import re
import logging
from flask import Blueprint, request, jsonify, current_app
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)
# Le niveau de log est piloté par la configuration applicative : ne pas forcer DEBUG
# ici (ce module est appelé par le scorer pour chaque candidat bruteforce).
logger.debug("Coordinates blueprint loaded")
try:
    from pyproj import Geod
except ModuleNotFoundError:  # pragma: no cover
    Geod = None

coordinates_bp = Blueprint('coordinates', __name__)

# Detection extraite dans gc_backend.services.coordinates_detection.
# Re-exportee ici pour compatibilite : le scorer et plusieurs
# blueprints/plugins importent encore depuis ce module.
from gc_backend.services.coordinates_detection import (
    convert_ddm_to_decimal,
    detect_all_gps_coordinates,
    detect_gps_coordinates,
    _normalize_origin_coords,
)


# Seuils de la règle géocaching des "2 miles" (distance cache <-> point posté).
# Extraits en constantes pour éviter les valeurs magiques ; pourront être exposés
# en préférence utilisateur si le besoin se confirme.
DISTANCE_WARNING_MILES = 2.0
DISTANCE_FAR_MILES = 2.5



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
                logger.exception('Erreur lors du calcul de la distance: %s', e)
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


# Nouvelle route API pour détecter les coordonnées dans un texte
# Plafond de taille du texte pour la détection simple et multi (évite les
# payloads abusifs ; reprend l'ordre de grandeur du batch divisé par son
# plafond de textes).
_DETECT_ALL_MAX_CHARS = 200_000


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
        if not isinstance(data, dict) or 'text' not in data:
            return jsonify({"error": "Le champ 'text' est requis"}), 400

        text = data['text']
        if not isinstance(text, str):
            return jsonify({"error": "'text' doit être une chaîne"}), 400
        if len(text) > _DETECT_ALL_MAX_CHARS:
            return jsonify({
                "error": f"Texte trop volumineux (max {_DETECT_ALL_MAX_CHARS} caractères)"
            }), 400
            
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
            # Ne pas renvoyer str(e) au client (détails internes, cf.
            # _error_response) : le détail va dans les logs.
            logger.exception("detect_coordinates_in_text: written find a échoué: %s", e)
            enriched['written']['attempted'] = True
            enriched['written']['error'] = (
                "Erreur lors de la détection écrite. Consultez les logs backend."
            )
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


@coordinates_bp.route('/api/detect_coordinates_all', methods=['POST'])
def detect_coordinates_all():
    """
    Détecte TOUTES les coordonnées GPS d'un texte, en une seule requête.

    Contrairement à /api/detect_coordinates (un seul résultat, le plus
    confiant), expose ``detect_all_gps_coordinates`` : tous les candidats
    valides dédupliqués par chevauchement de span, triés par confiance
    décroissante. Pas de détection « en toutes lettres » ici.

    Attend un JSON avec :
    - 'text' (str)                  : texte à analyser (obligatoire)
    - 'include_numeric_only' (bool) : format numérique pur
    - 'origin_coords' (dict|str)    : coordonnées d'origine (directions cardinales)

    Retourne : {"results": [...], "count": n}
    """
    try:
        data = request.get_json()
        if not isinstance(data, dict) or 'text' not in data:
            return jsonify({"error": "Le champ 'text' est requis"}), 400

        text = data.get('text')
        if not isinstance(text, str):
            return jsonify({"error": "'text' doit être une chaîne"}), 400
        if len(text) > _DETECT_ALL_MAX_CHARS:
            return jsonify({
                "error": f"Texte trop volumineux (max {_DETECT_ALL_MAX_CHARS} caractères)"
            }), 400

        include_numeric_only = bool(data.get('include_numeric_only', False))
        # Coordonnées d'origine : dict {ddm_lat, ddm_lon} ou chaîne DDM combinée
        origin_coords = _normalize_origin_coords(data.get('origin_coords'))

        logger.debug(
            "detect_coordinates_all: text_len=%d, numeric_only=%s",
            len(text), include_numeric_only,
        )

        results = detect_all_gps_coordinates(
            text,
            include_numeric_only=include_numeric_only,
            origin_coords=origin_coords,
        )
        return jsonify({"results": results, "count": len(results)})

    except Exception as e:
        return _error_response("Erreur detect_coordinates_all", e)



@coordinates_bp.errorhandler(Exception)
def handle_coordinates_error(error):
    """Capture toutes les erreurs non gérées dans ce blueprint."""
    if isinstance(error, HTTPException):
        return error
    return _error_response("Erreur non geree dans le blueprint coordinates", error)

