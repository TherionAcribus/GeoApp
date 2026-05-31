from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple


class PikalangPlugin:
    """Pikalang decoder/encoder built on the Brainfuck interpreter."""

    TOKEN_TO_BF = {
        "pi": "+",
        "ka": "-",
        "pipi": ">",
        "pichu": "<",
        "pika": "[",
        "chu": "]",
        "pikachu": ".",
        "pikapi": ",",
    }
    BF_TO_TOKEN = {value: key for key, value in TOKEN_TO_BF.items()}
    TOKENS_BY_LENGTH = sorted(TOKEN_TO_BF, key=len, reverse=True)

    def __init__(self) -> None:
        self.name = "pikalang"
        self.version = "1.0.0"
        self.brainfuck = self._load_brainfuck_plugin()

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        encode_source = str(inputs.get("encode_source", "text") or "text").lower()
        input_stream = str(inputs.get("input_stream", "") or "")
        cell_mode = str(inputs.get("cell_mode", "8bit") or "8bit").lower()
        eof_behavior = str(inputs.get("eof_behavior", "zero") or "zero").lower()
        output_format = str(inputs.get("output_format", "text") or "text").lower()
        token_separator = str(inputs.get("token_separator", "space") or "space").lower()
        tape_size = self._parse_int(inputs.get("tape_size", 30000), default=30000, minimum=1, maximum=1_000_000)
        max_steps = self._parse_int(inputs.get("max_steps", 1_000_000), default=1_000_000, minimum=1, maximum=10_000_000)
        output_limit = self._parse_int(inputs.get("output_limit", 10000), default=10000, minimum=1, maximum=100000)
        allow_tape_growth = self._parse_bool(inputs.get("allow_tape_growth", False), default=False)
        strict = str(inputs.get("strict", "smooth") or "smooth").lower() == "strict"

        if text is None or str(text).strip() == "":
            return self._error_response("Aucun texte fourni", start_time)

        try:
            if mode == "decode":
                program, translate_meta = self.pikalang_to_brainfuck(str(text), strict=strict)
                if not program:
                    return self._error_response("Aucune instruction Pikalang trouvee", start_time)

                if output_format == "brainfuck":
                    metadata = translate_meta
                    metadata["brainfuck_program"] = program
                    return self._success_response(
                        "Traduction Pikalang vers Brainfuck reussie",
                        program,
                        1.0,
                        {"mode": mode, "output_format": output_format, "strict": "strict" if strict else "smooth"},
                        metadata,
                        start_time,
                    )

                output, runtime_meta = self.brainfuck.run_program(
                    program=program,
                    input_stream=input_stream,
                    cell_mode=cell_mode,
                    eof_behavior=eof_behavior,
                    tape_size=tape_size,
                    max_steps=max_steps,
                    output_limit=output_limit,
                    allow_tape_growth=allow_tape_growth,
                )
                formatted = self.brainfuck.format_output(output, output_format)
                metadata = translate_meta
                metadata.update(runtime_meta)
                metadata["brainfuck_program"] = program
                metadata["output_length"] = len(output)
                return self._success_response(
                    "Execution Pikalang reussie",
                    formatted,
                    0.95,
                    {
                        "mode": mode,
                        "cell_mode": cell_mode,
                        "eof_behavior": eof_behavior,
                        "output_format": output_format,
                        "token_separator": token_separator,
                        "strict": "strict" if strict else "smooth",
                    },
                    metadata,
                    start_time,
                )

            if mode == "encode":
                if encode_source == "brainfuck":
                    program, ignored = self.brainfuck.clean_program(str(text), strict=strict)
                    if not program:
                        return self._error_response("Aucune instruction Brainfuck trouvee", start_time)
                    source_meta = {"encode_source": "brainfuck", "ignored_characters": ignored}
                elif encode_source == "text":
                    program = self.brainfuck.encode_text(str(text), cell_mode=cell_mode)
                    source_meta = {"encode_source": "text", "input_length": len(str(text))}
                else:
                    return self._error_response("Source d'encodage inconnue: utilisez text ou brainfuck", start_time)

                pikalang = self.brainfuck_to_pikalang(program, token_separator=token_separator)
                source_meta.update(
                    {
                        "brainfuck_program": program,
                        "brainfuck_length": len(program),
                        "pikalang_tokens": len(program),
                        "token_separator": token_separator,
                    }
                )
                return self._success_response(
                    "Encodage Pikalang reussi",
                    pikalang,
                    1.0,
                    {
                        "mode": mode,
                        "encode_source": encode_source,
                        "cell_mode": cell_mode,
                        "token_separator": token_separator,
                    },
                    source_meta,
                    start_time,
                )

            if mode == "detect":
                return self._detect_response(str(text), start_time)

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def pikalang_to_brainfuck(self, text: str, strict: bool = False) -> Tuple[str, Dict[str, Any]]:
        source = str(text).lower()
        commands: List[str] = []
        ignored_chars: List[str] = []
        index = 0

        while index < len(source):
            ch = source[index]
            if ch.isspace():
                index += 1
                continue

            matched_token = None
            for token in self.TOKENS_BY_LENGTH:
                if source.startswith(token, index):
                    matched_token = token
                    break

            if matched_token is not None:
                commands.append(self.TOKEN_TO_BF[matched_token])
                index += len(matched_token)
                continue

            if strict:
                raise ValueError(f"Token Pikalang inconnu a la position {index}: {text[index]!r}")
            ignored_chars.append(text[index])
            index += 1

        program = "".join(commands)
        self.brainfuck.build_jump_map(program)
        return program, {
            "tokens_count": len(commands),
            "ignored_characters": len(ignored_chars),
            "ignored_sample": "".join(ignored_chars[:20]),
        }

    def brainfuck_to_pikalang(self, program: str, token_separator: str = "space") -> str:
        tokens = [self.BF_TO_TOKEN[command] for command in program if command in self.BF_TO_TOKEN]
        if token_separator == "none":
            return "".join(tokens)
        if token_separator == "newline":
            return "\n".join(tokens)
        if token_separator == "space":
            return " ".join(tokens)
        raise ValueError("Separateur inconnu: utilisez space, none ou newline")

    def _detect_response(self, text: str, start_time: float) -> Dict[str, Any]:
        try:
            program, meta = self.pikalang_to_brainfuck(text, strict=False)
            balanced = True
        except ValueError:
            program = ""
            meta = {"tokens_count": 0, "ignored_characters": len(text), "ignored_sample": ""}
            balanced = False

        letters = [ch for ch in text.lower() if ch.isalpha()]
        token_letters = sum(len(token) for token in self._tokens_from_program(program))
        token_ratio = token_letters / max(1, len(letters))
        has_execution_shape = "." in program or "," in program or "[" in program
        is_match = len(program) >= 4 and token_ratio >= 0.65 and balanced and has_execution_shape
        score = min(1.0, token_ratio * (1.0 if balanced else 0.4))
        summary = "Code Pikalang probable" if is_match else "Code Pikalang peu probable"

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
                        "brainfuck_program": program,
                        "brackets_balanced": balanced,
                        "token_ratio": float(token_ratio),
                        **meta,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _tokens_from_program(self, program: str) -> List[str]:
        return [self.BF_TO_TOKEN[command] for command in program if command in self.BF_TO_TOKEN]

    def _load_brainfuck_plugin(self):
        brainfuck_path = Path(__file__).resolve().parents[1] / "brainfuck" / "main.py"
        spec = importlib.util.spec_from_file_location("brainfuck_for_pikalang", brainfuck_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("Impossible de charger le plugin Brainfuck")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module.BrainfuckPlugin()

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

    def _parse_int(self, value: Any, default: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(maximum, parsed))

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

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {"status": "error", "summary": message, "results": [], "plugin_info": self._get_plugin_info(start_time)}

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        return {"name": self.name, "version": self.version, "execution_time_ms": round((time.time() - start_time) * 1000, 2)}


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return PikalangPlugin().execute(inputs)
