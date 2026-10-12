"""Tests unitaires pour le plugin consonants_vowels_rank."""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_roundtrip_both_variant() -> None:
    ConsonantsVowelsRankPlugin = load_plugin_class(__file__)
    plugin = ConsonantsVowelsRankPlugin()

    plaintext = "HELLO"
    encoded: Dict[str, Any] = plugin.execute({"text": plaintext, "mode": "encode", "variant": "both"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]

    decoded: Dict[str, Any] = plugin.execute({"text": cipher, "mode": "decode", "variant": "both"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == plaintext


def test_bruteforce_returns_three_results() -> None:
    ConsonantsVowelsRankPlugin = load_plugin_class(__file__)
    plugin = ConsonantsVowelsRankPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "C1V1", "mode": "bruteforce"})
    assert result["status"] == "ok"
    assert len(result["results"]) == 3
