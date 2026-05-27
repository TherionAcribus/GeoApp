from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("malespin_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "MalespinPlugin")


def test_dcode_name_example() -> None:
    MalespinPlugin = _load_plugin_class()
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Malespín", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Pelasmon"


def test_transform_is_reciprocal() -> None:
    MalespinPlugin = _load_plugin_class()
    plugin = MalespinPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "Buenos dias, amigo!", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "Buenos dias, amigo!"


def test_preserves_case_and_punctuation() -> None:
    MalespinPlugin = _load_plugin_class()
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Ataque: 12?", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Ebequa: 12?"


def test_strict_rejects_unallowed_digits() -> None:
    MalespinPlugin = _load_plugin_class()
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Ataque 12", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "strict" in result["summary"]


def test_detect_returns_weak_compatibility_signal() -> None:
    MalespinPlugin = _load_plugin_class()
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Pelasmon", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
