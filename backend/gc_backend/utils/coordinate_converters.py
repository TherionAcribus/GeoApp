"""Shared coordinate conversion helpers for GeoApp plugins.

The module normalizes supported coordinate systems to WGS84 decimal latitude
and longitude, then formats that canonical point into the requested outputs.
Optional third-party dependencies are imported lazily so plugins can return a
clear error when a conversion family is unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
import re
from typing import Any, Dict, List, Optional, Tuple


SUPPORTED_FORMATS = {"dd", "ddm", "dms"}
SUPPORTED_GRID_FORMATS = {"utm", "mgrs", "osgb", "osgr", "web_mercator"}
SUPPORTED_CODE_FORMATS = {"geohash", "plus_code", "mapcode"}
SUPPORTED_SPECIAL_FORMATS = {"gars", "qth", "maidenhead", "slippy", "quadkey", "quadtree", "nac", "rd", "lambert_93", "lambert_72"}

GARS_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
NAC_ALPHABET = "0123456789BCDFGHJKLMNPQRSTUVWXYZ"


_DD_PAIR_RE = re.compile(
    r"(?<![\w.])(?P<lat>[+-]?\d{1,2}\.\d+)\s*[,;]\s*(?P<lon>[+-]?\d{1,3}\.\d+)(?![\w.])"
)
_DDM_PAIR_RE = re.compile(
    r"[NS]\s*\d{1,2}\s*(?:[°º˚'`´’′?]|deg|degrees)?\s*[0-5]?\d(?:[\.,]\d+)?"
    r".{0,8}?"
    r"[EWOL]\s*\d{1,3}\s*(?:[°º˚'`´’′?]|deg|degrees)?\s*[0-5]?\d(?:[\.,]\d+)?",
    re.IGNORECASE,
)
_DMS_PAIR_RE = re.compile(
    r"[NS]\s*\d{1,2}\s*(?:[°º˚?]|deg|degrees)?\s*[0-5]?\d(?:\s*(?:['’′m]|min|minutes)\s*|\s+)"
    r"[0-5]?\d(?:[\.,]\d+)?\s*(?:[\"”″s]|sec|seconds)?"
    r".{0,8}?"
    r"[EWOL]\s*\d{1,3}\s*(?:[°º˚?]|deg|degrees)?\s*[0-5]?\d(?:\s*(?:['’′m]|min|minutes)\s*|\s+)"
    r"[0-5]?\d(?:[\.,]\d+)?\s*(?:[\"”″s]|sec|seconds)?",
    re.IGNORECASE,
)
_PLUS_CODE_RE = re.compile(r"\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}\b", re.IGNORECASE)
_MGRS_COMPACT_RE = re.compile(r"\b\d{1,2}[C-HJ-NP-X][A-Z]{2}\d{2,}\b", re.IGNORECASE)
_MGRS_SPACED_RE = re.compile(r"\b\d{1,2}[C-HJ-NP-X]\s+[A-Z]{2}\s+\d{2,10}\b", re.IGNORECASE)
_UTM_RE = re.compile(r"\b\d{1,2}\s*[C-HJ-NP-X]?\s+\d{3,7}(?:\.\d+)?\s+\d{3,7}(?:\.\d+)?\b", re.IGNORECASE)
_OSGB_RE = re.compile(r"\b[A-Z]{2}\s*\d{4,10}\b", re.IGNORECASE)
_MAPCODE_RE = re.compile(r"\b[A-Z]{3}\s+[A-Z0-9]{2,}\.[A-Z0-9]{2,}\b", re.IGNORECASE)
_GEOHASH_RE = re.compile(r"\b[0123456789bcdefghjkmnpqrstuvwxyz]{5,12}\b")
_GEOHASH_UPPER_RE = re.compile(r"\b(?=[0123456789BCDEFGHJKMNPQRSTUVWXYZ]*\d)[0123456789BCDEFGHJKMNPQRSTUVWXYZ]{5,12}\b")
_GARS_RE = re.compile(r"\b\d{3}[A-HJ-NP-Z]{2}[1-4]?[1-9]?\b", re.IGNORECASE)
_QTH_RE = re.compile(r"\b[A-R]{2}\d{2}([A-X]{2})?\b", re.IGNORECASE)
_SLIPPY_RE = re.compile(r"\b\d{1,2}/\d{1,10}/\d{1,10}\b")
_NAC_RE = re.compile(rf"\b[{NAC_ALPHABET}]{{6,12}}\s+[{NAC_ALPHABET}]{{6,12}}\b", re.IGNORECASE)


class CoordinateConversionError(ValueError):
    """Raised when an input cannot be parsed or converted."""


class MissingCoordinateDependencyError(CoordinateConversionError):
    """Raised when an optional conversion dependency is not installed."""

    def __init__(self, package: str, feature: str):
        super().__init__(f"Dépendance manquante pour {feature}: installez le paquet '{package}'.")
        self.package = package
        self.feature = feature


@dataclass
class CanonicalCoordinate:
    """WGS84 decimal coordinate plus conversion metadata."""

    latitude: float
    longitude: float
    source_format: str
    raw: str = ""
    formatted: str = ""
    precision: Optional[Any] = None
    bbox: Optional[Dict[str, float]] = None
    area: Optional[Dict[str, float]] = None
    warnings: List[str] = field(default_factory=list)

    def to_coordinates_dict(self) -> Dict[str, Any]:
        ddm = format_ddm(self.latitude, self.longitude)
        return {
            "exist": True,
            "ddm": ddm,
            "ddm_lat": format_ddm_component(self.latitude, True),
            "ddm_lon": format_ddm_component(self.longitude, False),
            "decimal": {"lat": self.latitude, "lon": self.longitude},
            "decimal_latitude": self.latitude,
            "decimal_longitude": self.longitude,
            "raw": [self.raw] if self.raw else [],
            "source_format": self.source_format,
            "formatted": ddm,
            "source_formatted": self.formatted or "",
            "confidence": 0.95,
        }


def _require_pygeodesy(module_name: str, feature: str):
    try:
        return __import__(f"pygeodesy.{module_name}", fromlist=[module_name])
    except Exception as exc:  # pragma: no cover - exercised when dependency absent
        raise MissingCoordinateDependencyError("pygeodesy", feature) from exc


def _require_openlocationcode():
    try:
        from openlocationcode import openlocationcode as olc
        return olc
    except Exception as exc:  # pragma: no cover
        raise MissingCoordinateDependencyError("openlocationcode", "Plus Codes") from exc


def _require_mapcode():
    try:
        import mapcode
        return mapcode
    except Exception as exc:  # pragma: no cover
        raise MissingCoordinateDependencyError("mapcode", "Mapcode") from exc


def _require_pyproj(feature: str):
    try:
        from pyproj import Transformer
        return Transformer
    except Exception as exc:  # pragma: no cover
        raise MissingCoordinateDependencyError("pyproj", feature) from exc


def _validate_lat_lon(latitude: float, longitude: float) -> Tuple[float, float]:
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise CoordinateConversionError("Coordonnées non finies")
    if not -90 <= latitude <= 90:
        raise CoordinateConversionError(f"Latitude hors limites: {latitude}")
    if not -180 <= longitude <= 180:
        raise CoordinateConversionError(f"Longitude hors limites: {longitude}")
    return round(latitude, 8), round(longitude, 8)


def normalize_format(fmt: str) -> str:
    value = (fmt or "auto").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "decimal": "dd",
        "degrees": "dd",
        "degree": "dd",
        "dmm": "ddm",
        "degrees_decimal_minutes": "ddm",
        "degrees_minutes_seconds": "dms",
        "osgb36": "osgb",
        "osgr": "osgb",
        "british_grid": "osgb",
        "mercator": "web_mercator",
        "webmercator": "web_mercator",
        "epsg_3857": "web_mercator",
        "plus": "plus_code",
        "pluscode": "plus_code",
        "olc": "plus_code",
        "open_location_code": "plus_code",
        "geocaching": "ddm",
        "gc": "ddm",
        "maidenhead": "qth",
        "locator": "qth",
        "quadtree": "quadkey",
        "quad_key": "quadkey",
        "slippy_map": "slippy",
        "tile": "slippy",
        "tiles": "slippy",
        "dutchgrid": "rd",
        "rijksdriehoek": "rd",
        "rd_new": "rd",
        "lambert93": "lambert_93",
        "lambert_93": "lambert_93",
        "lambert72": "lambert_72",
        "lambert_72": "lambert_72",
    }
    return aliases.get(value, value)


def parse_coordinate(
    input_text: str,
    source_format: str = "auto",
    reference_latitude: Optional[float] = None,
    reference_longitude: Optional[float] = None,
) -> CanonicalCoordinate:
    """Parse a coordinate in any supported V1 format."""

    text = str(input_text or "").strip()
    if not text:
        raise CoordinateConversionError("Aucune coordonnée fournie")

    fmt = normalize_format(source_format)
    formats = _candidate_formats(text) if fmt == "auto" else [fmt]
    errors: List[str] = []

    for candidate in formats:
        try:
            if candidate in SUPPORTED_FORMATS:
                return parse_latlon_text(text, candidate)
            if candidate in {"utm", "mgrs", "osgb", "web_mercator"}:
                return parse_grid_text(text, candidate)
            if candidate in SUPPORTED_CODE_FORMATS:
                return parse_code_text(text, candidate, reference_latitude, reference_longitude)
            if candidate in SUPPORTED_SPECIAL_FORMATS:
                return parse_special_text(text, candidate)
        except CoordinateConversionError as exc:
            errors.append(f"{candidate}: {exc}")
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")

    detail = "; ".join(errors[:4])
    raise CoordinateConversionError(f"Format de coordonnée non reconnu{': ' + detail if detail else ''}")


def find_coordinate_candidates(text: str, max_results: int = 20) -> List[CanonicalCoordinate]:
    """Extract multiple supported coordinate candidates from free text.

    This intentionally favors explicit coordinate signatures over loose numeric
    parsing to avoid treating puzzle numbers as coordinates.
    """

    source = str(text or "")
    candidates: List[CanonicalCoordinate] = []
    seen: set[Tuple[str, float, float, str]] = set()

    def add(raw: str, fmt: str) -> None:
        if len(candidates) >= max_results:
            return
        try:
            coord = parse_coordinate(raw, fmt)
        except CoordinateConversionError:
            return
        except Exception:
            return
        key = (
            coord.source_format,
            round(coord.latitude, 5),
            round(coord.longitude, 5),
            re.sub(r"\s+", "", raw).upper(),
        )
        if key in seen:
            return
        seen.add(key)
        candidates.append(coord)

    extractors = [
        ("dms", _DMS_PAIR_RE),
        ("ddm", _DDM_PAIR_RE),
        ("dd", _DD_PAIR_RE),
        ("plus_code", _PLUS_CODE_RE),
        ("mgrs", _MGRS_COMPACT_RE),
        ("mgrs", _MGRS_SPACED_RE),
        ("utm", _UTM_RE),
        ("osgb", _OSGB_RE),
        ("mapcode", _MAPCODE_RE),
        ("gars", _GARS_RE),
        ("qth", _QTH_RE),
        ("slippy", _SLIPPY_RE),
        ("nac", _NAC_RE),
        ("geohash", _GEOHASH_RE),
        ("geohash", _GEOHASH_UPPER_RE),
    ]

    for fmt, pattern in extractors:
        for match in pattern.finditer(source):
            add(match.group(0), fmt)
            if len(candidates) >= max_results:
                break
        if len(candidates) >= max_results:
            break

    if not candidates:
        try:
            candidates.append(parse_coordinate(source, "auto"))
        except Exception:
            pass

    return candidates


def _candidate_formats(text: str) -> List[str]:
    upper = text.strip().upper()
    compact = upper.replace(" ", "")
    candidates: List[str] = []
    if "+" in upper and re.search(r"[23456789CFGHJMPQRVWX]{2,}\+", upper):
        candidates.append("plus_code")
    if re.fullmatch(r"\d{1,2}[C-HJ-NP-X][A-Z]{2}\d{2,}", compact):
        candidates.append("mgrs")
    if re.search(r"\b\d{1,2}\s*[C-HJ-NP-X]?\s+\d{3,7}(?:\.\d+)?\s+\d{3,7}(?:\.\d+)?\b", upper):
        candidates.append("utm")
    if re.search(r"\b[A-Z]{2}\s*\d{2,10}\b", upper):
        candidates.append("osgb")
    if re.search(r"\b[A-Z]{3}\s+[A-Z0-9]+\.[A-Z0-9]+\b", upper) or re.fullmatch(r"[A-Z0-9]+\.[A-Z0-9]+", upper):
        candidates.append("mapcode")
    if re.fullmatch(r"\d{3}[A-HJ-NP-Z]{2}[1-4]?[1-9]?", upper):
        candidates.append("gars")
    if re.fullmatch(r"[A-R]{2}\d{2}([A-X]{2})?", upper):
        candidates.append("qth")
    if re.fullmatch(r"\d{1,2}[/,;:\s]+\d+[/,;:\s]+\d+", upper):
        candidates.append("slippy")
    if re.fullmatch(rf"[{NAC_ALPHABET}\s]{{8,25}}", upper) and any(char in upper for char in "BCDFGHJKLMNPQRSTUVWXYZ"):
        candidates.append("nac")
    if re.fullmatch(r"[0123456789BCDEFGHJKMNPQRSTUVWXYZ]{5,12}", upper):
        candidates.append("geohash")
    if re.search(r"[NS].*[EW]|[EW].*[NS]", upper):
        candidates.extend(["ddm", "dms"])
    candidates.extend(["dd", "ddm", "dms", "web_mercator"])
    return list(dict.fromkeys(candidates))


def parse_latlon_text(input_text: str, source_format: str = "auto") -> CanonicalCoordinate:
    fmt = normalize_format(source_format)
    if fmt == "auto":
        for candidate in ("ddm", "dms", "dd"):
            try:
                return parse_latlon_text(input_text, candidate)
            except CoordinateConversionError:
                continue
        raise CoordinateConversionError("Format DD/DDM/DMS non reconnu")
    if fmt == "dd":
        lat, lon = _parse_dd(input_text)
    elif fmt == "ddm":
        lat, lon = _parse_ddm(input_text)
    elif fmt == "dms":
        lat, lon = _parse_dms(input_text)
    else:
        raise CoordinateConversionError(f"Format géographique non supporté: {source_format}")
    lat, lon = _validate_lat_lon(lat, lon)
    return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=format_ddm(lat, lon))


def _parse_dd(text: str) -> Tuple[float, float]:
    normalized = text.replace(",", " ")
    signed = re.findall(r"[-+]?\d+(?:\.\d+)?", normalized)
    if len(signed) < 2:
        raise CoordinateConversionError("Deux valeurs décimales sont requises")
    lat = float(signed[0])
    lon = float(signed[1])
    upper = text.upper()
    if re.search(r"\bS\b", upper):
        lat = -abs(lat)
    if re.search(r"\bW\b|OUEST|\bO\b", upper):
        lon = -abs(lon)
    return lat, lon


def _parse_ddm(text: str) -> Tuple[float, float]:
    pattern = re.compile(
        r"(?P<dir>[NSWEOL])\s*(?P<deg>\d{1,3})\s*(?:[°º˚'`´’′?]|deg|degrees)?\s*"
        r"(?P<min>[0-5]?\d(?:[\.,]\d+)?)",
        re.IGNORECASE,
    )
    components = []
    for match in pattern.finditer(text):
        direction = _normalize_direction(match.group("dir"))
        degrees = int(match.group("deg"))
        minutes = float(match.group("min").replace(",", "."))
        components.append((direction, degrees, minutes))
    lat_item = next((c for c in components if c[0] in {"N", "S"}), None)
    lon_item = next((c for c in components if c[0] in {"E", "W"}), None)
    if not lat_item or not lon_item:
        raise CoordinateConversionError("Composantes DDM latitude/longitude introuvables")
    return _ddm_component_to_decimal(*lat_item), _ddm_component_to_decimal(*lon_item)


def _parse_dms(text: str) -> Tuple[float, float]:
    pattern = re.compile(
        r"(?P<dir>[NSWEOL])\s*(?P<deg>\d{1,3})\s*(?:[°º˚?]|deg|degrees)?\s*"
        r"(?P<min>[0-5]?\d)(?:\s*(?:['’′m]|min|minutes)\s*|\s+)"
        r"(?P<sec>[0-5]?\d(?:[\.,]\d+)?)\s*(?:[\"”″s]|sec|seconds)?",
        re.IGNORECASE,
    )
    components = []
    for match in pattern.finditer(text):
        direction = _normalize_direction(match.group("dir"))
        degrees = int(match.group("deg"))
        minutes = int(match.group("min"))
        seconds = float(match.group("sec").replace(",", "."))
        value = degrees + minutes / 60.0 + seconds / 3600.0
        if direction in {"S", "W"}:
            value = -value
        components.append((direction, value))
    lat_item = next((value for direction, value in components if direction in {"N", "S"}), None)
    lon_item = next((value for direction, value in components if direction in {"E", "W"}), None)
    if lat_item is None or lon_item is None:
        raise CoordinateConversionError("Composantes DMS latitude/longitude introuvables")
    return lat_item, lon_item


def _normalize_direction(value: str) -> str:
    direction = value.upper()
    if direction in {"O", "L"}:
        return "W" if direction == "O" else "E"
    return direction


def _ddm_component_to_decimal(direction: str, degrees: int, minutes: float) -> float:
    if minutes < 0 or minutes >= 60:
        raise CoordinateConversionError(f"Minutes hors limites: {minutes}")
    if direction in {"N", "S"} and not 0 <= degrees <= 90:
        raise CoordinateConversionError(f"Latitude hors limites: {degrees}")
    if direction in {"E", "W"} and not 0 <= degrees <= 180:
        raise CoordinateConversionError(f"Longitude hors limites: {degrees}")
    value = degrees + minutes / 60.0
    return -value if direction in {"S", "W"} else value


def parse_grid_text(input_text: str, source_format: str) -> CanonicalCoordinate:
    fmt = normalize_format(source_format)
    text = input_text.strip()
    if fmt == "utm":
        utm = _require_pygeodesy("utm", "UTM")
        parsed = utm.parseUTM5(text)
        latlon = parsed.toLatLon()
        lat, lon = float(latlon[0]), float(latlon[1])
    elif fmt == "mgrs":
        mgrs = _require_pygeodesy("mgrs", "MGRS")
        parsed = mgrs.parseMGRS(_normalize_mgrs_text(text))
        latlon = parsed.toUtm().toLatLon()
        lat, lon = float(latlon[0]), float(latlon[1])
    elif fmt == "osgb":
        osgr = _require_pygeodesy("osgr", "OSGB/OSGR")
        parsed = osgr.parseOSGR(text)
        latlon = parsed.toLatLon()
        lat, lon = float(latlon[0]), float(latlon[1])
    elif fmt == "web_mercator":
        wm = _require_pygeodesy("webmercator", "Web Mercator")
        parsed = wm.parseWM(text)
        latlon = parsed.toLatLon()
        lat, lon = float(latlon[0]), float(latlon[1])
    else:
        raise CoordinateConversionError(f"Format grille non supporté: {source_format}")
    lat, lon = _validate_lat_lon(lat, lon)
    return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=format_ddm(lat, lon))


def _normalize_mgrs_text(text: str) -> str:
    value = re.sub(r"\s+", "", text).upper()
    match = re.fullmatch(r"(?P<zone>\d{1,2})(?P<band>[C-HJ-NP-X])(?P<grid>[A-Z]{2})(?P<digits>\d+)", value)
    if not match:
        return value

    digits = match.group("digits")
    if len(digits) > 10 and len(digits) % 2 == 0:
        half = len(digits) // 2
        digits = digits[:half][:5] + digits[half:][:5]

    return f"{match.group('zone')}{match.group('band')}{match.group('grid')}{digits}"


def parse_code_text(
    input_text: str,
    source_format: str,
    reference_latitude: Optional[float] = None,
    reference_longitude: Optional[float] = None,
) -> CanonicalCoordinate:
    fmt = normalize_format(source_format)
    text = input_text.strip()
    if fmt == "geohash":
        geohash = _require_pygeodesy("geohash", "Geohash")
        lat, lon = geohash.decode2(text)
        south, west, north, east = geohash.bounds(text)
        bbox = {"south": float(south), "west": float(west), "north": float(north), "east": float(east)}
        lat, lon = _validate_lat_lon(float(lat), float(lon))
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text, precision=len(text), bbox=bbox)
    if fmt == "plus_code":
        olc = _require_openlocationcode()
        code = text.replace(" ", "").upper()
        if olc.isShort(code):
            if reference_latitude is None or reference_longitude is None:
                raise CoordinateConversionError("Un Plus Code court requiert latitude/longitude de référence")
            code = olc.recoverNearest(code, float(reference_latitude), float(reference_longitude))
        if not olc.isValid(code):
            raise CoordinateConversionError("Plus Code invalide")
        area = olc.decode(code)
        bbox = {
            "south": area.latitudeLo,
            "west": area.longitudeLo,
            "north": area.latitudeHi,
            "east": area.longitudeHi,
        }
        lat, lon = _validate_lat_lon(area.latitudeCenter, area.longitudeCenter)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=code, precision=area.codeLength, bbox=bbox)
    if fmt == "mapcode":
        mapcode = _require_mapcode()
        lat, lon = mapcode.decode(text)
        if not math.isfinite(lat) or not math.isfinite(lon):
            parts = text.split(maxsplit=1)
            if len(parts) == 2:
                lat, lon = mapcode.decode(parts[1], parts[0])
        lat, lon = _validate_lat_lon(float(lat), float(lon))
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    raise CoordinateConversionError(f"Format code non supporté: {source_format}")


def parse_special_text(input_text: str, source_format: str) -> CanonicalCoordinate:
    fmt = normalize_format(source_format)
    text = input_text.strip()
    if fmt == "gars":
        lat, lon, bbox = decode_gars(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper(), bbox=bbox)
    if fmt == "qth":
        lat, lon, bbox = decode_qth(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper(), bbox=bbox)
    if fmt == "slippy":
        lat, lon, metadata = decode_slippy(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text, precision=metadata)
    if fmt == "quadkey":
        lat, lon, metadata = decode_quadkey(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text, precision=metadata)
    if fmt == "nac":
        lat, lon, bbox = decode_nac(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper(), bbox=bbox)
    if fmt == "rd":
        lat, lon = _transform_xy_to_wgs84(text, "EPSG:28992", "RD/NAP")
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "lambert_93":
        lat, lon = _transform_xy_to_wgs84(text, "EPSG:2154", "Lambert 93")
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "lambert_72":
        lat, lon = _transform_xy_to_wgs84(text, "EPSG:31370", "Belgian Lambert 72")
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    raise CoordinateConversionError(f"Format confidentiel non supporté: {source_format}")


def encode_gars(latitude: float, longitude: float, precision: int = 7) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    lon = min(max(lon, -180.0), 179.999999999)
    lat = min(max(lat, -90.0), 89.999999999)

    lon_index = int((lon + 180.0) * 2.0) + 1
    lat_index = int((lat + 90.0) * 2.0)
    letters = GARS_LETTERS[lat_index // 24] + GARS_LETTERS[lat_index % 24]
    code = f"{lon_index:03d}{letters}"

    if precision < 6:
        return code

    lon_in = (lon + 180.0) * 2.0 - (lon_index - 1)
    lat_in = (lat + 90.0) * 2.0 - lat_index
    east = lon_in >= 0.5
    north = lat_in >= 0.5
    quadrant = 1 if (north and not east) else 2 if (north and east) else 3 if (not north and not east) else 4
    code += str(quadrant)

    if precision < 7:
        return code

    lon_q = (lon_in % 0.5) * 2.0
    lat_q = (lat_in % 0.5) * 2.0
    col = min(2, int(lon_q * 3.0))
    row = min(2, int(lat_q * 3.0))
    keypad = (2 - row) * 3 + col + 1
    return code + str(keypad)


def decode_gars(code: str) -> Tuple[float, float, Dict[str, float]]:
    text = re.sub(r"\s+", "", code).upper()
    match = re.fullmatch(r"(?P<lon>\d{3})(?P<lat>[A-HJ-NP-Z]{2})(?P<quad>[1-4])?(?P<key>[1-9])?", text)
    if not match:
        raise CoordinateConversionError("Code GARS invalide")

    lon_index = int(match.group("lon"))
    if not 1 <= lon_index <= 720:
        raise CoordinateConversionError("Colonne GARS hors limites")
    first = GARS_LETTERS.index(match.group("lat")[0])
    second = GARS_LETTERS.index(match.group("lat")[1])
    lat_index = first * 24 + second
    if not 0 <= lat_index <= 359:
        raise CoordinateConversionError("Bande GARS hors limites")

    west = -180.0 + (lon_index - 1) * 0.5
    south = -90.0 + lat_index * 0.5
    width = height = 0.5

    quadrant = match.group("quad")
    if quadrant:
        width = height = 0.25
        if quadrant in {"2", "4"}:
            west += 0.25
        if quadrant in {"1", "2"}:
            south += 0.25

    key = match.group("key")
    if key:
        col = (int(key) - 1) % 3
        row_from_north = (int(key) - 1) // 3
        width = height = 1.0 / 12.0
        west += col * width
        south += (2 - row_from_north) * height

    bbox = {"south": south, "west": west, "north": south + height, "east": west + width}
    return (bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0, bbox


def encode_qth(latitude: float, longitude: float, precision: int = 6) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    lon += 180.0
    lat += 90.0
    precision = 4 if precision <= 4 else 6
    a = ord("A")
    code = chr(a + int(lon // 20)) + chr(a + int(lat // 10))
    lon %= 20
    lat %= 10
    code += str(int(lon // 2)) + str(int(lat // 1))
    if precision >= 6:
        lon %= 2
        lat %= 1
        code += chr(a + int(lon / (2 / 24))) + chr(a + int(lat / (1 / 24)))
    return code


def decode_qth(locator: str) -> Tuple[float, float, Dict[str, float]]:
    text = re.sub(r"\s+", "", locator).upper()
    if not re.fullmatch(r"[A-R]{2}\d{2}([A-X]{2})?", text):
        raise CoordinateConversionError("Locator QTH/Maidenhead invalide")
    west = (ord(text[0]) - ord("A")) * 20.0 - 180.0
    south = (ord(text[1]) - ord("A")) * 10.0 - 90.0
    width = 20.0
    height = 10.0
    if len(text) >= 4:
        west += int(text[2]) * 2.0
        south += int(text[3]) * 1.0
        width = 2.0
        height = 1.0
    if len(text) >= 6:
        west += (ord(text[4]) - ord("A")) * (2.0 / 24.0)
        south += (ord(text[5]) - ord("A")) * (1.0 / 24.0)
        width = 2.0 / 24.0
        height = 1.0 / 24.0
    bbox = {"south": south, "west": west, "north": south + height, "east": west + width}
    return (bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0, bbox


def encode_slippy(latitude: float, longitude: float, zoom: int = 15) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    zoom = max(0, min(30, int(zoom)))
    lat_rad = math.radians(max(min(lat, 85.05112878), -85.05112878))
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    x = min(max(x, 0), n - 1)
    y = min(max(y, 0), n - 1)
    return f"{zoom}/{x}/{y}"


def decode_slippy(tile: str) -> Tuple[float, float, Dict[str, int]]:
    values = [int(part) for part in re.findall(r"\d+", tile)]
    if len(values) != 3:
        raise CoordinateConversionError("Tuile Slippy invalide, format attendu z/x/y")
    z, x, y = values
    lat, lon = _tile_center_to_latlon(z, x, y)
    return lat, lon, {"zoom": z, "x": x, "y": y}


def encode_quadkey(latitude: float, longitude: float, zoom: int = 15) -> str:
    z, x, y = [int(part) for part in encode_slippy(latitude, longitude, zoom).split("/")]
    quadkey = ""
    for level in range(z, 0, -1):
        digit = 0
        mask = 1 << (level - 1)
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        quadkey += str(digit)
    return quadkey


def decode_quadkey(quadkey: str) -> Tuple[float, float, Dict[str, int]]:
    text = quadkey.strip()
    if not re.fullmatch(r"[0-3]+", text):
        raise CoordinateConversionError("Quadkey invalide")
    x = y = 0
    z = len(text)
    for index, char in enumerate(text):
        mask = 1 << (z - index - 1)
        digit = int(char)
        if digit & 1:
            x |= mask
        if digit & 2:
            y |= mask
    lat, lon = _tile_center_to_latlon(z, x, y)
    return lat, lon, {"zoom": z, "x": x, "y": y}


def _tile_center_to_latlon(z: int, x: int, y: int) -> Tuple[float, float]:
    if z < 0:
        raise CoordinateConversionError("Zoom hors limites")
    n = 2 ** z
    if not 0 <= x < n or not 0 <= y < n:
        raise CoordinateConversionError("Coordonnées de tuile hors limites")
    lon = (x + 0.5) / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * (y + 0.5) / n)))
    return _validate_lat_lon(math.degrees(lat_rad), lon)


def encode_nac(latitude: float, longitude: float, precision: int = 10) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    precision = max(1, min(12, int(precision)))
    return f"{_nac_axis_encode(lon + 180.0, 360.0, precision)} {_nac_axis_encode(lat + 90.0, 180.0, precision)}"


def decode_nac(code: str) -> Tuple[float, float, Dict[str, float]]:
    parts = re.findall(rf"[{NAC_ALPHABET}]{{2,}}", code.upper())
    if len(parts) < 2:
        compact = re.sub(r"\s+", "", code.upper())
        if len(compact) % 2 == 0 and len(compact) >= 4:
            parts = [compact[: len(compact) // 2], compact[len(compact) // 2 :]]
    if len(parts) < 2:
        raise CoordinateConversionError("NAC invalide")
    west, lon_width = _nac_axis_decode(parts[0], 360.0, -180.0)
    south, lat_height = _nac_axis_decode(parts[1], 180.0, -90.0)
    bbox = {"south": south, "west": west, "north": south + lat_height, "east": west + lon_width}
    return (bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0, bbox


def _nac_axis_encode(value: float, span: float, precision: int) -> str:
    out = ""
    current = min(max(value, 0.0), span - 1e-15)
    width = span
    for _ in range(precision):
        width /= 30.0
        index = int(current / width)
        index = min(max(index, 0), 29)
        out += NAC_ALPHABET[index]
        current -= index * width
    return out


def _nac_axis_decode(text: str, span: float, offset: float) -> Tuple[float, float]:
    width = span
    value = 0.0
    for char in text:
        if char not in NAC_ALPHABET:
            raise CoordinateConversionError("Caractère NAC invalide")
        width /= 30.0
        value += NAC_ALPHABET.index(char) * width
    return offset + value, width


def _transform_xy_to_wgs84(text: str, source_crs: str, feature: str) -> Tuple[float, float]:
    values = [float(value.replace(",", ".")) for value in re.findall(r"[-+]?\d+(?:[\.,]\d+)?", text)]
    if len(values) < 2:
        raise CoordinateConversionError(f"{feature}: deux coordonnées X/Y sont requises")
    transformer = _require_pyproj(feature).from_crs(source_crs, "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(values[0], values[1])
    return _validate_lat_lon(float(lat), float(lon))


def _transform_wgs84_to_xy(latitude: float, longitude: float, target_crs: str, feature: str) -> str:
    transformer = _require_pyproj(feature).from_crs("EPSG:4326", target_crs, always_xy=True)
    x, y = transformer.transform(longitude, latitude)
    return f"{x:.3f}, {y:.3f}"


def format_ddm_component(value: float, is_latitude: bool, precision: int = 3) -> str:
    hemisphere = ("N" if value >= 0 else "S") if is_latitude else ("E" if value >= 0 else "W")
    absolute = abs(value)
    degrees = int(absolute)
    minutes = (absolute - degrees) * 60.0
    degree_width = 2 if is_latitude else 3
    minute_width = 3 + precision
    return f"{hemisphere} {degrees:0{degree_width}d}° {minutes:0{minute_width}.{precision}f}"


def format_ddm(latitude: float, longitude: float, precision: int = 3) -> str:
    return f"{format_ddm_component(latitude, True, precision)} {format_ddm_component(longitude, False, precision)}"


def format_dms_component(value: float, is_latitude: bool, precision: int = 2) -> str:
    hemisphere = ("N" if value >= 0 else "S") if is_latitude else ("E" if value >= 0 else "W")
    absolute = abs(value)
    degrees = int(absolute)
    minutes_float = (absolute - degrees) * 60.0
    minutes = int(minutes_float)
    seconds = (minutes_float - minutes) * 60.0
    degree_width = 2 if is_latitude else 3
    return f"{hemisphere} {degrees:0{degree_width}d}° {minutes:02d}' {seconds:0{3 + precision}.{precision}f}\""


def format_dms(latitude: float, longitude: float, precision: int = 2) -> str:
    return f"{format_dms_component(latitude, True, precision)} {format_dms_component(longitude, False, precision)}"


def format_dd(latitude: float, longitude: float, precision: int = 6) -> str:
    return f"{latitude:.{precision}f}, {longitude:.{precision}f}"


def build_latlon_formats(latitude: float, longitude: float, precision: int = 6) -> Dict[str, str]:
    ddm_precision = 3 if precision > 3 else max(0, precision)
    dms_precision = 2 if precision > 2 else max(0, precision)
    return {
        "dd": format_dd(latitude, longitude, precision),
        "ddm": format_ddm(latitude, longitude, ddm_precision),
        "dms": format_dms(latitude, longitude, dms_precision),
    }


def build_grid_formats(latitude: float, longitude: float) -> Dict[str, str]:
    formats: Dict[str, str] = {}
    utm = _require_pygeodesy("utm", "UTM")
    mgrs = _require_pygeodesy("mgrs", "MGRS")
    osgr = _require_pygeodesy("osgr", "OSGB/OSGR")
    webmercator = _require_pygeodesy("webmercator", "Web Mercator")

    utm_value = utm.toUtm8(latitude, longitude)
    formats["utm"] = utm_value.toStr(prec=3)
    formats["mgrs"] = mgrs.toMgrs(utm_value).toStr()
    formats["web_mercator"] = webmercator.toWm(latitude, longitude).toStr(prec=3)
    try:
        formats["osgb"] = osgr.toOsgr(latitude, longitude).toStr(prec=5)
    except Exception:
        # OSGR is meaningful around Great Britain only.
        formats["osgb"] = ""
    return formats


def build_code_formats(
    latitude: float,
    longitude: float,
    geohash_precision: int = 9,
    plus_code_length: int = 10,
    mapcode_territory: Optional[str] = None,
) -> Dict[str, Any]:
    formats: Dict[str, Any] = {}
    geohash = _require_pygeodesy("geohash", "Geohash")
    olc = _require_openlocationcode()
    mapcode = _require_mapcode()

    formats["geohash"] = geohash.encode(latitude, longitude, precision=geohash_precision)
    formats["plus_code"] = olc.encode(latitude, longitude, plus_code_length)
    mapcodes = mapcode.encode(latitude, longitude, mapcode_territory) if mapcode_territory else mapcode.encode(latitude, longitude)
    formats["mapcode"] = [
        {"code": code, "territory": territory, "formatted": f"{territory} {code}"}
        for code, territory in mapcodes
    ]
    return formats


def build_special_formats(latitude: float, longitude: float, precision: int = 10, zoom: int = 15) -> Dict[str, Any]:
    return {
        "gars": encode_gars(latitude, longitude, 7),
        "qth": encode_qth(latitude, longitude, 6),
        "slippy": encode_slippy(latitude, longitude, zoom),
        "quadkey": encode_quadkey(latitude, longitude, zoom),
        "nac": encode_nac(latitude, longitude, precision),
        "rd": _transform_wgs84_to_xy(latitude, longitude, "EPSG:28992", "RD/NAP"),
        "lambert_93": _transform_wgs84_to_xy(latitude, longitude, "EPSG:2154", "Lambert 93"),
        "lambert_72": _transform_wgs84_to_xy(latitude, longitude, "EPSG:31370", "Belgian Lambert 72"),
    }


def convert_to_format(
    input_text: str,
    source_format: str = "auto",
    target_format: str = "all",
    precision: int = 6,
) -> Dict[str, Any]:
    coord = parse_coordinate(input_text, source_format)
    target = normalize_format(target_format)
    formats = build_latlon_formats(coord.latitude, coord.longitude, precision)
    if target != "all" and target in formats:
        text_output = formats[target]
        formats = {target: text_output}
    elif target not in {"all", *SUPPORTED_FORMATS}:
        raise CoordinateConversionError(f"Format cible non supporté: {target_format}")
    else:
        text_output = formats["ddm"]
    return _conversion_payload(coord, target, text_output, {"formats": formats})


def convert_to_grid(input_text: str, source_format: str = "auto", target_format: str = "all") -> Dict[str, Any]:
    coord = parse_coordinate(input_text, source_format)
    target = normalize_format(target_format)
    formats = build_grid_formats(coord.latitude, coord.longitude)
    if target != "all":
        if target not in formats:
            raise CoordinateConversionError(f"Format grille cible non supporté: {target_format}")
        text_output = formats[target]
        formats = {target: text_output}
    else:
        text_output = "\n".join(f"{name}: {value}" for name, value in formats.items() if value)
    return _conversion_payload(coord, target, text_output, {"formats": formats})


def convert_to_code(
    input_text: str,
    source_format: str = "auto",
    target_format: str = "all",
    reference_latitude: Optional[float] = None,
    reference_longitude: Optional[float] = None,
    precision: int = 9,
    mapcode_territory: Optional[str] = None,
) -> Dict[str, Any]:
    coord = parse_coordinate(input_text, source_format, reference_latitude, reference_longitude)
    target = normalize_format(target_format)
    formats = build_code_formats(coord.latitude, coord.longitude, precision, 10, mapcode_territory)
    geocaching_formats = build_latlon_formats(coord.latitude, coord.longitude, 6)
    formats["geocaching"] = geocaching_formats["ddm"]
    if target != "all":
        if target in SUPPORTED_FORMATS:
            selected = geocaching_formats[target]
            text_output = selected
            formats = {target: selected}
        elif target not in formats:
            raise CoordinateConversionError(f"Format code cible non supporté: {target_format}")
        else:
            selected = formats[target]
            text_output = selected if isinstance(selected, str) else selected[0]["formatted"]
            formats = {target: selected}
    else:
        mapcode_text = formats["mapcode"][0]["formatted"] if formats.get("mapcode") else ""
        text_output = (
            f"geocaching: {formats['geocaching']}\n"
            f"geohash: {formats['geohash']}\n"
            f"plus_code: {formats['plus_code']}\n"
            f"mapcode: {mapcode_text}"
        )
    return _conversion_payload(coord, target, text_output, {"formats": formats, "bbox": coord.bbox})


def convert_to_special(
    input_text: str,
    source_format: str = "dd",
    target_format: str = "all",
    precision: int = 10,
    zoom: int = 15,
) -> Dict[str, Any]:
    coord = parse_coordinate(input_text, source_format)
    target = normalize_format(target_format)
    formats = build_special_formats(coord.latitude, coord.longitude, precision, zoom)
    formats["geocaching"] = format_ddm(coord.latitude, coord.longitude)
    if target != "all":
        if target in {"dd", "ddm", "dms", "geocaching"}:
            selected = build_latlon_formats(coord.latitude, coord.longitude, 6)["ddm" if target == "geocaching" else target]
        elif target not in formats:
            raise CoordinateConversionError(f"Format confidentiel cible non supporté: {target_format}")
        else:
            selected = formats[target]
        text_output = str(selected)
        formats = {target: selected}
    else:
        text_output = "\n".join(f"{name}: {value}" for name, value in formats.items())
    return _conversion_payload(coord, target, text_output, {"formats": formats, "bbox": coord.bbox})


def _conversion_payload(
    coord: CanonicalCoordinate,
    target_format: str,
    text_output: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "latitude": coord.latitude,
        "longitude": coord.longitude,
        "decimal_latitude": coord.latitude,
        "decimal_longitude": coord.longitude,
        "source_format": coord.source_format,
        "target_format": target_format,
        "text_output": text_output,
        "coordinates": coord.to_coordinates_dict(),
        "warnings": coord.warnings,
    }
    if coord.bbox:
        payload["bbox"] = coord.bbox
    if coord.area:
        payload["area"] = coord.area
    if extra:
        payload.update(extra)
    return payload
