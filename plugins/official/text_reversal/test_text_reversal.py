from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_reverse_single_word_example() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "tnennerp", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "prennent"


def test_reverse_each_word_keeps_word_order() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ruojnoB ednom", "mode": "decode", "reversal_scope": "words"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Bonjour monde"


def test_full_reverse_reverses_everything() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "abc def", "mode": "decode", "reversal_scope": "full"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "fed cba"


def test_words_scope_preserves_punctuation_positions() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ruojnoB, ednom!", "mode": "decode", "reversal_scope": "words"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Bonjour, monde!"


def test_words_with_punctuation_can_reverse_whole_tokens() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    kept: Dict[str, Any] = plugin.execute(
        {"text": "!ruojnoB", "mode": "decode", "reversal_scope": "words_with_punctuation", "preserve_punctuation": True}
    )
    raw: Dict[str, Any] = plugin.execute(
        {"text": "!ruojnoB", "mode": "decode", "reversal_scope": "words_with_punctuation", "preserve_punctuation": False}
    )

    assert kept["results"][0]["text_output"] == "!Bonjour"
    assert raw["results"][0]["text_output"] == "Bonjour!"


def test_encode_is_symmetric() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "prennent", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["results"][0]["text_output"] == "tnennerp"
    assert decoded["results"][0]["text_output"] == "prennent"


def test_detect_reversed_word_candidate() -> None:
    TextReversalPlugin = load_plugin_class(__file__)
    plugin = TextReversalPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "tnennerp", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
