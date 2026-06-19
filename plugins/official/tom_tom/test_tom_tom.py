from __future__ import annotations
import importlib.util, sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("tom_tom_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "TomTomPlugin")


def test_encode_a():
    P = _load()
    r = P().execute({"text": "A", "mode": "encode"})
    assert r["status"] == "success"
    # A -> "/"
    assert "/" in r["results"][0]["text_output"]


def test_encode_roundtrip():
    P = _load()
    p = P()
    encoded = p.execute({"text": "HELLO", "mode": "encode"})
    assert encoded["status"] == "success"
    enc_text = encoded["results"][0]["text_output"]
    decoded = p.execute({"text": enc_text, "mode": "decode"})
    assert decoded["status"] == "success"
    assert decoded["results"][0]["text_output"] == "HELLO"


def test_decode_single_token():
    P = _load()
    # "/" -> A
    r = P().execute({"text": "/", "mode": "decode"})
    assert r["status"] == "success"
    assert "A" in r["results"][0]["text_output"]


def test_decode_smooth_does_not_require_all_valid():
    P = _load()
    r = P().execute({"text": "/ some words /\\", "mode": "decode", "strict": "smooth"})
    assert r["status"] == "success"


def test_decode_strict_valid():
    P = _load()
    p = P()
    encoded = p.encode("AB")
    r = P().execute({"text": encoded, "mode": "decode", "strict": "strict"})
    assert r["status"] == "success"


def test_decode_strict_invalid():
    P = _load()
    # In tom_tom, strict validation only applies in "detect" mode, not "decode"
    r = P().execute({"text": "hello world", "mode": "detect", "strict": "strict"})
    assert r["status"] == "error"


def test_empty_text_returns_error():
    P = _load()
    r = P().execute({"text": "", "mode": "decode"})
    assert r["status"] == "error"


def test_check_code_smooth():
    P = _load()
    p = P()
    result = p.check_code("/", strict=False)
    assert result["is_match"] is True
    assert len(result["fragments"]) >= 1
