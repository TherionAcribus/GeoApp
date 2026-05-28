from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("beaufort_cipher_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "BeaufortCipherPlugin")


def test_dcode_classic_example() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "DCODE", "mode": "encode", "key": "CLE"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ZJQZH"


def test_classic_beaufort_is_reciprocal() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "HELLO WORLD", "mode": "encode", "key": "FORT"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode", "key": "FORT"})

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HELLO WORLD"


def test_german_variant_roundtrip() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "DCODE", "mode": "encode", "key": "CLE", "variant": "german"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode", "key": "CLE", "variant": "german"})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "BRKBT"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "DCODE"


def test_preserves_case_and_punctuation() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "dCode Beaufort!", "mode": "encode", "key": "CLE"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "zJqzh Dylkxxnj!"


def test_beaufort_cipher_requires_key() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "HELLO", "mode": "encode", "key": ""})

    assert result["status"] == "error"


def test_bruteforce_candidate_keys() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "ZJQZH",
            "mode": "bruteforce",
            "candidate_keys": "ABC,CLE,SECRET",
            "enable_scoring": False,
        }
    )

    assert result["status"] == "ok"
    assert any(item["parameters"]["key"] == "CLE" and item["text_output"] == "DCODE" for item in result["results"])


def test_strict_rejects_unallowed_digits() -> None:
    BeaufortCipherPlugin = _load_plugin_class()
    plugin = BeaufortCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "HELLO 123", "mode": "decode", "key": "CLE", "strict": "strict"})

    assert result["status"] == "error"
    assert "strict" in result["summary"]
