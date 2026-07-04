"""Official plugin: coordinate_intersect_circles.

Calculates intersection points between 2 or 3 circles defined by their
GPS center coordinates and radius in meters.

For 2 circles: returns 0, 1, or 2 intersection points.
For 3 circles: finds all pairwise intersections, then evaluates each
against the third circle to compute an accuracy score (difference between
the actual distance to the third center and the third radius). Results
are sorted by accuracy (best first).

Uses a local equirectangular projection for the planar circle-circle
intersection math, which is accurate enough for typical geocaching
distances (< ~500 km).

Reference: https://github.com/GCWizard/GCWizard (intersect_two_circles, intersect_three_circles)
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


class CoordinateIntersectCirclesPlugin:
    def __init__(self):
        self.name = "coordinate_intersect_circles"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start = time.time()

        source_format = str(inputs.get("source_format", "auto") or "auto")
        output_format = str(inputs.get("output_format", "geocaching") or "geocaching")

        centers_raw = []
        radii = []

        c1_raw = str(inputs.get("center1", "") or "").strip()
        r1 = self._safe_float(inputs.get("radius1"))
        if not c1_raw or r1 is None or r1 <= 0:
            return self._error(start, "Centre 1 et rayon 1 sont requis (rayon > 0).")
        centers_raw.append(c1_raw)
        radii.append(r1)

        c2_raw = str(inputs.get("center2", "") or "").strip()
        r2 = self._safe_float(inputs.get("radius2"))
        if not c2_raw or r2 is None or r2 <= 0:
            return self._error(start, "Centre 2 et rayon 2 sont requis (rayon > 0).")
        centers_raw.append(c2_raw)
        radii.append(r2)

        c3_raw = str(inputs.get("center3", "") or "").strip()
        r3 = self._safe_float(inputs.get("radius3"))
        has_third = bool(c3_raw)
        if has_third:
            if r3 is None or r3 <= 0:
                return self._error(start, "Rayon 3 doit etre > 0 si le centre 3 est fourni.")
            centers_raw.append(c3_raw)
            radii.append(r3)

        centers: List[Tuple[float, float]] = []
        for i, raw in enumerate(centers_raw, 1):
            try:
                coord = parse_coordinate(raw, source_format)
                centers.append((coord.latitude, coord.longitude))
            except CoordinateConversionError as exc:
                return self._error(start, f"Centre {i} ('{raw}'): {exc}")
            except Exception as exc:
                return self._error(start, f"Centre {i} ('{raw}'): erreur de parsing - {exc}")

        if has_third:
            intersections = self._intersect_three_circles(
                centers[0], radii[0],
                centers[1], radii[1],
                centers[2], radii[2],
            )
            mode_label = "3 cercles"
        else:
            intersections = self._intersect_two_circles(
                centers[0], radii[0],
                centers[1], radii[1],
            )
            mode_label = "2 cercles"

        if not intersections:
            return self._error(
                start,
                f"Aucune intersection trouvee ({mode_label}). Les cercles ne se croisent pas "
                f"(trop eloignes ou l'un est contenu dans l'autre).",
            )

        results: List[Dict[str, Any]] = []
        map_points: List[Dict[str, Any]] = []

        for i, (lat, lon, accuracy) in enumerate(intersections, 1):
            coords_dict = self._build_coords_dict(lat, lon)
            if accuracy is not None:
                label = f"Intersection {i}"
                text = self._format_point_output(
                    lat, lon, output_format,
                    label=label,
                    extra_info=f"  Precision: {accuracy:.1f} m",
                )
            else:
                label = f"Intersection {i}"
                text = self._format_point_output(
                    lat, lon, output_format,
                    label=label,
                )

            results.append({
                "id": f"intersection_{i}",
                "text_output": text,
                "confidence": 1.0,
                "decimal_latitude": lat,
                "decimal_longitude": lon,
                "coordinates": coords_dict,
                "parameters": {
                    "label": label,
                    "accuracy_m": accuracy,
                },
                "metadata": {
                    "is_intersection": True,
                    "accuracy_m": accuracy,
                    "rank": i,
                },
            })

            map_points.append({
                "id": f"intersection_{i}",
                "label": label,
                "latitude": lat,
                "longitude": lon,
                "formatted": format_ddm(lat, lon),
                "is_centroid": False,
                "is_intersection": True,
            })

        for i, (clat, clon) in enumerate(centers, 1):
            map_points.append({
                "id": f"center_{i}",
                "label": f"Centre {i}",
                "latitude": clat,
                "longitude": clon,
                "formatted": format_ddm(clat, clon),
                "is_centroid": False,
                "is_intersection": False,
                "circle_radius_m": radii[i - 1],
            })

        if results:
            best = results[0]
            primary_coords = best["coordinates"]
        else:
            primary_coords = None

        if has_third:
            summary = (
                f"Intersection de 3 cercles: {len(intersections)} point(s) trouve(s). "
                f"Meilleur: {format_ddm(intersections[0][0], intersections[0][1])}"
            )
        else:
            summary = (
                f"Intersection de 2 cercles: {len(intersections)} point(s) trouve(s)."
            )

        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "primary_coordinates": primary_coords,
            "map_points": map_points,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start) * 1000),
            },
        }

    @staticmethod
    def _intersect_two_circles(
        c1: Tuple[float, float], r1: float,
        c2: Tuple[float, float], r2: float,
    ) -> List[Tuple[float, float, Optional[float]]]:
        """Intersect two circles on the Earth surface.

        Uses a local equirectangular projection centered on the midpoint
        between the two centers, solves the 2D circle-circle intersection,
        then converts back to lat/lon.

        Returns list of (lat, lon, accuracy) where accuracy is None for 2-circle mode.
        """
        lat1, lon1 = c1
        lat2, lon2 = c2

        mid_lat = (lat1 + lat2) / 2.0
        mid_lon = (lon1 + lon2) / 2.0

        x1, y1 = CoordinateIntersectCirclesPlugin._to_local(mid_lat, mid_lon, lat1, lon1)
        x2, y2 = CoordinateIntersectCirclesPlugin._to_local(mid_lat, mid_lon, lat2, lon2)

        d = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

        if d > r1 + r2:
            return []
        if d < abs(r1 - r2):
            return []
        if d == 0 and r1 == r2:
            return []

        a = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d)
        h_sq = r1 * r1 - a * a
        if h_sq < 0:
            h_sq = 0.0
        h = math.sqrt(h_sq)

        dx = x2 - x1
        dy = y2 - y1
        px = x1 + a * dx / d
        py = y1 + a * dy / d

        if h == 0:
            lat, lon = CoordinateIntersectCirclesPlugin._from_local(mid_lat, mid_lon, px, py)
            return [(lat, lon, None)]

        ix1 = px + h * dy / d
        iy1 = py - h * dx / d
        ix2 = px - h * dy / d
        iy2 = py + h * dx / d

        lat1, lon1 = CoordinateIntersectCirclesPlugin._from_local(mid_lat, mid_lon, ix1, iy1)
        lat2, lon2 = CoordinateIntersectCirclesPlugin._from_local(mid_lat, mid_lon, ix2, iy2)

        return [(lat1, lon1, None), (lat2, lon2, None)]

    @staticmethod
    def _intersect_three_circles(
        c1: Tuple[float, float], r1: float,
        c2: Tuple[float, float], r2: float,
        c3: Tuple[float, float], r3: float,
    ) -> List[Tuple[float, float, Optional[float]]]:
        """Intersect three circles.

        Finds all pairwise intersections of (c1,r1)-(c2,r2), (c1,r1)-(c3,r3),
        and (c2,r2)-(c3,r3). For each intersection point, computes accuracy as
        |distance_to_third_center - third_radius|.

        Results are sorted by accuracy (best first), deduplicated.

        Reference: https://github.com/GCWizard/GCWizard (intersect_three_circles)
        """
        pairs = [
            (c1, r1, c2, r2, c3, r3),
            (c1, r1, c3, r3, c2, r2),
            (c2, r2, c3, r3, c1, r1),
        ]

        all_intersections: List[Tuple[float, float, float]] = []

        for ca, ra, cb, rb, cc, rc in pairs:
            pairwise = CoordinateIntersectCirclesPlugin._intersect_two_circles(ca, ra, cb, rb)
            for lat, lon, _ in pairwise:
                dist_to_cc = CoordinateIntersectCirclesPlugin._haversine_meters(
                    lat, lon, cc[0], cc[1],
                )
                accuracy = abs(dist_to_cc - rc)
                all_intersections.append((lat, lon, accuracy))

        all_intersections.sort(key=lambda x: x[2])

        deduped: List[Tuple[float, float, float]] = []
        for lat, lon, acc in all_intersections:
            is_dup = False
            for dlat, dlon, _ in deduped:
                if abs(lat - dlat) < 1e-7 and abs(lon - dlon) < 1e-7:
                    is_dup = True
                    break
            if not is_dup:
                deduped.append((lat, lon, acc))

        return [(lat, lon, acc) for lat, lon, acc in deduped]

    @staticmethod
    def _to_local(
        ref_lat: float, ref_lon: float, lat: float, lon: float,
    ) -> Tuple[float, float]:
        """Convert lat/lon to local equirectangular planar coordinates (meters).

        X = east, Y = north from the reference point.
        """
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
        lat: float, lon: float, output_format: str, label: str, extra_info: str = "",
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

        if extra_info:
            lines.append(extra_info)

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
