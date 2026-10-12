from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_dcode_name_example() -> None:
    MalespinPlugin = load_plugin_class(__file__)
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Malespín", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Pelasmon"


def test_transform_is_reciprocal() -> None:
    MalespinPlugin = load_plugin_class(__file__)
    plugin = MalespinPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "Buenos dias, amigo!", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "Buenos dias, amigo!"


def test_preserves_case_and_punctuation() -> None:
    MalespinPlugin = load_plugin_class(__file__)
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Ataque: 12?", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Ebequa: 12?"


def test_strict_rejects_unallowed_digits() -> None:
    MalespinPlugin = load_plugin_class(__file__)
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Ataque 12", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "strict" in result["summary"]


def test_detect_returns_weak_compatibility_signal() -> None:
    MalespinPlugin = load_plugin_class(__file__)
    plugin = MalespinPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Pelasmon", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
