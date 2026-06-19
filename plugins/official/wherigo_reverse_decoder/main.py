from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple

try:
    from gc_backend.plugins.code_solving import parse_bool
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import parse_bool


class WherigoReverseDecoderPlugin:
    """Decode Wherigo Reverse three-number codes into geocaching coordinates."""

    def __init__(self) -> None:
        self.name = "wherigo_reverse_decoder"
        self.version = "1.0.1"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = str(inputs.get("text", "") or "").strip()
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        strict_mode = parse_bool(inputs.get("strict", True), default=True)
        embedded_mode = parse_bool(inputs.get("embedded", True), default=True)

        if not text:
            return self._error_response("Aucun texte fourni pour l'analyse.", start_time)

        try:
            if mode == "detect":
                check = self.check_code(text, strict=strict_mode, embedded=embedded_mode)
                summary = "Code Wherigo Reverse detecte" if check["is_match"] else "Aucun code Wherigo Reverse detecte"
                return self._success_response(
                    summary=summary,
                    text_output=f"{summary} (score: {check['score']:.2f})",
                    confidence=float(check["score"]),
                    parameters={"mode": mode, "strict": strict_mode, "embedded": embedded_mode},
                    metadata=check,
                    start_time=start_time,
                )

            if mode != "decode":
                return self._error_response(f"Mode inconnu: {mode}", start_time)

            fragments = self.find_fragments(text, strict_mode)
            if len(fragments) < 3:
                return self._error_response("Impossible de trouver trois nombres de 6 chiffres dans l'entree.", start_time)

            a, b, c = fragments[:3]
            latitude, longitude = self._decode_coordinates(a, b, c)
            formatted_coords = self._convert_to_wgs84(latitude, longitude)
            score = min(1.0, len(fragments) / 3.0)
            confidence = 1.0 if strict_mode else score

            return self._success_response(
                summary="Decodage Wherigo Reverse reussi",
                text_output=formatted_coords,
                confidence=confidence,
                parameters={"mode": "decode", "strict": strict_mode, "embedded": embedded_mode},
                metadata={
                    "fragments": fragments,
                    "score": score,
                    "latitude": latitude,
                    "longitude": longitude,
                },
                start_time=start_time,
            )
        except Exception as exc:
            return self._error_response(f"Erreur lors du decodage : {exc}", start_time)

    def find_fragments(self, text: str, strict: bool = True) -> List[str]:
        if strict:
            return re.findall(r"\b\d{6}\b", text)
        return re.findall(r"\d{6}", text)

    def check_code(
        self,
        text: str,
        strict: bool = True,
        allowed_chars: List[str] | None = None,
        embedded: bool = False,
    ) -> Dict[str, Any]:
        fragments = self.find_fragments(text, strict)

        if embedded:
            is_match = len(fragments) >= 3
            score = min(1.0, len(fragments) / 3.0) if is_match else 0.0
        elif strict:
            match = re.search(r"^\s*(\d{6})\s+(\d{6})\s+(\d{6})\s*$", text)
            is_match = bool(match)
            score = 1.0 if is_match else 0.0
        else:
            is_match = len(fragments) >= 3
            total_digits = sum(len(fragment) for fragment in fragments)
            total_chars = len("".join(ch for ch in text if ch.isdigit() or ch.isalpha()))
            score = total_digits / max(1, total_chars) if total_chars > 0 else 0.0

        return {
            "is_match": is_match,
            "fragments": fragments[:3] if len(fragments) >= 3 else fragments,
            "score": score,
            "allowed_chars": allowed_chars or [],
        }

    def decode_fragments(self, text: str, fragments: List[str]) -> str:
        if len(fragments) >= 3:
            a, b, c = fragments[:3]
            latitude, longitude = self._decode_coordinates(a, b, c)
            return self._convert_to_wgs84(latitude, longitude)
        return "Pas assez de fragments pour decoder"

    def _decode_coordinates(self, a: str, b: str, c: str) -> Tuple[float, float]:
        first = int(a)
        second = int(b)
        third = int(c)

        sign_map = {
            1: (1, 1),
            2: (-1, 1),
            3: (1, -1),
            4: (-1, -1),
        }
        lat_sign, lon_sign = sign_map.get((first % 1000 - first % 100) // 100, (0, 0))

        if lat_sign == 0 or lon_sign == 0:
            return 0.0, 0.0

        parity = ((third % 100000 - third % 10000) // 10000 + (third % 100 - third % 10) // 10) % 2
        if parity == 0:
            latitude = lat_sign * (
                (first % 10000 - first % 1000) / 100
                + (second % 100 - second % 10) / 10
                + (second % 100000 - second % 10000) / 100000
                + (third % 1000 - third % 100) / 10000
                + (first % 1000000 - first % 100000) / 100000000
                + (third % 100 - third % 10) / 100000
                + first % 10 * 1.0e-5
            )
            longitude = lon_sign * (
                (first % 100000 - first % 10000) / 100
                + (third % 1000000 - third % 100000) / 10000
                + third % 10
                + (second % 1000 - second % 100) / 1000
                + (second % 1000000 - second % 100000) / 10000000
                + (first % 100 - first % 10) / 10000
                + (third % 100000 - third % 10000) / 100000000
                + second % 10 * 1.0e-5
            )
        else:
            latitude = lat_sign * (
                (second % 1000000 - second % 100000) / 10000
                + first % 10
                + (first % 10000 - first % 1000) / 10000
                + (third % 1000000 - third % 100000) / 10000000
                + (third % 1000 - third % 100) / 100000
                + (third % 100 - third % 10) / 100000
                + (first % 1000000 - first % 100000) / 10000000000
            )
            longitude = lon_sign * (
                (second % 100 - second % 10) * 10
                + third % 10 * 10
                + (first % 100 - first % 10) / 10
                + (first % 100000 - first % 10000) / 100000
                + (second % 1000 - second % 100) / 10000
                + second % 10 * 0.001
                + (third % 100000 - third % 10000) / 100000000
                + (second % 100000 - second % 10000) / 1000000000
            )

        return latitude, longitude

    def _convert_to_wgs84(self, lat: float, lon: float) -> str:
        lat_deg = int(abs(lat))
        lat_min = (abs(lat) - lat_deg) * 60
        lon_deg = int(abs(lon))
        lon_min = (abs(lon) - lon_deg) * 60

        lat_hem = "N" if lat >= 0 else "S"
        lon_hem = "E" if lon >= 0 else "W"

        return f"{lat_hem} {lat_deg:02d} deg {lat_min:06.3f} {lon_hem} {lon_deg:03d} deg {lon_min:06.3f}"

    def _success_response(
        self,
        summary: str,
        text_output: str,
        confidence: float,
        parameters: Dict[str, Any],
        metadata: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": text_output,
                    "confidence": confidence,
                    "parameters": parameters,
                    "metadata": metadata,
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": round((time.time() - start_time) * 1000, 2),
        }


plugin = WherigoReverseDecoderPlugin()


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return plugin.execute(inputs)
