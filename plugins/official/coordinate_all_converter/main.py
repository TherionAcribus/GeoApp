"""Official plugin: coordinate_all_converter."""

import time
from typing import Any, Dict, Optional

from gc_backend.utils.coordinate_converters import (
    CoordinateConversionError,
    build_code_formats,
    build_grid_formats,
    build_latlon_formats,
    build_special_formats,
    normalize_format,
    parse_coordinate,
)


class CoordinateAllConverterPlugin:
    def __init__(self):
        self.name = "coordinate_all_converter"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start = time.time()
        try:
            precision = int(inputs.get("precision", 6) or 6)
            geohash_precision = int(inputs.get("geohash_precision", 9) or 9)
            special_precision = int(inputs.get("special_precision", 10) or 10)
            zoom = int(inputs.get("zoom", 15) or 15)
            target_format = normalize_format(str(inputs.get("target_format", "all") or "all"))

            coord = parse_coordinate(
                str(inputs.get("input_text", "") or inputs.get("text", "")),
                str(inputs.get("source_format", "auto") or "auto"),
                self._optional_float(inputs.get("reference_latitude")),
                self._optional_float(inputs.get("reference_longitude")),
            )

            sections: Dict[str, Any] = {
                "latlon": build_latlon_formats(coord.latitude, coord.longitude, precision),
            }
            warnings = list(coord.warnings)

            for section_name, builder in (
                ("grid", lambda: build_grid_formats(coord.latitude, coord.longitude)),
                (
                    "code",
                    lambda: build_code_formats(
                        coord.latitude,
                        coord.longitude,
                        geohash_precision,
                        10,
                        str(inputs.get("mapcode_territory", "") or "") or None,
                    ),
                ),
                ("special", lambda: build_special_formats(coord.latitude, coord.longitude, special_precision, zoom)),
            ):
                try:
                    sections[section_name] = builder()
                except Exception as exc:
                    sections[section_name] = {}
                    warnings.append(f"{section_name}: {exc}")

            flattened = self._flatten_formats(sections)
            flattened["geocaching"] = sections["latlon"]["ddm"]

            if target_format != "all":
                selected = self._select_format(flattened, target_format)
                text_output = selected
                output_formats: Dict[str, Any] = {target_format: selected}
            else:
                text_output = self._format_sections(sections)
                output_formats = flattened

            item = {
                "id": "result_1",
                "text_output": text_output,
                "confidence": 1.0,
                "decimal_latitude": coord.latitude,
                "decimal_longitude": coord.longitude,
                "coordinates": coord.to_coordinates_dict(),
                "formats": output_formats,
                "sections": sections,
                "bbox": coord.bbox,
                "warnings": warnings,
                "parameters": {
                    "source_format": coord.source_format,
                    "target_format": target_format,
                },
            }
            return self._ok(start, "Conversion coordonnee complete terminee", [item])
        except CoordinateConversionError as exc:
            return self._error(start, str(exc))
        except Exception as exc:
            return self._error(start, f"Erreur inattendue: {exc}")

    def _optional_float(self, value: Any) -> Optional[float]:
        if value in (None, ""):
            return None
        return float(value)

    def _flatten_formats(self, sections: Dict[str, Any]) -> Dict[str, Any]:
        flattened: Dict[str, Any] = {}
        for values in sections.values():
            if isinstance(values, dict):
                flattened.update(values)
        return flattened

    def _select_format(self, formats: Dict[str, Any], target: str) -> str:
        key = "ddm" if target in {"geocaching", "gc"} else target
        if key not in formats:
            raise CoordinateConversionError(f"Format cible non supporte: {target}")
        value = formats[key]
        if isinstance(value, list):
            if not value:
                return ""
            first = value[0]
            return str(first.get("formatted", first)) if isinstance(first, dict) else str(first)
        return str(value)

    def _format_sections(self, sections: Dict[str, Any]) -> str:
        lines = []
        for section_name in ("latlon", "grid", "code", "special"):
            values = sections.get(section_name) or {}
            if not values:
                continue
            lines.append(f"[{section_name}]")
            for name, value in values.items():
                if isinstance(value, list):
                    value = value[0].get("formatted", value[0]) if value and isinstance(value[0], dict) else value
                lines.append(f"{name}: {value}")
        return "\n".join(lines)

    def _ok(self, start: float, summary: str, results: list) -> Dict[str, Any]:
        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "primary_coordinates": results[0].get("coordinates") if results else None,
            "plugin_info": self._plugin_info(start),
        }

    def _error(self, start: float, summary: str) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": summary,
            "results": [],
            "plugin_info": self._plugin_info(start),
        }

    def _plugin_info(self, start: float) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": int((time.time() - start) * 1000),
        }


plugin = CoordinateAllConverterPlugin()


def execute(inputs):
    return plugin.execute(inputs)
