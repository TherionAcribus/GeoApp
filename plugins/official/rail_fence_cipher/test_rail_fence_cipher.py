from __future__ import annotations
from plugins.testing import load_plugin_class



RailFenceCipherPlugin = load_plugin_class(__file__)


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
