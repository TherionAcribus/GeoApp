from __future__ import annotations

import re
import string
import time
from typing import Any, Dict, List, Optional, Tuple

try:
    from gc_backend.plugins.code_solving import is_alpha_strict, parse_bool, parse_mode_params, remove_diacritics
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import is_alpha_strict, parse_bool, parse_mode_params, remove_diacritics

try:
    from gc_backend.plugins.scoring import score_text, score_text_fast

    _SCORING_AVAILABLE = True
except Exception:  # pragma: no cover - optional backend dependency
    score_text = None
    score_text_fast = None
    _SCORING_AVAILABLE = False


class BeaufortCipherPlugin:
    """Beaufort and German Beaufort ciphers.

    Classic Beaufort uses C = K - P and is reciprocal: decode is the same
    transform as encode. The German/Variant Beaufort uses C = P - K; decode
    then requires P = C + K, exactly like Vigenere decoding in reverse.
    """

    def __init__(self) -> None:
        self.name = "beaufort_cipher"
        self.version = "1.1.0"
        self._alphabet = string.ascii_uppercase
        self._alphabet_len = 26

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        params = parse_mode_params(inputs, default_mode="decode", default_allowed_chars=" \t\r\n.:;,_-'\"!?")
        text = inputs.get("text", "")
        mode = params.mode
        key = str(inputs.get("key", "") or "")
        variant = str(inputs.get("variant", "classic")).lower()
        strict_mode = params.strict
        embedded = params.embedded
        allowed_chars = params.allowed_chars
        preserve_case = parse_bool(inputs.get("preserve_case", True), default=True)
        enable_scoring = parse_bool(inputs.get("enable_scoring", True), default=True)
        context = inputs.get("context", {})
        candidate_keys = self._parse_candidate_keys(inputs.get("candidate_keys"))
        max_results = min(max(int(inputs.get("max_results", 10) or 10), 1), 50)
        do_bruteforce = mode == "bruteforce" or parse_bool(inputs.get("bruteforce", False), default=False)

        if not isinstance(text, str) or not text:
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "detect":
            is_match, score, metadata = self.detect(text, strict_mode=strict_mode, allowed_chars=allowed_chars)
            summary = "Texte compatible avec Beaufort" if is_match else "Texte peu compatible avec Beaufort"
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
                            "variant": self._canonical_variant(variant),
                            "strict": "strict" if strict_mode else "smooth",
                            "embedded": embedded,
                        },
                        "metadata": metadata,
                    }
                ],
                "plugin_info": self._get_plugin_info(start_time),
            }

        if strict_mode and not embedded:
            ok, reason = is_alpha_strict(text, allowed_chars)
            if not ok:
                return self._error_response(f"Texte incompatible avec Beaufort (strict): {reason}", start_time)

        if do_bruteforce:
            keys = candidate_keys or ([key] if key else [])
            if not keys:
                return self._error_response("Aucune cle candidate fournie", start_time)
            return self._bruteforce_response(
                text=text,
                keys=keys[:max_results],
                variant=variant,
                preserve_case=preserve_case,
                enable_scoring=enable_scoring,
                context=context if isinstance(context, dict) else {},
                start_time=start_time,
            )

        clean_key = self._clean_key(key)
        if not clean_key:
            return self._error_response("La cle doit contenir au moins une lettre A-Z", start_time)

        try:
            if mode == "encode":
                output, processed = self.transform(text, clean_key, variant=variant, encode=True, preserve_case=preserve_case)
                confidence = 1.0
                summary = "Encodage Beaufort reussi"
            elif mode == "decode":
                output, processed = self.transform(text, clean_key, variant=variant, encode=False, preserve_case=preserve_case)
                confidence = 0.5
                summary = "Decodage Beaufort reussi"
            else:
                return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

        result_item: Dict[str, Any] = {
            "id": "result_1",
            "text_output": output,
            "confidence": confidence,
            "parameters": {
                "mode": mode,
                "key": clean_key,
                "variant": self._canonical_variant(variant),
                "preserve_case": preserve_case,
            },
            "metadata": {
                "processed_chars": processed,
                "formula": self._variant_formula(variant, encode=(mode == "encode")),
            },
        }

        if mode == "decode" and enable_scoring:
            scoring_result = self._get_score(output, context if isinstance(context, dict) else {})
            if scoring_result:
                result_item["scoring"] = scoring_result
                result_item["confidence"] = float(scoring_result.get("score", confidence))

        return {
            "status": "ok",
            "summary": summary,
            "results": [result_item],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def transform(self, text: str, key: str, variant: str = "classic", encode: bool = True, preserve_case: bool = True) -> Tuple[str, int]:
        clean_key = self._clean_key(key)
        if not clean_key:
            raise ValueError("La cle doit contenir au moins une lettre A-Z")

        canonical_variant = self._canonical_variant(variant)
        normalized = remove_diacritics(text)
        letters_count = sum(1 for ch in normalized.upper() if ch in self._alphabet)
        full_key = self._full_key(clean_key, letters_count)

        output: List[str] = []
        key_index = 0
        processed = 0

        for ch in normalized:
            up = ch.upper()
            if up not in self._alphabet:
                output.append(ch)
                continue

            key_val = ord(full_key[key_index]) - ord("A")
            text_val = ord(up) - ord("A")

            if canonical_variant == "classic":
                result_val = (key_val - text_val) % self._alphabet_len
            elif canonical_variant == "german":
                if encode:
                    result_val = (text_val - key_val) % self._alphabet_len
                else:
                    result_val = (text_val + key_val) % self._alphabet_len
            else:
                raise ValueError("Variante inconnue: utilisez classic ou german")

            result_char = chr(result_val + ord("A"))
            if preserve_case and ch.islower():
                result_char = result_char.lower()
            output.append(result_char)
            key_index += 1
            processed += 1

        return "".join(output), processed

    def detect(self, text: str, strict_mode: bool, allowed_chars: str) -> Tuple[bool, float, Dict[str, Any]]:
        normalized = remove_diacritics(text)
        letters = sum(1 for ch in normalized.upper() if ch in self._alphabet)
        if letters == 0:
            return False, 0.0, {"is_match": False, "letters_count": 0}

        if strict_mode:
            ok, _reason = is_alpha_strict(text, allowed_chars)
            if not ok:
                return False, 0.0, {"is_match": False, "letters_count": letters, "strict_compatible": False}

        non_allowed = 0
        allowed_set = set(allowed_chars)
        for ch in normalized:
            if ch.upper() in self._alphabet or ch in allowed_set:
                continue
            non_allowed += 1

        score = letters / max(1, letters + non_allowed)
        return True, float(score), {
            "is_match": True,
            "letters_count": letters,
            "non_allowed_count": non_allowed,
            "detection_score": float(score),
            "warning": "Detection heuristique: Beaufort ressemble a tout chiffre polyalphabetique alphabetique.",
        }

    def _bruteforce_response(
        self,
        text: str,
        keys: List[str],
        variant: str,
        preserve_case: bool,
        enable_scoring: bool,
        context: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        results: List[Dict[str, Any]] = []
        for index, candidate_key in enumerate(keys, start=1):
            clean_key = self._clean_key(candidate_key)
            if not clean_key:
                continue
            try:
                decoded, processed = self.transform(
                    text,
                    clean_key,
                    variant=variant,
                    encode=False,
                    preserve_case=preserve_case,
                )
            except ValueError:
                continue

            confidence = self._get_score_fast(decoded) if enable_scoring else 0.3
            results.append(
                {
                    "id": f"result_{index}",
                    "text_output": decoded,
                    "confidence": confidence,
                    "parameters": {
                        "mode": "decode",
                        "key": clean_key,
                        "variant": self._canonical_variant(variant),
                        "bruteforce": True,
                    },
                    "metadata": {"processed_chars": processed},
                }
            )

        results.sort(key=lambda item: item.get("confidence", 0.0), reverse=True)
        return {
            "status": "ok" if results else "error",
            "summary": f"{len(results)} cle(s) candidate(s) testee(s)" if results else "Aucune cle candidate valide",
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _canonical_variant(self, variant: str) -> str:
        value = str(variant or "classic").strip().lower()
        if value in {"classic", "beaufort", "key_minus_text", "key-text", "cle-texte"}:
            return "classic"
        if value in {"german", "variant", "variant_beaufort", "text_minus_key", "text-key", "texte-cle"}:
            return "german"
        raise ValueError("Variante inconnue: utilisez classic ou german")

    def _variant_formula(self, variant: str, encode: bool) -> str:
        canonical = self._canonical_variant(variant)
        if canonical == "classic":
            return "C = K - P; P = K - C"
        return "C = P - K" if encode else "P = C + K"

    def _clean_key(self, key: str) -> str:
        normalized = remove_diacritics(key)
        return "".join(ch for ch in normalized.upper() if ch in self._alphabet)

    def _full_key(self, cleaned_key: str, letters_count: int) -> str:
        return (cleaned_key * (letters_count // len(cleaned_key) + 1))[:letters_count]

    def _parse_candidate_keys(self, keys_input: Any) -> List[str]:
        if not keys_input:
            return []
        if isinstance(keys_input, list):
            raw = keys_input
        else:
            raw = re.split(r"[;,\n\r]+", str(keys_input))
        return [str(key).strip() for key in raw if str(key).strip()]

    def _get_score(self, text: str, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not _SCORING_AVAILABLE or not score_text:
            return None
        try:
            return score_text(text, context=context)
        except Exception:
            return None

    def _get_score_fast(self, text: str) -> float:
        if not _SCORING_AVAILABLE or not score_text_fast:
            return 0.3
        try:
            return float(score_text_fast(text))
        except Exception:
            return 0.3

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
    return BeaufortCipherPlugin().execute(inputs)
