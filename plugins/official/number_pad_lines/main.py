"""Plugin Number Pad Lines pour MysterAI.

Compatible avec https://www.cachesleuth.com/tools/numberpadlines : chaque lettre (A-Z)
et chiffre (0-9) est représenté par un tracé de lignes reliant les touches d'un clavier
téléphonique (disposition 1-9,0 en grille 3x4), encodé sous forme d'une chaîne de touches
visitées dans l'ordre (ex: "A" -> "7295").

Modes :
- encode : texte en clair -> chemins numériques séparés par des espaces.
- decode : chemins numériques séparés par des espaces -> texte en clair.
- detect : estime si le texte fourni ressemble à une séquence de chemins Number Pad Lines.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple


class NumberPadLinesPlugin:
    def __init__(self) -> None:
        self.name = "number_pad_lines"
        self.version = "1.0.0"

        # Table de référence identique à cachesleuth.com/tools/numberpadlines
        self._char_to_path: Dict[str, str] = {
            "A": "7295", "B": "71354597", "C": "32489", "D": "178621", "E": "3145479",
            "F": "314547", "G": "317965", "H": "174639", "I": "132879", "J": "3984",
            "K": "174349", "L": "179", "M": "71539", "N": "7193", "O": "71397",
            "P": "71354", "Q": "971395", "R": "7135459", "S": "3245687", "T": "1328",
            "U": "1793", "V": "183", "W": "17593", "X": "19537", "Y": "15358", "Z": "1379",
            "0": "713973", "1": "539", "2": "136479", "3": "1365697", "4": "14639",
            "5": "314697", "6": "317964", "7": "137", "8": "3179364", "9": "793146",
        }
        self._path_to_char: Dict[str, str] = {v: k for k, v in self._char_to_path.items()}

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "encode":
            output, processed = self._encode(text)
            if processed == 0:
                return self._error_response("Aucun caractère encodable (A-Z, 0-9)", start_time)
            return {
                "status": "ok",
                "summary": "Encodage Number Pad Lines réussi",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": 1.0,
                        "parameters": {"mode": "encode"},
                        "metadata": {"processed_chars": processed},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "decode":
            output, matched, total = self._decode(text)
            if total == 0:
                return self._error_response("Aucun chemin numérique détecté", start_time)

            confidence = 0.2 + 0.4 * (matched / total) if total else 0.0
            return {
                "status": "ok",
                "summary": "Décodage Number Pad Lines réussi",
                "results": [
                    {
                        "id": "result_1",
                        "text_output": output,
                        "confidence": round(confidence, 3),
                        "parameters": {"mode": "decode"},
                        "metadata": {"matched_tokens": matched, "total_tokens": total},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "detect":
            is_match, score, considered = self._detect(text)
            summary = "Séquence Number Pad Lines détectée" if is_match else "Aucune séquence Number Pad Lines détectée"
            return {
                "status": "ok",
                "summary": summary,
                "results": [
                    {
                        "id": "result_1",
                        "text_output": f"{summary} (score: {score:.2f})",
                        "confidence": float(score),
                        "parameters": {"mode": "detect"},
                        "metadata": {"is_match": is_match, "detection_score": float(score), "considered_tokens": considered},
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------
    # Encode
    # ------------------------------------------------------------------
    def _encode(self, text: str) -> Tuple[str, int]:
        tokens: List[str] = []
        processed = 0

        for ch in text:
            up = ch.upper()
            if up in self._char_to_path:
                tokens.append(self._char_to_path[up])
                processed += 1
            elif ch.isspace():
                if tokens and tokens[-1] != "/":
                    tokens.append("/")
            else:
                # Caractère non supporté : conservé tel quel pour rester visible dans la sortie
                tokens.append(ch)

        while tokens and tokens[0] == "/":
            tokens.pop(0)
        while tokens and tokens[-1] == "/":
            tokens.pop()

        return " ".join(tokens).strip(), processed

    # ------------------------------------------------------------------
    # Decode
    # ------------------------------------------------------------------
    def _split_tokens(self, text: str) -> List[str]:
        return [tok for tok in re.split(r"\s+", text.strip()) if tok]

    def _decode(self, text: str) -> Tuple[str, int, int]:
        tokens = self._split_tokens(text)
        out: List[str] = []
        matched = 0

        for tok in tokens:
            if tok == "/":
                out.append(" ")
                continue
            digits = re.sub(r"[^0-9]", "", tok)
            char = self._path_to_char.get(digits)
            if char:
                out.append(char)
                matched += 1
            else:
                out.append("?")

        return "".join(out).strip(), matched, len(tokens)

    # ------------------------------------------------------------------
    # Detect
    # ------------------------------------------------------------------
    def _detect(self, text: str) -> Tuple[bool, float, int]:
        tokens = [tok for tok in self._split_tokens(text) if tok != "/"]
        if not tokens:
            return False, 0.0, 0

        valid = 0
        for tok in tokens:
            digits = re.sub(r"[^0-9]", "", tok)
            if digits and digits in self._path_to_char:
                valid += 1

        score = valid / len(tokens)
        return score >= 0.5, float(score), len(tokens)

    # ------------------------------------------------------------------
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
    return NumberPadLinesPlugin().execute(inputs)
