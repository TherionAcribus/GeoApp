"""Plugin Spirit DVD Code pour MysterAI.

Le rover martien **Spirit** (MER-A, 2004) emportait un DVD de la *Planetary
Society* sur lequel était gravé, autour du disque, un message chiffré en
tirets et barres verticales. Le code est de **longueur variable** — comme un
code de Huffman : les lettres fréquentes ont un code court, les rares un code
long — et il est **préfixe** (aucun code n'est le début d'un autre), ce qui
permet de le lire d'un seul flux, sans séparateur entre les lettres.

Table de référence (extraite de l'outil CacheSleuth) ::

    (espace) ---        M |-|---      V |-||||---      T ||----
    E        --|        W |-|--|      K |-||||--|      I ||---|
    A        -|-        F |-|-|-      J |-||||-|-      N ||--|-
    O        -||        G |-|-||      X |-||||-||      H ||--||
    R        |--        Y |-||--      Q |-|||||--      D ||-|--
    S        |||        P |-||-|      Z |-|||||-|      L ||-|-|
                        B |-|||-                       C ||-||-
                                                       U ||-|||

Les codes se lisent par groupes de trois symboles : ``|-|`` et ``||-`` sont
des préfixes qui introduisent un second groupe, et ``|-| |||`` un troisième.
L'alphabet ne couvre que A-Z et l'espace : **chiffres et ponctuation n'ont
pas de code** et sont ignorés à l'encodage.

Références :

- https://www.cachesleuth.com/tools/spiritdvd/
- https://www.planetary.org/outreach/mars-dvd-code-clues

Le plugin supporte :

- l'encodage et le décodage ;
- les graphies usuelles de la barre au décodage (``|``, ``l``, ``I``, ``1``)
  et le choix du caractère produit à l'encodage ;
- l'inversion tirets/barres (option ``swap``) ;
- une auto-détection en décodage : si le texte n'utilise que deux caractères
  arbitraires (``AB``, ``○●``…), ils sont ramenés à ``-`` et ``|`` et les deux
  lectures possibles sont proposées, classées ensuite par le scoring
  linguistique du backend.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple


class SpiritDvdPlugin:
    """Plugin d'encodage/décodage du code Spirit DVD.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (lettres en encode, symboles en decode).
            - mode (str): 'encode' ou 'decode'.
            - line_char (str, optionnel): Caractère « barre » produit à
              l'encodage (``|``, ``l`` ou ``1``).
            - swap (bool, optionnel): Échange ``-`` et ``|``.
            - auto_detect (bool, optionnel): En décodage, ramène deux
              caractères arbitraires à ``-``/``|`` et propose les deux lectures.
            - ignore_whitespace (bool, optionnel): En décodage, supprime les
              espaces avant lecture (défaut : oui).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    #: Symboles canoniques du code.
    DASH = "-"
    LINE = "|"

    #: Graphies acceptées pour la barre au décodage.
    LINE_ALIASES = re.compile(r"[lI1]")

    #: Caractères proposés à l'encodage pour la barre.
    LINE_CHOICES = ("|", "l", "1")

    #: Table du code, dans l'ordre de longueur croissante publié par la source.
    CODES: Tuple[Tuple[str, str], ...] = (
        (" ", "---"),
        ("E", "--|"),
        ("A", "-|-"),
        ("O", "-||"),
        ("R", "|--"),
        ("M", "|-|---"),
        ("W", "|-|--|"),
        ("F", "|-|-|-"),
        ("G", "|-|-||"),
        ("Y", "|-||--"),
        ("P", "|-||-|"),
        ("B", "|-|||-"),
        ("V", "|-||||---"),
        ("K", "|-||||--|"),
        ("J", "|-||||-|-"),
        ("X", "|-||||-||"),
        ("Q", "|-|||||--"),
        ("Z", "|-|||||-|"),
        ("T", "||----"),
        ("I", "||---|"),
        ("N", "||--|-"),
        ("H", "||--||"),
        ("D", "||-|--"),
        ("L", "||-|-|"),
        ("C", "||-||-"),
        ("U", "||-|||"),
        ("S", "|||"),
    )

    _WHITESPACE = re.compile(r"\s+")

    def __init__(self) -> None:
        self.name = "spirit_dvd"
        self.version = "1.0.0"
        self._char_to_code = {char: code for char, code in self.CODES}
        self._code_to_char = {code: char for char, code in self.CODES}
        self._max_code_len = max(len(code) for _, code in self.CODES)
        self._swap_table = str.maketrans(
            self.DASH + self.LINE, self.LINE + self.DASH
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

        swap = self._parse_bool(inputs.get("swap"), default=False)

        if mode == "encode":
            line_char = self._resolve_line_char(inputs.get("line_char"))
            if line_char is None:
                return self._error_response(
                    f"Caractère « barre » invalide: {inputs.get('line_char')} "
                    f"(attendu {', '.join(self.LINE_CHOICES)})",
                    start_time,
                )
            return self._run_encode(text, line_char, swap, start_time)

        if mode == "decode":
            return self._run_decode(text, swap, inputs, start_time)

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------
    # Encodage
    # ------------------------------------------------------------------

    def _run_encode(
        self, text: str, line_char: str, swap: bool, start_time: float
    ) -> Dict[str, Any]:
        output, encoded, dropped = self._encode(text, line_char, swap)

        if encoded == 0:
            return self._error_response(
                "Aucun caractère encodable (le code ne couvre que A-Z et l'espace)",
                start_time,
            )

        return {
            "status": "ok",
            "summary": f"Encodage Spirit DVD réussi ({encoded} caractère(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "line_char": line_char,
                        "swap": swap,
                    },
                    "metadata": {
                        "chars_encoded": encoded,
                        "chars_dropped": dropped,
                        "symbols": len(output),
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _encode(
        self, text: str, line_char: str, swap: bool
    ) -> Tuple[str, int, int]:
        """Concatène le code de chaque caractère, sans séparateur.

        Le code étant préfixe, aucun séparateur n'est nécessaire. Les
        caractères sans code (chiffres, ponctuation, retours à la ligne) sont
        **supprimés**, comme dans l'outil de référence : les recopier tels
        quels casserait la lecture du flux.

        Retourne (texte chiffré, caractères encodés, caractères supprimés).
        """
        pieces: List[str] = []
        encoded = 0
        dropped = 0

        for char in text:
            code = self._char_to_code.get(char.upper())
            if code is None:
                dropped += 1
            else:
                pieces.append(code)
                encoded += 1

        cipher = "".join(pieces)
        if swap:
            cipher = cipher.translate(self._swap_table)
        if line_char != self.LINE:
            cipher = cipher.replace(self.LINE, line_char)
        return cipher, encoded, dropped

    # ------------------------------------------------------------------
    # Décodage
    # ------------------------------------------------------------------

    def _run_decode(
        self,
        text: str,
        swap: bool,
        inputs: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        auto_detect = self._parse_bool(inputs.get("auto_detect"), default=True)
        ignore_whitespace = self._parse_bool(
            inputs.get("ignore_whitespace"), default=True
        )

        detected = self._detect_two_symbols(text) if auto_detect else None
        if detected is not None:
            return self._decode_both_orientations(
                text, detected, ignore_whitespace, start_time
            )

        normalized = self.LINE_ALIASES.sub(self.LINE, text)
        if swap:
            normalized = normalized.translate(self._swap_table)

        output, decoded, unknown = self._decode(normalized, ignore_whitespace)
        if decoded == 0:
            return self._error_response(
                "Aucun code Spirit DVD valide trouvé dans le texte", start_time
            )

        return {
            "status": "ok",
            "summary": f"Décodage Spirit DVD réussi ({decoded} caractère(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 0.5,
                    "parameters": {"mode": "decode", "swap": swap},
                    "metadata": {
                        "chars_decoded": decoded,
                        "unknown_symbols": unknown,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode_both_orientations(
        self,
        text: str,
        detected: Tuple[str, str],
        ignore_whitespace: bool,
        start_time: float,
    ) -> Dict[str, Any]:
        """Produit les deux lectures d'un texte à deux symboles arbitraires.

        Rien n'indique lequel des deux caractères joue le rôle du tiret, et
        l'orientation inverse se décode presque toujours elle aussi (le code
        couvre l'essentiel des suites de trois symboles) : les deux hypothèses
        sont donc renvoyées **à confiance égale**, c'est le scoring
        linguistique du backend qui tranche. L'ordre suit malgré tout la
        lisibilité, seul signal disponible hors scoring — il ne départage
        vraiment que les cas où une orientation laisse des symboles illisibles.
        """
        candidates: List[Tuple[float, Dict[str, str], str, int, int]] = []

        for dash, line in (detected, (detected[1], detected[0])):
            normalized = text.translate(
                str.maketrans(dash + line, self.DASH + self.LINE)
            )
            output, decoded, unknown = self._decode(normalized, ignore_whitespace)
            if decoded == 0:
                continue
            mapping = {dash: self.DASH, line: self.LINE}
            candidates.append(
                (self._readability(output), mapping, output, decoded, unknown)
            )

        if not candidates:
            return self._error_response(
                "Aucun code Spirit DVD valide trouvé dans le texte", start_time
            )

        candidates.sort(key=lambda candidate: candidate[0], reverse=True)

        results = [
            {
                "id": f"result_{index}",
                "text_output": output,
                # Aucune des deux lectures n'est privilégiée : légèrement en
                # dessous d'un décodage non ambigu (0.5), à égalité entre elles.
                "confidence": 0.45,
                "parameters": {
                    "mode": "decode",
                    "symbols": "".join(mapping),
                    "mapping": mapping,
                },
                "metadata": {
                    "chars_decoded": decoded,
                    "unknown_symbols": unknown,
                    "auto_detected": True,
                },
            }
            for index, (_, mapping, output, decoded, unknown) in enumerate(
                candidates, start=1
            )
        ]

        return {
            "status": "ok",
            "summary": (
                f"Décodage Spirit DVD : {len(results)} lecture(s) des symboles "
                f"« {detected[0]}{detected[1]} »"
            ),
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode(
        self, text: str, ignore_whitespace: bool
    ) -> Tuple[str, int, int]:
        """Lit le flux de symboles, code le plus long d'abord.

        Le code étant préfixe, la correspondance la plus longue est la seule
        lecture possible. Les caractères non reconnus sont recopiés tels quels.

        Retourne (texte clair, caractères décodés, symboles non reconnus).
        """
        if ignore_whitespace:
            text = self._WHITESPACE.sub("", text)

        chars: List[str] = []
        decoded = 0
        unknown = 0
        position = 0

        while position < len(text):
            for length in range(
                min(self._max_code_len, len(text) - position), 0, -1
            ):
                char = self._code_to_char.get(text[position : position + length])
                if char is not None:
                    chars.append(char)
                    decoded += 1
                    position += length
                    break
            else:
                chars.append(text[position])
                unknown += 1
                position += 1

        return "".join(chars), decoded, unknown

    # ------------------------------------------------------------------
    # Utilitaires
    # ------------------------------------------------------------------

    def _detect_two_symbols(self, text: str) -> Optional[Tuple[str, str]]:
        """Retourne les deux symboles d'un texte qui n'utilise ni ``-`` ni barre.

        Retourne ``None`` — et le décodage se fait alors normalement — dès que
        le texte contient un symbole canonique (``-``, ``|``, ``l``, ``I``,
        ``1``) ou qu'il n'a pas exactement deux caractères distincts.
        """
        compact = self._WHITESPACE.sub("", text)
        if not compact or re.search(r"[-|lI1]", compact):
            return None

        seen: List[str] = []
        for char in compact:
            if char in seen:
                continue
            seen.append(char)
            if len(seen) > 2:
                return None

        if len(seen) != 2:
            return None
        # Ordre déterministe (comme l'outil de référence) : le plus petit
        # caractère est proposé en premier comme tiret.
        return (min(seen), max(seen))

    @staticmethod
    def _readability(text: str) -> float:
        """Heuristique de l'outil de référence pour ordonner deux lectures.

        Une lettre vaut +1, une espace +0.25, tout autre caractère (donc tout
        symbole non décodé) −2. Elle ne mesure que la lisibilité brute, pas la
        vraisemblance linguistique : elle sert à ordonner, pas à conclure.
        """
        score = 0.0
        for char in text.upper():
            if "A" <= char <= "Z":
                score += 1
            elif char == " ":
                score += 0.25
            else:
                score -= 2
        return score

    def _resolve_line_char(self, raw: Any) -> Optional[str]:
        """Normalise le champ ``line_char`` (défaut ``|``)."""
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            return self.LINE
        value = str(raw).strip()
        return value if value in self.LINE_CHOICES else None

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
    return SpiritDvdPlugin().execute(inputs)
