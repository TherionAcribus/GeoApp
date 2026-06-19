from __future__ import annotations
import importlib.util, sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("nak_nak_code_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "NakNakCodePlugin")


def test_encode_zero():
    P = _load()
    r = P().execute({"text": "0", "mode": "encode"})
    assert r["status"] == "success"
    # "0" is ASCII 48 = 0x30 → "3"="Nanananak", "0"="Nak"
    assert r["results"][0]["text_output"] == "Nanananak Nak"


def test_encode_hello():  # H=4=Nak?, E=e=nak., L=7=Naknaknak, L=7=Naknaknak, O=0=Nak
    P = _load()
    r = P().execute({"text": "0123", "mode": "encode"})
    assert r["status"] == "success"
    assert "Nak" in r["results"][0]["text_output"]


def test_decode_smooth_single_token():
    P = _load()
    # "Nak? Nanak" = hex nibbles "4"+"1" = 0x41 = 'A'
    r = P().execute({"text": "Nak? Nanak", "mode": "decode", "strict": "smooth"})
    assert r["status"] == "success"
    assert r["results"][0]["text_output"] == "A"


def test_decode_strict_valid():
    P = _load()
    r = P().execute({"text": "Nak Nanak", "mode": "decode", "strict": "strict"})
    assert r["status"] == "success"


def test_decode_strict_invalid():
    P = _load()
    r = P().execute({"text": "hello world", "mode": "decode", "strict": "strict"})
    assert r["status"] == "error"


def test_decode_embedded():
    P = _load()
    # embedded mode detects NakNak fragments in surrounding text
    r = P().execute({"text": "debut Nak fin", "mode": "decode", "embedded": True})
    assert r["status"] == "success"
    assert r["results"][0]["metadata"]["fragments_found"] >= 1


def test_check_code_smooth():
    P = _load()
    p = P()
    result = p.check_code("Nak Nanak Nananak", strict=False)
    assert result["is_match"] is True
    assert len(result["fragments"]) >= 1


def test_check_code_strict_no_repeat_position_bug():
    # Vérifie que le bug text.find() est corrigé : mots identiques répétés doivent
    # avoir des positions correctes et différentes.
    P = _load()
    p = P()
    result = p.check_code("Nak Nak", strict=True)
    assert result["is_match"] is True
    frags = result["fragments"]
    assert len(frags) == 2
    assert frags[0]["start"] != frags[1]["start"]


def test_empty_text_returns_error():
    P = _load()
    r = P().execute({"text": "", "mode": "decode"})
    assert r["status"] == "error"
