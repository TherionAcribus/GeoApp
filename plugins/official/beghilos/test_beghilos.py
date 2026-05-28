from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("beghilos_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "BeghilosPlugin")


def test_dcode_google_example() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "GOOGLE", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "376006"


def test_dcode_soleil_example() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "SOLEIL", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": "713705", "mode": "decode"})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "713705"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "SOLEIL"


def test_phrase_reverse_matches_dcode_sample() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "SOLEIL BEGHILOS", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": "50714638 713705", "mode": "decode"})

    assert encoded["results"][0]["text_output"] == "50714638 713705"
    assert decoded["results"][0]["text_output"] == "SOLEIL BEGHILOS"


def test_display_style_uses_lowercase_g_h_b() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "946", "mode": "decode", "letter_style": "display"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ghb"


def test_case_sensitive_b_can_encode_digit_9() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Bob", "mode": "encode", "case_sensitive_b": True})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "908"


def test_strict_rejects_non_beghilos_letters() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "CACHE", "mode": "encode", "strict": "strict"})

    assert result["status"] == "error"
    assert "strict" in result["summary"]


def test_detect_digit_input() -> None:
    BeghilosPlugin = _load_plugin_class()
    plugin = BeghilosPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "5318008", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
