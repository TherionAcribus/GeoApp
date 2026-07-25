"""Tests unitaires pour le plugin baudot_code (ITA2 / Baudot-Murray).

Ces tests valident :
- Quelques valeurs de la table ITA2 publiée (A, E, T, Z...)
- L'aller-retour encode/decode, y compris les bascules lettres/chiffres
- L'ordre des bits configurable (MSB / LSB)
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
    spec = importlib.util.spec_from_file_location("baudot_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "BaudotCodePlugin")


def test_ita2_reference_letters() -> None:
    """Valeurs de la table ITA2 publiée (mode lettres, MSB en premier)."""
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    cases = {
        "A": "00011",
        "E": "00001",
        "T": "10000",
        "Z": "10001",
        "H": "10100",
    }
    for letter, code in cases.items():
        result: Dict[str, Any] = plugin.execute({"text": letter, "mode": "encode"})
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == code, letter


def test_encode_inserts_figs_shift() -> None:
    """Un chiffre doit déclencher la bascule FIGS (11011) puis le code T-slot."""
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    result = plugin.execute({"text": "5", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "11011 10000"


def test_encode_decode_roundtrip_letters() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    encoded = plugin.execute({"text": "HELLO WORLD", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    assert set(cipher) <= set("01 ")

    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HELLO WORLD"


def test_roundtrip_letters_and_figures() -> None:
    """Le passage lettres -> chiffres -> lettres doit se rejouer fidèlement."""
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    encoded = plugin.execute({"text": "GC 8 FINDS", "mode": "encode"})
    cipher = encoded["results"][0]["text_output"]
    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GC 8 FINDS"


def test_bit_order_lsb_first() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    # A = 00011 en MSB -> 11000 en LSB.
    encoded = plugin.execute(
        {"text": "A", "mode": "encode", "bit_order": "lsb_first"}
    )
    assert encoded["results"][0]["text_output"] == "11000"

    decoded = plugin.execute(
        {"text": "11000", "mode": "decode", "bit_order": "lsb_first"}
    )
    assert decoded["results"][0]["text_output"] == "A"


def test_custom_symbols_roundtrip() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    encoded = plugin.execute({"text": "GEO", "mode": "encode", "symbols": ".x"})
    cipher = encoded["results"][0]["text_output"]
    assert set(cipher) <= set(".x ")

    decoded = plugin.execute({"text": cipher, "mode": "decode", "symbols": ".x"})
    assert decoded["results"][0]["text_output"] == "GEO"


def test_decode_ignores_separators() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    # Même contenu, séparateurs différents / absents.
    for text in ("00011 10000", "00011-10000", "0001110000"):
        decoded = plugin.execute({"text": text, "mode": "decode"})
        assert decoded["status"] == "ok"
        assert decoded["results"][0]["text_output"] == "AT"


def test_ita1_reference_letters() -> None:
    """Valeurs de la table ITA1 Continentale (mode lettres, MSB en premier)."""
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    cases = {
        "A": "00001",
        "E": "00010",
        "I": "00110",
        "O": "00111",
        "P": "11111",
    }
    for letter, code in cases.items():
        result = plugin.execute(
            {"text": letter, "mode": "encode", "variant": "ita1"}
        )
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == code, letter


def test_ita1_figs_shift_and_digit() -> None:
    """En ITA1, un chiffre insère la bascule 01000 puis le code du chiffre."""
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    result = plugin.execute({"text": "5", "mode": "encode", "variant": "ita1"})
    assert result["status"] == "ok"
    # 01000 = FIGS (en mode lettres), 00111 = O-slot = « 5 ».
    assert result["results"][0]["text_output"] == "01000 00111"


def test_ita1_roundtrip_letters_and_figures() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    encoded = plugin.execute(
        {"text": "GEO 42 CACHE", "mode": "encode", "variant": "ita1"}
    )
    cipher = encoded["results"][0]["text_output"]
    decoded = plugin.execute(
        {"text": cipher, "mode": "decode", "variant": "ita1"}
    )
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GEO 42 CACHE"


def test_variants_differ() -> None:
    """La même lettre n'a pas le même code en ITA1 et en ITA2."""
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    ita2 = plugin.execute({"text": "A", "mode": "encode", "variant": "ita2"})
    ita1 = plugin.execute({"text": "A", "mode": "encode", "variant": "ita1"})
    assert ita2["results"][0]["text_output"] == "00011"
    assert ita1["results"][0]["text_output"] == "00001"


def test_unknown_variant() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    result = plugin.execute({"text": "ABC", "mode": "encode", "variant": "ita9"})
    assert result["status"] == "error"


def test_invalid_symbols() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    result = plugin.execute({"text": "ABC", "mode": "encode", "symbols": "00"})
    assert result["status"] == "error"


def test_empty_text() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    result = plugin.execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"


def test_decode_no_bits() -> None:
    BaudotCodePlugin = _load_plugin_class()
    plugin = BaudotCodePlugin()

    result = plugin.execute({"text": "hello", "mode": "decode"})
    assert result["status"] == "error"
