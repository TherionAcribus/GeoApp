from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("vigenere_cipher_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "VigenereCipherPlugin")


VigenereCipherPlugin = _load()


def plugin():
    return VigenereCipherPlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_hello_with_key():
    result = plugin().execute({"text": "HELLO", "mode": "encode", "key": "KEY"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "RIJVS"


# ---------------------------------------------------------------------------
# Decode tests
# ---------------------------------------------------------------------------

def test_decode_with_key():
    result = plugin().execute({"text": "RIJVS", "mode": "decode", "key": "KEY"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "HELLO"


def test_encode_decode_roundtrip():
    p = plugin()
    encoded = p.execute({"text": "GEOCACHING", "mode": "encode", "key": "SECRET"})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode", "key": "SECRET"})["results"][0]["text_output"]
    assert decoded == "GEOCACHING"


# ---------------------------------------------------------------------------
# Bruteforce tests
# ---------------------------------------------------------------------------

def test_bruteforce_with_candidate_keys():
    result = plugin().execute(
        {"text": "RIJVS", "mode": "bruteforce", "candidate_keys": ["KEY", "ABC", "XYZ"]}
    )
    assert result["status"] == "success"
    assert result["summary"]["total_results"] == 3
    # The correct key should produce HELLO
    outputs = [r["text_output"] for r in result["results"]]
    assert "HELLO" in outputs


def test_bruteforce_no_candidate_keys_returns_error():
    result = plugin().execute({"text": "RIJVS", "mode": "bruteforce"})
    assert result["status"] == "error"


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode", "key": "KEY"})
    assert result["status"] == "error"
