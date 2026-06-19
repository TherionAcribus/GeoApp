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


class AlphabetRankAddedPlugin:
    """A1Z26 cumulative/additive rank cipher."""

    DEFAULT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    def __init__(self) -> None:
        self.name = "alphabet_rank_added"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        alphabet = self._normalize_alphabet(str(inputs.get("alphabet", self.DEFAULT_ALPHABET) or self.DEFAULT_ALPHABET))
        rank_base = self._parse_rank_base(inputs.get("rank_base", 1))
        use_modulo = parse_bool(inputs.get("use_modulo", False), default=False)
        separator = str(inputs.get("separator", "space") or "space").lower()
        strict = str(inputs.get("strict", "smooth") or "smooth").lower() == "strict"

        if text is None or str(text).strip() == "":
            return self._error_response("Aucun texte fourni", start_time)

        try:
            if mode == "encode":
                encoded, metadata = self.encode(str(text), alphabet=alphabet, rank_base=rank_base, separator=separator)
                if not encoded:
                    return self._error_response("Aucune lettre encodable trouvee", start_time)
                return self._success_response(
                    "Encodage par rang alphabetique additionne reussi",
                    encoded,
                    1.0,
                    {
                        "mode": mode,
                        "alphabet": alphabet,
                        "rank_base": rank_base,
                        "separator": separator,
                    },
                    metadata,
                    start_time,
                )

            if mode == "decode":
                decoded, metadata = self.decode(
                    str(text),
                    alphabet=alphabet,
                    rank_base=rank_base,
                    use_modulo=use_modulo,
                    strict=strict,
                )
                if not decoded:
                    return self._error_response("Aucun nombre exploitable trouve", start_time)
                return self._success_response(
                    "Decodage par rang alphabetique additionne reussi",
                    decoded,
                    0.85,
                    {
                        "mode": mode,
                        "alphabet": alphabet,
                        "rank_base": rank_base,
                        "use_modulo": use_modulo,
                        "strict": "strict" if strict else "smooth",
                    },
                    metadata,
                    start_time,
                )

            if mode == "detect":
                return self._detect_response(str(text), alphabet=alphabet, rank_base=rank_base, start_time=start_time)

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def encode(
        self,
        text: str,
        alphabet: str = DEFAULT_ALPHABET,
        rank_base: int = 1,
        separator: str = "space",
    ) -> Tuple[str, Dict[str, Any]]:
        normalized = self._normalize_text(text)
        rank_by_char = {ch: index + rank_base for index, ch in enumerate(alphabet)}
        cumulative = 0
        numbers: List[int] = []
        unsupported_chars: List[str] = []

        for ch in normalized:
            if ch in rank_by_char:
                cumulative += rank_by_char[ch]
                numbers.append(cumulative)
            elif ch.isspace():
                continue
            else:
                unsupported_chars.append(ch)

        return self._join_numbers(numbers, separator), {
            "numbers": numbers,
            "processed_letters": len(numbers),
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
        }

    def decode(
        self,
        text: str,
        alphabet: str = DEFAULT_ALPHABET,
        rank_base: int = 1,
        use_modulo: bool = False,
        strict: bool = False,
    ) -> Tuple[str, Dict[str, Any]]:
        numbers = self._extract_numbers(text)
        if not numbers:
            return "", {"numbers": [], "differences": [], "invalid_differences": []}

        previous = 0
        chars: List[str] = []
        differences: List[int] = []
        invalid_differences: List[int] = []
        alphabet_len = len(alphabet)

        for number in numbers:
            diff = number - previous
            previous = number
            differences.append(diff)
            index = self._rank_to_index(diff, alphabet_len, rank_base, use_modulo)
            if index is None:
                invalid_differences.append(diff)
                if strict:
                    raise ValueError(f"Difference hors alphabet: {diff}")
                chars.append("?")
            else:
                chars.append(alphabet[index])

        return "".join(chars), {
            "numbers": numbers,
            "differences": differences,
            "invalid_differences": invalid_differences,
            "invalid_count": len(invalid_differences),
            "used_modulo": use_modulo,
        }

    def _rank_to_index(self, rank: int, alphabet_len: int, rank_base: int, use_modulo: bool) -> int | None:
        if use_modulo:
            if rank_base == 1:
                return (rank - 1) % alphabet_len
            return rank % alphabet_len

        min_rank = rank_base
        max_rank = rank_base + alphabet_len - 1
        if min_rank <= rank <= max_rank:
            return rank - rank_base
        return None

    def _detect_response(self, text: str, alphabet: str, rank_base: int, start_time: float) -> Dict[str, Any]:
        numbers = self._extract_numbers(text)
        if not numbers:
            score = 0.0
            is_match = False
            increasing_ratio = 0.0
            valid_diff_ratio = 0.0
            differences: List[int] = []
        else:
            previous = 0
            differences = []
            increasing_count = 0
            valid_diff_count = 0
            min_rank = rank_base
            max_rank = rank_base + len(alphabet) - 1
            for number in numbers:
                diff = number - previous
                differences.append(diff)
                if number >= previous:
                    increasing_count += 1
                if min_rank <= diff <= max_rank:
                    valid_diff_count += 1
                previous = number
            increasing_ratio = increasing_count / len(numbers)
            valid_diff_ratio = valid_diff_count / len(numbers)
            is_match = len(numbers) >= 3 and valid_diff_ratio >= 0.75 and increasing_ratio >= 0.75
            score = min(1.0, (valid_diff_ratio * 0.7) + (increasing_ratio * 0.3))

        summary = "Rang alphabetique additionne probable" if is_match else "Rang alphabetique additionne peu probable"
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": f"{summary} (score: {score:.2f})",
                    "confidence": float(score),
                    "parameters": {"mode": "detect", "rank_base": rank_base, "alphabet": alphabet},
                    "metadata": {
                        "is_match": is_match,
                        "numbers": numbers,
                        "differences": differences,
                        "increasing_ratio": float(increasing_ratio),
                        "valid_diff_ratio": float(valid_diff_ratio),
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _normalize_text(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKD", str(text))
        without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        return without_marks.upper()

    def _normalize_alphabet(self, alphabet: str) -> str:
        cleaned = []
        for ch in self._normalize_text(alphabet):
            if ch.isalpha() and ch not in cleaned:
                cleaned.append(ch)
        if len(cleaned) < 2:
            raise ValueError("L'alphabet doit contenir au moins deux lettres uniques")
        return "".join(cleaned)

    def _extract_numbers(self, text: str) -> List[int]:
        return [int(match.group(0)) for match in re.finditer(r"-?\d+", str(text))]

    def _join_numbers(self, numbers: List[int], separator: str) -> str:
        if separator == "space":
            sep = " "
        elif separator == "comma":
            sep = ","
        elif separator == "semicolon":
            sep = ";"
        elif separator == "newline":
            sep = "\n"
        else:
            raise ValueError("Separateur inconnu: utilisez space, comma, semicolon ou newline")
        return sep.join(str(number) for number in numbers)

    def _parse_rank_base(self, value: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 1
        if parsed not in {0, 1}:
            raise ValueError("La base de rang doit etre 0 ou 1")
        return parsed

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
    return AlphabetRankAddedPlugin().execute(inputs)
