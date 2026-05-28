from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple


class GeocacheCodePlugin:
    """Convert between geocaching.com numeric IDs and GC codes.

    Geocaching.com first used hexadecimal codes up to GCFFFF.
    Later codes use a custom base-31 alphabet with an offset so GCG000
    follows GCFFFF.
    """

    ALPHABET = "0123456789ABCDEFGHJKMNPQRTVWXYZ"
    HEX_ALPHABET = "0123456789ABCDEF"
    BASE = 31
    HEX_BASE = 16
    LEGACY_MAX_NUMBER = 0xFFFF
    BASE31_OFFSET = 411120
    GC_PATTERN = re.compile(r"\bGC[0-9A-HJKMNPQRTVWXYZ]+\b", re.IGNORECASE)

    def __init__(self) -> None:
        self.name = "geocache_code"
        self.version = "1.1.0"
        self.value_by_char = {ch: index for index, ch in enumerate(self.ALPHABET)}

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()
        output_format = str(inputs.get("output_format", "decimal")).lower()
        scheme = str(inputs.get("scheme", "auto")).lower()
        strict_mode = str(inputs.get("strict", "smooth")).lower() == "strict"
        embedded = self._parse_bool(inputs.get("embedded", False), default=False)
        include_prefix = self._parse_bool(inputs.get("include_prefix", True), default=True)
        uppercase = self._parse_bool(inputs.get("uppercase", True), default=True)

        if text is None or str(text).strip() == "":
            return self._error_response("Aucune valeur fournie", start_time)

        text = str(text).strip()

        try:
            if mode == "encode":
                number = self._parse_integer(text)
                code, used_scheme = self.encode_number(number, include_prefix=include_prefix, scheme=scheme)
                if not uppercase:
                    code = code.lower()
                return self._success_response(
                    summary="Encodage GeoCache-Code reussi",
                    results=[
                        {
                            "id": "result_1",
                            "text_output": code,
                            "confidence": 1.0,
                            "parameters": {
                                "mode": "encode",
                                "number": number,
                                "include_prefix": include_prefix,
                                "scheme": scheme,
                            },
                            "metadata": {
                                "scheme": used_scheme,
                                "alphabet": self.ALPHABET,
                                "base": self._base_for_scheme(used_scheme),
                                "base31_offset": self.BASE31_OFFSET,
                            },
                        }
                    ],
                    start_time=start_time,
                )

            if mode == "decode":
                if embedded:
                    fragments = self.extract_gc_codes(text)
                    if not fragments:
                        return self._error_response("Aucun code GC trouve dans le texte", start_time)
                    results = []
                    for index, fragment in enumerate(fragments, start=1):
                        number, used_scheme, body = self.decode_code(fragment["value"], scheme=scheme)
                        normalized = f"GC{body}"
                        results.append(
                            {
                                "id": f"result_{index}",
                                "text_output": self._format_decode_output(normalized, number, output_format),
                                "confidence": 1.0,
                                "parameters": {
                                    "mode": "decode",
                                    "output_format": output_format,
                                    "scheme": scheme,
                                },
                                "metadata": {
                                    "gc_code": normalized,
                                    "number": number,
                                    "scheme": used_scheme,
                                    "start": fragment["start"],
                                    "end": fragment["end"],
                                    "alphabet": self.ALPHABET,
                                    "base": self._base_for_scheme(used_scheme),
                                    "base31_offset": self.BASE31_OFFSET,
                                },
                            }
                        )
                    return self._success_response(
                        summary=f"{len(results)} code(s) GC decode(s)",
                        results=results,
                        start_time=start_time,
                    )

                if strict_mode and not self._is_gc_or_base31(text):
                    return self._error_response("Code GC invalide en mode strict", start_time)

                number, used_scheme, body = self.decode_code(text, scheme=scheme)
                normalized = f"GC{body}"
                return self._success_response(
                    summary="Decodage GeoCache-Code reussi",
                    results=[
                        {
                            "id": "result_1",
                            "text_output": self._format_decode_output(normalized, number, output_format),
                            "confidence": 1.0,
                            "parameters": {
                                "mode": "decode",
                                "output_format": output_format,
                                "scheme": scheme,
                            },
                            "metadata": {
                                "gc_code": normalized,
                                "number": number,
                                "code_body": body,
                                "scheme": used_scheme,
                                "alphabet": self.ALPHABET,
                                "base": self._base_for_scheme(used_scheme),
                                "base31_offset": self.BASE31_OFFSET,
                            },
                        }
                    ],
                    start_time=start_time,
                )

            if mode == "detect":
                fragments = self.extract_gc_codes(text)
                is_match = bool(fragments)
                score = 1.0 if is_match else 0.0
                if not is_match and self._is_gc_or_base31(text):
                    is_match = True
                    score = 0.75
                summary = "GeoCache-Code detecte" if is_match else "Aucun GeoCache-Code detecte"
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
                                "scheme": scheme,
                            },
                            "metadata": {
                                "is_match": is_match,
                                "fragments": fragments,
                                "alphabet": self.ALPHABET,
                                "base": self.BASE,
                            },
                        }
                    ],
                    "plugin_info": self._get_plugin_info(start_time),
                }

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def encode_number(self, number: int, include_prefix: bool = True, scheme: str = "auto") -> Tuple[str, str]:
        if number < 0:
            raise ValueError("Le numero doit etre positif ou nul")

        used_scheme = self._resolve_encode_scheme(number, scheme)
        if used_scheme == "legacy_hex":
            encoded = format(number, "X")
            return (f"GC{encoded}" if include_prefix else encoded), used_scheme

        if used_scheme == "gc_base31":
            number += self.BASE31_OFFSET

        if number == 0:
            encoded = self.ALPHABET[0]
        else:
            digits: List[str] = []
            value = number
            while value > 0:
                value, remainder = divmod(value, self.BASE)
                digits.append(self.ALPHABET[remainder])
            encoded = "".join(reversed(digits))

        return (f"GC{encoded}" if include_prefix else encoded), used_scheme

    def decode_code(self, code: str, scheme: str = "auto") -> Tuple[int, str, str]:
        normalized = self._normalize_code(code, include_prefix=False)
        if not normalized:
            raise ValueError("Code GC vide")

        used_scheme = self._resolve_decode_scheme(normalized, scheme)
        if used_scheme == "legacy_hex":
            if not self._is_legacy_hex_candidate(normalized):
                raise ValueError("Le schema legacy_hex attend un code hexadecimal entre GC0 et GCFFFF")
            return int(normalized, self.HEX_BASE), used_scheme, normalized

        value = 0
        for ch in normalized:
            if ch not in self.value_by_char:
                raise ValueError(f"Caractere invalide pour l'alphabet GC: {ch!r}")
            value = value * self.BASE + self.value_by_char[ch]

        if used_scheme == "gc_base31":
            value -= self.BASE31_OFFSET
            if value < self.LEGACY_MAX_NUMBER + 1:
                raise ValueError("Le schema gc_base31 commence a GCG000")

        return value, used_scheme, normalized

    def extract_gc_codes(self, text: str) -> List[Dict[str, Any]]:
        fragments: List[Dict[str, Any]] = []
        for match in self.GC_PATTERN.finditer(str(text).upper()):
            value = match.group(0)
            try:
                self.decode_code(value)
            except ValueError:
                continue
            fragments.append({"value": value, "start": match.start(), "end": match.end()})
        return fragments

    def _normalize_code(self, code: str, include_prefix: bool) -> str:
        cleaned = re.sub(r"[^0-9A-Z]", "", str(code).upper())
        if cleaned.startswith("GC"):
            cleaned = cleaned[2:]
        if not cleaned:
            raise ValueError("Code GC vide")
        invalid = [ch for ch in cleaned if ch not in self.value_by_char]
        if invalid:
            raise ValueError(f"Caractere(s) invalide(s) pour l'alphabet GC: {', '.join(sorted(set(invalid)))}")
        return f"GC{cleaned}" if include_prefix else cleaned

    def _format_decode_output(self, gc_code: str, number: int, output_format: str) -> str:
        if output_format == "decimal":
            return str(number)
        if output_format == "base31":
            return self._normalize_code(gc_code, include_prefix=False)
        if output_format == "both":
            return f"{self._normalize_code(gc_code, include_prefix=True)} = {number}"
        if output_format == "gc_code":
            return self._normalize_code(gc_code, include_prefix=True)
        raise ValueError("Format de sortie inconnu: utilisez decimal, gc_code, base31 ou both")

    def _resolve_encode_scheme(self, number: int, scheme: str) -> str:
        scheme = self._normalize_scheme(scheme)
        if scheme == "auto":
            return "legacy_hex" if number <= self.LEGACY_MAX_NUMBER else "gc_base31"
        if scheme == "legacy_hex" and number > self.LEGACY_MAX_NUMBER:
            raise ValueError("Le schema legacy_hex ne depasse pas GCFFFF")
        if scheme == "gc_base31" and number <= self.LEGACY_MAX_NUMBER:
            raise ValueError("Le schema gc_base31 commence a 65536 (GCG000)")
        return scheme

    def _resolve_decode_scheme(self, body: str, scheme: str) -> str:
        scheme = self._normalize_scheme(scheme)
        if scheme == "auto":
            return "legacy_hex" if self._is_legacy_hex_candidate(body) else "gc_base31"
        return scheme

    def _normalize_scheme(self, scheme: str) -> str:
        aliases = {
            "base31": "raw_base31",
            "modern_base31": "gc_base31",
            "official_base31": "gc_base31",
            "hex": "legacy_hex",
            "base16": "legacy_hex",
        }
        normalized = aliases.get(str(scheme).lower(), str(scheme).lower())
        if normalized not in {"auto", "legacy_hex", "gc_base31", "raw_base31"}:
            raise ValueError("Schema inconnu: utilisez auto, legacy_hex, gc_base31 ou raw_base31")
        return normalized

    def _is_legacy_hex_candidate(self, body: str) -> bool:
        return 1 <= len(body) <= 4 and all(ch in self.HEX_ALPHABET for ch in body)

    def _base_for_scheme(self, scheme: str) -> int:
        return self.HEX_BASE if scheme == "legacy_hex" else self.BASE

    def _parse_integer(self, text: str) -> int:
        cleaned = str(text).strip().replace("_", "").replace(" ", "")
        if not re.fullmatch(r"\d+", cleaned):
            raise ValueError("L'encodage attend un nombre decimal")
        return int(cleaned)

    def _is_gc_or_base31(self, text: str) -> bool:
        try:
            self._normalize_code(text, include_prefix=False)
            return True
        except ValueError:
            return False

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

    def _success_response(self, summary: str, results: List[Dict[str, Any]], start_time: float) -> Dict[str, Any]:
        return {
            "status": "ok",
            "summary": summary,
            "results": results,
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
    return GeocacheCodePlugin().execute(inputs)
