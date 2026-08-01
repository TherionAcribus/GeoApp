"""Tests unitaires pour le plugin tapir.

Ces tests valident :
- La table de référence complète (lettres, digrammes, chiffres, ponctuation)
- Les vecteurs entrée/sortie de la suite de tests de GC Wizard (tapir_test.dart)
- Le masque jetable (addition/soustraction modulo 10, masque partiel)
- Les bascules lettres/chiffres, les digrammes, le remplissage
- Les caractères allemands (Ä Ö Ü ß) et le saut de ligne
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_module():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("tapir_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_MODULE = _load_plugin_module()
TapirPlugin = _MODULE.TapirPlugin


def _run(**inputs: Any) -> Dict[str, Any]:
    return TapirPlugin().execute(inputs)


def _text(result: Dict[str, Any], index: int = 0) -> str:
    return result["results"][index]["text_output"]


#: Table des lettres, telle que publiée par GC Wizard et CacheSleuth.
REFERENCE_LETTERS = {
    " ": "83", "\n": "80",
    "A": "0", "E": "1", "I": "2", "N": "3", "R": "4",
    "B": "50", "BE": "51", "C": "52", "CH": "53", "D": "54", "DE": "55",
    "F": "56", "G": "57", "GE": "58", "H": "59", "J": "60", "K": "61",
    "L": "62", "M": "63", "O": "64", "P": "67", "Q": "68", "S": "69",
    "T": "70", "TE": "71", "U": "72", "UN": "73", "V": "74", "W": "76",
    "X": "77", "Y": "78", "Z": "79",
    "Ä": "66", "Ö": "88", "Ü": "99", "ß": "65",
}

#: Table active après le marqueur 82.
REFERENCE_NUMBERS = {
    " ": "83", "\n": "80",
    ".": "89", ":": "90", ",": "91", "-": "92", "/": "93", "(": "94",
    ")": "95", "+": "96", "=": "97", '"': "98",
    "0": "00", "1": "11", "2": "22", "3": "33", "4": "44", "5": "55",
    "6": "66", "7": "77", "8": "88", "9": "99",
}

#: Message d'exemple de GC Wizard, tiré de http://scz.bplaced.net/m.html#t
LONG_PLAIN = "UEBSNVWOSTOK944UEBUNGSSPRUCH12DASWETTERUMSOROKA9442"
LONG_CIPHER = (
    "72150 69374 76646 97064 61829 94444 81721 50735 76969 67472 53821 "
    "12281 54069 76170 71472 63696 44646 10829 94444 22838"
)
#: Le même, masqué par un one-time pad de 9 chiffres seulement : seuls les
#: neuf premiers chiffres changent, le reste passe en clair.
SHORT_KEY = "123456789"
SHORT_KEY_CIPHER = (
    "84495 26164 76646 97064 61829 94444 81721 50735 76969 67472 53821 "
    "12281 54069 76170 71472 63696 44646 10829 94444 22838"
)
#: Masque couvrant tout le message.
FULL_KEY = (
    "1234567891241482423845324843210661231386848632013858456748913489"
    "489561897489496156418974897001687952"
)
FULL_KEY_CIPHER = (
    "84495 26165 90784 11292 06143 78765 87333 81011 50722 87500 01277 "
    "86072 88853 55631 50110 57557 90054 07208 64450 09780"
)

#: Vecteurs d'encodage (texte, masque, sortie attendue) — GC Wizard.
ENCODE_VECTORS = [
    ("ABE", None, "05183"),
    (LONG_PLAIN, None, LONG_CIPHER),
    (LONG_PLAIN, "", LONG_CIPHER),
    (LONG_PLAIN, SHORT_KEY, SHORT_KEY_CIPHER),
    # Les caractères non numériques du masque sont ignorés.
    (LONG_PLAIN, "12345abc678 9", SHORT_KEY_CIPHER),
    (LONG_PLAIN, FULL_KEY, FULL_KEY_CIPHER),
    # Un masque plus long que le message ne change rien de plus.
    (LONG_PLAIN, FULL_KEY + FULL_KEY, FULL_KEY_CIPHER),
]

#: Vecteurs de décodage (chiffres, masque, sortie attendue) — GC Wizard.
DECODE_VECTORS = [
    ("05183", None, "ABE"),
    ("51083", None, "BEA"),
    ("510", None, "BEA"),
    ("0", None, "A"),
    ("51", None, "BE"),
    ("52", None, "C"),
    ("5274", None, "CV"),
    (LONG_CIPHER, None, LONG_PLAIN),
    (LONG_CIPHER, "", LONG_PLAIN),
    (SHORT_KEY_CIPHER, SHORT_KEY, LONG_PLAIN),
    (SHORT_KEY_CIPHER, "12345abc678 9", LONG_PLAIN),
    (FULL_KEY_CIPHER, FULL_KEY, LONG_PLAIN),
    (FULL_KEY_CIPHER, FULL_KEY + FULL_KEY, LONG_PLAIN),
    # Coordonnées : bascule chiffres, point décimal et saut de ligne.
    (
        "38244 33832 25589 11665 58081 18200 22448 33377 89999 966",
        None,
        "N43 25.165\nE024 37.996",
    ),
]


def test_reference_tables() -> None:
    assert TapirPlugin.LETTERS == REFERENCE_LETTERS
    assert TapirPlugin.NUMBERS == REFERENCE_NUMBERS


def test_single_digit_codes_are_the_five_frequent_letters() -> None:
    singles = {c: k for c, k in TapirPlugin.LETTERS.items() if len(k) == 1}
    assert singles == {"A": "0", "E": "1", "I": "2", "N": "3", "R": "4"}


def test_letter_codes_are_unambiguous_without_a_separator() -> None:
    # En mode lettres, aucun code à deux chiffres ne commence par un code à un
    # chiffre : la lecture gloutonne se réaligne donc toujours correctement.
    singles = {k for k in TapirPlugin.LETTERS.values() if len(k) == 1}
    for code in TapirPlugin.LETTERS.values():
        if len(code) == 2:
            assert code[0] not in singles, code


def test_numeric_codes_are_all_two_digits() -> None:
    # En mode chiffres il n'y a pas de code court : la lecture est toujours
    # alignée sur deux chiffres, y compris pour 00 (le chiffre zéro).
    assert {len(code) for code in TapirPlugin.NUMBERS.values()} == {2}


def test_codes_are_unique_within_each_table() -> None:
    for table in (TapirPlugin.LETTERS, TapirPlugin.NUMBERS):
        assert len(set(table.values())) == len(table)


def test_encode_reference_vectors() -> None:
    for source, key, expected in ENCODE_VECTORS:
        result = _run(text=source, mode="encode", key=key)
        assert result["status"] == "ok", (source, key)
        assert _text(result) == expected, (source, key)


def test_decode_reference_vectors() -> None:
    for source, key, expected in DECODE_VECTORS:
        result = _run(text=source, mode="decode", key=key)
        assert result["status"] == "ok", (source, key)
        assert _text(result) == expected, (source, key)


def test_round_trip_with_and_without_pad() -> None:
    source = "N 49 12.345 E 006 07.890"
    for key in (None, "9081726354" * 8):
        encoded = _run(text=source, mode="encode", key=key)
        assert _text(_run(text=_text(encoded), mode="decode", key=key)) == source


def test_digraphs_take_precedence_over_single_letters() -> None:
    # CH doit l'emporter sur C+H, UN sur U+N, etc.
    assert _text(_run(text="CH", mode="encode", pad=False)) == "53"
    assert _text(_run(text="UN", mode="encode", pad=False)) == "73"
    assert _text(_run(text="BE", mode="encode", pad=False)) == "51"
    assert _text(_run(text="DE", mode="encode", pad=False)) == "55"
    assert _text(_run(text="GE", mode="encode", pad=False)) == "58"
    assert _text(_run(text="TE", mode="encode", pad=False)) == "71"


def _raw(source: str) -> str:
    """Encode sans remplissage ni groupement, pour lire les codes bruts."""
    return _text(_run(text=source, mode="encode", pad=False, group_size=0))


def test_mode_switch_markers() -> None:
    # 82 entre en mode chiffres, 81 revient aux lettres.
    assert _raw("A1B") == "0" + "82" + "11" + "81" + "50"
    assert _text(_run(text="082118150", mode="decode")) == "A1B"


def test_space_does_not_switch_mode() -> None:
    # 83 appartient aux deux tables : un espace ne provoque pas de bascule.
    assert _raw("1 2") == "82" + "11" + "83" + "22"


def test_german_characters() -> None:
    assert _raw("ÄÖÜß") == "66889965"
    assert _text(_run(text="66889965", mode="decode")) == "ÄÖÜß"
    # La minuscule ß ne doit pas devenir SS en passant en majuscules.
    assert _raw("ß") == "65"
    assert _raw("äöü") == "668899"


def test_newline_is_encoded() -> None:
    assert _raw("A\nE") == "0" + "80" + "1"
    assert _text(_run(text="0801", mode="decode")) == "A\nE"


def test_pad_completes_to_a_multiple_of_five() -> None:
    padded = _run(text="ABE", mode="encode")
    assert _text(padded) == "05183"
    assert _text(_run(text="ABE", mode="encode", pad=False)) == "051"
    # Le remplissage se relit en espace, donc disparaît au décodage.
    assert _text(_run(text="05183", mode="decode")) == "ABE"


def test_group_size_option() -> None:
    assert _text(_run(text=LONG_PLAIN, mode="encode", group_size=0)) == (
        LONG_CIPHER.replace(" ", "")
    )
    grouped = _text(_run(text=LONG_PLAIN, mode="encode", group_size=10))
    assert grouped.split()[0] == "7215069374"


def test_unencodable_characters_are_dropped() -> None:
    result = _run(text="A~B", mode="encode", pad=False)
    assert _text(result) == "050"
    assert result["results"][0]["metadata"]["chars_dropped"] == 1


def test_decode_ignores_non_digits() -> None:
    # Les groupes peuvent être séparés comme on veut, y compris par du texte.
    assert _text(_run(text="05-183", mode="decode")) == "ABE"
    assert _text(_run(text="0 5 1 8 3", mode="decode")) == "ABE"


def test_decode_recognises_historic_markers() -> None:
    # 84 et 85 ne sont jamais produits à l'encodage, mais les relever vaut
    # mieux que de les perdre (comportement de l'outil CacheSleuth).
    assert _text(_run(text="084085", mode="decode")) == "A#CODE#A#RPT#"


def test_one_time_pad_is_reversible() -> None:
    key = "5" * 40
    encoded = _run(text="GEOCACHING", mode="encode", key=key)
    assert _text(_run(text=_text(encoded), mode="decode", key=key)) == "GEOCACHING"
    # Sans la clé, le texte chiffré ne redonne pas le message.
    assert _text(_run(text=_text(encoded), mode="decode")) != "GEOCACHING"


def test_one_time_pad_coverage_is_reported() -> None:
    partial = _run(text=LONG_PLAIN, mode="encode", key=SHORT_KEY)
    assert partial["results"][0]["metadata"]["one_time_pad_covers_all"] is False
    assert partial["results"][0]["metadata"]["one_time_pad_digits"] == 9
    full = _run(text=LONG_PLAIN, mode="encode", key=FULL_KEY)
    assert full["results"][0]["metadata"]["one_time_pad_covers_all"] is True


def test_confidence_conventions() -> None:
    assert _run(text="ABE", mode="encode")["results"][0]["confidence"] == 1.0
    assert _run(text="05183", mode="decode")["results"][0]["confidence"] == 0.5


def test_empty_text_is_an_error() -> None:
    result = _run(text="   ", mode="decode")
    assert result["status"] == "error"
    assert result["results"] == []


def test_unknown_mode_is_an_error() -> None:
    assert _run(text="ABE", mode="transmute")["status"] == "error"


def test_text_without_digits_is_an_error_in_decode() -> None:
    assert _run(text="hello", mode="decode")["status"] == "error"


def test_nothing_encodable_is_an_error() -> None:
    assert _run(text="~~~", mode="encode")["status"] == "error"


def test_invalid_group_size_is_an_error() -> None:
    assert _run(text="ABE", mode="encode", group_size=99)["status"] == "error"
    assert _run(text="ABE", mode="encode", group_size="abc")["status"] == "error"


def test_plugin_info_is_reported() -> None:
    info = _run(text="ABE", mode="encode")["plugin_info"]
    assert info["name"] == "tapir"
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
