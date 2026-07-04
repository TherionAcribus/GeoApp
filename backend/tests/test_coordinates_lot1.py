"""Tests des corrections Lot 1 sur la détection/calcul de coordonnées.

- 1.1 : évaluateur arithmétique sûr (remplacement d'eval())
- 1.2 : normalisation des coordonnées d'origine (dict ou chaîne DDM combinée)
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from gc_backend.blueprints.coordinates import (  # noqa: E402
    _evaluate_math_expression,
    _process_formula_part,
    _normalize_origin_coords,
    _safe_eval_arithmetic,
)


# ─────────────────────────────────────────────────────────────────────────────
# 1.1 — Évaluateur arithmétique sûr
# ─────────────────────────────────────────────────────────────────────────────

class TestSafeEval:
    def test_basic_arithmetic(self):
        assert _safe_eval_arithmetic("8/4") == 2
        assert _safe_eval_arithmetic("2*2*2") == 8
        assert _safe_eval_arithmetic("3+4-1") == 6
        assert _safe_eval_arithmetic("(3+2)*2") == 10
        assert _safe_eval_arithmetic("-5+8") == 3

    def test_power_rejected(self):
        # La puissance est volontairement interdite (pas de bombe 9**9**9)
        with pytest.raises(ValueError):
            _safe_eval_arithmetic("9**9")

    def test_code_injection_rejected(self):
        with pytest.raises(ValueError):
            _safe_eval_arithmetic("__import__('os').system('echo pwned')")

    def test_name_and_call_rejected(self):
        with pytest.raises(ValueError):
            _safe_eval_arithmetic("abs(-3)")
        with pytest.raises(ValueError):
            _safe_eval_arithmetic("x + 1")


class TestEvaluateMathExpression:
    def test_integer_result(self):
        assert _evaluate_math_expression("8/4") == 2
        assert _evaluate_math_expression("2*2*2") == 8

    def test_non_integer_marker(self):
        result = _evaluate_math_expression("8/3")
        assert isinstance(result, str) and result.startswith("ERR:NONINTEGER")

    def test_injection_becomes_syntax_error(self):
        result = _evaluate_math_expression("__import__('os').system('echo pwned')")
        assert isinstance(result, str) and result.startswith("ERR:SYNTAX")

    def test_power_becomes_syntax_error(self):
        result = _evaluate_math_expression("9**9")
        assert isinstance(result, str) and result.startswith("ERR:SYNTAX")

    def test_division_by_zero_is_handled(self):
        result = _evaluate_math_expression("1/0")
        assert isinstance(result, str) and result.startswith("ERR:SYNTAX")

    def test_process_formula_part_still_works(self):
        # Comportement fonctionnel préservé (x -> *)
        assert _process_formula_part("(3x2)", {}) == 6
        assert _process_formula_part("(8/4)(27/9)(2x2x2)", {}) == 238


# ─────────────────────────────────────────────────────────────────────────────
# 1.2 — Normalisation des coordonnées d'origine
# ─────────────────────────────────────────────────────────────────────────────

class TestNormalizeOriginCoords:
    def test_combined_string_north_east(self):
        out = _normalize_origin_coords("N 48° 39.286 E 006° 11.685")
        assert out == {"ddm_lat": "N 48° 39.286", "ddm_lon": "E 006° 11.685"}

    def test_combined_string_preserves_south_west(self):
        out = _normalize_origin_coords("S 33° 51.123 W 151° 12.456")
        assert out["ddm_lat"].startswith("S")
        assert out["ddm_lon"].startswith("W")

    def test_dict_passthrough(self):
        src = {"ddm_lat": "N 48° 39.286", "ddm_lon": "E 006° 11.685"}
        assert _normalize_origin_coords(src) == src

    def test_partial_dict_rejected(self):
        assert _normalize_origin_coords({"ddm_lat": "N 48"}) is None

    def test_invalid_string_returns_none(self):
        assert _normalize_origin_coords("bonjour le monde") is None

    def test_empty_and_none(self):
        assert _normalize_origin_coords("") is None
        assert _normalize_origin_coords(None) is None
