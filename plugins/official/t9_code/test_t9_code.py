from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("t9_code_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "T9CodePlugin")


T9CodePlugin = _load()


def plugin():
    return T9CodePlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_single_letter_a():
    # A maps to key 2 on a T9 keypad
    result = plugin().execute({"text": "A", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "2"


def test_encode_two_letters_same_key():
    # A and B both map to key 2 → "AB" encodes to "22"
    result = plugin().execute({"text": "AB", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "22"


def test_encode_three_letters_same_key():
    # A, B, C all map to key 2 → "ABC" encodes to "222"
    result = plugin().execute({"text": "ABC", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "222"


def test_encode_letter_on_key_4():
    # G is the first letter on key 4
    result = plugin().execute({"text": "G", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "4"


# ---------------------------------------------------------------------------
# Decode tests
# ---------------------------------------------------------------------------

def test_decode_single_digit_returns_first_letter():
    # "2" → first combination is "A"
    result = plugin().execute({"text": "2", "mode": "decode"})
    assert result["status"] == "success"
    first_outputs = [r["text_output"] for r in result["results"]]
    assert "A" in first_outputs


def test_decode_returns_multiple_candidates():
    # "22" maps to AA/AB/AC/BA/BB/BC/CA/CB/CC
    result = plugin().execute({"text": "22", "mode": "decode"})
    assert result["status"] == "success"
    assert result["summary"]["total_results"] > 1


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"
