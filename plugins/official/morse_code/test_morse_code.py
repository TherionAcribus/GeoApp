from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load():
    p = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("morse_code_main", p)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return getattr(m, "MorseCodePlugin")


MorseCodePlugin = _load()


def plugin():
    return MorseCodePlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_single_letter_a():
    result = plugin().execute({"text": "A", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == ".-"


def test_encode_hello():
    result = plugin().execute({"text": "HELLO", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == ".... . .-.. .-.. ---"


def test_encode_known_letters():
    p = plugin()
    assert p.execute({"text": "H", "mode": "encode"})["results"][0]["text_output"] == "...."
    assert p.execute({"text": "E", "mode": "encode"})["results"][0]["text_output"] == "."
    assert p.execute({"text": "L", "mode": "encode"})["results"][0]["text_output"] == ".-.."
    assert p.execute({"text": "O", "mode": "encode"})["results"][0]["text_output"] == "---"


# ---------------------------------------------------------------------------
# Decode tests
# ---------------------------------------------------------------------------

def test_decode_single_letter():
    result = plugin().execute({"text": ".-", "mode": "decode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "A"


def test_encode_decode_roundtrip():
    p = plugin()
    encoded = p.execute({"text": "HELLO", "mode": "encode"})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode"})["results"][0]["text_output"]
    assert decoded == "HELLO"


def test_decode_smooth_mode():
    # smooth mode (default) accepts morse text without strict validation
    result = plugin().execute({"text": ".... . .-.. .-.. ---", "mode": "decode", "strict": "smooth"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "HELLO"


def test_decode_strict_invalid_text():
    # Passing plain text in strict mode must return an error
    result = plugin().execute({"text": "HELLO", "mode": "decode", "strict": "strict"})
    assert result["status"] == "error"


# ---------------------------------------------------------------------------
# Detect tests
# ---------------------------------------------------------------------------

def test_detect_morse_sequence():
    result = plugin().execute({"text": ".... . .-.. .-.. ---", "mode": "detect"})
    assert result["status"] == "ok"
    assert result["results"][0]["confidence"] > 0


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode"})
    assert result["status"] == "error"
