from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

try:
    from gc_backend.plugins.code_solving import (
        confidence_from_fragments,
        extract_digit_fragments,
        parse_bool,
        parse_mode_params,
    )
except ImportError:  # execution standalone / tests hors backend
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import (
        confidence_from_fragments,
        extract_digit_fragments,
        parse_bool,
        parse_mode_params,
    )

MORBIT_DIGITS = "123456789"


class MorbitCipherPlugin:
    """Encode and decode the Morbit cipher.

    Morbit first converts plaintext to Morse, separates Morse letters with a
    separator symbol, then substitutes every symbol pair with a key digit.
    """

    PAIRS: Tuple[str, ...] = ("..", ".-", ".x", "-.", "--", "-x", "x.", "x-", "xx")

    def __init__(self) -> None:
        self.name = "morbit_cipher"
        self.version = "1.0.0"

        self._letter_to_morse: Dict[str, str] = {
            "A": ".-",
            "B": "-...",
            "C": "-.-.",
            "D": "-..",
            "E": ".",
            "F": "..-.",
            "G": "--.",
            "H": "....",
            "I": "..",
            "J": ".---",
            "K": "-.-",
            "L": ".-..",
            "M": "--",
            "N": "-.",
            "O": "---",
            "P": ".--.",
            "Q": "--.-",
            "R": ".-.",
            "S": "...",
            "T": "-",
            "U": "..-",
            "V": "...-",
            "W": ".--",
            "X": "-..-",
            "Y": "-.--",
            "Z": "--..",
            "0": "-----",
            "1": ".----",
            "2": "..---",
            "3": "...--",
            "4": "....-",
            "5": ".....",
            "6": "-....",
            "7": "--...",
            "8": "---..",
            "9": "----.",
        }
        self._morse_to_letter: Dict[str, str] = {v: k for k, v in self._letter_to_morse.items()}

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        params = parse_mode_params(inputs, default_mode="decode", default_allowed_chars=" \t\r\n")
        text = inputs.get("text", "")
        mode = params.mode
        key = str(inputs.get("key", "") or "")
        strict_mode = params.strict
        embedded = params.embedded
        allowed_chars = params.allowed_chars
        group_output = parse_bool(inputs.get("group_output", True), default=True)

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        if mode in {"encode", "decode"}:
            try:
                pair_to_digit, digit_to_pair, permutation = self._derive_key_maps(key)
            except ValueError as exc:
                return self._error_response(str(exc), start_time)

            if mode == "encode":
                encoded, metadata = self.encode(text, pair_to_digit, group_output=group_output)
                if not encoded:
                    return self._error_response("Aucun caractere encodable en Morbit", start_time)
                return self._success_response(
                    summary="Encodage Morbit reussi",
                    text_output=encoded,
                    confidence=1.0,
                    parameters={"mode": "encode", "key": key, "permutation": permutation, "group_output": group_output},
                    metadata=metadata,
                    start_time=start_time,
                )

            if strict_mode and not embedded:
                ok, reason = self._is_strict_morbit_digits(text, allowed_chars=allowed_chars)
                if not ok:
                    return self._error_response(f"Code Morbit invalide (strict): {reason}", start_time)

            if embedded:
                decoded, fragments = self._decode_embedded(text, digit_to_pair, allowed_chars=allowed_chars)
                if not fragments:
                    return self._error_response("Aucun fragment Morbit detecte", start_time)
                return self._success_response(
                    summary="Decodage Morbit reussi",
                    text_output=decoded,
                    confidence=self._confidence_from_fragments(text, fragments),
                    parameters={"mode": "decode", "key": key, "permutation": permutation, "embedded": True},
                    metadata={"fragments": fragments, "fragments_count": len(fragments)},
                    start_time=start_time,
                )

            decoded, metadata = self.decode(text, digit_to_pair)
            if not decoded:
                return self._error_response("Decodage Morbit impossible", start_time)
            return self._success_response(
                summary="Decodage Morbit reussi",
                text_output=decoded,
                confidence=0.75 if strict_mode else 0.6,
                parameters={"mode": "decode", "key": key, "permutation": permutation},
                metadata=metadata,
                start_time=start_time,
            )

        if mode == "detect":
            is_match, score, fragments = self.detect(
                text,
                strict_mode=strict_mode,
                embedded=embedded,
                allowed_chars=allowed_chars,
            )
            summary = "Code Morbit detecte" if is_match else "Aucun code Morbit detecte"
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
                        "metadata": {"is_match": is_match, "detection_score": float(score), "fragments": fragments},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    def encode(self, text: str, pair_to_digit: Dict[str, str], group_output: bool = True) -> Tuple[str, Dict[str, Any]]:
        morse_stream, metadata = self._text_to_morbit_stream(text)
        if not morse_stream:
            return "", metadata

        if len(morse_stream) % 2 == 1:
            morse_stream += "x"
            metadata["padding"] = "x"

        pairs = [morse_stream[i : i + 2] for i in range(0, len(morse_stream), 2)]
        digits = "".join(pair_to_digit[pair] for pair in pairs)
        output = self._group_digits(digits, 5) if group_output else digits

        metadata.update(
            {
                "morse_stream": morse_stream,
                "pairs": pairs,
                "pairs_count": len(pairs),
                "digits_count": len(digits),
            }
        )
        return output, metadata

    def decode(self, text: str, digit_to_pair: Dict[str, str]) -> Tuple[str, Dict[str, Any]]:
        digits = re.sub(r"[^1-9]", "", text)
        if not digits:
            return "", {"digits_count": 0}

        morse_stream = "".join(digit_to_pair[digit] for digit in digits)
        decoded, unknown_tokens = self._decode_morbit_stream(morse_stream)

        return decoded, {
            "digits_count": len(digits),
            "morse_stream": morse_stream,
            "unknown_tokens": unknown_tokens,
            "unknown_count": len(unknown_tokens),
        }

    def detect(self, text: str, strict_mode: bool, embedded: bool, allowed_chars: str) -> Tuple[bool, float, List[Dict[str, Any]]]:
        if embedded:
            fragments = self._extract_digit_fragments(text, allowed_chars=allowed_chars)
            if not fragments:
                return False, 0.0, []
            digit_count = sum(int(fragment["digits_count"]) for fragment in fragments)
            span_count = sum(int(fragment["end"]) - int(fragment["start"]) for fragment in fragments)
            score = digit_count / span_count if span_count else 0.0
            if strict_mode:
                fragments = [fragment for fragment in fragments if int(fragment["digits_count"]) >= 2]
                if not fragments:
                    return False, 0.0, []
                score = min(1.0, score + 0.1)
            return score >= 0.45, float(score), fragments

        ok, _reason = self._is_strict_morbit_digits(text, allowed_chars=allowed_chars)
        if ok:
            digits = re.sub(r"[^1-9]", "", text)
            total = len(text.strip()) or 1
            score = min(1.0, (len(digits) / total) + 0.1)
            return True, float(score), []

        if strict_mode:
            return False, 0.0, []

        digits = re.sub(r"[^1-9]", "", text)
        if len(digits) < 2:
            return False, 0.0, []
        score = min(0.6, len(digits) / max(1, len(text)))
        return True, float(score), []

    def _text_to_morbit_stream(self, text: str) -> Tuple[str, Dict[str, Any]]:
        stream_parts: List[str] = []
        unsupported_chars: List[str] = []
        processed_chars = 0
        whitespace_count = 0

        normalized = self._normalize_plaintext(text)
        for ch in normalized:
            if ch in self._letter_to_morse:
                stream_parts.append(self._letter_to_morse[ch])
                stream_parts.append("x")
                processed_chars += 1
                continue

            if ch.isspace():
                whitespace_count += 1
                if stream_parts and stream_parts[-1] != "x":
                    stream_parts.append("x")
                if stream_parts and "".join(stream_parts).endswith("x") and not "".join(stream_parts).endswith("xx"):
                    stream_parts.append("x")
                continue

            unsupported_chars.append(ch)

        metadata: Dict[str, Any] = {
            "processed_chars": processed_chars,
            "whitespace_count": whitespace_count,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
        }
        if unsupported_chars:
            metadata["warning"] = "Certains caracteres non encodables ont ete ignores."

        return "".join(stream_parts), metadata

    def _decode_morbit_stream(self, stream: str) -> Tuple[str, List[str]]:
        output: List[str] = []
        unknown_tokens: List[str] = []
        pending_space = False

        for token in stream.split("x"):
            if token == "":
                if output:
                    pending_space = True
                continue

            decoded = self._morse_to_letter.get(token)
            if decoded is None:
                decoded = "?"
                unknown_tokens.append(token)

            if pending_space and output and output[-1] != " ":
                output.append(" ")
            pending_space = False
            output.append(decoded)

        return "".join(output).strip(), unknown_tokens

    def _decode_embedded(self, text: str, digit_to_pair: Dict[str, str], allowed_chars: str) -> Tuple[str, List[Dict[str, Any]]]:
        fragments = self._extract_digit_fragments(text, allowed_chars=allowed_chars)
        if not fragments:
            return text, []

        decoded_text = text
        for fragment in sorted(fragments, key=lambda item: int(item["start"]), reverse=True):
            decoded, metadata = self.decode(str(fragment["value"]), digit_to_pair)
            fragment["decoded"] = decoded
            fragment["unknown_count"] = metadata.get("unknown_count", 0)
            decoded_text = decoded_text[: int(fragment["start"])] + decoded + decoded_text[int(fragment["end"]) :]

        return decoded_text, fragments

    def _extract_digit_fragments(self, text: str, allowed_chars: str) -> List[Dict[str, Any]]:
        return extract_digit_fragments(
            text,
            digit_chars=MORBIT_DIGITS,
            allowed_chars=allowed_chars,
            min_digits=2,
            fragment_type="morbit_cipher",
        )

    def _derive_key_maps(self, key: str) -> Tuple[Dict[str, str], Dict[str, str], str]:
        permutation = self._derive_permutation(key)
        pair_to_digit = {pair: digit for pair, digit in zip(self.PAIRS, permutation)}
        digit_to_pair = {digit: pair for pair, digit in pair_to_digit.items()}
        return pair_to_digit, digit_to_pair, permutation

    def _derive_permutation(self, key: str) -> str:
        compact = re.sub(r"\s+", "", key or "")
        digits = re.sub(r"\D", "", compact)
        if digits and len(digits) == 9 and set(digits) == set("123456789"):
            return digits

        letters = re.sub(r"[^A-Z]", "", self._normalize_plaintext(key or ""))
        if len(letters) != 9:
            raise ValueError("Cle Morbit requise: 9 lettres ou permutation de 1 a 9")

        ranks = [0] * 9
        for rank, (index, _ch) in enumerate(sorted(enumerate(letters), key=lambda item: (item[1], item[0])), start=1):
            ranks[index] = rank
        return "".join(str(rank) for rank in ranks)

    def _is_strict_morbit_digits(self, text: str, allowed_chars: str) -> Tuple[bool, str]:
        has_digit = False
        allowed = set(allowed_chars or "")
        for ch in text:
            if ch in "123456789":
                has_digit = True
                continue
            if ch in allowed:
                continue
            if ch == "0":
                return False, "le chiffre 0 n'est pas valide en Morbit"
            return False, f"caractere non autorise: {ch!r}"
        if not has_digit:
            return False, "aucun chiffre 1-9 detecte"
        return True, ""

    def _normalize_plaintext(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKD", text)
        without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        return without_marks.upper()

    def _group_digits(self, digits: str, group_size: int) -> str:
        return " ".join(digits[i : i + group_size] for i in range(0, len(digits), group_size))

    def _confidence_from_fragments(self, text: str, fragments: List[Dict[str, Any]]) -> float:
        return confidence_from_fragments(text, fragments, base=0.35, scale=0.65)

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
    return MorbitCipherPlugin().execute(inputs)
