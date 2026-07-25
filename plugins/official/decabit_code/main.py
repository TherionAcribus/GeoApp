"""Plugin Decabit Code pour MysterAI.

Le code Decabit (« Impulsraster Decabit », développé par Zellweger) est un
codage utilisé en télécommande centralisée / commande à distance par le réseau
électrique (ripple control, CPL). Chaque valeur ASCII de 0 à 126 est représentée
par une trame fixe de **10 symboles** choisis parmi ``+`` (impulsion positive) et
``-`` (impulsion négative).

Encodage : chaque caractère du texte est converti en sa valeur ASCII (0-126)
puis en la trame de 10 symboles correspondante ; les trames sont jointes par un
séparateur (une espace par défaut).

Décodage : la suite de ``+`` et ``-`` est découpée en groupes de 10 symboles,
chaque groupe est recherché dans la table et retraduit en caractère ASCII (ou en
valeur numérique).

Références : https://kryptografie.de/kryptografie/chiffre/decabit.htm et
https://www.cachesleuth.com/tools/decabit/

Le plugin supporte l'encodage, le décodage, une sortie numérique et des symboles
personnalisés (remplacement de ``+`` et ``-`` par deux autres caractères, par
exemple ``1`` et ``0``).
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

#: Table Decabit : ``DECABIT[value]`` est la trame de 10 symboles (+/-) de la
#: valeur ASCII ``value`` (index 0 à 126). Source : cachesleuth / kryptografie.de.
DECABIT: List[str] = [
    "--+-+++-+-", "+--+++--+-", "+--++-+-+-", "+--+-++-+-", "----+++-++",
    "++--+++---", "++--++--+-", "++--+-+-+-", "++---++-+-", "---++++-+-",
    "+-+-+++---", "+-+-+-+-+-", "+-+--++-+-", "+---++-++-", "+---++--++",
    "--+++-++--", "---++-+++-", "+---+-++-+", "+--++--+-+", "+--++-+--+",
    "+-+++--+--", "+--+++-+--", "++--+-++--", "-+-++-++--", "+--++--++-",
    "+-+++-+---", "++-+--++--", "+-+-+-++--", "+--+-+++--", "+--+--++-+",
    "+-++-++---", "+-++-+-+--", "+-+-++-+--", "+---++++--", "+-+--+-++-",
    "+++--++---", "+++--+-+--", "+++---++--", "++---+++--", "--+-++++--",
    "++--++-+--", "-+-+-+-++-", "++----+++-", "+----+-+++", "++---+-+-+",
    "++-+-+-+--", "++-+-+--+-", "+++----++-", "++--+--++-", "+--+-+-++-",
    "++++----+-", "++-++---+-", "+-+++---+-", "-++++---+-", "+-+-+---++",
    "+++-++----", "+++-+-+---", "+-+-+--++-", "-++-+--++-", "+++-+----+",
    "++++-+----", "-+++-++---", "-+-+-++-+-", "++---++--+", "++-+--+--+",
    "++-+++----", "++++--+---", "+--++++---", "-+-++++---", "++-+--+-+-",
    "-++---+++-", "+---+-+++-", "--+-+-+++-", "+----++++-", "--+--++++-",
    "+++---+-+-", "+-++---++-", "+--+--+++-", "--++--+++-", "+-+---+-++",
    "-+++--+-+-", "-+-++-+-+-", "-+++---++-", "-+-++--++-", "-+---++++-",
    "-++++--+--", "-++-++-+--", "--++++-+--", "--++-+++--", "--++-+-++-",
    "+-++++----", "--++++--+-", "--++-++-+-", "+--+-+--++", "+-++----++",
    "-+-+++--+-", "-++-+-+-+-", "-+--++-++-", "---+++-++-", "-+--+-+++-",
    "+---+++-+-", "-+--+++-+-", "+-+-++--+-", "+--++-++--", "++-++--+--",
    "+-++--++--", "+-+--+++--", "-++--+++--", "++---+-++-", "++-+---++-",
    "+++-+---+-", "+++-+--+--", "++-+-++---", "++-++-+---", "+-+---+++-",
    "+-++--+-+-", "-+-+--+++-", "-+++-+-+--", "+-++-+--+-", "-++-+++---",
    "+++--+--+-", "+++++-----", "-+++++----", "--+++++---", "---+++++--",
    "----+++++-", "++++++++++",
]

#: Nombre de symboles par trame Decabit.
FRAME_LEN = 10


class DecabitCodePlugin:
    """Plugin d'encodage/décodage du code Decabit.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (caractères en encode, symboles en decode).
            - mode (str): 'encode' ou 'decode'.
            - symbols (str, optionnel): Deux caractères distincts remplaçant
              respectivement ``+`` et ``-``.
            - separator (str, optionnel): Séparateur entre trames (encodage).
            - output (str, optionnel): 'ascii' (défaut) ou 'numbers' (décodage).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    #: Symboles standards : indice 0 = ``+``, indice 1 = ``-``.
    DEFAULT_SYMBOLS = "+-"

    def __init__(self) -> None:
        self.name = "decabit_code"
        self.version = "1.0.0"
        #: Table inverse trame -> valeur (construite une fois).
        self._reverse = {frame: value for value, frame in enumerate(DECABIT)}

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text:
            return self._error_response("Aucun texte fourni", start_time)

        symbols = self._resolve_symbols(inputs.get("symbols"))
        if symbols is None:
            return self._error_response(
                "Les symboles personnalisés doivent être 2 caractères distincts",
                start_time,
            )

        if mode == "encode":
            separator = inputs.get("separator")
            if not isinstance(separator, str):
                separator = " "
            output, encoded, skipped = self._encode(text, symbols, separator)
            if encoded == 0:
                return self._error_response(
                    "Aucun caractère ASCII (0-126) à encoder", start_time
                )
            return {
                "status": "ok",
                "summary": f"Encodage Decabit réussi ({encoded} caractère(s))",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 1.0,
                        "parameters": {"mode": "encode", "symbols": symbols},
                        "metadata": {
                            "encoded_chars": encoded,
                            "skipped_chars": skipped,
                        },
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "decode":
            output_mode = str(inputs.get("output", "ascii")).lower()
            output, frames, unknown = self._decode(text, symbols, output_mode)
            if frames == 0:
                return self._error_response(
                    "Aucune trame Decabit valide (10 symboles) trouvée dans le texte",
                    start_time,
                )
            return {
                "status": "ok",
                "summary": f"Décodage Decabit réussi ({frames} trame(s))",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 0.5,
                        "parameters": {
                            "mode": "decode",
                            "symbols": symbols,
                            "output": output_mode,
                        },
                        "metadata": {
                            "frames_decoded": frames,
                            "unknown_frames": unknown,
                        },
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    def _resolve_symbols(self, raw: Any) -> Optional[str]:
        """Retourne la table de symboles à utiliser (défaut ou personnalisée)."""
        if raw is None:
            return self.DEFAULT_SYMBOLS
        symbols = str(raw)
        if symbols == "":
            return self.DEFAULT_SYMBOLS
        if len(symbols) != 2 or len(set(symbols)) != 2:
            return None
        return symbols

    def _encode(self, text: str, symbols: str, separator: str) -> Tuple[str, int, int]:
        """Encode un texte : chaque caractère ASCII 0-126 -> trame de 10 symboles.

        Retourne (texte encodé, caractères encodés, caractères ignorés).
        """
        frames: List[str] = []
        skipped = 0
        for ch in text:
            value = ord(ch)
            if 0 <= value < len(DECABIT):
                frames.append(self._translate(DECABIT[value], symbols))
            else:
                # Caractères hors ASCII (0-126) : impossibles à encoder.
                skipped += 1
        return separator.join(frames), len(frames), skipped

    def _decode(
        self, text: str, symbols: str, output_mode: str
    ) -> Tuple[str, int, int]:
        """Décode une suite de symboles en texte.

        Retourne (texte, nombre de trames décodées, trames inconnues).
        """
        plus, minus = symbols[0], symbols[1]
        # Ne conserver que les symboles significatifs, normalisés en +/-.
        bits: List[str] = []
        for ch in text:
            if ch == plus:
                bits.append("+")
            elif ch == minus:
                bits.append("-")
            # Tout le reste (espaces, séparateurs, ponctuation) est ignoré.

        pieces: List[str] = []
        frames = 0
        unknown = 0
        usable = len(bits) - len(bits) % FRAME_LEN
        for i in range(0, usable, FRAME_LEN):
            frame = "".join(bits[i:i + FRAME_LEN])
            frames += 1
            value = self._reverse.get(frame)
            if value is None:
                pieces.append("?")
                unknown += 1
            elif output_mode == "numbers":
                pieces.append(str(value))
            else:
                pieces.append(chr(value))

        joiner = " " if output_mode == "numbers" else ""
        return joiner.join(pieces), frames, unknown

    def _translate(self, frame: str, symbols: str) -> str:
        """Remplace ``+``/``-`` d'une trame par les symboles configurés.

        Traduction caractère par caractère : un simple double ``str.replace``
        casserait pour des symboles qui réutilisent ``+``/``-`` (ex. « -+ »).
        """
        if symbols == self.DEFAULT_SYMBOLS:
            return frame
        table = {"+": symbols[0], "-": symbols[1]}
        return "".join(table[c] for c in frame)

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
    return DecabitCodePlugin().execute(inputs)
