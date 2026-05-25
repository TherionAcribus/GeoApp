from typing import Any, Dict, List, Optional, Tuple

from loguru import logger


try:
    from gc_backend.blueprints.coordinates import detect_gps_coordinates
except ImportError:
    logger.warning("Import direct de detect_gps_coordinates impossible")
    detect_gps_coordinates = None

try:
    from gc_backend.utils.coordinate_converters import (
        CanonicalCoordinate,
        CoordinateConversionError,
        find_coordinate_candidates,
    )
except Exception:
    CanonicalCoordinate = None
    CoordinateConversionError = Exception
    find_coordinate_candidates = None


class CoordinatesFinderPlugin:
    def __init__(self):
        self.name = "coordinates_finder"
        self.description = "Recherche de coordonnees GPS dans le texte"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        text = inputs.get("text", "")
        max_results = self._safe_int(inputs.get("max_results"), default=20)

        if not text:
            return {
                "status": "success",
                "summary": "Aucun texte fourni",
                "results": [],
                "primary_coordinates": None,
            }

        clean_text = self._clean_text(str(text))
        results: List[Dict[str, Any]] = []
        seen: set[Tuple[Optional[str], Optional[float], Optional[float]]] = set()

        if detect_gps_coordinates:
            detection = detect_gps_coordinates(clean_text)
            if detection and detection.get("exist"):
                self._append_result(results, seen, detection, len(results) + 1, "legacy")

        if find_coordinate_candidates is not None:
            try:
                candidates = find_coordinate_candidates(clean_text, max_results=max_results)
                for candidate in candidates:
                    coordinates = candidate.to_coordinates_dict()
                    metadata = {
                        "source_format": candidate.source_format,
                        "bbox": candidate.bbox,
                        "source_formatted": coordinates.get("source_formatted"),
                    }
                    self._append_result(results, seen, coordinates, len(results) + 1, "converter", metadata)
                    if len(results) >= max_results:
                        break
            except CoordinateConversionError:
                pass
            except Exception as exc:
                logger.debug(f"Detection coordinate_converters ignoree: {exc}")

        return {
            "status": "success",
            "summary": f"{len(results)} coordonnee(s) trouvee(s)",
            "results": results,
            "primary_coordinates": results[0]["coordinates"] if results else None,
        }

    def _append_result(
        self,
        results: List[Dict[str, Any]],
        seen: set,
        coordinates: Dict[str, Any],
        index: int,
        source: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        key = self._coord_key(coordinates)
        if key in seen:
            return
        seen.add(key)

        formatted = coordinates.get("formatted") or coordinates.get("ddm") or coordinates.get("coordinates_raw") or ""
        result = {
            "id": f"coord_{index}",
            "text_output": f"Coordonnees detectees : {formatted}",
            "confidence": coordinates.get("confidence", 0.85),
            "coordinates": coordinates,
            "decimal_latitude": coordinates.get("decimal_latitude"),
            "decimal_longitude": coordinates.get("decimal_longitude"),
            "metadata": {
                "detector": source,
                **(metadata or {}),
            },
        }
        results.append(result)

    def _coord_key(self, coordinates: Dict[str, Any]) -> Tuple[Optional[str], Optional[float], Optional[float]]:
        lat = coordinates.get("decimal_latitude")
        lon = coordinates.get("decimal_longitude")
        if lat is None or lon is None:
            decimal = coordinates.get("decimal") or {}
            lat = decimal.get("lat") or decimal.get("latitude")
            lon = decimal.get("lon") or decimal.get("longitude")
        try:
            lat = round(float(lat), 5)
            lon = round(float(lon), 5)
        except (TypeError, ValueError):
            lat = None
            lon = None
        return ("coordinate", lat, lon)

    def _clean_text(self, text: str) -> str:
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(text, "html.parser")
            return soup.get_text(separator=" ", strip=True)
        except Exception:
            return text

    def _safe_int(self, value: Any, default: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(1, min(100, parsed))


plugin = CoordinatesFinderPlugin()


def execute(inputs):
    return plugin.execute(inputs)
