from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("shadok_numbers_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "ShadokNumbersPlugin")


ShadokNumbersPlugin = _load()


def plugin():
    return ShadokNumbersPlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_zero():
    # 0 in base-4 Shadok = GA
    result = plugin().execute({"text": "0", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "GA"


def test_encode_one():
    # 1 in base-4 Shadok = BU
    result = plugin().execute({"text": "1", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "BU"


def test_encode_four():
    # 4 = 1*4 + 0 in base-4 → digits "10" → BU GA
    result = plugin().execute({"text": "4", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "BUGA"


# ---------------------------------------------------------------------------
# Decode tests
# ---------------------------------------------------------------------------

def test_decode_ga_is_zero():
    result = plugin().execute({"text": "GA", "mode": "decode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "0"


def test_decode_bu_is_one():
    result = plugin().execute({"text": "BU", "mode": "decode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "1"


def test_encode_decode_roundtrip():
    p = plugin()
    for n in (0, 1, 7, 42, 255):
        encoded = p.execute({"text": str(n), "mode": "encode"})["results"][0]["text_output"]
        decoded = p.execute({"text": encoded, "mode": "decode"})["results"][0]["text_output"]
        assert decoded == str(n), f"Roundtrip failed for {n}: got {decoded}"


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_non_numeric_text_returns_error():
    result = plugin().execute({"text": "HELLO", "mode": "encode"})
    assert result["status"] == "error"


def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"
