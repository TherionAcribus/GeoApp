from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple

try:
    from gc_backend.plugins.code_solving import is_alpha_strict, parse_bool, parse_mode_params, remove_diacritics
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import is_alpha_strict, parse_bool, parse_mode_params, remove_diacritics


class MalespinPlugin:
    """Argot Malespin.

    The transform is reciprocal: A<->E, B<->T, F<->G, I<->O, M<->P.
    Encoding and decoding therefore use the same substitution table.
    """

    def __init__(self) -> None:
        self.name = "malespin"
        self.version = "1.0.0"
        pairs = (("A", "E"), ("B", "T"), ("F", "G"), ("I", "O"), ("M", "P"))
        self.substitution = {a: b for a, b in pairs}
        self.substitution.update({b: a for a, b in pairs})
        self.swapped_letters = set(self.substitution)

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        params = parse_mode_params(inputs, default_mode="decode", default_allowed_chars=" \t\r\n.:;,_-'\"!?¿¡")
        text = inputs.get("text", "")
        mode = params.mode
        strict_mode = params.strict
        embedded = params.embedded
        allowed_chars = params.allowed_chars

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "detect":
            is_match, score, metadata = self.detect(text, strict_mode=strict_mode, allowed_chars=allowed_chars)
            summary = "Texte compatible avec Malespin" if is_match else "Texte peu compatible avec Malespin"
            return {
                "status": "ok",
                "summary": summary,
                "results": [
                    {
                        "id": "result_1",
                        "text_output": f"{summary} (score: {score:.2f})",
                        "confidence": float(score),
                        "parameters": {
                            "mode": "detect",
                            "strict": "strict" if strict_mode else "smooth",
                            "embedded": embedded,
                        },
                        "metadata": metadata,
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode not in {"encode", "decode"}:
            return self._error_response(f"Mode inconnu: {mode}", start_time)

        if strict_mode and not embedded:
            ok, reason = is_alpha_strict(text, allowed_chars)
            if not ok:
                return self._error_response(f"Texte incompatible avec Malespin (strict): {reason}", start_time)

        output, metadata = self.transform(text)
        return {
            "status": "ok",
            "summary": "Transformation Malespin reussie",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 1.0 if mode == "encode" else 0.6,
                    "parameters": {
                        "mode": mode,
                        "strict": "strict" if strict_mode else "smooth",
                        "embedded": embedded,
                    },
                    "metadata": metadata,
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def transform(self, text: str) -> Tuple[str, Dict[str, Any]]:
        normalized = remove_diacritics(text)
        output: List[str] = []
        processed_chars = 0
        swapped_chars = 0
        normalized_chars = 0

        for original, normalized_char in zip(text, normalized):
            if original != normalized_char:
                normalized_chars += 1

            upper = normalized_char.upper()
            replacement = self.substitution.get(upper)
            if replacement is None:
                output.append(normalized_char)
                continue

            processed_chars += 1
            swapped_chars += 1
            output.append(replacement if normalized_char.isupper() else replacement.lower())

        return "".join(output), {
            "processed_chars": processed_chars,
            "swapped_chars": swapped_chars,
            "normalized_chars": normalized_chars,
            "substitution_pairs": ["A=E", "B=T", "F=G", "I=O", "M=P"],
        }

    def detect(self, text: str, strict_mode: bool, allowed_chars: str) -> Tuple[bool, float, Dict[str, Any]]:
        normalized = remove_diacritics(text)
        letters = [ch for ch in normalized.upper() if "A" <= ch <= "Z"]
        if not letters:
            return False, 0.0, {"is_match": False, "letters_count": 0, "swappable_count": 0}

        if strict_mode:
            ok, _reason = is_alpha_strict(text, allowed_chars)
            if not ok:
                return False, 0.0, {"is_match": False, "letters_count": len(letters), "swappable_count": 0}

        swappable = sum(1 for ch in letters if ch in self.swapped_letters)
        score = swappable / len(letters)
        # Malespin is a natural-language substitution, so detection is only a weak compatibility signal.
        is_match = score >= 0.15
        return is_match, float(score), {
            "is_match": is_match,
            "letters_count": len(letters),
            "swappable_count": swappable,
            "detection_score": float(score),
            "warning": "Detection heuristique: Malespin est reversible et ressemble a du texte naturel.",
        }

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


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return MalespinPlugin().execute(inputs)
