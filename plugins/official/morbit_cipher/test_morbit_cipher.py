from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("morbit_cipher_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "MorbitCipherPlugin")


def test_boxentriq_secretkey_example() -> None:
    MorbitCipherPlugin = _load_plugin_class()
    plugin = MorbitCipherPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {
            "text": "ONCE UPON A TIME",
            "mode": "encode",
            "key": "SECRETKEY",
        }
    )

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["parameters"]["permutation"] == "721638549"
    assert encoded["results"][0]["text_output"] == "38642 11525 31386 92987 481"


def test_decode_boxentriq_secretkey_example() -> None:
    MorbitCipherPlugin = _load_plugin_class()
    plugin = MorbitCipherPlugin()

    decoded: Dict[str, Any] = plugin.execute(
        {
            "text": "38642 11525 31386 92987 481",
            "mode": "decode",
            "key": "SECRETKEY",
            "strict": "strict",
        }
    )

    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "ONCE UPON A TIME"


def test_digit_permutation_key_matches_keyword_key() -> None:
    MorbitCipherPlugin = _load_plugin_class()
    plugin = MorbitCipherPlugin()

    keyword: Dict[str, Any] = plugin.execute({"text": "HELLO 2026", "mode": "encode", "key": "SECRETKEY"})
    digits: Dict[str, Any] = plugin.execute({"text": "HELLO 2026", "mode": "encode", "key": "721638549"})

    assert keyword["status"] == "ok"
    assert digits["status"] == "ok"
    assert keyword["results"][0]["text_output"] == digits["results"][0]["text_output"]


def test_invalid_key_is_rejected() -> None:
    MorbitCipherPlugin = _load_plugin_class()
    plugin = MorbitCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "12345", "mode": "decode", "key": "ABC"})

    assert result["status"] == "error"
    assert "Cle Morbit requise" in result["summary"]


def test_detect_digits() -> None:
    MorbitCipherPlugin = _load_plugin_class()
    plugin = MorbitCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "38642 11525", "mode": "detect", "strict": "strict"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
