"""Plugin Baudot Code pour MysterAI.

Le code Baudot est un code télégraphique à 5 bits. Ce plugin gère les **deux
grandes versions** rencontrées dans les énigmes :

- **ITA2** (Baudot-Murray) — la variante la plus courante, celle qu'utilisent la
  plupart des outils de géocaching lorsqu'ils parlent de « code Baudot » ;
- **ITA1** (Baudot original, variante Continentale) — le code d'Émile Baudot
  (1874), historiquement le premier.

Chaque caractère est représenté par 5 bits (32 combinaisons). Comme 5 bits ne
suffisent pas pour lettres + chiffres + ponctuation, des codes de **bascule**
partagent les mêmes 5 bits entre deux jeux (mode *lettres* / mode *chiffres*) :

- en ITA2, ``11111`` (LTRS) et ``11011`` (FIGS) sont des bascules dédiées, et
  l'espace ``00100`` est identique dans les deux modes ;
- en ITA1, l'espace et les bascules **partagent** deux combinaisons (``01000``
  et ``10000``) dont le sens dépend du mode courant — le plugin gère cette
  particularité de façon transparente.

Le récepteur commence par convention en mode *lettres*. À l'encodage, les
bascules sont insérées automatiquement lors des passages lettres ↔ chiffres.

Options :
- ``variant`` : ``ita2`` (défaut) ou ``ita1`` ;
- ``bit_order`` : sens de lecture des 5 bits (poids fort ou poids faible d'abord) ;
- ``symbols`` : deux caractères libres pour les bits 0 et 1 (ex. ``.x``, ``+-``).

Référence : https://fr.wikipedia.org/wiki/Code_Baudot
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# Jetons de contrôle (ni lettre ni chiffre imprimable)
# --------------------------------------------------------------------------- #
SKIP = "\x00skip"          # code ignoré (NUL, CR, DEL...)
NL = "\x00nl"              # saut de ligne (LF)
SPACE = "\x00space"        # espace
SHIFT_L = "\x00shift_l"    # bascule vers les lettres (LTRS)
SHIFT_F = "\x00shift_f"    # bascule vers les chiffres (FIGS)
_CONTROL = {SKIP, NL, SPACE, SHIFT_L, SHIFT_F}

# Chaque table associe une valeur 0..31 au couple (mode lettres, mode chiffres).
# Une entrée peut être un caractère imprimable, un jeton de contrôle, ou ``None``
# (combinaison sans correspondance dans ce mode → « ? » au décodage).
Entry = Optional[str]
Table = Dict[int, Tuple[Entry, Entry]]

# --------------------------------------------------------------------------- #
# ITA2 (Baudot-Murray) — variante la plus répandue
# --------------------------------------------------------------------------- #
ITA2_TABLE: Table = {
    0: (SKIP, SKIP),        # NULL
    1: ("E", "3"),
    2: (NL, NL),            # LF
    3: ("A", "-"),
    4: (SPACE, SPACE),      # espace (identique dans les deux modes)
    5: ("S", "'"),
    6: ("I", "8"),
    7: ("U", "7"),
    8: (SKIP, SKIP),        # CR
    9: ("D", "$"),
    10: ("R", "4"),
    11: ("J", None),        # BELL en chiffres (non imprimable)
    12: ("N", ","),
    13: ("F", "!"),
    14: ("C", ":"),
    15: ("K", "("),
    16: ("T", "5"),
    17: ("Z", '"'),
    18: ("L", ")"),
    19: ("W", "2"),
    20: ("H", "#"),
    21: ("Y", "6"),
    22: ("P", "0"),
    23: ("Q", "1"),
    24: ("O", "9"),
    25: ("B", "?"),
    26: ("G", "&"),
    27: (SHIFT_F, SHIFT_F),  # FIGS
    28: ("M", "."),
    29: ("X", "/"),
    30: ("V", ";"),
    31: (SHIFT_L, SHIFT_L),  # LTRS
}

# --------------------------------------------------------------------------- #
# ITA1 (Baudot original, variante Continentale)
# En ITA1, l'espace et les bascules partagent deux combinaisons dont le sens
# dépend du mode : 01000 = FIGS (en lettres) / espace (en chiffres) ;
# 10000 = espace (en lettres) / LTRS (en chiffres).
# --------------------------------------------------------------------------- #
ITA1_TABLE: Table = {
    0: (SKIP, SKIP),         # NUL
    1: ("A", "1"),
    2: ("E", "2"),
    3: (SKIP, SKIP),         # CR
    4: ("Y", "3"),
    5: ("U", "4"),
    6: ("I", None),          # fraction (non gérée)
    7: ("O", "5"),
    8: (SHIFT_F, SPACE),     # FIGS (lettres) / espace (chiffres)
    9: ("J", "6"),
    10: ("G", "7"),
    11: ("H", None),
    12: ("B", "8"),
    13: ("C", "9"),
    14: ("F", None),
    15: ("D", "0"),
    16: (SPACE, SHIFT_L),    # espace (lettres) / LTRS (chiffres)
    17: ("-", "."),          # combinaison de ponctuation
    18: ("X", ","),
    19: ("Z", ":"),
    20: ("S", ";"),
    21: ("T", "!"),
    22: ("W", "?"),
    23: ("V", "'"),
    24: (SKIP, SKIP),        # DEL / effacement
    25: ("K", "("),
    26: ("M", ")"),
    27: ("L", "="),
    28: ("R", "-"),
    29: ("Q", "/"),
    30: ("N", "№"),
    31: ("P", "%"),
}

VARIANTS: Dict[str, Table] = {"ita2": ITA2_TABLE, "ita1": ITA1_TABLE}


class _VariantCodec:
    """Encodeur/décodeur générique piloté par une table de variante."""

    def __init__(self, table: Table) -> None:
        self.table = table
        self.letters_map: Dict[str, int] = {}
        self.figures_map: Dict[str, int] = {}
        self.space_letters: Optional[int] = None
        self.space_figures: Optional[int] = None
        self.go_figures: Optional[int] = None  # émis en mode lettres → chiffres
        self.go_letters: Optional[int] = None  # émis en mode chiffres → lettres

        for value, (letter, figure) in table.items():
            if letter == SHIFT_F:
                self.go_figures = value
            if figure == SHIFT_L:
                self.go_letters = value
            if letter == SPACE:
                self.space_letters = value
            if figure == SPACE:
                self.space_figures = value
            if letter is not None and letter not in _CONTROL:
                self.letters_map.setdefault(letter, value)
            if figure is not None and figure not in _CONTROL:
                self.figures_map.setdefault(figure, value)

    def encode(self, text: str) -> List[int]:
        """Convertit un texte en une liste de valeurs 5 bits (avec bascules)."""
        groups: List[int] = []
        letters_mode = True  # état initial par convention

        for ch in text.upper():
            if ch == " ":
                code = self.space_letters if letters_mode else self.space_figures
                if code is not None:
                    groups.append(code)
                continue
            if ch in self.letters_map:
                if not letters_mode and self.go_letters is not None:
                    groups.append(self.go_letters)
                    letters_mode = True
                groups.append(self.letters_map[ch])
            elif ch in self.figures_map:
                if letters_mode and self.go_figures is not None:
                    groups.append(self.go_figures)
                    letters_mode = False
                groups.append(self.figures_map[ch])
            # Les caractères non encodables sont ignorés.
        return groups

    def decode(self, values: List[int]) -> Tuple[str, int]:
        """Convertit des valeurs 5 bits en texte. Retourne (texte, nb inconnus)."""
        out: List[str] = []
        unknown = 0
        letters_mode = True

        for value in values:
            entry = self.table[value][0 if letters_mode else 1]
            if entry == SKIP:
                continue
            if entry == SHIFT_L:
                letters_mode = True
            elif entry == SHIFT_F:
                letters_mode = False
            elif entry == SPACE:
                out.append(" ")
            elif entry == NL:
                out.append("\n")
            elif entry is None:
                out.append("?")
                unknown += 1
            else:
                out.append(entry)
        return "".join(out), unknown


class BaudotCodePlugin:
    """Plugin d'encodage/décodage du code Baudot (ITA1 / ITA2).

    Args:
        inputs (dict):
            - text (str): Texte à traiter (lettres/chiffres en encode, bits en decode).
            - mode (str): 'encode' ou 'decode'.
            - variant (str, optionnel): 'ita2' (défaut) ou 'ita1'.
            - bit_order (str, optionnel): 'msb_first' (défaut) ou 'lsb_first'.
            - symbols (str, optionnel): Deux caractères distincts remplaçant
              respectivement le bit 0 et le bit 1 (défaut ``01``).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    DEFAULT_SYMBOLS = "01"

    def __init__(self) -> None:
        self.name = "baudot_code"
        self.version = "1.1.0"
        self._codecs = {name: _VariantCodec(table) for name, table in VARIANTS.items()}

    # ------------------------------------------------------------------ #
    # Point d'entrée
    # ------------------------------------------------------------------ #
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text:
            return self._error_response("Aucun texte fourni", start_time)

        variant = str(inputs.get("variant", "ita2")).lower()
        if variant not in self._codecs:
            return self._error_response(f"Variante inconnue: {variant}", start_time)
        codec = self._codecs[variant]

        bit_order = str(inputs.get("bit_order", "msb_first")).lower()
        if bit_order not in ("msb_first", "lsb_first"):
            bit_order = "msb_first"

        symbols = self._resolve_symbols(inputs.get("symbols"))
        if symbols is None:
            return self._error_response(
                "Les symboles personnalisés doivent être 2 caractères distincts",
                start_time,
            )

        variant_label = variant.upper()

        if mode == "encode":
            values = codec.encode(text)
            output = " ".join(
                self._value_to_bits(v, bit_order, symbols) for v in values
            )
            return {
                "status": "ok",
                "summary": f"Encodage Baudot ({variant_label}) réussi",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 1.0,
                        "parameters": {
                            "mode": "encode",
                            "variant": variant,
                            "bit_order": bit_order,
                            "symbols": symbols,
                        },
                        "metadata": {"groups": len(values)},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "decode":
            values = self._bits_to_values(text, bit_order, symbols)
            if not values:
                return self._error_response(
                    "Aucun groupe de 5 bits valide trouvé dans le texte", start_time
                )
            output, unknown = codec.decode(values)
            return {
                "status": "ok",
                "summary": f"Décodage Baudot ({variant_label}) réussi ({len(values)} groupe(s))",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 0.5,
                        "parameters": {
                            "mode": "decode",
                            "variant": variant,
                            "bit_order": bit_order,
                            "symbols": symbols,
                        },
                        "metadata": {
                            "groups_decoded": len(values),
                            "unknown_groups": unknown,
                        },
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------ #
    # Utilitaires bits
    # ------------------------------------------------------------------ #
    def _bits_to_values(
        self, text: str, bit_order: str, symbols: str
    ) -> List[int]:
        """Extrait les bits significatifs et les regroupe en valeurs 5 bits."""
        zero, one = symbols[0], symbols[1]
        bits = ["0" if ch == zero else "1" for ch in text if ch in (zero, one)]

        values: List[int] = []
        usable = len(bits) - len(bits) % 5
        for i in range(0, usable, 5):
            chunk = bits[i : i + 5]
            if bit_order == "lsb_first":
                chunk = list(reversed(chunk))
            values.append(int("".join(chunk), 2))
        return values

    def _value_to_bits(self, value: int, bit_order: str, symbols: str) -> str:
        """Convertit une valeur 0-31 en 5 symboles selon l'ordre demandé."""
        bits = format(value, "05b")
        if bit_order == "lsb_first":
            bits = bits[::-1]
        return "".join(symbols[int(b)] for b in bits)

    # ------------------------------------------------------------------ #
    # Divers
    # ------------------------------------------------------------------ #
    def _resolve_symbols(self, raw: Any) -> Optional[str]:
        """Retourne les symboles bit-0/bit-1 (défaut ou personnalisés)."""
        if raw is None:
            return self.DEFAULT_SYMBOLS
        symbols = str(raw)
        if symbols == "":
            return self.DEFAULT_SYMBOLS
        if len(symbols) != 2 or symbols[0] == symbols[1]:
            return None
        return symbols

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
    return BaudotCodePlugin().execute(inputs)
