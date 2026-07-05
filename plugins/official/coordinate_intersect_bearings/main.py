"""Official plugin: coordinate_intersect_bearings.

Calculates the intersection point of two lines, each defined by a GPS
starting point and a bearing (azimuth from North in degrees).

Uses a local equirectangular projection: both points are converted to
planar coordinates, each bearing defines a ray, and the 2D line-line
intersection is computed. The result is converted back to lat/lon.

For typical geocaching distances this approach is accurate enough.
For very long distances the geodesic approach (Karney) would be needed,
but that requires a complex library.

Reference: https://github.com/GCWizard/GCWizard (intersect_bearings)
           http://www.geomidpoint.com/calculation.html
"""

import math
import time
from typing import Any, Dict, List, Optional, Tuple

from gc_backend.utils.coordinate_converters import (
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

EARTH_RADIUS_M = 6_371_000.0


class CoordinateIntersectBearingsPlugin:
    def __init__(self):
        self.name = "coordinate_intersect_bearings"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start = time.time()

        source_format = str(inputs.get("source_format", "auto") or "auto")
        output_format = str(inputs.get("output_format", "geocaching") or "geocaching")

        coord1_raw = str(inputs.get("coord1", "") or "").strip()
        bearing1 = self._safe_float(inputs.get("bearing1"))
        coord2_raw = str(inputs.get("coord2", "") or "").strip()
        bearing2 = self._safe_float(inputs.get("bearing2"))

        if not coord1_raw:
            return self._error(start, "Point de depart 1 est requis.")
        if bearing1 is None or bearing1 < 0 or bearing1 > 360:
            return self._error(start, "Azimut 1 doit etre entre 0 et 360 degres.")
        if not coord2_raw:
            return self._error(start, "Point de depart 2 est requis.")
        if bearing2 is None or bearing2 < 0 or bearing2 > 360:
            return self._error(start, "Azimut 2 doit etre entre 0 et 360 degres.")

        points: List[Tuple[float, float]] = []
        for i, raw in enumerate([coord1_raw, coord2_raw], 1):
            try:
                coord = parse_coordinate(raw, source_format)
                points.append((coord.latitude, coord.longitude))
            except CoordinateConversionError as exc:
                return self._error(start, f"Point {i} ('{raw}'): {exc}")
            except Exception as exc:
                return self._error(start, f"Point {i} ('{raw}'): erreur de parsing - {exc}")

        lat1, lon1 = points[0]
        lat2, lon2 = points[1]

        result_lat, result_lon = self._intersect_bearings(lat1, lon1, bearing1, lat2, lon2, bearing2)

        if result_lat is None:
            return self._error(
                start,
                "Les deux lignes sont paralleles (azimuts identiques ou opposes). Aucune intersection.",
            )

        coords_dict = self._build_coords_dict(result_lat, result_lon)
        text = self._format_point_output(
            result_lat, result_lon, output_format,
            label="Point d'intersection",
        )

        results: List[Dict[str, Any]] = [{
            "id": "intersection",
            "text_output": text,
            "confidence": 1.0,
            "decimal_latitude": result_lat,
            "decimal_longitude": result_lon,
            "coordinates": coords_dict,
            "parameters": {
                "label": "Point d'intersection",
                "method": "bearing_intersection",
            },
            "metadata": {
                "is_intersection": True,
                "bearing1": bearing1,
                "bearing2": bearing2,
            },
        }]

        map_points: List[Dict[str, Any]] = [
            {
                "id": "start_1",
                "label": f"Point 1 (bearing {bearing1}°)",
                "latitude": lat1,
                "longitude": lon1,
                "formatted": format_ddm(lat1, lon1),
                "is_intersection": False,
                "bearing_deg": bearing1,
            },
            {
                "id": "start_2",
                "label": f"Point 2 (bearing {bearing2}°)",
                "latitude": lat2,
                "longitude": lon2,
                "formatted": format_ddm(lat2, lon2),
                "is_intersection": False,
                "bearing_deg": bearing2,
            },
            {
                "id": "intersection",
                "label": "Intersection",
                "latitude": result_lat,
                "longitude": result_lon,
                "formatted": format_ddm(result_lat, result_lon),
                "is_intersection": True,
            },
        ]

        dist1 = self._haversine_meters(lat1, lon1, result_lat, result_lon)
        dist2 = self._haversine_meters(lat2, lon2, result_lat, result_lon)

        summary = (
            f"Intersection des bearings: {format_ddm(result_lat, result_lon)} "
            f"({result_lat:.6f}, {result_lon:.6f}) "
            f"| dist1={dist1:.0f}m, dist2={dist2:.0f}m"
        )

        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "primary_coordinates": coords_dict,
            "map_points": map_points,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start) * 1000),
            },
        }

    @staticmethod
    def _intersect_bearings(
        lat1: float, lon1: float, bearing1: float,
        lat2: float, lon2: float, bearing2: float,
    ) -> Tuple[Optional[float], Optional[float]]:
        """Find the intersection of two lines defined by point + bearing.

        Uses a local equirectangular projection centered on the midpoint
        of the two starting points. Each bearing defines a direction vector
        in the local plane. The 2D line-line intersection is then computed.

        Returns (lat, lon) or (None, None) if lines are parallel.
        """
        mid_lat = (lat1 + lat2) / 2.0
        mid_lon = (lon1 + lon2) / 2.0

        x1, y1 = CoordinateIntersectBearingsPlugin._to_local(mid_lat, mid_lon, lat1, lon1)
        x2, y2 = CoordinateIntersectBearingsPlugin._to_local(mid_lat, mid_lon, lat2, lon2)

        dx1 = math.sin(math.radians(bearing1))
        dy1 = math.cos(math.radians(bearing1))

        dx2 = math.sin(math.radians(bearing2))
        dy2 = math.cos(math.radians(bearing2))

        denom = dx1 * dy2 - dx2 * dy1

        if abs(denom) < 1e-12:
            return None, None

        t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / denom

        ix = x1 + t * dx1
        iy = y1 + t * dy1

        return CoordinateIntersectBearingsPlugin._from_local(mid_lat, mid_lon, ix, iy)

    @staticmethod
    def _to_local(
        ref_lat: float, ref_lon: float, lat: float, lon: float,
    ) -> Tuple[float, float]:
        """Convert lat/lon to local equirectangular planar coordinates (meters)."""
        lat_rad = math.radians(ref_lat)
        x = math.radians(lon - ref_lon) * math.cos(lat_rad) * EARTH_RADIUS_M
        y = math.radians(lat - ref_lat) * EARTH_RADIUS_M
        return x, y

    @staticmethod
    def _from_local(
        ref_lat: float, ref_lon: float, x: float, y: float,
    ) -> Tuple[float, float]:
        """Convert local planar coordinates back to lat/lon."""
        lat_rad = math.radians(ref_lat)
        lat = ref_lat + math.degrees(y / EARTH_RADIUS_M)
        lon = ref_lon + math.degrees(x / (EARTH_RADIUS_M * math.cos(lat_rad)))
        return round(lat, 8), round(lon, 8)

    @staticmethod
    def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Great-circle distance in meters (Haversine)."""
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        dlat = lat2_rad - lat1_rad
        dlon = math.radians(lon2 - lon1)

        a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return EARTH_RADIUS_M * c

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
        lat: float, lon: float, output_format: str, label: str,
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

        return "\n".join(lines)

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

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
