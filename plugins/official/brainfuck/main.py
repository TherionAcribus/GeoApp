from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple


class BrainfuckPlugin:
    """Brainfuck interpreter for geocaching puzzle decoding."""

    COMMANDS = set("+-<>.,[]")

    def __init__(self) -> None:
        self.name = "brainfuck"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode") or "decode").lower()
        input_stream = str(inputs.get("input_stream", "") or "")
        cell_mode = str(inputs.get("cell_mode", "8bit") or "8bit").lower()
        eof_behavior = str(inputs.get("eof_behavior", "zero") or "zero").lower()
        output_format = str(inputs.get("output_format", "text") or "text").lower()
        tape_size = self._parse_int(inputs.get("tape_size", 30000), default=30000, minimum=1, maximum=1_000_000)
        max_steps = self._parse_int(inputs.get("max_steps", 1_000_000), default=1_000_000, minimum=1, maximum=10_000_000)
        output_limit = self._parse_int(inputs.get("output_limit", 10000), default=10000, minimum=1, maximum=100000)
        allow_tape_growth = self._parse_bool(inputs.get("allow_tape_growth", False), default=False)
        strict = str(inputs.get("strict", "smooth") or "smooth").lower() == "strict"

        if text is None or str(text).strip() == "":
            return self._error_response("Aucun texte fourni", start_time)

        try:
            if mode == "decode":
                program, ignored_count = self.clean_program(str(text), strict=strict)
                if not program:
                    return self._error_response("Aucune instruction Brainfuck trouvee", start_time)

                output, metadata = self.run_program(
                    program=program,
                    input_stream=input_stream,
                    cell_mode=cell_mode,
                    eof_behavior=eof_behavior,
                    tape_size=tape_size,
                    max_steps=max_steps,
                    output_limit=output_limit,
                    allow_tape_growth=allow_tape_growth,
                )
                metadata["ignored_characters"] = ignored_count
                metadata["program_length"] = len(program)
                metadata["output_length"] = len(output)
                formatted = self.format_output(output, output_format)
                return self._success_response(
                    "Execution Brainfuck reussie",
                    formatted,
                    0.95,
                    {
                        "mode": "decode",
                        "cell_mode": cell_mode,
                        "eof_behavior": eof_behavior,
                        "tape_size": tape_size,
                        "max_steps": max_steps,
                        "output_limit": output_limit,
                        "allow_tape_growth": allow_tape_growth,
                    },
                    metadata,
                    start_time,
                )

            if mode == "encode":
                program = self.encode_text(str(text), cell_mode=cell_mode)
                return self._success_response(
                    "Encodage Brainfuck reussi",
                    program,
                    1.0,
                    {"mode": "encode", "cell_mode": cell_mode},
                    {
                        "input_length": len(str(text)),
                        "program_length": len(program),
                        "encoder": "delta_current_cell",
                    },
                    start_time,
                )

            if mode == "detect":
                return self._detect_response(str(text), start_time)

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def clean_program(self, text: str, strict: bool = False) -> Tuple[str, int]:
        program = "".join(ch for ch in text if ch in self.COMMANDS)
        ignored_count = len(text) - len(program)
        if strict and ignored_count:
            raise ValueError("Le mode strict refuse les caracteres hors Brainfuck")
        self.build_jump_map(program)
        return program, ignored_count

    def run_program(
        self,
        program: str,
        input_stream: str = "",
        cell_mode: str = "8bit",
        eof_behavior: str = "zero",
        tape_size: int = 30000,
        max_steps: int = 1_000_000,
        output_limit: int = 10000,
        allow_tape_growth: bool = False,
    ) -> Tuple[str, Dict[str, Any]]:
        jump_map = self.build_jump_map(program)
        modulus = self._cell_modulus(cell_mode)
        eof_value = self._eof_value(eof_behavior)

        tape = [0] * tape_size
        pointer = 0
        instruction_pointer = 0
        input_index = 0
        steps = 0
        max_pointer = 0
        output_chars: List[str] = []

        while instruction_pointer < len(program):
            steps += 1
            if steps > max_steps:
                raise ValueError(f"Execution stoppee: limite de {max_steps} instructions atteinte")
            if len(output_chars) >= output_limit:
                raise ValueError(f"Execution stoppee: limite de sortie de {output_limit} caracteres atteinte")

            command = program[instruction_pointer]
            if command == "+":
                tape[pointer] = self._normalize_cell(tape[pointer] + 1, modulus)
            elif command == "-":
                tape[pointer] = self._normalize_cell(tape[pointer] - 1, modulus)
            elif command == ">":
                pointer += 1
                if pointer >= len(tape):
                    if allow_tape_growth:
                        tape.append(0)
                    else:
                        raise ValueError("Le pointeur depasse la taille du ruban")
                max_pointer = max(max_pointer, pointer)
            elif command == "<":
                pointer -= 1
                if pointer < 0:
                    raise ValueError("Le pointeur passe avant le debut du ruban")
            elif command == ".":
                output_chars.append(self._cell_to_char(tape[pointer]))
            elif command == ",":
                if input_index < len(input_stream):
                    tape[pointer] = self._normalize_cell(ord(input_stream[input_index]), modulus)
                    input_index += 1
                elif eof_value is not None:
                    tape[pointer] = self._normalize_cell(eof_value, modulus)
            elif command == "[":
                if tape[pointer] == 0:
                    instruction_pointer = jump_map[instruction_pointer]
            elif command == "]":
                if tape[pointer] != 0:
                    instruction_pointer = jump_map[instruction_pointer]

            instruction_pointer += 1

        return "".join(output_chars), {
            "steps": steps,
            "final_pointer": pointer,
            "max_pointer": max_pointer,
            "cells_used": max_pointer + 1,
            "input_consumed": input_index,
            "cell_mode": cell_mode,
            "eof_behavior": eof_behavior,
            "normalized_program": program,
        }

    def build_jump_map(self, program: str) -> Dict[int, int]:
        stack: List[int] = []
        jump_map: Dict[int, int] = {}
        for index, command in enumerate(program):
            if command == "[":
                stack.append(index)
            elif command == "]":
                if not stack:
                    raise ValueError("Crochet fermant sans crochet ouvrant")
                start = stack.pop()
                jump_map[start] = index
                jump_map[index] = start
        if stack:
            raise ValueError("Crochet ouvrant sans crochet fermant")
        return jump_map

    def encode_text(self, text: str, cell_mode: str = "8bit") -> str:
        modulus = self._cell_modulus(cell_mode)
        if modulus is None:
            modulus = 256

        current = 0
        chunks: List[str] = []
        for ch in text:
            target = ord(ch)
            if target >= modulus:
                raise ValueError(f"Caractere impossible a encoder avec {cell_mode}: {ch!r}")

            forward = (target - current) % modulus
            backward = (current - target) % modulus
            if forward <= backward:
                chunks.append("+" * forward)
            else:
                chunks.append("-" * backward)
            chunks.append(".")
            current = target
        return "".join(chunks)

    def format_output(self, output: str, output_format: str) -> str:
        if output_format == "text":
            return output
        if output_format == "ascii_codes":
            return " ".join(str(ord(ch)) for ch in output)
        if output_format == "both":
            codes = " ".join(str(ord(ch)) for ch in output)
            return f"{output}\nASCII: {codes}"
        raise ValueError("Format de sortie inconnu: utilisez text, ascii_codes ou both")

    def _detect_response(self, text: str, start_time: float) -> Dict[str, Any]:
        stripped = re.sub(r"\s+", "", text)
        if not stripped:
            score = 0.0
            is_match = False
            command_count = 0
            command_ratio = 0.0
            balanced = False
        else:
            command_count = sum(1 for ch in text if ch in self.COMMANDS)
            command_ratio = command_count / max(1, len(stripped))
            try:
                program, _ignored = self.clean_program(text)
                balanced = bool(program)
            except ValueError:
                balanced = False
            has_loop_or_output = any(ch in text for ch in "[]") or "." in text
            is_match = command_count >= 4 and command_ratio >= 0.55 and balanced and has_loop_or_output
            score = min(1.0, command_ratio * (1.0 if balanced else 0.4))

        summary = "Code Brainfuck probable" if is_match else "Code Brainfuck peu probable"
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
                        "command_count": command_count,
                        "command_ratio": float(command_ratio),
                        "brackets_balanced": balanced,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _cell_modulus(self, cell_mode: str) -> Optional[int]:
        normalized = str(cell_mode).lower()
        if normalized in {"8bit", "byte", "mod256"}:
            return 256
        if normalized in {"16bit", "mod65536"}:
            return 65536
        if normalized in {"unbounded", "int", "integer"}:
            return None
        raise ValueError("Mode cellule inconnu: utilisez 8bit, 16bit ou unbounded")

    def _eof_value(self, eof_behavior: str) -> Optional[int]:
        normalized = str(eof_behavior).lower()
        if normalized == "zero":
            return 0
        if normalized == "minus_one":
            return -1
        if normalized == "no_change":
            return None
        raise ValueError("Comportement EOF inconnu: utilisez zero, minus_one ou no_change")

    def _normalize_cell(self, value: int, modulus: Optional[int]) -> int:
        if modulus is None:
            return value
        return value % modulus

    def _cell_to_char(self, value: int) -> str:
        if 0 <= value <= 0x10FFFF:
            try:
                return chr(value)
            except ValueError:
                pass
        return "\uFFFD"

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

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        execution_time = (time.time() - start_time) * 1000
        return {"name": self.name, "version": self.version, "execution_time_ms": round(execution_time, 2)}

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {"status": "error", "summary": message, "results": [], "plugin_info": self._get_plugin_info(start_time)}


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return BrainfuckPlugin().execute(inputs)
