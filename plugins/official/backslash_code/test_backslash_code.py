"""Tests unitaires pour le plugin backslash_code.

Ces tests valident :
- La table de référence publiée (A, N, Z, ...)
- L'aller-retour encode/decode (y compris les espaces)
- Les symboles personnalisés
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("backslash_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "BackslashCodePlugin")


def test_backslash_reference_table() -> None:
    """Quelques lettres issues de la table publiée (cachesleuth / drabkikker)."""
    BackslashCodePlugin = _load_plugin_class()
    plugin = BackslashCodePlugin()

    cases = {
        "A": "|||",
        "N": "///",
        "P": "/\\|",
        "S": "\\||",
        "Y": "\\\\|",
        "Z": "\\\\/",
    }
    for letter, code in cases.items():
        result: Dict[str, Any] = plugin.execute({"text": letter, "mode": "encode"})
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == code, letter


def test_backslash_encode_decode_roundtrip() -> None:
    BackslashCodePlugin = _load_plugin_class()
    plugin = BackslashCodePlugin()

    encoded = plugin.execute({"text": "HELLO WORLD", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    # Uniquement les trois symboles attendus.
    assert set(cipher) <= set("|/\\")

    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HELLO WORLD"


def test_backslash_custom_symbols() -> None:
    BackslashCodePlugin = _load_plugin_class()
    plugin = BackslashCodePlugin()

    encoded = plugin.execute({"text": "GEO", "mode": "encode", "symbols": "abc"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    assert set(cipher) <= set("abc")

    decoded = plugin.execute({"text": cipher, "mode": "decode", "symbols": "abc"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GEO"


def test_backslash_invalid_symbols() -> None:
    BackslashCodePlugin = _load_plugin_class()
    plugin = BackslashCodePlugin()

    result = plugin.execute({"text": "ABC", "mode": "encode", "symbols": "aa"})
    assert result["status"] == "error"


def test_backslash_empty_text() -> None:
    BackslashCodePlugin = _load_plugin_class()
    plugin = BackslashCodePlugin()

    result = plugin.execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"


def test_backslash_decode_no_symbols() -> None:
    BackslashCodePlugin = _load_plugin_class()
    plugin = BackslashCodePlugin()

    result = plugin.execute({"text": "hello", "mode": "decode"})
    assert result["status"] == "error"
