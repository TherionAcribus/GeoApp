"""Tests unitaires pour le plugin postnet_barcode.

Ces tests valident :
- L'encodage ZIP-5 (avec checksum et barres de trame automatiques)
- Le roundtrip encode -> decode
- Le décodage depuis les trois représentations visuelles (binaire, |/., |/╷)
- La détection d'un checksum invalide
- Le mode brute-force
- Le format standardisé de sortie (status/results/plugin_info)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("postnet_barcode_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "PostnetBarcodePlugin")


def test_postnet_encode_zip5_adds_checksum_and_frame_bars() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "12345", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"]
    item = result["results"][0]
    # 5 chiffres + 1 checksum = 6 * 5 barres + 2 barres de trame = 32
    assert item["metadata"]["total_bars"] == 32
    assert item["metadata"]["has_checksum"] is True
    assert item["metadata"]["has_frame_bars"] is True
    assert item["metadata"]["checksum"] == "5"  # somme des chiffres = 15 -> (10 - 15%10) % 10 = 5


def test_postnet_encode_decode_roundtrip() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "12345", "mode": "encode"})
    assert encoded["status"] == "ok"
    barcode = encoded["results"][0]["text_output"]

    decoded: Dict[str, Any] = plugin.execute({"text": barcode, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"]
    assert decoded["results"][0]["text_output"] == "12345"
    assert decoded["results"][0]["metadata"]["checksum_valid"] is True


def test_postnet_decode_supports_visual_formats() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "554236090", "mode": "encode"})
    metadata = encoded["results"][0]["metadata"]

    for barcode in (metadata["binary_representation"], metadata["pipe_dot_format"], metadata["pipe_down_format"]):
        decoded: Dict[str, Any] = plugin.execute({"text": barcode, "mode": "decode"})
        assert decoded["status"] == "ok"
        assert decoded["results"][0]["text_output"] == "55423-6090"
        assert decoded["results"][0]["metadata"]["zip_code_raw"] == "554236090"


def test_postnet_decode_flags_invalid_checksum() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "12345", "mode": "encode"})
    barcode = encoded["results"][0]["metadata"]["binary_representation"]
    # On force un mauvais checksum en remplaçant le dernier chiffre (avant la barre de trame finale)
    tampered = barcode[:-6] + "11000" + barcode[-1]

    decoded: Dict[str, Any] = plugin.execute({"text": tampered, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["metadata"]["checksum_valid"] is False


def test_postnet_bruteforce_decode_returns_sorted_results() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "12345", "mode": "encode"})
    barcode = encoded["results"][0]["text_output"]

    result: Dict[str, Any] = plugin.execute({"text": barcode, "mode": "decode", "bruteforce": True})
    assert result["status"] == "ok"
    assert isinstance(result["results"], list)
    assert result["results"]

    confidences = [r.get("confidence", 0) for r in result["results"]]
    assert confidences == sorted(confidences, reverse=True)
    assert any(r["text_output"] == "12345" for r in result["results"])


def test_postnet_invalid_input_returns_error() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "", "mode": "decode"})
    assert result["status"] == "error"
    assert result["results"] == []
    assert result["plugin_info"]["name"] == "postnet_barcode"


def test_postnet_standard_output_format() -> None:
    PostnetBarcodePlugin = _load_plugin_class()
    plugin = PostnetBarcodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "554236090", "mode": "encode"})

    assert result["status"] == "ok"
    assert isinstance(result["summary"], str)
    assert "execution_time_ms" in result["plugin_info"]
    assert result["plugin_info"]["version"] == plugin.version
