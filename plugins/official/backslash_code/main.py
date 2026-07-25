"""Plugin Backslash Code pour MysterAI.

Le code Backslash (aussi appelé « Tegenschrap ») représente chaque lettre A-Z
par un groupe de trois symboles choisis parmi ``|``, ``/`` et ``\\``. Il s'agit
d'un simple encodage en base 3 :

- ``|`` = 0
- ``/`` = 1
- ``\\`` = 2

Chaque lettre correspond à sa position dans l'alphabet (A=0 ... Z=25) écrite sur
trois « trits » de poids fort à gauche. Exemples : A = ``|||`` (0),
N = ``///`` (13), Z = ``\\\\/`` (25). La combinaison restante ``\\\\\\`` (valeur 26)
sert de séparateur de mots (espace).

Références : https://www.cachesleuth.com/tools/backslash/ et
https://drabkikker.com/talen-schriften/backslash/

Le plugin supporte l'encodage, le décodage et des symboles personnalisés
(remplacement des caractères ``|``, ``/``, ``\\`` par trois autres caractères).
"""

from __future__ import annotations

import time
from typing import Any, Dict, List


class BackslashCodePlugin:
    """Plugin d'encodage/décodage du code Backslash.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (lettres en encode, symboles en decode).
            - mode (str): 'encode' ou 'decode'.
            - symbols (str, optionnel): Trois caractères distincts remplaçant
              respectivement ``|`` (0), ``/`` (1) et ``\\`` (2).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    #: Symboles standards, indexés par leur valeur (0, 1, 2).
    DEFAULT_SYMBOLS = "|/\\"
    #: Valeur du groupe de trois symboles servant de séparateur de mots.
    SPACE_VALUE = 26

    def __init__(self) -> None:
        self.name = "backslash_code"
        self.version = "1.0.0"
        self._alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

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
                "Les symboles personnalisés doivent être 3 caractères distincts",
                start_time,
            )

        if mode == "encode":
            output = self._encode(text, symbols)
            return {
                "status": "ok",
                "summary": "Encodage Backslash réussi",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 1.0,
                        "parameters": {"mode": "encode", "symbols": symbols},
                        "metadata": {"processed_chars": self._count_alpha_chars(text)},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "decode":
            output, groups, unknown = self._decode(text, symbols)
            if groups == 0:
                return self._error_response(
                    "Aucun symbole Backslash valide trouvé dans le texte", start_time
                )
            return {
                "status": "ok",
                "summary": f"Décodage Backslash réussi ({groups} groupe(s))",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 0.5,
                        "parameters": {"mode": "decode", "symbols": symbols},
                        "metadata": {
                            "groups_decoded": groups,
                            "unknown_groups": unknown,
                        },
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    def _resolve_symbols(self, raw: Any) -> str | None:
        """Retourne la table de symboles à utiliser (défaut ou personnalisée)."""
        if raw is None:
            return self.DEFAULT_SYMBOLS
        symbols = str(raw)
        if symbols == "":
            return self.DEFAULT_SYMBOLS
        if len(symbols) != 3 or len(set(symbols)) != 3:
            return None
        return symbols

    def _encode(self, text: str, symbols: str) -> str:
        """Encode un texte : lettres → triplets, espaces → séparateur."""
        result: List[str] = []
        for ch in text.upper():
            if ch in self._alphabet:
                result.append(self._value_to_group(self._alphabet.index(ch), symbols))
            elif ch.isspace():
                result.append(self._value_to_group(self.SPACE_VALUE, symbols))
            # Les autres caractères (ponctuation) sont ignorés pour préserver
            # l'alignement en groupes de trois symboles au décodage.
        return "".join(result)

    def _decode(self, text: str, symbols: str) -> tuple[str, int, int]:
        """Décode une suite de symboles en texte.

        Retourne (texte, nombre de groupes décodés, groupes inconnus).
        """
        # Ne conserver que les symboles significatifs, dans l'ordre.
        trits = [symbols.index(ch) for ch in text if ch in symbols]

        letters: List[str] = []
        groups = 0
        unknown = 0
        for i in range(0, len(trits) - len(trits) % 3, 3):
            value = trits[i] * 9 + trits[i + 1] * 3 + trits[i + 2]
            groups += 1
            if value < 26:
                letters.append(self._alphabet[value])
            elif value == self.SPACE_VALUE:
                letters.append(" ")
            else:
                letters.append("?")
                unknown += 1
        return "".join(letters), groups, unknown

    def _value_to_group(self, value: int, symbols: str) -> str:
        """Convertit une valeur 0-26 en groupe de trois symboles (base 3)."""
        return (
            symbols[(value // 9) % 3]
            + symbols[(value // 3) % 3]
            + symbols[value % 3]
        )

    def _count_alpha_chars(self, text: str) -> int:
        return sum(1 for c in text.upper() if c in self._alphabet)

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
    return BackslashCodePlugin().execute(inputs)
