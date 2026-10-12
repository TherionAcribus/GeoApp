from __future__ import annotations
from plugins.testing import load_plugin_class



WolseleyCipherPlugin = load_plugin_class(__file__)


def plugin():
    return WolseleyCipherPlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_with_key():
    result = plugin().execute({"text": "HELLO", "mode": "encode", "key": "SECRET"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "MYIIF"


def test_encode_without_key_atbash():
    # Without key the cipher degrades to Atbash (reversed alphabet minus J)
    result = plugin().execute({"text": "HELLO", "mode": "encode"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "SVPPM"


# ---------------------------------------------------------------------------
# Decode / roundtrip tests
# ---------------------------------------------------------------------------

def test_decode_with_key():
    result = plugin().execute({"text": "MYIIF", "mode": "decode", "key": "SECRET"})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "HELLO"


def test_encode_decode_roundtrip():
    p = plugin()
    encoded = p.execute({"text": "GEOCACHING", "mode": "encode", "key": "CRYPTO"})["results"][0]["text_output"]
    decoded = p.execute({"text": encoded, "mode": "decode", "key": "CRYPTO"})["results"][0]["text_output"]
    assert decoded == "GEOCACHING"


def test_cipher_is_symmetric_with_same_key():
    # encode(encode(text)) == text since the substitution is its own inverse
    p = plugin()
    once = p.encode("HELLO", "SECRET")
    twice = p.encode(once, "SECRET")
    assert twice == "HELLO"


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode", "key": "SECRET"})
    assert result["status"] == "error"
