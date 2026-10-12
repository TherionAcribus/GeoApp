"""Tests unitaires pour le plugin atbash."""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_atbash_encode_decode_roundtrip() -> None:
    AtbashPlugin = load_plugin_class(__file__)
    plugin = AtbashPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "HELLO WORLD", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    assert cipher == "SVOOL DLIOW"

    decoded: Dict[str, Any] = plugin.execute({"text": cipher, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "HELLO WORLD"


def test_atbash_strict_rejects_non_allowed_chars() -> None:
    AtbashPlugin = load_plugin_class(__file__)
    plugin = AtbashPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "SVOOL@DLIOW", "mode": "decode", "strict": "strict", "allowed_chars": " "})
    assert result["status"] == "error"


def test_atbash_detect_strict() -> None:
    AtbashPlugin = load_plugin_class(__file__)
    plugin = AtbashPlugin()

    ok: Dict[str, Any] = plugin.execute({"text": "SVOOL DLIOW", "mode": "detect", "strict": "strict", "allowed_chars": " "})
    assert ok["status"] == "ok"
    assert ok["results"][0]["metadata"]["is_match"] is True

    ko: Dict[str, Any] = plugin.execute({"text": "SVOOL@DLIOW", "mode": "detect", "strict": "strict", "allowed_chars": " "})
    assert ko["status"] == "ok"
    assert ko["results"][0]["metadata"]["is_match"] is False
