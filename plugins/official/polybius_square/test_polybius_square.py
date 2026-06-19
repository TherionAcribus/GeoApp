from __future__ import annotations
import importlib.util, sys
from pathlib import Path

def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("polybius_square_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "PolybiusSquarePlugin")

def test_encode_a():
    P = _load()
    r = P().execute({"text": "A", "mode": "encode"})
    assert r["status"] == "success"
    # A est en ligne 1, col 1 -> "11"
    assert "11" in r["results"][0]["text_output"]

def test_encode_roundtrip():
    P = _load()
    p = P()
    enc = p.execute({"text": "HELLO", "mode": "encode"})
    assert enc["status"] == "success"
    dec = p.execute({"text": enc["results"][0]["text_output"], "mode": "decode"})
    assert dec["status"] == "success"
    # I=J merge: HELLO -> HELLO
    assert "HELLO" in dec["results"][0]["text_output"]

def test_encode_j_maps_to_i():
    P = _load()
    p = P()
    enc_j = p.execute({"text": "J", "mode": "encode"})
    enc_i = p.execute({"text": "I", "mode": "encode"})
    assert enc_j["results"][0]["text_output"] == enc_i["results"][0]["text_output"]

def test_decode_smooth():
    P = _load()
    r = P().execute({"text": "11 23", "mode": "decode"})
    assert r["status"] == "success"

def test_check_code_smooth():
    P = _load()
    p = P()
    result = p.check_code("11 23 45", strict=False)
    assert result["is_match"] is True

def test_empty_text_returns_error():
    P = _load()
    r = P().execute({"text": "", "mode": "decode"})
    assert r["status"] == "error"

def test_6x6_grid():
    P = _load()
    r = P().execute({"text": "A1", "mode": "encode", "grid_size": "6x6"})
    assert r["status"] == "success"
