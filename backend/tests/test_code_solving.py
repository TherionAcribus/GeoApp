"""Tests unitaires de la boite a outils partagee `code_solving`."""

from __future__ import annotations

import pytest

from gc_backend.plugins.code_solving import (
    DEFAULT_ALLOWED_CHARS,
    WordCodec,
    coverage_score,
    decode_fragments,
    extract_digit_fragments,
    fixed_width_tokenizer,
    is_strict_digits,
    normalize_allowed_chars,
    parse_bool,
    parse_mode_params,
    split_into_words,
)


# --- params ---------------------------------------------------------------

@pytest.mark.parametrize(
    "value,expected",
    [
        (True, True), (False, False),
        (1, True), (0, False),
        ("true", True), ("1", True), ("yes", True), ("on", True), ("strict", True),
        ("false", False), ("0", False), ("smooth", False), ("nope", False),
    ],
)
def test_parse_bool(value, expected):
    assert parse_bool(value) is expected


def test_parse_bool_none_uses_default():
    assert parse_bool(None) is False
    assert parse_bool(None, default=True) is True


def test_normalize_allowed_chars_default_and_list():
    assert normalize_allowed_chars(None).startswith(DEFAULT_ALLOWED_CHARS)
    assert normalize_allowed_chars("").startswith(DEFAULT_ALLOWED_CHARS)
    assert normalize_allowed_chars([".", ",", "-"]).startswith(".,-")


def test_normalize_allowed_chars_appends_non_breaking():
    out = normalize_allowed_chars(" ")
    assert "\u00a0" in out and "\u202f" in out


def test_parse_mode_params_strict_string_and_bool():
    p1 = parse_mode_params({"mode": "Decode", "strict": "strict", "embedded": "1"})
    assert p1.mode == "decode" and p1.strict is True and p1.embedded is True
    p2 = parse_mode_params({"strict": "smooth", "embedded": False})
    assert p2.strict is False and p2.embedded is False
    assert p2.mode == "decode"


# --- fragments ------------------------------------------------------------

def test_split_into_words_positions():
    frags = split_into_words("AB, CD", " ,")
    assert [(f["value"], f["start"], f["end"]) for f in frags] == [("AB", 0, 2), ("CD", 4, 6)]


def test_split_into_words_repeated_word_positions():
    # Corrige le bug historique base sur text.find(word) (premiere occurrence).
    frags = split_into_words("X X", " ")
    assert [f["start"] for f in frags] == [0, 2]


def test_decode_fragments_handles_length_change():
    text = "12 34"
    frags = [
        {"value": "12", "start": 0, "end": 2},
        {"value": "34", "start": 3, "end": 5},
    ]
    out = decode_fragments(text, frags, lambda v: "A" if v == "12" else "BCD")
    assert out == "A BCD"


def test_coverage_score():
    assert coverage_score("abcd", [{"start": 0, "end": 2}]) == pytest.approx(0.5)
    assert coverage_score("abcd", []) == 0.0


# --- WordCodec : strip_all (type roman_code) ------------------------------

def _roman_valid(token: str) -> bool:
    return bool(token) and all(c in "IVXLCDM" for c in token)


def test_wordcodec_strip_all_strict_match():
    codec = WordCodec(validate_word=_roman_valid, case="upper", charset="IVXLCDM")
    res = codec.check("XII", strict=True, embedded=False, allowed_chars=DEFAULT_ALLOWED_CHARS)
    assert res["is_match"] is True
    assert res["fragments"][0]["value"] == "XII"
    assert res["full_match"] is True


def test_wordcodec_strip_all_strict_rejects_foreign_char():
    codec = WordCodec(validate_word=_roman_valid, case="upper", charset="IVXLCDM")
    res = codec.check("XII?", strict=True, embedded=False, allowed_chars=" ")
    assert res["is_match"] is False


def test_wordcodec_strip_all_embedded():
    codec = WordCodec(validate_word=_roman_valid, case="upper", charset="IVXLCDM")
    res = codec.check("go to XII then", strict=False, embedded=True, allowed_chars=" ")
    values = [f["value"] for f in res["fragments"]]
    assert "XII" in values


# --- WordCodec : fixed_width (type abaddon/kenny triplets) ----------------

def test_wordcodec_fixed_width_triplets():
    table = {"aaa": "A", "bbb": "B"}
    codec = WordCodec(
        validate_word=lambda t: t in table,
        case="lower",
        tokenizer=fixed_width_tokenizer(3),
    )
    res = codec.check("aaabbb", strict=False, embedded=True, allowed_chars=" ")
    assert [f["value"] for f in res["fragments"]] == ["aaa", "bbb"]
    assert [f["start"] for f in res["fragments"]] == [0, 3]


def test_wordcodec_fixed_width_strict_rejects_partial():
    table = {"aaa": "A"}
    codec = WordCodec(
        validate_word=lambda t: t in table,
        case="lower",
        tokenizer=fixed_width_tokenizer(3),
    )
    # longueur non multiple de 3 -> refus en strict
    assert codec.check("aaaa", strict=True, embedded=False, allowed_chars=" ")["is_match"] is False
    assert codec.check("aaa", strict=True, embedded=False, allowed_chars=" ")["is_match"] is True


# --- WordCodec : per_word (type chemical_elements) ------------------------

def test_wordcodec_per_word_all():
    table = {"H": 1, "He": 2, "Na": 11}
    codec = WordCodec(validate_word=lambda w: w in table, strict_mode="per_word", strict_require="all")
    assert codec.check("H Na", strict=True, embedded=False, allowed_chars=" ")["is_match"] is True
    assert codec.check("H Zz", strict=True, embedded=False, allowed_chars=" ")["is_match"] is False


# --- digits (famille B : morbit) ------------------------------------------

def test_extract_digit_fragments_with_internal_separators():
    frags = extract_digit_fragments("12 34 ab 5", digit_chars="123456789", allowed_chars=" ")
    # "12 34" est un seul fragment (separateur interne tolere), "5" trop court
    assert len(frags) == 1
    assert frags[0]["digits"] == "1234"


def test_is_strict_digits():
    ok, _ = is_strict_digits("123 45", digit_chars="123456789", allowed_chars=" ")
    assert ok is True
    bad, reason = is_strict_digits("123x", digit_chars="123456789", allowed_chars=" ")
    assert bad is False and reason
