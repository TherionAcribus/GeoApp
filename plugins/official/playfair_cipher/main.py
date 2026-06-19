from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple

try:
    from gc_backend.plugins.code_solving import parse_bool, remove_diacritics
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import parse_bool, remove_diacritics


class PlayfairCipherPlugin:
    """Classic Wheatstone-Playfair digram cipher."""

    def __init__(self) -> None:
        self.name = "playfair_cipher"
        self.version = "1.0.1"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()
        key = str(inputs.get("key", "") or "")
        alphabet_mode = str(inputs.get("alphabet_mode", "I=J"))
        filler = str(inputs.get("filler", "X") or "X").upper()[:1]
        alternate_filler = str(inputs.get("alternate_filler", "Q") or "Q").upper()[:1]
        cleanup_fillers = parse_bool(inputs.get("cleanup_fillers", True), default=True)
        group_output = parse_bool(inputs.get("group_output", True), default=True)
        strict_mode = str(inputs.get("strict", "smooth")).lower() == "strict"
        allowed_chars = str(inputs.get("allowed_chars", " \t\r\n.:;,_-'\"!?") or "")

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        try:
            square = self.create_square(key=key, alphabet_mode=alphabet_mode)
            filler = self._normalize_letter(filler, alphabet_mode)
            alternate_filler = self._normalize_letter(alternate_filler, alphabet_mode)
            if not filler or filler not in square["char_to_pos"]:
                raise ValueError("Le caractere de remplissage doit appartenir a la grille Playfair")
            if not alternate_filler or alternate_filler not in square["char_to_pos"]:
                raise ValueError("Le caractere de remplissage alternatif doit appartenir a la grille Playfair")
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

        if mode == "detect":
            is_match, score, metadata = self.detect(text, strict_mode=strict_mode, allowed_chars=allowed_chars)
            summary = "Texte compatible avec Playfair" if is_match else "Texte peu compatible avec Playfair"
            return {
                "status": "ok",
                "summary": summary,
                "results": [
                    {
                        "id": "result_1",
                        "text_output": f"{summary} (score: {score:.2f})",
                        "confidence": float(score),
                        "parameters": {"mode": "detect", "strict": "strict" if strict_mode else "smooth"},
                        "metadata": metadata,
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode == "encode":
            output, metadata = self.encode(
                text=text,
                square=square,
                alphabet_mode=alphabet_mode,
                filler=filler,
                alternate_filler=alternate_filler,
                group_output=group_output,
            )
            return self._success_response(
                summary="Encodage Playfair reussi",
                text_output=output,
                confidence=1.0,
                parameters=self._parameters(mode, key, alphabet_mode, filler, alternate_filler, cleanup_fillers, group_output),
                metadata=metadata,
                start_time=start_time,
            )

        if mode == "decode":
            if strict_mode:
                ok, reason = self._is_strict_ciphertext(text, allowed_chars)
                if not ok:
                    return self._error_response(f"Texte chiffre Playfair invalide (strict): {reason}", start_time)

            output, metadata = self.decode(
                text=text,
                square=square,
                alphabet_mode=alphabet_mode,
                filler=filler,
                alternate_filler=alternate_filler,
                cleanup_fillers=cleanup_fillers,
            )
            summary = "Decodage Playfair reussi"
            if not key.strip():
                summary = "Decodage Playfair reussi (grille alphabetique par defaut, aucun mot-cle fourni)"
            return self._success_response(
                summary=summary,
                text_output=output,
                confidence=0.65,
                parameters=self._parameters(mode, key, alphabet_mode, filler, alternate_filler, cleanup_fillers, group_output),
                metadata=metadata,
                start_time=start_time,
            )

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    def create_square(self, key: str = "", alphabet_mode: str = "I=J") -> Dict[str, Any]:
        alphabet_mode = alphabet_mode.upper()
        alphabet = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

        if alphabet_mode == "I=J":
            alphabet.remove("J")
        elif alphabet_mode == "Q_OMITTED":
            alphabet.remove("Q")
        else:
            raise ValueError("Mode alphabet inconnu: utilisez I=J ou Q_OMITTED")

        normalized_key = self._normalize_text(key, alphabet_mode)
        chars: List[str] = []
        for ch in normalized_key + "".join(alphabet):
            if ch in alphabet and ch not in chars:
                chars.append(ch)

        if len(chars) != 25:
            raise ValueError("La grille Playfair doit contenir 25 lettres uniques")

        grid = [chars[i : i + 5] for i in range(0, 25, 5)]
        char_to_pos: Dict[str, Tuple[int, int]] = {}
        pos_to_char: Dict[Tuple[int, int], str] = {}
        for row in range(5):
            for col in range(5):
                ch = grid[row][col]
                char_to_pos[ch] = (row, col)
                pos_to_char[(row, col)] = ch

        if alphabet_mode == "I=J":
            char_to_pos["J"] = char_to_pos["I"]

        return {
            "grid": grid,
            "alphabet_mode": alphabet_mode,
            "char_to_pos": char_to_pos,
            "pos_to_char": pos_to_char,
            "grid_string": "".join(chars),
            "used_default_key": not bool(self._clean_letters(key)),
        }

    def encode(
        self,
        text: str,
        square: Dict[str, Any],
        alphabet_mode: str,
        filler: str,
        alternate_filler: str,
        group_output: bool,
    ) -> Tuple[str, Dict[str, Any]]:
        clean = self._normalize_text(text, alphabet_mode)
        digrams, prep_meta = self._prepare_digrams(clean, filler=filler, alternate_filler=alternate_filler)
        encoded = "".join(self._transform_pair(a, b, square, encode=True) for a, b in digrams)
        output = self._group_text(encoded, 2) if group_output else encoded

        metadata = self._square_metadata(square)
        metadata.update(prep_meta)
        metadata.update({"digrams": ["".join(pair) for pair in digrams], "output_chars": len(encoded)})
        return output, metadata

    def decode(
        self,
        text: str,
        square: Dict[str, Any],
        alphabet_mode: str,
        filler: str,
        alternate_filler: str,
        cleanup_fillers: bool,
    ) -> Tuple[str, Dict[str, Any]]:
        clean = self._normalize_text(text, alphabet_mode)
        if not clean:
            raise ValueError("Aucune lettre exploitable dans le texte chiffre")
        if len(clean) % 2 == 1:
            clean += filler

        digrams = [(clean[i], clean[i + 1]) for i in range(0, len(clean), 2)]
        decoded_raw = "".join(self._transform_pair(a, b, square, encode=False) for a, b in digrams)
        decoded = self._remove_fillers(decoded_raw, {filler, alternate_filler}) if cleanup_fillers else decoded_raw

        metadata = self._square_metadata(square)
        metadata.update(
            {
                "digrams": ["".join(pair) for pair in digrams],
                "decoded_raw": decoded_raw,
                "cleanup_fillers": cleanup_fillers,
                "removed_fillers": len(decoded_raw) - len(decoded),
            }
        )
        return decoded, metadata

    def _prepare_digrams(self, clean: str, filler: str, alternate_filler: str) -> Tuple[List[Tuple[str, str]], Dict[str, Any]]:
        digrams: List[Tuple[str, str]] = []
        inserted_fillers = 0
        i = 0

        while i < len(clean):
            first = clean[i]
            if i + 1 >= len(clean):
                fill = alternate_filler if first == filler else filler
                digrams.append((first, fill))
                inserted_fillers += 1
                i += 1
                continue

            second = clean[i + 1]
            if first == second:
                fill = alternate_filler if first == filler else filler
                digrams.append((first, fill))
                inserted_fillers += 1
                i += 1
            else:
                digrams.append((first, second))
                i += 2

        return digrams, {"clean_text": clean, "input_letters": len(clean), "inserted_fillers": inserted_fillers}

    def _transform_pair(self, first: str, second: str, square: Dict[str, Any], encode: bool) -> str:
        char_to_pos = square["char_to_pos"]
        pos_to_char = square["pos_to_char"]
        r1, c1 = char_to_pos[first]
        r2, c2 = char_to_pos[second]
        shift = 1 if encode else -1

        if r1 == r2:
            return pos_to_char[(r1, (c1 + shift) % 5)] + pos_to_char[(r2, (c2 + shift) % 5)]
        if c1 == c2:
            return pos_to_char[((r1 + shift) % 5, c1)] + pos_to_char[((r2 + shift) % 5, c2)]
        return pos_to_char[(r1, c2)] + pos_to_char[(r2, c1)]

    def detect(self, text: str, strict_mode: bool, allowed_chars: str) -> Tuple[bool, float, Dict[str, Any]]:
        ok, _reason = self._is_strict_ciphertext(text, allowed_chars)
        clean = re.sub(r"[^A-Z]", "", remove_diacritics(text).upper().replace("J", "I"))
        if not clean:
            return False, 0.0, {"is_match": False, "letters_count": 0}

        if strict_mode and not ok:
            return False, 0.0, {"is_match": False, "letters_count": len(clean), "strict_compatible": False}

        digrams = [clean[i : i + 2] for i in range(0, len(clean) - 1, 2)]
        repeated_digrams = sum(1 for digram in digrams if len(digram) == 2 and digram[0] == digram[1])
        even_bonus = 0.2 if len(clean) % 2 == 0 else 0.0
        no_double_score = 1.0 - (repeated_digrams / len(digrams)) if digrams else 0.0
        score = min(1.0, 0.5 * no_double_score + even_bonus + min(0.3, len(clean) / 100))
        is_match = score >= 0.6
        return is_match, float(score), {
            "is_match": is_match,
            "letters_count": len(clean),
            "digrams_count": len(digrams),
            "repeated_digrams": repeated_digrams,
            "strict_compatible": ok,
            "warning": "Detection heuristique: Playfair produit typiquement un texte chiffre en digrammes sans double lettre.",
        }

    def _remove_fillers(self, text: str, fillers: set[str]) -> str:
        chars: List[str] = []
        removed = [False] * len(text)

        for i in range(1, len(text) - 1):
            if text[i] in fillers and text[i - 1] == text[i + 1]:
                removed[i] = True

        if text and text[-1] in fillers:
            removed[-1] = True

        for i, ch in enumerate(text):
            if not removed[i]:
                chars.append(ch)
        return "".join(chars)

    def _is_strict_ciphertext(self, text: str, allowed_chars: str) -> Tuple[bool, str]:
        allowed = set(allowed_chars)
        letters = 0
        for ch in remove_diacritics(text).upper():
            if "A" <= ch <= "Z":
                letters += 1
                continue
            if ch in allowed:
                continue
            return False, f"caractere non autorise: {ch!r}"
        if letters == 0:
            return False, "aucune lettre detectee"
        if letters % 2 == 1:
            return False, "nombre de lettres impair"
        return True, ""

    def _normalize_text(self, text: str, alphabet_mode: str) -> str:
        normalized = remove_diacritics(text).upper()
        letters = re.sub(r"[^A-Z]", "", normalized)
        if alphabet_mode.upper() == "I=J":
            letters = letters.replace("J", "I")
        elif alphabet_mode.upper() == "Q_OMITTED":
            letters = letters.replace("Q", "")
        return letters

    def _normalize_letter(self, value: str, alphabet_mode: str) -> str:
        normalized = self._normalize_text(value, alphabet_mode)
        return normalized[:1]

    def _clean_letters(self, text: str) -> str:
        return re.sub(r"[^A-Z]", "", remove_diacritics(text).upper())

    def _group_text(self, text: str, group_size: int) -> str:
        return " ".join(text[i : i + group_size] for i in range(0, len(text), group_size))

    def _parameters(
        self,
        mode: str,
        key: str,
        alphabet_mode: str,
        filler: str,
        alternate_filler: str,
        cleanup_fillers: bool,
        group_output: bool,
    ) -> Dict[str, Any]:
        return {
            "mode": mode,
            "key": key,
            "alphabet_mode": alphabet_mode,
            "filler": filler,
            "alternate_filler": alternate_filler,
            "cleanup_fillers": cleanup_fillers,
            "group_output": group_output,
        }

    def _square_metadata(self, square: Dict[str, Any]) -> Dict[str, Any]:
        metadata = {
            "grid": ["".join(row) for row in square["grid"]],
            "grid_string": square["grid_string"],
            "alphabet_mode": square["alphabet_mode"],
        }
        if square.get("used_default_key"):
            metadata["warning"] = "Aucun mot-cle Playfair fourni: la grille alphabetique par defaut est utilisee."
        return metadata

    def _success_response(
        self,
        summary: str,
        text_output: str,
        confidence: float,
        parameters: Dict[str, Any],
        metadata: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": text_output,
                    "confidence": confidence,
                    "parameters": parameters,
                    "metadata": metadata,
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        execution_time = (time.time() - start_time) * 1000
        return {"name": self.name, "version": self.version, "execution_time_ms": round(execution_time, 2)}

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {"status": "error", "summary": message, "results": [], "plugin_info": self._get_plugin_info(start_time)}


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return PlayfairCipherPlugin().execute(inputs)
