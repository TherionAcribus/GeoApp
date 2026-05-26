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

from gc_backend.utils.coordinate_formatting import (
    build_latlon_formats,
    format_dd,
    format_ddm,
    format_ddm_component,
    format_dms,
    format_dms_component,
)
from gc_backend.utils.coordinate_special_formats import (
    NAC_ALPHABET,
    decode_bosch,
    decode_dfci,
    decode_gars,
    decode_geo3x3,
    decode_geohex,
    decode_makaney,
    decode_nac,
    decode_qth,
    decode_quadkey,
    decode_reverse_wherigo_day1976,
    decode_reverse_wherigo_10y,
    decode_reverse_wherigo_waldmeister,
    decode_s2cell,
    decode_slippy,
    decode_xyz,
    encode_bosch,
    encode_dfci,
    encode_gars,
    encode_geo3x3,
    encode_geohex,
    encode_makaney,
    encode_nac,
    encode_qth,
    encode_quadkey,
    encode_reverse_wherigo_day1976,
    encode_reverse_wherigo_10y,
    encode_reverse_wherigo_waldmeister,
    encode_s2cell,
    encode_slippy,
    encode_xy_labelled,
    encode_xyz,
    transform_wgs84_to_xy,
    transform_xy_to_wgs84,
)


SUPPORTED_FORMATS = {"dd", "ddm", "dms"}
SUPPORTED_GRID_FORMATS = {"utm", "mgrs", "osgb", "osgr", "web_mercator"}
SUPPORTED_CODE_FORMATS = {"geohash", "plus_code", "mapcode"}
SUPPORTED_SPECIAL_FORMATS = {
    "gars",
    "qth",
    "maidenhead",
    "slippy",
    "quadkey",
    "quadtree",
    "nac",
    "rd",
    "lambert_93",
    "lambert_72",
    "lambert_2008",
    "etrs89_lcc",
    "lambert_cc42",
    "lambert_cc43",
    "lambert_cc44",
    "lambert_cc45",
    "lambert_cc46",
    "lambert_cc47",
    "lambert_cc48",
    "lambert_cc49",
    "lambert_cc50",
    "lambert_ntf",
    "xyz",
    "ecef",
    "swissgrid",
    "swissgrid_plus",
    "gauss_kruger",
    "gauss_kruger_2",
    "gauss_kruger_3",
    "gauss_kruger_4",
    "gauss_kruger_5",
    "geo3x3",
    "makaney",
    "bosch",
    "geohex",
    "dfci_grid",
    "s2cell",
    "reverse_wherigo",
    "reverse_wherigo_10y",
    "reverse_wherigo_day1976",
}
LAMBERT_CRS = {
    "lambert_93": ("EPSG:2154", "Lambert 93"),
    "lambert_72": ("EPSG:31370", "Belgian Lambert 72"),
    "lambert_2008": ("EPSG:3812", "Belgian Lambert 2008"),
    "etrs89_lcc": ("EPSG:3034", "ETRS89 LCC"),
    "lambert_cc42": ("EPSG:3942", "Lambert CC42"),
    "lambert_cc43": ("EPSG:3943", "Lambert CC43"),
    "lambert_cc44": ("EPSG:3944", "Lambert CC44"),
    "lambert_cc45": ("EPSG:3945", "Lambert CC45"),
    "lambert_cc46": ("EPSG:3946", "Lambert CC46"),
    "lambert_cc47": ("EPSG:3947", "Lambert CC47"),
    "lambert_cc48": ("EPSG:3948", "Lambert CC48"),
    "lambert_cc49": ("EPSG:3949", "Lambert CC49"),
    "lambert_cc50": ("EPSG:3950", "Lambert CC50"),
    "lambert_ntf": ("EPSG:27572", "Lambert NTF II"),
}
GAUSS_KRUGER_CRS = {
    "gauss_kruger": ("EPSG:31467", "Gauss-Kruger zone 3"),
    "gauss_kruger_2": ("EPSG:31466", "Gauss-Kruger zone 2"),
    "gauss_kruger_3": ("EPSG:31467", "Gauss-Kruger zone 3"),
    "gauss_kruger_4": ("EPSG:31468", "Gauss-Kruger zone 4"),
    "gauss_kruger_5": ("EPSG:31469", "Gauss-Kruger zone 5"),
}

_DD_PAIR_RE = re.compile(
    r"(?<![\w.])(?P<lat>[+-]?\d{1,2}\.\d+)\s*[,;]\s*(?P<lon>[+-]?\d{1,3}\.\d+)(?![\w.])"
)
_DDM_PAIR_RE = re.compile(
    r"[NS]\s*\d{1,2}\s*(?:[Â°ÂºËš'`Â´â€™â€²?]|deg|degrees)?\s*[0-5]?\d(?:[\.,]\d+)?"
    r".{0,8}?"
    r"[EWOL]\s*\d{1,3}\s*(?:[Â°ÂºËš'`Â´â€™â€²?]|deg|degrees)?\s*[0-5]?\d(?:[\.,]\d+)?",
    re.IGNORECASE,
)
_DMS_PAIR_RE = re.compile(
    r"[NS]\s*\d{1,2}\s*(?:[Â°ÂºËš?]|deg|degrees)?\s*[0-5]?\d(?:\s*(?:['â€™â€²m]|min|minutes)\s*|\s+)"
    r"[0-5]?\d(?:[\.,]\d+)?\s*(?:[\"â€â€³s]|sec|seconds)?"
    r".{0,8}?"
    r"[EWOL]\s*\d{1,3}\s*(?:[Â°ÂºËš?]|deg|degrees)?\s*[0-5]?\d(?:\s*(?:['â€™â€²m]|min|minutes)\s*|\s+)"
    r"[0-5]?\d(?:[\.,]\d+)?\s*(?:[\"â€â€³s]|sec|seconds)?",
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
_QTH_RE = re.compile(r"\b[A-R]{2}\d{2}([A-X]{2}(\d{2}([A-X]{2})?)?)?\b", re.IGNORECASE)
_SLIPPY_RE = re.compile(r"\b\d{1,2}/\d{1,10}/\d{1,10}\b")
_NAC_RE = re.compile(rf"\b[{NAC_ALPHABET}]{{6,12}}\s+[{NAC_ALPHABET}]{{6,12}}\b", re.IGNORECASE)
_XYZ_RE = re.compile(r"\bX\s*:?\s*[-+]?\d+(?:[\.,]\d+)?\s*,?\s*Y\s*:?\s*[-+]?\d+(?:[\.,]\d+)?\s*,?\s*Z\s*:?\s*[-+]?\d+(?:[\.,]\d+)?\b", re.IGNORECASE)
_GEO3X3_RE = re.compile(r"\b[EW][1-9]{6,30}\b", re.IGNORECASE)
_MAKANEY_RE = re.compile(r"\b-?[A-Z0-9]{1,5}[+-][A-Z0-9]{1,6}\b", re.IGNORECASE)
_DFCI_RE = re.compile(r"\b[A-HK-N][B-HK-N](?:[02468][02468](?:[A-HK-L]\d(?:\.[1-5])?)?)?\b", re.IGNORECASE)
_S2CELL_RE = re.compile(r"\b[0-5][0-9a-f]{8,16}\b", re.IGNORECASE)
_REVERSE_WHERIGO_RE = re.compile(r"\b\d{6}\s*[,; ]\s*\d{6}\s*[,; ]\s*\d{6}\b")
_DAY1976_RE = re.compile(r"\b[0-9a-z]{5}\s*[,; ]\s*[0-9a-z]{5}\b", re.IGNORECASE)


class CoordinateConversionError(ValueError):
    """Raised when an input cannot be parsed or converted."""


class MissingCoordinateDependencyError(CoordinateConversionError):
    """Raised when an optional conversion dependency is not installed."""

    def __init__(self, package: str, feature: str):
        super().__init__(f"DÃ©pendance manquante pour {feature}: installez le paquet '{package}'.")
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


def _validate_lat_lon(latitude: float, longitude: float) -> Tuple[float, float]:
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise CoordinateConversionError("CoordonnÃ©es non finies")
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
        "lambert2008": "lambert_2008",
        "lambert_2008": "lambert_2008",
        "etrs89lcc": "etrs89_lcc",
        "etrs89_lcc": "etrs89_lcc",
        "lambert_ntf_ii": "lambert_ntf",
        "lambert_ntf": "lambert_ntf",
        "lambert_rgf": "lambert_93",
        "rgf": "lambert_93",
        "xyz": "xyz",
        "ecef": "xyz",
        "swiss_grid": "swissgrid",
        "ch1903": "swissgrid",
        "lv03": "swissgrid",
        "swissgridplus": "swissgrid_plus",
        "swiss_grid_plus": "swissgrid_plus",
        "ch1903+": "swissgrid_plus",
        "ch1903_plus": "swissgrid_plus",
        "lv95": "swissgrid_plus",
        "gauss_krüger": "gauss_kruger",
        "gauss_krueger": "gauss_kruger",
        "gausskrueger": "gauss_kruger",
        "gausskruger": "gauss_kruger",
        "gk": "gauss_kruger",
        "gk2": "gauss_kruger_2",
        "gk3": "gauss_kruger_3",
        "gk4": "gauss_kruger_4",
        "gk5": "gauss_kruger_5",
        "geo3*3": "geo3x3",
        "geo3_3": "geo3x3",
        "mkc": "makaney",
        "makaney_code": "makaney",
        "dfci": "dfci_grid",
        "dfci_grid": "dfci_grid",
        "s2": "s2cell",
        "s2cells": "s2cell",
        "s2cells_hilbert": "s2cell",
        "s2_cell": "s2cell",
        "s2_cell_hilbert": "s2cell",
        "waldmeister": "reverse_wherigo",
        "reverse_wherigo": "reverse_wherigo",
        "reverse_wherigo_waldmeister": "reverse_wherigo",
        "10y": "reverse_wherigo_10y",
        "reverse_wherigo_10y": "reverse_wherigo_10y",
        "reverse_wherigo_10y_waldmeister": "reverse_wherigo_10y",
        "day1976": "reverse_wherigo_day1976",
        "reverse_wherigo_day1976": "reverse_wherigo_day1976",
    }
    if re.fullmatch(r"lambert_cc\d{2}", value):
        return value
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
        raise CoordinateConversionError("Aucune coordonnÃ©e fournie")

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
    raise CoordinateConversionError(f"Format de coordonnÃ©e non reconnu{': ' + detail if detail else ''}")


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
        if fmt == "geohash" and not re.search(r"\d", raw):
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
        ("xyz", _XYZ_RE),
        ("dfci_grid", _DFCI_RE),
        ("geo3x3", _GEO3X3_RE),
        ("makaney", _MAKANEY_RE),
        ("s2cell", _S2CELL_RE),
        ("reverse_wherigo", _REVERSE_WHERIGO_RE),
        ("reverse_wherigo_day1976", _DAY1976_RE),
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
    if re.fullmatch(r"[A-R]{2}\d{2}([A-X]{2}(\d{2}([A-X]{2})?)?)?", upper):
        candidates.append("qth")
    if re.fullmatch(r"\d{1,2}[/,;:\s]+\d+[/,;:\s]+\d+", upper):
        candidates.append("slippy")
    if re.fullmatch(rf"[{NAC_ALPHABET}\s]{{8,25}}", upper) and any(char in upper for char in "BCDFGHJKLMNPQRSTUVWXYZ"):
        candidates.append("nac")
    if re.search(r"\bX\s*:.*\bY\s*:.*\bZ\s*:", upper):
        candidates.append("xyz")
    if re.fullmatch(r"[A-HK-N][B-HK-N]([02468][02468]([A-HK-L]\d(\.[1-5])?)?)?", upper):
        candidates.append("dfci_grid")
    if re.fullmatch(r"[EW][1-9]+", upper):
        candidates.append("geo3x3")
    if re.fullmatch(r"-?[A-Z0-9]{1,5}[+-][A-Z0-9]{1,6}", upper):
        candidates.append("makaney")
    if re.fullmatch(r"[0-5][0-9A-F]{8,16}", upper):
        candidates.append("s2cell")
    if re.fullmatch(r"\d{6}\s*[,; ]\s*\d{6}\s*[,; ]\s*\d{6}", upper):
        candidates.append("reverse_wherigo")
    if re.fullmatch(r"[0-9A-Z]{5}\s*[,; ]\s*[0-9A-Z]{5}", upper):
        candidates.append("reverse_wherigo_day1976")
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
        raise CoordinateConversionError(f"Format gÃ©ographique non supportÃ©: {source_format}")
    lat, lon = _validate_lat_lon(lat, lon)
    return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=format_ddm(lat, lon))


def _parse_dd(text: str) -> Tuple[float, float]:
    normalized = text.replace(",", " ")
    signed = re.findall(r"[-+]?\d+(?:\.\d+)?", normalized)
    if len(signed) < 2:
        raise CoordinateConversionError("Deux valeurs dÃ©cimales sont requises")
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
        r"(?P<dir>[NSWEOL])\s*(?P<deg>\d{1,3})\s*(?:[Â°ÂºËš'`Â´â€™â€²?]|deg|degrees)?\s*"
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
        r"(?P<dir>[NSWEOL])\s*(?P<deg>\d{1,3})\s*(?:[Â°ÂºËš?]|deg|degrees)?\s*"
        r"(?P<min>[0-5]?\d)(?:\s*(?:['â€™â€²m]|min|minutes)\s*|\s+)"
        r"(?P<sec>[0-5]?\d(?:[\.,]\d+)?)\s*(?:[\"â€â€³s]|sec|seconds)?",
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
        raise CoordinateConversionError(f"Format grille non supportÃ©: {source_format}")
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
                raise CoordinateConversionError("Un Plus Code court requiert latitude/longitude de rÃ©fÃ©rence")
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
    raise CoordinateConversionError(f"Format code non supportÃ©: {source_format}")


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
    if fmt == "xyz":
        lat, lon, metadata = decode_xyz(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text, precision=metadata)
    if fmt == "rd":
        lat, lon = transform_xy_to_wgs84(text, "EPSG:28992", "RD/NAP")
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "swissgrid":
        lat, lon = transform_xy_to_wgs84(text, "EPSG:21781", "SwissGrid CH1903/LV03")
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "swissgrid_plus":
        lat, lon = transform_xy_to_wgs84(text, "EPSG:2056", "SwissGrid CH1903+/LV95")
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt in GAUSS_KRUGER_CRS:
        crs, feature = GAUSS_KRUGER_CRS[fmt]
        lat, lon = transform_xy_to_wgs84(text, crs, feature)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt in LAMBERT_CRS:
        crs, feature = LAMBERT_CRS[fmt]
        lat, lon = transform_xy_to_wgs84(text, crs, feature)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "geo3x3":
        lat, lon, metadata = decode_geo3x3(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper(), precision=metadata, bbox=metadata.get("bbox"))
    if fmt == "makaney":
        lat, lon = decode_makaney(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper())
    if fmt == "bosch":
        lat, lon, metadata = decode_bosch(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper(), precision=metadata, bbox=metadata.get("bbox"))
    if fmt == "geohex":
        lat, lon, metadata = decode_geohex(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=metadata.get("code", text), precision=metadata)
    if fmt == "dfci_grid":
        lat, lon, metadata = decode_dfci(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.upper(), precision=metadata)
    if fmt == "s2cell":
        lat, lon, metadata = decode_s2cell(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.lower(), precision=metadata)
    if fmt == "reverse_wherigo":
        lat, lon = decode_reverse_wherigo_waldmeister(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "reverse_wherigo_10y":
        lat, lon = decode_reverse_wherigo_10y(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text)
    if fmt == "reverse_wherigo_day1976":
        lat, lon = decode_reverse_wherigo_day1976(text)
        return CanonicalCoordinate(lat, lon, fmt, raw=input_text, formatted=text.lower())
    raise CoordinateConversionError(f"Format confidentiel non supportÃ©: {source_format}")


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
        "rd": transform_wgs84_to_xy(latitude, longitude, "EPSG:28992", "RD/NAP"),
        "lambert_93": transform_wgs84_to_xy(latitude, longitude, "EPSG:2154", "Lambert 93"),
        "lambert_72": transform_wgs84_to_xy(latitude, longitude, "EPSG:31370", "Belgian Lambert 72"),
        "lambert_2008": transform_wgs84_to_xy(latitude, longitude, "EPSG:3812", "Belgian Lambert 2008"),
        "etrs89_lcc": transform_wgs84_to_xy(latitude, longitude, "EPSG:3034", "ETRS89 LCC"),
        "lambert_cc42": transform_wgs84_to_xy(latitude, longitude, "EPSG:3942", "Lambert CC42"),
        "lambert_cc43": transform_wgs84_to_xy(latitude, longitude, "EPSG:3943", "Lambert CC43"),
        "lambert_cc44": transform_wgs84_to_xy(latitude, longitude, "EPSG:3944", "Lambert CC44"),
        "lambert_cc45": transform_wgs84_to_xy(latitude, longitude, "EPSG:3945", "Lambert CC45"),
        "lambert_cc46": transform_wgs84_to_xy(latitude, longitude, "EPSG:3946", "Lambert CC46"),
        "lambert_cc47": transform_wgs84_to_xy(latitude, longitude, "EPSG:3947", "Lambert CC47"),
        "lambert_cc48": transform_wgs84_to_xy(latitude, longitude, "EPSG:3948", "Lambert CC48"),
        "lambert_cc49": transform_wgs84_to_xy(latitude, longitude, "EPSG:3949", "Lambert CC49"),
        "lambert_cc50": transform_wgs84_to_xy(latitude, longitude, "EPSG:3950", "Lambert CC50"),
        "lambert_ntf": transform_wgs84_to_xy(latitude, longitude, "EPSG:27572", "Lambert NTF II"),
        "xyz": encode_xyz(latitude, longitude),
        "swissgrid": encode_xy_labelled(latitude, longitude, "EPSG:21781", "SwissGrid CH1903/LV03", "Y", "X"),
        "swissgrid_plus": encode_xy_labelled(latitude, longitude, "EPSG:2056", "SwissGrid CH1903+/LV95", "Y", "X"),
        "gauss_kruger": encode_xy_labelled(latitude, longitude, "EPSG:31467", "Gauss-Kruger zone 3", "R", "H"),
        "gauss_kruger_2": encode_xy_labelled(latitude, longitude, "EPSG:31466", "Gauss-Kruger zone 2", "R", "H"),
        "gauss_kruger_3": encode_xy_labelled(latitude, longitude, "EPSG:31467", "Gauss-Kruger zone 3", "R", "H"),
        "gauss_kruger_4": encode_xy_labelled(latitude, longitude, "EPSG:31468", "Gauss-Kruger zone 4", "R", "H"),
        "gauss_kruger_5": encode_xy_labelled(latitude, longitude, "EPSG:31469", "Gauss-Kruger zone 5", "R", "H"),
        "geo3x3": encode_geo3x3(latitude, longitude, max(1, min(20, precision))),
        "makaney": encode_makaney(latitude, longitude),
        "bosch": encode_bosch(latitude, longitude, 15),
        "geohex": encode_geohex(latitude, longitude, max(0, min(35, precision))),
        "dfci_grid": encode_dfci(latitude, longitude, 3),
        "s2cell": encode_s2cell(latitude, longitude, 30),
        "reverse_wherigo": encode_reverse_wherigo_waldmeister(latitude, longitude),
        "reverse_wherigo_10y": encode_reverse_wherigo_10y(latitude, longitude),
        "reverse_wherigo_day1976": encode_reverse_wherigo_day1976(latitude, longitude),
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
        raise CoordinateConversionError(f"Format cible non supportÃ©: {target_format}")
    else:
        text_output = formats["ddm"]
    return _conversion_payload(coord, target, text_output, {"formats": formats})


def convert_to_grid(input_text: str, source_format: str = "auto", target_format: str = "all") -> Dict[str, Any]:
    coord = parse_coordinate(input_text, source_format)
    target = normalize_format(target_format)
    formats = build_grid_formats(coord.latitude, coord.longitude)
    if target != "all":
        if target not in formats:
            raise CoordinateConversionError(f"Format grille cible non supportÃ©: {target_format}")
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
            raise CoordinateConversionError(f"Format code cible non supportÃ©: {target_format}")
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
            raise CoordinateConversionError(f"Format confidentiel cible non supportÃ©: {target_format}")
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
