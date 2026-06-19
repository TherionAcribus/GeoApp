# -*- coding: utf-8 -*-
"""Tests de caracterisation de abaddon_code.check_code / execute.

Verrouille le comportement strict/embedded/allowed_chars avant et apres la
migration vers gc_backend.plugins.code_solving.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("abaddon_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "AbaddonCodePlugin")


O = "\u00fe\u00fe\u00fe"  # 'O'
R = "\u00fe\u00fe\u00b5"  # 'R'


def _frags(result):
    return [(f["value"], f["start"], f["end"]) for f in result["fragments"]]


def test_smooth_extracts_triplets():
    plugin = _load_plugin_class()()
    r = plugin.check_code(O + R, strict=False, allowed_chars=None, embedded=False)
    assert r["is_match"] is True
    assert r["score"] == 1.0
    assert _frags(r) == [(O, 0, 3), (R, 3, 6)]


def test_strict_whole_with_internal_space():
    plugin = _load_plugin_class()()
    text = O + " " + R
    r = plugin.check_code(text, strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True
    assert _frags(r) == [(text, 0, 7)]


def test_strict_embedded_triplets_positions():
    plugin = _load_plugin_class()()
    text = "hi " + O + R + " yo"
    r = plugin.check_code(text, strict=True, allowed_chars=None, embedded=True)
    assert _frags(r) == [(O, 3, 6), (R, 6, 9)]


def test_strict_whole_match_and_full():
    plugin = _load_plugin_class()()
    r = plugin.check_code(O + R, strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True
    assert _frags(r) == [(O + R, 0, 6)]


def test_strict_rejects_partial_triplet():
    plugin = _load_plugin_class()()
    r = plugin.check_code("\u00fe\u00fe\u00fe\u00fe", strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is False
    assert r["fragments"] == []


def test_strict_whole_with_allowed_dot():
    plugin = _load_plugin_class()()
    text = O + "." + R
    r = plugin.check_code(text, strict=True, allowed_chars=None, embedded=False)
    assert r["is_match"] is True
    assert _frags(r) == [(text, 0, 7)]


def test_decode_roundtrip_via_execute():
    plugin = _load_plugin_class()()
    encoded = plugin.execute({"mode": "encode", "text": "OR"})
    cipher = encoded["results"][0]["text_output"]
    decoded = plugin.execute({"mode": "decode", "text": cipher})
    assert decoded["results"][0]["text_output"] == "OR"
