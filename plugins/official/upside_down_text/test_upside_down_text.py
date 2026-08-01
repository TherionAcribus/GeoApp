"""Tests unitaires pour le plugin upside_down_text.

Ces tests valident :
- Les deux tables de référence (CacheSleuth et GC Wizard) et leur bijectivité
- L'exemple officiel de CacheSleuth (bouton « example » de l'outil)
- Les huit vecteurs de la suite de tests de GC Wizard (upsidedown_test.dart)
- Les allers-retours encode/decode, l'ordre des caractères, la tolérance
  inter-alphabets et le codage de ``j`` sur deux points de code
- Le mode detect et la gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_module():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("upside_down_text_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_MODULE = _load_plugin_module()
UpsideDownTextPlugin = _MODULE.UpsideDownTextPlugin
CACHESLEUTH_TABLE = _MODULE.CACHESLEUTH_TABLE
GCWIZARD_TABLE = _MODULE.GCWIZARD_TABLE


def _run(**inputs: Any) -> Dict[str, Any]:
    return UpsideDownTextPlugin().execute(inputs)


def _text(result: Dict[str, Any], index: int = 0) -> str:
    return result["results"][index]["text_output"]


#: Exemple officiel de l'outil CacheSleuth (bouton « example »).
CACHESLEUTH_EXAMPLE_PLAIN = "Hello geocacher!"
CACHESLEUTH_EXAMPLE_CIPHER = "¡ɹǝɥɔɐɔoǝƃ ollǝH"

#: Vecteurs de GC Wizard (test/tools/crypto_and_encodings/upsidedown/logic/upsidedown_test.dart).
GCWIZARD_ENCODE_VECTORS = [
    ("", ""),
    ("0123456789", "68L9ဌ߈Ɛζ⇂0"),
    ("abcdefghijklmnopqrstuvwxyz", "zʎxʍʌnʇsɹbdouɯlʞſ̣!ɥᵷɟǝpɔqɐ"),
    ("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Z⅄XMɅՈꞱSꓤꝹԀONꟽ⅂ꓘꓩIH⅁ℲƎꓷƆꓭⱯ"),
]

GCWIZARD_DECODE_VECTORS = [
    ("", ""),
    ("Z⅄XMɅՈꞱSꓤꝹԀONꟽ⅂ꓘꓩIH⅁ℲEꓷƆꓭⱯ", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ("zʎxʍʌnʇsɹbdouɯlʞſ̣!ɥᵷɟǝpɔqɐ", "abcdefghijklmnopqrstuvwxyz"),
    ("68L9ဌ߈Ɛζ⇂0", "0123456789"),
]


# ----------------------------------------------------------------------
# Tables de référence
# ----------------------------------------------------------------------
def test_table_sizes():
    assert len(CACHESLEUTH_TABLE) == 78
    assert len(GCWIZARD_TABLE) == 87


def test_tables_are_bijective():
    """Sans valeur dupliquée, la table inverse ne perd aucun caractère."""
    for table in (CACHESLEUTH_TABLE, GCWIZARD_TABLE):
        values = list(table.values())
        assert len(set(values)) == len(values)


def test_cachesleuth_reference_entries():
    for plain, flipped in {
        "a": "ɐ", "e": "ǝ", "g": "ƃ", "i": "ᴉ", "j": "ɾ",
        "A": "∀", "J": "ſ", "K": "⋊", "Q": "Ò", "T": "⊥", "U": "∩",
        "1": "Ɩ", "4": "ㄣ", "5": "ϛ", "7": "ㄥ", "9": "6",
        ";": "؛", "&": "⅋", "_": "‾", ".": "˙",
    }.items():
        assert CACHESLEUTH_TABLE[plain] == flipped


def test_gcwizard_reference_entries():
    for plain, flipped in {
        "g": "ᵷ", "i": "!", "j": "ſ̣",
        "A": "Ɐ", "K": "ꓘ", "M": "ꟽ", "T": "Ʇ", "U": "Ո",
        "1": "⇂", "4": "߈", "5": "ဌ", "7": "L",
        "/": "\\", "<": ">", "«": "»",
    }.items():
        assert GCWIZARD_TABLE[plain] == flipped


# ----------------------------------------------------------------------
# Vecteurs de référence
# ----------------------------------------------------------------------
def test_cachesleuth_example_encode():
    result = _run(text=CACHESLEUTH_EXAMPLE_PLAIN, mode="encode")
    assert result["status"] == "ok"
    assert _text(result) == CACHESLEUTH_EXAMPLE_CIPHER


def test_cachesleuth_example_decode():
    result = _run(text=CACHESLEUTH_EXAMPLE_CIPHER, mode="decode")
    assert _text(result) == CACHESLEUTH_EXAMPLE_PLAIN


def test_gcwizard_encode_vectors():
    plugin = UpsideDownTextPlugin()
    for plain, cipher in GCWIZARD_ENCODE_VECTORS:
        assert plugin.encode(plain, alphabet="gcwizard")[0] == cipher


def test_gcwizard_decode_vectors():
    plugin = UpsideDownTextPlugin()
    for cipher, plain in GCWIZARD_DECODE_VECTORS:
        assert plugin.decode(cipher, alphabet="gcwizard")[0] == plain


def test_gcwizard_j_uses_two_code_points():
    """``j`` s'écrit ``ſ`` + point souscrit : le découpage doit rester atomique."""
    plugin = UpsideDownTextPlugin()
    cipher = plugin.encode("jour", alphabet="gcwizard")[0]
    assert cipher == "ɹnoſ̣"
    assert plugin.decode(cipher, alphabet="gcwizard")[0] == "jour"


# ----------------------------------------------------------------------
# Allers-retours et options
# ----------------------------------------------------------------------
def test_round_trip_both_alphabets():
    plugin = UpsideDownTextPlugin()
    samples = [
        "Hello geocacher!",
        "N 49 07.380 E 002 27.360",
        "abcdefghijklmnopqrstuvwxyz",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "0123456789",
    ]
    for alphabet in ("cachesleuth", "gcwizard"):
        for sample in samples:
            cipher = plugin.encode(sample, alphabet=alphabet)[0]
            assert plugin.decode(cipher, alphabet=alphabet)[0] == sample


def test_character_order_keep_does_not_reverse():
    result = _run(text="Hello", mode="encode", character_order="keep")
    assert _text(result) == "Hǝllo"


def test_character_order_both_returns_two_results():
    result = _run(text="Hello", mode="encode", character_order="both")
    assert [item["text_output"] for item in result["results"]] == ["ollǝH", "Hǝllo"]
    assert [item["parameters"]["character_order"] for item in result["results"]] == ["reverse", "keep"]


def test_encode_confidence_is_deterministic():
    assert _run(text="Hello", mode="encode")["results"][0]["confidence"] == 1.0
    assert _run(text="ollǝH", mode="decode")["results"][0]["confidence"] == 0.5


# ----------------------------------------------------------------------
# Tolérance inter-alphabets
# ----------------------------------------------------------------------
def test_decode_accepts_foreign_non_ascii_glyphs():
    """Les glyphes GC Wizard restent lisibles avec l'alphabet CacheSleuth."""
    plugin = UpsideDownTextPlugin()
    cipher = plugin.encode("geocaching", alphabet="gcwizard")[0]
    # Seul le « ! » (ASCII, propre à GC Wizard) n'est pas réinterprété.
    assert plugin.decode(cipher, alphabet="cachesleuth")[0] == "geocach!ng"
    assert plugin.decode(cipher, alphabet="gcwizard")[0] == "geocaching"


def test_decode_does_not_reinterpret_ascii_of_the_other_alphabet():
    """``L`` (GC Wizard: 7) doit rester un ``L`` en mode CacheSleuth."""
    plugin = UpsideDownTextPlugin()
    assert plugin.decode("L", alphabet="cachesleuth")[0] == "L"
    assert plugin.decode("L", alphabet="gcwizard")[0] == "7"


# ----------------------------------------------------------------------
# Caractères non traduits
# ----------------------------------------------------------------------
def test_unmapped_characters_pass_through_and_are_reported():
    result = _run(text="Café 45°", mode="encode")
    assert _text(result) == "°ϛㄣ éɟɐƆ"
    metadata = result["results"][0]["metadata"]
    assert metadata["unmapped_characters"] == ["é", "°"]
    assert metadata["unmapped_count"] == 2


# ----------------------------------------------------------------------
# Détection
# ----------------------------------------------------------------------
def test_detect_flags_flipped_text():
    result = _run(text=CACHESLEUTH_EXAMPLE_CIPHER, mode="detect")
    metadata = result["results"][0]["metadata"]
    assert metadata["is_match"] is True
    assert metadata["suggested_alphabet"] == "cachesleuth"


def test_detect_identifies_gcwizard_glyphs():
    cipher = UpsideDownTextPlugin().encode("geocaching", alphabet="gcwizard")[0]
    metadata = _run(text=cipher, mode="detect")["results"][0]["metadata"]
    assert metadata["is_match"] is True
    assert metadata["suggested_alphabet"] == "gcwizard"


def test_detect_rejects_plain_text():
    metadata = _run(text="Hello geocacher", mode="detect")["results"][0]["metadata"]
    assert metadata["is_match"] is False
    assert metadata["signature_count"] == 0


# ----------------------------------------------------------------------
# Erreurs
# ----------------------------------------------------------------------
def test_empty_text_is_an_error():
    result = _run(text="", mode="decode")
    assert result["status"] == "error"
    assert result["results"] == []


def test_unknown_mode_is_an_error():
    assert _run(text="abc", mode="rotate")["status"] == "error"


def test_unknown_alphabet_is_an_error():
    assert _run(text="abc", mode="encode", alphabet="dcode")["status"] == "error"


def test_unknown_character_order_is_an_error():
    assert _run(text="abc", mode="encode", character_order="shuffle")["status"] == "error"


def test_module_level_execute():
    result = _MODULE.execute({"text": CACHESLEUTH_EXAMPLE_CIPHER, "mode": "decode"})
    assert _text(result) == CACHESLEUTH_EXAMPLE_PLAIN
    assert result["plugin_info"]["name"] == "upside_down_text"


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
