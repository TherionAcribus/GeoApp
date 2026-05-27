from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("vic_cipher_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "VicCipherPlugin")


def _wiki_inputs() -> Dict[str, Any]:
    return {
        "phrase": "Twas the night before Christmas",
        "date": "139195",
        "keygroup": "72401",
        "personal_number": 6,
    }


def test_wikipedia_key_generation_example() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    key_material = plugin.derive_key_material(**_wiki_inputs())

    assert key_material["line_c"] == "69592"
    assert key_material["line_e1"] == "8017942653"
    assert key_material["line_e2"] == "6013589427"
    assert key_material["line_f1"] == "6959254417"
    assert key_material["line_g"] == "4966196060"
    assert key_material["line_h"] == "3288628787"
    assert key_material["line_j"] == "3178429506"
    assert key_material["line_k"] == "5064805552"
    assert key_material["line_l"] == "5602850077"
    assert key_material["line_m"] == "1620350748"
    assert key_material["line_n"] == "7823857125"
    assert key_material["line_p"] == "5051328370"
    assert key_material["line_q"] == "0668005552551"
    assert key_material["line_r"] == "758838"
    assert key_material["line_s"] == "5961328470"


def test_simple_default_grid_matches_dcode_example() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()
    checkerboard = plugin.build_simple_checkerboard(spare_positions="26")

    encoded, metadata = plugin.simple_encode_checkerboard("VICTOR", checkerboard)

    assert encoded == "86167202522"
    assert metadata["unsupported_count"] == 0


def test_simple_numeric_key_matches_dcode_example() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "VICTOR",
            "mode": "encode",
            "numeric_key": "0248",
            "group_output": False
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "88547440546"


def test_simple_decode_numeric_key_matches_dcode_example() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "88547440546",
            "mode": "decode",
            "numeric_key": "0248",
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "VICTOR"


def test_simple_letters_output_roundtrip() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {
            "text": "SOVIET",
            "mode": "encode",
            "alphabet_key": "PI ABCDEFGHJKLMNOQRSTUVWXYZ./",
            "spare_positions": "14",
            "numeric_key": "314",
            "output_format": "letters",
        }
    )

    decoded: Dict[str, Any] = plugin.execute(
        {
            "text": encoded["results"][0]["text_output"],
            "mode": "decode",
            "alphabet_key": "PI ABCDEFGHJKLMNOQRSTUVWXYZ./",
            "spare_positions": "14",
            "numeric_key": "314",
        }
    )

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"].startswith("SOVIET")


def test_checkerboard_encodes_wikipedia_sample_prefix() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()
    key_material = plugin.derive_key_material(**_wiki_inputs())
    checkerboard = plugin.build_checkerboard(key_material["line_s"])

    encoded, metadata = plugin.encode_checkerboard("MEAN 0500. NOT", checkerboard)

    assert encoded == "60253800005550000008087319"
    assert metadata["unsupported_count"] == 0


def test_encode_decode_roundtrip_double_transposition() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    inputs = {
        **_wiki_inputs(),
        "text": "Attack at dawn. By dawn I mean 0500. Not 0915 like you did last time.",
        "mode": "encode",
        "cipher_variant": "historic_schedule",
    }
    encoded: Dict[str, Any] = plugin.execute(inputs)
    assert encoded["status"] == "ok"

    decoded: Dict[str, Any] = plugin.execute(
        {
            **_wiki_inputs(),
            "text": encoded["results"][0]["text_output"],
            "mode": "decode",
            "cipher_variant": "historic_schedule",
        }
    )

    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "ATTACKATDAWN.BYDAWNIMEAN0500.NOT0915LIKEYOUDIDLASTTIME."


def test_checkerboard_only_roundtrip() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {
            **_wiki_inputs(),
            "text": "Cache 2026.",
            "mode": "encode",
            "cipher_variant": "historic_schedule",
            "transposition_mode": "checkerboard_only",
            "insert_keygroup": False,
        }
    )

    decoded: Dict[str, Any] = plugin.execute(
        {
            **_wiki_inputs(),
            "text": encoded["results"][0]["text_output"],
            "mode": "decode",
            "cipher_variant": "historic_schedule",
            "transposition_mode": "checkerboard_only",
            "insert_keygroup": False,
        }
    )

    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "CACHE2026."


def test_invalid_key_material_is_rejected() -> None:
    VicCipherPlugin = _load_plugin_class()
    plugin = VicCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "12345",
            "mode": "decode",
            "cipher_variant": "historic_schedule",
            "phrase": "too short",
            "date": "139195",
            "keygroup": "72401",
            "personal_number": 6,
        }
    )

    assert result["status"] == "error"
    assert "phrase secrete" in result["summary"]
