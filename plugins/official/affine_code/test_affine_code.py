"""Tests unitaires pour le plugin affine_code.

Ces tests valident:
- L'encodage/décodage avec des paramètres (a, b)
- Le mode brute_force (retour de plusieurs résultats triés)
"""

from __future__ import annotations

from typing import Any, Dict
from plugins.testing import load_plugin_class


def test_affine_code_encode_decode_roundtrip() -> None:
    AffineCodePlugin = load_plugin_class(__file__)
    plugin = AffineCodePlugin()

    encoded: Dict[str, Any] = plugin.execute({"text": "ABC", "mode": "encode", "a": 5, "b": 8})
    assert encoded["status"] == "ok"
    assert encoded["results"]
    cipher_text = encoded["results"][0]["text_output"]

    decoded: Dict[str, Any] = plugin.execute({"text": cipher_text, "mode": "decode", "a": 5, "b": 8})
    assert decoded["status"] == "ok"
    assert decoded["results"]
    assert decoded["results"][0]["text_output"] == "ABC"


def test_affine_code_bruteforce_returns_sorted_results() -> None:
    AffineCodePlugin = load_plugin_class(__file__)
    plugin = AffineCodePlugin()

    result: Dict[str, Any] = plugin.execute({"text": "IFMMP", "mode": "decode", "brute_force": True})
    assert result["status"] == "ok"
    assert isinstance(result.get("results"), list)
    assert len(result["results"]) > 10

    confidences = [r.get("confidence", 0) for r in result["results"]]
    assert confidences == sorted(confidences, reverse=True)
