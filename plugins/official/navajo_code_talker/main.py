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


class NavajoCodeTalkerPlugin:
    """Navajo Code Talker alphabet-only encoder/decoder."""

    # Letter, English mnemonic, historical spelling, modern spelling.
    TABLE: List[Tuple[str, str, str, str]] = [
        ("A", "Ant", "Wol-la-chee", "Wolachii"),
        ("B", "Bear", "Shush", "Shash"),
        ("C", "Cat", "Moasi", "Mosi"),
        ("D", "Deer", "Be", "Biih"),
        ("E", "Elk", "Dzeh", "Dzeeh"),
        ("F", "Fox", "Ma-e", "Maii"),
        ("G", "Goat", "Klizzie", "Tlizi"),
        ("H", "Horse", "Lin", "Lii"),
        ("I", "Ice", "Tkin", "Tin"),
        ("J", "Jackass", "Tkele-cho-gi", "Teliichoi"),
        ("K", "Kid", "Klizzie-yazzi", "Tlizi yazhi"),
        ("L", "Lamb", "Dibeh-yazzi", "Dibe yazhi"),
        ("M", "Mouse", "Na-as-tso-si", "Naastsoosi"),
        ("N", "Nut", "Nesh-chee", "Neeshchii"),
        ("O", "Owl", "Ne-ash-jah", "Neeshjaa"),
        ("P", "Pig", "Bi-sodih", "Bisoodi"),
        ("Q", "Quiver", "Ca-yeilth", "Kaa yeiltiih"),
        ("R", "Rabbit", "Gah", "Gah"),
        ("S", "Sheep", "Dibeh", "Dibe"),
        ("T", "Turkey", "Than-zie", "Tazhii"),
        ("U", "Ute", "No-da-ih", "Noodai"),
        ("V", "Victor", "A-keh-di-glini", "Akehdidlini"),
        ("W", "Weasel", "Gloe-ih", "Dloii"),
        ("X", "Cross", "Al-an-as-dzoh", "Alnaazdzoh"),
        ("Y", "Yucca", "Tsah-as-zih", "Tsaaszi"),
        ("Z", "Zinc", "Besh-do-gliz", "Beesh dootlizh"),
    ]
    EXTRA_ALPHABET_CODES: List[Tuple[str, str]] = [
        ("A", "BE-LA-SANA"),
        ("A", "TSE-NILL"),
        ("B", "NA-HASH-CHID"),
        ("B", "TOISH-JEH"),
        ("C", "TLA-GIN"),
        ("C", "BA-GOSHI"),
        ("D", "CHINDI"),
        ("D", "LHA-CHA-EH"),
        ("E", "AH-JAH"),
        ("E", "AH-NAH"),
        ("F", "CHUO"),
        ("F", "TSA-E-DONIN-EE"),
        ("G", "AH-TAD"),
        ("G", "JEHA"),
        ("H", "TSE-GAH"),
        ("H", "CHA"),
        ("I", "YEH-HES"),
        ("I", "A-CHI"),
        ("J", "AH-YA-TSINNE"),
        ("J", "YIL-DOI"),
        ("K", "JAD-HO-LONI"),
        ("K", "BA-AH-NE-DI-TININ"),
        ("K", "KLIZZIE-YAZZIE"),
        ("L", "DIBEH-YAZZIE"),
        ("L", "AH-JAD"),
        ("L", "NASH-DOIE-TSO"),
        ("M", "TSIN-TLITI"),
        ("M", "BE-TAS-TNI"),
        ("N", "TSAH"),
        ("N", "A-CHIN"),
        ("O", "A-KHA"),
        ("O", "TLO-CHIN"),
        ("P", "CLA-GI-AIH"),
        ("P", "BI-SO-DIH"),
        ("P", "NE-ZHONI"),
        ("R", "DAH-NES-TSA"),
        ("R", "AH-LOSZ"),
        ("S", "KLESH"),
        ("T", "D-AH"),
        ("T", "A-WOH"),
        ("U", "SHI-DA"),
        ("X", "AL-NA-AS-DZOH"),
        ("Z", "BESH-DO-TLIZ"),
    ]
    COMMON_ALIASES: Dict[str, str] = {
        "AL-AN-AS-DZOH": "X",
        "BESH-DO-GLIZ": "Z",
        "DIBEH-YAZZI": "L",
        "KLIZZIE-YAZZI": "K",
        "NE-ASH-JAH": "O",
        "NE-AHS-JAH": "O",
        "TKELE-CHO-G": "J",
        "TKELE-CHO-GI": "J",
        "TSAH-AS-ZIH": "Y",
    }

    def __init__(self) -> None:
        self.name = "navajo_code_talker"
        self.version = "1.0.1"
        self.letter_to_entry = {letter: (english, historical, modern) for letter, english, historical, modern in self.TABLE}
        self.code_to_letter = self._build_decode_map()
        self.max_code_words = max(len(key.split()) for key in self.code_to_letter)

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        spelling = str(inputs.get("spelling", "historical") or "historical").lower()
        keep_word_spaces = parse_bool(inputs.get("keep_word_spaces", True), default=True)
        word_separator = str(inputs.get("word_separator", "/") or "/")
        strict = str(inputs.get("strict", "smooth") or "smooth").lower() == "strict"

        if text is None or str(text).strip() == "":
            return self._error_response("Aucun texte fourni", start_time)

        try:
            if mode == "encode":
                output, metadata = self.encode(
                    str(text),
                    spelling=spelling,
                    keep_word_spaces=keep_word_spaces,
                    word_separator=word_separator,
                )
                return self._success_response(
                    "Encodage Navajo Code Talker reussi",
                    output,
                    1.0,
                    {
                        "mode": mode,
                        "spelling": spelling,
                        "keep_word_spaces": keep_word_spaces,
                        "word_separator": word_separator,
                    },
                    metadata,
                    start_time,
                )

            if mode == "decode":
                output, metadata = self.decode(str(text), word_separator=word_separator, strict=strict)
                if not output:
                    return self._error_response("Aucun mot-code Navajo reconnu", start_time)
                return self._success_response(
                    "Decodage Navajo Code Talker reussi",
                    output,
                    0.85,
                    {"mode": mode, "word_separator": word_separator, "strict": "strict" if strict else "smooth"},
                    metadata,
                    start_time,
                )

            if mode == "detect":
                return self._detect_response(str(text), word_separator=word_separator, start_time=start_time)

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def encode(
        self,
        text: str,
        spelling: str = "historical",
        keep_word_spaces: bool = True,
        word_separator: str = "/",
    ) -> Tuple[str, Dict[str, Any]]:
        spelling_index = self._spelling_index(spelling)
        tokens: List[str] = []
        unsupported_chars: List[str] = []
        processed_letters = 0
        previous_was_separator = False

        for ch in self._strip_diacritics(text).upper():
            if "A" <= ch <= "Z":
                tokens.append(self.letter_to_entry[ch][spelling_index])
                processed_letters += 1
                previous_was_separator = False
            elif ch.isspace() and keep_word_spaces:
                if tokens and not previous_was_separator:
                    tokens.append(word_separator)
                    previous_was_separator = True
            elif ch.isspace():
                continue
            else:
                unsupported_chars.append(ch)

        if tokens and tokens[-1] == word_separator:
            tokens.pop()

        return " ".join(tokens), {
            "processed_letters": processed_letters,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
            "spelling": spelling,
            "alphabet_only": True,
        }

    def decode(self, text: str, word_separator: str = "/", strict: bool = False) -> Tuple[str, Dict[str, Any]]:
        raw_tokens = self._input_tokens(text, word_separator)
        output: List[str] = []
        unknown_tokens: List[str] = []
        matched_codes: List[str] = []
        index = 0

        while index < len(raw_tokens):
            token = raw_tokens[index]
            if token == "|SPACE|":
                if output and output[-1] != " ":
                    output.append(" ")
                index += 1
                continue

            match_letter = None
            match_key = None
            match_length = 0
            max_width = min(self.max_code_words, len(raw_tokens) - index)
            for width in range(max_width, 0, -1):
                candidate_tokens = raw_tokens[index : index + width]
                if "|SPACE|" in candidate_tokens:
                    continue
                candidate = " ".join(candidate_tokens)
                if candidate in self.code_to_letter:
                    match_letter = self.code_to_letter[candidate]
                    match_key = candidate
                    match_length = width
                    break

            if match_letter is None:
                unknown_tokens.append(token)
                if strict:
                    raise ValueError(f"Mot-code Navajo inconnu: {token}")
                index += 1
                continue

            output.append(match_letter)
            matched_codes.append(match_key or "")
            index += match_length

        return "".join(output).strip(), {
            "matched_codes": matched_codes,
            "matched_count": len(matched_codes),
            "unknown_tokens": unknown_tokens,
            "unknown_count": len(unknown_tokens),
            "alphabet_only": True,
        }

    def _detect_response(self, text: str, word_separator: str, start_time: float) -> Dict[str, Any]:
        decoded, metadata = self.decode(text, word_separator=word_separator, strict=False)
        raw_token_count = len([token for token in self._input_tokens(text, word_separator) if token != "|SPACE|"])
        score = metadata["matched_count"] / max(1, raw_token_count)
        is_match = metadata["matched_count"] >= 2 and score >= 0.5
        summary = "Code Talker Navajo probable" if is_match else "Code Talker Navajo peu probable"
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": f"{summary} (score: {score:.2f})",
                    "confidence": float(score),
                    "parameters": {"mode": "detect", "word_separator": word_separator},
                    "metadata": {
                        "is_match": is_match,
                        "decoded_preview": decoded[:80],
                        **metadata,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _build_decode_map(self) -> Dict[str, str]:
        decode_map: Dict[str, str] = {}
        for letter, english, historical, modern in self.TABLE:
            variants = {historical, modern}
            # Accept the English mnemonic only as metadata? No: the user asked to
            # ignore English code words, so only Navajo spellings are decoded.
            for variant in variants:
                decode_map[self._canonical_phrase(variant)] = letter
        for letter, code in self.EXTRA_ALPHABET_CODES:
            decode_map[self._canonical_phrase(code)] = letter
        for code, letter in self.COMMON_ALIASES.items():
            decode_map[self._canonical_phrase(code)] = letter
        return decode_map

    def _input_tokens(self, text: str, word_separator: str) -> List[str]:
        tokens: List[str] = []
        pieces = re.findall(r"[^\W\d_]+|[\/|]+", self._strip_diacritics(text).lower(), flags=re.UNICODE)
        for piece in pieces:
            if piece == word_separator or (word_separator == "/" and set(piece) <= {"/", "|"}):
                tokens.append("|SPACE|")
            elif set(piece) <= {"/", "|"}:
                tokens.append("|SPACE|")
            else:
                tokens.append(piece)
        return tokens

    def _canonical_phrase(self, text: str) -> str:
        return " ".join(re.findall(r"[a-z]+", self._strip_diacritics(text).lower()))

    def _strip_diacritics(self, text: str) -> str:
        replacements = {
            "ł": "l",
            "Ł": "L",
            "į": "i",
            "ǫ": "o",
            "ą": "a",
            "ʼ": "",
            "'": "",
            "’": "",
        }
        replaced = "".join(replacements.get(ch, ch) for ch in str(text))
        normalized = unicodedata.normalize("NFKD", replaced)
        return "".join(ch for ch in normalized if not unicodedata.combining(ch))

    def _spelling_index(self, spelling: str) -> int:
        if spelling == "historical":
            return 1
        if spelling == "modern":
            return 2
        raise ValueError("Graphie inconnue: utilisez historical ou modern")

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
    return NavajoCodeTalkerPlugin().execute(inputs)
