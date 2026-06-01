"""Generic grid puzzle solver powered by Z3.

The first public preset is a classic 9x9 Sudoku solver. The internal model is
kept deliberately generic: finite-domain cells, active cell shapes, givens,
regions and declarative constraints. That gives future grid variants a stable
place to plug in without creating a separate plugin family too early.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

try:
    import z3
except Exception:  # pragma: no cover - turned into a user-facing error
    z3 = None


Cell = Tuple[int, int]


CELL_REF_RE = re.compile(r"^r(?P<row>\d+)c(?P<col>\d+)$", re.IGNORECASE)
SEPARATOR_LINE_RE = re.compile(r"^[+\-|=\s]+$")


@dataclass(frozen=True)
class GridConstraint:
    """A small declarative constraint understood by the grid CSP engine."""

    kind: str
    cells: Tuple[Cell, ...] = ()
    value: Optional[str] = None
    total: Optional[int] = None


@dataclass
class GridCspProblem:
    rows: int
    cols: int
    symbols: List[str]
    active_cells: List[Cell]
    givens: Dict[Cell, str] = field(default_factory=dict)
    constraints: List[GridConstraint] = field(default_factory=list)
    numeric_values: Dict[str, int] = field(default_factory=dict)
    variant: str = "custom_spec"


class GridpuzzlesolverPlugin:
    """GeoApp plugin entry point."""

    def __init__(self) -> None:
        self.name = "grid_puzzle_solver"
        self.version = "0.1.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        if z3 is None:
            return self._error_response(
                start_time,
                "La dependance z3-solver est manquante. Installez 'z3-solver' dans l'environnement backend.",
            )

        puzzle_type = str(inputs.get("puzzle_type") or "sudoku_classic").strip().lower()
        max_solutions = self._parse_max_solutions(inputs.get("max_solutions", 2))
        solver_timeout_ms = self._parse_solver_timeout_ms(
            inputs.get("solver_timeout_ms", 10000)
        )
        watched_cells_input = inputs.get("watched_cells") or inputs.get("watch_cells")

        try:
            if puzzle_type in {"sudoku", "sudoku_classic", "classic_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_sudoku_problem(
                    puzzle_text,
                    include_diagonals=False,
                    include_center_dot=False,
                    include_windoku=False,
                    variant="sudoku_classic",
                )
            elif puzzle_type in {"sudoku_x", "x_sudoku", "diagonal_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_sudoku_problem(
                    puzzle_text,
                    include_diagonals=True,
                    include_center_dot=False,
                    include_windoku=False,
                    variant="sudoku_x",
                )
            elif puzzle_type in {"sudoku_center_dot", "center_dot", "centerdot_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_sudoku_problem(
                    puzzle_text,
                    include_diagonals=False,
                    include_center_dot=True,
                    include_windoku=False,
                    variant="sudoku_center_dot",
                )
            elif puzzle_type in {"sudoku_windoku", "windoku", "hyper_sudoku", "four_box_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_sudoku_problem(
                    puzzle_text,
                    include_diagonals=False,
                    include_center_dot=False,
                    include_windoku=True,
                    variant="sudoku_windoku",
                )
            elif puzzle_type in {"custom", "custom_spec", "json_spec"}:
                problem = self._build_custom_problem(inputs.get("spec"))
            else:
                raise ValueError(f"Type de grille non supporte: {puzzle_type}")

            watched_cells = self._parse_watch_cells(
                watched_cells_input,
                problem.rows,
                problem.cols,
                set(problem.active_cells),
            )
            solved = self._solve_problem(problem, max_solutions, solver_timeout_ms)
            return self._success_response(
                start_time,
                problem,
                solved,
                max_solutions,
                solver_timeout_ms,
                watched_cells,
            )
        except Exception as exc:
            return self._error_response(start_time, str(exc), type(exc).__name__)

    # ------------------------------------------------------------------
    # Problem builders
    # ------------------------------------------------------------------

    def _build_sudoku_problem(
        self,
        puzzle_text: str,
        include_diagonals: bool,
        include_center_dot: bool,
        include_windoku: bool,
        variant: str,
    ) -> GridCspProblem:
        symbols = [str(value) for value in range(1, 10)]
        tokens = self._parse_sudoku_tokens(puzzle_text, symbols)

        active_cells = [(row, col) for row in range(9) for col in range(9)]
        givens: Dict[Cell, str] = {}
        for index, token in enumerate(tokens):
            if token in symbols:
                givens[(index // 9, index % 9)] = token

        constraints: List[GridConstraint] = []
        for row in range(9):
            constraints.append(
                GridConstraint("all_different", tuple((row, col) for col in range(9)))
            )
        for col in range(9):
            constraints.append(
                GridConstraint("all_different", tuple((row, col) for row in range(9)))
            )
        for box_row in range(0, 9, 3):
            for box_col in range(0, 9, 3):
                constraints.append(
                    GridConstraint(
                        "all_different",
                        tuple(
                            (row, col)
                            for row in range(box_row, box_row + 3)
                            for col in range(box_col, box_col + 3)
                        ),
                    )
                )

        if include_diagonals:
            constraints.append(
                GridConstraint("all_different", tuple((index, index) for index in range(9)))
            )
            constraints.append(
                GridConstraint("all_different", tuple((index, 8 - index) for index in range(9)))
            )

        if include_center_dot:
            constraints.append(
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in (1, 4, 7) for col in (1, 4, 7)),
                )
            )

        if include_windoku:
            for region_row in (1, 5):
                for region_col in (1, 5):
                    constraints.append(
                        GridConstraint(
                            "all_different",
                            tuple(
                                (row, col)
                                for row in range(region_row, region_row + 3)
                                for col in range(region_col, region_col + 3)
                            ),
                        )
                    )

        return GridCspProblem(
            rows=9,
            cols=9,
            symbols=symbols,
            active_cells=active_cells,
            givens=givens,
            constraints=constraints,
            numeric_values={symbol: int(symbol) for symbol in symbols},
            variant=variant,
        )

    def _build_custom_problem(self, raw_spec: Any) -> GridCspProblem:
        if not raw_spec or not str(raw_spec).strip():
            raise ValueError("La spec JSON est requise pour puzzle_type=custom_spec")

        try:
            spec = json.loads(str(raw_spec))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Spec JSON invalide: {exc.msg}") from exc

        rows = int(spec.get("rows", 0))
        cols = int(spec.get("cols", 0))
        if rows <= 0 or cols <= 0:
            raise ValueError("La spec doit definir rows et cols avec des valeurs positives")

        symbols = [str(symbol) for symbol in spec.get("symbols", [])]
        if not symbols:
            raise ValueError("La spec doit definir une liste non vide de symbols")
        if len(set(symbols)) != len(symbols):
            raise ValueError("Les symbols de la spec doivent etre uniques")

        active_cells = self._parse_active_cells(spec.get("active_cells"), rows, cols)
        givens = self._parse_givens(spec.get("givens", {}), rows, cols, symbols)
        constraints = self._parse_custom_constraints(spec, rows, cols)
        numeric_values = self._parse_numeric_values(spec.get("numeric_values"), symbols)

        return GridCspProblem(
            rows=rows,
            cols=cols,
            symbols=symbols,
            active_cells=active_cells,
            givens=givens,
            constraints=constraints,
            numeric_values=numeric_values,
            variant=str(spec.get("variant") or "custom_spec"),
        )

    # ------------------------------------------------------------------
    # Z3 solving
    # ------------------------------------------------------------------

    def _solve_problem(
        self,
        problem: GridCspProblem,
        max_solutions: int,
        solver_timeout_ms: int,
    ) -> Dict[str, Any]:
        solver = z3.Solver()
        solver.set("timeout", solver_timeout_ms)
        variables = {
            cell: z3.Int(f"r{cell[0] + 1}c{cell[1] + 1}") for cell in problem.active_cells
        }
        active_set = set(problem.active_cells)
        symbol_to_index = {symbol: index for index, symbol in enumerate(problem.symbols)}

        for cell, variable in variables.items():
            solver.add(variable >= 0, variable < len(problem.symbols))

        for cell, symbol in problem.givens.items():
            self._require_active_cell(cell, active_set)
            solver.add(variables[cell] == symbol_to_index[symbol])

        for constraint in problem.constraints:
            self._add_constraint(solver, problem, variables, symbol_to_index, active_set, constraint)

        solutions: List[List[List[Optional[str]]]] = []
        exhausted = False

        while len(solutions) < max_solutions:
            check = solver.check()
            if check == z3.unsat:
                exhausted = True
                break
            if check == z3.unknown:
                raise RuntimeError(f"Z3 n'a pas pu conclure: {solver.reason_unknown()}")

            model = solver.model()
            solution = self._model_to_grid(problem, variables, model)
            solutions.append(solution)

            blocking_terms = [
                variable != model.eval(variable, model_completion=True)
                for variable in variables.values()
            ]
            solver.add(z3.Or(blocking_terms))

        return {
            "solutions": solutions,
            "exhausted": exhausted,
            "truncated": not exhausted and len(solutions) >= max_solutions,
        }

    def _add_constraint(
        self,
        solver: Any,
        problem: GridCspProblem,
        variables: Mapping[Cell, Any],
        symbol_to_index: Mapping[str, int],
        active_set: set,
        constraint: GridConstraint,
    ) -> None:
        kind = constraint.kind.lower()
        cells = tuple(dict.fromkeys(constraint.cells))

        for cell in cells:
            self._require_active_cell(cell, active_set)

        if kind == "all_different":
            if len(cells) > 1:
                solver.add(z3.Distinct(*(variables[cell] for cell in cells)))
            return

        if kind == "equals":
            if len(cells) != 1 or constraint.value is None:
                raise ValueError("La contrainte equals attend une cellule et une valeur")
            if constraint.value not in symbol_to_index:
                raise ValueError(f"Valeur inconnue dans equals: {constraint.value}")
            solver.add(variables[cells[0]] == symbol_to_index[constraint.value])
            return

        if kind == "not_equal":
            if len(cells) < 2:
                raise ValueError("La contrainte not_equal attend au moins deux cellules")
            solver.add(z3.Distinct(*(variables[cell] for cell in cells)))
            return

        if kind == "sum":
            if constraint.total is None:
                raise ValueError("La contrainte sum attend un total")
            solver.add(
                z3.Sum(
                    *(
                        self._numeric_value_expr(
                            variables[cell],
                            problem.symbols,
                            problem.numeric_values,
                        )
                        for cell in cells
                    )
                )
                == constraint.total
            )
            return

        raise ValueError(f"Contrainte non supportee: {constraint.kind}")

    def _numeric_value_expr(
        self,
        variable: Any,
        symbols: Sequence[str],
        numeric_values: Mapping[str, int],
    ) -> Any:
        expr = numeric_values[symbols[-1]]
        for index in range(len(symbols) - 2, -1, -1):
            expr = z3.If(variable == index, numeric_values[symbols[index]], expr)
        return expr

    def _model_to_grid(
        self,
        problem: GridCspProblem,
        variables: Mapping[Cell, Any],
        model: Any,
    ) -> List[List[Optional[str]]]:
        grid: List[List[Optional[str]]] = [
            [None for _ in range(problem.cols)] for _ in range(problem.rows)
        ]
        for cell, variable in variables.items():
            index = model.eval(variable, model_completion=True).as_long()
            grid[cell[0]][cell[1]] = problem.symbols[index]
        return grid

    # ------------------------------------------------------------------
    # Input parsing
    # ------------------------------------------------------------------

    def _parse_sudoku_tokens(self, text: str, symbols: Sequence[str]) -> List[str]:
        if not text or not str(text).strip():
            raise ValueError("Aucune grille Sudoku fournie")

        blank_tokens = {"0", ".", "_"}
        symbol_set = set(symbols)
        tokens: List[str] = []

        for raw_line in str(text).splitlines():
            line = raw_line.strip()
            if not line or SEPARATOR_LINE_RE.fullmatch(line):
                continue
            for char in line:
                if char in symbol_set or char in blank_tokens:
                    tokens.append(char)

        if len(tokens) != 81:
            raise ValueError(
                f"Une grille Sudoku classique doit contenir 81 cases, {len(tokens)} detectees"
            )
        return tokens

    def _parse_active_cells(self, raw_cells: Any, rows: int, cols: int) -> List[Cell]:
        if raw_cells in (None, "", []):
            return [(row, col) for row in range(rows) for col in range(cols)]

        cells = [self._parse_cell_ref(raw_cell, rows, cols) for raw_cell in raw_cells]
        return list(dict.fromkeys(cells))

    def _parse_givens(
        self,
        raw_givens: Any,
        rows: int,
        cols: int,
        symbols: Sequence[str],
    ) -> Dict[Cell, str]:
        symbol_set = set(symbols)
        givens: Dict[Cell, str] = {}

        if isinstance(raw_givens, dict):
            items = raw_givens.items()
            for raw_cell, raw_value in items:
                cell = self._parse_cell_ref(raw_cell, rows, cols)
                value = str(raw_value)
                if value not in symbol_set:
                    raise ValueError(f"Valeur donnee inconnue pour {raw_cell}: {value}")
                givens[cell] = value
            return givens

        if isinstance(raw_givens, list):
            for entry in raw_givens:
                if not isinstance(entry, dict):
                    raise ValueError("Les givens en liste doivent etre des objets")
                cell = self._parse_cell_ref(entry, rows, cols)
                value = str(entry.get("value"))
                if value not in symbol_set:
                    raise ValueError(f"Valeur donnee inconnue pour {entry}: {value}")
                givens[cell] = value
            return givens

        if raw_givens in (None, ""):
            return givens

        raise ValueError("Format givens non supporte")

    def _parse_custom_constraints(
        self,
        spec: Mapping[str, Any],
        rows: int,
        cols: int,
    ) -> List[GridConstraint]:
        constraints: List[GridConstraint] = []

        for raw_region in spec.get("regions", []):
            cells = tuple(self._parse_cell_ref(raw_cell, rows, cols) for raw_cell in raw_region)
            constraints.append(GridConstraint("all_different", cells))

        for raw_constraint in spec.get("constraints", []):
            if not isinstance(raw_constraint, dict):
                raise ValueError("Chaque contrainte doit etre un objet JSON")

            kind = str(raw_constraint.get("type") or raw_constraint.get("kind") or "").lower()
            if not kind:
                raise ValueError("Chaque contrainte doit definir type ou kind")

            raw_cells = raw_constraint.get("cells")
            if raw_cells is None and raw_constraint.get("cell") is not None:
                raw_cells = [raw_constraint.get("cell")]
            if raw_cells is None:
                raise ValueError(f"La contrainte {kind} doit definir cells")

            cells = tuple(self._parse_cell_ref(raw_cell, rows, cols) for raw_cell in raw_cells)
            constraints.append(
                GridConstraint(
                    kind=kind,
                    cells=cells,
                    value=(
                        str(raw_constraint["value"])
                        if "value" in raw_constraint and raw_constraint["value"] is not None
                        else None
                    ),
                    total=(
                        int(raw_constraint["total"])
                        if "total" in raw_constraint and raw_constraint["total"] is not None
                        else None
                    ),
                )
            )

        return constraints

    def _parse_numeric_values(
        self,
        raw_values: Any,
        symbols: Sequence[str],
    ) -> Dict[str, int]:
        if raw_values is None:
            parsed: Dict[str, int] = {}
            for index, symbol in enumerate(symbols, start=1):
                try:
                    parsed[symbol] = int(symbol)
                except ValueError:
                    parsed[symbol] = index
            return parsed

        if isinstance(raw_values, dict):
            parsed = {str(symbol): int(value) for symbol, value in raw_values.items()}
        elif isinstance(raw_values, list):
            if len(raw_values) != len(symbols):
                raise ValueError("numeric_values doit avoir la meme taille que symbols")
            parsed = {
                symbol: int(value)
                for symbol, value in zip(symbols, raw_values)
            }
        else:
            raise ValueError("Format numeric_values non supporte")

        missing = [symbol for symbol in symbols if symbol not in parsed]
        if missing:
            raise ValueError(f"numeric_values incomplet pour: {', '.join(missing)}")
        return parsed

    def _parse_watch_cells(
        self,
        raw_cells: Any,
        rows: int,
        cols: int,
        active_set: set,
    ) -> List[Cell]:
        if raw_cells in (None, "", []):
            return []

        if isinstance(raw_cells, str):
            cell_refs = [
                fragment
                for fragment in re.split(r"[\s;|]+|,(?=\s*r\d+c\d+)", raw_cells.strip())
                if fragment.strip()
            ]
        elif isinstance(raw_cells, list):
            cell_refs = raw_cells
        else:
            raise ValueError("Format watched_cells non supporte")

        cells: List[Cell] = []
        for raw_cell in cell_refs:
            cell = self._parse_cell_ref(raw_cell, rows, cols)
            self._require_active_cell(cell, active_set)
            cells.append(cell)
        return list(dict.fromkeys(cells))

    def _parse_cell_ref(self, raw_cell: Any, rows: int, cols: int) -> Cell:
        if isinstance(raw_cell, str):
            ref = raw_cell.strip()
            match = CELL_REF_RE.match(ref)
            if match:
                cell = (int(match.group("row")) - 1, int(match.group("col")) - 1)
                return self._validate_cell(cell, rows, cols)
            if "," in ref:
                parts = [part.strip() for part in ref.split(",", maxsplit=1)]
                cell = (int(parts[0]), int(parts[1]))
                return self._validate_cell(cell, rows, cols)

        if isinstance(raw_cell, (list, tuple)) and len(raw_cell) == 2:
            cell = (int(raw_cell[0]), int(raw_cell[1]))
            return self._validate_cell(cell, rows, cols)

        if isinstance(raw_cell, dict):
            if "cell" in raw_cell:
                return self._parse_cell_ref(raw_cell["cell"], rows, cols)
            row_key = "row" if "row" in raw_cell else "r"
            col_key = "col" if "col" in raw_cell else "c"
            if row_key in raw_cell and col_key in raw_cell:
                row = int(raw_cell[row_key])
                col = int(raw_cell[col_key])
                base = int(raw_cell.get("base", 1))
                cell = (row - base, col - base)
                return self._validate_cell(cell, rows, cols)

        raise ValueError(f"Reference de cellule invalide: {raw_cell}")

    def _validate_cell(self, cell: Cell, rows: int, cols: int) -> Cell:
        row, col = cell
        if row < 0 or row >= rows or col < 0 or col >= cols:
            raise ValueError(f"Cellule hors grille: r{row + 1}c{col + 1}")
        return cell

    def _require_active_cell(self, cell: Cell, active_set: set) -> None:
        if cell not in active_set:
            raise ValueError(f"Contrainte sur cellule inactive: r{cell[0] + 1}c{cell[1] + 1}")

    def _parse_max_solutions(self, raw_value: Any) -> int:
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            value = 2
        return max(1, min(25, value))

    def _parse_solver_timeout_ms(self, raw_value: Any) -> int:
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            value = 10000
        return max(1000, min(30000, value))

    def _first_non_empty(self, *values: Any) -> str:
        for value in values:
            if value is not None and str(value).strip():
                return str(value)
        return ""

    # ------------------------------------------------------------------
    # Responses
    # ------------------------------------------------------------------

    def _success_response(
        self,
        start_time: float,
        problem: GridCspProblem,
        solved: Mapping[str, Any],
        max_solutions: int,
        solver_timeout_ms: int,
        watched_cells: Sequence[Cell],
    ) -> Dict[str, Any]:
        solutions = list(solved["solutions"])
        exhausted = bool(solved["exhausted"])
        truncated = bool(solved["truncated"])
        unique = len(solutions) == 1 and exhausted

        if not solutions:
            summary = "Aucune solution compatible avec les contraintes"
        elif unique:
            summary = "Grille resolue avec une solution unique"
        elif truncated:
            summary = f"{len(solutions)} solutions trouvees, enumeration arretee a la limite demandee"
        else:
            summary = f"{len(solutions)} solutions trouvees"

        results = []
        for index, grid in enumerate(solutions, start=1):
            watched_values = self._extract_watched_values(grid, watched_cells)
            results.append(
                {
                    "id": f"solution_{index}",
                    "text_output": self._format_grid(grid),
                    "confidence": 1.0,
                    "grid": grid,
                    "watched_values": watched_values,
                    "watched_text": "".join(watched_values.values()),
                    "parameters": {
                        "variant": problem.variant,
                        "rows": problem.rows,
                        "cols": problem.cols,
                        "symbols": problem.symbols,
                    },
                    "metadata": {
                        "solution_index": index,
                        "givens_count": len(problem.givens),
                        "constraint_count": len(problem.constraints),
                    },
                }
            )

        return {
            "status": "ok",
            "summary": summary,
            "results": results,
            "solution_count": len(solutions),
            "unique": unique,
            "truncated": truncated,
            "watched_cells": [self._format_cell_ref(cell) for cell in watched_cells],
            "watched_values": (
                self._extract_watched_values(solutions[0], watched_cells)
                if solutions and watched_cells
                else {}
            ),
            "watched_text": (
                "".join(self._extract_watched_values(solutions[0], watched_cells).values())
                if solutions and watched_cells
                else ""
            ),
            "metadata": {
                "variant": problem.variant,
                "rows": problem.rows,
                "cols": problem.cols,
                "symbols": problem.symbols,
                "givens_count": len(problem.givens),
                "constraint_count": len(problem.constraints),
                "max_solutions": max_solutions,
                "solver_timeout_ms": solver_timeout_ms,
            },
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start_time) * 1000),
            },
        }

    def _extract_watched_values(
        self,
        grid: Sequence[Sequence[Optional[str]]],
        watched_cells: Sequence[Cell],
    ) -> Dict[str, str]:
        values: Dict[str, str] = {}
        for cell in watched_cells:
            value = grid[cell[0]][cell[1]]
            values[self._format_cell_ref(cell)] = value or ""
        return values

    def _format_cell_ref(self, cell: Cell) -> str:
        return f"r{cell[0] + 1}c{cell[1] + 1}"

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

    def _format_grid(self, grid: Sequence[Sequence[Optional[str]]]) -> str:
        return "\n".join(" ".join(value or "." for value in row) for row in grid)


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """PluginManager-compatible functional entry point."""

    return GridpuzzlesolverPlugin().execute(inputs)
