"""Tests unitaires pour le plugin chemical_elements."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("chemical_elements_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "ChemicalElementsPlugin")


def test_encode_numbers_to_symbols() -> None:
    ChemicalElementsPlugin = _load_plugin_class()
    plugin = ChemicalElementsPlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "encode", "text": "1 2 3"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "H He Li"


def test_decode_symbols_to_numbers() -> None:
    ChemicalElementsPlugin = _load_plugin_class()
    plugin = ChemicalElementsPlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "H He Li", "strict": "strict", "embedded": False})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "1 2 3"


def test_detect_finds_symbols() -> None:
    ChemicalElementsPlugin = _load_plugin_class()
    plugin = ChemicalElementsPlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "detect", "text": "Au Ag Xx"})
    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["fragments_count"] == 2


def test_decode_handles_non_breaking_space() -> None:
    ChemicalElementsPlugin = _load_plugin_class()
    plugin = ChemicalElementsPlugin()

    text = "West:\u00a0 Rf Te"
    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": text, "strict": "smooth", "embedded": True})
    assert result["status"] == "ok"
    assert "104" in result["results"][0]["text_output"]


def _frags(result):
    return [(f["value"], f["start"], f["end"]) for f in result["fragments"]]


def test_check_code_smooth_per_word() -> None:
    plugin = _load_plugin_class()()
    r = plugin.check_code("He Na", strict=False, allowed_chars=None, embedded=False)
    assert _frags(r) == [("He", 0, 2), ("Na", 3, 5)]


def test_check_code_strict_all_valid() -> None:
    plugin = _load_plugin_class()()
    r = plugin.check_code("He Na", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True and _frags(r) == [("He", 0, 2), ("Na", 3, 5)]


def test_check_code_strict_rejects_if_any_word_invalid() -> None:
    plugin = _load_plugin_class()()
    r = plugin.check_code("He Zz", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False and r["fragments"] == []


def test_check_code_strict_embedded_keeps_only_valid() -> None:
    plugin = _load_plugin_class()()
    r = plugin.check_code("go He then", strict=True, allowed_chars=None, embedded=True)
    assert _frags(r) == [("He", 3, 5)]
