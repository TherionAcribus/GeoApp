"""Tests unitaires pour le plugin seven_segment_display.

Ces tests valident :
- L'exemple de référence CacheSleuth (`ABCEFG ADEF DEG` -> `ACc`)
- L'exemple de référence dCode (segments `cdeg` -> binaire `1011100`, ordre gfedcba)
- Les notations binaire / décimal / hexadécimal et l'ordre des bits alternatif
- L'inversion anode commune
- Les lectures ambiguës (5 / S) pilotées par `letter_bias`
- Le roundtrip encode -> decode
- Le rendu ASCII de l'afficheur
- Le mode brute-force et le format standardisé de sortie
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("seven_segment_display_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "SevenSegmentDisplayPlugin")


def _plugin():
    return _load_plugin_class()()


def test_decode_cachesleuth_reference_example() -> None:
    """Exemple fourni par l'outil CacheSleuth : ABCEFG ADEF DEG -> A C c."""
    result: Dict[str, Any] = _plugin().execute(
        {"text": "ABCEFG ADEF DEG", "mode": "decode", "enable_scoring": False}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ACc"
    assert result["results"][0]["parameters"]["notation"] == "letters"


def test_encode_digits_uses_reference_segments() -> None:
    result: Dict[str, Any] = _plugin().execute({"text": "0123", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ABCDEF BC ABDEG ABCDG"


def test_dcode_binary_bit_order_is_gfedcba() -> None:
    """dCode : les segments cdeg valent 1011100 (a = bit de poids faible)."""
    plugin = _plugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "O", "mode": "encode", "notation": "binary"}
    )
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "1011100"

    decoded: Dict[str, Any] = plugin.execute(
        {"text": "1011100", "mode": "decode", "enable_scoring": False}
    )
    assert decoded["status"] == "ok"
    assert decoded["results"][0]["text_output"] == "O"
    assert decoded["results"][0]["parameters"]["notation"] == "binary"


def test_abcdefg_bit_order_puts_segment_a_first() -> None:
    result: Dict[str, Any] = _plugin().execute(
        {"text": "O", "mode": "encode", "notation": "binary", "bit_order": "abcdefg"}
    )

    # cdeg avec a en poids fort : a=0 b=0 c=1 d=1 e=1 f=0 g=1
    assert result["results"][0]["text_output"] == "0011101"


def test_all_segments_lit_is_eight_and_decimal_127() -> None:
    plugin = _plugin()

    decoded: Dict[str, Any] = plugin.execute(
        {"text": "1111111", "mode": "decode", "enable_scoring": False}
    )
    assert decoded["results"][0]["text_output"] == "8"

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "8", "mode": "encode", "notation": "decimal"}
    )
    assert encoded["results"][0]["text_output"] == "127"


def test_hex_notation_roundtrip() -> None:
    plugin = _plugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "42", "mode": "encode", "notation": "hex"}
    )
    hex_code = encoded["results"][0]["text_output"]

    decoded: Dict[str, Any] = plugin.execute(
        {"text": hex_code, "mode": "decode", "notation": "hex", "enable_scoring": False}
    )
    assert decoded["results"][0]["text_output"] == "42"


def test_anode_common_inverts_bits() -> None:
    plugin = _plugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "O", "mode": "encode", "notation": "binary", "common": "anode"}
    )
    assert encoded["results"][0]["text_output"] == "0100011"

    decoded: Dict[str, Any] = plugin.execute(
        {
            "text": "0100011",
            "mode": "decode",
            "notation": "binary",
            "common": "anode",
            "enable_scoring": False,
        }
    )
    assert decoded["results"][0]["text_output"] == "O"


def test_letter_bias_resolves_ambiguous_patterns() -> None:
    """ACDFG se lit 5 (référence) ou S (lecture alphabétique)."""
    plugin = _plugin()

    default: Dict[str, Any] = plugin.execute(
        {"text": "ACDFG", "mode": "decode", "enable_scoring": False}
    )
    assert default["results"][0]["text_output"] == "5"
    assert "S" in default["results"][0]["metadata"]["alternatives"][0]

    letters: Dict[str, Any] = plugin.execute(
        {"text": "ACDFG", "mode": "decode", "letter_bias": "letters", "enable_scoring": False}
    )
    assert letters["results"][0]["text_output"] == "S"

    digits: Dict[str, Any] = plugin.execute(
        {"text": "ABCDEF", "mode": "decode", "letter_bias": "digits", "enable_scoring": False}
    )
    assert digits["results"][0]["text_output"] == "0"


def test_encode_falls_back_to_other_case_for_missing_glyphs() -> None:
    """'S' est absent de la table de référence : il est encodé via sa lecture alternative."""
    result: Dict[str, Any] = _plugin().execute({"text": "S", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ACDFG"


def test_encode_decode_roundtrip_on_digits() -> None:
    plugin = _plugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "N4712", "mode": "encode"})
    assert encoded["status"] == "ok"
    segments = encoded["results"][0]["text_output"]

    decoded: Dict[str, Any] = plugin.execute(
        {"text": segments, "mode": "decode", "enable_scoring": False}
    )
    assert decoded["results"][0]["text_output"] == "N4712"


def test_space_is_encoded_as_p_token_and_decoded_back() -> None:
    plugin = _plugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "1 2", "mode": "encode"})
    assert encoded["results"][0]["text_output"] == "BC P ABDEG"

    decoded: Dict[str, Any] = plugin.execute(
        {"text": "BC P ABDEG", "mode": "decode", "enable_scoring": False}
    )
    assert decoded["results"][0]["text_output"] == "1 2"


def test_ascii_art_rendering_of_digit_one() -> None:
    result: Dict[str, Any] = _plugin().execute(
        {"text": "1", "mode": "encode", "notation": "ascii_art"}
    )

    assert result["status"] == "ok"
    # Le chiffre 1 n'allume que les segments B et C (barres verticales de droite).
    assert result["results"][0]["text_output"] == "\n".join(["", "  |", "  |"])


def test_unsupported_characters_are_reported() -> None:
    result: Dict[str, Any] = _plugin().execute({"text": "Aé", "mode": "encode"})

    assert result["status"] == "ok"
    assert result["results"][0]["metadata"]["unsupported_characters"] == ["é"]


def test_plain_text_is_not_mistaken_for_segment_notation() -> None:
    """Sans garde-fou, tout texte produirait une lecture faite de ses lettres A-G."""
    plugin = _plugin()

    for text in ("HELLO WORLD", "Le texte du listing parle de segments"):
        result: Dict[str, Any] = plugin.execute(
            {"text": text, "mode": "decode", "enable_scoring": False}
        )
        assert result["status"] == "error", text

    bruteforced: Dict[str, Any] = plugin.execute(
        {"text": "HELLO WORLD", "mode": "decode", "bruteforce": True, "enable_scoring": False}
    )
    assert bruteforced["status"] == "error"


def test_label_prefix_is_ignored() -> None:
    result: Dict[str, Any] = _plugin().execute(
        {"text": "Segments: ABCEFG ADEF DEG", "mode": "decode", "enable_scoring": False}
    )

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "ACc"


def test_empty_input_returns_error() -> None:
    result: Dict[str, Any] = _plugin().execute({"text": "   ", "mode": "decode"})

    assert result["status"] == "error"
    assert result["results"] == []


def test_bruteforce_returns_multiple_readings() -> None:
    result: Dict[str, Any] = _plugin().execute(
        {"text": "ACDFG ABCDEF", "mode": "decode", "bruteforce": True, "enable_scoring": False}
    )

    assert result["status"] == "ok"
    outputs = {item["text_output"] for item in result["results"]}
    assert "50" in outputs
    assert "SO" in outputs


def test_bruteforce_recovers_alternate_bit_order() -> None:
    plugin = _plugin()

    encoded: Dict[str, Any] = plugin.execute(
        {"text": "GEO", "mode": "encode", "notation": "binary", "bit_order": "abcdefg"}
    )
    bits = encoded["results"][0]["text_output"]

    result: Dict[str, Any] = plugin.execute(
        {"text": bits, "mode": "decode", "bruteforce": True, "enable_scoring": False}
    )
    outputs = {item["text_output"] for item in result["results"]}
    assert "GEO" in outputs


def test_output_format_matches_standard_contract() -> None:
    result: Dict[str, Any] = _plugin().execute({"text": "8", "mode": "encode"})

    assert result["status"] == "ok"
    assert "summary" in result
    assert "results" in result
    assert "plugin_info" in result
    plugin_info = result["plugin_info"]
    assert plugin_info["name"] == "seven_segment_display"
    assert plugin_info["version"] == "1.0.0"
    assert "execution_time_ms" in plugin_info
