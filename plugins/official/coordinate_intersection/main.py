"""Official plugin: coordinate_intersection.

Finds the point(s) located at distance d1 from point P1 AND at distance d2 from point P2.
This is the circle-circle intersection problem on the Earth's surface (spherical geometry).

Up to two candidate points are returned. Zero points means the circles do not intersect.

Supports:
- smooth mode: extract the two (coordinate, distance) pairs from free text
- strict mode: use explicit coordinate/distance inputs for each circle
"""

import re
import time
import math
from typing import Any, Dict, List, Optional, Tuple


try:
    from gc_backend.blueprints.coordinates import detect_gps_coordinates, convert_ddm_to_decimal
except Exception:
    detect_gps_coordinates = None
    convert_ddm_to_decimal = None


class CoordinateIntersectionPlugin:
    """Plugin that computes circle-circle intersection on Earth's surface."""

    def __init__(self):
        self.name = "coordinate_intersection"
        self.version = "1.0.0"
        self.earth_radius_m = 6_371_000.0

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = str(inputs.get("text", "") or "")
        strict = str(inputs.get("strict", "smooth") or "smooth").lower() == "strict"
        enable_gps_detection = bool(inputs.get("enable_gps_detection", True))

        # Auto-switch to strict when text is empty but manual fields are present
        if not strict and not text.strip():
            has_coords = bool(inputs.get("coord1", "")) and bool(inputs.get("coord2", ""))
            has_dists = self._safe_float(inputs.get("dist1"), default=None) is not None and \
                        self._safe_float(inputs.get("dist2"), default=None) is not None
            if has_coords and has_dists:
                strict = True

        if strict:
            coord1_str = str(inputs.get("coord1", "") or "")
            coord2_str = str(inputs.get("coord2", "") or "")
            dist1 = self._safe_float(inputs.get("dist1"), default=None)
            dist2 = self._safe_float(inputs.get("dist2"), default=None)
            unit1 = str(inputs.get("dist1_unit", "km") or "km")
            unit2 = str(inputs.get("dist2_unit", "km") or "km")

            if not coord1_str or not coord2_str:
                return self._error_response(start_time, "Mode strict: les deux coordonnées sont requises")
            if dist1 is None or dist2 is None or dist1 <= 0 or dist2 <= 0:
                return self._error_response(start_time, "Mode strict: les deux distances doivent être fournies et positives")

            parsed1 = self._parse_coordinate(coord1_str)
            parsed2 = self._parse_coordinate(coord2_str)

            if parsed1 is None:
                return self._error_response(start_time, f"Impossible de parser la coordonnée P1: {coord1_str}")
            if parsed2 is None:
                return self._error_response(start_time, f"Impossible de parser la coordonnée P2: {coord2_str}")

            ddm1, lat1, lon1 = parsed1
            ddm2, lat2, lon2 = parsed2
            dist1_m = self._convert_to_meters(dist1, unit1)
            dist2_m = self._convert_to_meters(dist2, unit2)

        else:
            extracted = self._extract_two_circles(text)
            if extracted is None or len(extracted) < 2:
                return self._error_response(
                    start_time,
                    "Mode smooth: impossible de trouver deux paires (coordonnée, distance) dans le texte. "
                    "Format attendu: ex. '0.3125 km from GC12K94 (N49 38.254 W112 52.619)'",
                )

            lat1, lon1, dist1_m, ddm1 = extracted[0]
            lat2, lon2, dist2_m, ddm2 = extracted[1]

        intersections = self._intersect_circles(lat1, lon1, dist1_m, lat2, lon2, dist2_m)

        if intersections is None:
            dist_centers = self._haversine(lat1, lon1, lat2, lon2)
            sum_r = dist1_m + dist2_m
            diff_r = abs(dist1_m - dist2_m)
            if dist_centers > sum_r + 1.0:
                reason = (
                    f"Les cercles sont disjoints "
                    f"(distance entre centres: {dist_centers/1000:.3f} km, "
                    f"somme des rayons: {sum_r/1000:.3f} km)"
                )
            elif dist_centers < diff_r - 1.0:
                reason = (
                    f"Un cercle est entièrement contenu dans l'autre "
                    f"(distance entre centres: {dist_centers/1000:.3f} km, "
                    f"différence des rayons: {diff_r/1000:.3f} km)"
                )
            else:
                reason = "Pas d'intersection (erreur numérique)"
            return self._error_response(start_time, f"Pas d'intersection: {reason}")

        results = []
        for i, (ilat, ilon) in enumerate(intersections, start=1):
            formatted = self._decimal_to_gc_coordinates(ilat, ilon)
            dist_check1 = self._haversine(ilat, ilon, lat1, lon1)
            dist_check2 = self._haversine(ilat, ilon, lat2, lon2)
            log = (
                f"Point {i}/{len(intersections)}\n"
                f"Origine P1: {ddm1} | rayon: {dist1_m:.1f} m ({dist1_m/1000:.4f} km)\n"
                f"Origine P2: {ddm2} | rayon: {dist2_m:.1f} m ({dist2_m/1000:.4f} km)\n"
                f"Vérification distance vers P1: {dist_check1:.1f} m (attendu {dist1_m:.1f} m, écart {abs(dist_check1-dist1_m):.1f} m)\n"
                f"Vérification distance vers P2: {dist_check2:.1f} m (attendu {dist2_m:.1f} m, écart {abs(dist_check2-dist2_m):.1f} m)"
            )

            item: Dict[str, Any] = {
                "id": f"result_{i}",
                "text_output": formatted,
                "confidence": 1.0,
                "decimal_latitude": ilat,
                "decimal_longitude": ilon,
                "log": log,
                "parameters": {
                    "point_index": i,
                    "origin1_ddm": ddm1,
                    "origin1_lat": lat1,
                    "origin1_lon": lon1,
                    "dist1_m": dist1_m,
                    "origin2_ddm": ddm2,
                    "origin2_lat": lat2,
                    "origin2_lon": lon2,
                    "dist2_m": dist2_m,
                },
                "metadata": {},
            }

            if enable_gps_detection and detect_gps_coordinates is not None:
                detection = detect_gps_coordinates(formatted, include_numeric_only=False)
                if detection and detection.get("exist"):
                    item["metadata"]["gps_coordinates"] = detection

            results.append(item)

        count = len(results)
        summary = f"{count} point{'s' if count > 1 else ''} d'intersection trouvé{'s' if count > 1 else ''}"
        return self._ok_response(start_time, summary, results)

    # ------------------------------------------------------------------
    # Spherical geometry
    # ------------------------------------------------------------------

    def _intersect_circles(
        self,
        lat1: float, lon1: float, dist1_m: float,
        lat2: float, lon2: float, dist2_m: float,
    ) -> Optional[List[Tuple[float, float]]]:
        """Return the 0, 1 or 2 intersection points of two geodesic circles.

        Each circle is defined by its centre (lat/lon) and a radius in metres.
        Uses the ECEF unit-vector method:
          P = λ·c1 + μ·c2 ± ν·(c1×c2)
        where λ, μ are determined by the two plane equations P·ci = cos(ai),
        and ν² = (1 - |λ·c1+μ·c2|²) / |c1×c2|².
        """
        R = self.earth_radius_m
        c1 = self._latlon_to_unit_vector(lat1, lon1)
        c2 = self._latlon_to_unit_vector(lat2, lon2)

        a1 = dist1_m / R
        a2 = dist2_m / R

        cos_a1 = math.cos(a1)
        cos_a2 = math.cos(a2)

        dot = max(-1.0, min(1.0, self._dot(c1, c2)))
        sin2_d = 1.0 - dot * dot

        if sin2_d < 1e-14:
            return None

        lam = (cos_a1 - cos_a2 * dot) / sin2_d
        mu = (cos_a2 - cos_a1 * dot) / sin2_d

        base = [lam * c1[k] + mu * c2[k] for k in range(3)]
        base_sq = self._dot(base, base)

        nu2_times_cross_sq = 1.0 - base_sq

        if nu2_times_cross_sq < -1e-9:
            return None

        cross = self._cross(c1, c2)
        cross_sq = self._dot(cross, cross)

        if cross_sq < 1e-14:
            return None

        if nu2_times_cross_sq <= 1e-14:
            pt = self._normalize_vec(base)
            lat, lon = self._unit_vector_to_latlon(pt)
            return [(lat, lon)]

        nu = math.sqrt(nu2_times_cross_sq / cross_sq)

        pts: List[Tuple[float, float]] = []
        for sign in (+1.0, -1.0):
            p = [base[k] + sign * nu * cross[k] for k in range(3)]
            p_norm = self._normalize_vec(p)
            lat, lon = self._unit_vector_to_latlon(p_norm)
            pts.append((lat, lon))

        return pts

    def _latlon_to_unit_vector(self, lat_deg: float, lon_deg: float) -> List[float]:
        lat = math.radians(lat_deg)
        lon = math.radians(lon_deg)
        return [
            math.cos(lat) * math.cos(lon),
            math.cos(lat) * math.sin(lon),
            math.sin(lat),
        ]

    def _unit_vector_to_latlon(self, v: List[float]) -> Tuple[float, float]:
        lat = math.degrees(math.asin(max(-1.0, min(1.0, v[2]))))
        lon = math.degrees(math.atan2(v[1], v[0]))
        return lat, lon

    def _dot(self, a: List[float], b: List[float]) -> float:
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    def _cross(self, a: List[float], b: List[float]) -> List[float]:
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]

    def _normalize_vec(self, v: List[float]) -> List[float]:
        mag = math.sqrt(self._dot(v, v))
        if mag < 1e-14:
            return v
        return [x / mag for x in v]

    def _haversine(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = self.earth_radius_m
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
        )
        return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    # ------------------------------------------------------------------
    # Coordinate parsing
    # ------------------------------------------------------------------

    def _parse_coordinate(self, value: str) -> Optional[Tuple[str, float, float]]:
        """Return (ddm_string, decimal_lat, decimal_lon) or None."""
        if detect_gps_coordinates is not None:
            detection = detect_gps_coordinates(value, include_numeric_only=False)
            if detection and detection.get("exist"):
                ddm = detection.get("ddm")
                lat = detection.get("decimal_latitude")
                lon = detection.get("decimal_longitude")

                if lat is None or lon is None:
                    ddm_lat = detection.get("ddm_lat")
                    ddm_lon = detection.get("ddm_lon")
                    if convert_ddm_to_decimal is not None and ddm_lat and ddm_lon:
                        dec = convert_ddm_to_decimal(ddm_lat, ddm_lon)
                        lat = dec.get("latitude")
                        lon = dec.get("longitude")

                try:
                    return str(ddm), float(lat), float(lon)
                except Exception:
                    pass

        lat, lon = self._parse_gc_ddm(value)
        if lat is None or lon is None:
            return None
        ddm = self._decimal_to_gc_coordinates(lat, lon)
        return ddm, lat, lon

    def _parse_gc_ddm(self, coord_str: str) -> Tuple[Optional[float], Optional[float]]:
        """Parse Geocaching DDM format: N/S deg [°] min.dec E/W deg [°] min.dec.

        Handles optional degree symbol, optional spaces between components,
        and up to 3-digit minute integers (e.g. 052.619 = 52.619).
        """
        deg_sym = f"(?:{chr(176)}|{chr(186)}|{chr(194)}{chr(176)}|{chr(194)}{chr(186)})"
        pattern = (
            r"([NS])\s*(\d{1,2})\s*" + deg_sym + r"?\s+"
            r"(\d{1,3}(?:\.\d+)?)\s+"
            r"([EW])\s*(\d{1,3})\s*" + deg_sym + r"?\s+"
            r"(\d{1,3}(?:\.\d+)?)"
        )
        match = re.search(pattern, coord_str.strip(), re.IGNORECASE)
        if not match:
            return None, None

        ns, lat_deg_s, lat_min_s, ew, lon_deg_s, lon_min_s = match.groups()

        try:
            lat_deg = float(lat_deg_s)
            lat_min = float(lat_min_s)
            lon_deg = float(lon_deg_s)
            lon_min = float(lon_min_s)
        except Exception:
            return None, None

        if lat_min >= 60.0 or lon_min >= 60.0:
            return None, None

        lat = lat_deg + lat_min / 60.0
        lon = lon_deg + lon_min / 60.0
        if ns.upper() == "S":
            lat = -lat
        if ew.upper() == "W":
            lon = -lon

        return lat, lon

    # ------------------------------------------------------------------
    # Smooth-mode text extraction
    # ------------------------------------------------------------------

    def _extract_two_circles(self, text: str) -> Optional[List[Tuple[float, float, float, str]]]:
        """Extract up to two (lat, lon, dist_m, ddm) tuples from free text.

        Handles patterns like:
          "0.3125 km from GC12K94 (N49 38.254 W112 052.619)"
          "1.003 km from GC17DQP (N 49 38.643 W 112 51.891)"
          "se trouve à 500 m de N 48 12.000 E 002 20.000"
        """
        if not text:
            return None

        normalized = text.replace(",", ".")

        unit_pat = r"(km|k(?:ilo)?m(?:(?:è|e)tres?|eters?)?|miles?|m(?:(?:è|e)tres?|eters?)?)"

        results: List[Tuple[float, float, float, str]] = []

        # Pass 1 – distance/unit then coords in parentheses
        pattern_paren = (
            r"(\d+(?:\.\d+)?)\s*" + unit_pat +
            r"(?:\s+(?:from|de|away from|à|a)(?:\s+[A-Z]{2}\w+)?)?\s*\(([^)]+)\)"
        )
        for match in re.finditer(pattern_paren, normalized, re.IGNORECASE):
            dist_s, unit_s, coord_s = match.groups()
            parsed = self._parse_coordinate(coord_s.strip())
            if parsed is None:
                continue
            ddm, lat, lon = parsed
            dist_m = self._convert_to_meters(float(dist_s), self._normalize_unit(unit_s))
            results.append((lat, lon, dist_m, ddm))
            if len(results) == 2:
                return results

        if len(results) == 2:
            return results

        # Pass 2 – scan for coordinate patterns and search for a nearby distance before them
        deg_sym = f"(?:{chr(176)}|{chr(186)}|{chr(194)}{chr(176)}|{chr(194)}{chr(186)})"
        coord_scan = (
            r"[NS]\s*\d{1,2}\s*" + deg_sym + r"?\s+\d{1,3}(?:\.\d+)?\s+"
            r"[EW]\s*\d{1,3}\s*" + deg_sym + r"?\s+\d{1,3}(?:\.\d+)?"
        )
        for m in re.finditer(coord_scan, normalized, re.IGNORECASE):
            parsed = self._parse_coordinate(m.group(0))
            if parsed is None:
                continue
            ddm, lat, lon = parsed
            window = normalized[max(0, m.start() - 120): m.start()]
            dist_m_match = re.search(
                r"(\d+(?:\.\d+)?)\s*" + unit_pat + r"\s*$", window, re.IGNORECASE
            )
            if dist_m_match:
                dist_s, unit_s = dist_m_match.groups()
                dist_m = self._convert_to_meters(float(dist_s), self._normalize_unit(unit_s))
                results.append((lat, lon, dist_m, ddm))
            if len(results) == 2:
                return results

        return results if len(results) == 2 else None

    def _normalize_unit(self, unit_str: str) -> str:
        if not unit_str:
            return "m"
        u = unit_str.lower().strip()
        if "km" in u or "kilo" in u:
            return "km"
        if "mile" in u:
            return "miles"
        return "m"

    def _convert_to_meters(self, distance: float, unit: str) -> float:
        u = (unit or "m").lower().strip()
        if u == "km":
            return distance * 1000.0
        if u in {"mile", "miles"}:
            return distance * 1609.344
        return distance

    # ------------------------------------------------------------------
    # Formatting
    # ------------------------------------------------------------------

    def _decimal_to_gc_coordinates(self, lat: float, lon: float) -> str:
        lat_dir = "N" if lat >= 0 else "S"
        lon_dir = "E" if lon >= 0 else "W"
        lat_abs = abs(float(lat))
        lon_abs = abs(float(lon))
        lat_deg = int(lat_abs)
        lon_deg = int(lon_abs)
        lat_min = (lat_abs - lat_deg) * 60.0
        lon_min = (lon_abs - lon_deg) * 60.0
        return f"{lat_dir} {lat_deg}° {lat_min:.3f} {lon_dir} {lon_deg:03d}° {lon_min:.3f}"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _safe_float(self, value: Any, default: Optional[float]) -> Optional[float]:
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        try:
            raw = str(value).strip().replace(",", ".")
        except Exception:
            return default
        if not raw:
            return default
        m = re.search(r"[-+]?\d+(?:\.\d+)?", raw)
        if not m:
            return default
        try:
            return float(m.group(0))
        except Exception:
            return default

    def _ok_response(self, start_time: float, summary: str, results: list) -> Dict[str, Any]:
        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start_time) * 1000),
            },
        }

    def _error_response(self, start_time: float, message: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start_time) * 1000),
            },
        }


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Plugin entry point for the PluginManager."""
    plugin = CoordinateIntersectionPlugin()
    return plugin.execute(inputs)
