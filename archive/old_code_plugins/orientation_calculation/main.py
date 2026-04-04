import re
from pyproj import Geod
from typing import Dict, Optional, List, Any

class MovePointPlugin:
    """
    Plugin pour :
      - Parse une coordonnée au format 'N dd° mm.mmm E dd° mm.mmm'
      - Appliquer un déplacement d'une distance donnée (m, km, miles) à un azimut
      - Renvoyer la nouvelle coordonnée dans le même format.
    """

    def __init__(self):
        self.name = "orientation_calculation"
        self.description = (
            "Déplace un point de 'distance' (en m, km, miles) selon un 'bearing_deg'"
            " et renvoie la nouvelle coordonnée au format 'N dd° mm.mmm E dd° mm.mmm'."
        )

        # Objet Geod pour les calculs sur ellipsoïde WGS84
        self.geod = Geod(ellps="WGS84")

    def parse_coord(self, coord_str: str):
        """
        Parse une coordonnée du type :
          "N 49° 12.374 E 5° 52.727"
        ou  "S 03° 12.123 W 043° 59.999"
        
        Retourne (lat_dec, lon_dec) en degrés décimaux.
        """
        pattern = r"""
            ^\s*([NS])\s+(\d{1,2})°\s+(\d{1,2}\.\d+)\s+
            ([EW])\s+(\d{1,3})°\s+(\d{1,2}\.\d+)
            \s*$
        """
        regex = re.compile(pattern, re.VERBOSE | re.IGNORECASE)
        match = regex.match(coord_str.strip())
        if not match:
            raise ValueError(f"Format de coordonnées invalide: '{coord_str}'")

        ns, lat_deg_str, lat_min_str, ew, lon_deg_str, lon_min_str = match.groups()

        lat_deg = float(lat_deg_str)
        lat_min = float(lat_min_str)
        lon_deg = float(lon_deg_str)
        lon_min = float(lon_min_str)

        # Conversion en degrés décimaux
        lat_dec = lat_deg + (lat_min / 60.0)
        lon_dec = lon_deg + (lon_min / 60.0)

        # Appliquer signe
        if ns.upper() == 'S':
            lat_dec = -lat_dec
        if ew.upper() == 'W':
            lon_dec = -lon_dec

        return lat_dec, lon_dec

    def format_coord(self, lat_dec: float, lon_dec: float):
        """
        Convertit lat_dec, lon_dec (degrés décimaux) au format :
          'N dd° mm.mmm E dd° mm.mmm'
        ou  'S dd° mm.mmm W dd° mm.mmm'
        """
        # Déterminer N/S
        if lat_dec < 0:
            ns = 'S'
            lat_dec = -lat_dec
        else:
            ns = 'N'

        # Déterminer E/W
        if lon_dec < 0:
            ew = 'W'
            lon_dec = -lon_dec
        else:
            ew = 'E'

        # Extraire partie degrés et minutes
        lat_deg_int = int(lat_dec)  # partie entière
        lat_min = (lat_dec - lat_deg_int) * 60.0

        lon_deg_int = int(lon_dec)
        lon_min = (lon_dec - lon_deg_int) * 60.0

        # Formater avec 3 décimales pour les minutes
        # Ex: N 49° 12.374 E 5° 52.727
        return f"{ns} {lat_deg_int}° {lat_min:.3f} {ew} {lon_deg_int}° {lon_min:.3f}"

    def convert_distance_to_meters(self, distance: float, unit: str) -> float:
        """
        Convertit la distance en mètres selon l'unité (m, km, miles).
        """
        unit = unit.lower()
        if unit == 'm':
            return distance
        elif unit == 'km':
            return distance * 1000.0
        elif unit in ['mile', 'miles']:
            return distance * 1609.344  # 1 mile ~ 1609.344 m
        else:
            raise ValueError(f"Unité de distance inconnue: '{unit}'")

    def move_point(self, lat, lon, distance_m, bearing_deg):
        """
        Déplace le point (lat, lon) de 'distance_m' mètres
        selon un azimut 'bearing_deg' (0° = Nord).
        Retourne (new_lat, new_lon) en degrés décimaux.
        """
        # Geod.fwd prend (lon, lat, azimut, distance) en entrée
        lon2, lat2, _ = self.geod.fwd(lon, lat, bearing_deg, distance_m, radians=False)
        return lat2, lon2

    def detect_gps_coordinates(self, text: str) -> Dict[str, Any]:
        """
        Recherche des coordonnées GPS dans un texte.
        Version simplifiée pour le plugin. Peut être étendue avec d'autres formats.
        
        Returns:
            Dict avec 'exist', 'ddm', 'ddm_lat', 'ddm_lon', 'decimal'
        """
        # Pattern basique pour détecter des coordonnées au format N XX° XX.XXX E XX° XX.XXX
        pattern = r"""
            ([NS])\s+(\d{1,2})°\s+(\d{1,2}\.\d+)\s+
            ([EW])\s+(\d{1,3})°\s+(\d{1,2}\.\d+)
        """
        regex = re.compile(pattern, re.VERBOSE | re.IGNORECASE)
        match = regex.search(text)
        
        if not match:
            return {
                "exist": False,
                "ddm_lat": None,
                "ddm_lon": None,
                "ddm": None,
                "decimal": {"latitude": None, "longitude": None}
            }
        
        ns, lat_deg, lat_min, ew, lon_deg, lon_min = match.groups()
        
        # Formatage pour DDM
        ddm_lat = f"{ns} {lat_deg}° {lat_min}'"
        ddm_lon = f"{ew} {lon_deg}° {lon_min}'"
        ddm = f"{ddm_lat} {ddm_lon}"
        
        # Conversion en décimal
        lat_dec = float(lat_deg) + (float(lat_min) / 60.0)
        if ns.upper() == 'S':
            lat_dec = -lat_dec
            
        lon_dec = float(lon_deg) + (float(lon_min) / 60.0)
        if ew.upper() == 'W':
            lon_dec = -lon_dec
            
        return {
            "exist": True,
            "ddm_lat": ddm_lat,
            "ddm_lon": ddm_lon,
            "ddm": ddm,
            "decimal": {"latitude": lat_dec, "longitude": lon_dec}
        }

    def extract_projection_info(self, text: str) -> dict:
        """
        Extrait les informations de projection (distance et angle) d'un texte.
        Retourne un dictionnaire avec les clés 'distance', 'angle' et 'unit'.
        
        Exemples de textes pris en charge:
        - "Allez à 869,119 m direction 191,858 degrés et Entre minéral et végétal"
        - "A 744,747 m direction 193,974° à partir des coordonnées affichées"
        - "2390m 43.27°"
        - "1313m, 197.97°"
        - "Pour obtenir les coordonnées, projetez vous de 1247.162 mètres à 27,309 degrés"
        - "À 25 degrés sur 500 mètres"
        - "Project yourself 1000 meters at 90 degrees"
        - "Projetez 2.5 kilomètres à 60 degrés"
        - "Projetez 3 miles à 120 degrés"
        """
        result = {'found': False, 'distance': None, 'angle': None, 'unit': 'm'}
        
        # Normaliser le texte (remplacer virgules par points pour les nombres)
        text = text.replace(',', '.')
        
        # Définir les unités de distance en français et anglais
        unit_patterns = {
            'm': r'm(?:(?:è|e)tres?|eters?)?',
            'km': r'k(?:ilo)?(?:m(?:(?:è|e)tres?|eters?)?)',
            'miles': r'miles?'
        }
        
        # Regrouper toutes les unités possibles pour les utiliser dans les patterns
        all_units = '|'.join(unit_patterns.values())
        
        # Pattern pour le mot "degrés" en français et anglais, avec ou sans accent
        degrees_pattern = r'(?:degr[ée]s|degrees?|°)'
        
        # Patterns pour extraire distance et angle
        # 1. Pattern pour "X m direction Y°" ou variantes
        pattern1 = r'(?:à|allez\sà|a|go|go\sto)\s+(\d+(?:\.\d+)?)\s*(' + all_units + r')?\s+(?:direction|azimut|cap|à|toward|towards|at|to)\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')'
        
        # 2. Pattern pour "X m Y°" (format court)
        pattern2 = r'(\d+(?:\.\d+)?)\s*(' + all_units + r')?\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')'
        
        # 3. Pattern pour "Xm, Y°" (format avec virgule)
        pattern3 = r'(\d+(?:\.\d+)?)(' + all_units + r')[\s,\.]+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')'
        
        # 4. Pattern pour "projetez vous de X mètres à Y degrés" (format complet avec mots)
        pattern4 = r'(?:projetez|projeter|project|move|go)(?:\s+(?:vous|yourself|from))?\s+(?:de|of|for)?\s+(\d+(?:\.\d+)?)\s*(' + all_units + r')(?:\s+(?:à|a|to|at|en direction))?\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')'
        
        # 5. Pattern plus simple pour "projetez X kilomètres à Y degrés"
        pattern5 = r'(?:projetez|projeter|project|move|go)(?:\s+(?:vous|yourself))?\s+(\d+(?:\.\d+)?)\s*(' + all_units + r')\s+(?:à|a|to|at|en direction|direction|in direction)\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')'
        
        # 6. Pattern pour "Y degrés sur X mètres" (angle d'abord, puis distance)
        pattern6 = r'(?:à|a|at)?\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')\s+(?:sur|sur une distance de|on|for|over)\s+(\d+(?:\.\d+)?)\s*(' + all_units + r')'
        
        # 7. Pattern anglais "At X degrees for Y meters"
        pattern7 = r'(?:at|to)?\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')\s+(?:for|over|of|on)\s+(\d+(?:\.\d+)?)\s*(' + all_units + r')'
        
        # 8. Pattern spécial pour "Project yourself NUMBER meters at NUMBER degrees"
        pattern8 = r'project\s+yourself\s+(\d+(?:\.\d+)?)\s*(' + all_units + r')\s+at\s+(\d+(?:\.\d+)?)\s*(?:' + degrees_pattern + r')'
        
        # Liste des patterns à essayer
        patterns = [pattern1, pattern2, pattern3, pattern4, pattern5, pattern6, pattern7, pattern8]
        
        # Essayer tous les patterns
        for i, pattern in enumerate(patterns):
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                # Les patterns 6 et 7 ont l'angle en premier, les autres ont la distance en premier
                if i in [5, 6]:  # pattern6 ou pattern7
                    angle_str, distance_str, unit = match.groups()  # Ordre inversé: angle puis distance
                else:
                    distance_str, unit, angle_str = match.groups()
                
                result['found'] = True
                result['distance'] = float(distance_str)
                result['angle'] = float(angle_str)
                
                if unit:
                    unit = unit.lower()
                    # Déterminer l'unité réelle basée sur le texte
                    for unit_key, unit_pattern in unit_patterns.items():
                        if re.match('^' + unit_pattern + '$', unit, re.IGNORECASE):
                            result['unit'] = unit_key
                            break
                        
                    # Vérification spécifique pour "miles"
                    if 'mile' in unit:
                        result['unit'] = 'miles'
                return result
            
        return result

    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient des coordonnées valides ou des informations de projection.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés en plus des caractères attendus
            embedded: True si le texte peut contenir des coordonnées intégrées
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si des coordonnées valides ou informations de projection ont été trouvées
            - fragments: Liste des fragments trouvés
            - score: Score de confiance (0.0 à 1.0)
        """
        # En mode embedded, on recherche des informations de projection dans le texte
        if embedded:
            projection_info = self.extract_projection_info(text)
            if projection_info['found']:
                # On a trouvé une projection, on renvoie le texte entier comme fragment
                return {
                    "is_match": True,
                    "fragments": [{"value": text, "start": 0, "end": len(text), "projection_info": projection_info}],
                    "score": 1.0
                }
            return {"is_match": False, "fragments": [], "score": 0.0}
        
        # En mode non-embedded, on vérifie simplement si le texte est une coordonnée valide
        try:
            self.parse_coord(text)
            return {
                "is_match": True,
                "fragments": [{"value": text, "start": 0, "end": len(text)}],
                "score": 1.0
            }
        except ValueError:
            return {"is_match": False, "fragments": [], "score": 0.0}

    def decode_fragments(self, text: str, fragments: list, origin_coords: str = None) -> str:
        """
        Projette les coordonnées trouvées dans le texte.
        
        Args:
            text: Texte original
            fragments: Liste des fragments trouvés
            origin_coords: Coordonnées d'origine (optionnel)
            
        Returns:
            Texte avec les coordonnées projetées
        """
        if not fragments:
            return text
        
        # En mode embedded, utiliser les informations de projection extraites
        for fragment in fragments:
            if 'projection_info' in fragment:
                projection_info = fragment['projection_info']
                
                # Vérifier qu'on a des coordonnées d'origine
                if not origin_coords:
                    return "Erreur: Coordonnées d'origine manquantes pour la projection"
                
                try:
                    # Parser les coordonnées d'origine
                    lat_dec, lon_dec = self.parse_coord(origin_coords)
                    
                    # Convertir la distance en mètres
                    dist_m = self.convert_distance_to_meters(projection_info['distance'], projection_info['unit'])
                    
                    # Calculer la nouvelle position
                    new_lat, new_lon = self.move_point(lat_dec, lon_dec, dist_m, projection_info['angle'])
                    
                    # Formater les nouvelles coordonnées
                    return self.format_coord(new_lat, new_lon)
                except ValueError as e:
                    return f"Erreur: {str(e)}"
        
        # Dans le cas non-embedded, il n'y a qu'un seul fragment qui correspond à tout le texte
        fragment = fragments[0]
        return fragment["value"]

    def generate_log_message(self, mode, strict_mode, text, origin_coords=None, distance=None, angle=None, unit=None, projection_info=None):
        """
        Génère un message de log détaillé qui explique ce que le plugin a compris des coordonnées.
        """
        log_lines = []
        
        if mode == "decode":
            if strict_mode:
                # Mode strict
                log_lines.append("Mode strict: projection directe des coordonnées")
                log_lines.append(f"Coordonnée de départ: {text}")
                log_lines.append(f"Distance: {distance} {unit}")
                log_lines.append(f"Angle: {angle}°")
            else:
                # Mode smooth
                log_lines.append("Mode smooth: extraction des informations de projection du texte")
                log_lines.append(f"Texte analysé: \"{text}\"")
                
                if projection_info and projection_info.get('found', False):
                    log_lines.append(f"Informations extraites:")
                    log_lines.append(f"  - Distance: {projection_info['distance']} {projection_info['unit']}")
                    log_lines.append(f"  - Angle: {projection_info['angle']}°")
                    log_lines.append(f"Coordonnée d'origine: {origin_coords}")
                else:
                    log_lines.append("Aucune information de projection n'a pu être extraite du texte.")
        
        return "\n".join(log_lines)

    def format_result_with_coordinates(self, new_coord_str, text, mode, log_message=None, enable_gps_detection=True):
        """
        Crée une structure de résultat uniforme pour les modes strict et smooth,
        en ajoutant les informations de coordonnées.
        
        Args:
            new_coord_str: Les nouvelles coordonnées calculées
            text: Le texte d'entrée
            mode: Mode d'exécution (decode/encode)
            log_message: Message de log à inclure (optionnel)
            enable_gps_detection: Si True, inclut les coordonnées GPS détectées dans le résultat
            
        Returns:
            Dictionnaire formaté pour le retour
        """
        # Extraire les parties des coordonnées pour faciliter l'utilisation
        parts = new_coord_str.split()
        if len(parts) >= 6:
            gc_lat = f"{parts[0]} {parts[1]}° {parts[2]}"
            gc_lon = f"{parts[3]} {parts[4]}° {parts[5]}"
        else:
            gc_lat = ""
            gc_lon = ""
            
        # Créer la structure de base du résultat
        result = {
            "result": {
                "text": {
                    "text_output": new_coord_str,
                    "text_input": text,
                    "mode": mode
                },
                "gc_lat": gc_lat,
                "gc_lon": gc_lon
            }
        }
        
        # Ajouter le log s'il existe
        if log_message:
            result["result"]["log"] = log_message
        
        # Ajouter les coordonnées GPS détectées si demandé
        if enable_gps_detection:
            coordinates_info = self.detect_gps_coordinates(new_coord_str)
            result["coordinates"] = coordinates_info
            
            # Format compatible avec les plugins standards
            if coordinates_info["exist"]:
                result["result"]["gps_coordinates"] = {
                    "exist": True,
                    "ddm": coordinates_info["ddm"],
                    "ddm_lat": coordinates_info["ddm_lat"],
                    "ddm_lon": coordinates_info["ddm_lon"],
                    "decimal": coordinates_info["decimal"]
                }
            
        return result

    def execute(self, inputs: dict):
        """
        Point d'entrée PluginManager.
        Inputs:
          - text (str) : texte contenant des infos de projection
          - origin_coords (str) : coordonnées d'origine au format 'N dd° mm.mmm E dd° mm.mmm'
          - bearing_deg (float) : ex 59.0 (utilisé seulement en mode strict)
          - distance (float) : (utilisé seulement en mode strict)
          - distance_unit (str) : "m", "km", "miles" (utilisé seulement en mode strict)
          - mode (str) : "decode", "encode" (pour compatibilité avec le système de plugins)
          - strict (str) : "strict" ou "smooth"
          - enable_gps_detection (bool) : active la détection des coordonnées GPS
        
        Output:
          {
            "result": {
              "text": {
                "text_output": "N 49° 12.XXX E 5° 52.XXX",
                "text_input": texte original,
                "mode": "decode"
              },
              "gc_lat": "N 49° 12.XXX",
              "gc_lon": "E 5° 52.XXX",
              "log": "Informations détaillées sur ce qui a été compris et calculé",
              "gps_coordinates": {
                "exist": true,
                "ddm_lat": "N 49° 12.XXX'",
                "ddm_lon": "E 5° 52.XXX'",
                "ddm": "N 49° 12.XXX' E 5° 52.XXX'",
                "decimal": {"latitude": 49.XXX, "longitude": 5.XXX}
              }
            },
            "coordinates": {
              "exist": true,
              "ddm_lat": "N 49° 12.XXX'",
              "ddm_lon": "E 5° 52.XXX'",
              "ddm": "N 49° 12.XXX' E 5° 52.XXX'",
              "decimal": {"latitude": 49.XXX, "longitude": 5.XXX}
            }
          }
        """
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        strict_mode = inputs.get("strict", "").lower() == "strict"
        embedded = not strict_mode  # En mode smooth, on considère que le texte peut contenir des infos intégrées
        allowed_chars = inputs.get("allowed_chars", None)
        origin_coords = inputs.get("origin_coords", "")
        enable_gps_detection = inputs.get("enable_gps_detection", True)
        
        print("PROJECTION", inputs)
        
        # En mode smooth, vérifier si le texte contient des coordonnées GPS
        extracted_coords_from_text = None
        if not strict_mode and text:
            input_coordinates = self.detect_gps_coordinates(text)
            if input_coordinates["exist"]:
                # Si le texte contient déjà des coordonnées, les extraire
                extracted_coords_from_text = input_coordinates["ddm"]
                # Chercher les informations de projection dans le reste du texte
                text_without_coords = text.replace(input_coordinates["ddm"], "")
                if text_without_coords.strip():
                    text = text_without_coords
        
        try:
            if mode == "decode":
                log_message = ""
                
                if embedded:
                    # Mode smooth/embedded
                    if not text:
                        return {"error": "Texte avec projection manquant"}
                    
                    # En mode smooth, utiliser les coordonnées extraites du texte si disponibles
                    if extracted_coords_from_text and not origin_coords:
                        origin_coords = extracted_coords_from_text
                        
                    # Seulement vérifier les coordonnées d'origine si on n'a pas pu en extraire du texte
                    if not origin_coords and not extracted_coords_from_text:
                        return {"error": "Coordonnées d'origine manquantes pour le mode smooth"}
                        
                    # Vérification et extraction des informations de projection du texte
                    check = self.check_code(text, strict=False, allowed_chars=allowed_chars, embedded=True)
                    
                    if not check["is_match"]:
                        return {"error": "Aucune information de projection détectée dans le texte"}
                    
                    # Récupérer les informations de projection
                    projection_info = check["fragments"][0].get("projection_info", {})
                    
                    # Générer le message de log
                    log_message = self.generate_log_message(
                        mode, 
                        strict_mode, 
                        text, 
                        origin_coords=origin_coords, 
                        projection_info=projection_info
                    )
                    
                    # Projeter les coordonnées
                    new_coord_str = self.decode_fragments(text, check["fragments"], origin_coords)
                    
                    # Vérifier si c'est une erreur
                    if new_coord_str.startswith("Erreur:"):
                        return {"error": new_coord_str}
                    
                    # Créer le résultat formaté avec les coordonnées
                    return self.format_result_with_coordinates(
                        new_coord_str, 
                        text, 
                        mode, 
                        log_message, 
                        enable_gps_detection
                    )
                else:
                    # Mode strict/non-embedded : utiliser origin_coords + distance/angle
                    bearing_deg = float(inputs.get("bearing_deg", 0.0))
                    distance_val = float(inputs.get("distance", 0.0))
                    distance_unit = inputs.get("distance_unit", "m")
                    
                    # En mode strict, utiliser les coordonnées extraites du texte si disponibles
                    if extracted_coords_from_text and not origin_coords:
                        origin_coords = extracted_coords_from_text
                    
                    if not origin_coords:
                        return {"error": "Coordonnées d'origine manquantes pour le mode strict"}
                    
                    # Générer le message de log
                    log_message = self.generate_log_message(
                        mode, 
                        strict_mode, 
                        origin_coords, 
                        distance=distance_val, 
                        angle=bearing_deg, 
                        unit=distance_unit
                    )
                    
                    # 1. Parser la coordonnée => lat/lon (degrés décimaux)
                    lat_dec, lon_dec = self.parse_coord(origin_coords)

                    # 2. Convertir la distance en mètres
                    dist_m = self.convert_distance_to_meters(distance_val, distance_unit)

                    # 3. Calculer la nouvelle position
                    new_lat, new_lon = self.move_point(lat_dec, lon_dec, dist_m, bearing_deg)

                    # 4. Reformater la sortie => 'N 49° 12.XXX E 5° 52.XXX'
                    new_coord_str = self.format_coord(new_lat, new_lon)
                    
                    # En mode strict, le texte d'entrée pour le résultat est origin_coords
                    input_text = origin_coords if not text else text
                    
                    # Créer le résultat formaté avec les coordonnées
                    return self.format_result_with_coordinates(
                        new_coord_str, 
                        input_text, 
                        mode, 
                        log_message, 
                        enable_gps_detection
                    )
            
            elif mode == "encode":
                # Le mode "encode" n'a pas de sens pour ce plugin, mais nous le supportons pour compatibilité
                return {"error": "Le mode 'encode' n'est pas applicable pour ce plugin"}
            
            else:
                return {"error": f"Mode inconnu : {mode}"}
                
        except Exception as e:
            return {"error": f"Erreur pendant le traitement : {e}"}