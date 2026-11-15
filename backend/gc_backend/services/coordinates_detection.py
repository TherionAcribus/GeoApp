"""Detection de coordonnées GPS dans du texte (multi-formats).

Extraite du blueprint ``coordinates`` : ce module ne connaît pas Flask et
n'expose que les fonctions pures de détection et de normalisation utilisées
par les endpoints, le scorer et les plugins.
"""

from typing import Iterator, Optional, Dict, List
import re
import logging

logger = logging.getLogger(__name__)

# Distance max (en caractères) tolérée entre les composantes latitude et
# longitude d'une même paire. Au-delà, ce sont vraisemblablement deux
# coordonnées indépendantes (waypoints, étapes...) qu'il ne faut pas apparier.
MAX_COORD_PAIR_GAP = 40

# La lettre cardinale ne doit pas être collée à une lettre : elle doit être
# isolée ou précédée d'un chiffre (« N4812123 », « WP1N48 »), sans quoi le S de
# « WAYPOINTS 48° … » ou le e de « température de 12° » sont lus comme des
# hémisphères. Même garde-fou que _DETECT_NE_VAR_* — appliqué en tête de chaque
# pattern de détecteur (le groupe E/W interne est toujours précédé de chiffres).
_CARDINAL_LB = r'(?<![^\W\d_])'

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
    if direction in ('N', 'S') and not (0 <= degrees < 90 or degrees == 90 and minutes == 0):
        raise ValueError(f"Latitude hors bornes: {degrees}° {minutes}'")
    if direction in ('E', 'W') and not (0 <= degrees < 180 or degrees == 180 and minutes == 0):
        raise ValueError(f"Longitude hors bornes: {degrees}° {minutes}'")

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

# ------------------------------------------------------------------------------
# Utilitaires de validation des composantes DDM
# ------------------------------------------------------------------------------

def _is_valid_degrees_minutes(lat_deg: int, lat_min: float, lon_deg: int, lon_min: float) -> bool:
    """
    Valide les bornes des degrés et minutes pour une coordonnée DDM.
    - Latitude degrés: 0 à 90 (90° n'admet que 00.000 en minutes)
    - Longitude degrés: 0 à 180 (180° n'admet que 00.000 en minutes)
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
        # La valeur totale ne doit pas dépasser 90°/180°.
        if lat_deg == 90 and lat_min > 0:
            return False
        if lon_deg == 180 and lon_min > 0:
            return False
        return True
    except Exception:
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


def _ddm_candidate(span, lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min) -> Optional[Dict]:
    """Construit un candidat DDM validé, ``None`` si hors bornes ou non numérique.

    Factorise le squelette commun des détecteurs : validation des bornes
    (``_is_valid_degrees_minutes``) puis formatage canonique ``X DD° MM.ddd'``
    (degrés zfillés 2/3 chiffres, minutes via ``_format_ddm_minutes``).
    ``lat_min``/``lon_min`` acceptent str ou float ; la virgule décimale est
    tolérée. Un float (minutes calculées, p.ex. DMS -> DDM) est arrondi au
    millième ; une chaîne brute est tronquée/paddée via ``_format_ddm_minutes``.
    """
    def _fmt_min(v) -> str:
        if isinstance(v, float):
            return f"{v:.3f}"
        return _format_ddm_minutes(str(v).replace(',', '.'))

    try:
        lat_min_s = str(lat_min).replace(',', '.')
        lon_min_s = str(lon_min).replace(',', '.')
        if not _is_valid_degrees_minutes(
            int(lat_deg), float(lat_min_s), int(lon_deg), float(lon_min_s)
        ):
            return None
    except (TypeError, ValueError):
        return None

    ddm_lat = f"{str(lat_dir).upper()} {str(lat_deg).zfill(2)}° {_fmt_min(lat_min)}'"
    ddm_lon = f"{str(lon_dir).upper()} {str(lon_deg).zfill(3)}° {_fmt_min(lon_min)}'"
    return {
        "span": [span[0], span[1]] if span else None,
        "exist": True,
        "ddm_lat": ddm_lat,
        "ddm_lon": ddm_lon,
        "ddm": f"{ddm_lat} {ddm_lon}",
    }


def _decimal_candidate(span, lat: float, lon: float, lat_dir: str, lon_dir: str) -> Optional[Dict]:
    """Construit un candidat depuis des degrés décimaux, ``None`` si hors bornes.

    ``lat_dir``/``lon_dir`` : hémisphères déjà déterminés par l'appelant
    (lettre cardinale ou signe de la valeur).
    """
    if abs(lat) > 90 or abs(lon) > 180:
        return None

    lat_deg, lat_min = _decimal_to_ddm(lat)
    lon_deg, lon_min = _decimal_to_ddm(lon)
    ddm_lat = f"{lat_dir} {lat_deg:02d}° {lat_min:06.3f}'"
    ddm_lon = f"{lon_dir} {lon_deg:03d}° {lon_min:06.3f}'"
    return {
        "span": [span[0], span[1]] if span else None,
        "exist": True,
        "ddm_lat": ddm_lat,
        "ddm_lon": ddm_lon,
        "ddm": f"{ddm_lat} {ddm_lon}",
        "decimal_latitude": round(lat, 8),
        "decimal_longitude": round(lon, 8),
    }

# ------------------------------------------------------------------------------
# Détection du format DMM classique (par exemple "N 48° 33.787' E 006° 38.803'")
# ------------------------------------------------------------------------------

# Séparateur toléré entre les composantes latitude/longitude : espaces,
# ponctuation usuelle (virgule, point-virgule, slash, tiret) et le mot « et »,
# empilables (« …, et E … »). Les chiffres restent interdits : sans eux, pas de
# traversée d'une autre coordonnée.
_COMPONENT_SEP = r'\s*(?:(?:[,;:/-]|(?i:et)\b)\s*)*'

# Pattern DDM « classique » : N/S deg° min[.,]dec E/W deg° min[.,]dec.
# La lettre cardinale peut être suivie de « : » ou « = » (« N: 48° 51.234 »).
_DETECT_DMM_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])[:=]?\s*(\d{1,2})\s*[°º]\s*(\d{1,2}(?:[.,]\d+)?)[\'"]?'
    + _COMPONENT_SEP
    + r'([EW])[:=]?\s*(\d{1,3})\s*[°º]\s*(\d{1,2}(?:[.,]\d+)?)[\'"]?'
)


def _iter_dmm_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """Itère tous les candidats DMM valides (un match invalide ne masque plus les suivants)."""
    for match in _DETECT_DMM_REGEX.finditer(text):
        lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, lat_min,
                              lon_dir, lon_deg, lon_min)
        if cand:
            yield cand


def _detect_dmm_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat DMM valide (compat : API historique en façade de l'itérateur)."""
    return next(_iter_dmm_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format avec tabulations et espaces (ex: "N 48 ° 32 . 296 E 6 ° 40 . 636")
# ------------------------------------------------------------------------------

# Pattern plus souple qui accepte des variations dans les espaces et la
# ponctuation (DOTALL conservé du code d'origine).
_DETECT_TABSPACE_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])\s*(\d{1,2})\s*°\s*(\d{1,2})\s*[.,]\s*(\d{1,3})\s*'
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
    for match in _DETECT_TABSPACE_REGEX.finditer(text):
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                              lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
        if cand:
            yield cand


def _detect_tabspace_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « tabspace » valide (compat : façade de l'itérateur)."""
    return next(_iter_tabspace_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format variant (ex : "NORD 4833787 EST 638803")
# ------------------------------------------------------------------------------

# Le pattern autorise espaces, retours à la ligne ou "/" comme séparateurs.
_DETECT_VARIANT_REGEX = re.compile(
    _CARDINAL_LB + r"(?P<lat_dir>[NS])\s*[/\n\s]*\s*(?P<lat>\d{7})\s*(?P<lon_dir>[EW])\s*[/\n\s]*\s*(?P<lon>\d{6,8})"
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
    _CARDINAL_LB + r'([NS])\s*(\d{1,2})\s*°\s*(\d{1,2})\s*\.\s*(\d{1,3})'
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
    for match in _DETECT_SPECIFIC_TABPOINT_REGEX.finditer(text):
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                              lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
        if cand:
            yield cand


def _detect_specific_tabpoint_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « tabpoint » valide (compat : façade de l'itérateur)."""
    return next(_iter_specific_tabpoint_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection simplifiée pour le format exact de l'exemple
# ------------------------------------------------------------------------------

# Séquences de chiffres consécutifs (extraction des composantes par ligne).
_DIGITS_RUN_REGEX = re.compile(r'\d+')

# Reste d'une ligne « simplified » : chiffres et séparateurs uniquement (pas de
# lettre), avec au moins un chiffre.
_SIMPLIFIED_LINE_REGEX = re.compile(r'[\d\W]*\d[\d\W]*')


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
            # Le reste de chaque ligne ne doit contenir que des chiffres et
            # des séparateurs : « N'oubliez pas 1 stylo, 2 gants et 3 amis »
            # commençait aussi par « N » et alignait trois nombres.
            if not (
                _SIMPLIFIED_LINE_REGEX.fullmatch(lat_line[1:])
                and _SIMPLIFIED_LINE_REGEX.fullmatch(lon_line[1:])
            ):
                logger.debug("_iter_simplified_coordinates: Lettres dans la ligne, rejet")
                return

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

                cand = _ddm_candidate(None, lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                                      lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
                if not cand:
                    logger.debug("_iter_simplified_coordinates: Bornes invalides, rejet")
                    return
                yield cand
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
    _CARDINAL_LB + r'([NS])\s*(\d{1,2})(?:\s*[°º]|\s+deg|\s+degrees)\s*(\d{1,2})(?:[.,]\s*|\s+)(\d{1,3})',
    re.IGNORECASE,
)
_DETECT_FLEXIBLE_LON_REGEX = re.compile(
    _CARDINAL_LB + r'([EW])\s*(\d{1,3})(?:\s*[°º]|\s+deg|\s+degrees)\s*(\d{1,2})(?:[.,]\s*|\s+)(\d{1,3})',
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

            span = (min(lat_match.start(), lon_match.start()),
                    max(lat_match.end(), lon_match.end()))
            cand = _ddm_candidate(span, lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                                  lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
            if cand:
                yield cand


def _detect_flexible_coordinates(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « flexible » valide (compat : façade de l'itérateur)."""
    return next(_iter_flexible_coordinates(text), None)

# ------------------------------------------------------------------------------
# Détection du format NORD/EST avec chiffres séparés par des espaces
# ------------------------------------------------------------------------------

# Pattern pour détecter la lettre cardinale suivie de chiffres séparés par
# des espaces (les mots « nord/est/sud/ouest… » ont été blankés en amont).
_DETECT_NORD_EST_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})(?:\s+|\s*[/\n]\s*)([EW])\s+(\d{1,3})\s+(\d{1,2})\s+(\d{1,3})'
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
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                              lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
        if cand:
            yield cand


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
# Le séparateur non numérique entre la lettre et chaque groupe de chiffres
# est BORNÉ (_NE_VAR_MAX_SEP) et sans lettres : un « [^\d]* » libre assemblait
# des chiffres éparpillés à distance arbitraire (« N x x x …(200 chars)…
# 48 32 296 » formait une fausse latitude), et [^\w] rejette aussi les mots
# intercalés (« N vaut 48 a 32 b 296 »). L'appariement latitude/longitude
# reste régi par MAX_COORD_PAIR_GAP, inchangé.
_NE_VAR_MAX_SEP = 10
_DETECT_NE_VAR_NORD_REGEX = re.compile(
    rf'(?<![^\W\d_])([NS])(?![^\W\d_])[^\w]{{0,{_NE_VAR_MAX_SEP}}}(\d{{1,2}})[^\w]{{0,{_NE_VAR_MAX_SEP}}}(\d{{1,2}})[^\w]{{0,{_NE_VAR_MAX_SEP}}}(\d{{1,3}})'
)
_DETECT_NE_VAR_EST_REGEX = re.compile(
    rf'(?<![^\W\d_])([EW])(?![^\W\d_])[^\w]{{0,{_NE_VAR_MAX_SEP}}}(\d{{1,3}})[^\w]{{0,{_NE_VAR_MAX_SEP}}}(\d{{1,2}})[^\w]{{0,{_NE_VAR_MAX_SEP}}}(\d{{1,3}})'
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

            span = (min(nord_match.start(), est_match.start()),
                    max(nord_match.end(), est_match.end()))
            cand = _ddm_candidate(span, lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                                  lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
            if cand:
                yield cand


def _detect_nord_est_variations(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « nord/est variations » valide (compat : façade de l'itérateur)."""
    return next(_iter_nord_est_variations(text), None)

# ------------------------------------------------------------------------------
# Détection du format DMS (degrés, minutes, secondes)
# ------------------------------------------------------------------------------

# Pattern du format DMS (degrés, minutes, secondes).
_DETECT_DMS_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])[:=]?\s*(\d{1,2})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:[.,]\d+)?)[\"\']*'
    + _COMPONENT_SEP
    + r'([EW])[:=]?\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:[.,]\d+)?)[\"\']*'
)


def _iter_dms_coordinates(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées au format DMS (degrés, minutes, secondes), par exemple :
      - "N 48° 51' 24.12\" E 002° 17' 26.1\""

    Ce format est couramment utilisé dans le géocaching.
    """
    for match in _DETECT_DMS_REGEX.finditer(text):
        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()

        # Convertir DMS en DDM : secondes -> minutes décimales (la virgule est
        # acceptée par le pattern : « 51' 24,5" » vaut 24.5 secondes).
        try:
            lat_min_dec = int(lat_min) + float(lat_sec.replace(',', '.')) / 60
            lon_min_dec = int(lon_min) + float(lon_sec.replace(',', '.')) / 60
        except (TypeError, ValueError):
            continue

        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, lat_min_dec,
                              lon_dir, lon_deg, lon_min_dec)
        if cand:
            yield cand


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
    _CARDINAL_LB + r'([NS])\s+((?:[IVXLCDM]+)\s+(?:[IVXLCDM]+)\s+(?:[IVXLCDM]+))\s+([EW])\s+((?:[IVXLCDM]+)\s+(?:[IVXLCDM]+)\s+(?:[IVXLCDM]+))',
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

                # Formatage + validation des bornes (lettres canoniques en majuscules)
                cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_sec}",
                                      lon_dir, lon_deg, f"{lon_min}.{lon_sec}")
                if cand:
                    yield cand
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

            cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_dec}",
                                  lon_dir, lon_deg, f"{lon_min}.{lon_dec}")
            if cand:
                yield cand
        except Exception as e:
            logger.exception('_iter_numeric_only: Erreur lors du formatage: %s', e)


def _detect_numeric_only_coordinates(text: str, origin_coords: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « numérique pur » valide (compat : façade de l'itérateur)."""
    return next(_iter_numeric_only(text, origin_coords), None)

# ------------------------------------------------------------------------------
# Détection du format compact sans séparateurs (ex: "N4812123E00612123")
# ------------------------------------------------------------------------------

# Format compact : direction latitude, 7 chiffres, direction longitude,
# 6-8 chiffres, espaces optionnels entre les composants.
_DETECT_COMPACT_REGEX = re.compile(_CARDINAL_LB + r'([NS])\s*(\d{7})\s*([EW])\s*(\d{6,8})', re.IGNORECASE)


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

            cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_dec}",
                                  lon_dir, lon_deg, f"{lon_min}.{lon_dec}")
            if cand:
                yield cand
        except Exception as e:
            logger.exception('_iter_compact_coordinates: Erreur lors du formatage: %s', e)


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
    _CARDINAL_LB + r'([ns])\s*(\d{1,2})\.(\d{2})\.(\d{3})\s*'  # Latitude : dir, deg, minutes, décimales
    r'([ew])\s*(\d{1,3})\.(\d{2})\.(\d{3})',    # Longitude : dir, deg, minutes, décimales
    re.IGNORECASE,
)


def _iter_dmm_dot_separator(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées DDM où les séparateurs de degrés et minutes sont des points :
      - N50.02.117 e004.52.677
    Les lettres cardinales peuvent être en majuscule ou minuscule.
    """
    for match in _DETECT_DMM_DOT_REGEX.finditer(text):
        lat_dir, lat_deg, lat_min, lat_dec, lon_dir, lon_deg, lon_min, lon_dec = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_dec}",
                              lon_dir, lon_deg, f"{lon_min}.{lon_dec}")
        if cand:
            yield cand


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


# Paire de degrés décimaux : 3 à 8 décimales par valeur, séparateur
# virgule/point-virgule/espace, signe optionnel.
_DETECT_DECIMAL_PAIR_REGEX = re.compile(
    r'(?<![\d.])(-?\d{1,3}\.\d{3,8})\s*(?:[,;]\s*|\s+)(-?\d{1,3}\.\d{3,8})(?![\d.])'
)


def _iter_decimal_pair(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les paires de coordonnées en degrés décimaux, par exemple :
      - "48.8566, 2.3522"
      - "-33.8688 151.2093"
    Exige 3 à 8 décimales par valeur (évite les faux positifs type "3.14, 2.71").
    Le signe détermine l'hémisphère (S/W).

    NB : pas de garde-fou « lettre cardinale + chiffre » sur le texte entier —
    une lettre cardinale n'importe où (« note 5 : » → « e 5 ») bloquait une
    paire décimale légitime. La regex exige X.Y Z.W contigus : une lettre entre
    les deux nombres casse déjà le match ; la concurrence avec les détecteurs
    cardinaux est gérée par la confiance (0.80 < 0.95) et la dédup par span de
    detect_all_gps_coordinates.
    """
    for match in _DETECT_DECIMAL_PAIR_REGEX.finditer(text):
        try:
            lat = float(match.group(1))
            lon = float(match.group(2))
        except (TypeError, ValueError):
            continue

        cand = _decimal_candidate(match.span(), lat, lon,
                                  'N' if lat >= 0 else 'S',
                                  'E' if lon >= 0 else 'W')
        if cand:
            yield cand


def _detect_decimal_pair(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « paire décimale » valide (compat : façade de l'itérateur)."""
    return next(_iter_decimal_pair(text), None)


# ------------------------------------------------------------------------------
# Détection avec direction en SUFFIXE (ex: "48° 51.234' N 2° 17.567' E")
# ------------------------------------------------------------------------------

# DDM avec direction cardinale en suffixe (listings internationaux).
_DETECT_DMM_SUFFIX_REGEX = re.compile(
    r'(\d{1,2})\s*[°º]?\s*(\d{1,2}(?:[.,]\d+)?)\s*[\'′]?\s*([NS])'
    r'[\s,;/:-]+'
    r'(\d{1,3})\s*[°º]?\s*(\d{1,2}(?:[.,]\d+)?)\s*[\'′]?\s*([EW])'
)


def _iter_dmm_suffix_direction(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les DDM où la direction cardinale suit la valeur, par exemple :
      - "48° 51.234' N 2° 17.567' E"
      - "48 51.234 N, 2 17.567 E"
    Fréquent sur les listings internationaux.
    """
    for match in _DETECT_DMM_SUFFIX_REGEX.finditer(text):
        lat_deg, lat_min, lat_dir, lon_deg, lon_min, lon_dir = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, lat_min,
                              lon_dir, lon_deg, lon_min)
        if cand:
            yield cand


def _detect_dmm_suffix_direction(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM suffixe » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_suffix_direction(text), None)


# DMS avec direction cardinale en suffixe (converti en DDM comme
# _detect_dms_coordinates).
_DETECT_DMS_SUFFIX_REGEX = re.compile(
    r'(\d{1,2})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:[.,]\d+)?)\s*["″]?\s*([NS])'
    r'[\s,]+'
    r'(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[\']\s*(\d{1,2}(?:[.,]\d+)?)\s*["″]?\s*([EW])'
)


def _iter_dms_suffix_direction(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les DMS (degrés/minutes/secondes) avec direction en suffixe :
      - "48°51'24.1\" N 2°17'26\" E"
    Convertit les secondes en minutes décimales (comme _iter_dms_coordinates).
    """
    for match in _DETECT_DMS_SUFFIX_REGEX.finditer(text):
        lat_deg, lat_min, lat_sec, lat_dir, lon_deg, lon_min, lon_sec, lon_dir = match.groups()
        try:
            lat_min_dec = int(lat_min) + float(lat_sec.replace(',', '.')) / 60.0
            lon_min_dec = int(lon_min) + float(lon_sec.replace(',', '.')) / 60.0
        except (TypeError, ValueError):
            continue

        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, lat_min_dec,
                              lon_dir, lon_deg, lon_min_dec)
        if cand:
            yield cand


def _detect_dms_suffix_direction(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DMS suffixe » valide (compat : façade de l'itérateur)."""
    return next(_iter_dms_suffix_direction(text), None)


# ------------------------------------------------------------------------------
# Détection des degrés décimaux avec lettres cardinales
# (ex: "N 48.8566° E 2.3522°", "48.8566°N 2.3522°E", "N48.85660 E002.35220")
# ------------------------------------------------------------------------------

# Valeur en degrés décimaux : 3 à 8 décimales (comme la paire décimale).
_DDEG_VALUE = r'(-?\d{1,3}\.\d{3,8})'

_DETECT_DDEG_PREFIX_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])\s*' + _DDEG_VALUE + r'\s*[°º]?\s*[,;]?\s*'
    r'([EW])\s*' + _DDEG_VALUE + r'\s*[°º]?',
    re.IGNORECASE,
)
_DETECT_DDEG_SUFFIX_REGEX = re.compile(
    _DDEG_VALUE + r'\s*[°º]?\s*([NS])[\s,]+'
    + _DDEG_VALUE + r'\s*[°º]?\s*([EW])',
    re.IGNORECASE,
)


def _iter_ddeg_cardinal(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les coordonnées en degrés décimaux avec lettres cardinales :
      - préfixe : "N 48.8566° E 2.3522°", "N48.85660 E002.35220"
      - suffixe : "48.8566°N 2.3522°E", "33.8688° S, 151.2093° E"
    L'hémisphère vient de la lettre ; un signe négatif contradictoire
    (« N -48.5 ») rejette le candidat.
    """
    logger.debug("_iter_ddeg_cardinal: Analyse du texte: '%s...' (tronqué)", text[:100])
    for match in _DETECT_DDEG_PREFIX_REGEX.finditer(text):
        lat_dir, lat_str, lon_dir, lon_str = match.groups()
        yield from _ddeg_candidate(match, lat_str, lon_str, lat_dir, lon_dir)
    for match in _DETECT_DDEG_SUFFIX_REGEX.finditer(text):
        lat_str, lat_dir, lon_str, lon_dir = match.groups()
        yield from _ddeg_candidate(match, lat_str, lon_str, lat_dir, lon_dir)


def _ddeg_candidate(match, lat_str, lon_str, lat_dir, lon_dir) -> Iterator[Dict[str, Optional[str]]]:
    """Valide et formate un candidat degrés décimaux + lettres cardinales."""
    try:
        lat, lon = float(lat_str), float(lon_str)
    except (TypeError, ValueError):
        return
    lat_dir, lon_dir = lat_dir.upper(), lon_dir.upper()
    # Un signe négatif explicite doit être cohérent avec la lettre.
    if lat < 0 and lat_dir != 'S':
        return
    if lon < 0 and lon_dir != 'W':
        return
    lat = -abs(lat) if lat_dir == 'S' else abs(lat)
    lon = -abs(lon) if lon_dir == 'W' else abs(lon)

    cand = _decimal_candidate(match.span(), lat, lon, lat_dir, lon_dir)
    if cand:
        yield cand


def _detect_ddeg_cardinal(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « degrés décimaux + cardinaux » valide."""
    return next(_iter_ddeg_cardinal(text), None)


# ------------------------------------------------------------------------------
# Détection d'une paire décimale étiquetée (ex: "lat: 48.8566 lon: 2.3522")
# ------------------------------------------------------------------------------

_DETECT_LABELED_DECIMAL_REGEX = re.compile(
    r'\blat(?:itude)?\b\s*[:=]?\s*(-?\d{1,3}\.\d{3,8})\s*[,;/]?\s*'
    r'\b(?:longitude|long|lng|lon)\b\s*[:=]?\s*(-?\d{1,3}\.\d{3,8})',
    re.IGNORECASE,
)
# Même motif, ordre inverse (« lon: … lat: … ») : groupes (lon, lat).
_DETECT_LABELED_DECIMAL_REV_REGEX = re.compile(
    r'\b(?:longitude|long|lng|lon)\b\s*[:=]?\s*(-?\d{1,3}\.\d{3,8})\s*[,;/]?\s*'
    r'\blat(?:itude)?\b\s*[:=]?\s*(-?\d{1,3}\.\d{3,8})',
    re.IGNORECASE,
)


def _iter_labeled_decimal(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les paires décimales explicitement étiquetées :
      - "lat: 48.8566 lon: 2.3522"
      - "latitude 48.8566, longitude -2.3522"
    Le signe détermine l'hémisphère ; l'ordre « lon … lat » est aussi accepté.
    """
    logger.debug("_iter_labeled_decimal: Analyse du texte")
    matches = (
        (match, False) for match in _DETECT_LABELED_DECIMAL_REGEX.finditer(text)
    )
    reversed_matches = (
        (match, True) for match in _DETECT_LABELED_DECIMAL_REV_REGEX.finditer(text)
    )
    for match, is_reversed in sorted(
        (*matches, *reversed_matches), key=lambda item: item[0].start()
    ):
        try:
            lat = float(match.group(2) if is_reversed else match.group(1))
            lon = float(match.group(1) if is_reversed else match.group(2))
        except (TypeError, ValueError):
            continue
        cand = _decimal_candidate(match.span(), lat, lon,
                                  'N' if lat >= 0 else 'S',
                                  'E' if lon >= 0 else 'W')
        if cand:
            yield cand


def _detect_labeled_decimal(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « paire étiquetée » valide."""
    return next(_iter_labeled_decimal(text), None)


# ------------------------------------------------------------------------------
# Détection d'une paire décimale à virgule (ex: "48,8566 2,3522")
# ------------------------------------------------------------------------------

# Même prudence que la paire à point : 3-8 décimales exigées, et espace
# obligatoire entre les deux valeurs (« 48,8566,2,3522 » serait ambigu).
# Confiance inférieure : « 1,234 5,678 » peut aussi être des milliers.
_DETECT_DECIMAL_COMMA_REGEX = re.compile(
    r'(?<![\d,.])(-?\d{1,3},\d{3,8})[,;]?\s+(-?\d{1,3},\d{3,8})(?![\d,.])'
)


def _iter_decimal_comma(text: str) -> Iterator[Dict[str, Optional[str]]]:
    """
    Itère les paires de degrés décimaux à virgule décimale (notation française) :
      - "48,8566 2,3522"
      - "-33,8688; 151,2093"
    """
    for match in _DETECT_DECIMAL_COMMA_REGEX.finditer(text):
        try:
            lat = float(match.group(1).replace(',', '.'))
            lon = float(match.group(2).replace(',', '.'))
        except (TypeError, ValueError):
            continue

        cand = _decimal_candidate(match.span(), lat, lon,
                                  'N' if lat >= 0 else 'S',
                                  'E' if lon >= 0 else 'W')
        if cand:
            yield cand


def _detect_decimal_comma(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « paire à virgule » valide."""
    return next(_iter_decimal_comma(text), None)


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
    rf"\b({_CARDINAL_WORDS})(?=\d|\b)(?=[\s/:.,;°-]*[\dIVXLCDM])",
    re.IGNORECASE,
)
# Le séparateur entre la valeur et le mot suffixe accepte aussi le tiret
# (« 48° - sud »), symétrique au lookahead préfixe ; la structure des
# lookbehind/lookahead est inchangée (classe élargie seulement).
_CARDINAL_WORD_SUFFIX_REGEX = re.compile(
    rf"(?<=[\d'′\"″°º])([\s-]*)(?:(?<=\d)|\b)({_CARDINAL_WORDS})(?=\d|\b)",
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

# Ponctuation typographique -> ASCII, caractère pour caractère (la longueur est
# préservée, les ``span`` restent valables sur le texte d'origine). Un
# copier-coller depuis le web produit souvent des primes typographiques
# (« N 48° 51′ 24″ ») et des signes moins Unicode (« −33.8688 ») que les
# regex ne connaissent pas : sans normalisation, le DMS était lu comme des
# millièmes de minute et le signe moins ignoré (hémisphère inversé).
# NB : les tirets cadratin/demi-cadratin et le point médian ne sont PAS
# convertis — ce ne sont pas des signes moins.
_UNICODE_PUNCT_TRANSLATION = str.maketrans({
    # Primes / apostrophes typographiques -> '
    '′': "'", '’': "'", '‘': "'", 'ʼ': "'", '`': "'", '´': "'",
    # Double primes / guillemets typographiques -> "
    '″': '"', '“': '"', '”': '"', '«': '"', '»': '"',
    # Signe moins Unicode -> tiret ASCII
    '−': '-',
})


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


def detect_gps_coordinates(text: str, include_numeric_only: bool = False, origin_coords: Optional[Dict[str, str]] = None) -> Dict[str, Optional[str]]:
    """
    Recherche des coordonnées GPS dans un texte en testant plusieurs formats.

    Args:
        text (str): Le texte dans lequel rechercher des coordonnées
        include_numeric_only (bool): Si True, inclut la détection de coordonnées au format numérique pur (sans lettres cardinales ni symboles)
        origin_coords (Optional[Dict[str, str]]): Coordonnées d'origine au format DDM (optionnel)

    La détection en toutes lettres n'est PAS faite ici : elle est pilotée par
    l'endpoint via WrittenCoordinatesService (langues respectées, pas de double
    exécution).

    Le dictionnaire retourné contient :
      - 'exist': True si une coordonnée a été trouvée, sinon False.
      - 'ddm_lat': Latitude formatée en DDM.
      - 'ddm_lon': Longitude formatée en DDM.
      - 'ddm': Latitude et longitude combinées.
    """
    logger.debug(
        "detect_gps_coordinates: Début de la détection sur texte de %s caractères, "
        "extrait: '%s...' (tronqué), include_numeric_only=%s, origin_coords=%s",
        len(text), text[:100], include_numeric_only, origin_coords,
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

    # Ponctuation typographique -> ASCII (longueur préservée)
    text = text.translate(_UNICODE_PUNCT_TRANSLATION)

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

# DDM sans symbole ° : le séparateur degrés/minutes est un ou plusieurs
# espaces ; minutes avec ou sans décimales.
_DETECT_DMM_NO_DEGREE_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])\s*(\d{1,2})\s+(\d{1,2}(?:[.,]\d+)?)\s*'  # Latitude
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
        lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, lat_min,
                              lon_dir, lon_deg, lon_min)
        if cand:
            yield cand


def _detect_dmm_no_degree_symbol(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM sans ° » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_no_degree_symbol(text), None)

# ----------------------------------------------------------------------------
# Détection du format DMM sans ° ni . (ex : "N 38 32 460 W 075 43 659")
# ----------------------------------------------------------------------------

# DDM sans symbole ° ni point décimal : N/S deg min dec, E/W deg min dec,
# séparés par des espaces.
_DETECT_DMM_NO_SYMBOL_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])\s*(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})\s*'  # Latitude
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
        lat_dir, lat_deg, lat_min, lat_dec, lon_dir, lon_deg, lon_min, lon_dec = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, f"{lat_min}.{lat_dec}",
                              lon_dir, lon_deg, f"{lon_min}.{lon_dec}")
        if cand:
            yield cand


def _detect_dmm_no_symbol_no_dot(text: str) -> Optional[Dict[str, Optional[str]]]:
    """Premier candidat « DDM sans symbole » valide (compat : façade de l'itérateur)."""
    return next(_iter_dmm_no_symbol_no_dot(text), None)

# ------------------------------------------------------------------------------
# Détection du format géocaching standard (ex: "N29 02.879 W98 01.304")
# ------------------------------------------------------------------------------

# Format géocaching standard : Direction + degrés + espace + minutes.décimales
# (sans symbole ° ni apostrophe).
_DETECT_GEOCACHING_REGEX = re.compile(
    _CARDINAL_LB + r'([NS])(\d{1,2})\s+(\d{1,2}\.\d{1,3})\s+([EW])(\d{1,3})\s+(\d{1,2}\.\d{1,3})'
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
        lat_dir, lat_deg, lat_min, lon_dir, lon_deg, lon_min = match.groups()
        cand = _ddm_candidate(match.span(), lat_dir, lat_deg, lat_min,
                              lon_dir, lon_deg, lon_min)
        if cand:
            yield cand


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
    _iter_ddeg_cardinal:                 0.88,
    _iter_labeled_decimal:               0.85,
    _iter_nord_est_variations:           0.88,
    _iter_nord_est_format:               0.85,
    _iter_dmm_no_symbol_no_dot:          0.85,
    _iter_specific_tabpoint_coordinates: 0.82,
    _iter_decimal_pair:                  0.80,
    _iter_decimal_comma:                 0.75,
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

