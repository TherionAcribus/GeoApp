from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Dict, List, Tuple


class ChaocipherPlugin:
    """Chaocipher with two dynamic alphabets.

    The right alphabet maps plaintext to the left alphabet for encryption.
    After each processed letter, both alphabets are permuted according to
    Byrne's Chaocipher procedure.
    """

    DEFAULT_LEFT = "HXUCZVAMDSLKPEFJRIGTWOBNYQ"
    DEFAULT_RIGHT = "PTLNBQDEOYSFAVZKGJRIHWXUMC"
    ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    def __init__(self) -> None:
        self.name = "chaocipher"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()
        strict_mode = str(inputs.get("strict", "smooth")).lower() == "strict"
        embedded = self._parse_bool(inputs.get("embedded", False), default=False)
        allowed_chars = str(inputs.get("allowed_chars", " \t\r\n.:;,_-'\"!?") or "")
        preserve_case = self._parse_bool(inputs.get("preserve_case", True), default=True)
        advance_on_nonletters = self._parse_bool(inputs.get("advance_on_nonletters", False), default=False)

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        try:
            left, right = self._resolve_alphabets(inputs)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

        if mode == "detect":
            is_match, score, metadata = self.detect(text, strict_mode=strict_mode, allowed_chars=allowed_chars)
            summary = "Texte compatible avec Chaocipher" if is_match else "Texte peu compatible avec Chaocipher"
            return {
                "status": "ok",
                "summary": summary,
                "results": [
                    {
                        "id": "result_1",
                        "text_output": f"{summary} (score: {score:.2f})",
                        "confidence": float(score),
                        "parameters": {
                            "mode": "detect",
                            "strict": "strict" if strict_mode else "smooth",
                            "embedded": embedded,
                        },
                        "metadata": metadata,
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if mode not in {"encode", "decode"}:
            return self._error_response(f"Mode inconnu: {mode}", start_time)

        if strict_mode and not embedded:
            ok, reason = self._is_text_strictly_compatible(text, allowed_chars=allowed_chars)
            if not ok:
                return self._error_response(f"Texte incompatible avec Chaocipher (strict): {reason}", start_time)

        output, metadata = self.transform(
            text=text,
            left_alphabet=left,
            right_alphabet=right,
            encode=(mode == "encode"),
            preserve_case=preserve_case,
            advance_on_nonletters=advance_on_nonletters,
        )

        return self._success_response(
            summary="Encodage Chaocipher reussi" if mode == "encode" else "Decodage Chaocipher reussi",
            text_output=output,
            confidence=1.0 if mode == "encode" else 0.55,
            parameters={
                "mode": mode,
                "left_alphabet": left,
                "right_alphabet": right,
                "preserve_case": preserve_case,
                "advance_on_nonletters": advance_on_nonletters,
            },
            metadata=metadata,
            start_time=start_time,
        )

    def transform(
        self,
        text: str,
        left_alphabet: str,
        right_alphabet: str,
        encode: bool,
        preserve_case: bool = True,
        advance_on_nonletters: bool = False,
    ) -> Tuple[str, Dict[str, Any]]:
        left = self._validate_alphabet(left_alphabet, "alphabet gauche")
        right = self._validate_alphabet(right_alphabet, "alphabet droit")
        normalized = self._remove_diacritics(text)

        output: List[str] = []
        processed_chars = 0
        skipped_chars = 0
        trace: List[Dict[str, Any]] = []

        for ch in normalized:
            upper = ch.upper()
            if upper not in self.ALPHABET:
                output.append(ch)
                skipped_chars += 1
                if advance_on_nonletters:
                    left, right = self._permute(left, right, 0)
                continue

            if encode:
                index = right.index(upper)
                transformed = left[index]
            else:
                index = left.index(upper)
                transformed = right[index]

            if preserve_case and ch.islower():
                transformed = transformed.lower()
            output.append(transformed)

            if len(trace) < 12:
                trace.append(
                    {
                        "input": ch,
                        "output": transformed,
                        "index": index,
                        "left_before": left,
                        "right_before": right,
                    }
                )

            left, right = self._permute(left, right, index)
            processed_chars += 1

        return "".join(output), {
            "processed_chars": processed_chars,
            "skipped_chars": skipped_chars,
            "initial_left_alphabet": self._validate_alphabet(left_alphabet, "alphabet gauche"),
            "initial_right_alphabet": self._validate_alphabet(right_alphabet, "alphabet droit"),
            "final_left_alphabet": left,
            "final_right_alphabet": right,
            "trace": trace,
        }

    def _permute(self, left: str, right: str, index: int) -> Tuple[str, str]:
        left = left[index:] + left[:index]
        left = left[0] + left[2:14] + left[1] + left[14:]

        right = right[index:] + right[:index]
        right = right[1:] + right[0]
        right = right[:2] + right[3:14] + right[2] + right[14:]
        return left, right

    def detect(self, text: str, strict_mode: bool, allowed_chars: str) -> Tuple[bool, float, Dict[str, Any]]:
        normalized = self._remove_diacritics(text)
        letters = sum(1 for ch in normalized.upper() if ch in self.ALPHABET)
        if letters == 0:
            return False, 0.0, {"is_match": False, "letters_count": 0}

        if strict_mode:
            ok, _reason = self._is_text_strictly_compatible(text, allowed_chars=allowed_chars)
            if not ok:
                return False, 0.0, {"is_match": False, "letters_count": letters, "strict_compatible": False}

        allowed = set(allowed_chars)
        non_allowed = 0
        for ch in normalized:
            if ch.upper() in self.ALPHABET or ch in allowed:
                continue
            non_allowed += 1

        score = letters / max(1, letters + non_allowed)
        return True, float(score), {
            "is_match": True,
            "letters_count": letters,
            "non_allowed_count": non_allowed,
            "detection_score": float(score),
            "warning": "Detection heuristique: Chaocipher produit un texte alphabetique et necessite deux alphabets.",
        }

    def _resolve_alphabets(self, inputs: Dict[str, Any]) -> Tuple[str, str]:
        left_alphabet = str(inputs.get("left_alphabet", "") or "").strip()
        right_alphabet = str(inputs.get("right_alphabet", "") or "").strip()
        left_key = str(inputs.get("left_key", "") or "").strip()
        right_key = str(inputs.get("right_key", "") or "").strip()

        if not left_alphabet and left_key:
            left_alphabet = self._keyed_alphabet(left_key)
        if not right_alphabet and right_key:
            right_alphabet = self._keyed_alphabet(right_key)

        left = left_alphabet or self.DEFAULT_LEFT
        right = right_alphabet or self.DEFAULT_RIGHT
        return self._validate_alphabet(left, "alphabet gauche"), self._validate_alphabet(right, "alphabet droit")

    def _keyed_alphabet(self, key: str) -> str:
        cleaned = self._clean_letters(key)
        if not cleaned:
            raise ValueError("Le mot-cle doit contenir au moins une lettre A-Z")
        chars: List[str] = []
        for ch in cleaned + self.ALPHABET:
            if ch not in chars:
                chars.append(ch)
        return "".join(chars)

    def _validate_alphabet(self, value: str, label: str) -> str:
        cleaned = self._clean_letters(value)
        if len(cleaned) != 26 or set(cleaned) != set(self.ALPHABET):
            raise ValueError(f"{label} invalide: il doit contenir les 26 lettres A-Z une seule fois")
        return cleaned

    def _is_text_strictly_compatible(self, text: str, allowed_chars: str) -> Tuple[bool, str]:
        normalized = self._remove_diacritics(text)
        allowed = set(allowed_chars)
        has_letter = False
        for ch in normalized:
            if ch.upper() in self.ALPHABET:
                has_letter = True
                continue
            if ch in allowed:
                continue
            return False, f"caractere non autorise: {ch!r}"
        if not has_letter:
            return False, "aucune lettre detectee"
        return True, ""

    def _clean_letters(self, text: str) -> str:
        return re.sub(r"[^A-Z]", "", self._remove_diacritics(text).upper())

    def _remove_diacritics(self, text: str) -> str:
        decomposed = unicodedata.normalize("NFKD", str(text))
        return "".join(ch for ch in decomposed if not unicodedata.combining(ch))

    def _parse_bool(self, value: Any, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes", "on"}
        return default

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
    return ChaocipherPlugin().execute(inputs)
