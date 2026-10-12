from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_encode_simple() -> None:
    LetterValuePlugin = load_plugin_class(__file__)
    plugin = LetterValuePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "encode", "text": "ABC"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "1 2 3"


def test_decode_embedded_replaces_fragments() -> None:
    LetterValuePlugin = load_plugin_class(__file__)
    plugin = LetterValuePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "N 48° 51.400", "embedded": True})
    assert result["status"] == "ok"
    # N -> 14 (le reste du texte est conservé)
    assert "14" in result["results"][0]["text_output"]


def test_detect_returns_ok() -> None:
    LetterValuePlugin = load_plugin_class(__file__)
    plugin = LetterValuePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "detect", "text": "HELLO"})
    assert result["status"] == "ok"
    assert "confidence" in result["results"][0]


def test_decode_bruteforce_returns_two_results() -> None:
    LetterValuePlugin = load_plugin_class(__file__)
    plugin = LetterValuePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "ABC", "bruteforce": True})
    assert result["status"] == "ok"
    assert len(result["results"]) == 2


def test_decode_numeric_sequence_from_encode_output() -> None:
    LetterValuePlugin = load_plugin_class(__file__)
    plugin = LetterValuePlugin()

    # 'CAT' -> 3 1 20 => '3 1 20' (avec séparateurs)
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": "CAT"})
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "3 1 20"

    decoded_spaced: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "3 1 20"})
    assert decoded_spaced["status"] == "ok"
    assert decoded_spaced["results"][0]["text_output"] == "CAT"

    decoded_concat: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "3120"})
    assert decoded_concat["status"] == "ok"
    assert decoded_concat["results"][0]["text_output"] == "CAT"
