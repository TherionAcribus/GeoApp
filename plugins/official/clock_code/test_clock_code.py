"""Tests unitaires pour le plugin clock_code.

Ces tests valident :
- La table de référence publiée (CacheSleuth)
- L'aller-retour encode/decode (y compris les espaces / mots)
- La tolérance du décodage aux séparateurs variés
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("clock_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "ClockCodePlugin")


def test_clock_reference_table() -> None:
    """Lettres issues de la table publiée (A=AM, B=1, ..., Y=24, Z=PM)."""
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    cases = {
        "A": "AM",
        "B": "1",
        "M": "12",
        "Y": "24",
        "Z": "PM",
        "THE": "19:7:4",
    }
    for letters, code in cases.items():
        result: Dict[str, Any] = plugin.execute({"text": letters, "mode": "encode"})
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == code, letters


def test_clock_encode_words() -> None:
    """Les espaces deviennent des jetons '00' entre les mots."""
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    encoded = plugin.execute({"text": "AB CD", "mode": "encode"})
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "AM:1:00:2:3"


def test_clock_encode_decode_roundtrip() -> None:
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    encoded = plugin.execute({"text": "HELLO WORLD", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]

    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HELLO WORLD"


def test_clock_decode_tolerant_separators() -> None:
    """Le décodage reconnaît les valeurs quel que soit le séparateur."""
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    # Mêmes valeurs pour 'HI', séparées par des espaces plutôt que ':'.
    decoded = plugin.execute({"text": "7 8", "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HI"

    # Casse mélangée pour AM/PM.
    decoded = plugin.execute({"text": "am:pm", "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "AZ"


def test_clock_custom_separator() -> None:
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    encoded = plugin.execute({"text": "THE", "mode": "encode", "separator": "-"})
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "19-7-4"

    decoded = plugin.execute({"text": "19-7-4", "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "THE"


def test_clock_decode_unknown_token() -> None:
    """Un nombre hors 1-24 est marqué '?' mais compté comme inconnu."""
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    decoded = plugin.execute({"text": "7:99:8", "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "H?I"
    assert decoded["results"][0]["metadata"]["unknown_tokens"] == 1


def test_clock_empty_text() -> None:
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    result = plugin.execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"


def test_clock_encode_no_letters() -> None:
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    result = plugin.execute({"text": "1234", "mode": "encode"})
    assert result["status"] == "error"


def test_clock_decode_no_tokens() -> None:
    ClockCodePlugin = _load_plugin_class()
    plugin = ClockCodePlugin()

    result = plugin.execute({"text": "-.-", "mode": "decode"})
    assert result["status"] == "error"
