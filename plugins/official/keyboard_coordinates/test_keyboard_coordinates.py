"""Tests unitaires pour le plugin keyboard_coordinates.

Ces tests valident :
- Les exemples de référence publiés par CacheSleuth/dCode (A = 22 / 32 / 42)
- L'encodage AZERTY (A se trouve à la position de Q sur un clavier QWERTY)
- Le roundtrip encode -> decode en QWERTY et en AZERTY
- Le mode brute-force (2 dispositions x 3 départs de ligne)
- Le format standardisé de sortie (status/results/plugin_info)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("keyboard_coordinates_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "KeyboardCoordinatesPlugin")


def test_reference_examples_qwerty_letter_a() -> None:
    """A = 22 (letters), 32 (numbers), 42 (functions) - exemples CacheSleuth/dCode."""
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    for start_row, expected in (("letters", "22"), ("numbers", "32"), ("functions", "42")):
        result: Dict[str, Any] = plugin.execute(
            {"text": "A", "mode": "encode", "layout": "qwerty", "start_row": start_row}
        )
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == expected


def test_encode_hello_qwerty_letters() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "HELLO", "mode": "encode", "layout": "qwerty", "start_row": "letters"}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "27 14 210 210 110"


def test_encode_geocaching_qwerty_matches_cachesleuth() -> None:
    """Exemple vérifié sur l'outil CacheSleuth (A=22, QWERTY, départ 'letters')."""
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "GEOCACHING", "mode": "encode", "layout": "qwerty", "start_row": "letters"}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "26 14 110 34 22 34 27 19 37 26"


def test_azerty_letter_a_is_on_top_row() -> None:
    """Sur AZERTY, A occupe la position de Q sur QWERTY (ligne 1, colonne 2)."""
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "A", "mode": "encode", "layout": "azerty", "start_row": "letters"}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "12"


def test_encode_decode_roundtrip_qwerty() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "GEOCACHING", "mode": "encode", "layout": "qwerty", "start_row": "letters"}
    )
    assert encoded["status"] == "ok"
    coordinates = encoded["results"][0]["text_output"]

    decoded: Dict[str, Any] = plugin.execute(
        {
            "text": coordinates,
            "mode": "decode",
            "layout": "qwerty",
            "start_row": "letters",
            "enable_scoring": False,
        }
    )
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GEOCACHING"


def test_encode_decode_roundtrip_azerty_with_space() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "BOITE AUX LETTRES", "mode": "encode", "layout": "azerty", "start_row": "letters"}
    )
    assert encoded["status"] == "ok"
    coordinates = encoded["results"][0]["text_output"]
    assert "/" in coordinates.split()

    decoded: Dict[str, Any] = plugin.execute(
        {
            "text": coordinates,
            "mode": "decode",
            "layout": "azerty",
            "start_row": "letters",
            "enable_scoring": False,
        }
    )
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "BOITE AUX LETTRES"


def test_encode_with_numbers_row() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "42", "mode": "encode", "layout": "qwerty", "start_row": "numbers"}
    )

    assert result["status"] == "ok"
    # Ligne des chiffres = ligne 1 en mode "numbers", colonne 2 = "1", donc "4" -> col 5, "2" -> col 3.
    assert result["results"][0]["text_output"] == "15 13"


def test_unsupported_characters_are_reported_and_skipped() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "HI!", "mode": "encode", "layout": "qwerty", "start_row": "letters"}
    )

    assert result["status"] == "ok"
    item = result["results"][0]
    assert item["text_output"] == "27 19"
    assert item["metadata"]["unsupported_characters"] == ["!"]


def test_bruteforce_decode_tries_all_layout_and_start_row_combinations() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "22 23 24", "mode": "decode", "bruteforce": True, "enable_scoring": False}
    )

    assert result["status"] == "ok"
    assert len(result["results"]) > 1
    combos = {(r["parameters"]["layout"], r["parameters"]["start_row"]) for r in result["results"]}
    assert ("qwerty", "letters") in combos
    assert ("azerty", "letters") in combos


def test_decode_invalid_format_returns_error() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "not coordinates", "mode": "decode"})

    assert result["status"] == "error"
    assert result["results"] == []


def test_output_format_matches_standard_contract() -> None:
    KeyboardCoordinatesPlugin = _load_plugin_class()
    plugin = KeyboardCoordinatesPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "GO", "mode": "encode"})

    assert result["status"] == "ok"
    assert "summary" in result
    assert "results" in result
    assert "plugin_info" in result
    plugin_info = result["plugin_info"]
    assert plugin_info["name"] == "keyboard_coordinates"
    assert plugin_info["version"] == "1.0.0"
    assert "execution_time_ms" in plugin_info
