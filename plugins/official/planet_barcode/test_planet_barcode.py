"""Tests unitaires pour le plugin planet_barcode.

Ces tests valident :
- L'encodage PLANET-11 (avec checksum et barres de trame automatiques)
- Le roundtrip encode -> decode (formats 11 et 13 chiffres)
- Le décodage depuis les trois représentations visuelles (binaire, |/., |/╷)
- La détection d'un checksum invalide
- Le mode brute-force
- Le format standardisé de sortie (status/results/plugin_info)
- La relation de complément bit à bit avec la table POSTNET
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class(module_name: str, folder: str):
    plugin_path = Path(__file__).resolve().parent.parent / folder / "main.py"
    spec = importlib.util.spec_from_file_location(module_name, plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _load_planet_plugin_class():
    module = _load_plugin_class("planet_barcode_main", "planet_barcode")
    return getattr(module, "PlanetBarcodePlugin")


def test_planet_encode_11_digits_adds_checksum_and_frame_bars() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "12345678901", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"]
    item = result["results"][0]
    # 11 chiffres + 1 checksum = 12 * 5 barres + 2 barres de trame = 62
    assert item["metadata"]["total_bars"] == 62
    assert item["metadata"]["has_checksum"] is True
    assert item["metadata"]["has_frame_bars"] is True
    assert item["metadata"]["checksum"] == "4"  # somme des chiffres = 46 -> (10 - 46%10) % 10 = 4


def test_planet_encode_decode_roundtrip_11_and_13_digits() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    for digits in ("12345678901", "1234567890123"):
        encoded: Dict[str, Any] = plugin.execute({"text": digits, "mode": "encode"})
        assert encoded["status"] == "ok"
        barcode = encoded["results"][0]["text_output"]

        decoded: Dict[str, Any] = plugin.execute({"text": barcode, "mode": "decode"})
        assert decoded["status"] == "ok"
        assert decoded["results"]
        assert decoded["results"][0]["text_output"] == digits
        assert decoded["results"][0]["metadata"]["checksum_valid"] is True


def test_planet_decode_supports_visual_formats() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "12345678901", "mode": "encode"})
    metadata = encoded["results"][0]["metadata"]

    for barcode in (metadata["binary_representation"], metadata["pipe_dot_format"], metadata["pipe_down_format"]):
        decoded: Dict[str, Any] = plugin.execute({"text": barcode, "mode": "decode"})
        assert decoded["status"] == "ok"
        assert decoded["results"][0]["text_output"] == "12345678901"


def test_planet_decode_flags_invalid_checksum() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "12345678901", "mode": "encode"})
    barcode = encoded["results"][0]["metadata"]["binary_representation"]
    # On force un mauvais checksum en remplaçant le dernier chiffre (avant la barre de trame finale)
    tampered = barcode[:-6] + "00111" + barcode[-1]  # "00111" = chiffre 0

    decoded: Dict[str, Any] = plugin.execute({"text": tampered, "mode": "decode"})
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["metadata"]["checksum_valid"] is False


def test_planet_bruteforce_decode_returns_sorted_results() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "12345678901", "mode": "encode"})
    barcode = encoded["results"][0]["text_output"]

    result: Dict[str, Any] = plugin.execute({"text": barcode, "mode": "decode", "bruteforce": True})
    assert result["status"] == "ok"
    assert isinstance(result["results"], list)
    assert result["results"]

    confidences = [r.get("confidence", 0) for r in result["results"]]
    assert confidences == sorted(confidences, reverse=True)
    assert any(r["text_output"] == "12345678901" for r in result["results"])


def test_planet_invalid_input_returns_error() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "", "mode": "decode"})
    assert result["status"] == "error"
    assert result["results"] == []
    assert result["plugin_info"]["name"] == "planet_barcode"


def test_planet_standard_output_format() -> None:
    PlanetBarcodePlugin = _load_planet_plugin_class()
    plugin = PlanetBarcodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "12345678901", "mode": "encode"})

    assert result["status"] == "ok"
    assert isinstance(result["summary"], str)
    assert "execution_time_ms" in result["plugin_info"]
    assert result["plugin_info"]["version"] == plugin.version


def test_planet_table_is_bitwise_complement_of_postnet() -> None:
    """La table PLANET est documentée comme le complément bit à bit de POSTNET."""
    postnet_module = _load_plugin_class("postnet_barcode_main_ref", "postnet_barcode")
    planet_module = _load_plugin_class("planet_barcode_main_ref", "planet_barcode")

    postnet_encoding = postnet_module.POSTNET_ENCODING
    planet_encoding = planet_module.PLANET_ENCODING

    for digit, postnet_pattern in postnet_encoding.items():
        complement = "".join("1" if bit == "0" else "0" for bit in postnet_pattern)
        assert planet_encoding[digit] == complement
