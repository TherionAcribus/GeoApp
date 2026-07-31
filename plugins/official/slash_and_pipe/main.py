"""Plugin Slash and Pipe Code pour MysterAI.

Le code « Slash and Pipe » représente chaque lettre A-Z par un groupe de 1 à 4
symboles choisis parmi ``/``, ``|`` et ``\\``. Contrairement au code Backslash
(groupes de longueur fixe), les groupes sont de **longueur variable** : ils
doivent donc être séparés par une espace dans le texte chiffré.

Table de référence (extraite de l'outil CacheSleuth) ::

    A |        H \\\\      O ||/|     V ||\\\\
    B |\\       I /       P |\\|\\    W \\/||
    C ||       J |\\\\     Q /\\      X ||/
    D |/       K //||     R \\/      Y |||\\
    E \\       L |\\/      S /|      Z ||||
    F ||\\      M |\\|      T |//
    G |||      N |/|      U //

Référence : https://www.cachesleuth.com/tools/slashandpipe/

Le plugin supporte :

- l'encodage et le décodage ;
- des symboles personnalisés (trois caractères remplaçant ``/``, ``|``, ``\\``) ;
- une auto-détection en décodage : si le texte n'utilise que trois caractères
  distincts, les 6 permutations possibles sont produites et classées par le
  scoring linguistique du backend.
"""

from __future__ import annotations

import itertools
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple


class SlashAndPipePlugin:
    """Plugin d'encodage/décodage du code Slash and Pipe.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (lettres en encode, symboles en decode).
            - mode (str): 'encode' ou 'decode'.
            - symbols (str, optionnel): Trois caractères distincts remplaçant
              respectivement ``/``, ``|`` et ``\\``.
            - auto_detect (bool, optionnel): En décodage, teste les 6
              permutations de symboles si le texte n'en contient que trois.
            - strip_unknown (bool, optionnel): En encodage, ignore les
              caractères hors A-Z au lieu de les recopier.

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    #: Symboles standards, dans l'ordre utilisé par le champ ``symbols``.
    DEFAULT_SYMBOLS = "/|\\"

    #: Code de chaque lettre, indexé par sa position dans l'alphabet (A=0).
    CODES: Tuple[str, ...] = (
        "|",  # A
        "|\\",  # B
        "||",  # C
        "|/",  # D
        "\\",  # E
        "||\\",  # F
        "|||",  # G
        "\\\\",  # H
        "/",  # I
        "|\\\\",  # J
        "//||",  # K
        "|\\/",  # L
        "|\\|",  # M
        "|/|",  # N
        "||/|",  # O
        "|\\|\\",  # P
        "/\\",  # Q
        "\\/",  # R
        "/|",  # S
        "|//",  # T
        "//",  # U
        "||\\\\",  # V
        "\\/||",  # W
        "||/",  # X
        "|||\\",  # Y
        "||||",  # Z
    )

    #: Longueur maximale d'un code (utilisée par le décodage glouton).
    MAX_CODE_LEN = 4

    def __init__(self) -> None:
        self.name = "slash_and_pipe"
        self.version = "1.0.0"
        self._alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        self._code_to_letter = {
            code: self._alphabet[index] for index, code in enumerate(self.CODES)
        }

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

        raw_symbols = inputs.get("symbols")
        symbols = self._resolve_symbols(raw_symbols)
        if symbols is None:
            return self._error_response(
                "Les symboles personnalisés doivent être 3 caractères distincts",
                start_time,
            )

        if mode == "encode":
            return self._run_encode(text, symbols, inputs, start_time)

        if mode == "decode":
            explicit = self._has_custom_symbols(raw_symbols)
            return self._run_decode(text, symbols, explicit, inputs, start_time)

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------
    # Encodage
    # ------------------------------------------------------------------

    def _run_encode(
        self,
        text: str,
        symbols: str,
        inputs: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        strip_unknown = self._parse_bool(inputs.get("strip_unknown"), default=False)
        output, encoded, skipped = self._encode(text, symbols, strip_unknown)

        if encoded == 0:
            return self._error_response("Aucune lettre A-Z à encoder", start_time)

        return {
            "status": "ok",
            "summary": f"Encodage Slash and Pipe réussi ({encoded} lettre(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "symbols": symbols,
                        "strip_unknown": strip_unknown,
                    },
                    "metadata": {
                        "letters_encoded": encoded,
                        "unknown_chars": skipped,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _encode(
        self, text: str, symbols: str, strip_unknown: bool
    ) -> Tuple[str, int, int]:
        """Encode un texte en groupes séparés par une espace.

        Les espaces du texte source sont supprimés (comme l'outil de référence) :
        le code ne transporte pas de séparateur de mots.

        Retourne (texte chiffré, lettres encodées, caractères non reconnus).
        """
        groups: List[str] = []
        encoded = 0
        unknown = 0

        for char in re.sub(r"\s+", "", text):
            index = self._alphabet.find(char.upper())
            if index >= 0:
                groups.append(self.CODES[index])
                encoded += 1
            elif not strip_unknown:
                groups.append(char)
                unknown += 1
            else:
                unknown += 1

        cipher = " ".join(groups)
        if symbols != self.DEFAULT_SYMBOLS:
            cipher = self._translate(cipher, self.DEFAULT_SYMBOLS, symbols)
        return cipher, encoded, unknown

    # ------------------------------------------------------------------
    # Décodage
    # ------------------------------------------------------------------

    def _run_decode(
        self,
        text: str,
        symbols: str,
        explicit_symbols: bool,
        inputs: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        auto_detect = self._parse_bool(inputs.get("auto_detect"), default=True)
        candidates = self._detect_symbols(text)

        # L'auto-détection ne s'applique que si l'utilisateur n'a pas imposé ses
        # propres symboles et que le texte n'utilise bien que trois caractères.
        if not explicit_symbols and auto_detect and candidates is not None:
            return self._decode_all_permutations(candidates, text, start_time)

        output, decoded, unknown = self._decode(text, symbols)
        if decoded == 0:
            return self._error_response(
                "Aucun groupe Slash and Pipe valide trouvé dans le texte", start_time
            )

        return {
            "status": "ok",
            "summary": f"Décodage Slash and Pipe réussi ({decoded} lettre(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 0.5,
                    "parameters": {"mode": "decode", "symbols": symbols},
                    "metadata": {
                        "letters_decoded": decoded,
                        "unknown_chars": unknown,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode_all_permutations(
        self, candidates: str, text: str, start_time: float
    ) -> Dict[str, Any]:
        """Produit les 6 lectures possibles des trois symboles détectés."""
        results: List[Dict[str, Any]] = []

        for index, permutation in enumerate(
            itertools.permutations(self.DEFAULT_SYMBOLS), start=1
        ):
            mapping = "".join(permutation)
            # candidates[i] joue le rôle de mapping[i] dans le code standard.
            normalized = self._translate(text, candidates, mapping)
            output, decoded, unknown = self._decode(normalized, self.DEFAULT_SYMBOLS)
            if decoded == 0:
                continue

            # La lecture « telle quelle » (chaque caractère vaut lui-même) est
            # la plus probable quand le texte utilise déjà / | \.
            canonical = candidates == mapping
            results.append(
                {
                    "id": f"result_{index}",
                    "text_output": output,
                    "confidence": 0.5 if canonical else 0.4,
                    "parameters": {
                        "mode": "decode",
                        "symbols": candidates,
                        "mapping": {
                            candidates[i]: mapping[i] for i in range(3)
                        },
                        "canonical": canonical,
                    },
                    "metadata": {
                        "letters_decoded": decoded,
                        "unknown_chars": unknown,
                        "auto_detected": True,
                    },
                }
            )

        if not results:
            return self._error_response(
                "Aucun groupe Slash and Pipe valide trouvé dans le texte", start_time
            )

        return {
            "status": "ok",
            "summary": (
                f"Décodage Slash and Pipe : {len(results)} permutation(s) testée(s) "
                f"pour les symboles « {candidates} »"
            ),
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode(self, text: str, symbols: str) -> Tuple[str, int, int]:
        """Décode un texte chiffré, groupe par groupe.

        Chaque groupe (séparé par des espaces) est lu de gauche à droite en
        prenant à chaque fois le code le plus long qui correspond. Les
        caractères non reconnus sont recopiés tels quels.

        Retourne (texte clair, lettres décodées, caractères non reconnus).
        """
        if symbols != self.DEFAULT_SYMBOLS:
            text = self._translate(text, symbols, self.DEFAULT_SYMBOLS)

        letters: List[str] = []
        decoded = 0
        unknown = 0

        for token in text.split():
            position = 0
            while position < len(token):
                for length in range(
                    min(self.MAX_CODE_LEN, len(token) - position), 0, -1
                ):
                    letter = self._code_to_letter.get(token[position : position + length])
                    if letter is not None:
                        letters.append(letter)
                        decoded += 1
                        position += length
                        break
                else:
                    letters.append(token[position])
                    unknown += 1
                    position += 1

        return "".join(letters), decoded, unknown

    # ------------------------------------------------------------------
    # Utilitaires
    # ------------------------------------------------------------------

    def _detect_symbols(self, text: str) -> Optional[str]:
        """Retourne les 3 caractères distincts du texte, dans l'ordre d'apparition.

        Retourne ``None`` si le texte n'en contient pas exactement trois :
        l'auto-détection n'a alors rien à proposer.
        """
        seen: List[str] = []
        for char in text:
            if char.isspace() or char in seen:
                continue
            seen.append(char)
            if len(seen) > 3:
                return None
        return "".join(seen) if len(seen) == 3 else None

    @staticmethod
    def _translate(text: str, source: Sequence[str], target: Sequence[str]) -> str:
        """Substitue caractère à caractère ``source[i]`` par ``target[i]``."""
        return text.translate(str.maketrans("".join(source), "".join(target)))

    @staticmethod
    def _has_custom_symbols(raw: Any) -> bool:
        return isinstance(raw, str) and raw.strip() != ""

    def _resolve_symbols(self, raw: Any) -> Optional[str]:
        """Retourne la table de symboles à utiliser (défaut ou personnalisée)."""
        if not self._has_custom_symbols(raw):
            return self.DEFAULT_SYMBOLS
        symbols = str(raw).strip()
        if len(symbols) != 3 or len(set(symbols)) != 3:
            return None
        return symbols

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
    return SlashAndPipePlugin().execute(inputs)
