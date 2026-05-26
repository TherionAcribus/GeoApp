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
MAKANEY_ALPHABET = "abo2zptscjkwmgnxqfd984ery3h5l76ui"
GEOHEX_KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
GEOHEX_BASE = 20037508.34
GEOHEX_K = math.tan(math.pi * (30.0 / 180.0))
BOSCH_FIRST_MATRIX = ("ABCDEFGHI", "JKLMNOPQR", "STUVWXYZ0", "123456789")
BOSCH_ITERATIVE_MATRIX = ("ABCDEF", "GHIJKL", "MNOPQR", "STUVWX", "YZ0123", "456789")


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


def _require_s2sphere(feature: str):
    try:
        from s2sphere import CellId, LatLng
        return CellId, LatLng
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Dependance manquante pour {feature}: installez le paquet 's2sphere'.") from exc


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
    if not re.fullmatch(r"[A-R]{2}\d{2}([A-X]{2}(\d{2}([A-X]{2})?)?)?", text):
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
    if len(text) >= 8:
        west += int(text[6]) * (width / 10.0)
        south += int(text[7]) * (height / 10.0)
        width /= 10.0
        height /= 10.0
    if len(text) >= 10:
        west += (ord(text[8]) - ord("A")) * (width / 24.0)
        south += (ord(text[9]) - ord("A")) * (height / 24.0)
        width /= 24.0
        height /= 24.0
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


def encode_xyz(latitude: float, longitude: float) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    transformer = _require_pyproj("XYZ/ECEF").from_crs("EPSG:4326", "EPSG:4978", always_xy=True)
    x, y, z = transformer.transform(lon, lat, 0.0)
    return f"X: {x:.3f}, Y: {y:.3f}, Z: {z:.3f}"


def decode_xyz(text: str) -> Tuple[float, float, Dict[str, float]]:
    values = [float(value.replace(",", ".")) for value in re.findall(r"[-+]?\d+(?:[\.,]\d+)?", text)]
    if len(values) < 3:
        raise ValueError("XYZ/ECEF: trois coordonnees X/Y/Z sont requises")
    transformer = _require_pyproj("XYZ/ECEF").from_crs("EPSG:4978", "EPSG:4326", always_xy=True)
    lon, lat, height = transformer.transform(values[0], values[1], values[2])
    lat, lon = _validate_lat_lon(float(lat), float(lon))
    return lat, lon, {"x": values[0], "y": values[1], "z": values[2], "height": float(height)}


def encode_xy_labelled(latitude: float, longitude: float, target_crs: str, feature: str, x_label: str = "X", y_label: str = "Y") -> str:
    transformer = _require_pyproj(feature).from_crs("EPSG:4326", target_crs, always_xy=True)
    x, y = transformer.transform(longitude, latitude)
    return f"{x_label}: {x:.3f}, {y_label}: {y:.3f}"


def encode_geo3x3(latitude: float, longitude: float, level: int = 14) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    level = max(1, min(20, int(level)))
    lng2 = lon
    code = "E" if lon >= 0 else "W"
    if lon < 0:
        lng2 += 180.0
    lat2 = lat + 90.0
    unit = 180.0
    for _ in range(1, level):
        unit /= 3.0
        x = int(lng2 // unit)
        y = int(lat2 // unit)
        code += str(x + y * 3 + 1)
        lng2 -= x * unit
        lat2 -= y * unit
    return code


def decode_geo3x3(code: str) -> Tuple[float, float, Dict[str, float]]:
    text = re.sub(r"\s+", "", code).upper()
    if not re.fullmatch(r"[EW][1-9]+", text):
        raise ValueError("Geo3x3 invalide")
    unit = 180.0
    lat = 0.0
    lon = 0.0
    west = text[0] == "W"
    for char in text[1:]:
        n = int(char)
        if n <= 0:
            raise ValueError("Geo3x3 invalide")
        unit /= 3.0
        n -= 1
        lon += (n % 3) * unit
        lat += (n // 3) * unit
    lat += unit / 2.0
    lon += unit / 2.0
    lat -= 90.0
    if west:
        lon -= 180.0
    lat, lon = _validate_lat_lon(lat, lon)
    bbox = {"south": lat - unit / 2.0, "west": lon - unit / 2.0, "north": lat + unit / 2.0, "east": lon + unit / 2.0}
    return lat, lon, {"level": len(text), "unit": unit, "bbox": bbox}


def _makaney_base33_to_decimal(text: str) -> int:
    sign = 1
    if text.startswith("-"):
        sign = -1
        text = text[1:]
    elif text.startswith("+"):
        text = text[1:]
    total = 0
    for index, char in enumerate(reversed(text.lower())):
        value = MAKANEY_ALPHABET.find(char)
        if value < 0:
            raise ValueError("Caractere Makaney invalide")
        total += value * (33 ** index)
    return sign * total


def _makaney_decimal_to_base33(value: int) -> str:
    if value == 0:
        return "A"
    sign = "-" if value < 0 else ""
    number = abs(value)
    out = ""
    while number > 0:
        out = MAKANEY_ALPHABET[number % 33] + out
        number //= 33
    return sign + out.upper()


def encode_makaney(latitude: float, longitude: float) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    lat_code = _makaney_decimal_to_base33(math.floor(lat * 10000.0))
    lon_code = _makaney_decimal_to_base33(math.floor(lon * 10000.0))
    return lat_code + (lon_code if lon_code.startswith("-") else "+" + lon_code)


def decode_makaney(code: str) -> Tuple[float, float]:
    text = re.sub(r"\s+", "", code)
    if not re.fullmatch(r"-?[A-Za-z0-9]{1,5}[+-][A-Za-z0-9]{1,6}", text):
        raise ValueError("Makaney/MKC invalide")
    pos = text.find("+")
    if pos == -1:
        pos = text.rfind("-")
    if pos <= 0:
        raise ValueError("Makaney/MKC invalide")
    lat = _makaney_base33_to_decimal(text[:pos]) / 10000.0
    lon = _makaney_base33_to_decimal(text[pos:]) / 10000.0
    return _validate_lat_lon(lat, lon)


def encode_bosch(latitude: float, longitude: float, precision: int = 15) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    precision = max(1, min(20, int(precision)))
    first_y = min(int((lon + 180.0) // 40.0), 8)
    first_x = min(int((lat + 90.0) // 45.0), 3)
    out = BOSCH_FIRST_MATRIX[first_x][first_y]
    step_y = 40.0
    step_x = 45.0
    lower_y = first_y * step_y - 180.0
    lower_x = first_x * step_x - 90.0
    for _ in range(precision):
        step_x /= 6.0
        step_y /= 6.0
        x = min(int((lat - lower_x) / step_x), 5)
        y = min(int((lon - lower_y) / step_y), 5)
        out += BOSCH_ITERATIVE_MATRIX[x][y]
        lower_x += x * step_x
        lower_y += y * step_y
    return out


def decode_bosch(code: str) -> Tuple[float, float, Dict[str, float]]:
    text = re.sub(r"[^A-Za-z0-9]", "", code).upper()
    if not text:
        raise ValueError("Bosch invalide")
    first_x = next((idx for idx, row in enumerate(BOSCH_FIRST_MATRIX) if text[0] in row), -1)
    if first_x < 0:
        raise ValueError("Bosch invalide")
    first_y = BOSCH_FIRST_MATRIX[first_x].index(text[0])
    step_y = 40.0
    step_x = 45.0
    lon = first_y * step_y - 180.0
    lat = first_x * step_x - 90.0
    for char in text[1:]:
        step_x /= 6.0
        step_y /= 6.0
        x = next((idx for idx, row in enumerate(BOSCH_ITERATIVE_MATRIX) if char in row), -1)
        if x < 0:
            raise ValueError("Bosch invalide")
        y = BOSCH_ITERATIVE_MATRIX[x].index(char)
        lat += x * step_x
        lon += y * step_y
    center_lat = lat + step_x / 2.0
    center_lon = lon + step_y / 2.0
    center_lat, center_lon = _validate_lat_lon(center_lat, center_lon)
    bbox = {"south": lat, "west": lon, "north": lat + step_x, "east": lon + step_y}
    return center_lat, center_lon, {"level": len(text), "bbox": bbox}


def encode_geohex(latitude: float, longitude: float, level: int = 12) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    level = max(0, min(35, int(level)))
    x, y = _geohex_xy_by_location(lat, lon, level)
    return _geohex_zone_by_xy(x, y, level)[4]


def decode_geohex(code: str) -> Tuple[float, float, Dict[str, float]]:
    text = code.strip()
    if len(text) < 2:
        raise ValueError("GeoHex invalide")
    x, y = _geohex_xy_by_code(text)
    lat, lon, _, _, normalized = _geohex_zone_by_xy(x, y, len(text) - 2)
    lat, lon = _validate_lat_lon(lat, lon)
    return lat, lon, {"level": len(text) - 2, "code": normalized}


def _geohex_xy_by_location(lat: float, lon: float, level: int) -> Tuple[int, int]:
    h_size = _geohex_hex_size(level)
    x_grid, y_grid = _geohex_loc2xy(lon, lat)
    unit_x = 6.0 * h_size
    unit_y = 6.0 * h_size * GEOHEX_K
    h_pos_x = (x_grid + y_grid / GEOHEX_K) / unit_x
    h_pos_y = (y_grid - GEOHEX_K * x_grid) / unit_y
    h_x_0 = math.floor(h_pos_x)
    h_y_0 = math.floor(h_pos_y)
    h_x_q = h_pos_x - h_x_0
    h_y_q = h_pos_y - h_y_0
    h_x = round(h_pos_x)
    h_y = round(h_pos_y)
    if h_y_q > -h_x_q + 1:
        if h_y_q < 2 * h_x_q and h_y_q > 0.5 * h_x_q:
            h_x = h_x_0 + 1
            h_y = h_y_0 + 1
    elif h_y_q < -h_x_q + 1:
        if h_y_q > 2 * h_x_q - 1 and h_y_q < 0.5 * h_x_q + 0.5:
            h_x = h_x_0
            h_y = h_y_0
    return _geohex_adjust_xy(h_x, h_y, level)


def _geohex_xy_by_code(code: str) -> Tuple[int, int]:
    level = len(code) - 2
    first = GEOHEX_KEY.find(code[0])
    second = GEOHEX_KEY.find(code[1])
    if first < 0 or second < 0:
        raise ValueError("GeoHex invalide")
    h_dec9 = str(first * 30 + second) + code[2:]
    if len(h_dec9) >= 3 and h_dec9[0] in "15" and h_dec9[1] not in "125" and h_dec9[2] not in "125":
        h_dec9 = ("7" if h_dec9[0] == "5" else "3") + h_dec9[1:]
    while len(h_dec9) < level + 3:
        h_dec9 = "0" + h_dec9
    h_dec3 = ""
    for char in h_dec9:
        if char not in "012345678":
            raise ValueError("GeoHex invalide")
        h_dec3 += format(int(char), "03b").replace("3", "") if False else _base9_digit_to_base3(char)
    h_x = 0
    h_y = 0
    for i in range(level + 3):
        pow3 = 3 ** (level + 2 - i)
        dx = h_dec3[i * 2]
        dy = h_dec3[i * 2 + 1]
        if dx == "0":
            h_x -= pow3
        elif dx == "2":
            h_x += pow3
        if dy == "0":
            h_y -= pow3
        elif dy == "2":
            h_y += pow3
    return _geohex_adjust_xy(h_x, h_y, level)


def _base9_digit_to_base3(char: str) -> str:
    value = int(char)
    out = ""
    while value:
        out = str(value % 3) + out
        value //= 3
    return out.rjust(2, "0")


def _geohex_zone_by_xy(x: int, y: int, level: int) -> Tuple[float, float, int, int, str]:
    h_size = _geohex_hex_size(level)
    h_x = round(x)
    h_y = round(y)
    unit_x = 6.0 * h_size
    unit_y = 6.0 * h_size * GEOHEX_K
    h_lat = (GEOHEX_K * h_x * unit_x + h_y * unit_y) / 2.0
    h_lon = (h_lat - h_y * unit_y) / GEOHEX_K
    lat, lon = _geohex_xy2loc(h_lon, h_lat)
    max_hsteps = 3 ** (level + 2)
    hsteps = abs(h_x - h_y)
    code_lon = lon
    if hsteps == max_hsteps:
        if h_x > h_y:
            h_x, h_y = h_y, h_x
        code_lon = -180.0
    code3_x = []
    code3_y = []
    mod_x = h_x
    mod_y = h_y
    for i in range(level + 3):
        h_pow = round(3 ** (level + 2 - i))
        half = math.ceil(h_pow / 2.0)
        if mod_x >= half:
            code3_x.append(2)
            mod_x -= h_pow
        elif mod_x <= -half:
            code3_x.append(0)
            mod_x += h_pow
        else:
            code3_x.append(1)
        if mod_y >= half:
            code3_y.append(2)
            mod_y -= h_pow
        elif mod_y <= -half:
            code3_y.append(0)
            mod_y += h_pow
        else:
            code3_y.append(1)
        if i == 2 and (code_lon == -180.0 or code_lon >= 0):
            if code3_x[0] == 2 and code3_y[0] == 1 and code3_x[1] == code3_y[1] and code3_x[2] == code3_y[2]:
                code3_x[0] = 1
                code3_y[0] = 2
            elif code3_x[0] == 1 and code3_y[0] == 0 and code3_x[1] == code3_y[1] and code3_x[2] == code3_y[2]:
                code3_x[0] = 0
                code3_y[0] = 1
    h_code = ""
    for x_digit, y_digit in zip(code3_x, code3_y):
        h_code += str(int(f"{x_digit}{y_digit}", 3))
    h_1 = int(h_code[:3])
    code = GEOHEX_KEY[h_1 // 30] + GEOHEX_KEY[h_1 % 30] + h_code[3:]
    return lat, lon, h_x, h_y, code


def _geohex_adjust_xy(x: int, y: int, level: int) -> Tuple[int, int]:
    max_hsteps = 3 ** (level + 2)
    hsteps = abs(x - y)
    if hsteps == max_hsteps and x > y:
        x, y = y, x
    elif hsteps > max_hsteps:
        diff = hsteps - max_hsteps
        diff_x = math.floor(diff / 2.0)
        diff_y = diff - diff_x
        if x > y:
            edge_x = x - diff_x
            edge_y = y + diff_y
            edge_x, edge_y = edge_y, edge_x
            x = edge_x + diff_x
            y = edge_y - diff_y
        elif y > x:
            edge_x = x + diff_x
            edge_y = y - diff_y
            edge_x, edge_y = edge_y, edge_x
            x = edge_x - diff_x
            y = edge_y + diff_y
    return int(x), int(y)


def _geohex_loc2xy(lon: float, lat: float) -> Tuple[float, float]:
    x = lon * GEOHEX_BASE / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0)
    y *= GEOHEX_BASE / 180.0
    return x, y


def _geohex_xy2loc(x: float, y: float) -> Tuple[float, float]:
    lon = (x / GEOHEX_BASE) * 180.0
    lat = (y / GEOHEX_BASE) * 180.0
    lat = 180.0 / math.pi * (2.0 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lat, lon


def _geohex_hex_size(level: int) -> float:
    return GEOHEX_BASE / (3.0 ** (level + 3))


def encode_dfci(latitude: float, longitude: float, level: int = 3) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    level = max(0, min(3, int(level)))
    transformer = _require_pyproj("DFCI Grid").from_crs("EPSG:4326", "EPSG:27572", always_xy=True)
    x, y = transformer.transform(lon, lat)
    if x < 0 or x > 1200000 or y < 1600000 or y > 2700000:
        return ""
    step = 100000.0
    code = chr(65 + math.floor(((x if x < 800000 else x + 200000) / step)))
    code += chr(65 + math.floor(((y if y < 2300000 else y + 200000) / step) - math.floor(1500000 / step)))
    if level == 0:
        return code
    step1 = step / 5.0
    code += str(2 * math.floor((x % step) / step1))
    code += str(2 * math.floor((y % step) / step1))
    if level == 1:
        return code
    step2 = step1 / 10.0
    x0 = math.floor((x % step1) / step2)
    code += chr(65 + (x0 if x0 < 8 else x0 + 2))
    code += str(math.floor((y % step1) / step2))
    if level == 2:
        return code
    x3 = math.floor((x % step2) / 500.0)
    y3 = math.floor((y % step2) / 500.0)
    if x3 < 1:
        code += ".1" if y3 > 1 else ".4"
    elif x3 > 2:
        code += ".2" if y3 > 1 else ".3"
    elif y3 > 2:
        code += ".1" if x3 < 2 else ".2"
    elif y3 < 1:
        code += ".4" if x3 < 2 else ".3"
    else:
        code += ".5"
    return code


def decode_dfci(code: str) -> Tuple[float, float, Dict[str, float]]:
    text = code.strip().upper()
    if not re.fullmatch(r"[A-HK-N][B-HK-N]([02468][02468]([A-HK-L]\d(\.[1-5])?)?)?", text):
        raise ValueError("DFCI Grid invalide")
    step = 100000.0
    x = ord(text[0]) - 65
    x = (x if x < 8 else x - 2) * step
    y = ord(text[1]) - 65
    y = (y if y < 8 else y - 2) * step + 1500000.0
    if len(text) == 2:
        x += step / 2.0
        y += step / 2.0
    else:
        step /= 5.0
        x += int(text[2]) / 2.0 * step
        y += int(text[3]) / 2.0 * step
        if len(text) == 4:
            x += step / 2.0
            y += step / 2.0
        else:
            step /= 10.0
            x0 = ord(text[4]) - 65
            x += (x0 if x0 < 8 else x0 - 2) * step
            y += int(text[5]) * step
            if len(text) == 6:
                x += step / 2.0
                y += step / 2.0
            else:
                quadrant = text[7]
                offsets = {
                    "1": (step / 4.0, 3.0 * step / 4.0),
                    "2": (3.0 * step / 4.0, 3.0 * step / 4.0),
                    "3": (3.0 * step / 4.0, step / 4.0),
                    "4": (step / 4.0, step / 4.0),
                    "5": (step / 2.0, step / 2.0),
                }
                dx, dy = offsets[quadrant]
                x += dx
                y += dy
    transformer = _require_pyproj("DFCI Grid").from_crs("EPSG:27572", "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(x, y)
    lat, lon = _validate_lat_lon(float(lat), float(lon))
    return lat, lon, {"x": x, "y": y}


def encode_s2cell(latitude: float, longitude: float, level: int = 30) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    CellId, LatLng = _require_s2sphere("S2Cells/Hilbert")
    level = max(0, min(30, int(level)))
    cell = CellId.from_lat_lng(LatLng.from_degrees(lat, lon)).parent(level)
    return cell.to_token()


def decode_s2cell(token: str) -> Tuple[float, float, Dict[str, float]]:
    text = re.sub(r"[^0-9a-fA-F]", "", token).lower()
    if not text or not re.fullmatch(r"[0-5]?[0-9a-f]+", text):
        raise ValueError("S2Cells/Hilbert invalide")
    CellId, _ = _require_s2sphere("S2Cells/Hilbert")
    cell = CellId.from_token(text)
    latlng = cell.to_lat_lng()
    lat, lon = _validate_lat_lon(latlng.lat().degrees, latlng.lng().degrees)
    return lat, lon, {"level": cell.level(), "id": int(cell.id())}


def encode_reverse_wherigo_day1976(latitude: float, longitude: float) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    lat_value = math.floor((lat + 90.0) * 100000.0)
    lon_value = math.floor((lon + 180.0) * 100000.0)
    lat_parts = _base36_parts(lat_value)
    lon_parts = _base36_parts(lon_value)
    return (
        f"{_base36_char(lon_parts[0])}{_base36_char(lon_parts[1])}{_base36_char(lat_parts[0])}"
        f"{_base36_char(lon_parts[2])}{_base36_char(lat_parts[1])}, "
        f"{_base36_char(lat_parts[2])}{_base36_char(lat_parts[3])}{_base36_char(lon_parts[3])}"
        f"{_base36_char(lon_parts[3])}{_base36_char(lat_parts[3])}"
    )


def decode_reverse_wherigo_day1976(text: str) -> Tuple[float, float]:
    parts = re.findall(r"[0-9a-zA-Z]{5,}", text.lower())
    if len(parts) < 2:
        raise ValueError("Reverse Wherigo Day1976 invalide")
    s, t = parts[0], parts[1]
    values = [_base36_value(char) for char in (s[2], s[4], t[0], t[1], t[4])]
    lat = (values[0] * 1679616 + values[1] * 46656 + values[2] * 1296 + values[3] * 36 + values[4]) / 100000.0 - 90.0
    values = [_base36_value(char) for char in (s[0], s[1], s[3], t[2], t[3])]
    lon = (values[0] * 1679616 + values[1] * 46656 + values[2] * 1296 + values[3] * 36 + values[4]) / 100000.0 - 180.0
    return _validate_lat_lon(lat, lon)


def _base36_parts(value: int) -> Tuple[int, int, int, int]:
    a = value // 1679616
    value %= 1679616
    b = value // 46656
    value %= 46656
    c = value // 1296
    value %= 1296
    d = value // 36
    return int(a), int(b), int(c), int(d)


def _base36_char(value: int) -> str:
    return "0123456789abcdefghijklmnopqrstuvwxyz"[value]


def _base36_value(char: str) -> int:
    return "0123456789abcdefghijklmnopqrstuvwxyz".index(char.lower())


WALDMEISTER_LENGTH = 6
WALDMEISTER_FACTOR = 100000


def encode_reverse_wherigo_waldmeister(latitude: float, longitude: float) -> str:
    lat, lon = _validate_lat_lon(latitude, longitude)
    sign_code = 1
    if lat < 0 and lon < 0:
        sign_code = 4
        lat = -lat
        lon = -lon
    elif lat < 0 and lon > 0:
        sign_code = 2
        lat = -lat
    elif lat > 0 and lon < 0:
        sign_code = 3
        lon = -lon
    lat_value = int(lat * WALDMEISTER_FACTOR)
    lon_value = int(lon * WALDMEISTER_FACTOR)
    b3 = int(_wald_b3_checksum(lat_value, lon_value, sign_code))
    c3 = int(_wald_c3_checksum(lat_value, lon_value))
    if _wald_variant_from_latlon(lat_value, lon_value):
        a = (
            str(_digit_at(lat_value, 2))
            + str(_digit_at(lon_value, 7))
            + str(_digit_at(lat_value, 6))
            + str(sign_code)
            + str(_digit_at(lon_value, 2))
            + str(_digit_at(lat_value, 0))
        )
        b = (
            str(_digit_at(lon_value, 3))
            + str(_digit_at(lat_value, 4))
            + str(b3)
            + str(_digit_at(lon_value, 4))
            + str(_digit_at(lat_value, 5))
            + str(_digit_at(lon_value, 0))
        )
        c = (
            str(_digit_at(lon_value, 6))
            + str(_digit_at(lon_value, 1))
            + str(c3)
            + str(_digit_at(lat_value, 3))
            + str(_digit_at(lat_value, 1))
            + str(_digit_at(lon_value, 5))
        )
    else:
        a = (
            str(_digit_at(lat_value, 0))
            + str(_digit_at(lon_value, 4))
            + str(_digit_at(lat_value, 4))
            + str(sign_code)
            + str(_digit_at(lon_value, 5))
            + str(_digit_at(lat_value, 5))
        )
        b = (
            str(_digit_at(lat_value, 6))
            + str(_digit_at(lon_value, 0))
            + str(b3)
            + str(_digit_at(lon_value, 3))
            + str(_digit_at(lon_value, 7))
            + str(_digit_at(lon_value, 2))
        )
        c = (
            str(_digit_at(lat_value, 3))
            + str(_digit_at(lon_value, 1))
            + str(c3)
            + str(_digit_at(lat_value, 2))
            + str(_digit_at(lat_value, 1))
            + str(_digit_at(lon_value, 6))
        )
    return f"{int(a):06d}, {int(b):06d}, {int(c):06d}"


def decode_reverse_wherigo_waldmeister(text: str) -> Tuple[float, float]:
    parts = [int(value) for value in re.findall(r"\d+", text)]
    if len(parts) < 3:
        raise ValueError("Reverse Wherigo Waldmeister invalide")
    a, b, c = parts[:3]
    if not _wald_checksum_test(a, b, c):
        raise ValueError("Checksum Reverse Wherigo Waldmeister invalide")
    lat_sign = 1
    lon_sign = 1
    sign_code = _digit_at(a, 2)
    if sign_code == 2:
        lat_sign = -1
    elif sign_code == 3:
        lon_sign = -1
    elif sign_code == 4:
        lat_sign = -1
        lon_sign = -1
    if _wald_variant_from_c(c):
        lat = lat_sign * (
            _digit_at(a, WALDMEISTER_LENGTH - 3) * 10
            + _digit_at(b, WALDMEISTER_LENGTH - 5)
            + _digit_at(b, WALDMEISTER_LENGTH - 2) * 0.1
            + _digit_at(c, WALDMEISTER_LENGTH - 4) * 0.01
            + _digit_at(a, WALDMEISTER_LENGTH - 1) * 0.001
            + _digit_at(c, WALDMEISTER_LENGTH - 5) * 0.0001
            + _digit_at(a, WALDMEISTER_LENGTH - 6) * 0.00001
        )
        lon = lon_sign * (
            _digit_at(a, WALDMEISTER_LENGTH - 2) * 100
            + _digit_at(c, WALDMEISTER_LENGTH - 1) * 10
            + _digit_at(c, WALDMEISTER_LENGTH - 6)
            + _digit_at(b, WALDMEISTER_LENGTH - 4) * 0.1
            + _digit_at(b, WALDMEISTER_LENGTH - 1) * 0.01
            + _digit_at(a, WALDMEISTER_LENGTH - 5) * 0.001
            + _digit_at(c, WALDMEISTER_LENGTH - 2) * 0.0001
            + _digit_at(b, WALDMEISTER_LENGTH - 6) * 0.00001
        )
    else:
        lat = lat_sign * (
            _digit_at(b, WALDMEISTER_LENGTH - 1) * 10
            + _digit_at(a, WALDMEISTER_LENGTH - 6)
            + _digit_at(a, WALDMEISTER_LENGTH - 3) * 0.1
            + _digit_at(c, WALDMEISTER_LENGTH - 1) * 0.01
            + _digit_at(c, WALDMEISTER_LENGTH - 4) * 0.001
            + _digit_at(c, WALDMEISTER_LENGTH - 5) * 0.0001
            + _digit_at(a, WALDMEISTER_LENGTH - 1) * 0.00001
        )
        lon = lon_sign * (
            _digit_at(b, WALDMEISTER_LENGTH - 5) * 100
            + _digit_at(c, WALDMEISTER_LENGTH - 6) * 10
            + _digit_at(a, WALDMEISTER_LENGTH - 5)
            + _digit_at(a, WALDMEISTER_LENGTH - 2) * 0.1
            + _digit_at(b, WALDMEISTER_LENGTH - 4) * 0.01
            + _digit_at(b, WALDMEISTER_LENGTH - 6) * 0.001
            + _digit_at(c, WALDMEISTER_LENGTH - 2) * 0.0001
            + _digit_at(b, WALDMEISTER_LENGTH - 2) * 0.00001
        )
    return _validate_lat_lon(lat, lon)


def encode_reverse_wherigo_10y(latitude: float, longitude: float) -> str:
    wald = "".join(f"{int(value):06d}" for value in re.findall(r"\d+", encode_reverse_wherigo_waldmeister(latitude, longitude)))
    reordered = wald[:6] + wald[12:18] + wald[6:12]
    encoded = "".join(str((_digit + index) % 10) for index, _digit in enumerate((int(ch) for ch in reordered), start=1))
    return f"{encoded[:6]}, {encoded[6:12]}, {encoded[12:18]}"


def decode_reverse_wherigo_10y(text: str) -> Tuple[float, float]:
    parts = [value.zfill(6) for value in re.findall(r"\d+", text)]
    if len(parts) < 3:
        raise ValueError("Reverse Wherigo 10Y invalide")
    compact = "".join(parts[:3])
    wald = "".join(str((int(ch) - index) % 10) for index, ch in enumerate(compact, start=1))
    normal = f"{wald[:6]}, {wald[12:18]}, {wald[6:12]}"
    return decode_reverse_wherigo_waldmeister(normal)


def _wald_variant_from_latlon(lat_value: int, lon_value: int) -> bool:
    return (_digit_at(lon_value, 1) + _digit_at(lat_value, 1)) % 2 == 0


def _wald_variant_from_c(c: int) -> bool:
    return (_digit_at(c, WALDMEISTER_LENGTH - 2) + _digit_at(c, WALDMEISTER_LENGTH - 5)) % 2 == 0


def _wald_b3_checksum(lat_value: int, lon_value: int, sign_code: int) -> int:
    if _wald_variant_from_latlon(lat_value, lon_value):
        value = 11 - (
            sign_code * 2
            + _digit_at(lat_value, 6) * 4
            + _digit_at(lat_value, 4) * 7
            + _digit_at(lat_value, 2) * 8
            + _digit_at(lat_value, 0) * 5
            + _digit_at(lon_value, 7) * 6
            + _digit_at(lon_value, 3) * 9
            + _digit_at(lon_value, 2) * 3
        ) % 11
    else:
        value = 11 - (
            sign_code * 2
            + _digit_at(lat_value, 6) * 9
            + _digit_at(lat_value, 5) * 5
            + _digit_at(lat_value, 4) * 4
            + _digit_at(lat_value, 0) * 8
            + _digit_at(lon_value, 5) * 3
            + _digit_at(lon_value, 4) * 6
            + _digit_at(lon_value, 0) * 7
        ) % 11
    return _wald_transform_checksum(value)


def _wald_b3_checksum_from_code(a: int, b: int, c: int) -> int:
    if _wald_variant_from_c(c):
        value = 11 - (
            _digit_at(a, WALDMEISTER_LENGTH - 4) * 2
            + _digit_at(a, WALDMEISTER_LENGTH - 3) * 4
            + _digit_at(b, WALDMEISTER_LENGTH - 2) * 7
            + _digit_at(a, WALDMEISTER_LENGTH - 1) * 8
            + _digit_at(a, WALDMEISTER_LENGTH - 6) * 5
            + _digit_at(a, WALDMEISTER_LENGTH - 2) * 6
            + _digit_at(b, WALDMEISTER_LENGTH - 1) * 9
            + _digit_at(a, WALDMEISTER_LENGTH - 5) * 3
        ) % 11
    else:
        value = 11 - (
            _digit_at(a, WALDMEISTER_LENGTH - 4) * 2
            + _digit_at(b, WALDMEISTER_LENGTH - 1) * 9
            + _digit_at(a, WALDMEISTER_LENGTH - 6) * 5
            + _digit_at(a, WALDMEISTER_LENGTH - 3) * 4
            + _digit_at(a, WALDMEISTER_LENGTH - 1) * 8
            + _digit_at(a, WALDMEISTER_LENGTH - 5) * 3
            + _digit_at(a, WALDMEISTER_LENGTH - 2) * 6
            + _digit_at(b, WALDMEISTER_LENGTH - 2) * 7
        ) % 11
    return _wald_transform_checksum(value)


def _wald_c3_checksum(lat_value: int, lon_value: int) -> int:
    if _wald_variant_from_latlon(lat_value, lon_value):
        value = 11 - (
            _digit_at(lat_value, 5) * 6
            + _digit_at(lat_value, 3) * 5
            + _digit_at(lat_value, 1) * 9
            + _digit_at(lon_value, 6) * 2
            + _digit_at(lon_value, 5) * 7
            + _digit_at(lon_value, 4) * 8
            + _digit_at(lon_value, 1) * 3
            + _digit_at(lon_value, 0) * 4
        ) % 11
    else:
        value = 11 - (
            _digit_at(lat_value, 3) * 2
            + _digit_at(lat_value, 2) * 5
            + _digit_at(lat_value, 1) * 9
            + _digit_at(lon_value, 7) * 6
            + _digit_at(lon_value, 6) * 7
            + _digit_at(lon_value, 3) * 8
            + _digit_at(lon_value, 2) * 4
            + _digit_at(lon_value, 1) * 3
        ) % 11
    return _wald_transform_checksum(value)


def _wald_c3_checksum_from_code(b: int, c: int) -> int:
    if _wald_variant_from_c(c):
        value = 11 - (
            _digit_at(b, WALDMEISTER_LENGTH - 5) * 6
            + _digit_at(c, WALDMEISTER_LENGTH - 4) * 5
            + _digit_at(c, WALDMEISTER_LENGTH - 5) * 9
            + _digit_at(c, WALDMEISTER_LENGTH - 1) * 2
            + _digit_at(c, WALDMEISTER_LENGTH - 6) * 7
            + _digit_at(b, WALDMEISTER_LENGTH - 4) * 8
            + _digit_at(c, WALDMEISTER_LENGTH - 2) * 3
            + _digit_at(b, WALDMEISTER_LENGTH - 6) * 4
        ) % 11
    else:
        value = 11 - (
            _digit_at(c, WALDMEISTER_LENGTH - 1) * 2
            + _digit_at(c, WALDMEISTER_LENGTH - 4) * 5
            + _digit_at(c, WALDMEISTER_LENGTH - 5) * 9
            + _digit_at(b, WALDMEISTER_LENGTH - 5) * 6
            + _digit_at(c, WALDMEISTER_LENGTH - 6) * 7
            + _digit_at(b, WALDMEISTER_LENGTH - 4) * 8
            + _digit_at(b, WALDMEISTER_LENGTH - 6) * 4
            + _digit_at(c, WALDMEISTER_LENGTH - 2) * 3
        ) % 11
    return _wald_transform_checksum(value)


def _wald_transform_checksum(value: int) -> int:
    if value == 10:
        return 0
    if value == 11:
        return 5
    return int(value)


def _wald_checksum_test(a: int, b: int, c: int) -> bool:
    return _wald_b3_checksum_from_code(a, b, c) == _digit_at(b, WALDMEISTER_LENGTH - 3) and _wald_c3_checksum_from_code(b, c) == _digit_at(c, WALDMEISTER_LENGTH - 3)


def _digit_at(number: int, position: int) -> int:
    return (abs(number) // (10 ** position)) % 10
