"""Plugin Clock Code pour MysterAI.

Le « Clock Code » (CacheSleuth) chiffre chaque lettre par une valeur lue sur une
horloge 12/24 h. La correspondance publiée est la suivante :

- ``A`` = ``AM``
- ``B`` .. ``Y`` = ``1`` .. ``24``  (B=1, C=2, ..., Y=24)
- ``Z`` = ``PM``
- espace (séparateur de mots) = ``00``

À l'encodage, les valeurs sont séparées par ``:`` (chaque mot est donc délimité
par un jeton ``00`` lui aussi entouré de ``:``). Exemple : ``THE`` → ``19:7:4``.

Le décodage extrait les jetons (``AM``, ``PM``, ``00`` ou un nombre) quel que
soit le séparateur employé, ce qui le rend tolérant aux variantes rencontrées
dans les énigmes (``:``, espaces, etc.).

Référence : https://www.cachesleuth.com/tools/clockcode/
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple

_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

#: Jeton d'horloge indexé par la position de la lettre (A=0 .. Z=25), puis
#: l'espace (index 26). Reproduit fidèlement la table CacheSleuth.
_TOKENS: List[str] = (
    ["AM"]
    + [str(n) for n in range(1, 25)]  # B..Y -> 1..24
    + ["PM", "00"]
)

#: Table inverse jeton -> caractère (lettre ou espace).
_TOKEN_TO_CHAR: Dict[str, str] = {
    token: (" " if i == 26 else _ALPHABET[i]) for i, token in enumerate(_TOKENS)
}

#: Repère un jeton valide dans un flux quelconque (AM / PM / suite de chiffres).
_TOKEN_RE = re.compile(r"AM|PM|\d+", re.IGNORECASE)


class ClockCodePlugin:
    """Plugin d'encodage/décodage du Clock Code.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (lettres en encode, valeurs en decode).
            - mode (str): 'encode' ou 'decode'.
            - separator (str, optionnel): Séparateur inséré entre les valeurs à
              l'encodage (défaut ``:``).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "clock_code"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text:
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "encode":
            separator = inputs.get("separator")
            separator = ":" if separator is None or separator == "" else str(separator)
            output, processed = self._encode(text, separator)
            if processed == 0:
                return self._error_response(
                    "Aucune lettre A-Z à encoder dans le texte", start_time
                )
            return {
                "status": "ok",
                "summary": f"Encodage Clock Code réussi ({processed} caractère(s))",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 1.0,
                        "parameters": {"mode": "encode", "separator": separator},
                        "metadata": {"processed_chars": processed},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "decode":
            output, tokens, unknown = self._decode(text)
            if tokens == 0:
                return self._error_response(
                    "Aucune valeur d'horloge valide trouvée dans le texte", start_time
                )
            return {
                "status": "ok",
                "summary": f"Décodage Clock Code réussi ({tokens} valeur(s))",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 0.5,
                        "parameters": {"mode": "decode"},
                        "metadata": {
                            "tokens_decoded": tokens,
                            "unknown_tokens": unknown,
                        },
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    def _encode(self, text: str, separator: str) -> Tuple[str, int]:
        """Encode un texte : lettres → jetons d'horloge, espaces → ``00``.

        Retourne (texte encodé, nombre de caractères encodés).
        """
        tokens: List[str] = []
        processed = 0
        for ch in text.upper():
            if ch in _ALPHABET:
                tokens.append(_TOKENS[_ALPHABET.index(ch)])
                processed += 1
            elif ch.isspace():
                tokens.append("00")
            # Les autres caractères (ponctuation, etc.) sont ignorés.
        return separator.join(tokens), processed

    def _decode(self, text: str) -> Tuple[str, int, int]:
        """Décode une suite de valeurs d'horloge en texte.

        Retourne (texte, nombre de jetons reconnus, jetons inconnus).
        """
        chars: List[str] = []
        tokens = 0
        unknown = 0
        for match in _TOKEN_RE.finditer(text):
            token = match.group(0).upper()
            tokens += 1
            decoded = _TOKEN_TO_CHAR.get(token)
            if decoded is not None:
                chars.append(decoded)
            else:
                chars.append("?")
                unknown += 1
        return "".join(chars), tokens, unknown

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
    return ClockCodePlugin().execute(inputs)
