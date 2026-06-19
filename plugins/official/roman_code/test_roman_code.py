# -*- coding: utf-8 -*-
"""Tests de caracterisation de roman_code.check_code (strict/embedded)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _plugin():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("roman_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.RomanCodePlugin()


def _frags(result):
    return [(f["value"], f["start"], f["end"]) for f in result["fragments"]]


def test_strict_whole():
    r = _plugin().check_code("XII", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True and _frags(r) == [("XII", 0, 3)]


def test_smooth_per_word():
    r = _plugin().check_code("go XII then IV", strict=False, allowed_chars=None, embedded=False)
    assert _frags(r) == [("XII", 3, 6), ("IV", 12, 14)]


def test_strict_embedded():
    r = _plugin().check_code("go XII then IV", strict=True, allowed_chars=None, embedded=True)
    assert _frags(r) == [("XII", 3, 6), ("IV", 12, 14)]


def test_strict_whole_with_space():
    r = _plugin().check_code("XII IV", strict=True, allowed_chars=None, embedded=False)
    assert _frags(r) == [("XII IV", 0, 6)]


def test_strict_rejects_foreign_char():
    r = _plugin().check_code("XII?", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False and r["fragments"] == []


def test_smooth_preserves_case():
    r = _plugin().check_code("xii", strict=False, allowed_chars=None, embedded=False)
    assert _frags(r) == [("xii", 0, 3)]


def test_strict_rejects_non_roman_word():
    r = _plugin().check_code("hello", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False
