"""Official plugin: equation_solver.

Solves and simplifies symbolic equation chains with SymPy.
Designed for geocaching formulas, but also supports regular equation systems.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import sympy as sp
    from sympy.parsing.sympy_parser import (
        convert_xor,
        parse_expr,
        standard_transformations,
    )
except Exception:  # pragma: no cover - converted to user-facing error at runtime
    sp = None
    parse_expr = None
    standard_transformations = ()
    convert_xor = None


SEPARATOR_RE = re.compile(r"\s*(?:=>|->|:=|=|:)\s*")
WIDE_GAP_RE = re.compile(r"\t+|\s{3,}")
RESULT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\?$|^\?+$")
HEADER_RE = re.compile(r"^[NSEW](?:\s+[NSEW])*$", re.IGNORECASE)
IDENTIFIER_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
TRANSFORMATIONS = standard_transformations + ((convert_xor,) if convert_xor else ())

KNOWN_NAMES = {
    "Abs",
    "E",
    "I",
    "Max",
    "Min",
    "acos",
    "asin",
    "atan",
    "cos",
    "cosh",
    "deg",
    "exp",
    "ln",
    "log",
    "pi",
    "rad",
    "sin",
    "sinh",
    "sqrt",
    "tan",
    "tanh",
}


@dataclass(frozen=True)
class Assignment:
    name: Any
    expr: Any


@dataclass(frozen=True)
class RequestedResult:
    label: str
    expr: Any


class EquationSolverPlugin:
    """SymPy-backed equation solver plugin."""

    def __init__(self) -> None:
        self.name = "equation_solver"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        if sp is None or parse_expr is None:
            return self._error_response(
                start_time,
                "La dÃ©pendance SymPy est manquante. Installez 'sympy' dans l'environnement backend.",
            )

        equations_text = str(inputs.get("equations") or inputs.get("text") or "")
        if not equations_text.strip():
            return self._error_response(start_time, "Aucune Ã©quation fournie")

        mode = str(inputs.get("mode") or "auto").strip().lower()
        if mode not in {"auto", "simplify", "solve"}:
            mode = "auto"

        try:
            known_values = self._parse_known_values(str(inputs.get("known_values") or ""))
            solve_for = self._parse_symbol_list(str(inputs.get("solve_for") or ""))
            parsed = self._parse_equation_text(equations_text, mode)
            resolved = self._resolve_assignments(parsed["assignments"], known_values)
            requested_results = self._build_requested_results(parsed["requests"], resolved)

            should_solve = mode == "solve" or (
                mode == "auto" and not requested_results and parsed["equations"]
            )
            solved_results = []
            if should_solve:
                solved_results = self._solve_equations(
                    parsed["equations"],
                    known_values,
                    solve_for,
                )

            results = self._format_results(requested_results, solved_results, resolved)
            summary = self._summary(results, requested_results, solved_results)

            return {
                "status": "ok",
                "summary": summary,
                "results": results,
                "assignments": {str(k): str(v) for k, v in resolved.items()},
                "solutions": solved_results,
                "plugin_info": {
                    "name": self.name,
                    "version": self.version,
                    "execution_time_ms": int((time.time() - start_time) * 1000),
                },
            }
        except Exception as exc:
            return self._error_response(start_time, str(exc), type(exc).__name__)

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_equation_text(self, text: str, mode: str) -> Dict[str, Any]:
        assignments: List[Assignment] = []
        requests: List[RequestedResult] = []
        equations: List[Any] = []
        result_index = 1

        for fragment in self._iter_equation_fragments(text):
            assignment, request, equation = self._parse_fragment(fragment, result_index, mode)
            if assignment is not None:
                assignments.append(assignment)
            if request is not None:
                requests.append(request)
                result_index += 1
            if equation is not None:
                equations.append(equation)

        if not assignments and not requests and not equations:
            raise ValueError("Aucune Ã©quation exploitable n'a Ã©tÃ© trouvÃ©e")

        return {
            "assignments": assignments,
            "requests": requests,
            "equations": equations,
        }

    def _iter_equation_fragments(self, text: str) -> Iterable[str]:
        for raw_line in self._normalize_text(text).splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or HEADER_RE.fullmatch(line):
                continue
            for part in self._split_equation_columns(line):
                if self._has_separator(part):
                    yield part

    def _parse_fragment(
        self,
        fragment: str,
        result_index: int,
        mode: str,
    ) -> Tuple[Optional[Assignment], Optional[RequestedResult], Optional[Any]]:
        pieces = [piece.strip() for piece in SEPARATOR_RE.split(fragment, maxsplit=1)]
        if len(pieces) != 2 or not pieces[0] or not pieces[1]:
            raise ValueError(f"Equation illisible: {fragment}")

        left, right = pieces

        if self._is_result_token(left):
            return None, RequestedResult(self._result_label(left, result_index), self._parse_expr(right)), None
        if self._is_result_token(right):
            return None, RequestedResult(self._result_label(right, result_index), self._parse_expr(left)), None

        left_expr = self._parse_expr(left)
        right_expr = self._parse_expr(right)
        equation = sp.Eq(left_expr, right_expr)

        if mode == "solve":
            return None, None, equation

        if isinstance(left_expr, sp.Symbol):
            return Assignment(left_expr, right_expr), None, equation
        if isinstance(right_expr, sp.Symbol):
            return Assignment(right_expr, left_expr), None, equation

        return None, None, equation

    def _parse_expr(self, value: str) -> Any:
        value = self._prepare_expr(value)
        local_dict = self._symbol_dict(value)
        global_dict = self._global_dict()
        return parse_expr(
            value.strip(),
            local_dict=local_dict,
            global_dict=global_dict,
            transformations=TRANSFORMATIONS,
            evaluate=True,
        )

    def _symbol_dict(self, value: str) -> Dict[str, Any]:
        symbols: Dict[str, Any] = {}
        for name in IDENTIFIER_RE.findall(value):
            if name in KNOWN_NAMES:
                continue
            symbols[name] = sp.Symbol(name)
        return symbols

    def _prepare_expr(self, value: str) -> str:
        value = self._normalize_text(value.strip())
        value = re.sub(r"(?<=\d)\s*(?=[A-Za-z_(])", "*", value)
        value = re.sub(r"(?<=\))\s*(?=[A-Za-z_(\d])", "*", value)

        def add_symbol_multiplication(match: re.Match) -> str:
            name = match.group(1)
            if name in KNOWN_NAMES:
                return match.group(0)
            return f"{name}*"

        return re.sub(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=\()", add_symbol_multiplication, value)

    def _global_dict(self) -> Dict[str, Any]:
        return {
            "__builtins__": {},
            "Abs": sp.Abs,
            "Float": sp.Float,
            "E": sp.E,
            "I": sp.I,
            "Integer": sp.Integer,
            "Max": sp.Max,
            "Min": sp.Min,
            "Rational": sp.Rational,
            "Symbol": sp.Symbol,
            "acos": sp.acos,
            "asin": sp.asin,
            "atan": sp.atan,
            "cos": sp.cos,
            "cosh": sp.cosh,
            "deg": sp.pi / 180,
            "exp": sp.exp,
            "ln": sp.log,
            "log": sp.log,
            "pi": sp.pi,
            "rad": 180 / sp.pi,
            "sin": sp.sin,
            "sinh": sp.sinh,
            "sqrt": sp.sqrt,
            "tan": sp.tan,
            "tanh": sp.tanh,
        }

    def _parse_known_values(self, raw: str) -> Dict[Any, Any]:
        if not raw.strip():
            return {}

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None

        if isinstance(data, dict):
            return {
                sp.Symbol(str(name)): self._parse_expr(str(value))
                for name, value in data.items()
            }

        values: Dict[Any, Any] = {}
        for fragment in self._iter_equation_fragments(raw):
            assignment, _, _ = self._parse_fragment(fragment, 1, "simplify")
            if assignment is not None:
                values[assignment.name] = assignment.expr
        if values:
            return values

        raise ValueError("Les valeurs connues doivent Ãªtre en JSON ou sous forme 'variable = valeur'")

    def _parse_symbol_list(self, raw: str) -> List[Any]:
        if not raw.strip():
            return []
        return [sp.Symbol(name) for name in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", raw)]

    # ------------------------------------------------------------------
    # Solving
    # ------------------------------------------------------------------

    def _resolve_assignments(
        self,
        assignments: List[Assignment],
        known_values: Dict[Any, Any],
    ) -> Dict[Any, Any]:
        resolved: Dict[Any, Any] = dict(known_values)

        for assignment in assignments:
            expr = assignment.expr
            for _ in range(len(assignments) + 1):
                next_expr = sp.simplify(expr.subs(resolved))
                if next_expr == expr:
                    break
                expr = next_expr
            resolved[assignment.name] = sp.simplify(expr)

        changed = True
        passes = 0
        while changed and passes <= len(assignments) + 1:
            changed = False
            passes += 1
            for name, expr in list(resolved.items()):
                next_expr = sp.simplify(expr.subs(resolved))
                if next_expr != expr:
                    resolved[name] = next_expr
                    changed = True
        return resolved

    def _build_requested_results(
        self,
        requests: List[RequestedResult],
        resolved: Dict[Any, Any],
    ) -> List[Dict[str, Any]]:
        results = []
        for request in requests:
            expr = sp.simplify(request.expr.subs(resolved))
            free_symbols = sorted(str(symbol) for symbol in expr.free_symbols)
            numeric_value = self._numeric_value(expr) if not free_symbols else None
            results.append(
                {
                    "label": request.label,
                    "expression": expr,
                    "expression_text": str(expr),
                    "value": numeric_value,
                    "free_symbols": free_symbols,
                }
            )
        return results

    def _solve_equations(
        self,
        equations: List[Any],
        known_values: Dict[Any, Any],
        solve_for: List[Any],
    ) -> List[Dict[str, str]]:
        if not equations:
            return []

        substituted = [equation.subs(known_values) for equation in equations]
        variables = solve_for or sorted(
            {symbol for equation in substituted for symbol in equation.free_symbols},
            key=lambda symbol: str(symbol),
        )

        if not variables:
            return []

        solutions = sp.solve(substituted, variables, dict=True)
        formatted: List[Dict[str, str]] = []
        for solution in solutions:
            formatted.append({str(name): str(sp.simplify(value)) for name, value in solution.items()})
        return formatted

    # ------------------------------------------------------------------
    # Formatting
    # ------------------------------------------------------------------

    def _format_results(
        self,
        requested_results: List[Dict[str, Any]],
        solved_results: List[Dict[str, str]],
        resolved: Dict[Any, Any],
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []

        for idx, item in enumerate(requested_results, start=1):
            if item["value"] is None:
                text_output = (
                    f"{item['label']} = {item['expression_text']} "
                    f"(variables libres: {', '.join(item['free_symbols'])})"
                )
            else:
                text_output = f"{item['label']} = {item['value']}"

            results.append(
                {
                    "id": f"result_{idx}",
                    "text_output": text_output,
                    "confidence": 1.0,
                    "parameters": {
                        "label": item["label"],
                        "expression": item["expression_text"],
                        "value": item["value"],
                        "free_symbols": item["free_symbols"],
                    },
                    "metadata": {"kind": "requested_result"},
                }
            )

        offset = len(results)
        for idx, solution in enumerate(solved_results, start=1):
            text_output = ", ".join(f"{name} = {value}" for name, value in solution.items())
            results.append(
                {
                    "id": f"solution_{idx}",
                    "text_output": text_output,
                    "confidence": 1.0,
                    "parameters": {"solution": solution},
                    "metadata": {"kind": "solution"},
                }
            )

        if not results and resolved:
            assignment_items = dict(sorted(
                ((str(k), str(v)) for k, v in resolved.items()),
                key=lambda item: item[0],
            ))
            lines = [f"{name} = {value}" for name, value in assignment_items.items()]
            results.append(
                {
                    "id": f"result_{offset + 1}",
                    "text_output": "\n".join(lines),
                    "confidence": 0.9,
                    "parameters": {"assignments": assignment_items},
                    "metadata": {"kind": "assignments"},
                }
            )

        return results

    def _summary(
        self,
        results: List[Dict[str, Any]],
        requested_results: List[Dict[str, Any]],
        solved_results: List[Dict[str, str]],
    ) -> str:
        if requested_results:
            return f"{len(requested_results)} rÃ©sultat(s) simplifiÃ©(s)"
        if solved_results:
            return f"{len(solved_results)} solution(s) trouvÃ©e(s)"
        if results:
            return "Equations simplifiÃ©es"
        return "Aucune solution trouvÃ©e"

    def _numeric_value(self, expr: Any) -> str:
        if expr.is_number:
            value = sp.N(expr, 14)
            return str(value)
        return str(expr)

    def _error_response(
        self,
        start_time: float,
        message: str,
        error_type: str = "ValueError",
    ) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start_time) * 1000),
            },
            "error": {
                "type": error_type,
                "message": message,
            },
        }

    # ------------------------------------------------------------------
    # Text helpers
    # ------------------------------------------------------------------

    def _normalize_text(self, text: str) -> str:
        replacements = {
            "\u2212": "-",
            "\u2013": "-",
            "\u2014": "-",
            "\u00d7": "*",
            "\u00b7": "*",
            ",": ".",
        }
        for source, target in replacements.items():
            text = text.replace(source, target)
        return text

    def _split_equation_columns(self, line: str) -> List[str]:
        parts = [part.strip() for part in WIDE_GAP_RE.split(line) if part.strip()]
        return parts if len(parts) > 1 else [line.strip()]

    def _has_separator(self, value: str) -> bool:
        return any(separator in value for separator in ("=", "->", "=>", ":"))

    def _is_result_token(self, value: str) -> bool:
        return bool(RESULT_RE.fullmatch(value.strip()))

    def _result_label(self, token: str, fallback_index: int) -> str:
        token = token.strip()
        if token.endswith("?") and token != "?":
            return token[:-1]
        return f"result_{fallback_index}"


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Plugin entry point for the PluginManager."""
    plugin = EquationSolverPlugin()
    return plugin.execute(inputs)
