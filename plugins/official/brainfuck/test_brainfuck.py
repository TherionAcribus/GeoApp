from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("brainfuck_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "BrainfuckPlugin")


def test_hello_world_program_decodes() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()
    program = "++++++++++[>+++++++>++++++++++>+++>+<<<<-]>++.>+.+++++++..+++.>++.<<+++++++++++++++.>.+++.------.--------.>+.>."

    result: Dict[str, Any] = plugin.execute({"text": program, "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Hello World!\n"


def test_comments_are_ignored_in_smooth_mode() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "comment +++++ +++++ [> +++++ ++ <-] > ++ .", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "H"
    assert result["results"][0]["metadata"]["ignored_characters"] > 0


def test_strict_mode_rejects_comments() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "++ comment", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "strict" in result["summary"]


def test_input_stream_echo_until_eof_zero() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": ",[.,]", "mode": "decode", "input_stream": "Hi"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Hi"
    assert result["results"][0]["metadata"]["input_consumed"] == 2


def test_encode_text_generates_reversible_program() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "GC", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert set(encoded["results"][0]["text_output"]).issubset(set("+-<>.,[]"))
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GC"


def test_ascii_codes_output_format() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++.", "mode": "decode", "output_format": "ascii_codes"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "65"


def test_unbalanced_brackets_are_rejected() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "++[>++", "mode": "decode"})

    assert result["status"] == "error"
    assert "Crochet" in result["summary"]


def test_max_steps_stops_infinite_loop() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+[]", "mode": "decode", "max_steps": 20})

    assert result["status"] == "error"
    assert "limite" in result["summary"]


def test_detect_brainfuck_like_input() -> None:
    BrainfuckPlugin = _load_plugin_class()
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+++++[>+++++<-]>.", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
