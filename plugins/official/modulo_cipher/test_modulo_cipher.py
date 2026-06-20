from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("modulo_cipher_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "ModuloCipherPlugin")


ModuloCipherPlugin = _load()


def plugin():
    return ModuloCipherPlugin()


# ---------------------------------------------------------------------------
# Decode tests (deterministic)
# ---------------------------------------------------------------------------

def test_decode_1_with_modulo_26_is_A():
    # 1 mod 26 = 1 → A (A1Z26 mapping)
    result = plugin().execute({"text": "1", "mode": "decode", "modulo": 26})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


def test_decode_27_with_modulo_26_is_A():
    # 27 mod 26 = 1 → A
    result = plugin().execute({"text": "27", "mode": "decode", "modulo": 26})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


def test_decode_multiple_numbers():
    # 1,2,3 mod 26 → A, B, C
    result = plugin().execute({"text": "1,2,3", "mode": "decode", "modulo": 26})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ABC"


# ---------------------------------------------------------------------------
# Encode / roundtrip tests
# ---------------------------------------------------------------------------

def test_encode_then_decode_roundtrip():
    # Encode is non-deterministic (random multiplier) but decode must recover original
    p = plugin()
    encoded = p.execute({"text": "ABC", "mode": "encode", "modulo": 26})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode", "modulo": 26})["results"][0]["text_output"]
    assert decoded == "ABC"


def test_encode_returns_ok_status():
    result = plugin().execute({"text": "HELLO", "mode": "encode", "modulo": 26})
    assert result["status"] == "ok"
    # Output is a comma-separated list of numbers
    assert "," in result["results"][0]["text_output"]


# ---------------------------------------------------------------------------
# Default / no-modulo tests
# ---------------------------------------------------------------------------

def test_default_modulo_is_26():
    # Without specifying modulo, default is 26
    result = plugin().execute({"text": "1", "mode": "decode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "decode", "modulo": 26})
    assert result["status"] == "error"
