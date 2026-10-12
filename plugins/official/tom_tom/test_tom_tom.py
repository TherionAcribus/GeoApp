from __future__ import annotations
from plugins.testing import load_plugin_class


def test_encode_a():
    P = load_plugin_class(__file__)
    r = P().execute({"text": "A", "mode": "encode"})
    assert r["status"] == "success"
    # A -> "/"
    assert "/" in r["results"][0]["text_output"]


def test_encode_roundtrip():
    P = load_plugin_class(__file__)
    p = P()
    encoded = p.execute({"text": "HELLO", "mode": "encode"})
    assert encoded["status"] == "success"
    enc_text = encoded["results"][0]["text_output"]
    decoded = p.execute({"text": enc_text, "mode": "decode"})
    assert decoded["status"] == "success"
    assert decoded["results"][0]["text_output"] == "HELLO"


def test_decode_single_token():
    P = load_plugin_class(__file__)
    # "/" -> A
    r = P().execute({"text": "/", "mode": "decode"})
    assert r["status"] == "success"
    assert "A" in r["results"][0]["text_output"]


def test_decode_smooth_does_not_require_all_valid():
    P = load_plugin_class(__file__)
    r = P().execute({"text": "/ some words /\\", "mode": "decode", "strict": "smooth"})
    assert r["status"] == "success"


def test_decode_strict_valid():
    P = load_plugin_class(__file__)
    p = P()
    encoded = p.encode("AB")
    r = P().execute({"text": encoded, "mode": "decode", "strict": "strict"})
    assert r["status"] == "success"


def test_decode_strict_invalid():
    P = load_plugin_class(__file__)
    # In tom_tom, strict validation only applies in "detect" mode, not "decode"
    r = P().execute({"text": "hello world", "mode": "detect", "strict": "strict"})
    assert r["status"] == "error"


def test_empty_text_returns_error():
    P = load_plugin_class(__file__)
    r = P().execute({"text": "", "mode": "decode"})
    assert r["status"] == "error"


def test_check_code_smooth():
    P = load_plugin_class(__file__)
    p = P()
    result = p.check_code("/", strict=False)
    assert result["is_match"] is True
    assert len(result["fragments"]) >= 1
