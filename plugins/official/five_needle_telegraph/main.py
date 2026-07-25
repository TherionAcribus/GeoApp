"""Plugin Télégraphe à cinq aiguilles (Cooke & Wheatstone) pour MysterAI.

Le télégraphe à cinq aiguilles de Cooke et Wheatstone (1837) affichait chaque
lettre en énergisant **deux** aiguilles parmi cinq : elles pivotaient en sens
opposés pour pointer vers une intersection d'une grille en losange portant les
lettres. Les trois aiguilles au repos restaient verticales.

On représente ici l'état des cinq aiguilles par cinq symboles :
  - ``\\`` : aiguille déviée vers la gauche
  - ``|``  : aiguille au repos (verticale)
  - ``/``  : aiguille déviée vers la droite

Chaque lettre est donc un groupe de 5 symboles. Le système ne comporte que
**20 lettres** ; les lettres peu fréquentes **C, J, Q, V, X, Z** sont omises
(convention identique à l'outil CacheSleuth reproduit ici).

Modes :
  - ``encode`` : texte clair -> suite de codes d'aiguilles
  - ``decode`` : suite de codes d'aiguilles -> texte clair
    Option ``auto_detect`` : lorsque le message emploie 3 caractères non
    standard, toutes les affectations possibles aux positions d'aiguilles sont
    testées et proposées, le scoring linguistique du backend départageant.
"""

from __future__ import annotations

import re
import time
from collections import Counter
from itertools import permutations
from typing import Any, Dict, List, Tuple

try:
    from gc_backend.plugins.code_solving import parse_bool
except ImportError:  # exécution hors backend (tests directs)
    import sys as _sys
    import pathlib as _pathlib

    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    try:
        from gc_backend.plugins.code_solving import parse_bool
    except Exception:  # pragma: no cover - repli minimal

        def parse_bool(value: Any, default: bool = False) -> bool:  # type: ignore
            if isinstance(value, bool):
                return value
            if value is None:
                return default
            return str(value).strip().lower() in {"1", "true", "yes", "on", "oui"}


# Symboles canoniques : gauche / repos / droite
_LEFT = "\\"
_REST = "|"
_RIGHT = "/"
_CANON = (_LEFT, _REST, _RIGHT)


class FiveNeedleTelegraphPlugin:
    """Encode/décode le télégraphe à cinq aiguilles de Cooke & Wheatstone."""

    def __init__(self) -> None:
        self.name = "five_needle_telegraph"
        self.version = "1.0.0"

        # Table de référence (identique à CacheSleuth). Chaque code = 5 symboles,
        # dont exactement deux aiguilles déviées (une gauche, une droite ou deux
        # de même sens) pointant vers la lettre.
        self.encode_table: Dict[str, str] = {
            "A": "/|||\\",
            "B": "/||\\|",
            "D": "|/||\\",
            "E": "/|\\||",
            "F": "|/|\\|",
            "G": "||/|\\",
            "H": "/\\|||",
            "I": "|/\\||",
            "K": "||/\\|",
            "L": "|||/\\",
            "M": "\\\\|||",
            "N": "|\\\\||",
            "O": "||\\\\|",
            "P": "|||\\\\",
            "R": "\\|/||",
            "S": "|\\|/|",
            "T": "||\\|/",
            "U": "\\||/|",
            "W": "|\\||/",
            "Y": "\\|||/",
        }
        self.decode_table: Dict[str, str] = {v: k for k, v in self.encode_table.items()}
        # Lettres non représentables par le système.
        self.omitted_letters = sorted(
            {chr(c) for c in range(ord("A"), ord("Z") + 1)} - set(self.encode_table)
        )

    # ------------------------------------------------------------------ encode
    def _encode(self, text: str) -> Tuple[str, List[str]]:
        """Renvoie (code, lettres_omises).

        Les lettres sont jointes par une espace ; les mots par trois espaces
        (ce qui permet un aller-retour propre avec ``_decode``).
        """
        words_out: List[str] = []
        omitted: List[str] = []
        for word in re.split(r"\s+", text.strip()):
            if not word:
                continue
            letters: List[str] = []
            for ch in word.upper():
                code = self.encode_table.get(ch)
                if code is not None:
                    letters.append(code)
                elif ch.isalpha():
                    omitted.append(ch)
                # ponctuation / chiffres : ignorés
            if letters:
                words_out.append(" ".join(letters))
        return "   ".join(words_out), omitted

    # ------------------------------------------------------------------ decode
    def _decode_with_map(self, text: str, symbols_map: Dict[str, str]) -> str:
        """Décode ``text`` en traduisant d'abord ses caractères via ``symbols_map``.

        ``symbols_map`` associe chaque caractère d'entrée à un symbole canonique
        (``\\`` / ``|`` / ``/``). Les caractères absents de la table sont ignorés.
        Séparateurs de mots : deux espaces et plus, ou un retour à la ligne.
        Les groupes de 5 symboles inconnus deviennent ``?``.
        """
        marker = "\x00"
        tmp = re.sub(r"[ \t]{2,}|[\r\n]+", marker, text)
        out_words: List[str] = []
        for word in tmp.split(marker):
            letters: List[str] = []
            for tok in word.split():
                canon = "".join(symbols_map.get(c, "") for c in tok)
                full = len(canon) - (len(canon) % 5)
                for i in range(0, full, 5):
                    letters.append(self.decode_table.get(canon[i : i + 5], "?"))
                if len(canon) % 5 != 0:
                    letters.append("?")  # reste incomplet
            if letters:
                out_words.append("".join(letters))
        return " ".join(out_words)

    def _decode_candidates(
        self, text: str, auto_detect: bool
    ) -> Tuple[List[Tuple[str, Dict[str, Any], float]], str]:
        """Construit la liste des candidats (texte, paramètres, confiance)."""
        candidates: List[Tuple[str, Dict[str, Any], float]] = []
        note = ""

        identity = {_LEFT: _LEFT, _REST: _REST, _RIGHT: _RIGHT}
        if any(sym in text for sym in _CANON):
            candidates.append(
                (
                    self._decode_with_map(text, identity),
                    {"mode": "decode", "symbols": f"{_LEFT} {_REST} {_RIGHT}"},
                    0.5,
                )
            )

        if auto_detect:
            uniq = sorted({c for c in text if not c.isspace()})
            if len(uniq) == 3:
                freq = Counter(c for c in text if not c.isspace())
                most_common = freq.most_common(1)[0][0]
                for perm in permutations(_CANON):
                    smap = {uniq[i]: perm[i] for i in range(3)}
                    # Heuristique : l'aiguille au repos "|" est la plus fréquente.
                    conf = 0.35 + (0.1 if smap[most_common] == _REST else 0.0)
                    params = {
                        "mode": "decode",
                        "auto_detect": True,
                        "symbols": " ".join(f"{uniq[i]}->{perm[i]}" for i in range(3)),
                    }
                    candidates.append((self._decode_with_map(text, smap), params, conf))
            else:
                note = (
                    f"Auto-détection impossible : {len(uniq)} caractère(s) distinct(s) "
                    "trouvé(s) (3 attendus)."
                )

        return candidates, note

    @staticmethod
    def _dedupe(
        candidates: List[Tuple[str, Dict[str, Any], float]]
    ) -> List[Tuple[str, Dict[str, Any], float]]:
        best: Dict[str, Tuple[str, Dict[str, Any], float]] = {}
        for text_out, params, conf in candidates:
            key = re.sub(r"\s+", " ", text_out).strip()
            if not key:
                continue
            if key not in best or conf > best[key][2]:
                best[key] = (text_out, params, conf)
        return sorted(best.values(), key=lambda c: c[2], reverse=True)

    # ----------------------------------------------------------------- execute
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()
        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).strip().lower()

        if not isinstance(text, str) or text == "":
            return self._error_response("Aucun texte fourni à traiter.", start_time)

        if mode == "encode":
            code, omitted = self._encode(text)
            if not code:
                return self._error_response(
                    "Aucune lettre représentable dans le texte fourni.", start_time
                )
            summary = "Encodage télégraphe à cinq aiguilles réussi"
            if omitted:
                summary += (
                    f" ({len(omitted)} lettre(s) omise(s) : "
                    f"{', '.join(sorted(set(omitted)))})"
                )
            return {
                "status": "ok",
                "summary": summary,
                "results": [
                    {
                        "id": "result_1",
                        "text_output": code,
                        "confidence": 1.0,
                        "parameters": {"mode": "encode"},
                        "metadata": {
                            "omitted_letters": sorted(set(omitted)),
                            "omitted_count": len(omitted),
                        },
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "decode":
            auto_detect = parse_bool(inputs.get("auto_detect", False), default=False)
            raw, note = self._decode_candidates(text, auto_detect)
            candidates = self._dedupe(raw)
            if not candidates:
                msg = "Aucun symbole d'aiguille reconnu dans le texte fourni."
                if note:
                    msg += " " + note
                return self._error_response(msg, start_time)

            results = []
            for idx, (text_out, params, conf) in enumerate(candidates, start=1):
                results.append(
                    {
                        "id": f"result_{idx}",
                        "text_output": text_out,
                        "confidence": conf,
                        "parameters": params,
                        "metadata": {"processed_chars": len(text)},
                    }
                )
            summary = f"Décodage télégraphe à cinq aiguilles : {len(results)} candidat(s)"
            if note:
                summary += f" — {note}"
            return {
                "status": "ok",
                "summary": summary,
                "results": results,
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode non supporté : {mode}", start_time)

    # ------------------------------------------------------------------ helpers
    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": round((time.time() - start_time) * 1000, 2),
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return FiveNeedleTelegraphPlugin().execute(inputs)
