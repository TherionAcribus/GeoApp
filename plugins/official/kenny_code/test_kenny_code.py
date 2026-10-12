from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_encode_decode_roundtrip_simple() -> None:
    KennyCodePlugin = load_plugin_class(__file__)
    plugin = KennyCodePlugin()

    plaintext = "attack at dawn"
    encoded: Dict[str, Any] = plugin.execute({"mode": "encode", "text": plaintext})
    assert encoded["status"] == "ok"

    cipher = encoded["results"][0]["text_output"]
    decoded: Dict[str, Any] = plugin.execute({"mode": "decode", "text": cipher})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == plaintext


def test_detect_kenny_code() -> None:
    KennyCodePlugin = load_plugin_class(__file__)
    plugin = KennyCodePlugin()

    cipher = plugin.encode("abc")
    detected: Dict[str, Any] = plugin.execute({"mode": "detect", "text": cipher})
    assert detected["status"] == "ok"
    assert detected["results"][0]["metadata"]["is_match"] is True


def test_decode_strict_invalid_errors() -> None:
    KennyCodePlugin = load_plugin_class(__file__)
    plugin = KennyCodePlugin()

    result: Dict[str, Any] = plugin.execute({"mode": "decode", "text": "hello", "strict": "strict"})
    assert result["status"] == "error"


def _frags(result):
    return [(f["value"], f["start"], f["end"]) for f in result["fragments"]]


def test_check_code_smooth_whole_block() -> None:
    plugin = load_plugin_class(__file__)()
    r = plugin.check_code("mmmmmp", strict=False, allowed_chars=None, embedded=False)
    assert r["is_match"] is True and _frags(r) == [("mmmmmp", 0, 6)]


def test_check_code_strict_whole_with_space() -> None:
    plugin = load_plugin_class(__file__)()
    r = plugin.check_code("mmm mmp", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True and _frags(r) == [("mmm mmp", 0, 7)] and r["full_match"] is True


def test_check_code_strict_embedded_block_positions() -> None:
    plugin = load_plugin_class(__file__)()
    r = plugin.check_code("hi mmmmmp yo", strict=True, allowed_chars=None, embedded=True)
    assert _frags(r) == [("mmmmmp", 3, 9)]


def test_check_code_strict_lenient_partial_triplet() -> None:
    plugin = load_plugin_class(__file__)()
    r = plugin.check_code("mmmm", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True and _frags(r) == [("mmmm", 0, 4)]


def test_check_code_strict_rejects_foreign() -> None:
    plugin = load_plugin_class(__file__)()
    r = plugin.check_code("xyz", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False and r["fragments"] == []


def test_check_code_preserves_original_case() -> None:
    plugin = load_plugin_class(__file__)()
    r = plugin.check_code("MMM", strict=False, allowed_chars=None, embedded=False)
    assert _frags(r) == [("MMM", 0, 3)]
