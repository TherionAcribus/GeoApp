"""Official plugin: coordinate_code_converter."""

import time
from typing import Any, Dict, Optional

from gc_backend.utils.coordinate_converters import (
    CoordinateConversionError,
    convert_to_code,
)


class CoordinateCodeConverterPlugin:
    def __init__(self):
        self.name = "coordinate_code_converter"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start = time.time()
        try:
            reference_latitude = self._optional_float(inputs.get("reference_latitude"))
            reference_longitude = self._optional_float(inputs.get("reference_longitude"))
            payload = convert_to_code(
                input_text=str(inputs.get("input_text", "") or inputs.get("text", "")),
                source_format=str(inputs.get("source_format", "auto") or "auto"),
                target_format=str(inputs.get("target_format", "all") or "all"),
                reference_latitude=reference_latitude,
                reference_longitude=reference_longitude,
                precision=int(inputs.get("precision", 9) or 9),
                mapcode_territory=str(inputs.get("mapcode_territory", "") or "") or None,
            )
            item = {
                "id": "result_1",
                "text_output": payload["text_output"],
                "confidence": 1.0,
                "decimal_latitude": payload["decimal_latitude"],
                "decimal_longitude": payload["decimal_longitude"],
                "coordinates": payload["coordinates"],
                "formats": payload["formats"],
                "bbox": payload.get("bbox"),
                "parameters": {
                    "source_format": payload["source_format"],
                    "target_format": payload["target_format"],
                },
            }
            return self._ok(start, "Conversion de code terminée", [item])
        except CoordinateConversionError as exc:
            return self._error(start, str(exc))
        except Exception as exc:
            return self._error(start, f"Erreur inattendue: {exc}")

    def _optional_float(self, value: Any) -> Optional[float]:
        if value in (None, ""):
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed

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


plugin = CoordinateCodeConverterPlugin()


def execute(inputs):
    return plugin.execute(inputs)
