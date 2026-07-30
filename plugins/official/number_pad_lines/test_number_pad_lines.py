from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("number_pad_lines_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "NumberPadLinesPlugin")


NumberPadLinesPlugin = _load()


def plugin():
    return NumberPadLinesPlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_single_letter_a():
    result = plugin().execute({"text": "A", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "7295"


def test_encode_geocache():
    result = plugin().execute({"text": "geocache", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == (
        "317965 3145479 71397 32489 7295 32489 174639 3145479"
    )


def test_encode_preserves_word_separator():
    result = plugin().execute({"text": "hi bob", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "174639 132879 / 71354597 71397 71354597"


def test_encode_digit():
    result = plugin().execute({"text": "7", "mode": "encode"})
    assert result["results"][0]["text_output"] == "137"


# ---------------------------------------------------------------------------
# Decode tests
# ---------------------------------------------------------------------------

def test_decode_single_letter():
    result = plugin().execute({"text": "7295", "mode": "decode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


def test_encode_decode_roundtrip():
    p = plugin()
    encoded = p.execute({"text": "GEOCACHE", "mode": "encode"})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode"})["results"][0]["text_output"]
    assert decoded == "GEOCACHE"


def test_decode_unknown_token_marked():
    result = plugin().execute({"text": "7295 999999", "mode": "decode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A?"


# ---------------------------------------------------------------------------
# Detect tests
# ---------------------------------------------------------------------------

def test_detect_valid_sequence():
    result = plugin().execute({"text": "7295 3145479 71397", "mode": "detect"})
    assert result["status"] == "ok"
    assert result["results"][0]["confidence"] == 1.0


def test_detect_plain_text_low_score():
    result = plugin().execute({"text": "hello world", "mode": "detect"})
    assert result["status"] == "ok"
    assert result["results"][0]["confidence"] < 0.5


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"


def test_unknown_mode_returns_error():
    result = plugin().execute({"text": "A", "mode": "bogus"})
    assert result["status"] == "error"
