"""Official plugin: coordinate_centroid.

Calculates the geographic center of gravity (centroid) of N GPS coordinates.
Uses the spherical centroid method: converts each point to 3D Cartesian on
the unit sphere, averages the vectors, then converts back to lat/lon.

Reference: http://www.geomidpoint.com/calculation.html
           https://github.com/GCWizard/GCWizard (centroid_center_of_gravity)

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


class CoordinateCentroidPlugin:
    def __init__(self):
        self.name = "coordinate_centroid"
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
            return self._error(start, "Au moins 2 coordonnees sont requises pour calculer un centre de gravite.")

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

        centroid_lat, centroid_lon = self._spherical_centroid(parsed)

        centroid_coords = self._build_coords_dict(centroid_lat, centroid_lon)
        centroid_text = self._format_point_output(
            centroid_lat, centroid_lon, output_format,
            label="Centre de gravite", source_format="calculated",
        )

        results: List[Dict[str, Any]] = [{
            "id": "centroid",
            "text_output": centroid_text,
            "confidence": 1.0,
            "decimal_latitude": centroid_lat,
            "decimal_longitude": centroid_lon,
            "coordinates": centroid_coords,
            "parameters": {
                "label": "Centre de gravite",
                "source_format": "calculated",
                "method": "spherical_centroid",
            },
            "metadata": {
                "is_centroid": True,
                "input_point_count": len(parsed),
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
            "id": "centroid",
            "label": "Centre de gravite",
            "latitude": centroid_lat,
            "longitude": centroid_lon,
            "formatted": format_ddm(centroid_lat, centroid_lon),
            "is_centroid": True,
        })

        summary = (
            f"Centre de gravite de {len(parsed)} points: "
            f"{format_ddm(centroid_lat, centroid_lon)} "
            f"({centroid_lat:.6f}, {centroid_lon:.6f})"
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
        """Split input text into individual coordinate strings.

        Supports newlines and semicolons as separators.
        A single line containing a DDM pair (e.g. "N 48° 51.502 E 002° 17.669")
        is kept as one coordinate.
        """
        lines: List[str] = []
        for line in text.replace(";", "\n").split("\n"):
            stripped = line.strip()
            if stripped:
                lines.append(stripped)
        return lines

    @staticmethod
    def _spherical_centroid(coords: List[CanonicalCoordinate]) -> Tuple[float, float]:
        """Compute the spherical centroid (center of gravity) of N points.

        Converts each point to 3D Cartesian on the unit sphere, averages
        the vectors, then converts back to lat/lon.

        Reference: http://www.geomidpoint.com/calculation.html
        """
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

        centroid_lat = math.degrees(lat_rad)
        centroid_lon = math.degrees(lon_rad)

        return round(centroid_lat, 8), round(centroid_lon, 8)

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
