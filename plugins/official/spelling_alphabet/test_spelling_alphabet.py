"""Tests unitaires pour le plugin spelling_alphabet.

Ces tests valident :
- Les tables de référence des 11 alphabets (extraites de l'outil CacheSleuth)
- Les vecteurs entrée/sortie produits par l'outil de référence lui-même
- L'aller-retour encode/decode
- Le décodage automatique (essai des 11 alphabets)
- Les tolérances de décodage (casse, tirets, variantes, mots composés)
- La gestion des erreurs
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_module():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("spelling_alphabet_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_MODULE = _load_plugin_module()
SpellingAlphabetPlugin = _MODULE.SpellingAlphabetPlugin
ALPHABETS = _MODULE.ALPHABETS


def _run(**inputs: Any) -> Dict[str, Any]:
    return SpellingAlphabetPlugin().execute(inputs)


def _text(result: Dict[str, Any], index: int = 0) -> str:
    return result["results"][index]["text_output"]


#: Identifiants publiés par https://www.cachesleuth.com/tools/spellingalphabet/
EXPECTED_IDS = [
    "nato",
    "itu1932",
    "western-union",
    "us-jan",
    "raf1924",
    "apco",
    "dutch",
    "german",
    "swedish",
    "russian",
    "russian-unofficial",
]

#: Table NATO complète, telle que publiée par l'outil de référence.
NATO_TABLE = {
    "a": "Alfa", "b": "Bravo", "c": "Charlie", "d": "Delta", "e": "Echo",
    "f": "Foxtrot", "g": "Golf", "h": "Hotel", "i": "India", "j": "Juliett",
    "k": "Kilo", "l": "Lima", "m": "Mike", "n": "November", "o": "Oscar",
    "p": "Papa", "q": "Quebec", "r": "Romeo", "s": "Sierra", "t": "Tango",
    "u": "Uniform", "v": "Victor", "w": "Whiskey", "x": "X-ray", "y": "Yankee",
    "z": "Zulu",
    "0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four",
    "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Nine",
    ".": "Stop",
}

#: Vecteurs (mode, alphabet, entrée, sortie attendue) rejoués depuis la logique
#: de l'outil de référence — ce sont eux qui verrouillent la conformité.
REFERENCE_VECTORS = [
    # L'exemple fourni par le bouton « Example » de l'outil.
    (
        "encode", "nato", "The quick brown fox.",
        "Tango Hotel Echo (space) Quebec Uniform India Charlie Kilo (space) "
        "Bravo Romeo Oscar Whiskey November (space) Foxtrot Oscar X-ray Stop",
    ),
    (
        "decode", "nato",
        "Tango Hotel Echo (space) Quebec Uniform India Charlie Kilo (space) "
        "Bravo Romeo Oscar Whiskey November (space) Foxtrot Oscar X-ray Stop",
        "the quick brown fox.",
    ),
    ("decode", "nato", "Golf Echo Oscar", "geo"),
    # Coordonnées : chiffres et point décimal.
    ("encode", "nato", "N49 12.345",
     "November Four Nine (space) One Two Stop Three Four Five"),
    ("decode", "nato", "November Four Nine (space) One Two Stop Three Four Five",
     "n49 12.345"),
    # Mot-code en deux parties, avec et sans espace interne.
    ("encode", "itu1932", "nine", "New York Italia New York Edison"),
    ("decode", "itu1932", "New York Italia New York Edison", "nine"),
    ("decode", "itu1932", "newyork italia newyork edison", "nine"),
    # Même trigramme dans les variantes anglophones.
    ("encode", "western-union", "geo", "George Easy Ocean"),
    ("encode", "us-jan", "geo", "George Easy Oboe"),
    ("encode", "raf1924", "geo", "George Edward Orange"),
    ("encode", "apco", "geo", "George Edward Ocean"),
    ("encode", "dutch", "geo 7", "Gerard Eduard Otto (space) Zeven"),
    # Diacritiques et eszett.
    ("encode", "german", "Schlüssel",
     "Samuel Cäsar Heinrich Ludwig Übermut Samuel Samuel Emil Ludwig"),
    ("decode", "german", "Konrad Scharfes S Zürich", "kßz"),
    ("encode", "swedish", "Åke 8", "Åke Kalle Erik (space) Åtta"),
    # Cyrillique.
    ("encode", "russian", "Иван", "Иван Василий Анна Николай"),
    ("encode", "russian-unofficial", "ёж", "Ёлка Жук"),
]


def test_all_alphabets_present() -> None:
    assert [alphabet["id"] for alphabet in ALPHABETS] == EXPECTED_IDS


def test_alphabets_cover_the_whole_latin_or_cyrillic_range() -> None:
    for alphabet in ALPHABETS:
        keys = set(alphabet["words"])
        if alphabet["id"].startswith("russian"):
            assert "а" in keys and "я" in keys
        else:
            assert set("abcdefghijklmnopqrstuvwxyz") <= keys, alphabet["id"]


def test_nato_reference_table() -> None:
    words = dict(ALPHABETS[0]["words"])
    assert words == NATO_TABLE


def test_reference_vectors() -> None:
    for mode, alphabet, source, expected in REFERENCE_VECTORS:
        result = _run(text=source, mode=mode, alphabet=alphabet)
        assert result["status"] == "ok", (mode, alphabet, source)
        assert _text(result) == expected, (mode, alphabet, source)


def test_round_trip_on_every_alphabet() -> None:
    for alphabet in ALPHABETS:
        # On ne réutilise que les clés d'une lettre, hors chiffres/ponctuation.
        letters = [key for key in alphabet["words"] if key.isalpha()][:8]
        source = "".join(letters)
        encoded = _run(text=source, mode="encode", alphabet=alphabet["id"])
        assert encoded["status"] == "ok", alphabet["id"]
        decoded = _run(
            text=_text(encoded), mode="decode", alphabet=alphabet["id"]
        )
        assert _text(decoded) == source, alphabet["id"]


def test_decode_ignores_case_and_hyphen() -> None:
    for variant in ("X-ray Romeo Alfa Yankee", "x-ray romeo alfa yankee",
                    "XRAY ROMEO ALFA YANKEE", "xray romeo alfa yankee"):
        assert _text(_run(text=variant, mode="decode", alphabet="nato")) == "xray"


def test_decode_accepts_alternate_spellings() -> None:
    # Alpha/Juliet/Xray sont acceptés en entrée mais jamais produits en sortie.
    assert _text(_run(text="Alpha Juliet Xray", mode="decode", alphabet="nato")) == "ajx"
    assert _text(_run(text="ajx", mode="encode", alphabet="nato")) == "Alfa Juliett X-ray"


def test_decode_longest_match_wins() -> None:
    # « Иван краткий » (й) doit l'emporter sur « Иван » (и) seul.
    result = _run(text="Иван краткий Иван", mode="decode", alphabet="russian")
    assert _text(result) == "йи"


def test_decode_keeps_unknown_words() -> None:
    result = _run(text="alfa bravo hello charlie", mode="decode", alphabet="nato")
    assert _text(result) == "ab hello c"
    metadata = result["results"][0]["metadata"]
    assert metadata["words_matched"] == 3
    assert metadata["words_total"] == 4


def test_encode_keeps_unsupported_characters() -> None:
    result = _run(text="a!b", mode="encode", alphabet="nato")
    assert _text(result) == "Alfa ! Bravo"
    assert result["results"][0]["metadata"]["unknown_chars"] == 1


def test_encode_preserves_newlines() -> None:
    assert _text(_run(text="a\nb", mode="encode", alphabet="nato")) == "Alfa \n Bravo"


def test_encode_confidence_is_deterministic() -> None:
    result = _run(text="geo", mode="encode", alphabet="nato")
    assert result["results"][0]["confidence"] == 1.0


def test_auto_mode_finds_nato() -> None:
    result = _run(text="Golf Echo Oscar", mode="decode")
    assert result["status"] == "ok"
    assert result["results"][0]["parameters"]["alphabet"] == "nato"
    assert _text(result) == "geo"
    assert result["results"][0]["metadata"]["auto_detected"] is True


def test_auto_mode_finds_a_regional_alphabet() -> None:
    result = _run(text="Gerard Eduard Otto", mode="decode", alphabet="auto")
    alphabets = [item["parameters"]["alphabet"] for item in result["results"]]
    assert "dutch" in alphabets
    dutch = result["results"][alphabets.index("dutch")]
    assert dutch["text_output"] == "geo"
    assert dutch["metadata"]["match_ratio"] == 1.0


def test_auto_mode_merges_identical_outputs() -> None:
    # « Charlie » et « King » appartiennent à plusieurs alphabets : le même
    # texte ne doit apparaître qu'une fois, la provenance étant conservée.
    result = _run(text="Charlie King", mode="decode", alphabet="auto")
    outputs = [item["text_output"] for item in result["results"]]
    assert len(outputs) == len(set(outputs))
    merged = [item for item in result["results"] if item["metadata"]["also_matched"]]
    assert merged, "aucun doublon fusionné alors que ck est produit par 3 alphabets"


def test_auto_mode_confidence_follows_match_ratio() -> None:
    full = _run(text="Golf Echo Oscar", mode="decode", alphabet="nato")
    partial = _run(text="Golf Echo hello", mode="decode", alphabet="nato")
    assert full["results"][0]["confidence"] == 0.5
    assert partial["results"][0]["confidence"] < 0.5


def test_alphabet_id_accepts_underscores() -> None:
    hyphen = _run(text="George Easy Ocean", mode="decode", alphabet="western-union")
    underscore = _run(text="George Easy Ocean", mode="decode", alphabet="western_union")
    assert _text(hyphen) == _text(underscore) == "geo"


def test_encode_in_auto_mode_falls_back_to_nato() -> None:
    result = _run(text="geo", mode="encode", alphabet="auto")
    assert _text(result) == "Golf Echo Oscar"
    assert result["results"][0]["parameters"]["alphabet"] == "nato"


def test_empty_text_is_an_error() -> None:
    result = _run(text="   ", mode="decode")
    assert result["status"] == "error"
    assert result["results"] == []


def test_unknown_alphabet_is_an_error() -> None:
    result = _run(text="Golf", mode="decode", alphabet="klingon")
    assert result["status"] == "error"


def test_unknown_mode_is_an_error() -> None:
    result = _run(text="Golf", mode="transmute")
    assert result["status"] == "error"


def test_nothing_recognised_is_an_error() -> None:
    result = _run(text="lorem ipsum dolor", mode="decode", alphabet="nato")
    assert result["status"] == "error"


def test_plugin_info_is_reported() -> None:
    info = _run(text="geo", mode="encode", alphabet="nato")["plugin_info"]
    assert info["name"] == "spelling_alphabet"
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
