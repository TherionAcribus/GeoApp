from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_encode_decode_numbers_roundtrip() -> None:
    HoudiniCodePlugin = load_plugin_class(__file__)
    plugin = HoudiniCodePlugin()

    plaintext = "1230"
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": plaintext})
    assert encoded["status"] == "ok"

    cipher = encoded["results"][0]["text_output"]
    decoded: Dict[str, Any] = plugin.execute({"mode": "decode", "text": cipher, "output_format": "numbers"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == plaintext


def test_encode_decode_letters_roundtrip() -> None:
    HoudiniCodePlugin = load_plugin_class(__file__)
    plugin = HoudiniCodePlugin()

    plaintext = "ABJ"
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": plaintext})
    assert encoded["status"] == "ok"

    cipher = encoded["results"][0]["text_output"]
    decoded: Dict[str, Any] = plugin.execute({"mode": "decode", "text": cipher, "output_format": "letters"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == plaintext


def test_decode_bruteforce_returns_two_results() -> None:
    HoudiniCodePlugin = load_plugin_class(__file__)
    plugin = HoudiniCodePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "Pray Answer", "bruteforce": True})
    assert result["status"] == "ok"
    assert len(result["results"]) == 2


def test_decode_strict_unknown_word_errors() -> None:
    HoudiniCodePlugin = load_plugin_class(__file__)
    plugin = HoudiniCodePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "UnknownWord", "strict": "strict"})
    assert result["status"] == "error"
