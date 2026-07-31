"""Tests unitaires pour le plugin keyboard_shift.

Ces tests valident :
- L'exemple de référence CacheSleuth (A décalé de 1 vers la droite en QWERTY -> S)
- Le passage d'une rangée à l'autre (wrap) quand le décalage dépasse la rangée
- Le comportement AZERTY (lettres différentes de QWERTY)
- Le roundtrip encode -> decode
- Les caractères hors séquence conservés tels quels (passthrough)
- Le mode brute-force (toutes les positions, QWERTY et AZERTY)
- Le format standardisé de sortie (status/results/plugin_info)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("keyboard_shift_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "KeyboardShiftPlugin")


def test_shift_letter_a_right_one_qwerty_matches_cachesleuth() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "A",
            "mode": "encode",
            "layout": "qwerty",
            "charset_scope": "letters",
            "direction": "right",
            "amount": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "S"


def test_shift_wraps_from_top_row_into_home_row() -> None:
    """P (dernière lettre de la rangée du haut) + 1 -> A (première lettre de la rangée suivante)."""
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "P",
            "mode": "encode",
            "layout": "qwerty",
            "charset_scope": "letters",
            "direction": "right",
            "amount": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


def test_azerty_letters_differ_from_qwerty() -> None:
    """Sur AZERTY, A est la 1ère lettre de la rangée du haut ; +1 donne Z (2e lettre)."""
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "A",
            "mode": "encode",
            "layout": "azerty",
            "charset_scope": "letters",
            "direction": "right",
            "amount": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Z"


def test_encode_decode_roundtrip_default_scope() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "HELLO123", "mode": "encode", "direction": "right", "amount": 5}
    )
    assert encoded["status"] == "ok"
    shifted_text = encoded["results"][0]["text_output"]
    assert shifted_text != "HELLO123"

    decoded: Dict[str, Any] = plugin.execute(
        {"text": shifted_text, "mode": "decode", "direction": "right", "amount": 5}
    )
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HELLO123"


def test_left_direction_is_inverse_of_right() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "GEOCACHING", "mode": "encode", "direction": "right", "amount": 7}
    )
    shifted_text = encoded["results"][0]["text_output"]

    decoded_via_left: Dict[str, Any] = plugin.execute(
        {"text": shifted_text, "mode": "encode", "direction": "left", "amount": 7}
    )
    assert decoded_via_left["results"][0]["text_output"] == "GEOCACHING"


def test_passthrough_characters_are_kept_unchanged() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "HI!",
            "mode": "encode",
            "layout": "qwerty",
            "charset_scope": "letters",
            "direction": "right",
            "amount": 1,
        }
    )

    assert result["status"] == "ok"
    item = result["results"][0]
    assert item["text_output"] == "JO!"
    assert item["metadata"]["shifted_characters"] == 2
    assert item["metadata"]["passthrough_characters"] == 1


def test_full_scope_wraps_from_numbers_row_into_letters_row() -> None:
    """En scope 'full', le dernier caractère de la ligne des chiffres (=) + 1 -> Q (1ère lettre)."""
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "=",
            "mode": "encode",
            "layout": "qwerty",
            "charset_scope": "full",
            "direction": "right",
            "amount": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Q"


def test_bruteforce_decode_tries_both_layouts() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "GEOCACHING", "mode": "encode", "layout": "qwerty", "direction": "right", "amount": 3}
    )
    assert encoded["status"] == "ok"
    shifted_text = encoded["results"][0]["text_output"]

    result: Dict[str, Any] = plugin.execute({"text": shifted_text, "mode": "decode", "bruteforce": True})

    assert result["status"] == "ok"
    assert len(result["results"]) > 1
    layouts_seen = {r["parameters"]["layout"] for r in result["results"]}
    assert layouts_seen == {"qwerty", "azerty"}
    # Le décalage de 3 utilisé pour chiffrer doit être retrouvé par le bruteforce.
    outputs = {r["text_output"] for r in result["results"]}
    assert "GEOCACHING" in outputs


def test_no_matching_character_returns_error() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "!!!", "mode": "encode", "charset_scope": "letters"}
    )

    assert result["status"] == "error"
    assert result["results"] == []


def test_output_format_matches_standard_contract() -> None:
    KeyboardShiftPlugin = _load_plugin_class()
    plugin = KeyboardShiftPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "GO", "mode": "encode"})

    assert result["status"] == "ok"
    assert "summary" in result
    assert "results" in result
    assert "plugin_info" in result
    plugin_info = result["plugin_info"]
    assert plugin_info["name"] == "keyboard_shift"
    assert plugin_info["version"] == "1.0.0"
    assert "execution_time_ms" in plugin_info
