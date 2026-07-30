"""Plugin PLANET Barcode pour MysterAI.

Ce plugin encode/décode le code-barres PLANET (Postal Alpha Numeric Encoding
Technique), utilisé par l'USPS pour le suivi de courrier (Confirm services),
sous forme de barres hautes/basses. Il supporte :
- L'encodage d'un numéro de suivi en PLANET-11 / PLANET-13 / format libre
- Le décodage depuis plusieurs représentations visuelles (binaire, |/., |/╷)
- Le calcul et la vérification du checksum
- Le mode brute-force (hypothèses de barres de trame / mode flexible)

Référence de l'encodage (chaque chiffre = 5 barres, exactement 2 hautes) :
https://en.wikipedia.org/wiki/Postal_Alpha_Numeric_Encoding_Technique

Note : la table PLANET est le complément bit à bit de la table POSTNET
(cf. plugins/official/postnet_barcode/main.py) — même structure de barres,
polarité inversée.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

try:
    from gc_backend.plugins.scoring import score_text

    _SCORING_AVAILABLE = True
except Exception:  # pragma: no cover - dépendance optionnelle
    score_text = None
    _SCORING_AVAILABLE = False


PLANET_ENCODING = {
    "0": "00111",
    "1": "11100",
    "2": "11010",
    "3": "11001",
    "4": "10110",
    "5": "10101",
    "6": "10011",
    "7": "01110",
    "8": "01101",
    "9": "01011",
}
PLANET_DECODING = {v: k for k, v in PLANET_ENCODING.items()}

FORMAT_LABELS = {"planet11": "PLANET-11", "planet13": "PLANET-13"}


class PlanetBarcodePlugin:
    """Plugin d'encodage/décodage du code-barres PLANET.

    Args:
        inputs (dict):
            - text (str): chiffres à encoder, ou barres à décoder
            - mode (str): 'encode' ou 'decode'
            - format (str, optionnel): 'auto'|'planet11'|'planet13'|'free' (encode)
            - visual_format (str, optionnel): 'auto'|'pipe_dot'|'pipe_down'|'binary'
            - checksum_mode (str, optionnel): 'auto'|'required'|'optional'|'none'
            - frame_bars (str, optionnel): 'auto'|'always'|'never'
            - bruteforce (bool, optionnel): active le brute-force (decode uniquement)

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "planet_barcode"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        mode = str(inputs.get("mode", "decode")).lower()
        text = str(inputs.get("text", "")).strip()
        format_type = str(inputs.get("format", "auto")).lower()
        visual_format = str(inputs.get("visual_format", "auto")).lower()
        checksum_mode = str(inputs.get("checksum_mode", "auto")).lower()
        frame_bars = str(inputs.get("frame_bars", "auto")).lower()
        enable_scoring = bool(inputs.get("enable_scoring", True))
        is_bruteforce = bool(inputs.get("bruteforce", False) or inputs.get("brute_force", False))
        context = inputs.get("context", {})

        is_valid, error_message = self._validate_input(text, mode)
        if not is_valid:
            return self._error_response(error_message, start_time)

        try:
            if mode == "encode":
                return self._execute_encode(
                    text, format_type, checksum_mode, frame_bars, visual_format, start_time
                )
            if mode == "decode":
                if is_bruteforce:
                    return self._execute_bruteforce_decode(text, start_time)
                return self._execute_decode(
                    text, format_type, checksum_mode, frame_bars, enable_scoring, context, start_time
                )
            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except Exception as exc:  # défense en profondeur : jamais d'exception non gérée
            return self._error_response(f"Erreur inattendue: {exc}", start_time)

    # ------------------------------------------------------------------
    # Encode
    # ------------------------------------------------------------------

    def _execute_encode(
        self,
        text: str,
        format_type: str,
        checksum_mode: str,
        frame_bars: str,
        visual_format: str,
        start_time: float,
    ) -> Dict[str, Any]:
        digits = re.sub(r"[^0-9]", "", text)
        if not digits:
            return self._error_response(
                "Aucun chiffre trouvé dans l'entrée. L'encodage PLANET nécessite des chiffres.",
                start_time,
            )

        encoded = self._encode_to_planet(digits, format_type, checksum_mode, frame_bars, visual_format)

        if encoded["format"] == "free":
            format_name = f"libre ({len(encoded['digits'])} chiffres, {len(encoded['binary'])} barres)"
        elif encoded["format"] in FORMAT_LABELS:
            format_name = f"{FORMAT_LABELS[encoded['format']]} ({len(encoded['binary'])} barres)"
        else:
            format_name = f"personnalisé ({len(encoded['binary'])} barres)"

        result = {
            "id": "result_1",
            "text_output": encoded["display"],
            "confidence": 1.0,
            "parameters": {
                "mode": "encode",
                "format": format_type,
                "visual_format": visual_format,
                "checksum_mode": checksum_mode,
                "frame_bars": frame_bars,
                "input_digits": encoded["digits"],
            },
            "metadata": {
                "format_name": format_name,
                "binary_representation": encoded["binary"],
                "pipe_dot_format": encoded["pipe_dot"],
                "pipe_down_format": encoded["pipe_down"],
                "total_bars": len(encoded["binary"]),
                "has_checksum": encoded["has_checksum"],
                "has_frame_bars": encoded["has_frame_bars"],
                "checksum": encoded["checksum"],
                "full_code": encoded["full_code"],
            },
        }

        return {
            "status": "ok",
            "summary": f"Encodage réussi en {format_name}",
            "results": [result],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _encode_to_planet(
        self,
        digits: str,
        target_format: str = "auto",
        checksum_mode: str = "auto",
        frame_bars: str = "auto",
        visual_format: str = "auto",
    ) -> Dict[str, Any]:
        clean_digits = re.sub(r"[^0-9]", "", digits)
        if not clean_digits:
            raise ValueError("Aucun chiffre à encoder")

        if target_format == "auto":
            target_format = {11: "planet11", 13: "planet13"}.get(len(clean_digits), "free")

        if target_format == "planet11":
            clean_digits = clean_digits[:11].ljust(11, "0")
        elif target_format == "planet13":
            clean_digits = clean_digits[:13].ljust(13, "0")

        add_checksum = checksum_mode in {"required", "optional"} or (
            checksum_mode == "auto" and target_format in FORMAT_LABELS
        )

        if add_checksum:
            checksum = self._calculate_checksum(clean_digits)
            full_code = clean_digits + checksum
        else:
            checksum = None
            full_code = clean_digits

        add_frame_bars = frame_bars == "always" or (
            frame_bars == "auto" and target_format in FORMAT_LABELS
        )

        planet_code = ""
        if add_frame_bars:
            planet_code += "1"
        for digit in full_code:
            if digit not in PLANET_ENCODING:
                raise ValueError(f"Caractère non supporté: {digit}")
            planet_code += PLANET_ENCODING[digit]
        if add_frame_bars:
            planet_code += "1"

        pipe_dot_format = self._format_to_visual(planet_code, "pipe_dot")
        pipe_down_format = self._format_to_visual(planet_code, "pipe_down")
        display_format = {
            "binary": planet_code,
            "pipe_dot": pipe_dot_format,
            "pipe_down": pipe_down_format,
        }.get(visual_format, pipe_dot_format)

        return {
            "binary": planet_code,
            "pipe_dot": pipe_dot_format,
            "pipe_down": pipe_down_format,
            "display": display_format,
            "digits": clean_digits,
            "full_code": full_code,
            "checksum": checksum,
            "has_checksum": add_checksum,
            "has_frame_bars": add_frame_bars,
            "format": target_format,
        }

    @staticmethod
    def _format_to_visual(binary_code: str, visual_format: str) -> str:
        if visual_format == "pipe_dot":
            return binary_code.replace("1", "|").replace("0", ".")
        if visual_format == "pipe_down":
            return binary_code.replace("1", "|").replace("0", "╷")
        return binary_code

    @staticmethod
    def _calculate_checksum(digits: str) -> str:
        total = sum(int(digit) for digit in digits)
        return str((10 - (total % 10)) % 10)

    # ------------------------------------------------------------------
    # Decode
    # ------------------------------------------------------------------

    def _execute_decode(
        self,
        text: str,
        format_type: str,
        checksum_mode: str,
        frame_bars: str,
        enable_scoring: bool,
        context: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        patterns = self._detect_planet_pattern(text)
        if not patterns:
            patterns = [{"type": "direct", "text": text, "start": 0, "end": len(text), "format": "auto"}]

        flexible_mode = (
            format_type == "free" or checksum_mode in {"optional", "none"} or frame_bars == "never"
        )

        results: List[Dict[str, Any]] = []
        for i, pattern in enumerate(patterns, 1):
            decode_result = self._decode_from_planet(pattern["text"], flexible_mode)
            if not decode_result["success"]:
                continue

            confidence = self._calculate_confidence(decode_result, flexible_mode, False)
            zip_code = decode_result["zip_code"]

            result = {
                "id": f"result_{i}",
                "text_output": zip_code,
                "confidence": confidence,
                "parameters": {
                    "mode": "decode",
                    "pattern_type": pattern["type"],
                    "flexible_mode": flexible_mode,
                    "original_format": pattern.get("format", "auto"),
                },
                "metadata": {
                    **decode_result,
                    "pattern_found": pattern["text"],
                    "zip_code_raw": zip_code,
                },
            }

            if enable_scoring:
                scoring_result = self._get_text_score(zip_code, context)
                if scoring_result:
                    result["confidence"] = scoring_result.get("score", confidence)
                    result["metadata"]["scoring"] = scoring_result

            results.append(result)

        if not results:
            return self._error_response("Aucun code PLANET valide détecté", start_time)

        results.sort(key=lambda r: r["confidence"], reverse=True)

        best = results[0]
        format_info = best["metadata"].get("format", "format inconnu")
        checksum_valid = best["metadata"].get("checksum_valid")
        if checksum_valid is True:
            summary = f"Décodage réussi: {format_info}"
        elif checksum_valid is False:
            summary = f"Décodage avec checksum invalide: {format_info}"
        else:
            summary = f"Décodage: {format_info}"

        original_format = best["metadata"].get("original_format")
        if original_format and original_format != "unknown":
            summary += f" (format {original_format})"

        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _execute_bruteforce_decode(self, text: str, start_time: float) -> Dict[str, Any]:
        variations = self._generate_bruteforce_variations(text)
        if not variations:
            return self._error_response("Aucun code PLANET valide détecté", start_time)

        results: List[Dict[str, Any]] = []
        for i, variation in enumerate(variations, 1):
            results.append(
                {
                    "id": f"result_{i}",
                    "text_output": variation["text_output"],
                    "confidence": variation["confidence"],
                    "parameters": {
                        "mode": "decode",
                        "bruteforce": True,
                        **variation["parameters"],
                    },
                    "metadata": {
                        **variation["metadata"],
                        "bruteforce_variation": i,
                    },
                }
            )

        return {
            "status": "ok",
            "summary": f"Bruteforce: {len(results)} variation(s) testée(s)",
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _detect_visual_format(self, text: str) -> str:
        has_binary = bool(re.search(r"[01]", text))
        has_pipe = bool(re.search(r"[|I]", text))
        has_dot = bool(re.search(r"[.\-_]", text))
        has_down = bool(re.search(r"╷", text))

        if has_binary and not (has_pipe or has_dot or has_down):
            return "binary"
        if has_pipe and has_dot and not has_down and not has_binary:
            return "pipe_dot"
        if has_pipe and has_down and not has_dot and not has_binary:
            return "pipe_down"
        if has_pipe or has_dot or has_down:
            return "mixed"
        return "unknown"

    @staticmethod
    def _normalize_barcode(barcode: str) -> str:
        clean = barcode.strip()
        if re.match(r"^[01]+$", clean):
            return clean

        normalized = ""
        for char in clean:
            if char in "|I1":
                normalized += "1"
            elif char in ".-_0╷":
                normalized += "0"
        return normalized

    def _decode_from_planet(self, barcode: str, flexible: bool = False) -> Dict[str, Any]:
        original_format = self._detect_visual_format(barcode)
        clean_barcode = self._normalize_barcode(barcode)

        def failure(error: str, has_frame_bars: bool = False) -> Dict[str, Any]:
            return {
                "success": False,
                "error": error,
                "zip_code": None,
                "checksum_valid": None,
                "has_frame_bars": has_frame_bars,
                "has_checksum": False,
                "original_format": original_format,
            }

        if not clean_barcode:
            return failure("Code barre vide ou invalide")

        has_frame_bars = clean_barcode.startswith("1") and clean_barcode.endswith("1")
        data_portion = clean_barcode[1:-1] if has_frame_bars else clean_barcode

        if len(data_portion) % 5 != 0:
            if not flexible:
                return failure(
                    f"Longueur de données invalide: {len(data_portion)} (doit être multiple de 5)",
                    has_frame_bars,
                )
            data_portion = data_portion[: len(data_portion) - (len(data_portion) % 5)]

        digits = ""
        invalid_patterns: List[str] = []
        for i in range(0, len(data_portion), 5):
            pattern = data_portion[i : i + 5]
            if pattern.count("1") != 3 or pattern not in PLANET_DECODING:
                if not flexible:
                    if pattern.count("1") != 3:
                        error = f"Pattern invalide: {pattern} (doit avoir exactement 3 barres hautes)"
                    else:
                        error = f"Pattern non reconnu: {pattern}"
                    return failure(error, has_frame_bars)
                invalid_patterns.append(pattern)
                continue
            digits += PLANET_DECODING[pattern]

        if not digits:
            return failure("Aucun chiffre décodé", has_frame_bars)

        checksum_valid = None
        has_checksum = False
        zip_digits = digits
        received_checksum = None
        calculated_checksum = None

        if len(digits) >= 2:
            test_zip_digits = digits[:-1]
            test_checksum = digits[-1]
            test_calculated = self._calculate_checksum(test_zip_digits)

            if test_checksum == test_calculated:
                zip_digits = test_zip_digits
                received_checksum = test_checksum
                calculated_checksum = test_calculated
                checksum_valid = True
                has_checksum = True
            elif not flexible and len(digits) in {12, 14}:
                zip_digits = test_zip_digits
                received_checksum = test_checksum
                calculated_checksum = test_calculated
                checksum_valid = False
                has_checksum = True

        if len(zip_digits) == 11:
            format_type = "PLANET-11"
        elif len(zip_digits) == 13:
            format_type = "PLANET-13"
        else:
            format_type = f"libre ({len(zip_digits)} chiffres)"

        result = {
            "success": True,
            "zip_code": zip_digits,
            "format": format_type,
            "checksum_received": received_checksum,
            "checksum_calculated": calculated_checksum,
            "checksum_valid": checksum_valid,
            "has_checksum": has_checksum,
            "has_frame_bars": has_frame_bars,
            "total_bars": len(clean_barcode),
            "flexible_mode": flexible,
            "original_format": original_format,
        }

        if invalid_patterns:
            result["invalid_patterns"] = invalid_patterns
            result["warning"] = f"{len(invalid_patterns)} pattern(s) invalide(s) ignoré(s)"

        return result

    @staticmethod
    def _detect_planet_pattern(text: str) -> List[Dict[str, Any]]:
        patterns: List[Dict[str, Any]] = []
        pattern_specs = [
            (r"[01]{10,}", "binary", "binary"),
            (r"[|.\-_I]{10,}", "bars_dot", "pipe_dot"),
            (r"[|╷I]{10,}", "bars_down", "pipe_down"),
            (r"[|.\-_I╷01]{10,}", "mixed", "mixed"),
        ]

        for regex, ptype, pformat in pattern_specs:
            for match in re.finditer(regex, text):
                if len(match.group()) % 5 == 0:
                    patterns.append(
                        {
                            "type": ptype,
                            "text": match.group(),
                            "start": match.start(),
                            "end": match.end(),
                            "format": pformat,
                        }
                    )

        seen_positions = set()
        unique_patterns: List[Dict[str, Any]] = []
        for pattern in patterns:
            pos_key = (pattern["start"], pattern["end"])
            if pos_key not in seen_positions:
                seen_positions.add(pos_key)
                unique_patterns.append(pattern)

        return sorted(unique_patterns, key=lambda x: x["start"])

    def _generate_bruteforce_variations(self, text: str) -> List[Dict[str, Any]]:
        variations: List[Dict[str, Any]] = []

        for flexible in (True, False):
            for assume_frame_bars in (True, False):
                try:
                    test_text = text
                    if assume_frame_bars and not (text.startswith("1") or text.startswith("|")):
                        normalized = self._normalize_barcode(text)
                        if normalized and not normalized.startswith("1"):
                            test_text = "1" + normalized + "1"
                            original_format = self._detect_visual_format(text)
                            if original_format in {"pipe_dot", "pipe_down"}:
                                test_text = self._format_to_visual(test_text, original_format)

                    result = self._decode_from_planet(test_text, flexible)
                    if not result["success"]:
                        continue

                    confidence = self._calculate_confidence(result, flexible, assume_frame_bars)
                    variations.append(
                        {
                            "text_output": result["zip_code"],
                            "confidence": confidence,
                            "parameters": {
                                "flexible_mode": flexible,
                                "assumed_frame_bars": assume_frame_bars,
                                "original_has_frame_bars": result["has_frame_bars"],
                            },
                            "metadata": result,
                        }
                    )
                except Exception:
                    continue

        seen_outputs = set()
        unique_variations: List[Dict[str, Any]] = []
        for variation in variations:
            output_key = variation["text_output"]
            if output_key not in seen_outputs:
                seen_outputs.add(output_key)
                unique_variations.append(variation)

        unique_variations.sort(key=lambda x: x["confidence"], reverse=True)
        return unique_variations

    @staticmethod
    def _calculate_confidence(decode_result: Dict[str, Any], flexible: bool, assumed_frame_bars: bool) -> float:
        confidence = 0.5

        if decode_result.get("checksum_valid") is True:
            confidence += 0.3
        elif decode_result.get("checksum_valid") is False:
            confidence -= 0.1

        if decode_result.get("format") in {"PLANET-11", "PLANET-13"}:
            confidence += 0.2

        if decode_result.get("has_frame_bars"):
            confidence += 0.1

        if flexible:
            confidence -= 0.1

        if assumed_frame_bars != decode_result.get("has_frame_bars"):
            confidence -= 0.05

        if decode_result.get("invalid_patterns"):
            confidence -= 0.1 * len(decode_result["invalid_patterns"])

        return max(0.0, min(1.0, confidence))

    # ------------------------------------------------------------------
    # Divers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_input(text: str, mode: str) -> tuple[bool, str]:
        if not text or not text.strip():
            return False, "Entrée vide"

        if mode == "encode":
            if not re.search(r"[0-9]", text):
                return False, "Aucun chiffre trouvé dans l'entrée. L'encodage PLANET nécessite des chiffres."
            return True, ""

        if mode == "decode":
            if re.search(r"[01|.\-_I╷]", text):
                return True, ""
            return False, "Format non reconnu. Le décodage PLANET nécessite des barres (|, ., ╷) ou du binaire (0, 1)."

        return True, ""

    @staticmethod
    def _get_text_score(text: str, context: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if not _SCORING_AVAILABLE or not score_text:
            return None
        try:
            return score_text(text, context=context or {})
        except Exception:
            return None

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        execution_time = (time.time() - start_time) * 1000
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": round(execution_time, 2),
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }
