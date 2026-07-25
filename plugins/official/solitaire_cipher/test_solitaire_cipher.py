from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("solitaire_cipher_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "SolitaireCipherPlugin")


SolitaireCipherPlugin = _load()


def plugin():
    return SolitaireCipherPlugin()


# ---------------------------------------------------------------------------
# Vecteurs de test officiels (Bruce Schneier)
# ---------------------------------------------------------------------------

def test_unkeyed_keystream():
    # Jeu non clef : le flux commence par DWJXHYRFDG.
    result = plugin().execute({"text": "AAAAAAAAAA", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["keystream"] == "DWJXHYRFDG"


def test_unkeyed_encode():
    # AAAAAAAAAA -> EXKYIZSGEH (jeu non clef).
    result = plugin().execute({"text": "AAAAAAAAAA", "mode": "encode"})
    assert result["results"][0]["text_output"] == "EXKYIZSGEH"


def test_unkeyed_decode_roundtrip():
    result = plugin().execute({"text": "EXKYIZSGEH", "mode": "decode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "AAAAAAAAAA"


def test_keyed_encode_foo():
    # Cle "FOO", 15 x A -> ITHZUJIWGRFARMW.
    result = plugin().execute(
        {"text": "AAAAAAAAAAAAAAA", "mode": "encode", "key": "FOO"}
    )
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ITHZUJIWGRFARMW"


def test_keyed_roundtrip():
    p = plugin()
    encoded = p.execute(
        {"text": "GEOCACHINGISFUN", "mode": "encode", "key": "SECRET"}
    )["results"][0]["text_output"]
    decoded = p.execute(
        {"text": encoded, "mode": "decode", "key": "SECRET"}
    )["results"][0]["text_output"]
    assert decoded == "GEOCACHINGISFUN"


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

def test_group_output():
    result = plugin().execute({"text": "AAAAAAAAAA", "mode": "encode", "group": True})
    assert result["results"][0]["text_output"] == "EXKYI ZSGEH"


def test_ignores_non_letters():
    # Les caracteres non A-Z sont ignores : "hello world" == "helloworld".
    a = plugin().execute({"text": "hello, world!", "mode": "encode", "key": "KEY"})
    b = plugin().execute({"text": "helloworld", "mode": "encode", "key": "KEY"})
    assert a["results"][0]["text_output"] == b["results"][0]["text_output"]


# ---------------------------------------------------------------------------
# Cas d'erreur
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"


def test_no_letters_returns_error():
    result = plugin().execute({"text": "12345 !!!", "mode": "encode"})
    assert result["status"] == "error"


def test_unknown_mode_returns_error():
    result = plugin().execute({"text": "ABC", "mode": "explode"})
    assert result["status"] == "error"
