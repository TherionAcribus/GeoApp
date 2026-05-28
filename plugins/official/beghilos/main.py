from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Dict, List, Tuple


class BeghilosPlugin:
    """Calculator upside-down writing, also known as BEGHILOS/BEGHILOSZ."""

    def __init__(self) -> None:
        self.name = "beghilos"
        self.version = "1.0.0"
        self.encode_map_upper = {
            "O": "0",
            "I": "1",
            "Z": "2",
            "E": "3",
            "H": "4",
            "S": "5",
            "G": "6",
            "L": "7",
            "B": "8",
        }
        self.encode_map_case_sensitive = {
            **self.encode_map_upper,
            "b": "9",
            "g": "6",
            "h": "4",
        }
        self.decode_map_display = {
            "0": "O",
            "1": "I",
            "2": "Z",
            "3": "E",
            "4": "h",
            "5": "S",
            "6": "g",
            "7": "L",
            "8": "B",
            "9": "b",
        }
        self.decode_map_upper = {digit: letter.upper() for digit, letter in self.decode_map_display.items()}
        self.valid_digits = set(self.decode_map_display)

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()
        strict_mode = str(inputs.get("strict", "smooth")).lower() == "strict"
        embedded = self._parse_bool(inputs.get("embedded", False), default=False)
        allowed_chars = str(inputs.get("allowed_chars", " \t\r\n.:;,_-'\"!?") or "")
        letter_style = str(inputs.get("letter_style", "upper")).lower()
        case_sensitive_b = self._parse_bool(inputs.get("case_sensitive_b", False), default=False)

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "detect":
            is_match, score, metadata = self.detect(text, strict_mode=strict_mode, allowed_chars=allowed_chars)
            summary = "Texte compatible avec BEGHILOS" if is_match else "Texte peu compatible avec BEGHILOS"
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

        if mode == "encode":
            if strict_mode and not embedded:
                ok, reason = self._is_strict_plaintext(text, allowed_chars=allowed_chars, case_sensitive_b=case_sensitive_b)
                if not ok:
                    return self._error_response(f"Texte incompatible avec BEGHILOS (strict): {reason}", start_time)
            output, metadata = self.encode(text, case_sensitive_b=case_sensitive_b)
            return self._success_response(
                summary="Encodage BEGHILOS reussi",
                text_output=output,
                confidence=1.0,
                parameters={
                    "mode": mode,
                    "strict": "strict" if strict_mode else "smooth",
                    "case_sensitive_b": case_sensitive_b,
                },
                metadata=metadata,
                start_time=start_time,
            )

        if mode == "decode":
            if strict_mode and not embedded:
                ok, reason = self._is_strict_ciphertext(text, allowed_chars=allowed_chars)
                if not ok:
                    return self._error_response(f"Code BEGHILOS invalide (strict): {reason}", start_time)
            output, metadata = self.decode(text, letter_style=letter_style)
            return self._success_response(
                summary="Decodage BEGHILOS reussi",
                text_output=output,
                confidence=0.8,
                parameters={
                    "mode": mode,
                    "strict": "strict" if strict_mode else "smooth",
                    "letter_style": letter_style,
                },
                metadata=metadata,
                start_time=start_time,
            )

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    def encode(self, text: str, case_sensitive_b: bool = False) -> Tuple[str, Dict[str, Any]]:
        normalized = self._remove_diacritics(text)
        char_map = self.encode_map_case_sensitive if case_sensitive_b else self.encode_map_upper
        encoded_chars: List[str] = []
        unsupported_chars: List[str] = []
        processed_chars = 0

        for ch in normalized:
            code = char_map.get(ch)
            if code is None and (not case_sensitive_b or ch != "b"):
                code = char_map.get(ch.upper())

            if code is not None:
                encoded_chars.append(code)
                processed_chars += 1
            else:
                encoded_chars.append(ch)
                if not ch.isspace() and ch not in ".:;,_-'\"!?":
                    unsupported_chars.append(ch)

        output = "".join(encoded_chars)[::-1]
        return output, {
            "processed_chars": processed_chars,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
            "warning": "Certains caracteres non BEGHILOS ont ete conserves tels quels." if unsupported_chars else None,
            "mapping": self._mapping_metadata(),
        }

    def decode(self, text: str, letter_style: str = "upper") -> Tuple[str, Dict[str, Any]]:
        reverse = text[::-1]
        decode_map = self.decode_map_display if letter_style == "display" else self.decode_map_upper
        output: List[str] = []
        processed_digits = 0
        unsupported_chars: List[str] = []

        for ch in reverse:
            letter = decode_map.get(ch)
            if letter is not None:
                output.append(letter)
                processed_digits += 1
            else:
                output.append(ch)
                if not ch.isspace() and ch not in ".:;,_-'\"!?":
                    unsupported_chars.append(ch)

        return "".join(output), {
            "processed_digits": processed_digits,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
            "letter_style": letter_style,
            "mapping": self._mapping_metadata(),
        }

    def detect(self, text: str, strict_mode: bool, allowed_chars: str) -> Tuple[bool, float, Dict[str, Any]]:
        digits = [ch for ch in text if ch.isdigit()]
        valid_digits = [ch for ch in digits if ch in self.valid_digits]
        if not digits:
            letters = [ch for ch in self._remove_diacritics(text).upper() if "A" <= ch <= "Z"]
            valid_letters = [ch for ch in letters if ch in self.encode_map_upper]
            score = len(valid_letters) / len(letters) if letters else 0.0
            return score >= 0.4, float(score), {
                "is_match": score >= 0.4,
                "input_kind": "letters",
                "letters_count": len(letters),
                "beghilos_letters_count": len(valid_letters),
                "detection_score": float(score),
            }

        if strict_mode:
            ok, _reason = self._is_strict_ciphertext(text, allowed_chars=allowed_chars)
            if not ok:
                return False, 0.0, {
                    "is_match": False,
                    "input_kind": "digits",
                    "digits_count": len(digits),
                    "valid_digits_count": len(valid_digits),
                    "strict_compatible": False,
                }

        score = len(valid_digits) / len(digits)
        return score >= 0.8, float(score), {
            "is_match": score >= 0.8,
            "input_kind": "digits",
            "digits_count": len(digits),
            "valid_digits_count": len(valid_digits),
            "detection_score": float(score),
        }

    def _is_strict_plaintext(self, text: str, allowed_chars: str, case_sensitive_b: bool) -> Tuple[bool, str]:
        normalized = self._remove_diacritics(text)
        has_valid = False
        allowed = set(allowed_chars)
        char_map = self.encode_map_case_sensitive if case_sensitive_b else self.encode_map_upper
        for ch in normalized:
            valid = ch in char_map or (not case_sensitive_b and ch.upper() in char_map)
            if valid:
                has_valid = True
                continue
            if ch in allowed:
                continue
            return False, f"caractere non encodable: {ch!r}"
        if not has_valid:
            return False, "aucun caractere BEGHILOS detecte"
        return True, ""

    def _is_strict_ciphertext(self, text: str, allowed_chars: str) -> Tuple[bool, str]:
        has_digit = False
        allowed = set(allowed_chars)
        for ch in text:
            if ch in self.valid_digits:
                has_digit = True
                continue
            if ch in allowed:
                continue
            return False, f"caractere non autorise: {ch!r}"
        if not has_digit:
            return False, "aucun chiffre BEGHILOS detecte"
        return True, ""

    def _mapping_metadata(self) -> Dict[str, str]:
        return {
            "O": "0",
            "I": "1",
            "Z": "2",
            "E": "3",
            "H/h": "4",
            "S": "5",
            "G/g": "6",
            "L": "7",
            "B": "8",
            "b": "9",
        }

    def _remove_diacritics(self, text: str) -> str:
        decomposed = unicodedata.normalize("NFKD", str(text))
        return "".join(ch for ch in decomposed if not unicodedata.combining(ch))

    def _parse_bool(self, value: Any, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes", "on"}
        return default

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
    return BeghilosPlugin().execute(inputs)
