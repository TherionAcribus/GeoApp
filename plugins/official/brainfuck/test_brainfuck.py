from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_hello_world_program_decodes() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()
    program = "++++++++++[>+++++++>++++++++++>+++>+<<<<-]>++.>+.+++++++..+++.>++.<<+++++++++++++++.>.+++.------.--------.>+.>."

    result: Dict[str, Any] = plugin.execute({"text": program, "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Hello World!\n"


def test_comments_are_ignored_in_smooth_mode() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "comment +++++ +++++ [> +++++ ++ <-] > ++ .", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "H"
    assert result["results"][0]["metadata"]["ignored_characters"] > 0


def test_strict_mode_rejects_comments() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "++ comment", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "strict" in result["summary"]


def test_input_stream_echo_until_eof_zero() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": ",[.,]", "mode": "decode", "input_stream": "Hi"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Hi"
    assert result["results"][0]["metadata"]["input_consumed"] == 2


def test_encode_text_generates_reversible_program() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "GC", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert set(encoded["results"][0]["text_output"]).issubset(set("+-<>.,[]"))
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GC"


def test_ascii_codes_output_format() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++.", "mode": "decode", "output_format": "ascii_codes"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "65"


def test_unbalanced_brackets_are_rejected() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "++[>++", "mode": "decode"})

    assert result["status"] == "error"
    assert "Crochet" in result["summary"]


def test_max_steps_stops_infinite_loop() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+[]", "mode": "decode", "max_steps": 20})

    assert result["status"] == "error"
    assert "limite" in result["summary"]


def test_detect_brainfuck_like_input() -> None:
    BrainfuckPlugin = load_plugin_class(__file__)
    plugin = BrainfuckPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+++++[>+++++<-]>.", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
