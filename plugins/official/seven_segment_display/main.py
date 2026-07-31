"""Plugin Afficheur 7 segments pour MysterAI.

Ce plugin encode/décode les caractères dessinés sur un afficheur 7 segments
(horloges, calculatrices, compteurs). Les sept segments sont nommés A à G :

        AAAA
       F    B
       F    B
        GGGG
       E    C
       E    C
        DDDD

Notations supportées (entrée et sortie) :
- ``letters``  : liste des segments allumés par caractère, ex. ``ABCEFG ADEF DEG``
                 (notation de CacheSleuth, https://www.cachesleuth.com/tools/segmentdisplay/)
- ``binary``   : 7 bits par caractère, ex. ``1011100``
- ``decimal``  : valeur 0-127 par caractère
- ``hex``      : valeur 00-7F par caractère
- ``ascii_art``: dessin de l'afficheur (encodage uniquement)

L'ordre des bits par défaut est ``gfedcba`` (le segment A est le bit de poids
faible), qui est la convention de dCode (https://www.dcode.fr/afficheur-7-segments) :
les segments ``cdeg`` y valent ``1011100``. L'ordre ``abcdefg`` (A en poids fort)
est également disponible. Un afficheur à anode commune inverse les 0 et les 1.

La table de correspondance est celle de CacheSleuth (segments -> caractère), qui
couvre chiffres, lettres et ponctuation. Comme un afficheur 7 segments ne peut pas
distinguer certains glyphes (5/S, 0/O, 2/Z, 8/B...), chaque motif porte une liste
de lectures alternatives, exploitable via ``letter_bias`` et le brute-force.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from gc_backend.plugins.scoring import score_text

    _SCORING_AVAILABLE = True
except Exception:  # pragma: no cover - dépendance optionnelle
    score_text = None
    _SCORING_AVAILABLE = False


SEGMENT_LETTERS = "ABCDEFG"

# Table de référence CacheSleuth (segmentdisplay.js, table 7 segments), dans son
# ordre d'origine : le premier motif rencontré pour un caractère donné est celui
# utilisé à l'encodage.
CACHESLEUTH_TABLE: Tuple[Tuple[str, str], ...] = (
    ("ABCEFG", "A"), ("ABCDEG", "a"), ("CDEFG", "B"), ("ADEF", "C"),
    ("DEG", "c"), ("BCDEG", "D"), ("ADEFG", "E"), ("AEFG", "F"),
    ("ACDEF", "G"), ("BCEFG", "H"), ("CEFG", "h"), ("EF", "I"),
    ("ADE", "i"), ("AE", "i"), ("BCD", "J"), ("BCDE", "J"),
    ("ABCDE", "J"), ("ACD", "j"), ("ACEFG", "K"), ("DEF", "L"),
    ("ACEG", "M"), ("ABF", "m"), ("ABCEF", "N"), ("CEG", "n"),
    ("CDEG", "O"), ("ABFG", "O"), ("ABEFG", "P"), ("ABCFG", "Q"),
    ("EG", "R"), ("DEFG", "T"), ("BCDEF", "U"), ("BFG", "u"),
    ("CDE", "u"), ("BEFG", "V"), ("BDF", "V"), ("BDFG", "W"),
    ("BCEF", "X"), ("CE", "X"), ("BCDFG", "Y"), ("ABDE", "Z"),
    ("ABDFG", "!"), ("ABDF", "!"), ("BF", '"'), ("CF", "%"),
    ("ADG", "*"), ("BEG", "/"), ("AFG", "("), ("ABG", ")"),
    ("ABCD", ")"), ("DG", "="), ("ABDG", "?"), ("ABD", "?"),
    ("ABE", "?"), ("F", "'"), ("B", "'"), ("E", "."),
    ("C", "."), ("AD", ":"), ("CD", ","), ("BD", ","),
    ("BCG", "+"), ("EFG", "+"), ("G", "-"), ("D", "_"),
    ("AF", "<"), ("AB", ">"), ("CFG", "\\"), ("ABCE", "@"),
    ("ABCDEF", "0"), ("BC", "1"), ("ABDEG", "2"), ("ABCDG", "3"),
    ("BCFG", "4"), ("ACDFG", "5"), ("ACDEFG", "6"), ("ABC", "7"),
    ("ABCF", "7"), ("ABCDEFG", "8"), ("ABCDFG", "9"),
)

# Lectures alternatives des motifs intrinsèquement ambigus sur 7 segments.
# Elles n'écrasent jamais la lecture CacheSleuth : elles la complètent (option
# `letter_bias`, brute-force) et rendent encodables des caractères absents de la
# table de référence (S, b, d, o, r, t...).
ALTERNATE_READINGS: Dict[str, Tuple[str, ...]] = {
    "ABCDEF": ("O", "D"),      # 0
    "BC": ("I", "l"),          # 1
    "ABDEG": ("Z", "z"),       # 2
    "ACDFG": ("S", "s"),       # 5
    "ABCDEFG": ("B",),         # 8
    "ABCDFG": ("g",),          # 9
    "CDEFG": ("b",),           # B
    "BCDEG": ("d",),           # D
    "ADEFG": ("e",),           # E
    "AEFG": ("f",),            # F
    "EF": ("l", "1"),          # I
    "BCD": ("j",),             # J
    "ACEFG": ("k",),           # K
    "DEF": ("l",),             # L
    "CDEG": ("o",),            # O
    "ABEFG": ("p",),           # P
    "ABCFG": ("q",),           # Q
    "EG": ("r",),              # R
    "DEFG": ("t",),            # T
    "BCDEF": ("u",),           # U
    "BEFG": ("v",),            # V
    "BDFG": ("w",),            # W
    "BCEF": ("x",),            # X
    "BCDFG": ("y",),           # Y
    "ABDE": ("z",),            # Z
}

# Jeton d'espace de CacheSleuth (le "P" de "point"/pause n'est pas un segment).
SPACE_TOKENS = frozenset({"P", "DP"})

TOKEN_SEPARATOR_RE = re.compile(r"[\s,;|/]+")

SEPARATOR_CHARS = {"space": " ", "comma": ", ", "newline": "\n"}

MAX_BRUTEFORCE_RESULTS = 40

# Proportion minimale de caractères A-G dans un groupe pour l'accepter comme un
# motif de segments (évite de « décoder » du texte ordinaire).
MIN_SEGMENT_CHAR_RATIO = 0.6

# Proportion maximale de motifs sans correspondance au-delà de laquelle la
# lecture est considérée comme un faux positif.
MAX_UNKNOWN_RATIO = 0.34


def _normalize_segments(raw: str) -> str:
    """Ordonne et dédoublonne les segments (``GFE`` et ``EFG`` sont identiques)."""
    return "".join(sorted({char for char in raw.upper() if char in SEGMENT_LETTERS}))


def _build_tables() -> Tuple[Dict[str, List[str]], Dict[str, str]]:
    """Construit les tables de décodage (motif -> lectures) et d'encodage."""
    segments_to_chars: Dict[str, List[str]] = {}
    char_to_segments: Dict[str, str] = {}

    for raw_segments, char in CACHESLEUTH_TABLE:
        segments = _normalize_segments(raw_segments)
        candidates = segments_to_chars.setdefault(segments, [])
        if char not in candidates:
            candidates.append(char)
        char_to_segments.setdefault(char, segments)

    for raw_segments, alternates in ALTERNATE_READINGS.items():
        segments = _normalize_segments(raw_segments)
        candidates = segments_to_chars.setdefault(segments, [])
        for char in alternates:
            if char not in candidates:
                candidates.append(char)
            char_to_segments.setdefault(char, segments)

    return segments_to_chars, char_to_segments


SEGMENTS_TO_CHARS, CHAR_TO_SEGMENTS = _build_tables()
# L'espace n'allume aucun segment ; il s'écrit avec le jeton "P" en notation
# par lettres (CacheSleuth accepte aussi "DP").
CHAR_TO_SEGMENTS[" "] = ""


class SevenSegmentDisplayPlugin:
    """Plugin d'encodage/décodage de l'afficheur 7 segments.

    Args:
        inputs (dict):
            - text (str): texte à encoder, ou motifs de segments à décoder
            - mode (str): 'encode' ou 'decode'
            - notation (str, optionnel): 'auto'|'letters'|'binary'|'decimal'|'hex'|'ascii_art'
            - bit_order (str, optionnel): 'gfedcba' (dCode, défaut) ou 'abcdefg'
            - common (str, optionnel): 'cathode' (défaut) ou 'anode' (bits inversés)
            - letter_bias (str, optionnel): 'auto'|'digits'|'letters' pour les motifs ambigus
            - separator (str, optionnel): 'space'|'comma'|'newline' (encodage)
            - bruteforce (bool, optionnel): brute-force (décodage uniquement)

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "seven_segment_display"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = str(inputs.get("text", "") or "")
        mode = str(inputs.get("mode", "decode")).lower()
        notation = str(inputs.get("notation", "auto")).lower()
        bit_order = str(inputs.get("bit_order", "gfedcba")).lower()
        common = str(inputs.get("common", "cathode")).lower()
        letter_bias = str(inputs.get("letter_bias", "auto")).lower()
        separator = str(inputs.get("separator", "space")).lower()
        enable_scoring = bool(inputs.get("enable_scoring", True))
        is_bruteforce = bool(inputs.get("bruteforce", False) or inputs.get("brute_force", False))
        context = inputs.get("context", {}) or {}

        if not text.strip():
            return self._error_response("Entrée vide", start_time)

        try:
            if mode == "encode":
                return self._execute_encode(text, notation, bit_order, common, separator, start_time)
            if mode == "decode":
                if is_bruteforce:
                    return self._execute_bruteforce_decode(text, enable_scoring, context, start_time)
                return self._execute_decode(
                    text, notation, bit_order, common, letter_bias, enable_scoring, context, start_time
                )
            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except Exception as exc:  # défense en profondeur : jamais d'exception non gérée
            return self._error_response(f"Erreur inattendue: {exc}", start_time)

    # ------------------------------------------------------------------
    # Encode
    # ------------------------------------------------------------------

    def _execute_encode(
        self,
        text: str,
        notation: str,
        bit_order: str,
        common: str,
        separator: str,
        start_time: float,
    ) -> Dict[str, Any]:
        if notation == "auto":
            notation = "letters"

        groups: List[Optional[str]] = []
        unsupported: List[str] = []
        for char in text:
            segments = self._encode_char(char)
            if segments is None:
                unsupported.append(char)
                continue
            groups.append(segments)

        if not groups:
            return self._error_response(
                "Aucun caractère du texte n'est représentable sur un afficheur 7 segments.",
                start_time,
            )

        sep = SEPARATOR_CHARS.get(separator, " ")
        rendered = self._render_groups(groups, notation, bit_order, common, sep)

        metadata: Dict[str, Any] = {
            "notation": notation,
            "bit_order": bit_order,
            "common": common,
            "character_count": len(groups),
            "segments_format": sep.join(self._render_group(g, "letters", bit_order, common) for g in groups),
            "binary_format": sep.join(self._render_group(g, "binary", bit_order, common) for g in groups),
            "decimal_format": sep.join(self._render_group(g, "decimal", bit_order, common) for g in groups),
            "hex_format": sep.join(self._render_group(g, "hex", bit_order, common) for g in groups),
            "ascii_art": self._render_ascii(groups),
        }
        if unsupported:
            metadata["unsupported_characters"] = unsupported
            metadata["warning"] = (
                f"{len(unsupported)} caractère(s) non représentable(s) ignoré(s): "
                f"{''.join(unsupported)}"
            )

        summary = f"Encodage 7 segments de {len(groups)} caractère(s) en notation '{notation}'"
        if unsupported:
            summary += f" ({len(unsupported)} caractère(s) ignoré(s))"

        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": rendered,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "notation": notation,
                        "bit_order": bit_order,
                        "common": common,
                        "separator": separator,
                    },
                    "metadata": metadata,
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    @staticmethod
    def _encode_char(char: str) -> Optional[str]:
        """Motif de segments d'un caractère, avec repli sur l'autre casse."""
        if char in CHAR_TO_SEGMENTS:
            return CHAR_TO_SEGMENTS[char]
        if char.isspace():
            return CHAR_TO_SEGMENTS[" "]
        swapped = char.swapcase()
        return CHAR_TO_SEGMENTS.get(swapped)

    # ------------------------------------------------------------------
    # Decode
    # ------------------------------------------------------------------

    def _execute_decode(
        self,
        text: str,
        notation: str,
        bit_order: str,
        common: str,
        letter_bias: str,
        enable_scoring: bool,
        context: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        parsed = self._parse_input(text, notation, bit_order, common)
        if parsed is None:
            return self._error_response(
                "Notation non reconnue. Attendu: segments (ABCEFG ADEF DEG), binaire 7 bits, "
                "décimal 0-127 ou hexadécimal 00-7F.",
                start_time,
            )

        decoded = self._decode_groups(parsed["groups"], letter_bias)
        if not self._is_usable_decoding(decoded, parsed["groups"]):
            return self._error_response("Aucun motif 7 segments valide détecté", start_time)

        confidence = self._calculate_confidence(decoded, parsed)
        result: Dict[str, Any] = {
            "id": "result_1",
            "text_output": decoded["text"],
            "confidence": confidence,
            "parameters": {
                "mode": "decode",
                "notation": parsed["notation"],
                "bit_order": bit_order,
                "common": common,
                "letter_bias": letter_bias,
            },
            "metadata": {
                "detected_notation": parsed["notation"],
                "character_count": len(parsed["groups"]),
                "unknown_groups": decoded["unknown"],
                "segments_format": " ".join(g or "?" for g in parsed["groups"]),
                "alternatives": decoded["alternatives"],
                "ascii_art": self._render_ascii(parsed["groups"]),
            },
        }
        if decoded["ambiguous_positions"]:
            result["metadata"]["ambiguous_positions"] = decoded["ambiguous_positions"]
        if parsed.get("warning"):
            result["metadata"]["warning"] = parsed["warning"]

        if enable_scoring:
            scoring_result = self._get_text_score(decoded["text"], context)
            if scoring_result:
                result["confidence"] = scoring_result.get("score", confidence)
                result["metadata"]["scoring"] = scoring_result

        summary = (
            f"Décodage 7 segments ({parsed['notation']}): {len(parsed['groups'])} caractère(s)"
        )
        if decoded["unknown"]:
            summary += f", {len(decoded['unknown'])} motif(s) inconnu(s)"

        return {
            "status": "ok",
            "summary": summary,
            "results": [result],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _execute_bruteforce_decode(
        self,
        text: str,
        enable_scoring: bool,
        context: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        results: List[Dict[str, Any]] = []
        seen_outputs: set = set()

        for notation in ("letters", "binary", "decimal", "hex"):
            # L'ordre des bits et le type d'afficheur n'ont aucun effet sur la
            # notation par lettres : une seule combinaison suffit.
            bit_orders = ("gfedcba",) if notation == "letters" else ("gfedcba", "abcdefg")
            commons = ("cathode",) if notation == "letters" else ("cathode", "anode")

            for bit_order in bit_orders:
                for common in commons:
                    parsed = self._parse_input(text, notation, bit_order, common)
                    if parsed is None:
                        continue
                    for letter_bias in ("auto", "digits", "letters"):
                        decoded = self._decode_groups(parsed["groups"], letter_bias)
                        output = decoded["text"]
                        if output in seen_outputs or not self._is_usable_decoding(
                            decoded, parsed["groups"]
                        ):
                            continue
                        seen_outputs.add(output)

                        confidence = self._calculate_confidence(decoded, parsed)
                        item: Dict[str, Any] = {
                            "id": f"result_{len(results) + 1}",
                            "text_output": output,
                            "confidence": confidence,
                            "parameters": {
                                "mode": "decode",
                                "bruteforce": True,
                                "notation": notation,
                                "bit_order": bit_order,
                                "common": common,
                                "letter_bias": letter_bias,
                            },
                            "metadata": {
                                "character_count": len(parsed["groups"]),
                                "unknown_groups": decoded["unknown"],
                                "segments_format": " ".join(g or "?" for g in parsed["groups"]),
                            },
                        }
                        if enable_scoring:
                            scoring_result = self._get_text_score(output, context)
                            if scoring_result:
                                item["confidence"] = scoring_result.get("score", confidence)
                                item["metadata"]["scoring"] = scoring_result
                        results.append(item)

        if not results:
            return self._error_response("Aucun motif 7 segments valide détecté", start_time)

        results.sort(key=lambda item: item["confidence"], reverse=True)
        results = results[:MAX_BRUTEFORCE_RESULTS]
        for index, item in enumerate(results, 1):
            item["id"] = f"result_{index}"

        return {
            "status": "ok",
            "summary": f"Bruteforce 7 segments: {len(results)} lecture(s) distincte(s)",
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode_groups(self, groups: Sequence[Optional[str]], letter_bias: str) -> Dict[str, Any]:
        """Traduit une suite de motifs en texte, avec lectures alternatives."""
        chars: List[str] = []
        unknown: List[str] = []
        alternatives: List[List[str]] = []
        ambiguous_positions: List[int] = []

        for index, segments in enumerate(groups):
            if segments is None:
                unknown.append("?")
                chars.append("?")
                alternatives.append([])
                continue
            if segments == "":
                chars.append(" ")
                alternatives.append([" "])
                continue

            candidates = SEGMENTS_TO_CHARS.get(segments)
            if not candidates:
                unknown.append(segments)
                chars.append("?")
                alternatives.append([])
                continue

            chars.append(self._pick_candidate(candidates, letter_bias))
            alternatives.append(list(candidates))
            if len(candidates) > 1:
                ambiguous_positions.append(index)

        return {
            "text": "".join(chars),
            "unknown": unknown,
            "alternatives": alternatives,
            "ambiguous_positions": ambiguous_positions,
        }

    @staticmethod
    def _is_usable_decoding(decoded: Dict[str, Any], groups: Sequence[Optional[str]]) -> bool:
        """Rejette les lectures majoritairement composées de motifs inconnus."""
        total = sum(1 for group in groups if group)
        if not total or not decoded["text"].strip():
            return False
        return len(decoded["unknown"]) / total <= MAX_UNKNOWN_RATIO

    @staticmethod
    def _pick_candidate(candidates: Sequence[str], letter_bias: str) -> str:
        if letter_bias == "digits":
            for candidate in candidates:
                if candidate.isdigit():
                    return candidate
        elif letter_bias == "letters":
            for candidate in candidates:
                if candidate.isalpha():
                    return candidate
        return candidates[0]

    # ------------------------------------------------------------------
    # Analyse de la notation d'entrée
    # ------------------------------------------------------------------

    def _parse_input(
        self, text: str, notation: str, bit_order: str, common: str
    ) -> Optional[Dict[str, Any]]:
        """Découpe l'entrée en motifs de segments selon la notation demandée.

        Renvoie ``None`` si l'entrée n'est pas exploitable dans cette notation.
        Chaque motif est une chaîne de segments triée, ``""`` pour un espace et
        ``None`` pour un groupe illisible.
        """
        tokens = [token for token in TOKEN_SEPARATOR_RE.split(text.strip()) if token]
        if not tokens:
            return None

        if notation in {"auto", "ascii_art"}:
            notation = self._detect_notation(tokens)
            if notation is None:
                return None

        if notation == "letters":
            return self._parse_letters(tokens)
        if notation in {"binary", "decimal", "hex"}:
            return self._parse_numeric(tokens, notation, bit_order, common)
        return None

    @staticmethod
    def _detect_notation(tokens: Sequence[str]) -> Optional[str]:
        upper = [token.upper() for token in tokens]

        if all(re.fullmatch(r"[A-GP]+", token) for token in upper):
            return "letters"
        if all(re.fullmatch(r"[01]+", token) for token in upper):
            return "binary"
        if all(re.fullmatch(r"\d{1,3}", token) and int(token) <= 127 for token in upper):
            return "decimal"
        if all(re.fullmatch(r"(0X)?[0-9A-F]{1,2}", token) for token in upper):
            return "hex"
        # Repli tolérant : on garde les caractères de segments présents.
        if any(re.search(r"[A-GP]", token) for token in upper):
            return "letters"
        return None

    def _parse_letters(self, tokens: Sequence[str]) -> Optional[Dict[str, Any]]:
        """Découpe une entrée en notation par lettres de segments.

        Un jeton majoritairement composé de caractères hors A-G (un libellé, un
        mot de la langue) est écarté : sans ce garde-fou, n'importe quel texte
        produirait une lecture fantaisiste faite des seules lettres A-G qu'il
        contient.
        """
        groups: List[Optional[str]] = []
        dropped = 0

        for token in tokens:
            upper = token.upper()
            if upper in SPACE_TOKENS:
                groups.append("")
                continue
            cleaned = _normalize_segments(upper)
            segment_chars = sum(1 for char in upper if char in SEGMENT_LETTERS)
            if not cleaned or segment_chars / len(upper) < MIN_SEGMENT_CHAR_RATIO:
                dropped += 1
                continue
            groups.append(cleaned)

        if not any(group for group in groups):
            return None

        result: Dict[str, Any] = {"notation": "letters", "groups": groups}
        if dropped:
            result["warning"] = f"{dropped} groupe(s) sans segment reconnu ignoré(s)"
        return result

    def _parse_numeric(
        self, tokens: Sequence[str], notation: str, bit_order: str, common: str
    ) -> Optional[Dict[str, Any]]:
        bit_groups = self._tokens_to_bits(tokens, notation)
        if not bit_groups:
            return None

        groups = [self._bits_to_segments(bits, bit_order, common) for bits in bit_groups]
        return {"notation": notation, "groups": groups}

    @staticmethod
    def _tokens_to_bits(tokens: Sequence[str], notation: str) -> Optional[List[str]]:
        """Convertit les jetons en chaînes de 7 bits (ordre brut, non réordonné)."""
        bit_groups: List[str] = []

        for token in tokens:
            upper = token.upper()
            if notation == "binary":
                if not re.fullmatch(r"[01]+", upper):
                    return None
                if len(upper) > 7:
                    if len(upper) % 7:
                        return None
                    bit_groups.extend(upper[i : i + 7] for i in range(0, len(upper), 7))
                    continue
                bit_groups.append(upper.zfill(7))
                continue

            if notation == "decimal":
                if not re.fullmatch(r"\d+", upper):
                    return None
                value = int(upper)
            else:  # hex
                candidate = upper[2:] if upper.startswith("0X") else upper
                if not re.fullmatch(r"[0-9A-F]+", candidate):
                    return None
                value = int(candidate, 16)

            if value > 127:
                return None
            bit_groups.append(format(value, "07b"))

        return bit_groups or None

    @staticmethod
    def _bits_to_segments(bits: str, bit_order: str, common: str) -> str:
        order = "GFEDCBA" if bit_order == "gfedcba" else SEGMENT_LETTERS
        if common == "anode":
            bits = "".join("0" if bit == "1" else "1" for bit in bits)
        return "".join(sorted(order[i] for i, bit in enumerate(bits) if bit == "1"))

    @staticmethod
    def _segments_to_bits(segments: str, bit_order: str, common: str) -> str:
        order = "GFEDCBA" if bit_order == "gfedcba" else SEGMENT_LETTERS
        active = set(segments)
        bits = "".join("1" if letter in active else "0" for letter in order)
        if common == "anode":
            bits = "".join("0" if bit == "1" else "1" for bit in bits)
        return bits

    # ------------------------------------------------------------------
    # Rendu
    # ------------------------------------------------------------------

    def _render_groups(
        self,
        groups: Sequence[str],
        notation: str,
        bit_order: str,
        common: str,
        separator: str,
    ) -> str:
        if notation == "ascii_art":
            return self._render_ascii(groups)
        return separator.join(self._render_group(g, notation, bit_order, common) for g in groups)

    def _render_group(self, segments: str, notation: str, bit_order: str, common: str) -> str:
        if notation == "letters":
            return segments or "P"
        bits = self._segments_to_bits(segments, bit_order, common)
        if notation == "binary":
            return bits
        value = int(bits, 2)
        if notation == "decimal":
            return str(value)
        if notation == "hex":
            return format(value, "02X")
        return segments or "P"

    @staticmethod
    def _render_ascii(groups: Sequence[Optional[str]]) -> str:
        """Dessine l'afficheur sur trois lignes (4 colonnes par caractère)."""
        rows = ["", "", ""]
        for segments in groups:
            active = set(segments or "")
            rows[0] += " " + ("_" if "A" in active else " ") + "  "
            rows[1] += (
                ("|" if "F" in active else " ")
                + ("_" if "G" in active else " ")
                + ("|" if "B" in active else " ")
                + " "
            )
            rows[2] += (
                ("|" if "E" in active else " ")
                + ("_" if "D" in active else " ")
                + ("|" if "C" in active else " ")
                + " "
            )
        return "\n".join(row.rstrip() for row in rows)

    # ------------------------------------------------------------------
    # Divers
    # ------------------------------------------------------------------

    @staticmethod
    def _calculate_confidence(decoded: Dict[str, Any], parsed: Dict[str, Any]) -> float:
        total = len(parsed["groups"]) or 1
        unknown = len(decoded["unknown"])

        confidence = 0.5 + 0.2 * (1 - unknown / total)
        if unknown:
            confidence -= 0.2
        if parsed["notation"] == "letters":
            confidence += 0.05
        if decoded["ambiguous_positions"]:
            confidence -= 0.05 * min(3, len(decoded["ambiguous_positions"])) / 3
        return round(max(0.0, min(1.0, confidence)), 4)

    @staticmethod
    def _get_text_score(text: str, context: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if not _SCORING_AVAILABLE or not score_text:
            return None
        try:
            return score_text(text, context=context or {})
        except Exception:
            return None

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": round((time.time() - start_time) * 1000, 2),
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }
