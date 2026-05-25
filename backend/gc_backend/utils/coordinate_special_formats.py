"""Algorithms for less common coordinate encodings.

These helpers are intentionally independent from the public converter facade.
Callers normalize errors into their own API layer.
"""

from __future__ import annotations

import math
import re
from typing import Dict, Tuple


GARS_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
NAC_ALPHABET = "0123456789BCDFGHJKLMNPQRSTUVWXYZ"


def _validate_lat_lon(latitude: float, longitude: float) -> Tuple[float, float]:
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise ValueError("Coordonnees non finies")
    if not -90 <= latitude <= 90:
        raise ValueError(f"Latitude hors limites: {latitude}")
    if not -180 <= longitude <= 180:
        raise ValueError(f"Longitude hors limites: {longitude}")
    return round(latitude, 8), round(longitude, 8)


def _require_pyproj(feature: str):
    try:
        from pyproj import Transformer
        return Transformer
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Dependance manquante pour {feature}: installez le paquet 'pyproj'.") from exc


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
        raise ValueError("Code GARS invalide")

    lon_index = int(match.group("lon"))
    if not 1 <= lon_index <= 720:
        raise ValueError("Colonne GARS hors limites")
    first = GARS_LETTERS.index(match.group("lat")[0])
    second = GARS_LETTERS.index(match.group("lat")[1])
    lat_index = first * 24 + second
    if not 0 <= lat_index <= 359:
        raise ValueError("Bande GARS hors limites")

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
        raise ValueError("Locator QTH/Maidenhead invalide")
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
        raise ValueError("Tuile Slippy invalide, format attendu z/x/y")
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
        raise ValueError("Quadkey invalide")
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
        raise ValueError("Zoom hors limites")
    n = 2 ** z
    if not 0 <= x < n or not 0 <= y < n:
        raise ValueError("Coordonnees de tuile hors limites")
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
        raise ValueError("NAC invalide")
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
            raise ValueError("Caractere NAC invalide")
        width /= 30.0
        value += NAC_ALPHABET.index(char) * width
    return offset + value, width


def transform_xy_to_wgs84(text: str, source_crs: str, feature: str) -> Tuple[float, float]:
    values = [float(value.replace(",", ".")) for value in re.findall(r"[-+]?\d+(?:[\.,]\d+)?", text)]
    if len(values) < 2:
        raise ValueError(f"{feature}: deux coordonnees X/Y sont requises")
    transformer = _require_pyproj(feature).from_crs(source_crs, "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(values[0], values[1])
    return _validate_lat_lon(float(lat), float(lon))


def transform_wgs84_to_xy(latitude: float, longitude: float, target_crs: str, feature: str) -> str:
    transformer = _require_pyproj(feature).from_crs("EPSG:4326", target_crs, always_xy=True)
    x, y = transformer.transform(longitude, latitude)
    return f"{x:.3f}, {y:.3f}"
