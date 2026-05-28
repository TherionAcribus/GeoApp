from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("geocache_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "GeocacheCodePlugin")


def test_alphabet_is_the_modern_gc_base31_alphabet() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    assert plugin.ALPHABET == "0123456789ABCDEFGHJKMNPQRTVWXYZ"
    assert len(plugin.ALPHABET) == 31
    assert not set("ILOSU").intersection(plugin.ALPHABET)


def test_encode_auto_uses_legacy_hex_until_gcffff() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    assert plugin.execute({"text": "0", "mode": "encode"})["results"][0]["text_output"] == "GC0"
    assert plugin.execute({"text": "30", "mode": "encode"})["results"][0]["text_output"] == "GC1E"
    assert plugin.execute({"text": "31", "mode": "encode"})["results"][0]["text_output"] == "GC1F"
    assert plugin.execute({"text": "2748", "mode": "encode"})["results"][0]["text_output"] == "GCABC"
    assert plugin.execute({"text": "65535", "mode": "encode"})["results"][0]["text_output"] == "GCFFFF"
    assert plugin.execute({"text": "65536", "mode": "encode"})["results"][0]["text_output"] == "GCG000"


def test_decode_legacy_hex_example() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "GCABC", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "2748"
    assert result["results"][0]["metadata"]["scheme"] == "legacy_hex"


def test_decode_base31_transition() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "GCG000", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "65536"
    assert result["results"][0]["metadata"]["scheme"] == "gc_base31"


def test_roundtrip_known_gc_code() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    decoded: Dict[str, Any] = plugin.execute({"text": "GCA72DG", "mode": "decode"})
    encoded: Dict[str, Any] = plugin.execute({"text": decoded["results"][0]["text_output"], "mode": "encode"})

    assert decoded["status"] == "ok"
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "GCA72DG"


def test_decode_raw_base31_without_prefix() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "A72DG", "mode": "decode", "output_format": "both", "scheme": "raw_base31"}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"].startswith("GCA72DG = ")
    assert result["results"][0]["metadata"]["gc_code"] == "GCA72DG"
    assert result["results"][0]["metadata"]["scheme"] == "raw_base31"


def test_raw_base31_keeps_pure_base31_behavior_when_requested() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    decoded: Dict[str, Any] = plugin.execute({"text": "GCABC", "mode": "decode", "scheme": "raw_base31"})
    encoded: Dict[str, Any] = plugin.execute({"text": "31", "mode": "encode", "scheme": "raw_base31"})

    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "9963"
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "GC10"


def test_decode_rejects_invalid_gc_alphabet_character() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "GCI", "mode": "decode"})

    assert result["status"] == "error"
    assert "invalide" in result["summary"]


def test_embedded_decode_extracts_multiple_gc_codes() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    result: Dict[str, Any] = plugin.execute(
        {"text": "Voir GCA72DG puis GC10.", "mode": "decode", "embedded": True, "output_format": "both"}
    )

    assert result["status"] == "ok"
    assert len(result["results"]) == 2
    assert result["results"][0]["metadata"]["gc_code"] == "GCA72DG"
    assert result["results"][1]["text_output"] == "GC10 = 16"


def test_detect_gc_code_like_text() -> None:
    GeocacheCodePlugin = _load_plugin_class()
    plugin = GeocacheCodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Mystery: GCA72DG", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True
