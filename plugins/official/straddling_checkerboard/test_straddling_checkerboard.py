from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("straddling_checkerboard_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "StraddlingCheckerboardPlugin")


def test_wikipedia_attack_at_dawn_example_encodes() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ATTACK AT DAWN", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "3113212731223655"


def test_wikipedia_attack_at_dawn_example_decodes() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "3113212731223655", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ATTACKATDAWN"


def test_wikipedia_modulo_numeric_key_example() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "ATTACK AT DAWN", "mode": "encode", "numeric_key": "0452"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode", "numeric_key": "0452"})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "3565257935743007"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "ATTACKATDAWN"


def test_single_escape_digit_roundtrip() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "A5B", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "362520"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "A5B"


def test_triple_escape_digit_roundtrip() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "A57B", "mode": "encode", "numeric_mode": "triple_escape"})
    decoded: Dict[str, Any] = plugin.execute(
        {"text": encoded["results"][0]["text_output"], "mode": "decode", "numeric_mode": "triple_escape"}
    )

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "3625557776220"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "A57B"


def test_custom_checkerboard_roundtrip() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    inputs = {
        "text": "GEOCACHE",
        "mode": "encode",
        "top_row": "AT ONE SIR",
        "alphabet_key": "MYSTERY",
    }
    encoded: Dict[str, Any] = plugin.execute(inputs)
    decoded: Dict[str, Any] = plugin.execute({**inputs, "text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GEOCACHE"


def test_output_as_letters_uses_same_checkerboard() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "ATTACK AT DAWN", "mode": "encode", "numeric_key": "0452", "output_format": "letters"}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ANWHRSANROAEER"


def test_detect_digit_ciphertext() -> None:
    StraddlingCheckerboardPlugin = _load_plugin_class()
    plugin = StraddlingCheckerboardPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "3113212731223655", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
