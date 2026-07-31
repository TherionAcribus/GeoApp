"""Tests unitaires pour le plugin slash_and_pipe.

Ces tests valident :
- La table de référence complète (extraite de l'outil CacheSleuth)
- L'aller-retour encode/decode
- L'auto-détection des symboles (6 permutations)
- Les symboles personnalisés
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("slash_and_pipe_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "SlashAndPipePlugin")


#: Table publiée par https://www.cachesleuth.com/tools/slashandpipe/
REFERENCE_TABLE = {
    "A": "|",
    "B": "|\\",
    "C": "||",
    "D": "|/",
    "E": "\\",
    "F": "||\\",
    "G": "|||",
    "H": "\\\\",
    "I": "/",
    "J": "|\\\\",
    "K": "//||",
    "L": "|\\/",
    "M": "|\\|",
    "N": "|/|",
    "O": "||/|",
    "P": "|\\|\\",
    "Q": "/\\",
    "R": "\\/",
    "S": "/|",
    "T": "|//",
    "U": "//",
    "V": "||\\\\",
    "W": "\\/||",
    "X": "||/",
    "Y": "|||\\",
    "Z": "||||",
}


def test_reference_table_encode() -> None:
    """Chaque lettre produit exactement le groupe publié."""
    plugin = _load_plugin_class()()

    for letter, code in REFERENCE_TABLE.items():
        result: Dict[str, Any] = plugin.execute({"text": letter, "mode": "encode"})
        assert result["status"] == "ok", letter
        assert result["results"][0]["text_output"] == code, letter


def test_reference_table_decode() -> None:
    """Chaque groupe publié se relit en la bonne lettre."""
    plugin = _load_plugin_class()()

    for letter, code in REFERENCE_TABLE.items():
        result = plugin.execute(
            {"text": code, "mode": "decode", "auto_detect": False}
        )
        assert result["status"] == "ok", letter
        assert result["results"][0]["text_output"] == letter, letter


def test_encode_known_word() -> None:
    """Exemple concret de bout en bout."""
    plugin = _load_plugin_class()()

    result = plugin.execute({"text": "GEOCACHING", "mode": "encode"})
    assert result["status"] == "ok"
    assert (
        result["results"][0]["text_output"]
        == "||| \\ ||/| || | || \\\\ / |/| |||"
    )
    assert result["results"][0]["metadata"]["letters_encoded"] == 10


def test_encode_decode_roundtrip() -> None:
    plugin = _load_plugin_class()()

    encoded = plugin.execute({"text": "HELLO WORLD", "mode": "encode"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    # Uniquement les trois symboles attendus (+ les espaces séparatrices).
    assert set(cipher) <= set("|/\\ ")

    decoded = plugin.execute({"text": cipher, "mode": "decode", "auto_detect": False})
    assert decoded["status"] == "ok"
    # Les espaces du texte source ne sont pas transportées par le code.
    assert decoded["results"][0]["text_output"] == "HELLOWORLD"


def test_encode_keeps_unknown_chars_by_default() -> None:
    plugin = _load_plugin_class()()

    result = plugin.execute({"text": "A1B", "mode": "encode"})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "| 1 |\\"
    assert result["results"][0]["metadata"]["unknown_chars"] == 1


def test_encode_strip_unknown() -> None:
    plugin = _load_plugin_class()()

    result = plugin.execute({"text": "A1B", "mode": "encode", "strip_unknown": True})
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "| |\\"


def test_auto_detect_permutations() -> None:
    """Un texte à trois caractères exotiques donne les 6 lectures possibles."""
    plugin = _load_plugin_class()()

    encoded = plugin.execute({"text": "GEOCACHING", "mode": "encode"})
    cipher = encoded["results"][0]["text_output"]
    # Substitution / -> a, | -> b, \ -> c
    disguised = cipher.translate(str.maketrans("/|\\", "abc"))

    result = plugin.execute({"text": disguised, "mode": "decode"})
    assert result["status"] == "ok"
    assert len(result["results"]) == 6
    outputs = [r["text_output"] for r in result["results"]]
    assert "GEOCACHING" in outputs


def test_auto_detect_marks_canonical_reading() -> None:
    """Sur un texte déjà en / | \\, la lecture identité est marquée canonique."""
    plugin = _load_plugin_class()()

    result = plugin.execute({"text": "||| \\ ||/| || | || \\\\ / |/| |||", "mode": "decode"})
    assert result["status"] == "ok"
    canonical = [r for r in result["results"] if r["parameters"]["canonical"]]
    assert len(canonical) == 1
    assert canonical[0]["text_output"] == "GEOCACHING"


def test_custom_symbols_roundtrip() -> None:
    plugin = _load_plugin_class()()

    encoded = plugin.execute({"text": "GEO", "mode": "encode", "symbols": "abc"})
    assert encoded["status"] == "ok"
    cipher = encoded["results"][0]["text_output"]
    assert set(cipher) <= set("abc ")

    decoded = plugin.execute({"text": cipher, "mode": "decode", "symbols": "abc"})
    assert decoded["status"] == "ok"
    assert len(decoded["results"]) == 1
    assert decoded["results"][0]["text_output"] == "GEO"


def test_invalid_symbols() -> None:
    plugin = _load_plugin_class()()

    result = plugin.execute({"text": "ABC", "mode": "encode", "symbols": "aa"})
    assert result["status"] == "error"


def test_empty_text() -> None:
    plugin = _load_plugin_class()()

    assert plugin.execute({"text": "", "mode": "encode"})["status"] == "error"
    assert plugin.execute({"text": "   ", "mode": "decode"})["status"] == "error"


def test_decode_without_valid_group() -> None:
    plugin = _load_plugin_class()()

    result = plugin.execute({"text": "1234", "mode": "decode", "auto_detect": False})
    assert result["status"] == "error"


def test_unknown_mode() -> None:
    plugin = _load_plugin_class()()

    assert plugin.execute({"text": "A", "mode": "rot13"})["status"] == "error"
