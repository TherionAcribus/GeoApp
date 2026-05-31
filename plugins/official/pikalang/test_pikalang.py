from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("pikalang_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "PikalangPlugin")


def test_token_mapping_to_brainfuck() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    program, metadata = plugin.pikalang_to_brainfuck("pi ka pipi pichu pika chu pikachu pikapi")

    assert program == "+-><[].,"
    assert metadata["tokens_count"] == 8


def test_longest_match_keeps_pikachu_as_output_token() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    program, _metadata = plugin.pikalang_to_brainfuck("pikachu")

    assert program == "."


def test_decode_spaced_pikalang_program() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()
    program = ("pi " * 65) + "pikachu"

    result: Dict[str, Any] = plugin.execute({"text": program, "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


def test_decode_with_input_stream() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()
    echo_program = "pikapi pika pikachu pikapi chu"

    result: Dict[str, Any] = plugin.execute({"text": echo_program, "mode": "decode", "input_stream": "GC"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "GC"


def test_translate_to_brainfuck_output_format() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "pi pikachu", "mode": "decode", "output_format": "brainfuck"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "+."


def test_encode_text_generates_reversible_pikalang() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "GC", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert "pikachu" in encoded["results"][0]["text_output"]
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GC"


def test_encode_brainfuck_source() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "+.", "mode": "encode", "encode_source": "brainfuck"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "pi pikachu"


def test_strict_mode_rejects_unknown_tokens() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "pi nope pikachu", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "inconnu" in result["summary"]


def test_detect_pikalang_like_text() -> None:
    PikalangPlugin = _load_plugin_class()
    plugin = PikalangPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "pi pi pi pika ka chu pikachu", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
