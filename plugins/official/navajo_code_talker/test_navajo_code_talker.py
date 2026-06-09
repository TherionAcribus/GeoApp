from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("navajo_code_talker_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "NavajoCodeTalkerPlugin")


def test_encode_alphabet_historical() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "ABC", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "Wol-la-chee Shush Moasi"


def test_decode_historical_words() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Wol-la-chee Shush Moasi", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ABC"


def test_decode_hyphenated_multi_part_codes() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Tkele-cho-gi Klizzie-yazzi Dibeh-yazzi", "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "JKL"


def test_modern_spelling_roundtrip() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "GO", "mode": "encode", "spelling": "modern"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "Tlizi Neeshjaa"
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "GO"


def test_word_separator_roundtrip() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "GO AT", "mode": "encode"})
    decoded: Dict[str, Any] = plugin.execute({"text": encoded["results"][0]["text_output"], "mode": "decode"})

    assert encoded["results"][0]["text_output"] == "Klizzie Ne-ash-jah / Wol-la-chee Than-zie"
    assert decoded["results"][0]["text_output"] == "GO AT"


def test_english_mnemonics_are_not_decoded() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Ant Bear Cat", "mode": "decode"})

    assert result["status"] == "error"


def test_strict_rejects_unknown_word() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Wol-la-chee unknown", "mode": "decode", "strict": "strict"})

    assert result["status"] == "error"
    assert "inconnu" in result["summary"]


def test_detect_navajo_code_words() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()

    result: Dict[str, Any] = plugin.execute({"text": "Wol-la-chee Shush Moasi", "mode": "detect"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["is_match"] is True


def test_decodes_extended_alphabet_variants_from_geocaching_sample() -> None:
    NavajoCodeTalkerPlugin = _load_plugin_class()
    plugin = NavajoCodeTalkerPlugin()
    text = (
        "CA-YEILTH SHI-DA BE-LA-SANA DAH-NES-TSA BE-LA-SANA TSAH THAN-ZIE DZEH "
        "DIBEH AH-NAH BI-SO-DIH THAN-ZIE LHA-CHA-EH DZEH JEHA DAH-NES-TSA DZEH "
        "DIBEH CHINDI A-CHI AL-NA-AS-DZOH TSAH DZEH SHI-DA MA-E BI-SO-DIH "
        "TLO-CHIN A-CHI A-CHIN D-AH KLESH TKIN AL-NA-AS-DZOH MOASI DZEH "
        "A-CHIN D-AH CHA SHI-DA YEH-HES D-AH"
    )

    result: Dict[str, Any] = plugin.execute({"text": text, "mode": "decode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "QUARANTESEPTDEGRESDIXNEUFPOINTSIXCENTHUIT"
    assert result["results"][0]["metadata"]["unknown_count"] == 0
