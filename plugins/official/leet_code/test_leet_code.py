"""Tests unitaires pour le plugin leet_code.

Ces tests valident :
- L'encodage déterministe texte -> leet
- Le décodage leet -> texte et l'énumération des variantes ambiguës (1 = L/I)
- La conservation des caractères non leet
- La gestion des erreurs (texte vide, mode inconnu, absence de leet)
"""

from __future__ import annotations
from plugins.testing import load_plugin_class



def _outputs(result):
    return [r["text_output"] for r in result["results"]]


def test_encode_basic() -> None:
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    r = plugin.execute({"text": "leet", "mode": "encode"})
    assert r["status"] == "ok"
    assert r["results"][0]["text_output"] == "1337"
    assert r["results"][0]["confidence"] == 1.0

    r = plugin.execute({"text": "elite speak", "mode": "encode"})
    assert r["results"][0]["text_output"] == "31173 5p34k".upper()


def test_encode_leaves_unknown_chars() -> None:
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    r = plugin.execute({"text": "XY 42", "mode": "encode"})
    # X, Y, espace et chiffres ne sont pas dans la table -> conservés.
    assert r["results"][0]["text_output"] == "XY 42"


def test_decode_ambiguous_variants() -> None:
    """'1337' doit produire LEET (parmi les variantes L/I du chiffre 1)."""
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    r = plugin.execute({"text": "1337", "mode": "decode"})
    assert r["status"] == "ok"
    outs = _outputs(r)
    assert "LEET" in outs
    assert "IEET" in outs  # l'autre interprétation du 1


def test_decode_symbols() -> None:
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    # @=A, $=S, +=T -> "CAST" via ( @ 5 7 ? Testons @$+ et #.
    r = plugin.execute({"text": "#3LL0", "mode": "decode"})
    assert "HELLO" in _outputs(r)


def test_decode_roundtrip() -> None:
    """encode puis decode redonne le mot d'origine parmi les variantes."""
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    for word in ("HELLO", "GEOCACHE", "MYSTERY"):
        enc = plugin.execute({"text": word, "mode": "encode"})
        leet = enc["results"][0]["text_output"]
        dec = plugin.execute({"text": leet, "mode": "decode"})
        assert word in _outputs(dec), (word, leet, _outputs(dec))


def test_decode_variant_cap() -> None:
    """Un texte très ambigu ne fait pas exploser le nombre de variantes."""
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    r = plugin.execute({"text": "1" * 20, "mode": "decode"})
    assert r["status"] == "ok"
    # Repli uniforme : au plus une variante par interprétation du 1.
    assert len(r["results"]) <= 2
    outs = _outputs(r)
    assert "L" * 20 in outs
    assert "I" * 20 in outs


def test_default_mode_is_decode() -> None:
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    r = plugin.execute({"text": "1337"})
    assert r["status"] == "ok"
    assert r["results"][0]["parameters"]["mode"] == "decode"


def test_errors() -> None:
    LeetCodePlugin = load_plugin_class(__file__)
    plugin = LeetCodePlugin()

    assert plugin.execute({"text": ""})["status"] == "error"
    assert plugin.execute({"text": "   "})["status"] == "error"
    # Aucun caractère leet -> décodage impossible.
    assert plugin.execute({"text": "WWW", "mode": "decode"})["status"] == "error"
    assert plugin.execute({"text": "abc", "mode": "rot13"})["status"] == "error"


if __name__ == "__main__":
    test_encode_basic()
    test_encode_leaves_unknown_chars()
    test_decode_ambiguous_variants()
    test_decode_symbols()
    test_decode_roundtrip()
    test_decode_variant_cap()
    test_default_mode_is_decode()
    test_errors()
    print("Tous les tests leet_code passent.")
