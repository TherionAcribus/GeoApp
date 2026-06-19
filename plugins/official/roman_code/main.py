from __future__ import annotations

import re
import time
from typing import Any, Dict, List

try:
    from gc_backend.plugins.code_solving import WordCodec, normalize_allowed_chars, parse_bool
except ImportError:  # execution standalone / tests hors backend
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import WordCodec, normalize_allowed_chars, parse_bool

DEFAULT_ALLOWED_CHARS = " \t\r\n.:;,_-°"
ROMAN_CHARS = "IVXLCDM"


class RomanCodePlugin:
    def __init__(self) -> None:
        self.name = "roman_code"
        self.version = "1.0.0"
        self.description = "Convertit un entier décimal en chiffres romains et inversement."

        try:
            from gc_backend.plugins.scoring import score_text

            self._score_text = score_text
            self._scoring_available = True
        except Exception:
            self._score_text = None
            self._scoring_available = False

        # Logique strict/embedded/allowed_chars partagee. Un "mot" est un code
        # romain valide s'il n'est compose que de symboles IVXLCDM.
        self._codec = WordCodec(
            validate_word=lambda word: bool(word) and all(c in ROMAN_CHARS for c in word),
            case="upper",
            charset=ROMAN_CHARS,
        )

    def encode_roman(self, number: int) -> str:
        if number <= 0:
            raise ValueError("Les chiffres romains ne sont pas définis pour 0 ou négatifs.")

        roman_map = [
            (1000, "M"),
            (900, "CM"),
            (500, "D"),
            (400, "CD"),
            (100, "C"),
            (90, "XC"),
            (50, "L"),
            (40, "XL"),
            (10, "X"),
            (9, "IX"),
            (5, "V"),
            (4, "IV"),
            (1, "I"),
        ]

        result = []
        for val, symb in roman_map:
            while number >= val:
                result.append(symb)
                number -= val
        return "".join(result)

    def decode_roman(self, roman_str: str) -> int:
        roman_values = {
            "M": 1000,
            "D": 500,
            "C": 100,
            "L": 50,
            "X": 10,
            "V": 5,
            "I": 1,
        }

        roman_str = roman_str.upper()
        total = 0
        prev_value = 0

        for char in reversed(roman_str):
            if char not in roman_values:
                raise ValueError(f"Symbole romain inconnu: {char}")
            value = roman_values[char]
            if value >= prev_value:
                total += value
            else:
                total -= value
            prev_value = value

        return total

    def check_code(self, text: str, strict: bool = False, allowed_chars: str | None = None, embedded: bool = False) -> dict:
        allowed_chars = normalize_allowed_chars(allowed_chars, default=DEFAULT_ALLOWED_CHARS)
        return self._codec.check(
            text,
            strict=strict,
            embedded=embedded,
            allowed_chars=allowed_chars,
        )

    def decode_fragments(self, text: str, fragments: List[Dict[str, Any]]) -> str:
        result = list(text)
        for fragment in sorted(fragments, key=lambda frag: frag["start"], reverse=True):
            start = fragment["start"]
            end = fragment["end"]
            value = fragment["value"]
            try:
                decoded = str(self.decode_roman(value))
                result[start:end] = decoded
            except ValueError:
                continue
        return "".join(result)

    def _get_text_score(self, text: str, context: Dict[str, Any] | None = None) -> Dict[str, Any] | None:
        if not self._scoring_available or not self._score_text:
            return None
        try:
            return self._score_text(text, context=context or {})
        except Exception:
            return None

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        mode = str(inputs.get("mode", "encode")).lower()
        text = inputs.get("text", inputs.get("value", ""))
        strict_mode = str(inputs.get("strict", "smooth")).lower() == "strict"
        allowed_chars = inputs.get("allowed_chars")
        embedded = parse_bool(inputs.get("embedded", False))
        enable_scoring = parse_bool(inputs.get("enable_scoring", True))
        context = inputs.get("context", {})

        standardized_response = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time": 0,
            },
            "inputs": inputs.copy(),
            "results": [],
            "summary": {
                "best_result_id": None,
                "total_results": 0,
                "message": "",
            },
        }

        if not text:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucun texte fourni à traiter."
            standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
            return standardized_response

        try:
            if mode == "encode":
                try:
                    number = int(text)
                except (TypeError, ValueError):
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = (
                        "Le texte doit être un nombre entier pour l'encodage en chiffres romains."
                    )
                    return standardized_response

                if number <= 0:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = (
                        "Le nombre doit être positif pour l'encodage en chiffres romains."
                    )
                    return standardized_response

                encoded = self.encode_roman(number)
                standardized_response["results"].append(
                    {
                        "id": "result_1",
                        "text_output": encoded,
                        "confidence": 1.0,
                        "parameters": {
                            "mode": "encode",
                        },
                        "metadata": {
                            "input_number": number,
                        },
                    }
                )

                standardized_response["summary"].update(
                    {
                        "best_result_id": "result_1",
                        "total_results": 1,
                        "message": f"Encodage réussi: {number} => {encoded}",
                    }
                )

            elif mode == "decode":
                check = self.check_code(text, strict=strict_mode, allowed_chars=allowed_chars, embedded=embedded)
                if not check["is_match"]:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = (
                        "Chiffres romains invalides en mode strict"
                        if strict_mode
                        else "Aucun chiffre romain détecté dans le texte"
                    )
                    return standardized_response

                decoded = self.decode_fragments(text, check["fragments"])
                if decoded == text:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = "Aucun chiffre romain n'a pu être décodé"
                    return standardized_response

                confidence = 0.8
                scoring_info = None
                if enable_scoring:
                    scoring_info = self._get_text_score(decoded, context)
                    if scoring_info and "score" in scoring_info:
                        confidence = float(scoring_info["score"])

                result = {
                    "id": "result_1",
                    "text_output": decoded,
                    "confidence": confidence,
                    "parameters": {
                        "mode": "decode",
                        "strict": "strict" if strict_mode else "smooth",
                        "embedded": embedded,
                    },
                    "metadata": {
                        "fragments_count": len(check["fragments"]),
                        "fragments": [frag["value"] for frag in check["fragments"]],
                    },
                }
                if scoring_info:
                    result["scoring"] = scoring_info

                standardized_response["results"].append(result)
                standardized_response["summary"].update(
                    {
                        "best_result_id": "result_1",
                        "total_results": 1,
                        "message": "Décodage réussi",
                    }
                )

            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Mode inconnu : {mode}"

        except Exception as exc:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur pendant le traitement : {exc}"

        standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        return standardized_response


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return RomanCodePlugin().execute(inputs)
