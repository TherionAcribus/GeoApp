# -*- coding: utf-8 -*-
"""Tests de caracterisation de roman_code.check_code (strict/embedded)."""

from __future__ import annotations
from plugins.testing import load_plugin_class



def _frags(result):
    return [(f["value"], f["start"], f["end"]) for f in result["fragments"]]


def test_strict_whole():
    r = load_plugin_class(__file__)().check_code("XII", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True and _frags(r) == [("XII", 0, 3)]


def test_smooth_per_word():
    r = load_plugin_class(__file__)().check_code("go XII then IV", strict=False, allowed_chars=None, embedded=False)
    assert _frags(r) == [("XII", 3, 6), ("IV", 12, 14)]


def test_strict_embedded():
    r = load_plugin_class(__file__)().check_code("go XII then IV", strict=True, allowed_chars=None, embedded=True)
    assert _frags(r) == [("XII", 3, 6), ("IV", 12, 14)]


def test_strict_whole_with_space():
    r = load_plugin_class(__file__)().check_code("XII IV", strict=True, allowed_chars=None, embedded=False)
    assert _frags(r) == [("XII IV", 0, 6)]


def test_strict_rejects_foreign_char():
    r = load_plugin_class(__file__)().check_code("XII?", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False and r["fragments"] == []


def test_smooth_preserves_case():
    r = load_plugin_class(__file__)().check_code("xii", strict=False, allowed_chars=None, embedded=False)
    assert _frags(r) == [("xii", 0, 3)]


def test_strict_rejects_non_roman_word():
    r = load_plugin_class(__file__)().check_code("hello", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False
