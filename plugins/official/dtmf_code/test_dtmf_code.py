"""Tests unitaires pour le plugin dtmf_code.

Ces tests valident :
- La table de référence du clavier DTMF (touche -> couple de fréquences)
- L'aller-retour encode/decode
- Le décodage tolérant au bruit, à l'ordre des fréquences et aux écarts
- La gestion des couples inconnus et des erreurs
"""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_dtmf_encode_reference() -> None:
    """Couples de fréquences issus de la disposition standard du clavier."""
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    cases = {
        "1": "697+1209",
        "5": "770+1336",
        "9": "852+1477",
        "0": "941+1336",
        "*": "941+1209",
        "#": "941+1477",
        "A": "697+1633",
        "D": "941+1633",
    }
    for key, pair in cases.items():
        result: Dict[str, Any] = plugin.execute({"text": key, "mode": "encode"})
        assert result["status"] == "ok"
        assert result["results"][0]["text_output"] == pair, repr(key)


def test_dtmf_encode_decode_roundtrip() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    encoded = plugin.execute({"text": "1234567890", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]

    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "1234567890"


def test_dtmf_encode_lowercase_and_symbols() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    encoded = plugin.execute({"text": "a*#d", "mode": "encode"})
    cipher = encoded["results"][0]["text_output"]
    decoded = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["results"][0]["text_output"] == "A*#D"


def test_dtmf_decode_order_independent() -> None:
    """La fréquence haute peut précéder la basse : même touche décodée."""
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    # Touche 5 = 770 (basse) + 1336 (haute), présentées dans l'ordre inverse.
    decoded = plugin.execute({"text": "1336 770", "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "5"


def test_dtmf_decode_ignores_noise_and_separators() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    noisy = "697/1209 Hz ; 852,1477"
    decoded = plugin.execute({"text": noisy, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "19"


def test_dtmf_decode_tolerance() -> None:
    """Des fréquences légèrement décalées restent reconnues (tolérance)."""
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    # 700~697, 1210~1209 -> touche 1, avec la tolérance par défaut (20 Hz).
    decoded = plugin.execute({"text": "700 1210", "mode": "decode"})
    assert decoded["results"][0]["text_output"] == "1"

    # Écart trop grand -> couple inconnu.
    strict = plugin.execute({"text": "600 1209", "mode": "decode"})
    assert strict["results"][0]["text_output"] == "?"
    assert strict["results"][0]["metadata"]["unknown_pairs"] == 1


def test_dtmf_decode_unpaired_frequency() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    # Trois nombres : un couple décodé + une fréquence orpheline ignorée.
    decoded = plugin.execute({"text": "697 1209 852", "mode": "decode"})
    assert decoded["results"][0]["text_output"] == "1"
    assert decoded["results"][0]["metadata"]["unpaired_frequencies"] == 1


def test_dtmf_encode_no_valid_key() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    result = plugin.execute({"text": "hello", "mode": "encode"})
    assert result["status"] == "error"


def test_dtmf_decode_too_few_numbers() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    result = plugin.execute({"text": "697", "mode": "decode"})
    assert result["status"] == "error"


def test_dtmf_empty_text() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    assert plugin.execute({"text": "", "mode": "encode"})["status"] == "error"


def test_dtmf_unknown_mode() -> None:
    DtmfCodePlugin = load_plugin_class(__file__)
    plugin = DtmfCodePlugin()

    assert plugin.execute({"text": "1", "mode": "xyz"})["status"] == "error"
