"""Plugin DTMF (Dual-Tone Multi-Frequency) pour MysterAI.

Le code DTMF est le système de numérotation à fréquences vocales utilisé par les
téléphones à clavier : chaque touche émet **simultanément** deux fréquences, une
« basse » (ligne du clavier) et une « haute » (colonne du clavier).

```
            1209 Hz  1336 Hz  1477 Hz  1633 Hz
    697 Hz     1        2        3        A
    770 Hz     4        5        6        B
    852 Hz     7        8        9        C
    941 Hz     *        0        #        D
```

Encodage : chaque touche du clavier (0-9, A-D, *, #) est convertie en son couple
de fréquences « basse+haute » ; les couples sont joints par un séparateur.

Décodage : on extrait tous les nombres du texte, on les regroupe deux par deux,
et chaque couple (dans n'importe quel ordre) est rapproché des fréquences
standard — avec une tolérance — pour retrouver la touche correspondante.

Références : https://fr.wikipedia.org/wiki/Code_DTMF et
https://www.cachesleuth.com/tools/dtmf/
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple

#: Fréquences basses (lignes du clavier), en hertz.
LOW_FREQS: Tuple[int, ...] = (697, 770, 852, 941)

#: Fréquences hautes (colonnes du clavier), en hertz.
HIGH_FREQS: Tuple[int, ...] = (1209, 1336, 1477, 1633)

#: Disposition du clavier : ``KEYPAD[ligne][colonne]`` -> touche.
KEYPAD: Tuple[Tuple[str, ...], ...] = (
    ("1", "2", "3", "A"),
    ("4", "5", "6", "B"),
    ("7", "8", "9", "C"),
    ("*", "0", "#", "D"),
)

#: Table touche -> (fréquence basse, fréquence haute).
KEY_TO_FREQS: Dict[str, Tuple[int, int]] = {
    KEYPAD[row][col]: (LOW_FREQS[row], HIGH_FREQS[col])
    for row in range(4)
    for col in range(4)
}

#: Table inverse (fréquence basse, fréquence haute) -> touche.
FREQS_TO_KEY: Dict[Tuple[int, int], str] = {
    freqs: key for key, freqs in KEY_TO_FREQS.items()
}

#: Tolérance par défaut (en Hz) pour rapprocher une valeur d'une fréquence standard.
DEFAULT_TOLERANCE = 20

#: Extraction des nombres (entiers ou décimaux) présents dans le texte.
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


class DtmfCodePlugin:
    """Plugin d'encodage/décodage du code DTMF.

    Args:
        inputs (dict):
            - text (str): Touches à encoder, ou suite de fréquences à décoder.
            - mode (str): 'encode' ou 'decode'.
            - pair_separator (str, optionnel): Chaîne entre les deux fréquences
              d'un même couple (encodage, défaut '+').
            - separator (str, optionnel): Chaîne entre les couples (encodage,
              défaut espace).
            - tolerance (number, optionnel): Écart maximal en Hz toléré au
              décodage pour reconnaître une fréquence (défaut 20).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "dtmf_code"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text:
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "encode":
            return self._run_encode(text, inputs, start_time)
        if mode == "decode":
            return self._run_decode(text, inputs, start_time)
        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------ encode
    def _run_encode(
        self, text: str, inputs: Dict[str, Any], start_time: float
    ) -> Dict[str, Any]:
        pair_separator = inputs.get("pair_separator")
        if not isinstance(pair_separator, str) or pair_separator == "":
            pair_separator = "+"
        separator = inputs.get("separator")
        if not isinstance(separator, str):
            separator = " "

        pairs: List[str] = []
        encoded = 0
        skipped = 0
        for ch in text:
            key = ch.upper() if ch.upper() in KEY_TO_FREQS else ch
            freqs = KEY_TO_FREQS.get(key)
            if freqs is None:
                # Toute touche hors clavier DTMF (lettres E-Z, espaces...) est ignorée.
                if not ch.isspace():
                    skipped += 1
                continue
            low, high = freqs
            pairs.append(f"{low}{pair_separator}{high}")
            encoded += 1

        if encoded == 0:
            return self._error_response(
                "Aucune touche DTMF (0-9, A-D, *, #) à encoder", start_time
            )

        return {
            "status": "ok",
            "summary": f"Encodage DTMF réussi ({encoded} touche(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": separator.join(pairs),
                    "confidence": 1.0,
                    "parameters": {"mode": "encode"},
                    "metadata": {
                        "encoded_keys": encoded,
                        "skipped_chars": skipped,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    # ------------------------------------------------------------------ decode
    def _run_decode(
        self, text: str, inputs: Dict[str, Any], start_time: float
    ) -> Dict[str, Any]:
        tolerance = self._resolve_tolerance(inputs.get("tolerance"))

        numbers = [round(float(tok)) for tok in _NUMBER_RE.findall(text)]
        if len(numbers) < 2:
            return self._error_response(
                "Au moins deux fréquences sont nécessaires pour décoder un couple DTMF",
                start_time,
            )

        keys: List[str] = []
        decoded = 0
        unknown = 0
        usable = len(numbers) - len(numbers) % 2
        for i in range(0, usable, 2):
            key = self._decode_pair(numbers[i], numbers[i + 1], tolerance)
            if key is None:
                keys.append("?")
                unknown += 1
            else:
                keys.append(key)
                decoded += 1

        leftover = len(numbers) - usable  # 0 ou 1 (nombre impair de fréquences)

        return {
            "status": "ok",
            "summary": f"Décodage DTMF réussi ({decoded} touche(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": "".join(keys),
                    "confidence": 0.5,
                    "parameters": {"mode": "decode", "tolerance": tolerance},
                    "metadata": {
                        "keys_decoded": decoded,
                        "unknown_pairs": unknown,
                        "unpaired_frequencies": leftover,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode_pair(self, a: int, b: int, tolerance: int) -> Optional[str]:
        """Retrouve la touche d'un couple de fréquences, ordre indifférent."""
        candidates: List[Tuple[int, str]] = []
        # Ordre (a = basse, b = haute) puis (b = basse, a = haute).
        for low_val, high_val in ((a, b), (b, a)):
            low = self._nearest(low_val, LOW_FREQS, tolerance)
            high = self._nearest(high_val, HIGH_FREQS, tolerance)
            if low is None or high is None:
                continue
            key = FREQS_TO_KEY.get((low, high))
            if key is not None:
                error = abs(low_val - low) + abs(high_val - high)
                candidates.append((error, key))
        if not candidates:
            return None
        # En cas d'ambiguïté (rare vu l'écart entre les bandes), on garde le
        # couple dont l'erreur totale est la plus faible.
        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]

    @staticmethod
    def _nearest(
        value: int, freqs: Tuple[int, ...], tolerance: int
    ) -> Optional[int]:
        """Fréquence standard la plus proche de ``value`` si l'écart <= tolérance."""
        best = min(freqs, key=lambda f: abs(f - value))
        return best if abs(best - value) <= tolerance else None

    def _resolve_tolerance(self, raw: Any) -> int:
        """Normalise la tolérance (Hz) ; repli sur la valeur par défaut."""
        if raw is None or raw == "":
            return DEFAULT_TOLERANCE
        try:
            tol = int(round(float(raw)))
        except (TypeError, ValueError):
            return DEFAULT_TOLERANCE
        return tol if tol >= 0 else DEFAULT_TOLERANCE

    # ------------------------------------------------------------------ divers
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
    return DtmfCodePlugin().execute(inputs)
