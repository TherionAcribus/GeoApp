"""Tests unitaires pour le plugin alpha_decoder.

Ces tests valident:
- Encodage simple (A=1...)
- Décodage simple (1=A...)
- Gestion du paramètre offset
"""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_alpha_decoder_encode_basic() -> None:
    AlphaDecoderPlugin = load_plugin_class(__file__)
    plugin = AlphaDecoderPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ABC", "mode": "encode", "offset": 0})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "1 2 3"


def test_alpha_decoder_decode_basic() -> None:
    AlphaDecoderPlugin = load_plugin_class(__file__)
    plugin = AlphaDecoderPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "1 2 3", "mode": "decode", "offset": 0})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A B C"


def test_alpha_decoder_offset() -> None:
    AlphaDecoderPlugin = load_plugin_class(__file__)
    plugin = AlphaDecoderPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "A", "mode": "encode", "offset": 1})
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "26"

    decoded: Dict[str, Any] = plugin.execute({"text": "26", "mode": "decode", "offset": 1})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "A"
