"""Official plugin: coordinate_arithmetic_centroid.

Calculates the arithmetic mean centroid of N GPS coordinates.
Uses simple averaging of latitudes and longitudes, with longitude
normalization near the antimeridian based on the spherical centroid.

Reference: http://www.geomidpoint.com/calculation.html
           https://github.com/GCWizard/GCWizard (centroid_arithmetic_mean)

Supports auto-detection of the input coordinate format via the shared
coordinate_converters module (DD, DDM, DMS, UTM, MGRS, geohash, plus_code, etc.).
"""

import math
import time
from typing import Any, Dict, List, Tuple

from gc_backend.utils.coordinate_converters import (
    CanonicalCoordinate,
    CoordinateConversionError,
    parse_coordinate,
)
from gc_backend.utils.coordinate_formatting import (
    build_latlon_formats,
    format_dd,
    format_ddm,
    format_ddm_component,
    format_dms,
)


class CoordinateArithmeticCentroidPlugin:
    def __init__(self):
        self.name = "coordinate_arithmetic_centroid"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start = time.time()

        raw_text = str(inputs.get("coordinates", "") or "").strip()
        source_format = str(inputs.get("source_format", "auto") or "auto")
        output_format = str(inputs.get("output_format", "geocaching") or "geocaching")

        if not raw_text:
            return self._error(start, "Aucune coordonnee fournie. Saisissez une coordonnee par ligne.")

        raw_lines = self._split_coordinates(raw_text)
        if len(raw_lines) < 2:
            return self._error(start, "Au moins 2 coordonnees sont requises pour calculer un centre arithmetique.")

        parsed: List[CanonicalCoordinate] = []
        errors: List[str] = []

        for i, raw in enumerate(raw_lines, 1):
            try:
                coord = parse_coordinate(raw, source_format)
                parsed.append(coord)
            except CoordinateConversionError as exc:
                errors.append(f"Coordonnee {i} ('{raw}'): {exc}")
            except Exception as exc:
                errors.append(f"Coordonnee {i} ('{raw}'): erreur de parsing - {exc}")

        if errors:
            return self._error(start, "; ".join(errors))

        if len(parsed) < 2:
            return self._error(start, "Au moins 2 coordonnees valides sont requises.")

        cg_lat, cg_lon = self._spherical_centroid(parsed)
        arith_lat, arith_lon = self._arithmetic_mean(parsed, cg_lon)

        centroid_coords = self._build_coords_dict(arith_lat, arith_lon)
        centroid_text = self._format_point_output(
            arith_lat, arith_lon, output_format,
            label="Centre arithmetique", source_format="calculated",
        )

        results: List[Dict[str, Any]] = [{
            "id": "arithmetic_centroid",
            "text_output": centroid_text,
            "confidence": 1.0,
            "decimal_latitude": arith_lat,
            "decimal_longitude": arith_lon,
            "coordinates": centroid_coords,
            "parameters": {
                "label": "Centre arithmetique",
                "source_format": "calculated",
                "method": "arithmetic_mean",
            },
            "metadata": {
                "is_centroid": True,
                "input_point_count": len(parsed),
                "spherical_centroid": {"lat": cg_lat, "lon": cg_lon},
            },
        }]

        map_points: List[Dict[str, Any]] = []
        for i, coord in enumerate(parsed, 1):
            map_points.append({
                "id": f"input_{i}",
                "label": f"Point {i}",
                "latitude": coord.latitude,
                "longitude": coord.longitude,
                "formatted": format_ddm(coord.latitude, coord.longitude),
                "is_centroid": False,
            })
        map_points.append({
            "id": "arithmetic_centroid",
            "label": "Centre arithmetique",
            "latitude": arith_lat,
            "longitude": arith_lon,
            "formatted": format_ddm(arith_lat, arith_lon),
            "is_centroid": True,
        })

        summary = (
            f"Centre arithmetique de {len(parsed)} points: "
            f"{format_ddm(arith_lat, arith_lon)} "
            f"({arith_lat:.6f}, {arith_lon:.6f})"
        )

        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "primary_coordinates": centroid_coords,
            "map_points": map_points,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start) * 1000),
            },
        }

    @staticmethod
    def _split_coordinates(text: str) -> List[str]:
        lines: List[str] = []
        for line in text.replace(";", "\n").split("\n"):
            stripped = line.strip()
            if stripped:
                lines.append(stripped)
        return lines

    @staticmethod
    def _spherical_centroid(coords: List[CanonicalCoordinate]) -> Tuple[float, float]:
        """Compute the spherical centroid (used as reference for longitude wrapping)."""
        x_sum = y_sum = z_sum = 0.0

        for coord in coords:
            lat_rad = math.radians(coord.latitude)
            lon_rad = math.radians(coord.longitude)
            x_sum += math.cos(lat_rad) * math.cos(lon_rad)
            y_sum += math.cos(lat_rad) * math.sin(lon_rad)
            z_sum += math.sin(lat_rad)

        n = len(coords)
        x_avg = x_sum / n
        y_avg = y_sum / n
        z_avg = z_sum / n

        lon_rad = math.atan2(y_avg, x_avg)
        hyp = math.sqrt(x_avg * x_avg + y_avg * y_avg)
        lat_rad = math.atan2(z_avg, hyp)

        return math.degrees(lat_rad), math.degrees(lon_rad)

    @staticmethod
    def _arithmetic_mean(coords: List[CanonicalCoordinate], ref_lon: float) -> Tuple[float, float]:
        """Compute the arithmetic mean of latitudes and longitudes.

        Longitudes are normalized relative to the spherical centroid's longitude
        to handle antimeridian wrapping, following the GCWizard approach.

        Reference: http://www.geomidpoint.com/calculation.html
        """
        lat_sum = 0.0
        lon_sum = 0.0

        for coord in coords:
            lon = coord.longitude
            if lon + ref_lon < -180.0:
                lon += 360.0
            elif lon + ref_lon > 180.0:
                lon -= 360.0

            lat_sum += coord.latitude
            lon_sum += lon

        n = len(coords)
        mean_lat = lat_sum / n
        mean_lon = lon_sum / n

        mean_lon = ((mean_lon + 180.0) % 360.0) - 180.0

        return round(mean_lat, 8), round(mean_lon, 8)

    @staticmethod
    def _build_coords_dict(lat: float, lon: float) -> Dict[str, Any]:
        return {
            "exist": True,
            "ddm": format_ddm(lat, lon),
            "ddm_lat": format_ddm_component(lat, True),
            "ddm_lon": format_ddm_component(lon, False),
            "decimal": {"lat": lat, "lon": lon},
            "decimal_latitude": lat,
            "decimal_longitude": lon,
            "raw": [],
            "source_format": "calculated",
            "formatted": format_ddm(lat, lon),
            "confidence": 1.0,
        }

    @staticmethod
    def _format_point_output(
        lat: float, lon: float, output_format: str, label: str, source_format: str = "",
    ) -> str:
        lines = [f"[{label}]"]

        if output_format == "all":
            formats = build_latlon_formats(lat, lon)
            lines.append(f"  DD:  {formats['dd']}")
            lines.append(f"  DDM: {formats['ddm']}")
            lines.append(f"  DMS: {formats['dms']}")
        elif output_format == "dd":
            lines.append(f"  {format_dd(lat, lon)}")
        elif output_format == "dms":
            lines.append(f"  {format_dms(lat, lon)}")
        else:
            lines.append(f"  {format_ddm(lat, lon)}")

        if source_format:
            lines.append(f"  Format source: {source_format}")

        return "\n".join(lines)

    def _error(self, start: float, summary: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": summary,
            "results": [],
            "primary_coordinates": None,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start) * 1000),
            },
        }
