from __future__ import annotations
from plugins.testing import load_plugin_class

def test_encode_a():
    P = load_plugin_class(__file__)
    r = P().execute({"text": "A", "mode": "encode"})
    assert r["status"] == "success"
    # A est en ligne 1, col 1 -> "X X" en format taps
    assert "X" in r["results"][0]["text_output"]

def test_encode_roundtrip():
    P = load_plugin_class(__file__)
    p = P()
    enc = p.execute({"text": "HELLO", "mode": "encode"})
    assert enc["status"] == "success"
    dec = p.execute({"text": enc["results"][0]["text_output"], "mode": "decode"})
    assert dec["status"] == "success"
    # H,E,L,L,O (K=C, donc HELLO->HELLO)
    # decode_fragments padde le résultat à la longueur du fragment, d'où le strip()
    assert dec["results"][0]["text_output"].strip() == "HELLO"

def test_encode_k_maps_to_c():
    # K est fusionné avec C dans la grille tap code
    P = load_plugin_class(__file__)
    p = P()
    enc_k = p.execute({"text": "K", "mode": "encode"})
    enc_c = p.execute({"text": "C", "mode": "encode"})
    assert enc_k["results"][0]["text_output"] == enc_c["results"][0]["text_output"]

def test_decode_smooth():
    P = load_plugin_class(__file__)
    r = P().execute({"text": "X X", "mode": "decode"})
    assert r["status"] == "success"

def test_decode_strict_valid():
    P = load_plugin_class(__file__)
    p = P()
    enc = p.execute({"text": "AB", "mode": "encode"})
    enc_text = enc["results"][0]["text_output"]
    r = P().execute({"text": enc_text, "mode": "decode", "strict": "strict"})
    assert r["status"] == "success"

def test_check_code_smooth():
    P = load_plugin_class(__file__)
    p = P()
    result = p.check_code("X X XX X", strict=False)
    assert result["is_match"] is True

def test_empty_text_returns_error():
    P = load_plugin_class(__file__)
    r = P().execute({"text": "", "mode": "decode"})
    assert r["status"] == "error"
