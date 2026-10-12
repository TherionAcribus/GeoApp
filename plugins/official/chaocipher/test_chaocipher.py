from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_published_reference_example() -> None:
    ChaocipherPlugin = load_plugin_class(__file__)
    plugin = ChaocipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "WELLDONEISBETTERTHANWELLSAID",
            "mode": "encode",
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "OAHQHCNYNXTSZJRRHJBYHQKSOUJY"


def test_reference_example_decodes() -> None:
    ChaocipherPlugin = load_plugin_class(__file__)
    plugin = ChaocipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "OAHQHCNYNXTSZJRRHJBYHQKSOUJY",
            "mode": "decode",
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "WELLDONEISBETTERTHANWELLSAID"


def test_roundtrip_with_punctuation_no_advance_on_nonletters() -> None:
    ChaocipherPlugin = load_plugin_class(__file__)
    plugin = ChaocipherPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "Hello, World!", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "Hello, World!"


def test_keyed_alphabets_roundtrip() -> None:
    ChaocipherPlugin = load_plugin_class(__file__)
    plugin = ChaocipherPlugin()

    inputs = {
        "text": "GEOCACHING",
        "mode": "encode",
        "left_alphabet": "",
        "right_alphabet": "",
        "left_key": "LEFT",
        "right_key": "RIGHT",
    }
    encoded: Dict[str, Any] = plugin.execute(inputs)
    decoded: Dict[str, Any] = plugin.execute(
        {
            **inputs,
            "text": encoded["results"][0]["text_output"],
            "mode": "decode",
        }
    )

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GEOCACHING"


def test_invalid_alphabet_is_rejected() -> None:
    ChaocipherPlugin = load_plugin_class(__file__)
    plugin = ChaocipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "HELLO",
            "mode": "encode",
            "left_alphabet": "ABC",
        }
    )

    assert result["status"] == "error"
    assert "alphabet gauche" in result["summary"]


def test_detect_letter_input() -> None:
    ChaocipherPlugin = load_plugin_class(__file__)
    plugin = ChaocipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "OAHQHCNYNXTSZJRRHJBYHQKSOUJY", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
