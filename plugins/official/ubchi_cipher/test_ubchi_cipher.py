from __future__ import annotations
from plugins.testing import load_plugin_class



UbchiCipherPlugin = load_plugin_class(__file__)


def plugin():
    return UbchiCipherPlugin()


# ---------------------------------------------------------------------------
# Encode tests
# ---------------------------------------------------------------------------

def test_encode_with_keyword():
    # ubchi_cipher uses a random padding letter — only verify status and shape
    result = plugin().execute({"text": "HELLO", "mode": "encode", "keyword": "KEY", "null_letters": 0})
    assert result["status"] == "success"
    output = result["results"][0]["text_output"]
    # HELLO (5 letters) encoded with KEY (3 cols): ceil(5/3)*3 = 6 chars
    assert len(output) == len("HELLO") + 1
    assert output.isalpha()


# ---------------------------------------------------------------------------
# Decode / roundtrip tests
# ---------------------------------------------------------------------------

def test_decode_with_keyword():
    result = plugin().execute({"text": "OLELHP", "mode": "decode", "keyword": "KEY", "null_letters": 0})
    assert result["status"] == "success"
    assert result["results"][0]["text_output"] == "HELLO"


def test_encode_decode_roundtrip():
    p = plugin()
    encoded = p.execute(
        {"text": "GEOCACHING", "mode": "encode", "keyword": "SECRET", "null_letters": 0}
    )["results"][0]["text_output"]
    decoded = p.execute(
        {"text": encoded, "mode": "decode", "keyword": "SECRET", "null_letters": 0}
    )["results"][0]["text_output"]
    assert decoded == "GEOCACHING"


# ---------------------------------------------------------------------------
# Bruteforce tests
# ---------------------------------------------------------------------------

def test_bruteforce_returns_results():
    result = plugin().execute({"text": "OLELHP", "mode": "bruteforce", "null_letters": 0})
    assert result["status"] == "success"
    assert result["summary"]["total_results"] > 0


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------

def test_empty_text_returns_error():
    result = plugin().execute({"text": "", "mode": "encode", "keyword": "KEY"})
    assert result["status"] == "error"
