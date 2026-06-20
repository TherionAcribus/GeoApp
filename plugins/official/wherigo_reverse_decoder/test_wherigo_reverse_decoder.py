from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("wherigo_reverse_decoder_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "WherigoReverseDecoderPlugin")


WherigoReverseDecoderPlugin = _load()


def plugin():
    return WherigoReverseDecoderPlugin()


# ---------------------------------------------------------------------------
# Decode tests
# ---------------------------------------------------------------------------

def test_decode_three_valid_codes_returns_ok():
    result = plugin().execute({"text": "123456 789012 345678", "mode": "decode"})
    assert result["status"] == "ok"


def test_decode_produces_coordinate_string():
    result = plugin().execute({"text": "123456 789012 345678", "mode": "decode"})
    assert result["status"] == "ok"
    output = result["results"][0]["text_output"]
    # WGS84 format: "N/S DD deg MM.mmm E/W DDD deg MM.mmm"
    assert "deg" in output


def test_decode_three_codes_result_matches_known_output():
    # Characterization: capture the exact output for "123456 789012 345678"
    result = plugin().execute({"text": "123456 789012 345678", "mode": "decode"})
    assert result["status"] == "ok"
    output = result["results"][0]["text_output"]
    assert output == "S 76 deg 20.203 W 185 deg 12.149"


# ---------------------------------------------------------------------------
# Detect (check_code) tests
# ---------------------------------------------------------------------------

def test_detect_valid_code_returns_high_confidence():
    result = plugin().execute({"text": "123456 789012 345678", "mode": "detect"})
    assert result["status"] == "ok"
    assert result["results"][0]["confidence"] == 1.0


def test_check_code_recognises_strict_format():
    p = plugin()
    check = p.check_code("123456 789012 345678", strict=True)
    assert check["is_match"] is True
    assert check["score"] == 1.0


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_decode_invalid_text_returns_error():
    result = plugin().execute({"text": "HELLO WORLD FOO", "mode": "decode"})
    assert result["status"] == "error"


def test_decode_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "decode"})
    assert result["status"] == "error"


def test_decode_fewer_than_three_codes_returns_error():
    result = plugin().execute({"text": "123456 789012", "mode": "decode"})
    assert result["status"] == "error"
