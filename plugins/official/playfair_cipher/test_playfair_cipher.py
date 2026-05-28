from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("playfair_cipher_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "PlayfairCipherPlugin")


def test_wikipedia_example_encode() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "hide the gold in the tree stump",
            "mode": "encode",
            "key": "playfair example",
            "group_output": False,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "BMODZBXDNABEKUDMUIXMMOUVIF"
    assert result["results"][0]["metadata"]["digrams"] == [
        "HI",
        "DE",
        "TH",
        "EG",
        "OL",
        "DI",
        "NT",
        "HE",
        "TR",
        "EX",
        "ES",
        "TU",
        "MP",
    ]


def test_wikipedia_example_decode_without_cleanup() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "BMODZBXDNABEKUDMUIXMMOUVIF",
            "mode": "decode",
            "key": "playfair example",
            "cleanup_fillers": False,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "HIDETHEGOLDINTHETREXESTUMP"


def test_decode_with_cleanup_removes_inserted_x() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    result: Dict[str, Any] = plugin.execute(
        {
            "text": "BMODZBXDNABEKUDMUIXMMOUVIF",
            "mode": "decode",
            "key": "playfair example",
            "cleanup_fillers": True,
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "HIDETHEGOLDINTHETREESTUMP"


def test_roundtrip_repeated_letters_and_odd_length() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    encoded: Dict[str, Any] = plugin.execute(
        {
            "text": "BALLOON",
            "mode": "encode",
            "key": "MONARCHY",
            "group_output": False,
        }
    )
    decoded: Dict[str, Any] = plugin.execute(
        {
            "text": encoded["results"][0]["text_output"],
            "mode": "decode",
            "key": "MONARCHY",
            "cleanup_fillers": True,
        }
    )

    assert encoded["status"] == "ok"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "BALLOON"


def test_q_omitted_alphabet_mode() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    square = plugin.create_square(key="KEYWORD", alphabet_mode="Q_OMITTED")

    assert "Q" not in square["grid_string"]
    assert len(square["grid_string"]) == 25


def test_strict_rejects_odd_ciphertext() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ABC", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "impair" in result["summary"]


def test_detect_playfair_like_text() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "BMODZB XDNA BEKU DMUI XMMO UVIF", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True


def test_decode_without_key_keeps_visible_warning() -> None:
    PlayfairCipherPlugin = _load_plugin_class()
    plugin = PlayfairCipherPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "fNsfp Zkrippvg lyvzqcemsfioprv", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"]
    assert result["results"][0]["text_output"] == "HLQHKUGUKOLZFMXZVUBDNRKHNOQW"
    assert "mot-cle" in result["summary"]
    assert "warning" in result["results"][0]["metadata"]
