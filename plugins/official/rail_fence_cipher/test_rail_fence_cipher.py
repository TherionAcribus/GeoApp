from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("rail_fence_cipher_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "RailFenceCipherPlugin")


RailFenceCipherPlugin = _load()


def plugin():
    return RailFenceCipherPlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_2_rails():
    result = plugin().execute({"text": "HELLO", "mode": "encode", "key": 2})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "HLOEL"


def test_encode_3_rails():
    result = plugin().execute({"text": "HELLOWORLD", "mode": "encode", "key": 3})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "HOLELWRDLO"


# ---------------------------------------------------------------------------
# Decode / roundtrip tests
# ---------------------------------------------------------------------------

def test_decode_2_rails():
    result = plugin().execute({"text": "HLOEL", "mode": "decode", "key": 2})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "HELLO"


def test_encode_decode_roundtrip_2_rails():
    p = plugin()
    encoded = p.execute({"text": "GEOCACHING", "mode": "encode", "key": 2})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode", "key": 2})["results"][0]["text_output"]
    assert decoded == "GEOCACHING"


def test_encode_decode_roundtrip_3_rails():
    p = plugin()
    encoded = p.execute({"text": "HELLOWORLD", "mode": "encode", "key": 3})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode", "key": 3})["results"][0]["text_output"]
    assert decoded == "HELLOWORLD"


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode", "key": 2})
    assert result["status"] == "error"
