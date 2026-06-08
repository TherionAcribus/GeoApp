from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("alphabet_rank_added_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "AlphabetRankAddedPlugin")


def test_dcode_abc_example_encodes() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ABC", "mode": "encode", "separator": "comma"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "1,3,6"


def test_dcode_dcode_example_encodes() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "DCODE", "mode": "encode", "separator": "comma"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "4,7,22,26,31"


def test_dcode_dcode_example_decodes() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "4,7,22,26,31", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "DCODE"
    assert result["results"][0]["metadata"]["differences"] == [4, 3, 15, 4, 5]


def test_rank_base_zero_variant_roundtrip() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "ABC", "mode": "encode", "rank_base": 0})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode", "rank_base": 0})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "0 1 3"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "ABC"


def test_modulo_can_wrap_large_differences() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    without_modulo: Dict[str, Any] = plugin.execute({"text": "4 35", "mode": "decode"})
    with_modulo: Dict[str, Any] = plugin.execute({"text": "4 35", "mode": "decode", "use_modulo": True})

    assert without_modulo["status"] == "ok"
    assert without_modulo["results"][0]["text_output"] == "D?"
    assert with_modulo["status"] == "ok"
    assert with_modulo["results"][0]["text_output"] == "DE"


def test_strict_rejects_invalid_difference_without_modulo() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "4 35", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "Difference" in result["summary"]


def test_custom_alphabet_roundtrip() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    alphabet = "ABCDE"
    encoded: Dict[str, Any] = plugin.execute({"text": "BED", "mode": "encode", "alphabet": alphabet})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode", "alphabet": alphabet})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "2 7 11"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "BED"


def test_detect_cumulative_numbers() -> None:
    AlphabetRankAddedPlugin = _load_plugin_class()
    plugin = AlphabetRankAddedPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "4,7,22,26,31", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
