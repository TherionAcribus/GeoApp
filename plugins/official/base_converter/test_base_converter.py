"""Tests unitaires pour le plugin base_converter."""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_base_converter_hex_to_ascii() -> None:
    BaseConverterPlugin = load_plugin_class(__file__)
    plugin = BaseConverterPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "48656c6c6f", "mode": "decode", "source_base": "16", "target_base": "ascii"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"].startswith("Hello")


def test_base_converter_ascii_to_hex() -> None:
    BaseConverterPlugin = load_plugin_class(__file__)
    plugin = BaseConverterPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Hi", "mode": "encode", "source_base": "ascii", "target_base": "16"})
    assert result["status"] == "ok"
    out = result["results"][0]["text_output"]
    # 'H'=0x48, 'i'=0x69
    assert out.lower() == "48 69"


def test_base_converter_autodetect_returns_results() -> None:
    BaseConverterPlugin = load_plugin_class(__file__)
    plugin = BaseConverterPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "48656c6c6f", "mode": "autodetect", "embedded": False})
    assert result["status"] == "ok"
    assert len(result.get("results", [])) > 0
