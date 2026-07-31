"""Tests unitaires pour le plugin spirit_dvd.

Ces tests valident :
- La table de référence complète (extraite de l'outil CacheSleuth)
- Son caractère préfixe, qui rend la lecture du flux non ambiguë
- Les vecteurs entrée/sortie produits par l'outil de référence lui-même
- L'aller-retour encode/decode sur tout l'alphabet
- Les graphies de la barre (| l I 1), l'inversion et l'auto-détection
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_module():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("spirit_dvd_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_MODULE = _load_plugin_module()
SpiritDvdPlugin = _MODULE.SpiritDvdPlugin


def _run(**inputs: Any) -> Dict[str, Any]:
    return SpiritDvdPlugin().execute(inputs)


def _text(result: Dict[str, Any], index: int = 0) -> str:
    return result["results"][index]["text_output"]


#: Table complète telle que publiée par https://www.cachesleuth.com/tools/spiritdvd/
REFERENCE_TABLE = {
    " ": "---", "E": "--|", "A": "-|-", "O": "-||", "R": "|--",
    "M": "|-|---", "W": "|-|--|", "F": "|-|-|-", "G": "|-|-||",
    "Y": "|-||--", "P": "|-||-|", "B": "|-|||-",
    "V": "|-||||---", "K": "|-||||--|", "J": "|-||||-|-", "X": "|-||||-||",
    "Q": "|-|||||--", "Z": "|-|||||-|",
    "T": "||----", "I": "||---|", "N": "||--|-", "H": "||--||",
    "D": "||-|--", "L": "||-|-|", "C": "||-||-", "U": "||-|||",
    "S": "|||",
}

#: Vecteurs (mode, entrée, sortie attendue) rejoués depuis l'outil de référence.
REFERENCE_VECTORS = [
    # L'exemple fourni par le bouton « Example » de l'outil : le point final
    # n'a pas de code et disparaît, l'espace en a un (---).
    (
        "encode", "Wish you were here.",
        "|-|--|||---||||||--||---|-||---||||-|||---|-|--|--||----|---||--||--||----|",
    ),
    (
        "decode",
        "|-|--|||---||||||--||---|-||---||||-|||---|-|--|--||----|---||--||--||----|",
        "WISH YOU WERE HERE",
    ),
    ("encode", "GEO", "|-|-||--|-||"),
    ("decode", "|-|-||--|-||", "GEO"),
    ("encode", "SOS", "|||-|||||"),
    ("decode", "|||-|||||", "SOS"),
    (
        "encode", "geocaching",
        "|-|-||--|-||||-||--|-||-||-||--||||---|||--|-|-|-||",
    ),
    (
        "decode",
        "|-|-||--|-||||-||--|-||-||-||--||||---|||--|-|-|-||",
        "GEOCACHING",
    ),
]


def test_reference_table() -> None:
    assert dict(SpiritDvdPlugin.CODES) == REFERENCE_TABLE


def test_table_covers_the_alphabet_and_the_space_only() -> None:
    keys = set(REFERENCE_TABLE)
    assert keys == set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") | {" "}
    # Les codes sont tous distincts : la table inverse ne perd rien.
    assert len(set(REFERENCE_TABLE.values())) == len(REFERENCE_TABLE)


def test_code_is_prefix_free() -> None:
    # C'est cette propriété qui autorise l'écriture sans séparateur : aucun
    # code n'est le début d'un autre, la lecture gloutonne est donc unique.
    codes = sorted(REFERENCE_TABLE.values())
    for index, code in enumerate(codes):
        for other in codes[index + 1:]:
            assert not other.startswith(code), (code, other)


def test_codes_are_groups_of_three_symbols() -> None:
    for code in REFERENCE_TABLE.values():
        assert len(code) % 3 == 0, code
        assert set(code) <= {"-", "|"}, code


def test_reference_vectors() -> None:
    for mode, source, expected in REFERENCE_VECTORS:
        result = _run(text=source, mode=mode)
        assert result["status"] == "ok", (mode, source)
        assert _text(result) == expected, (mode, source)


def test_round_trip_on_the_whole_alphabet() -> None:
    source = "ABCDEFGHIJKLMNOPQRSTUVWXYZ THE QUICK BROWN FOX"
    encoded = _run(text=source, mode="encode")
    assert _text(_run(text=_text(encoded), mode="decode")) == source


def test_encode_drops_characters_without_a_code() -> None:
    # Chiffres et ponctuation n'ont pas de code : les recopier casserait le flux.
    result = _run(text="N49 12.345", mode="encode")
    assert _text(result) == _text(_run(text="N ", mode="encode"))
    assert result["results"][0]["metadata"]["chars_dropped"] == 8
    assert result["results"][0]["metadata"]["chars_encoded"] == 2


def test_encode_accepts_lowercase() -> None:
    assert _text(_run(text="geo", mode="encode")) == _text(
        _run(text="GEO", mode="encode")
    )


def test_encode_line_char_choices() -> None:
    assert _text(_run(text="GEO", mode="encode", line_char="l")) == "l-l-ll--l-ll"
    assert _text(_run(text="GEO", mode="encode", line_char="1")) == "1-1-11--1-11"


def test_decode_accepts_every_line_glyph() -> None:
    for cipher in ("|-|-||--|-||", "l-l-ll--l-ll", "I-I-II--I-II", "1-1-11--1-11"):
        assert _text(_run(text=cipher, mode="decode")) == "GEO", cipher


def test_swap_inverts_dashes_and_lines() -> None:
    swapped = _text(_run(text="GEO", mode="encode", swap=True))
    assert swapped == "-|-|--||-|--"
    # Sans l'option, cette lecture ne donne rien de bon ; avec, on retrouve GEO.
    assert _text(_run(text=swapped, mode="decode", swap=True)) == "GEO"


def test_ignore_whitespace_accepts_grouped_input() -> None:
    grouped = "|-|- ||-- |-||"
    assert _text(_run(text=grouped, mode="decode")) == "GEO"
    # Désactivée, l'option reproduit l'outil de référence, qui recopie les
    # espaces et ne retrouve donc pas le découpage d'origine.
    strict = _run(text=grouped, mode="decode", ignore_whitespace=False)
    assert _text(strict) != "GEO"
    assert strict["results"][0]["metadata"]["unknown_symbols"] > 0


def test_auto_detect_maps_two_arbitrary_symbols() -> None:
    cipher = "|-|-||--|-||".replace("-", "A").replace("|", "B")
    result = _run(text=cipher, mode="decode")
    assert "GEO" in [item["text_output"] for item in result["results"]]
    assert result["results"][0]["metadata"]["auto_detected"] is True


def test_auto_detect_returns_both_orientations_at_equal_confidence() -> None:
    # L'orientation inverse se décode elle aussi (le code couvre presque toutes
    # les suites de trois symboles) : rien ne permet de trancher sans scoring,
    # les deux lectures sont donc renvoyées à égalité.
    cipher = "|-|-||--|-||".replace("-", "B").replace("|", "A")
    result = _run(text=cipher, mode="decode")
    outputs = [item["text_output"] for item in result["results"]]
    assert len(outputs) == 2
    assert "GEO" in outputs
    assert {tuple(sorted(item["parameters"]["mapping"].items()))
            for item in result["results"]} == {
        (("A", "-"), ("B", "|")), (("A", "|"), ("B", "-"))
    }
    assert {item["confidence"] for item in result["results"]} == {0.45}


def test_auto_detect_ranks_the_readable_orientation_first() -> None:
    # Le seul cas que l'ordonnancement départage vraiment : ici l'orientation
    # inverse laisse des symboles illisibles, elle passe donc derrière.
    cipher = "|||-|||||".replace("-", "B").replace("|", "A")
    result = _run(text=cipher, mode="decode")
    assert _text(result) == "SOS"
    assert result["results"][0]["parameters"]["mapping"] == {"A": "|", "B": "-"}


def test_auto_detect_ignores_canonical_symbols() -> None:
    # Un texte déjà écrit en - et | ne doit pas partir en auto-détection.
    result = _run(text="|-|-||--|-||", mode="decode")
    assert "auto_detected" not in result["results"][0]["metadata"]
    assert len(result["results"]) == 1


def test_auto_detect_can_be_disabled() -> None:
    cipher = "|-|-||--|-||".replace("-", "A").replace("|", "B")
    result = _run(text=cipher, mode="decode", auto_detect=False)
    assert result["status"] == "error"


def test_decode_keeps_unknown_symbols() -> None:
    result = _run(text="|-|-||?--|-||", mode="decode")
    assert _text(result) == "G?EO"
    assert result["results"][0]["metadata"]["unknown_symbols"] == 1
    assert result["results"][0]["metadata"]["chars_decoded"] == 3


def test_confidence_conventions() -> None:
    assert _run(text="GEO", mode="encode")["results"][0]["confidence"] == 1.0
    assert _run(text="|-|-||--|-||", mode="decode")["results"][0]["confidence"] == 0.5


def test_empty_text_is_an_error() -> None:
    result = _run(text="   ", mode="decode")
    assert result["status"] == "error"
    assert result["results"] == []


def test_unknown_mode_is_an_error() -> None:
    assert _run(text="GEO", mode="transmute")["status"] == "error"


def test_invalid_line_char_is_an_error() -> None:
    assert _run(text="GEO", mode="encode", line_char="#")["status"] == "error"


def test_nothing_encodable_is_an_error() -> None:
    assert _run(text="49.123", mode="encode")["status"] == "error"


def test_nothing_decodable_is_an_error() -> None:
    assert _run(text="wxyz???", mode="decode")["status"] == "error"


def test_plugin_info_is_reported() -> None:
    info = _run(text="GEO", mode="encode")["plugin_info"]
    assert info["name"] == "spirit_dvd"
    assert info["version"] == "1.0.0"
    assert info["execution_time_ms"] >= 0


if __name__ == "__main__":
    import traceback

    failures = 0
    for name, func in sorted(globals().items()):
        if not name.startswith("test_") or not callable(func):
            continue
        try:
            func()
            print(f"OK   {name}")
        except Exception:  # noqa: BLE001 - rapport de test standalone
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    print(f"\n{failures} échec(s)")
    sys.exit(1 if failures else 0)
