"""Tests unitaires pour le plugin decabit_code.

Ces tests valident :
- La table de référence publiée (kryptografie.de / cachesleuth)
- L'aller-retour encode/decode
- La sortie numérique
- Les symboles personnalisés (y compris l'inversion + / -)
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("decabit_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "DecabitCodePlugin")


def test_decabit_reference_table() -> None:
    """Valeurs issues de la table publiée (ASCII -> trame Decabit)."""
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    # 'A' = 65, 'B' = 66, '0'..'3' via valeurs numériques 0-3.
    cases = {
        "A": "++-+++----",   # 65
        "B": "++++--+---",   # 66
        chr(0): "--+-+++-+-",
        chr(64): "++-+--+--+",
        chr(126): "++++++++++",
    }
    for char, frame in cases.items():
        result: Dict[str, Any] = plugin.execute({"text": char, "mode": "encode"})
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == frame, repr(char)


def test_decabit_encode_decode_roundtrip() -> None:
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    encoded = plugin.execute({"text": "N49 E002", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    assert set(cipher) <= set("+- ")

    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "N49 E002"


def test_decabit_decode_ignores_noise() -> None:
    """Le décodage ne lit que + et -, quel que soit l'habillage."""
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    # 'H' = 72 -> --+-+-+++- , 'I' = 73 -> +----++++-
    noisy = "--+-+-+++- | +----++++-"
    decoded = plugin.execute({"text": noisy, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HI"


def test_decabit_numbers_output() -> None:
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    encoded = plugin.execute({"text": "AB", "mode": "encode"})
    cipher = encoded["results"][0]["text_output"]
    decoded = plugin.execute({"text": cipher, "mode": "decode", "output": "numbers"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "65 66"


def test_decabit_custom_symbols_binary() -> None:
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    encoded = plugin.execute({"text": "GEO", "mode": "encode", "symbols": "10"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    assert set(cipher) <= set("10 ")

    decoded = plugin.execute({"text": cipher, "mode": "decode", "symbols": "10"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GEO"


def test_decabit_custom_symbols_swap() -> None:
    """Symboles « -+ » : + et - sont inversés (cas piège du remplacement)."""
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    encoded = plugin.execute({"text": "OK", "mode": "encode", "symbols": "-+"})
    cipher = encoded["results"][0]["text_output"]
    decoded = plugin.execute({"text": cipher, "mode": "decode", "symbols": "-+"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "OK"


def test_decabit_invalid_symbols() -> None:
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    result = plugin.execute({"text": "ABC", "mode": "encode", "symbols": "++"})
    assert result["status"] == "error"


def test_decabit_empty_text() -> None:
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    result = plugin.execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"


def test_decabit_decode_no_symbols() -> None:
    DecabitCodePlugin = _load_plugin_class()
    plugin = DecabitCodePlugin()

    result = plugin.execute({"text": "hello world", "mode": "decode"})
    assert result["status"] == "error"
