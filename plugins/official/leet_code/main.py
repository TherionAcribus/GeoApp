"""Plugin Leet speak (1337) pour MysterAI.

Le « leet » (ou *1337*, *leetspeak*) remplace les lettres d'un mot par des
chiffres ou des symboles qui leur ressemblent visuellement :
``LEET`` → ``1337``, ``ELITE`` → ``31173``.

Ce plugin gère les deux sens :

* **encode** : substitution déterministe lettre → leet (jeu de base, un
  caractère par lettre) ;
* **decode** : substitution leet → lettre. Certains caractères leet sont
  **ambigus** — en particulier le chiffre ``1`` qui peut représenter ``L``
  (ex. ``1337`` = LEET) ou ``I`` (ex. ``31173`` = ELITE). Le décodage énumère
  donc les interprétations possibles ; elles sont ensuite classées par le
  scoring linguistique du backend.

Référence : https://www.cachesleuth.com/tools/leet/
"""

from __future__ import annotations

import itertools
import time
from typing import Any, Dict, List

#: Substitution d'encodage (lettre majuscule -> caractère leet). Les lettres
#: absentes de la table sont laissées telles quelles.
ENCODE_MAP: Dict[str, str] = {
    "A": "4",
    "B": "8",
    "C": "(",
    "E": "3",
    "G": "6",
    "H": "#",
    "I": "1",
    "L": "1",
    "O": "0",
    "S": "5",
    "T": "7",
    "Z": "2",
}

#: Substitution de décodage (caractère leet -> lettre). Plusieurs formes leet
#: peuvent pointer vers la même lettre. Le chiffre ``1`` est traité à part
#: (cf. :data:`AMBIGUOUS`) car il est ambigu.
DECODE_MAP: Dict[str, str] = {
    "4": "A",
    "@": "A",
    "8": "B",
    "(": "C",
    "<": "C",
    "¢": "C",
    "3": "E",
    "€": "E",
    "6": "G",
    "9": "G",
    "#": "H",
    "!": "I",
    "|": "I",
    "0": "O",
    "ø": "O",
    "5": "S",
    "$": "S",
    "7": "T",
    "+": "T",
    "2": "Z",
}

#: Caractères leet ayant plusieurs interprétations plausibles. L'ordre reflète
#: la préférence (première valeur = interprétation par défaut).
AMBIGUOUS: Dict[str, List[str]] = {
    "1": ["L", "I"],
}

#: Nombre maximum de variantes de décodage énumérées avant de basculer sur un
#: repli « uniforme » (pour éviter l'explosion combinatoire).
_MAX_VARIANTS = 32


class LeetCodePlugin:
    """Plugin d'encodage / décodage en leet speak.

    Args:
        inputs (dict):
            - text (str): Texte à traiter.
            - mode (str, optionnel): ``decode`` (défaut) ou ``encode``.

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "leet_code"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        mode = str(inputs.get("mode", "decode")).strip().lower()
        if mode == "encode":
            return self._encode(text, start_time)
        if mode in ("decode", ""):
            return self._decode(text, start_time)
        return self._error_response(
            f"Mode inconnu : {mode!r} (attendu : encode ou decode)", start_time
        )

    # ------------------------------------------------------------------ encode
    def _encode(self, text: str, start_time: float) -> Dict[str, Any]:
        output = "".join(ENCODE_MAP.get(ch, ch) for ch in text.upper())
        substituted = sum(1 for ch in text.upper() if ch in ENCODE_MAP)

        return {
            "status": "ok",
            "summary": f"Encodage leet ({substituted} lettre(s) substituée(s))",
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 1.0,
                    "parameters": {"mode": "encode"},
                    "metadata": {"substituted_chars": substituted},
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    # ------------------------------------------------------------------ decode
    def _decode(self, text: str, start_time: float) -> Dict[str, Any]:
        upper = text.upper()
        leet_chars = sum(
            1 for ch in upper if ch in DECODE_MAP or ch in AMBIGUOUS
        )
        if leet_chars == 0:
            return self._error_response(
                "Aucun caractère leet reconnu dans le texte", start_time
            )

        variants = self._decode_variants(upper)

        results = [
            {
                "id": f"result_{idx}",
                "text_output": variant,
                "confidence": 0.5,
                "parameters": {"mode": "decode"},
                "metadata": {"leet_chars": leet_chars, "variant": idx},
            }
            for idx, variant in enumerate(variants, start=1)
        ]

        plural = "s" if len(results) > 1 else ""
        return {
            "status": "ok",
            "summary": (
                f"Décodage leet : {len(results)} interprétation{plural} "
                f"({leet_chars} caractère(s) leet)"
            ),
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    @staticmethod
    def _decode_variants(upper: str) -> List[str]:
        """Énumère les décodages possibles en tenant compte des ambiguïtés.

        Chaque caractère est traduit via :data:`DECODE_MAP` ; les caractères
        ambigus (:data:`AMBIGUOUS`) ouvrent plusieurs branches. Au-delà de
        :data:`_MAX_VARIANTS` combinaisons, on se replie sur les variantes
        « uniformes » (une par interprétation possible du caractère ambigu).
        """
        options: List[List[str]] = []
        combos = 1
        for ch in upper:
            if ch in AMBIGUOUS:
                choices = AMBIGUOUS[ch]
            elif ch in DECODE_MAP:
                choices = [DECODE_MAP[ch]]
            else:
                choices = [ch]  # caractère non leet : conservé tel quel
            options.append(choices)
            combos *= len(choices)

        if combos <= 1:
            return ["".join(opt[0] for opt in options)]

        if combos <= _MAX_VARIANTS:
            variants = ["".join(combo) for combo in itertools.product(*options)]
        else:
            # Repli : une variante par interprétation uniforme des ambigus.
            variants = []
            for key, choices in AMBIGUOUS.items():
                for choice in choices:
                    variants.append(
                        LeetCodePlugin._decode_uniform(upper, {key: choice})
                    )

        # Déduplication en préservant l'ordre.
        seen: set = set()
        unique: List[str] = []
        for variant in variants:
            if variant not in seen:
                seen.add(variant)
                unique.append(variant)
        return unique

    @staticmethod
    def _decode_uniform(upper: str, forced: Dict[str, str]) -> str:
        """Décode en imposant une interprétation fixe aux caractères ambigus."""
        out = []
        for ch in upper:
            if ch in forced:
                out.append(forced[ch])
            elif ch in AMBIGUOUS:
                out.append(AMBIGUOUS[ch][0])
            elif ch in DECODE_MAP:
                out.append(DECODE_MAP[ch])
            else:
                out.append(ch)
        return "".join(out)

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
    return LeetCodePlugin().execute(inputs)
