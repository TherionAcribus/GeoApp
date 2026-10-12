"""Tests unitaires pour le plugin gronsfeld_cipher."""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_encode_decode_roundtrip() -> None:
    GronsfeldCipherPlugin = load_plugin_class(__file__)
    plugin = GronsfeldCipherPlugin()

    plaintext = "BONJOUR LE MONDE"
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": plaintext, "key": "1234"})
    assert encoded["status"] == "ok"

    cipher = encoded["results"][0]["text_output"]
    decoded: Dict[str, Any] = plugin.execute({"mode": "decode", "text": cipher, "key": "1234"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == plaintext


def test_key_is_cleaned_to_digits() -> None:
    GronsfeldCipherPlugin = load_plugin_class(__file__)
    plugin = GronsfeldCipherPlugin()

    # La clé doit ignorer les caractères non numériques
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": "ABC", "key": "1a2b3"})
    assert encoded["status"] == "ok"


def test_missing_key_errors() -> None:
    GronsfeldCipherPlugin = load_plugin_class(__file__)
    plugin = GronsfeldCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "encode", "text": "ABC", "key": ""})
    assert result["status"] == "error"
