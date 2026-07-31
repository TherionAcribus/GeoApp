"""Plugin Keyboard Shift pour MysterAI.

Ce plugin encode/décode un texte en décalant chaque caractère de N positions
le long de la séquence physique des touches d'un clavier, à la manière de
l'outil « Qwerty (Keyboard) Shifter » de CacheSleuth
(https://www.cachesleuth.com/tools/keyboardshift/).

Principe : les touches du clavier sont mises bout à bout en une seule
séquence circulaire (lecture de haut en bas, gauche à droite), et chaque
caractère du texte est remplacé par la touche située N positions plus loin
(direction "right") ou plus tôt (direction "left") dans cette séquence.
Exemple vérifié (CacheSleuth) : décaler "A" de 1 position vers la droite en
QWERTY donne "S" (A est suivi de S dans la séquence QWERTYUIOP-ASDFGHJKL-
ZXCVBNM, la rangée du haut s'enchaînant directement sur la rangée du milieu).

Trois étendues de séquence sont proposées (`charset_scope`) :
- "letters" (26) : QWERTYUIOP ASDFGHJKL ZXCVBNM
- "letters_numbers" (36, défaut) : 1234567890 + les 26 lettres ci-dessus
- "full" (47) : `1234567890-= + QWERTYUIOP[]\\ + ASDFGHJKL;' + ZXCVBNM,./

Les caractères absents de la séquence choisie (espaces, ponctuation hors
`full`, etc.) sont conservés tels quels dans la sortie.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple

try:
    from gc_backend.plugins.scoring import score_text_fast

    _SCORING_AVAILABLE = True
except Exception:  # pragma: no cover - dépendance optionnelle
    score_text_fast = None
    _SCORING_AVAILABLE = False


QWERTY_ROWS = {
    "digits": "1234567890",
    "digits_full": "`1234567890-=",
    "top_letters": "QWERTYUIOP",
    "top_full": "QWERTYUIOP[]\\",
    "home_letters": "ASDFGHJKL",
    "home_full": "ASDFGHJKL;'",
    "bottom_letters": "ZXCVBNM",
    "bottom_full": "ZXCVBNM,./",
}
AZERTY_ROWS = {
    "digits": "1234567890",
    "digits_full": "`1234567890-=",
    "top_letters": "AZERTYUIOP",
    "top_full": "AZERTYUIOP^$",
    "home_letters": "QSDFGHJKLM",
    "home_full": "QSDFGHJKLMù*",
    "bottom_letters": "WXCVBN",
    "bottom_full": "WXCVBN,;:!",
}

LAYOUT_ROWS: Dict[str, Dict[str, str]] = {"qwerty": QWERTY_ROWS, "azerty": AZERTY_ROWS}
VALID_LAYOUTS = tuple(LAYOUT_ROWS.keys())
VALID_SCOPES = ("letters", "letters_numbers", "full")
VALID_DIRECTIONS = ("right", "left")


class KeyboardShiftPlugin:
    """Plugin de décalage de caractères le long d'une séquence clavier.

    Args:
        inputs (dict):
            - text (str): texte à encoder ou décoder
            - mode (str): 'encode' ou 'decode'
            - layout (str, optionnel): 'qwerty' (défaut) ou 'azerty'
            - charset_scope (str, optionnel): 'letters' | 'letters_numbers' (défaut) | 'full'
            - direction (str, optionnel): 'right' (défaut) ou 'left'
            - amount (int, optionnel): nombre de positions à décaler (défaut 1)
            - bruteforce (bool, optionnel): active le brute-force (decode uniquement,
              teste tous les décalages possibles sur QWERTY et AZERTY)

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "keyboard_shift"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        mode = str(inputs.get("mode", "decode")).lower()
        text = str(inputs.get("text", ""))
        layout = str(inputs.get("layout", "qwerty")).lower()
        charset_scope = str(inputs.get("charset_scope", "letters_numbers")).lower()
        direction = str(inputs.get("direction", "right")).lower()
        is_bruteforce = bool(inputs.get("bruteforce", False) or inputs.get("brute_force", False))

        try:
            amount = int(inputs.get("amount", 1))
        except (TypeError, ValueError):
            return self._error_response("Le nombre de positions doit être un entier", start_time)

        is_valid, error_message = self._validate_input(text, layout, charset_scope, direction)
        if not is_valid:
            return self._error_response(error_message, start_time)

        try:
            if mode == "encode":
                return self._execute_shift(text, layout, charset_scope, direction, amount, "encode", start_time)
            if mode == "decode":
                if is_bruteforce:
                    return self._execute_bruteforce_decode(text, charset_scope, start_time)
                return self._execute_shift(text, layout, charset_scope, direction, amount, "decode", start_time)
            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except Exception as exc:  # défense en profondeur : jamais d'exception non gérée
            return self._error_response(f"Erreur inattendue: {exc}", start_time)

    # ------------------------------------------------------------------
    # Construction de la séquence clavier
    # ------------------------------------------------------------------

    @staticmethod
    def _build_sequence(layout: str, charset_scope: str) -> str:
        rows = LAYOUT_ROWS[layout]

        if charset_scope == "letters":
            return (rows["top_letters"] + rows["home_letters"] + rows["bottom_letters"]).upper()
        if charset_scope == "letters_numbers":
            return (rows["digits"] + rows["top_letters"] + rows["home_letters"] + rows["bottom_letters"]).upper()
        # "full"
        return (rows["digits_full"] + rows["top_full"] + rows["home_full"] + rows["bottom_full"]).upper()

    @staticmethod
    def _apply_shift(text: str, shift: int, sequence: str) -> Tuple[str, int, int]:
        char_to_index = {ch: i for i, ch in enumerate(sequence)}
        n = len(sequence)

        output: List[str] = []
        shifted_count = 0
        passthrough_count = 0

        for ch in text:
            idx = char_to_index.get(ch.upper())
            if idx is None:
                output.append(ch)
                passthrough_count += 1
                continue

            new_idx = (idx + shift) % n
            output.append(sequence[new_idx])
            shifted_count += 1

        return "".join(output), shifted_count, passthrough_count

    @staticmethod
    def _signed_amount(direction: str, amount: int) -> int:
        magnitude = abs(amount)
        return magnitude if direction == "right" else -magnitude

    # ------------------------------------------------------------------
    # Encode / Decode
    # ------------------------------------------------------------------

    def _execute_shift(
        self,
        text: str,
        layout: str,
        charset_scope: str,
        direction: str,
        amount: int,
        mode: str,
        start_time: float,
    ) -> Dict[str, Any]:
        sequence = self._build_sequence(layout, charset_scope)
        base_shift = self._signed_amount(direction, amount)
        shift = base_shift if mode == "encode" else -base_shift

        text_output, shifted_count, passthrough_count = self._apply_shift(text, shift, sequence)

        if shifted_count == 0:
            return self._error_response(
                "Aucun caractère de l'entrée n'appartient à la séquence clavier sélectionnée.",
                start_time,
            )

        result = {
            "id": "result_1",
            "text_output": text_output,
            "confidence": 1.0 if mode == "encode" else 0.5,
            "parameters": {
                "mode": mode,
                "layout": layout,
                "charset_scope": charset_scope,
                "direction": direction,
                "amount": abs(amount),
            },
            "metadata": {
                "sequence_length": len(sequence),
                "shifted_characters": shifted_count,
                "passthrough_characters": passthrough_count,
            },
        }

        summary = (
            f"{'Encodage' if mode == 'encode' else 'Décodage'} réussi "
            f"({layout}, {charset_scope}, {direction} {abs(amount)})"
        )

        return {
            "status": "ok",
            "summary": summary,
            "results": [result],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _execute_bruteforce_decode(
        self, text: str, charset_scope: str, start_time: float
    ) -> Dict[str, Any]:
        candidates: List[Dict[str, Any]] = []

        for layout in VALID_LAYOUTS:
            sequence = self._build_sequence(layout, charset_scope)
            n = len(sequence)
            for amount in range(1, n):
                text_output, shifted_count, passthrough_count = self._apply_shift(text, -amount, sequence)
                if shifted_count == 0:
                    continue

                candidates.append(
                    {
                        "text_output": text_output,
                        "confidence": self._get_score_fast(text_output),
                        "parameters": {"layout": layout, "amount": amount},
                        "metadata": {
                            "sequence_length": n,
                            "shifted_characters": shifted_count,
                            "passthrough_characters": passthrough_count,
                        },
                    }
                )

        if not candidates:
            return self._error_response(
                "Aucun caractère de l'entrée n'appartient à la séquence clavier sélectionnée.",
                start_time,
            )

        # Déduplication des sorties identiques (même texte obtenu par des décalages différents).
        seen_outputs: set = set()
        unique_candidates: List[Dict[str, Any]] = []
        for candidate in candidates:
            key = candidate["text_output"]
            if key in seen_outputs:
                continue
            seen_outputs.add(key)
            unique_candidates.append(candidate)

        unique_candidates.sort(key=lambda r: r["confidence"], reverse=True)

        results = [
            {
                "id": f"result_{i}",
                "text_output": candidate["text_output"],
                "confidence": candidate["confidence"],
                "parameters": {
                    "mode": "decode",
                    "bruteforce": True,
                    "charset_scope": charset_scope,
                    **candidate["parameters"],
                },
                "metadata": {**candidate["metadata"], "bruteforce_position": i},
            }
            for i, candidate in enumerate(unique_candidates, 1)
        ]

        return {
            "status": "ok",
            "summary": f"Bruteforce: {len(results)} décalage(s) testé(s)",
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    # ------------------------------------------------------------------
    # Divers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_input(text: str, layout: str, charset_scope: str, direction: str) -> Tuple[bool, str]:
        if not text:
            return False, "Entrée vide"

        if layout not in VALID_LAYOUTS:
            return False, f"Disposition clavier inconnue: {layout} (attendu: {', '.join(VALID_LAYOUTS)})"

        if charset_scope not in VALID_SCOPES:
            return False, f"Étendue inconnue: {charset_scope} (attendu: {', '.join(VALID_SCOPES)})"

        if direction not in VALID_DIRECTIONS:
            return False, f"Direction inconnue: {direction} (attendu: {', '.join(VALID_DIRECTIONS)})"

        return True, ""

    @staticmethod
    def _get_score_fast(text: str) -> float:
        if not _SCORING_AVAILABLE or not score_text_fast:
            return 0.5
        try:
            return score_text_fast(text)
        except Exception:
            return 0.5

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
