"""Plugin Python `abaddon_code` (custom) pour GeoApp.

Encode/décode un texte selon le code Abaddon (triplets de symboles þ, µ, ¥).
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

try:
    from gc_backend.plugins.code_solving import (
        WordCodec,
        fixed_width_tokenizer,
        normalize_allowed_chars,
    )
except ImportError:  # execution standalone / tests hors backend
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import (
        WordCodec,
        fixed_width_tokenizer,
        normalize_allowed_chars,
    )

DEFAULT_ALLOWED_CHARS = " \t\r\n.:;,_-°"


class AbaddonCodePlugin:
    def __init__(self) -> None:
        self.name = "abaddon_code"
        self.version = "1.7.0"

        self.letter_to_code = {
            "O": "þþþ",
            "R": "þþµ",
            "P": "þþ¥",
            "S": "þµþ",
            "C": "þµµ",
            "H": "þµ¥",
            "Z": "þ¥þ",
            "T": "þ¥µ",
            "M": "þ¥¥",
            "G": "µþþ",
            "J": "µþµ",
            "W": "µþ¥",
            "D": "µµþ",
            "U": "µµµ",
            "F": "µµ¥",
            "X": "µ¥þ",
            "E": "µ¥µ",
            "L": "µ¥¥",
            "Q": "¥þþ",
            "K": "¥þµ",
            "B": "¥þ¥",
            "Y": "¥µþ",
            " ": "¥µµ",
            "V": "¥µ¥",
            "N": "¥¥þ",
            "A": "¥¥µ",
            "I": "¥¥¥",
        }
        self.code_to_letter = {v: k for k, v in self.letter_to_code.items()}

        # Logique strict/embedded/allowed_chars partagee (triplets de "þµ¥").
        self._codec = WordCodec(
            validate_word=lambda token: token in self.code_to_letter,
            charset="þµ¥",
            tokenizer=fixed_width_tokenizer(3),
            strict_mode="strip_all",
        )

    def normalize_text(self, text: str) -> str:
        return text.replace("μ", "µ")

    def _get_allowed_chars(self, allowed_chars: Optional[str]) -> str:
        return normalize_allowed_chars(allowed_chars, default=DEFAULT_ALLOWED_CHARS)

    def _strip_allowed_chars(self, text: str, allowed_chars: str) -> str:
        if not allowed_chars:
            return text
        return "".join(ch for ch in text if ch not in allowed_chars)

    def _decode_code_string(self, code: str) -> str:
        result: List[str] = []
        for i in range(0, len(code), 3):
            triplet = code[i : i + 3]
            result.append(self.code_to_letter.get(triplet, "?"))
        return "".join(result)

    def _decode_preserving_allowed_chars(self, text: str, allowed_chars: str) -> str:
        output: List[str] = []
        buffer: List[str] = []

        for ch in text:
            if allowed_chars and ch in allowed_chars:
                output.append(ch)
                continue

            buffer.append(ch)
            if len(buffer) == 3:
                output.append(self.code_to_letter.get("".join(buffer), "?"))
                buffer.clear()

        if buffer:
            output.append("?")

        return "".join(output)

    def check_code(
        self,
        text: str,
        *,
        strict: bool,
        allowed_chars: Optional[str],
        embedded: bool,
    ) -> Dict[str, Any]:
        allowed_chars = self._get_allowed_chars(allowed_chars)
        return self._codec.check(
            text,
            strict=strict,
            embedded=embedded,
            allowed_chars=allowed_chars,
        )

    def decode_fragments(self, text: str, fragments: List[Dict[str, Any]]) -> str:
        result = text
        for fragment in sorted(fragments, key=lambda f: f["start"], reverse=True):
            start = int(fragment["start"])
            end = int(fragment["end"])
            value = str(fragment["value"])
            letter = self.code_to_letter.get(value, "?")
            result = result[:start] + letter + result[end:]
        return result

    def encode(self, text: str) -> str:
        result: List[str] = []
        for char in text:
            if char in {" ", "\n", "\r", "\t"}:
                result.append(char)
                continue
            key = char.upper()
            code = self.letter_to_code.get(key)
            if code is not None:
                result.append(code)
            else:
                result.append(char)
        return "".join(result)

    def _get_unsupported_encode_chars(self, text: str) -> List[str]:
        unsupported = set()
        for char in text.upper():
            if char in {" ", "\n", "\r", "\t"}:
                continue
            if char not in self.letter_to_code:
                unsupported.add(char)
        return sorted(unsupported)

    def _build_detect_results(self, text: str, strict_mode: bool, embedded: bool, allowed_chars: Optional[str]) -> Dict[str, Any]:
        check = self.check_code(text, strict=strict_mode, allowed_chars=allowed_chars, embedded=embedded)
        results: List[Dict[str, Any]] = []

        if check.get("is_match"):
            fragments = check.get("fragments", [])

            for idx, fragment in enumerate(fragments, start=1):
                results.append(
                    {
                        "id": f"fragment_{idx}",
                        "text_output": str(fragment.get("value", "")),
                        "confidence": float(check.get("score", 0.0)),
                        "parameters": {
                            "strict": strict_mode,
                            "embedded": embedded,
                        },
                        "metadata": {
                            "start": fragment.get("start"),
                            "end": fragment.get("end"),
                        },
                    }
                )

        return {"check": check, "results": results}

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        mode = str(inputs.get("mode", "decode")).lower()
        text = self.normalize_text(str(inputs.get("text", "")))

        strict_mode = str(inputs.get("strict", "smooth")).lower() == "strict"
        embedded = bool(inputs.get("embedded", False))
        allowed_chars = inputs.get("allowed_chars")
        allowed_chars_str = self._get_allowed_chars(allowed_chars)

        if not text:
            return {
                "status": "error",
                "summary": "Aucun texte fourni à traiter.",
                "results": [],
                "plugin_info": {
                    "name": self.name,
                    "version": self.version,
                    "execution_time_ms": int((time.time() - start_time) * 1000),
                },
            }

        try:
            if mode == "encode":
                encoded = self.encode(text)
                unsupported_chars = self._get_unsupported_encode_chars(text)
                warning: Optional[str]
                if unsupported_chars:
                    warning = "Certains caractères ne sont pas encodables en Abaddon et ont été conservés tels quels."
                else:
                    warning = None
                results = [
                    {
                        "id": "result_1",
                        "text_output": encoded,
                        "confidence": 1.0,
                        "parameters": {"mode": "encode"},
                        "metadata": {
                            "processed_chars": len(text),
                            "encoded_chars": sum(1 for c in text.upper() if c in self.letter_to_code),
                            "unsupported_chars": unsupported_chars,
                            "unsupported_count": len(unsupported_chars),
                            "warning": warning,
                        },
                    }
                ]
                summary = "Encodage Abaddon réussi"

            elif mode == "detect":
                if not embedded:
                    check = self.check_code(
                        text,
                        strict=True,
                        allowed_chars=allowed_chars_str,
                        embedded=False,
                    )

                    if check.get("is_match"):
                        cleaned = self._strip_allowed_chars(text, allowed_chars_str)
                        results = [
                            {
                                "id": "result_1",
                                "text_output": cleaned,
                                "confidence": float(check.get("score", 0.0)),
                                "parameters": {"strict": True, "embedded": False},
                                "metadata": {
                                    "cleaned_length": len(cleaned),
                                    "removed_allowed_chars": len(text) - len(cleaned),
                                },
                            }
                        ]
                        summary = "Code Abaddon détecté"
                    else:
                        results = []
                        summary = "Aucun code Abaddon détecté"
                else:
                    detect = self._build_detect_results(
                        text,
                        strict_mode=True,
                        embedded=True,
                        allowed_chars=allowed_chars_str,
                    )
                    results = detect["results"]
                    summary = (
                        f"Code Abaddon détecté ({len(results)} fragment(s))" if results else "Aucun code Abaddon détecté"
                    )

            elif mode == "decode":
                if strict_mode and not embedded:
                    check = self.check_code(
                        text,
                        strict=True,
                        allowed_chars=allowed_chars_str,
                        embedded=False,
                    )
                    if not check.get("is_match"):
                        return {
                            "status": "error",
                            "summary": "Code Abaddon invalide en mode strict",
                            "results": [],
                            "plugin_info": {
                                "name": self.name,
                                "version": self.version,
                                "execution_time_ms": int((time.time() - start_time) * 1000),
                            },
                        }

                    cleaned = self._strip_allowed_chars(text, allowed_chars_str)
                    decoded = self._decode_preserving_allowed_chars(text, allowed_chars_str)
                    results = [
                        {
                            "id": "result_1",
                            "text_output": decoded,
                            "confidence": 1.0,
                            "parameters": {"mode": "decode", "strict": True, "embedded": False},
                            "metadata": {
                                "cleaned_length": len(cleaned),
                                "removed_allowed_chars": len(text) - len(cleaned),
                            },
                        }
                    ]
                    summary = "Décodage Abaddon strict réussi"
                else:
                    check = self.check_code(
                        text,
                        strict=strict_mode,
                        allowed_chars=allowed_chars_str,
                        embedded=embedded,
                    )
                    if not check["is_match"]:
                        return {
                            "status": "error",
                            "summary": "Aucun code Abaddon détecté dans le texte" if not strict_mode else "Code Abaddon invalide en mode strict",
                            "results": [],
                            "plugin_info": {
                                "name": self.name,
                                "version": self.version,
                                "execution_time_ms": int((time.time() - start_time) * 1000),
                            },
                        }

                    decoded = self.decode_fragments(text, check["fragments"])
                    if decoded == text:
                        return {
                            "status": "error",
                            "summary": "Aucun code Abaddon n'a pu être décodé",
                            "results": [],
                            "plugin_info": {
                                "name": self.name,
                                "version": self.version,
                                "execution_time_ms": int((time.time() - start_time) * 1000),
                            },
                        }

                    confidence = float(check.get("score", 0.0))
                    if not strict_mode:
                        confidence *= 0.9

                    results = [
                        {
                            "id": "result_1",
                            "text_output": decoded,
                            "confidence": confidence,
                            "parameters": {
                                "mode": "decode",
                                "strict": strict_mode,
                                "embedded": embedded,
                            },
                            "metadata": {
                                "fragments_count": len(check.get("fragments", [])),
                                "detection_score": float(check.get("score", 0.0)),
                            },
                        }
                    ]
                    summary = f"Décodage Abaddon réussi ({len(check.get('fragments', []))} fragments trouvés)"

            else:
                return {
                    "status": "error",
                    "summary": f"Mode inconnu : {mode}",
                    "results": [],
                    "plugin_info": {
                        "name": self.name,
                        "version": self.version,
                        "execution_time_ms": int((time.time() - start_time) * 1000),
                    },
                }

            return {
                "status": "ok",
                "summary": summary,
                "results": results,
                "plugin_info": {
                    "name": self.name,
                    "version": self.version,
                    "execution_time_ms": int((time.time() - start_time) * 1000),
                },
            }

        except Exception as exc:
            return {
                "status": "error",
                "summary": f"Erreur pendant le traitement: {exc}",
                "results": [],
                "plugin_info": {
                    "name": self.name,
                    "version": self.version,
                    "execution_time_ms": int((time.time() - start_time) * 1000),
                },
            }
