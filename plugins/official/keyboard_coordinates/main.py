"""Plugin Keyboard Coordinates pour MysterAI.

Ce plugin encode/décode un texte à partir de la position physique de ses
caractères sur un clavier (ligne, colonne), à la manière de l'outil
« Qwerty (Keyboard) Coordinates » de CacheSleuth
(https://www.cachesleuth.com/tools/keyboardcoordinates/).

Principe : chaque touche a une position (ligne, colonne) déterminée par la
disposition physique réelle du clavier (les rangées sont décalées les unes
par rapport aux autres). Un caractère est encodé sous la forme "LC" (numéro
de ligne suivi du numéro de colonne, sans séparateur interne), les paires
étant séparées par des espaces.

Le décalage ligne/colonne retenu est celui vérifié empiriquement contre
l'outil CacheSleuth (exemple officiel "A = 22/32/42" **et** le mot
GEOCACHING encodé "26 14 110 34 22 34 27 19 37 26") : chaque rangée démarre
à la colonne 2 (la colonne 1 correspond à la touche de modification à
gauche de la rangée : Tab, Verr. Maj., Maj. gauche, etc., qui n'est pas
encodable) :

    Ligne (QWERTY)              col.  Ligne (AZERTY)             col.
    Q W E R T Y U I O P [ ] \\   2-14  A Z E R T Y U I O P ^ $    2-13
    A S D F G H J K L ; '        2-12  Q S D F G H J K L M ù *    2-13
    Z X C V B N M , . /          2-11  W X C V B N , ; : !        2-11

Deux lignes optionnelles peuvent être ajoutées au-dessus (elles ne font que
décaler la numérotation des lignes ci-dessus, cf. `start_row`) :
- "numbers" : la ligne des chiffres (1 2 3 4 5 6 7 8 9 0 - =), colonne 2-13.
- "functions" : la ligne des touches de fonction (F1..F12), non encodable
  mais qui décale d'une ligne supplémentaire.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple

try:
    from gc_backend.plugins.scoring import score_text

    _SCORING_AVAILABLE = True
except Exception:  # pragma: no cover - dépendance optionnelle
    score_text = None
    _SCORING_AVAILABLE = False


# Rangées de lettres, indépendantes du point de départ de la numérotation.
# `offset` = numéro de ligne quand start_row == "letters" (donc avant tout
# décalage éventuel par une ligne chiffres/fonctions au-dessus).
QWERTY_LETTER_ROWS: Tuple[Dict[str, Any], ...] = (
    {"offset": 1, "col_start": 2, "chars": "QWERTYUIOP[]\\"},
    {"offset": 2, "col_start": 2, "chars": "ASDFGHJKL;'"},
    {"offset": 3, "col_start": 2, "chars": "ZXCVBNM,./"},
)
AZERTY_LETTER_ROWS: Tuple[Dict[str, Any], ...] = (
    {"offset": 1, "col_start": 2, "chars": "AZERTYUIOP^$"},
    {"offset": 2, "col_start": 2, "chars": "QSDFGHJKLMù*"},
    {"offset": 3, "col_start": 2, "chars": "WXCVBN,;:!"},
)
NUMBERS_ROW = {"col_start": 2, "chars": "1234567890-="}

LAYOUTS: Dict[str, Tuple[Dict[str, Any], ...]] = {
    "qwerty": QWERTY_LETTER_ROWS,
    "azerty": AZERTY_LETTER_ROWS,
}

# Décalage de ligne appliqué aux rangées de lettres selon le point de départ.
ROW_SHIFT: Dict[str, int] = {"letters": 0, "numbers": 1, "functions": 2}

VALID_LAYOUTS = tuple(LAYOUTS.keys())
VALID_START_ROWS = tuple(ROW_SHIFT.keys())

WORD_BREAK_TOKEN = "/"


class KeyboardCoordinatesPlugin:
    """Plugin d'encodage/décodage des coordonnées clavier (QWERTY/AZERTY).

    Args:
        inputs (dict):
            - text (str): texte à encoder, ou coordonnées à décoder
            - mode (str): 'encode' ou 'decode'
            - layout (str, optionnel): 'qwerty' (défaut) ou 'azerty'
            - start_row (str, optionnel): 'letters' (défaut) | 'numbers' | 'functions'
            - bruteforce (bool, optionnel): active le brute-force (decode uniquement,
              teste les 2 dispositions × les 3 départs de ligne)

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "keyboard_coordinates"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        mode = str(inputs.get("mode", "decode")).lower()
        text = str(inputs.get("text", "")).strip("\n\r")
        layout = str(inputs.get("layout", "qwerty")).lower()
        start_row = str(inputs.get("start_row", "letters")).lower()
        enable_scoring = bool(inputs.get("enable_scoring", True))
        is_bruteforce = bool(inputs.get("bruteforce", False) or inputs.get("brute_force", False))
        context = inputs.get("context", {})

        is_valid, error_message = self._validate_input(text, mode, layout, start_row)
        if not is_valid:
            return self._error_response(error_message, start_time)

        try:
            if mode == "encode":
                return self._execute_encode(text, layout, start_row, start_time)
            if mode == "decode":
                if is_bruteforce:
                    return self._execute_bruteforce_decode(text, enable_scoring, context, start_time)
                return self._execute_decode(text, layout, start_row, enable_scoring, context, start_time)
            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except Exception as exc:  # défense en profondeur : jamais d'exception non gérée
            return self._error_response(f"Erreur inattendue: {exc}", start_time)

    # ------------------------------------------------------------------
    # Cartographie clavier
    # ------------------------------------------------------------------

    @staticmethod
    def _build_maps(layout: str, start_row: str) -> Tuple[Dict[str, Tuple[int, int]], Dict[Tuple[int, int], str]]:
        rows = LAYOUTS[layout]
        shift = ROW_SHIFT[start_row]

        char_to_pos: Dict[str, Tuple[int, int]] = {}
        pos_to_char: Dict[Tuple[int, int], str] = {}

        if start_row in ("numbers", "functions"):
            row_num = shift  # 'numbers' -> 1, 'functions' -> 2
            for i, ch in enumerate(NUMBERS_ROW["chars"]):
                col = NUMBERS_ROW["col_start"] + i
                char_to_pos[ch] = (row_num, col)
                pos_to_char[(row_num, col)] = ch

        for spec in rows:
            row_num = spec["offset"] + shift
            for i, ch in enumerate(spec["chars"]):
                upper_ch = ch.upper()
                col = spec["col_start"] + i
                char_to_pos[upper_ch] = (row_num, col)
                pos_to_char[(row_num, col)] = upper_ch

        return char_to_pos, pos_to_char

    # ------------------------------------------------------------------
    # Encode
    # ------------------------------------------------------------------

    def _execute_encode(self, text: str, layout: str, start_row: str, start_time: float) -> Dict[str, Any]:
        char_to_pos, _ = self._build_maps(layout, start_row)
        tokens, unsupported = self._encode_text(text, char_to_pos)

        if not tokens:
            return self._error_response(
                "Aucun caractère supporté par cette disposition n'a été trouvé dans l'entrée.",
                start_time,
            )

        text_output = " ".join(tokens)

        result = {
            "id": "result_1",
            "text_output": text_output,
            "confidence": 1.0,
            "parameters": {
                "mode": "encode",
                "layout": layout,
                "start_row": start_row,
            },
            "metadata": {
                "layout": layout,
                "start_row": start_row,
                "token_count": len(tokens),
                "unsupported_characters": sorted(set(unsupported)),
            },
        }

        summary = f"Encodage réussi ({layout}, départ={start_row})"
        if unsupported:
            summary += f" — {len(set(unsupported))} caractère(s) ignoré(s)"

        return {
            "status": "ok",
            "summary": summary,
            "results": [result],
            "plugin_info": self._get_plugin_info(start_time),
        }

    @staticmethod
    def _encode_text(text: str, char_to_pos: Dict[str, Tuple[int, int]]) -> Tuple[List[str], List[str]]:
        tokens: List[str] = []
        unsupported: List[str] = []

        for ch in text:
            if ch.isspace():
                if tokens and tokens[-1] != WORD_BREAK_TOKEN:
                    tokens.append(WORD_BREAK_TOKEN)
                continue

            pos = char_to_pos.get(ch.upper())
            if pos is None:
                unsupported.append(ch)
                continue

            row, col = pos
            tokens.append(f"{row}{col}")

        while tokens and tokens[-1] == WORD_BREAK_TOKEN:
            tokens.pop()

        return tokens, unsupported

    # ------------------------------------------------------------------
    # Decode
    # ------------------------------------------------------------------

    def _execute_decode(
        self,
        text: str,
        layout: str,
        start_row: str,
        enable_scoring: bool,
        context: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        _, pos_to_char = self._build_maps(layout, start_row)
        decoded = self._decode_tokens(text, pos_to_char)

        if not decoded["text_output"]:
            return self._error_response(
                "Aucune coordonnée valide n'a pu être décodée pour cette disposition.",
                start_time,
            )

        confidence = self._calculate_confidence(decoded)

        result = {
            "id": "result_1",
            "text_output": decoded["text_output"],
            "confidence": confidence,
            "parameters": {
                "mode": "decode",
                "layout": layout,
                "start_row": start_row,
            },
            "metadata": {
                "layout": layout,
                "start_row": start_row,
                "resolved_count": decoded["resolved_count"],
                "unresolved_tokens": decoded["unresolved_tokens"],
            },
        }

        if enable_scoring:
            scoring_result = self._get_text_score(decoded["text_output"], context)
            if scoring_result:
                result["confidence"] = scoring_result.get("score", confidence)
                result["metadata"]["scoring"] = scoring_result

        summary = f"Décodage réussi ({layout}, départ={start_row})"
        if decoded["unresolved_tokens"]:
            summary += f" — {len(decoded['unresolved_tokens'])} jeton(s) non reconnu(s)"

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

        for layout in VALID_LAYOUTS:
            for start_row in VALID_START_ROWS:
                _, pos_to_char = self._build_maps(layout, start_row)
                decoded = self._decode_tokens(text, pos_to_char)
                if not decoded["text_output"]:
                    continue

                confidence = self._calculate_confidence(decoded)
                entry = {
                    "text_output": decoded["text_output"],
                    "confidence": confidence,
                    "parameters": {"layout": layout, "start_row": start_row},
                    "metadata": {
                        "layout": layout,
                        "start_row": start_row,
                        "resolved_count": decoded["resolved_count"],
                        "unresolved_tokens": decoded["unresolved_tokens"],
                    },
                }

                if enable_scoring:
                    scoring_result = self._get_text_score(decoded["text_output"], context)
                    if scoring_result:
                        entry["confidence"] = scoring_result.get("score", confidence)
                        entry["metadata"]["scoring"] = scoring_result

                results.append(entry)

        if not results:
            return self._error_response(
                "Aucune coordonnée valide n'a pu être décodée pour aucune combinaison clavier/départ.",
                start_time,
            )

        # Déduplication des sorties identiques (ex: chiffres seuls, indépendants du layout).
        seen_outputs: set = set()
        unique_results: List[Dict[str, Any]] = []
        for entry in results:
            key = entry["text_output"]
            if key in seen_outputs:
                continue
            seen_outputs.add(key)
            unique_results.append(entry)

        unique_results.sort(key=lambda r: r["confidence"], reverse=True)

        formatted_results = [
            {
                "id": f"result_{i}",
                "text_output": entry["text_output"],
                "confidence": entry["confidence"],
                "parameters": {"mode": "decode", "bruteforce": True, **entry["parameters"]},
                "metadata": {**entry["metadata"], "bruteforce_variation": i},
            }
            for i, entry in enumerate(unique_results, 1)
        ]

        return {
            "status": "ok",
            "summary": f"Bruteforce: {len(formatted_results)} variation(s) testée(s)",
            "results": formatted_results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    @staticmethod
    def _decode_tokens(text: str, pos_to_char: Dict[Tuple[int, int], str]) -> Dict[str, Any]:
        raw_tokens = text.split()
        output_chars: List[str] = []
        unresolved_tokens: List[str] = []
        resolved_count = 0

        for token in raw_tokens:
            if token == WORD_BREAK_TOKEN:
                output_chars.append(" ")
                continue

            if not re.fullmatch(r"\d{2,3}", token):
                unresolved_tokens.append(token)
                continue

            row = int(token[0])
            col = int(token[1:])
            ch = pos_to_char.get((row, col))
            if ch is None:
                unresolved_tokens.append(token)
                continue

            output_chars.append(ch)
            resolved_count += 1

        return {
            "text_output": "".join(output_chars).strip(),
            "resolved_count": resolved_count,
            "unresolved_tokens": unresolved_tokens,
            "total_tokens": len(raw_tokens),
        }

    @staticmethod
    def _calculate_confidence(decoded: Dict[str, Any]) -> float:
        total = decoded["resolved_count"] + len(decoded["unresolved_tokens"])
        if total == 0:
            return 0.0

        ratio = decoded["resolved_count"] / total
        confidence = 0.3 + 0.5 * ratio

        if not decoded["unresolved_tokens"]:
            confidence += 0.2

        return max(0.0, min(1.0, confidence))

    # ------------------------------------------------------------------
    # Divers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_input(text: str, mode: str, layout: str, start_row: str) -> Tuple[bool, str]:
        if not text or not text.strip():
            return False, "Entrée vide"

        if layout not in VALID_LAYOUTS:
            return False, f"Disposition clavier inconnue: {layout} (attendu: {', '.join(VALID_LAYOUTS)})"

        if start_row not in VALID_START_ROWS:
            return False, f"Départ de ligne inconnu: {start_row} (attendu: {', '.join(VALID_START_ROWS)})"

        if mode == "encode":
            if not re.search(r"[^\s]", text):
                return False, "Aucun caractère à encoder"
            return True, ""

        if mode == "decode":
            if re.search(r"\d{2,3}", text):
                return True, ""
            return (
                False,
                "Format non reconnu. Le décodage attend des paires ligne+colonne séparées par des espaces "
                "(ex: 27 14 210 210 110 pour HELLO).",
            )

        return True, ""

    @staticmethod
    def _get_text_score(text: str, context: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if not _SCORING_AVAILABLE or not score_text:
            return None
        try:
            return score_text(text, context=context or {})
        except Exception:
            return None

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
