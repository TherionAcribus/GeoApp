"""Tests du plugin télégraphe à cinq aiguilles (Cooke & Wheatstone)."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from main import FiveNeedleTelegraphPlugin  # noqa: E402


def _plugin() -> FiveNeedleTelegraphPlugin:
    return FiveNeedleTelegraphPlugin()


def test_table_integrity():
    p = _plugin()
    # 20 lettres, aucune parmi les 6 omises.
    assert len(p.encode_table) == 20
    assert p.omitted_letters == ["C", "J", "Q", "V", "X", "Z"]
    for letter, code in p.encode_table.items():
        assert len(code) == 5, f"{letter} -> {code!r}"
        assert set(code) <= {"\\", "|", "/"}
        # exactement 3 aiguilles au repos (2 déviées).
        assert code.count("|") == 3, f"{letter} -> {code!r}"
    # bijection encode/decode
    assert len(p.decode_table) == 20


def test_known_vectors():
    p = _plugin()
    assert p.encode_table["A"] == "/|||\\"
    assert p.encode_table["M"] == "\\\\|||"
    assert p.encode_table["Y"] == "\\|||/"


def test_encode_basic():
    p = _plugin()
    out = p.execute({"mode": "encode", "text": "BADGER"})
    assert out["status"] == "ok"
    code = out["results"][0]["text_output"]
    expected = " ".join(p.encode_table[c] for c in "BADGER")
    assert code == expected
    assert out["results"][0]["confidence"] == 1.0


def test_encode_reports_omitted():
    p = _plugin()
    out = p.execute({"mode": "encode", "text": "JAZZ"})
    # J et Z omis, seul A encodé.
    meta = out["results"][0]["metadata"]
    assert set(meta["omitted_letters"]) == {"J", "Z"}
    assert out["results"][0]["text_output"] == p.encode_table["A"]


def test_roundtrip_single_word():
    p = _plugin()
    word = "BADGER"
    enc = p.execute({"mode": "encode", "text": word})["results"][0]["text_output"]
    dec = p.execute({"mode": "decode", "text": enc})["results"][0]["text_output"]
    assert dec == word


def test_roundtrip_multi_word():
    p = _plugin()
    phrase = "BIG RED"  # lettres toutes représentables
    enc = p.execute({"mode": "encode", "text": phrase})["results"][0]["text_output"]
    dec = p.execute({"mode": "decode", "text": enc})["results"][0]["text_output"]
    assert dec == phrase


def test_decode_continuous_stream():
    p = _plugin()
    # HELLO sans séparateurs -> chunké par 5.
    stream = "".join(p.encode_table[c] for c in "HELLO")
    dec = p.execute({"mode": "decode", "text": stream})["results"][0]["text_output"]
    assert dec == "HELLO"


def test_decode_unknown_group_marked():
    p = _plugin()
    bad = "|||||"  # 5 verticales : aucune lettre
    dec = p.execute({"mode": "decode", "text": bad})["results"][0]["text_output"]
    assert dec == "?"


def test_auto_detect_permutations():
    p = _plugin()
    # BADGER encodé puis symboles remplacés : \->a  |->b  /->c
    enc = p.execute({"mode": "encode", "text": "BADGER"})["results"][0]["text_output"]
    swapped = enc.replace("\\", "a").replace("|", "b").replace("/", "c")
    out = p.execute({"mode": "decode", "text": swapped, "auto_detect": True})
    assert out["status"] == "ok"
    decoded = {r["text_output"] for r in out["results"]}
    assert "BADGER" in decoded


def test_auto_detect_wrong_char_count_note():
    p = _plugin()
    out = p.execute({"mode": "decode", "text": "ab ab", "auto_detect": True})
    # 2 caractères distincts -> note d'impossibilité, pas de crash.
    assert out["status"] in {"ok", "error"}


def test_empty_input():
    p = _plugin()
    out = p.execute({"mode": "decode", "text": ""})
    assert out["status"] == "error"


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failures += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failures}/{len(fns)} tests réussis")
    sys.exit(1 if failures else 0)
