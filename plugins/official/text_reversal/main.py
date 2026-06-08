from __future__ import annotations

import re
import time
from typing import Any, Dict, List


class TextReversalPlugin:
    """Reverse a whole text or each word independently."""

    WORD_PATTERN = re.compile(r"([^\W\d_]+(?:['’-][^\W\d_]+)*)", re.UNICODE)

    def __init__(self) -> None:
        self.name = "text_reversal"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        reversal_scope = str(inputs.get("reversal_scope", "words") or "words").lower()
        preserve_punctuation = self._parse_bool(inputs.get("preserve_punctuation", True), default=True)

        if text is None or str(text) == "":
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "detect":
            return self._detect_response(str(text), start_time)

        if mode not in {"decode", "encode"}:
            return self._error_response(f"Mode inconnu: {mode}", start_time)

        try:
            output, metadata = self.reverse_text(
                str(text),
                reversal_scope=reversal_scope,
                preserve_punctuation=preserve_punctuation,
            )
            return self._success_response(
                "Inversion de texte reussie",
                output,
                1.0,
                {
                    "mode": mode,
                    "reversal_scope": reversal_scope,
                    "preserve_punctuation": preserve_punctuation,
                },
                metadata,
                start_time,
            )
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def reverse_text(
        self,
        text: str,
        reversal_scope: str = "words",
        preserve_punctuation: bool = True,
    ) -> tuple[str, Dict[str, Any]]:
        if reversal_scope == "full":
            return text[::-1], {
                "characters_processed": len(text),
                "words_processed": len(self.WORD_PATTERN.findall(text)),
            }

        if reversal_scope == "words":
            output_parts: List[str] = []
            last_end = 0
            words_processed = 0
            for match in self.WORD_PATTERN.finditer(text):
                output_parts.append(text[last_end : match.start()])
                output_parts.append(match.group(0)[::-1])
                last_end = match.end()
                words_processed += 1
            output_parts.append(text[last_end:])
            return "".join(output_parts), {
                "characters_processed": len(text),
                "words_processed": words_processed,
            }

        if reversal_scope == "words_with_punctuation":
            return self._reverse_whitespace_tokens(text, preserve_punctuation=preserve_punctuation)

        raise ValueError("Portee inconnue: utilisez words, words_with_punctuation ou full")

    def _reverse_whitespace_tokens(self, text: str, preserve_punctuation: bool) -> tuple[str, Dict[str, Any]]:
        token_pattern = re.compile(r"\S+|\s+", re.UNICODE)
        output: List[str] = []
        words_processed = 0
        for token in token_pattern.findall(text):
            if token.isspace():
                output.append(token)
                continue
            words_processed += 1
            if preserve_punctuation:
                output.append(self._reverse_token_keep_edge_punctuation(token))
            else:
                output.append(token[::-1])
        return "".join(output), {
            "characters_processed": len(text),
            "words_processed": words_processed,
        }

    def _reverse_token_keep_edge_punctuation(self, token: str) -> str:
        prefix_match = re.match(r"^\W+", token, flags=re.UNICODE)
        suffix_match = re.search(r"\W+$", token, flags=re.UNICODE)
        prefix = prefix_match.group(0) if prefix_match else ""
        suffix = suffix_match.group(0) if suffix_match else ""
        start = len(prefix)
        end = len(token) - len(suffix) if suffix else len(token)
        core = token[start:end]
        return prefix + core[::-1] + suffix

    def _detect_response(self, text: str, start_time: float) -> Dict[str, Any]:
        words = self.WORD_PATTERN.findall(text)
        reversed_words = [word for word in words if len(word) >= 4 and self._looks_reversed(word)]
        score = min(1.0, len(reversed_words) / max(1, len(words)))
        is_match = len(reversed_words) >= 1 and score >= 0.2
        summary = "Texte inverse probable" if is_match else "Texte inverse peu probable"
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": f"{summary} (score: {score:.2f})",
                    "confidence": float(score),
                    "parameters": {"mode": "detect"},
                    "metadata": {
                        "is_match": is_match,
                        "words_count": len(words),
                        "reversed_candidates": reversed_words[:10],
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _looks_reversed(self, word: str) -> bool:
        lowered = word.lower()
        reversed_lowered = lowered[::-1]
        common_endings = ("ent", "tion", "ment", "que", "ant", "eur", "oir", "er", "es", "re")
        common_starts_reversed = tuple(ending[::-1] for ending in common_endings)
        return lowered.startswith(common_starts_reversed) or reversed_lowered.endswith(common_endings)

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
        return {"name": self.name, "version": self.version, "execution_time_ms": round(execution_time, 2)}

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {"status": "error", "summary": message, "results": [], "plugin_info": self._get_plugin_info(start_time)}


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return TextReversalPlugin().execute(inputs)
