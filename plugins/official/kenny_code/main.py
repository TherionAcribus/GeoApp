from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

try:
    from gc_backend.plugins.code_solving import WordCodec, normalize_allowed_chars, parse_bool, parse_mode_params
except ImportError:  # execution standalone / tests hors backend
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import WordCodec, normalize_allowed_chars, parse_bool, parse_mode_params

DEFAULT_ALLOWED_CHARS = " \t\r\n.:;,_-°"


class KennyCodePlugin:
    def __init__(self) -> None:
        self.name = "kenny_code"
        self.version = "1.3.0"

        self.encode_table: Dict[str, str] = {
            "a": "mmm",
            "b": "mmp",
            "c": "mmf",
            "d": "mpm",
            "e": "mpp",
            "f": "mpf",
            "g": "mfm",
            "h": "mfp",
            "i": "mff",
            "j": "pmm",
            "k": "pmp",
            "l": "pmf",
            "m": "ppm",
            "n": "ppp",
            "o": "ppf",
            "p": "pfm",
            "q": "pfp",
            "r": "pff",
            "s": "fmm",
            "t": "fmp",
            "u": "fmf",
            "v": "fpm",
            "w": "fpp",
            "x": "fpf",
            "y": "ffm",
            "z": "ffp",
        }
        self.decode_table: Dict[str, str] = {v: k for k, v in self.encode_table.items()}

        # Logique strict/embedded/allowed_chars partagee. Un "mot" Kenny est
        # valide des qu'il contient au moins un triplet ("mpf") connu.
        self._codec = WordCodec(
            validate_word=self._has_valid_triplet,
            case="lower",
            charset="mpf",
        )

    def _has_valid_triplet(self, word: str) -> bool:
        return any(
            word[i:i + 3] in self.decode_table
            for i in range(0, len(word) - 2, 3)
        )

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        params = parse_mode_params(inputs, default_mode="decode", default_allowed_chars=" \t\r\n.:;,_-°")
        mode = params.mode
        strict_mode = params.strict
        embedded = params.embedded
        allowed_chars = params.allowed_chars
        text = inputs.get("text", "")

        if not isinstance(text, str) or text == "":
            return self._error_response("Aucun texte fourni", start_time)

        try:
            if mode == "encode":
                output = self.encode(text)
                return {
                    "status": "ok",
                    "summary": "Encodage Kenny réussi",
                    "results": [
                        {
                            "id": "result_1",
                            "text_output": output,
                            "confidence": 1.0,
                            "parameters": {"mode": "encode"},
                            "metadata": {"processed_chars": len(text)},
                        }
                    ],
                    "plugin_info": self._get_plugin_info(start_time),
                }

            if mode == "decode":
                if strict_mode:
                    check = self.check_code(text, strict=True, allowed_chars=allowed_chars, embedded=embedded)
                    if not check["is_match"]:
                        return self._error_response("Code Kenny invalide en mode strict", start_time)

                    decoded = self.decode_fragments(text, check["fragments"])
                    return {
                        "status": "ok",
                        "summary": "Décodage Kenny réussi (strict)",
                        "results": [
                            {
                                "id": "result_1",
                                "text_output": decoded,
                                "confidence": 0.9,
                                "parameters": {"mode": "decode", "strict": "strict", "embedded": embedded},
                                "metadata": {
                                    "fragments_count": len(check["fragments"]),
                                    "full_match": bool(check.get("full_match")),
                                },
                            }
                        ],
                        "plugin_info": self._get_plugin_info(start_time),
                    }

                check = self.check_code(text, strict=False, allowed_chars=allowed_chars, embedded=embedded)
                if not check["is_match"]:
                    return self._error_response("Aucun code Kenny détecté dans le texte", start_time)

                decoded = self.decode_fragments(text, check["fragments"])
                if decoded == text:
                    return self._error_response("Aucun code Kenny n'a pu être décodé", start_time)

                fragments_text_length = sum(len(frag.get("value", "")) for frag in check["fragments"])
                coverage_ratio = fragments_text_length / len(text) if text else 0.0

                confidence = 0.5 + (coverage_ratio * 0.4)
                if len(check["fragments"]) > 3:
                    confidence -= 0.1
                confidence = max(0.1, min(0.9, confidence))

                return {
                    "status": "ok",
                    "summary": f"Décodage Kenny réussi (smooth, {len(check['fragments'])} fragment(s))",
                    "results": [
                        {
                            "id": "result_1",
                            "text_output": decoded,
                            "confidence": float(confidence),
                            "parameters": {"mode": "decode", "strict": "smooth", "embedded": embedded},
                            "metadata": {
                                "fragments_count": len(check["fragments"]),
                                "coverage_ratio": float(coverage_ratio),
                                "fragments": [
                                    {
                                        "start": f.get("start"),
                                        "end": f.get("end"),
                                        "value": f.get("value"),
                                    }
                                    for f in check["fragments"]
                                ],
                            },
                        }
                    ],
                    "plugin_info": self._get_plugin_info(start_time),
                }

            if mode == "detect":
                check = self.check_code(text, strict=strict_mode, allowed_chars=allowed_chars, embedded=embedded)
                score = float(check.get("score", 0.0) or 0.0)
                is_match = bool(check.get("is_match"))

                return {
                    "status": "ok",
                    "summary": "Code Kenny détecté" if is_match else "Aucun code Kenny détecté",
                    "results": [
                        {
                            "id": "result_1",
                            "text_output": f"Probabilité Kenny: {score:.2%}",
                            "confidence": score,
                            "parameters": {"mode": "detect", "strict": "strict" if strict_mode else "smooth", "embedded": embedded},
                            "metadata": {
                                "is_match": is_match,
                                "detection_score": score,
                                "fragments_count": len(check.get("fragments") or []),
                            },
                        }
                    ],
                    "plugin_info": self._get_plugin_info(start_time),
                }

            return self._error_response(f"Mode inconnu: {mode}", start_time)

        except Exception as e:
            return self._error_response(str(e), start_time)

    def encode(self, text: str) -> str:
        result: List[str] = []
        for char in text.lower():
            if char in self.encode_table:
                result.append(self.encode_table[char])
            elif char.isspace():
                result.append(" ")
            else:
                result.append(char)
        return "".join(result)

    def decode(self, text: str) -> str:
        result: List[str] = []
        i = 0
        current_group: List[str] = []

        while i < len(text):
            if text[i].isspace():
                if current_group:
                    result.append(self._decode_group("".join(current_group).lower()))
                    current_group = []
                result.append(" ")
                i += 1
            else:
                current_group.append(text[i])
                if len(current_group) == 3:
                    result.append(self._decode_group("".join(current_group).lower()))
                    current_group = []
                i += 1

        if current_group:
            result.append(self._decode_group("".join(current_group).lower()))

        return "".join(result)

    def _decode_group(self, group: str) -> str:
        return self.decode_table.get(group, "?")

    def check_code(
        self,
        text: str,
        *,
        strict: bool = False,
        allowed_chars: Optional[str] = None,
        embedded: bool = False,
    ) -> Dict[str, Any]:
        allowed_chars = normalize_allowed_chars(allowed_chars, default=DEFAULT_ALLOWED_CHARS)
        return self._codec.check(
            text,
            strict=strict,
            embedded=embedded,
            allowed_chars=allowed_chars,
        )

    def decode_fragments(self, text: str, fragments: List[Dict[str, Any]]) -> str:
        sorted_fragments = sorted(fragments, key=lambda x: x.get("start", 0))
        result: List[str] = []
        last_pos = 0

        for frag in sorted_fragments:
            start = int(frag.get("start", 0))
            end = int(frag.get("end", 0))
            value = str(frag.get("value", ""))
            result.append(text[last_pos:start])
            result.append(self.decode(value))
            last_pos = end

        result.append(text[last_pos:])
        return "".join(result)

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
    return KennyCodePlugin().execute(inputs)
