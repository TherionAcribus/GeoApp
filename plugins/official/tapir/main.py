"""Plugin TAPIR pour MysterAI.

**TAPIR** est le nom de la table de substitution utilisée par la *Nationale
Volksarmee* et le Ministère de la Sécurité d'État (Stasi) de la RDA. Les
nombres obtenus étaient ensuite surchiffrés par un **masque jetable**
(one-time pad), d'où la mise en groupes de 5 chiffres.

C'est un **damier à chevauchement** (*straddling checkerboard*) : les cinq
lettres les plus fréquentes de l'allemand occupent les codes à **un seul
chiffre** (0-4), tout le reste en occupe **deux** (50-99). Comme aucun code à
deux chiffres ne commence par 0-4, la lecture reste non ambiguë sans
séparateur. La table comporte aussi six **digrammes** fréquents en allemand
(``BE``, ``CH``, ``DE``, ``GE``, ``TE``, ``UN``), qui priment sur les lettres
isolées à l'encodage.

Table de référence ::

    0 = A    50 = B     60 = J     70 = T     80 = (saut de ligne)
    1 = E    51 = BE    61 = K     71 = TE    81 = retour aux lettres
    2 = I    52 = C     62 = L     72 = U     82 = passage aux chiffres
    3 = N    53 = CH    63 = M     73 = UN    83 = espace / remplissage
    4 = R    54 = D     64 = O     74 = V     88 = Ö
             55 = DE    65 = ß     76 = W     99 = Ü
             56 = F     66 = Ä     77 = X
             57 = G     67 = P     78 = Y
             58 = GE    68 = Q     79 = Z
             59 = H     69 = S

Après ``82``, les codes changent de sens jusqu'au prochain ``81`` ::

    00-99 = chiffres 0-9 (doublés)   89 = .   90 = :   91 = ,   92 = -
    93 = /   94 = (   95 = )   96 = +   97 = =   98 = "
    80 = saut de ligne               83 = espace

Références :

- https://blog.gcwizard.net/manual/en/tapir-substitution-cipher/01-what-is-the-tapir-substitution-cipher/
- https://www.cachesleuth.com/tools/tapir/

L'implémentation suit **GC Wizard** (la plus complète des deux : elle gère les
umlauts, le ``ß``, le saut de ligne, le remplissage et le masque jetable).
L'outil CacheSleuth s'en écarte sur trois points, sans conséquence sur un
message ordinaire : il traduit ``ß`` en ``SS`` au lieu du code 65, ignore les
sauts de ligne au lieu du code 80, et ne complète pas les groupes de 5.
Ses marqueurs historiques ``84`` (groupe de code) et ``85`` (répétition) sont
en revanche repris ici au décodage — les ignorer perdrait de l'information, et
aucun encodage ne les produit.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple


class TapirPlugin:
    """Plugin d'encodage/décodage de la substitution TAPIR.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (texte clair en encode, chiffres en
              decode).
            - mode (str): 'encode' ou 'decode'.
            - key (str, optionnel): Masque jetable, additionné modulo 10 à
              l'encodage et soustrait au décodage.
            - pad (bool, optionnel): En encodage, complète au multiple de 5.
            - group_size (int, optionnel): Taille des groupes de sortie
              (défaut 5 ; 0 pour ne pas grouper).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    #: Table des lettres, digrammes et caractères de contrôle.
    LETTERS: Dict[str, str] = {
        " ": "83", "\n": "80",
        "A": "0", "E": "1", "I": "2", "N": "3", "R": "4",
        "B": "50", "BE": "51", "C": "52", "CH": "53", "D": "54", "DE": "55",
        "F": "56", "G": "57", "GE": "58", "H": "59", "J": "60", "K": "61",
        "L": "62", "M": "63", "O": "64", "P": "67", "Q": "68", "S": "69",
        "T": "70", "TE": "71", "U": "72", "UN": "73", "V": "74", "W": "76",
        "X": "77", "Y": "78", "Z": "79",
        "Ä": "66", "Ö": "88", "Ü": "99", "ß": "65",
    }

    #: Table active après ``82``, jusqu'au prochain ``81``.
    NUMBERS: Dict[str, str] = {
        " ": "83", "\n": "80",
        ".": "89", ":": "90", ",": "91", "-": "92", "/": "93", "(": "94",
        ")": "95", "+": "96", "=": "97", '"': "98",
        "0": "00", "1": "11", "2": "22", "3": "33", "4": "44", "5": "55",
        "6": "66", "7": "77", "8": "88", "9": "99",
    }

    #: Marqueurs historiques, reconnus au décodage uniquement.
    MARKERS: Dict[str, str] = {"84": "#CODE#", "85": "#RPT#"}

    NUMBERS_FOLLOW = "82"
    LETTERS_FOLLOW = "81"

    #: Chiffres de remplissage, employés en alternance (8, 3, 8, 3…).
    FILLING = "83"

    #: Taille de groupe par défaut du texte chiffré.
    DEFAULT_GROUP_SIZE = 5

    _NOT_DIGIT = re.compile(r"\D")

    def __init__(self) -> None:
        self.name = "tapir"
        self.version = "1.0.0"
        self._letter_of = {code: char for char, code in self.LETTERS.items()}
        self._number_of = {code: char for char, code in self.NUMBERS.items()}
        self._digraphs = tuple(
            sorted(key for key in self.LETTERS if len(key) == 2 and key.isalpha())
        )

    # ------------------------------------------------------------------
    # Point d'entrée
    # ------------------------------------------------------------------

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        key = self._normalize_key(inputs.get("key"))

        if mode == "encode":
            group_size = self._resolve_group_size(inputs.get("group_size"))
            if group_size is None:
                return self._error_response(
                    f"Taille de groupe invalide: {inputs.get('group_size')} "
                    "(entier entre 0 et 20)",
                    start_time,
                )
            pad = self._parse_bool(inputs.get("pad"), default=True)
            return self._run_encode(text, key, pad, group_size, start_time)

        if mode == "decode":
            return self._run_decode(text, key, start_time)

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------
    # Encodage
    # ------------------------------------------------------------------

    def _run_encode(
        self,
        text: str,
        key: str,
        pad: bool,
        group_size: int,
        start_time: float,
    ) -> Dict[str, Any]:
        digits, encoded, dropped = self._encode(text, pad)

        if encoded == 0:
            return self._error_response(
                "Aucun caractère encodable par la table TAPIR", start_time
            )

        masked = self._apply_pad(digits, key, add=True) if key else digits

        return {
            "status": "ok",
            "summary": f"Encodage TAPIR réussi ({encoded} caractère(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": self._group(masked, group_size),
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "pad": pad,
                        "group_size": group_size,
                        "one_time_pad": bool(key),
                    },
                    "metadata": {
                        "chars_encoded": encoded,
                        "chars_dropped": dropped,
                        "digits": len(masked),
                        **self._pad_metadata(key, len(masked)),
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _encode(self, text: str, pad: bool) -> Tuple[str, int, int]:
        """Traduit le texte en suite de chiffres, en suivant les bascules.

        Le mode « lettres » est actif au départ ; rencontrer un chiffre ou une
        ponctuation insère ``82`` et bascule en mode « chiffres », et
        inversement pour ``81``. Espace et saut de ligne appartiennent aux deux
        tables : ils ne provoquent donc jamais de bascule.

        Retourne (suite de chiffres, caractères encodés, caractères ignorés).
        """
        source = self._upper(text)
        encodable = [
            char for char in source
            if char in self.LETTERS or char in self.NUMBERS
        ]
        dropped = len(source) - len(encodable)

        pieces: List[str] = []
        letter_mode = True
        encoded = 0
        index = 0

        while index < len(encodable):
            # Les digrammes ne valent qu'en mode lettres, et priment sur les
            # lettres isolées (CH avant C, UN avant U…).
            if letter_mode and index + 1 < len(encodable):
                digraph = encodable[index] + encodable[index + 1]
                code = self.LETTERS.get(digraph)
                if code is not None and digraph in self._digraphs:
                    pieces.append(code)
                    encoded += 2
                    index += 2
                    continue

            char = encodable[index]
            index += 1
            current = self.LETTERS if letter_mode else self.NUMBERS
            other = self.NUMBERS if letter_mode else self.LETTERS

            code = current.get(char)
            if code is not None:
                pieces.append(code)
                encoded += 1
                continue

            code = other.get(char)
            if code is not None:
                pieces.append(
                    self.NUMBERS_FOLLOW if letter_mode else self.LETTERS_FOLLOW
                )
                pieces.append(code)
                letter_mode = not letter_mode
                encoded += 1

        digits = "".join(pieces)
        if pad:
            digits = self._fill(digits)
        return digits, encoded, dropped

    def _fill(self, digits: str) -> str:
        """Complète jusqu'à un multiple de 5 avec des 8 et 3 alternés.

        Le remplissage est choisi pour se relire en ``83`` (espace) : il
        disparaît au décodage au lieu de produire du bruit.
        """
        filled = digits
        position = 0
        while len(filled) % 5 != 0:
            filled += self.FILLING[position % 2]
            position += 1
        return filled

    # ------------------------------------------------------------------
    # Décodage
    # ------------------------------------------------------------------

    def _run_decode(
        self, text: str, key: str, start_time: float
    ) -> Dict[str, Any]:
        digits = self._NOT_DIGIT.sub("", text)
        if not digits:
            return self._error_response(
                "Aucun chiffre à décoder dans le texte", start_time
            )

        unmasked = self._apply_pad(digits, key, add=False) if key else digits
        output, decoded, skipped = self._decode(unmasked)

        if decoded == 0:
            return self._error_response(
                "Aucun code TAPIR valide trouvé dans le texte", start_time
            )

        return {
            "status": "ok",
            "summary": f"Décodage TAPIR réussi ({decoded} caractère(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 0.5,
                    "parameters": {
                        "mode": "decode",
                        "one_time_pad": bool(key),
                    },
                    "metadata": {
                        "chars_decoded": decoded,
                        "digits_skipped": skipped,
                        "digits": len(digits),
                        **self._pad_metadata(key, len(digits)),
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode(self, digits: str) -> Tuple[str, int, int]:
        """Lit la suite de chiffres en suivant les bascules ``81`` / ``82``.

        À chaque position, le code à deux chiffres est essayé en premier ; s'il
        n'existe pas, on retombe sur le code à un chiffre. Aucun code à deux
        chiffres ne commençant par 0-4, la lecture est déterministe et se
        réaligne toujours correctement. Les chiffres qui ne mènent à aucun code
        sont ignorés.

        Retourne (texte clair, caractères décodés, chiffres ignorés).
        """
        chars: List[str] = []
        letter_mode = True
        decoded = 0
        skipped = 0
        index = 0

        while index < len(digits):
            if index + 1 < len(digits):
                pair = digits[index : index + 2]
                if pair == self.LETTERS_FOLLOW:
                    letter_mode = True
                    index += 2
                    continue
                if pair == self.NUMBERS_FOLLOW:
                    letter_mode = False
                    index += 2
                    continue
                if letter_mode and pair in self.MARKERS:
                    chars.append(self.MARKERS[pair])
                    decoded += 1
                    index += 2
                    continue
                char = self._lookup(pair, letter_mode)
                if char is not None:
                    chars.append(char)
                    decoded += 1
                    index += 2
                    continue

            char = self._lookup(digits[index], letter_mode)
            index += 1
            if char is None:
                skipped += 1
            else:
                chars.append(char)
                decoded += 1

        # Le remplissage de fin se relit en espaces : on l'élimine ici.
        return "".join(chars).strip(), decoded, skipped

    def _lookup(self, code: str, letter_mode: bool) -> Optional[str]:
        table = self._letter_of if letter_mode else self._number_of
        return table.get(code)

    # ------------------------------------------------------------------
    # Masque jetable
    # ------------------------------------------------------------------

    def _apply_pad(self, digits: str, key: str, add: bool) -> str:
        """Additionne (ou soustrait) le masque chiffre à chiffre, modulo 10.

        Le masque n'est **pas** répété : au-delà de sa longueur, les chiffres
        passent inchangés — c'est le comportement de GC Wizard, un masque
        jetable authentique devant être aussi long que le message.
        """
        sign = 1 if add else -1
        masked = [
            str((int(digit) + sign * int(key[position])) % 10)
            if position < len(key) else digit
            for position, digit in enumerate(digits)
        ]
        return "".join(masked)

    def _pad_metadata(self, key: str, length: int) -> Dict[str, Any]:
        if not key:
            return {}
        return {
            "one_time_pad_digits": len(key),
            "one_time_pad_covers_all": len(key) >= length,
        }

    # ------------------------------------------------------------------
    # Utilitaires
    # ------------------------------------------------------------------

    @staticmethod
    def _upper(text: str) -> str:
        """Passe en majuscules sans casser les caractères à expansion.

        ``'ß'.upper()`` vaut ``'SS'`` en Python : ce serait perdre le code 65,
        qui existe précisément pour cette lettre. On ne remplace donc un
        caractère que si sa majuscule tient sur un seul caractère.
        """
        return "".join(
            char.upper() if len(char.upper()) == 1 else char for char in text
        )

    @staticmethod
    def _group(digits: str, size: int) -> str:
        if size <= 0:
            return digits
        return " ".join(digits[i : i + size] for i in range(0, len(digits), size))

    def _normalize_key(self, raw: Any) -> str:
        """Ne conserve que les chiffres du masque (espaces, lettres ignorés)."""
        if raw is None:
            return ""
        return self._NOT_DIGIT.sub("", str(raw))

    def _resolve_group_size(self, raw: Any) -> Optional[int]:
        """Normalise ``group_size`` (défaut 5, 0 = pas de groupement)."""
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            return self.DEFAULT_GROUP_SIZE
        try:
            size = int(str(raw).strip())
        except (TypeError, ValueError):
            return None
        return size if 0 <= size <= 20 else None

    @staticmethod
    def _parse_bool(value: Any, default: bool) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        return str(value).strip().lower() in {"1", "true", "yes", "on", "oui"}

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
    return TapirPlugin().execute(inputs)
