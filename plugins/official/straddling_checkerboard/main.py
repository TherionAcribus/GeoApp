from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Dict, List, Tuple

try:
    from gc_backend.plugins.code_solving import parse_bool
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import parse_bool


class StraddlingCheckerboardPlugin:
    """Encode/decode a straddling checkerboard as digit groups.

    The default board matches the Wikipedia example:
    top row "ET AON RIS", row labels 2 and 6, with "/" as numeric escape.
    """

    DEFAULT_HEADERS = "0123456789"
    DEFAULT_TOP_ROW = "ET AON RIS"
    DEFAULT_FILL = "BCDFGHJKLMPQ/UVWXYZ."
    DEFAULT_SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ./"

    def __init__(self) -> None:
        self.name = "straddling_checkerboard"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        headers = str(inputs.get("headers", self.DEFAULT_HEADERS) or self.DEFAULT_HEADERS)
        top_row = str(inputs.get("top_row", self.DEFAULT_TOP_ROW) or self.DEFAULT_TOP_ROW)
        alphabet_key = str(inputs.get("alphabet_key", "") or "")
        fill_order = str(inputs.get("fill_order", "") or "")
        numeric_mode = str(inputs.get("numeric_mode", "single_escape") or "single_escape").lower()
        numeric_key = str(inputs.get("numeric_key", "") or "")
        output_format = str(inputs.get("output_format", "digits") or "digits").lower()
        group_output = parse_bool(inputs.get("group_output", False), default=False)
        group_size = self._parse_int(inputs.get("group_size", 5), default=5)

        if text is None or str(text).strip() == "":
            return self._error_response("Aucun texte fourni", start_time)

        try:
            checkerboard = self.build_checkerboard(headers, top_row, alphabet_key, fill_order)

            if mode == "encode":
                digits, encode_meta = self.encode_to_digits(str(text), checkerboard, numeric_mode)
                if not digits:
                    return self._error_response("Aucun caractere encodable avec la grille", start_time)

                keyed = self.apply_numeric_key(digits, numeric_key, subtract=False)
                if output_format == "digits":
                    output = self._group_digits(keyed, group_size) if group_output else keyed
                    output_meta: Dict[str, Any] = {}
                elif output_format == "letters":
                    output, output_meta = self.digits_to_letters(keyed, checkerboard)
                else:
                    return self._error_response("Format de sortie inconnu: utilisez digits ou letters", start_time)

                metadata = self._metadata(checkerboard)
                metadata.update(encode_meta)
                metadata.update(output_meta)
                metadata.update(
                    {
                        "digits_before_numeric_key": digits,
                        "digits_after_numeric_key": keyed,
                        "numeric_key": self._clean_digits(numeric_key),
                        "numeric_mode": numeric_mode,
                        "output_format": output_format,
                    }
                )
                return self._success_response(
                    "Encodage Straddling Checkerboard reussi",
                    output,
                    1.0,
                    self._parameters(mode, headers, top_row, alphabet_key, fill_order, numeric_mode, numeric_key, output_format),
                    metadata,
                    start_time,
                )

            if mode == "decode":
                digits, input_meta = self.input_to_digits(str(text), checkerboard)
                if not digits:
                    return self._error_response("Aucun chiffre exploitable", start_time)

                unkeyed = self.apply_numeric_key(digits, numeric_key, subtract=True)
                plaintext, decode_meta = self.decode_digits(unkeyed, checkerboard, numeric_mode)
                metadata = self._metadata(checkerboard)
                metadata.update(input_meta)
                metadata.update(decode_meta)
                metadata.update(
                    {
                        "digits_before_numeric_key": digits,
                        "digits_after_numeric_key": unkeyed,
                        "numeric_key": self._clean_digits(numeric_key),
                        "numeric_mode": numeric_mode,
                    }
                )
                return self._success_response(
                    "Decodage Straddling Checkerboard reussi",
                    plaintext,
                    0.9,
                    self._parameters(mode, headers, top_row, alphabet_key, fill_order, numeric_mode, numeric_key, output_format),
                    metadata,
                    start_time,
                )

            if mode == "detect":
                return self._detect_response(str(text), checkerboard, start_time)

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def build_checkerboard(
        self,
        headers: str = DEFAULT_HEADERS,
        top_row: str = DEFAULT_TOP_ROW,
        alphabet_key: str = "",
        fill_order: str = "",
    ) -> Dict[str, Any]:
        headers_clean = self._clean_digits(headers)
        if len(headers_clean) != 10 or set(headers_clean) != set("0123456789"):
            raise ValueError("La ligne d'en-tete doit etre une permutation des chiffres 0-9")

        top = self._normalize_top_row(top_row)
        if len(top) != 10 or top.count(" ") != 2:
            raise ValueError("La premiere ligne doit contenir 10 positions avec exactement 2 espaces")

        row_labels = [headers_clean[index] for index, ch in enumerate(top) if ch == " "]
        top_letters = [ch for ch in top if ch != " "]
        if len(set(top_letters)) != len(top_letters):
            raise ValueError("La premiere ligne contient des symboles dupliques")

        fill_symbols = self._build_fill_symbols(top_letters, alphabet_key, fill_order)

        encode_map: Dict[str, str] = {}
        decode_map: Dict[str, str] = {}

        for index, ch in enumerate(top):
            if ch == " ":
                continue
            code = headers_clean[index]
            encode_map[ch] = code
            decode_map[code] = ch

        pos = 0
        for row_label in row_labels:
            for header in headers_clean:
                ch = fill_symbols[pos]
                pos += 1
                code = row_label + header
                encode_map[ch] = code
                decode_map[code] = ch

        return {
            "headers": headers_clean,
            "top_row": top,
            "row_labels": row_labels,
            "fill_symbols": "".join(fill_symbols),
            "encode_map": encode_map,
            "decode_map": decode_map,
            "number_shift": encode_map.get("/"),
        }

    def encode_to_digits(self, text: str, checkerboard: Dict[str, Any], numeric_mode: str) -> Tuple[str, Dict[str, Any]]:
        encode_map: Dict[str, str] = checkerboard["encode_map"]
        number_shift = checkerboard["number_shift"]
        normalized = self._normalize_text(text)

        digits: List[str] = []
        unsupported_chars: List[str] = []
        processed_chars = 0
        in_number_mode = False

        def close_number_mode() -> None:
            nonlocal in_number_mode
            if in_number_mode:
                digits.append(number_shift)
                in_number_mode = False

        for ch in normalized:
            if ch.isspace():
                continue

            if ch.isdigit():
                if numeric_mode == "skip":
                    unsupported_chars.append(ch)
                    continue
                if number_shift is None:
                    raise ValueError("La grille doit contenir '/' pour encoder des chiffres")
                if numeric_mode == "single_escape":
                    digits.append(number_shift + ch)
                elif numeric_mode == "triple_escape":
                    if not in_number_mode:
                        digits.append(number_shift)
                        in_number_mode = True
                    digits.append(ch * 3)
                else:
                    raise ValueError("Mode numerique inconnu: utilisez single_escape, triple_escape ou skip")
                processed_chars += 1
                continue

            close_number_mode()
            code = encode_map.get(ch)
            if code is None or ch == "/":
                unsupported_chars.append(ch)
                continue
            digits.append(code)
            processed_chars += 1

        close_number_mode()
        return "".join(digits), {
            "processed_chars": processed_chars,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
        }

    def decode_digits(self, digits: str, checkerboard: Dict[str, Any], numeric_mode: str) -> Tuple[str, Dict[str, Any]]:
        decode_map: Dict[str, str] = checkerboard["decode_map"]
        row_labels = set(checkerboard["row_labels"])
        number_shift = checkerboard["number_shift"]

        output: List[str] = []
        unknown_codes: List[str] = []
        in_number_mode = False
        i = 0
        while i < len(digits):
            if numeric_mode == "triple_escape" and in_number_mode and number_shift and digits.startswith(number_shift, i):
                in_number_mode = False
                i += len(number_shift)
                continue

            if numeric_mode == "triple_escape" and in_number_mode:
                triplet = digits[i : i + 3]
                if len(triplet) == 3 and len(set(triplet)) == 1:
                    output.append(triplet[0])
                    i += 3
                    continue
                unknown_codes.append(triplet)
                output.append("?")
                i += max(1, len(triplet))
                continue

            code = digits[i]
            i += 1
            if code in row_labels:
                if i >= len(digits):
                    unknown_codes.append(code)
                    output.append("?")
                    break
                code += digits[i]
                i += 1

            ch = decode_map.get(code)
            if ch is None:
                unknown_codes.append(code)
                output.append("?")
                continue

            if ch == "/" and numeric_mode == "single_escape":
                if i >= len(digits):
                    unknown_codes.append(code)
                    output.append("?")
                    break
                output.append(digits[i])
                i += 1
                continue

            if ch == "/" and numeric_mode == "triple_escape":
                in_number_mode = True
                continue

            if ch == "/" and numeric_mode == "skip":
                output.append("/")
                continue

            output.append(ch)

        return "".join(output), {"unknown_codes": unknown_codes, "unknown_count": len(unknown_codes)}

    def apply_numeric_key(self, digits: str, numeric_key: str, subtract: bool) -> str:
        key = self._clean_digits(numeric_key)
        if not key:
            return digits

        output: List[str] = []
        for index, digit in enumerate(digits):
            key_digit = int(key[index % len(key)])
            value = int(digit)
            output.append(str((value - key_digit) % 10 if subtract else (value + key_digit) % 10))
        return "".join(output)

    def input_to_digits(self, text: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        digits = self._clean_digits(text)
        letters = self._clean_symbols(text)
        if digits and len(digits) >= len(letters):
            return digits, {"input_format": "digits"}

        encoded, metadata = self.encode_to_digits(text, checkerboard, "skip")
        metadata["input_format"] = "letters"
        return encoded, metadata

    def digits_to_letters(self, digits: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        letters, metadata = self.decode_digits(digits, checkerboard, "skip")
        return letters, {"letters_output_decode": metadata}

    def _build_fill_symbols(self, top_letters: List[str], alphabet_key: str, fill_order: str) -> List[str]:
        if fill_order.strip():
            raw = self._clean_symbols(fill_order)
            symbols = self._unique(raw)
        elif alphabet_key.strip():
            raw = self._clean_symbols(alphabet_key)
            symbols = self._unique(raw)
            for ch in self.DEFAULT_SYMBOLS:
                if ch not in symbols:
                    symbols.append(ch)
        else:
            symbols = list(self.DEFAULT_FILL)

        symbols = [ch for ch in symbols if ch not in top_letters]
        for ch in self.DEFAULT_SYMBOLS:
            if ch not in top_letters and ch not in symbols:
                symbols.append(ch)

        fill_symbols = symbols[:20]
        if len(fill_symbols) != 20 or len(set(fill_symbols)) != 20:
            raise ValueError("Les deux lignes inferieures doivent contenir 20 symboles uniques")
        return fill_symbols

    def _detect_response(self, text: str, checkerboard: Dict[str, Any], start_time: float) -> Dict[str, Any]:
        digits = self._clean_digits(text)
        digit_ratio = len(digits) / max(1, len(text.strip()))
        plausible_digits = len(digits) >= 6 and digit_ratio >= 0.7
        unknown_count = 0
        if plausible_digits:
            _decoded, metadata = self.decode_digits(digits, checkerboard, "skip")
            unknown_count = metadata["unknown_count"]

        is_match = plausible_digits and unknown_count <= max(1, len(digits) // 8)
        score = 0.0 if not plausible_digits else max(0.1, 1.0 - (unknown_count / max(1, len(digits))))
        summary = "Straddling Checkerboard probable" if is_match else "Straddling Checkerboard peu probable"
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": f"{summary} (score: {score:.2f})",
                    "confidence": float(score),
                    "parameters": {"mode": "detect"},
                    "metadata": {
                        "is_match": is_match,
                        "digits_count": len(digits),
                        "digit_ratio": float(digit_ratio),
                        "unknown_count": unknown_count,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _parameters(
        self,
        mode: str,
        headers: str,
        top_row: str,
        alphabet_key: str,
        fill_order: str,
        numeric_mode: str,
        numeric_key: str,
        output_format: str,
    ) -> Dict[str, Any]:
        return {
            "mode": mode,
            "headers": self._clean_digits(headers),
            "top_row": self._normalize_top_row(top_row),
            "alphabet_key": alphabet_key,
            "fill_order": fill_order,
            "numeric_mode": numeric_mode,
            "numeric_key": self._clean_digits(numeric_key),
            "output_format": output_format,
        }

    def _metadata(self, checkerboard: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "headers": checkerboard["headers"],
            "top_row": checkerboard["top_row"],
            "row_labels": checkerboard["row_labels"],
            "fill_symbols": checkerboard["fill_symbols"],
            "number_shift": checkerboard["number_shift"],
            "encode_map": checkerboard["encode_map"],
        }

    def _normalize_text(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKD", str(text))
        without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        return without_marks.upper()

    def _normalize_top_row(self, text: str) -> str:
        normalized = self._normalize_text(text)
        return "".join(ch for ch in normalized if ch == " " or ch in self.DEFAULT_SYMBOLS)

    def _clean_symbols(self, text: str) -> str:
        normalized = self._normalize_text(text)
        return "".join(ch for ch in normalized if ch in self.DEFAULT_SYMBOLS)

    def _clean_digits(self, text: str) -> str:
        return re.sub(r"\D", "", str(text or ""))

    def _unique(self, text: str) -> List[str]:
        output: List[str] = []
        for ch in text:
            if ch not in output:
                output.append(ch)
        return output

    def _parse_int(self, value: Any, default: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(1, min(20, parsed))

    def _split_groups(self, digits: str, size: int) -> List[str]:
        return [digits[i : i + size] for i in range(0, len(digits), size)]

    def _group_digits(self, digits: str, group_size: int) -> str:
        return " ".join(self._split_groups(digits, group_size))

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
        return {"name": self.name, "version": self.version, "execution_time_ms": round(execution_time, 2)}

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {"status": "error", "summary": message, "results": [], "plugin_info": self._get_plugin_info(start_time)}


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return StraddlingCheckerboardPlugin().execute(inputs)
