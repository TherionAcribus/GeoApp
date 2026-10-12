"""Tests unitaires pour le plugin gold_bug."""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_encode_decode_roundtrip() -> None:
    GoldBugPlugin = load_plugin_class(__file__)
    plugin = GoldBugPlugin()

    plaintext = "GOLD BUG"
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": plaintext})
    assert encoded["status"] == "ok"

    cipher = encoded["results"][0]["text_output"]
    decoded: Dict[str, Any] = plugin.execute({"mode": "decode", "text": cipher})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == plaintext


def test_detect_symbols() -> None:
    GoldBugPlugin = load_plugin_class(__file__)
    plugin = GoldBugPlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "detect", "text": "5 2 - "})
    assert result["status"] == "ok"
    assert "detection_score" in result["results"][0]["metadata"]
