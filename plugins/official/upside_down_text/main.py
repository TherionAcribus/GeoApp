"""Plugin Upside Down Text (texte retourné à 180°) pour MysterAI.

Le « texte à l'envers » remplace chaque caractère par le glyphe Unicode qui lui
ressemble une fois la page tournée (``a`` → ``ɐ``, ``e`` → ``ǝ``, ``!`` → ``¡``…)
**et** inverse l'ordre de lecture, puisqu'une rotation de 180° amène la fin du
texte à gauche ::

    Hello geocacher!   ->   ¡ɹǝɥɔɐɔoǝƃ ollǝH

Deux tables de référence coexistent et divergent sur une poignée de caractères ;
le plugin les propose toutes les deux via l'entrée ``alphabet`` :

- **CacheSleuth** (défaut, https://www.cachesleuth.com/tools/upsidedown/) : table
  « classique » des générateurs web. Majuscules ``∀ ᗺ ᗡ ⋊ ᴚ ⊥ ∩ Λ``, chiffres
  ``Ɩ ᄅ Ɛ ㄣ ϛ ㄥ``, ``i`` → ``ᴉ``, ``j`` → ``ſ``, ``g`` → ``ƃ``. Gère ``; ' { }``.
- **GC Wizard** (``lib/tools/crypto_and_encodings/upsidedown/``) : majuscules du
  bloc Lisu ``ꓭ ꓷ ꓩ ꓘ ꓤ`` plus ``Ɐ Ꝺ Ʇ Ո Ʌ ꟽ``, chiffres ``⇂ ζ ߈ ဌ`` et ``7`` → ``L``,
  ``i`` → ``!``, ``j`` → ``ſ̣`` (deux points de code), ``g`` → ``ᵷ``. Gère en plus
  ``: - + * # ~ / \\ = < > « »``.

Au **décodage**, les glyphes non-ASCII de l'autre table sont malgré tout reconnus
(un texte trouvé sur un listing vient rarement de l'outil que l'on a choisi) ;
seuls les glyphes ASCII restent propres à l'alphabet sélectionné, pour ne pas
transformer par erreur un ``!`` ou un ``L`` ordinaire.

L'entrée ``character_order`` permet de traiter les générateurs qui retournent les
caractères **sans** inverser l'ordre de lecture (``keep``), ou de produire les
deux lectures (``both``) et de laisser le scoring linguistique du backend
trancher.

Les caractères sans équivalent (accents, ``°``, symboles divers) sont laissés tels
quels, comme dans les deux outils de référence.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple

#: Table CacheSleuth : caractère normal -> caractère retourné.
CACHESLEUTH_TABLE = {
    # Minuscules
    "a": "ɐ", "b": "q", "c": "ɔ", "d": "p", "e": "ǝ", "f": "ɟ", "g": "ƃ", "h": "ɥ", "i": "ᴉ",
    "j": "ɾ", "k": "ʞ", "l": "l", "m": "ɯ", "n": "u", "o": "o", "p": "d", "q": "b", "r": "ɹ",
    "s": "s", "t": "ʇ", "u": "n", "v": "ʌ", "w": "ʍ", "x": "x", "y": "ʎ", "z": "z",
    # Majuscules
    "A": "∀", "B": "ᗺ", "C": "Ɔ", "D": "ᗡ", "E": "Ǝ", "F": "Ⅎ", "G": "⅁", "H": "H", "I": "I",
    "J": "ſ", "K": "⋊", "L": "⅂", "M": "W", "N": "N", "O": "O", "P": "Ԁ", "Q": "Ò", "R": "ᴚ",
    "S": "S", "T": "⊥", "U": "∩", "V": "Λ", "W": "M", "X": "X", "Y": "⅄", "Z": "Z",
    # Chiffres
    "0": "0", "1": "Ɩ", "2": "ᄅ", "3": "Ɛ", "4": "ㄣ", "5": "ϛ", "6": "9", "7": "ㄥ", "8": "8",
    "9": "6",
    # Espace et ponctuation
    " ": " ", ".": "˙", ",": "'", ";": "؛", "!": "¡", "?": "¿", "'": ",", "\"": "„", "(": ")",
    ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "_": "‾", "&": "⅋",
}

#: Table GC Wizard : caractère normal -> caractère retourné.
GCWIZARD_TABLE = {
    # Minuscules
    "a": "ɐ", "b": "q", "c": "ɔ", "d": "p", "e": "ǝ", "f": "ɟ", "g": "ᵷ", "h": "ɥ", "i": "!",
    "j": "ſ̣", "k": "ʞ", "l": "l", "m": "ɯ", "n": "u", "o": "o", "p": "d", "q": "b", "r": "ɹ",
    "s": "s", "t": "ʇ", "u": "n", "v": "ʌ", "w": "ʍ", "x": "x", "y": "ʎ", "z": "z",
    # Majuscules
    "A": "Ɐ", "B": "ꓭ", "C": "Ɔ", "D": "ꓷ", "E": "Ǝ", "F": "Ⅎ", "G": "⅁", "H": "H", "I": "I",
    "J": "ꓩ", "K": "ꓘ", "L": "⅂", "M": "ꟽ", "N": "N", "O": "O", "P": "Ԁ", "Q": "Ꝺ", "R": "ꓤ",
    "S": "S", "T": "Ʇ", "U": "Ո", "V": "Ʌ", "W": "M", "X": "X", "Y": "⅄", "Z": "Z",
    # Chiffres
    "0": "0", "1": "⇂", "2": "ζ", "3": "Ɛ", "4": "߈", "5": "ဌ", "6": "9", "7": "L", "8": "8",
    "9": "6",
    # Espace et ponctuation
    " ": " ", ".": "˙", ",": "'", ":": ":", "!": "¡", "?": "¿", "\"": "„", "(": ")", ")": "(",
    "[": "]", "]": "[", "<": ">", ">": "<", "/": "\\", "\\": "/", "-": "-", "_": "‾", "+": "+",
    "*": "*", "=": "=", "#": "#", "~": "~", "&": "⅋", "«": "»", "»": "«",
}

ENCODE_TABLES: Dict[str, Dict[str, str]] = {
    "cachesleuth": CACHESLEUTH_TABLE,
    "gcwizard": GCWIZARD_TABLE,
}

DEFAULT_ALPHABET = "cachesleuth"
CHARACTER_ORDERS = ("reverse", "keep", "both")


def _build_decode_table(primary: Dict[str, str], secondary: Dict[str, str]) -> Dict[str, str]:
    """Inverse la table de l'alphabet choisi, complétée par l'autre alphabet.

    Les glyphes ASCII de l'alphabet secondaire sont volontairement ignorés :
    accepter le ``!`` de GC Wizard (``i``) ou son ``L`` (``7``) massacrerait un
    texte CacheSleuth où ces caractères sont ordinaires.
    """
    decode: Dict[str, str] = {}
    for plain, flipped in primary.items():
        decode.setdefault(flipped, plain)
    for plain, flipped in secondary.items():
        if flipped.isascii():
            continue
        decode.setdefault(flipped, plain)
    return decode


DECODE_TABLES: Dict[str, Dict[str, str]] = {
    "cachesleuth": _build_decode_table(CACHESLEUTH_TABLE, GCWIZARD_TABLE),
    "gcwizard": _build_decode_table(GCWIZARD_TABLE, CACHESLEUTH_TABLE),
}

#: Caractères non-ASCII produits par l'un ou l'autre alphabet : leur présence
#: signale un texte retourné (mode ``detect``).
SIGNATURE_CHARS = frozenset(
    char
    for table in (CACHESLEUTH_TABLE, GCWIZARD_TABLE)
    for flipped in table.values()
    for char in flipped
    if not char.isascii()
)

#: Glyphes propres à un seul des deux alphabets (identification en mode detect).
CACHESLEUTH_ONLY = frozenset(CACHESLEUTH_TABLE.values()) - frozenset(GCWIZARD_TABLE.values())
GCWIZARD_ONLY = frozenset(GCWIZARD_TABLE.values()) - frozenset(CACHESLEUTH_TABLE.values())


class UpsideDownTextPlugin:
    """Plugin de rotation de texte à 180°.

    Args:
        inputs (dict):
            - text (str) : texte à traiter.
            - mode (str) : ``decode`` (défaut), ``encode`` ou ``detect``.
            - alphabet (str) : ``cachesleuth`` (défaut) ou ``gcwizard``.
            - character_order (str) : ``reverse`` (défaut), ``keep`` ou ``both``.
    """

    def __init__(self) -> None:
        self.name = "upside_down_text"
        self.version = "1.0.0"
        self.description = "Texte retourné à 180° (upside down)"

    # ------------------------------------------------------------------
    # Point d'entrée
    # ------------------------------------------------------------------
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        text = "" if text is None else str(text)
        mode = str(inputs.get("mode") or "decode").strip().lower()
        alphabet = str(inputs.get("alphabet") or DEFAULT_ALPHABET).strip().lower()
        character_order = str(inputs.get("character_order") or "reverse").strip().lower()

        if not text:
            return self._error_response("Aucun texte fourni", start_time)
        if alphabet not in ENCODE_TABLES:
            return self._error_response(
                "Alphabet inconnu: %s (attendu: %s)" % (alphabet, ", ".join(sorted(ENCODE_TABLES))),
                start_time,
            )
        if character_order not in CHARACTER_ORDERS:
            return self._error_response(
                "Ordre inconnu: %s (attendu: %s)" % (character_order, ", ".join(CHARACTER_ORDERS)),
                start_time,
            )

        if mode == "detect":
            return self._detect_response(text, start_time)
        if mode not in {"decode", "encode"}:
            return self._error_response("Mode inconnu: %s" % mode, start_time)

        orders = ("reverse", "keep") if character_order == "both" else (character_order,)
        results: List[Dict[str, Any]] = []
        for index, order in enumerate(orders, start=1):
            reverse = order == "reverse"
            if mode == "encode":
                output, unmapped = self.encode(text, alphabet=alphabet, reverse=reverse)
            else:
                output, unmapped = self.decode(text, alphabet=alphabet, reverse=reverse)
            results.append(
                {
                    "id": "result_%d" % index,
                    "text_output": output,
                    "confidence": 1.0 if mode == "encode" else 0.5,
                    "parameters": {
                        "mode": mode,
                        "alphabet": alphabet,
                        "character_order": order,
                    },
                    "metadata": {
                        "characters_processed": len(text),
                        "unmapped_characters": unmapped[:10],
                        "unmapped_count": len(unmapped),
                    },
                }
            )

        summary = "Texte retourné à 180°" if mode == "encode" else "Texte remis à l'endroit"
        if len(results) > 1:
            summary += " (ordre inversé et ordre conservé)"
        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    # ------------------------------------------------------------------
    # Transformations
    # ------------------------------------------------------------------
    def encode(
        self,
        text: str,
        alphabet: str = DEFAULT_ALPHABET,
        reverse: bool = True,
    ) -> Tuple[str, List[str]]:
        """Retourne le texte à 180°. Renvoie ``(texte, caractères non traduits)``."""
        table = ENCODE_TABLES[alphabet]
        units: List[str] = []
        unmapped: List[str] = []
        for char in text:
            flipped = table.get(char)
            if flipped is None:
                flipped = char
                if not char.isspace() and char not in unmapped:
                    unmapped.append(char)
            units.append(flipped)
        if reverse:
            units.reverse()
        return "".join(units), unmapped

    def decode(
        self,
        text: str,
        alphabet: str = DEFAULT_ALPHABET,
        reverse: bool = True,
    ) -> Tuple[str, List[str]]:
        """Remet à l'endroit un texte retourné. Renvoie ``(texte, glyphes inconnus)``."""
        table = DECODE_TABLES[alphabet]
        units = self._tokenize(text, table)
        if reverse:
            units.reverse()
        output: List[str] = []
        unmapped: List[str] = []
        for unit in units:
            plain = table.get(unit)
            if plain is None:
                plain = unit
                if not unit.isspace() and unit not in unmapped:
                    unmapped.append(unit)
            output.append(plain)
        return "".join(output), unmapped

    @staticmethod
    def _tokenize(text: str, table: Dict[str, str]) -> List[str]:
        """Découpe le texte en unités décodables (gloutonnement, la plus longue d'abord).

        Nécessaire car GC Wizard code ``j`` sur deux points de code (``ſ`` + ``◌̣``).
        """
        max_length = max((len(key) for key in table), default=1)
        units: List[str] = []
        index = 0
        while index < len(text):
            for length in range(min(max_length, len(text) - index), 1, -1):
                candidate = text[index : index + length]
                if candidate in table:
                    units.append(candidate)
                    index += length
                    break
            else:
                units.append(text[index])
                index += 1
        return units

    # ------------------------------------------------------------------
    # Détection
    # ------------------------------------------------------------------
    def _detect_response(self, text: str, start_time: float) -> Dict[str, Any]:
        meaningful = [char for char in text if not char.isspace()]
        hits = [char for char in meaningful if char in SIGNATURE_CHARS]
        score = len(hits) / len(meaningful) if meaningful else 0.0
        is_match = len(hits) >= 2 and score >= 0.15
        summary = "Texte retourné probable" if is_match else "Texte retourné peu probable"
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": "%s (score: %.2f)" % (summary, score),
                    "confidence": float(score),
                    "parameters": {"mode": "detect"},
                    "metadata": {
                        "is_match": is_match,
                        "signature_chars": sorted(set(hits))[:20],
                        "signature_count": len(hits),
                        "suggested_alphabet": self._guess_alphabet(meaningful),
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    @staticmethod
    def _guess_alphabet(chars: List[str]) -> str:
        """Alphabet le plus probable, d'après les glyphes propres à chaque table."""
        cachesleuth_hits = sum(1 for char in chars if char in CACHESLEUTH_ONLY)
        gcwizard_hits = sum(1 for char in chars if char in GCWIZARD_ONLY)
        if gcwizard_hits > cachesleuth_hits:
            return "gcwizard"
        return DEFAULT_ALPHABET

    # ------------------------------------------------------------------
    # Réponses
    # ------------------------------------------------------------------
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
    return UpsideDownTextPlugin().execute(inputs)
