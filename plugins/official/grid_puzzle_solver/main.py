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
SAMURAI_SUDOKU_OFFSETS: Tuple[Cell, ...] = (
    (0, 0),
    (0, 12),
    (6, 6),
    (12, 0),
    (12, 12),
)
FLOWER_SUDOKU_OFFSETS: Tuple[Cell, ...] = (
    (0, 3),
    (3, 0),
    (3, 3),
    (3, 6),
    (6, 3),
)
SOHEI_SUDOKU_OFFSETS: Tuple[Cell, ...] = (
    (0, 6),
    (6, 0),
    (6, 12),
    (12, 6),
)
KAZAGURUMA_SUDOKU_OFFSETS: Tuple[Cell, ...] = (
    (0, 3),
    (3, 12),
    (6, 6),
    (9, 0),
    (12, 9),
)


@dataclass(frozen=True)
class GridConstraint:
    """A small declarative constraint understood by the grid CSP engine."""

    kind: str
    cells: Tuple[Cell, ...] = ()
    value: Optional[str] = None
    total: Optional[int] = None
    limit: Optional[int] = None
    forbidden_totals: Tuple[int, ...] = ()


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
                    include_girandola=False,
                    include_asterisk=False,
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_x",
                )
            elif puzzle_type in {"sudoku_anti_diagonal", "anti_diagonal_sudoku", "antidiagonal_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=False,
                    include_anti_diagonal=True,
                    variant="sudoku_anti_diagonal",
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
                    include_girandola=False,
                    include_asterisk=False,
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_windoku",
                )
            elif puzzle_type in {"sudoku_girandola", "girandola", "girandole_sudoku"}:
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
                    include_girandola=True,
                    include_asterisk=False,
                    variant="sudoku_girandola",
                )
            elif puzzle_type in {"sudoku_asterisk", "asterisk", "asterisk_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=True,
                    variant="sudoku_asterisk",
                )
            elif puzzle_type in {"sujiken", "sudoku_sujiken", "half_sudoku", "triangular_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_sujiken_problem(puzzle_text)
            elif puzzle_type in {"samurai_sudoku", "samurai", "gattai_5", "gattai5"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_samurai_sudoku_problem(puzzle_text)
            elif puzzle_type in {"flower_sudoku", "flower", "fleur_sudoku", "musketry_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_flower_sudoku_problem(puzzle_text)
            elif puzzle_type in {"sohei_sudoku", "sohei"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_sohei_sudoku_problem(puzzle_text)
            elif puzzle_type in {"kazaguruma_sudoku", "kazaguruma", "windmill_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                problem = self._build_kazaguruma_sudoku_problem(puzzle_text)
            elif puzzle_type in {"sudoku_greater_than", "greater_than", "compdoku", "inequality_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_greater_than",
                    inequalities=inputs.get("inequalities") or inputs.get("comparisons"),
                )
            elif puzzle_type in {"sudoku_rossini", "rossini", "rossini_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_rossini",
                    rossini=inputs.get("rossini") or inputs.get("arrows") or {},
                    include_rossini=True,
                )
            elif puzzle_type in {"sudoku_xv", "xv", "xv_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_xv",
                    xv=inputs.get("xv") or inputs.get("marks") or {},
                    include_xv=True,
                )
            elif puzzle_type in {"sudoku_skyscraper", "skyscraper", "skyscraper_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_skyscraper",
                    skyscraper=inputs.get("skyscraper") or inputs.get("clues") or {},
                    include_skyscraper=True,
                )
            elif puzzle_type in {"sudoku_frame", "frame", "frame_sudoku", "outside_sum_sudoku"}:
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
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_frame",
                    frame=inputs.get("frame") or inputs.get("outside_sums") or {},
                    include_frame=True,
                )
            elif puzzle_type in {"sudoku_godoku", "godoku", "wordoku", "alphabet_sudoku"}:
                puzzle_text = self._first_non_empty(
                    inputs.get("grid"),
                    inputs.get("puzzle"),
                    inputs.get("text"),
                )
                symbols = self._parse_godoku_symbols(
                    inputs.get("alphabet") or inputs.get("symbols"),
                    puzzle_text,
                )
                problem = self._build_sudoku_problem(
                    puzzle_text,
                    include_diagonals=False,
                    include_center_dot=False,
                    include_windoku=False,
                    include_girandola=False,
                    include_asterisk=False,
                    variant="sudoku_godoku",
                    symbols_override=symbols,
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
        include_girandola: bool,
        include_asterisk: bool,
        variant: str,
        inequalities: Any = None,
        include_anti_diagonal: bool = False,
        rossini: Any = None,
        include_rossini: bool = False,
        xv: Any = None,
        include_xv: bool = False,
        skyscraper: Any = None,
        include_skyscraper: bool = False,
        frame: Any = None,
        include_frame: bool = False,
        symbols_override: Optional[Sequence[str]] = None,
    ) -> GridCspProblem:
        symbols = list(symbols_override) if symbols_override is not None else [str(value) for value in range(1, 10)]
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

        if include_anti_diagonal:
            constraints.append(
                GridConstraint("max_distinct", tuple((index, index) for index in range(9)), limit=3)
            )
            constraints.append(
                GridConstraint("max_distinct", tuple((index, 8 - index) for index in range(9)), limit=3)
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

        if include_girandola:
            constraints.append(
                GridConstraint(
                    "all_different",
                    (
                        (0, 0),
                        (0, 8),
                        (1, 4),
                        (4, 1),
                        (4, 4),
                        (4, 7),
                        (7, 4),
                        (8, 0),
                        (8, 8),
                    ),
                )
            )

        if include_asterisk:
            constraints.append(
                GridConstraint(
                    "all_different",
                    (
                        (1, 4),
                        (2, 2),
                        (2, 6),
                        (4, 1),
                        (4, 4),
                        (4, 7),
                        (6, 2),
                        (6, 6),
                        (7, 4),
                    ),
                )
            )

        constraints.extend(self._parse_sudoku_inequalities(inequalities))
        if include_rossini:
            constraints.extend(self._parse_rossini_constraints(rossini))
        if include_xv:
            constraints.extend(self._parse_xv_constraints(xv))
        if include_skyscraper:
            constraints.extend(self._parse_skyscraper_constraints(skyscraper))
        if include_frame:
            constraints.extend(self._parse_frame_constraints(frame))

        return GridCspProblem(
            rows=9,
            cols=9,
            symbols=symbols,
            active_cells=active_cells,
            givens=givens,
            constraints=constraints,
            numeric_values=self._default_numeric_values(symbols),
            variant=variant,
        )

    def _build_sujiken_problem(self, puzzle_text: str) -> GridCspProblem:
        symbols = [str(value) for value in range(1, 10)]
        tokens = self._parse_sujiken_tokens(puzzle_text, symbols)

        active_cells = [(row, col) for row in range(9) for col in range(row + 1)]
        givens: Dict[Cell, str] = {}
        for index, token in enumerate(tokens):
            cell = active_cells[index]
            if token in symbols:
                givens[cell] = token

        constraints: List[GridConstraint] = []

        for row in range(9):
            constraints.append(
                GridConstraint("all_different", tuple((row, col) for col in range(row + 1)))
            )

        for col in range(9):
            constraints.append(
                GridConstraint("all_different", tuple((row, col) for row in range(col, 9)))
            )

        for diagonal in range(9):
            constraints.append(
                GridConstraint(
                    "all_different",
                    tuple((row, row - diagonal) for row in range(diagonal, 9)),
                )
            )

        constraints.extend(
            [
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in range(0, 3) for col in range(row + 1)),
                ),
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in range(3, 6) for col in range(0, 3)),
                ),
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in range(3, 6) for col in range(3, row + 1)),
                ),
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in range(6, 9) for col in range(0, 3)),
                ),
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in range(6, 9) for col in range(3, 6)),
                ),
                GridConstraint(
                    "all_different",
                    tuple((row, col) for row in range(6, 9) for col in range(6, row + 1)),
                ),
            ]
        )

        return GridCspProblem(
            rows=9,
            cols=9,
            symbols=symbols,
            active_cells=active_cells,
            givens=givens,
            constraints=constraints,
            numeric_values={symbol: int(symbol) for symbol in symbols},
            variant="sujiken",
        )

    def _build_samurai_sudoku_problem(self, puzzle_text: str) -> GridCspProblem:
        return self._build_composite_sudoku_problem(
            puzzle_text,
            offsets=SAMURAI_SUDOKU_OFFSETS,
            rows=21,
            cols=21,
            variant="samurai_sudoku",
            label="Samurai Sudoku",
        )

    def _build_flower_sudoku_problem(self, puzzle_text: str) -> GridCspProblem:
        return self._build_composite_sudoku_problem(
            puzzle_text,
            offsets=FLOWER_SUDOKU_OFFSETS,
            rows=15,
            cols=15,
            variant="flower_sudoku",
            label="Flower Sudoku",
        )

    def _build_sohei_sudoku_problem(self, puzzle_text: str) -> GridCspProblem:
        return self._build_composite_sudoku_problem(
            puzzle_text,
            offsets=SOHEI_SUDOKU_OFFSETS,
            rows=21,
            cols=21,
            variant="sohei_sudoku",
            label="Sohei Sudoku",
        )

    def _build_kazaguruma_sudoku_problem(self, puzzle_text: str) -> GridCspProblem:
        return self._build_composite_sudoku_problem(
            puzzle_text,
            offsets=KAZAGURUMA_SUDOKU_OFFSETS,
            rows=21,
            cols=21,
            variant="kazaguruma_sudoku",
            label="Kazaguruma Sudoku",
        )

    def _build_composite_sudoku_problem(
        self,
        puzzle_text: str,
        offsets: Sequence[Cell],
        rows: int,
        cols: int,
        variant: str,
        label: str,
    ) -> GridCspProblem:
        symbols = [str(value) for value in range(1, 10)]
        active_cells = self._composite_active_cells(offsets)
        givens = self._parse_composite_sudoku_tokens(
            puzzle_text,
            symbols,
            active_cells,
            rows,
            cols,
            label,
        )

        constraints: List[GridConstraint] = []
        for offset_row, offset_col in offsets:
            for local_row in range(9):
                constraints.append(
                    GridConstraint(
                        "all_different",
                        tuple((offset_row + local_row, offset_col + local_col) for local_col in range(9)),
                    )
                )
            for local_col in range(9):
                constraints.append(
                    GridConstraint(
                        "all_different",
                        tuple((offset_row + local_row, offset_col + local_col) for local_row in range(9)),
                    )
                )
            for box_row in range(0, 9, 3):
                for box_col in range(0, 9, 3):
                    constraints.append(
                        GridConstraint(
                            "all_different",
                            tuple(
                                (offset_row + local_row, offset_col + local_col)
                                for local_row in range(box_row, box_row + 3)
                                for local_col in range(box_col, box_col + 3)
                            ),
                        )
                    )

        return GridCspProblem(
            rows=rows,
            cols=cols,
            symbols=symbols,
            active_cells=active_cells,
            givens=givens,
            constraints=constraints,
            numeric_values={symbol: int(symbol) for symbol in symbols},
            variant=variant,
        )

    def _samurai_active_cells(self) -> List[Cell]:
        return self._composite_active_cells(SAMURAI_SUDOKU_OFFSETS)

    def _flower_active_cells(self) -> List[Cell]:
        return self._composite_active_cells(FLOWER_SUDOKU_OFFSETS)

    def _sohei_active_cells(self) -> List[Cell]:
        return self._composite_active_cells(SOHEI_SUDOKU_OFFSETS)

    def _kazaguruma_active_cells(self) -> List[Cell]:
        return self._composite_active_cells(KAZAGURUMA_SUDOKU_OFFSETS)

    def _composite_active_cells(self, offsets: Sequence[Cell]) -> List[Cell]:
        cells = {
            (offset_row + local_row, offset_col + local_col)
            for offset_row, offset_col in offsets
            for local_row in range(9)
            for local_col in range(9)
        }
        return sorted(cells)

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

        if kind == "max_distinct":
            if constraint.limit is None or constraint.limit < 1:
                raise ValueError("La contrainte max_distinct attend une limite positive")
            if len(cells) > 1:
                solver.add(
                    z3.Sum(
                        *(
                            z3.If(
                                z3.Or(*(variables[cell] == symbol_index for cell in cells)),
                                1,
                                0,
                            )
                            for symbol_index in range(len(problem.symbols))
                        )
                    )
                    <= constraint.limit
                )
            return

        if kind in {"strict_increasing", "strict_decreasing", "not_monotonic"}:
            if len(cells) != 3:
                raise ValueError(f"La contrainte {kind} attend exactement trois cellules")
            first, second, third = (variables[cell] for cell in cells)
            increasing = z3.And(first < second, second < third)
            decreasing = z3.And(first > second, second > third)
            if kind == "strict_increasing":
                solver.add(increasing)
            elif kind == "strict_decreasing":
                solver.add(decreasing)
            else:
                solver.add(z3.Not(z3.Or(increasing, decreasing)))
            return

        if kind == "visible_count":
            if constraint.total is None or constraint.total < 1:
                raise ValueError("La contrainte visible_count attend un total positif")
            if len(cells) < 1:
                raise ValueError("La contrainte visible_count attend au moins une cellule")
            heights = [
                self._numeric_value_expr(
                    variables[cell],
                    problem.symbols,
                    problem.numeric_values,
                )
                for cell in cells
            ]
            visible_terms = []
            for index, height in enumerate(heights):
                if index == 0:
                    visible_terms.append(1)
                else:
                    visible_terms.append(z3.If(z3.And(*(height > previous for previous in heights[:index])), 1, 0))
            solver.add(z3.Sum(*visible_terms) == constraint.total)
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

        if kind in {"sum_not_in", "sum_not_equal"}:
            if len(cells) < 1 or not constraint.forbidden_totals:
                raise ValueError("La contrainte sum_not_in attend des cellules et des totaux interdits")
            total_expr = z3.Sum(
                *(
                    self._numeric_value_expr(
                        variables[cell],
                        problem.symbols,
                        problem.numeric_values,
                    )
                    for cell in cells
                )
            )
            solver.add(z3.And(*(total_expr != total for total in constraint.forbidden_totals)))
            return

        if kind in {"greater_than", "gt"}:
            if len(cells) != 2:
                raise ValueError("La contrainte greater_than attend deux cellules")
            solver.add(
                self._numeric_value_expr(variables[cells[0]], problem.symbols, problem.numeric_values)
                > self._numeric_value_expr(variables[cells[1]], problem.symbols, problem.numeric_values)
            )
            return

        if kind in {"less_than", "lt"}:
            if len(cells) != 2:
                raise ValueError("La contrainte less_than attend deux cellules")
            solver.add(
                self._numeric_value_expr(variables[cells[0]], problem.symbols, problem.numeric_values)
                < self._numeric_value_expr(variables[cells[1]], problem.symbols, problem.numeric_values)
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

    def _default_numeric_values(self, symbols: Sequence[str]) -> Dict[str, int]:
        values: Dict[str, int] = {}
        for index, symbol in enumerate(symbols, start=1):
            values[symbol] = int(symbol) if str(symbol).isdigit() else index
        return values

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

    def _parse_sudoku_inequalities(self, raw_inequalities: Any) -> List[GridConstraint]:
        if raw_inequalities in (None, "", [], {}):
            return []

        if isinstance(raw_inequalities, str):
            text = raw_inequalities.strip()
            if not text:
                return []
            try:
                raw_inequalities = json.loads(text)
            except json.JSONDecodeError:
                return self._parse_inequality_lines(text)

        if isinstance(raw_inequalities, dict):
            constraints: List[GridConstraint] = []
            constraints.extend(
                self._parse_inequality_matrix(
                    raw_inequalities.get("horizontal") or raw_inequalities.get("h"),
                    rows=9,
                    cols=8,
                    first_cell=lambda row, col: (row, col),
                    second_cell=lambda row, col: (row, col + 1),
                    label="horizontal",
                )
            )
            constraints.extend(
                self._parse_inequality_matrix(
                    raw_inequalities.get("vertical") or raw_inequalities.get("v"),
                    rows=8,
                    cols=9,
                    first_cell=lambda row, col: (row, col),
                    second_cell=lambda row, col: (row + 1, col),
                    label="vertical",
                )
            )
            if "constraints" in raw_inequalities:
                constraints.extend(self._parse_inequality_entries(raw_inequalities["constraints"]))
            return constraints

        if isinstance(raw_inequalities, list):
            return self._parse_inequality_entries(raw_inequalities)

        raise ValueError("Format inequalities non supporte")

    def _parse_inequality_matrix(
        self,
        raw_matrix: Any,
        rows: int,
        cols: int,
        first_cell: Any,
        second_cell: Any,
        label: str,
    ) -> List[GridConstraint]:
        if raw_matrix in (None, "", []):
            return []
        if not isinstance(raw_matrix, list) or len(raw_matrix) != rows:
            raise ValueError(f"inequalities.{label} doit contenir {rows} lignes")

        constraints: List[GridConstraint] = []
        for row_index, raw_row in enumerate(raw_matrix):
            if isinstance(raw_row, str):
                values = [char for char in raw_row if char in {"<", ">", ".", "0", "_", "-"}]
            elif isinstance(raw_row, list):
                values = [str(value or "") for value in raw_row]
            else:
                raise ValueError(f"inequalities.{label}[{row_index}] doit etre une liste ou une chaine")

            if len(values) != cols:
                raise ValueError(f"inequalities.{label}[{row_index}] doit contenir {cols} valeurs")

            for col_index, relation in enumerate(values):
                relation = relation.strip()
                if relation in {"", ".", "0", "_", "-"}:
                    continue
                constraints.append(
                    self._build_inequality_constraint(
                        first_cell(row_index, col_index),
                        second_cell(row_index, col_index),
                        relation,
                    )
                )
        return constraints

    def _parse_inequality_entries(self, raw_entries: Any) -> List[GridConstraint]:
        if raw_entries in (None, "", []):
            return []
        if not isinstance(raw_entries, list):
            raise ValueError("Les inequalities en liste doivent etre une liste d'objets")

        constraints: List[GridConstraint] = []
        for entry in raw_entries:
            if not isinstance(entry, dict):
                raise ValueError("Chaque inequality doit etre un objet")

            relation = str(
                entry.get("relation")
                or entry.get("operator")
                or entry.get("op")
                or entry.get("symbol")
                or ""
            ).strip()
            raw_cells = entry.get("cells")
            if raw_cells is None:
                raw_cells = [entry.get("from") or entry.get("cell_a") or entry.get("a"), entry.get("to") or entry.get("cell_b") or entry.get("b")]
            if not isinstance(raw_cells, list) or len(raw_cells) != 2:
                raise ValueError("Chaque inequality doit definir deux cellules")

            constraints.append(
                self._build_inequality_constraint(
                    self._parse_cell_ref(raw_cells[0], 9, 9),
                    self._parse_cell_ref(raw_cells[1], 9, 9),
                    relation,
                )
            )
        return constraints

    def _parse_inequality_lines(self, text: str) -> List[GridConstraint]:
        constraints: List[GridConstraint] = []
        for line in text.splitlines():
            normalized = line.strip().replace(" ", "")
            if not normalized:
                continue
            match = re.fullmatch(r"(r\d+c\d+)([<>])(r\d+c\d+)", normalized, re.IGNORECASE)
            if not match:
                raise ValueError(f"Inegalite invalide: {line}")
            constraints.append(
                self._build_inequality_constraint(
                    self._parse_cell_ref(match.group(1), 9, 9),
                    self._parse_cell_ref(match.group(3), 9, 9),
                    match.group(2),
                )
            )
        return constraints

    def _build_inequality_constraint(self, first_cell: Cell, second_cell: Cell, relation: str) -> GridConstraint:
        self._validate_adjacent_cells(first_cell, second_cell)
        if relation == ">":
            return GridConstraint("greater_than", (first_cell, second_cell))
        if relation == "<":
            return GridConstraint("less_than", (first_cell, second_cell))
        raise ValueError(f"Symbole d'inegalite non supporte: {relation}")

    def _parse_xv_constraints(self, raw_xv: Any) -> List[GridConstraint]:
        enforce_absent = True
        if raw_xv in (None, "", []):
            raw_xv = {}
        if isinstance(raw_xv, str):
            text = raw_xv.strip()
            if text:
                try:
                    raw_xv = json.loads(text)
                except json.JSONDecodeError:
                    return self._parse_xv_lines(text)
            else:
                raw_xv = {}
        if not isinstance(raw_xv, dict):
            if isinstance(raw_xv, list):
                return self._parse_xv_entries(raw_xv)
            raise ValueError("Format xv non supporte")

        if "enforce_absent" in raw_xv:
            enforce_absent = bool(raw_xv.get("enforce_absent"))
        elif "all_marks_given" in raw_xv:
            enforce_absent = bool(raw_xv.get("all_marks_given"))

        constraints: List[GridConstraint] = []
        has_matrix = any(key in raw_xv for key in ("horizontal", "h", "vertical", "v"))
        if has_matrix or "constraints" not in raw_xv:
            constraints.extend(
                self._parse_xv_matrix(
                    raw_xv.get("horizontal") or raw_xv.get("h"),
                    rows=9,
                    cols=8,
                    first_cell=lambda row, col: (row, col),
                    second_cell=lambda row, col: (row, col + 1),
                    label="horizontal",
                    enforce_absent=enforce_absent,
                )
            )
            constraints.extend(
                self._parse_xv_matrix(
                    raw_xv.get("vertical") or raw_xv.get("v"),
                    rows=8,
                    cols=9,
                    first_cell=lambda row, col: (row, col),
                    second_cell=lambda row, col: (row + 1, col),
                    label="vertical",
                    enforce_absent=enforce_absent,
                )
            )
        if "constraints" in raw_xv:
            constraints.extend(self._parse_xv_entries(raw_xv["constraints"]))
        return constraints

    def _parse_xv_matrix(
        self,
        raw_matrix: Any,
        rows: int,
        cols: int,
        first_cell: Any,
        second_cell: Any,
        label: str,
        enforce_absent: bool,
    ) -> List[GridConstraint]:
        if raw_matrix in (None, ""):
            raw_matrix = ["." * cols for _ in range(rows)]
        if not isinstance(raw_matrix, list) or len(raw_matrix) != rows:
            raise ValueError(f"xv.{label} doit contenir {rows} lignes")

        constraints: List[GridConstraint] = []
        for row_index, raw_row in enumerate(raw_matrix):
            if isinstance(raw_row, str):
                values = [char for char in raw_row if char.upper() in {"X", "V"} or char in {".", "0", "_", "-"}]
            elif isinstance(raw_row, list):
                values = [str(value or "") for value in raw_row]
            else:
                raise ValueError(f"xv.{label}[{row_index}] doit etre une liste ou une chaine")

            if len(values) != cols:
                raise ValueError(f"xv.{label}[{row_index}] doit contenir {cols} valeurs")

            for col_index, symbol in enumerate(values):
                constraints.append(
                    self._build_xv_constraint(
                        first_cell(row_index, col_index),
                        second_cell(row_index, col_index),
                        symbol,
                        enforce_absent,
                    )
                )
        return [constraint for constraint in constraints if constraint is not None]

    def _parse_xv_entries(self, raw_entries: Any) -> List[GridConstraint]:
        if raw_entries in (None, "", []):
            return []
        if not isinstance(raw_entries, list):
            raise ValueError("Les contraintes XV en liste doivent etre une liste d'objets")

        constraints: List[GridConstraint] = []
        for entry in raw_entries:
            if not isinstance(entry, dict):
                raise ValueError("Chaque contrainte XV doit etre un objet")
            symbol = str(
                entry.get("symbol")
                or entry.get("mark")
                or entry.get("value")
                or ""
            ).strip()
            raw_cells = entry.get("cells")
            if raw_cells is None:
                raw_cells = [entry.get("from") or entry.get("cell_a") or entry.get("a"), entry.get("to") or entry.get("cell_b") or entry.get("b")]
            if not isinstance(raw_cells, list) or len(raw_cells) != 2:
                raise ValueError("Chaque contrainte XV doit definir deux cellules")

            constraint = self._build_xv_constraint(
                self._parse_cell_ref(raw_cells[0], 9, 9),
                self._parse_cell_ref(raw_cells[1], 9, 9),
                symbol,
                enforce_absent=False,
            )
            if constraint is not None:
                constraints.append(constraint)
        return constraints

    def _parse_xv_lines(self, text: str) -> List[GridConstraint]:
        constraints: List[GridConstraint] = []
        for line in text.splitlines():
            normalized = line.strip().replace(" ", "")
            if not normalized:
                continue
            match = re.fullmatch(r"(r\d+c\d+)([XVxv])(r\d+c\d+)", normalized, re.IGNORECASE)
            if not match:
                raise ValueError(f"Contrainte XV invalide: {line}")
            constraint = self._build_xv_constraint(
                self._parse_cell_ref(match.group(1), 9, 9),
                self._parse_cell_ref(match.group(3), 9, 9),
                match.group(2),
                enforce_absent=False,
            )
            if constraint is not None:
                constraints.append(constraint)
        return constraints

    def _build_xv_constraint(
        self,
        first_cell: Cell,
        second_cell: Cell,
        symbol: str,
        enforce_absent: bool,
    ) -> Optional[GridConstraint]:
        self._validate_adjacent_cells(first_cell, second_cell)
        normalized = str(symbol or "").strip().upper()
        if normalized == "X":
            return GridConstraint("sum", (first_cell, second_cell), total=10)
        if normalized == "V":
            return GridConstraint("sum", (first_cell, second_cell), total=5)
        if normalized in {"", ".", "0", "_", "-"}:
            if enforce_absent:
                return GridConstraint("sum_not_in", (first_cell, second_cell), forbidden_totals=(5, 10))
            return None
        raise ValueError(f"Symbole XV non supporte: {symbol}")

    def _parse_skyscraper_constraints(self, raw_skyscraper: Any) -> List[GridConstraint]:
        if raw_skyscraper in (None, "", []):
            raw_skyscraper = {}
        if isinstance(raw_skyscraper, str):
            text = raw_skyscraper.strip()
            if text:
                try:
                    raw_skyscraper = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Skyscraper JSON invalide: {exc.msg}") from exc
            else:
                raw_skyscraper = {}
        if not isinstance(raw_skyscraper, dict):
            raise ValueError("Format skyscraper non supporte")

        side_specs = (
            ("top", raw_skyscraper.get("top") or raw_skyscraper.get("t")),
            ("bottom", raw_skyscraper.get("bottom") or raw_skyscraper.get("b")),
            ("left", raw_skyscraper.get("left") or raw_skyscraper.get("l")),
            ("right", raw_skyscraper.get("right") or raw_skyscraper.get("r")),
        )

        constraints: List[GridConstraint] = []
        for side, raw_values in side_specs:
            values = self._parse_skyscraper_side(raw_values, side)
            for index, clue in enumerate(values):
                if clue is None:
                    continue
                constraints.append(
                    GridConstraint("visible_count", self._skyscraper_cells(side, index), total=clue)
                )
        return constraints

    def _parse_skyscraper_side(self, raw_values: Any, side: str) -> List[Optional[int]]:
        if raw_values in (None, ""):
            return [None] * 9
        if isinstance(raw_values, str):
            values = [char for char in raw_values if char in {"1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "_", "-", "?"}]
        elif isinstance(raw_values, list):
            values = list(raw_values)
        else:
            raise ValueError(f"skyscraper.{side} doit etre une liste ou une chaine")

        if len(values) != 9:
            raise ValueError(f"skyscraper.{side} doit contenir 9 valeurs")

        parsed: List[Optional[int]] = []
        for raw_value in values:
            text = str(raw_value or "").strip()
            if text in {"", ".", "0", "_", "-", "?"}:
                parsed.append(None)
                continue
            clue = int(text) if text.isdigit() else 0
            if clue < 1 or clue > 9:
                raise ValueError(f"Indice Skyscraper non supporte sur {side}: {raw_value}")
            parsed.append(clue)
        return parsed

    def _skyscraper_cells(self, side: str, index: int) -> Tuple[Cell, ...]:
        if side == "left":
            return tuple((index, col) for col in range(9))
        if side == "right":
            return tuple((index, col) for col in range(8, -1, -1))
        if side == "top":
            return tuple((row, index) for row in range(9))
        if side == "bottom":
            return tuple((row, index) for row in range(8, -1, -1))
        raise ValueError(f"Cote Skyscraper inconnu: {side}")

    def _parse_frame_constraints(self, raw_frame: Any) -> List[GridConstraint]:
        if raw_frame in (None, "", []):
            raw_frame = {}
        if isinstance(raw_frame, str):
            text = raw_frame.strip()
            if text:
                try:
                    raw_frame = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Frame JSON invalide: {exc.msg}") from exc
            else:
                raw_frame = {}
        if not isinstance(raw_frame, dict):
            raise ValueError("Format frame non supporte")

        side_specs = (
            ("top", raw_frame.get("top") or raw_frame.get("t")),
            ("bottom", raw_frame.get("bottom") or raw_frame.get("b")),
            ("left", raw_frame.get("left") or raw_frame.get("l")),
            ("right", raw_frame.get("right") or raw_frame.get("r")),
        )

        constraints: List[GridConstraint] = []
        for side, raw_values in side_specs:
            values = self._parse_frame_side(raw_values, side)
            for index, clue in enumerate(values):
                if clue is None:
                    continue
                constraints.append(
                    GridConstraint("sum", self._frame_cells(side, index), total=clue)
                )
        return constraints

    def _parse_frame_side(self, raw_values: Any, side: str) -> List[Optional[int]]:
        if raw_values in (None, ""):
            return [None] * 9
        if isinstance(raw_values, str):
            values = [
                value for value in re.split(r"[\s,;|]+", raw_values.strip())
                if value
            ]
            if len(values) == 1 and len(values[0]) == 9 and values[0].isdigit():
                values = list(values[0])
        elif isinstance(raw_values, list):
            values = list(raw_values)
        else:
            raise ValueError(f"frame.{side} doit etre une liste ou une chaine")

        if len(values) != 9:
            raise ValueError(f"frame.{side} doit contenir 9 valeurs")

        parsed: List[Optional[int]] = []
        for raw_value in values:
            text = str(raw_value or "").strip()
            if text in {"", ".", "0", "_", "-", "?"}:
                parsed.append(None)
                continue
            clue = int(text) if text.isdigit() else 0
            if clue < 1 or clue > 27:
                raise ValueError(f"Somme Frame non supportee sur {side}: {raw_value}")
            parsed.append(clue)
        return parsed

    def _frame_cells(self, side: str, index: int) -> Tuple[Cell, Cell, Cell]:
        if side == "left":
            return ((index, 0), (index, 1), (index, 2))
        if side == "right":
            return ((index, 6), (index, 7), (index, 8))
        if side == "top":
            return ((0, index), (1, index), (2, index))
        if side == "bottom":
            return ((6, index), (7, index), (8, index))
        raise ValueError(f"Cote Frame inconnu: {side}")

    def _parse_rossini_constraints(self, raw_rossini: Any) -> List[GridConstraint]:
        enforce_absent = True
        if raw_rossini in (None, "", []):
            raw_rossini = {}
        if isinstance(raw_rossini, str):
            text = raw_rossini.strip()
            if text:
                try:
                    raw_rossini = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Rossini JSON invalide: {exc.msg}") from exc
            else:
                raw_rossini = {}
        if not isinstance(raw_rossini, dict):
            raise ValueError("Format rossini non supporte")

        if "enforce_absent" in raw_rossini:
            enforce_absent = bool(raw_rossini.get("enforce_absent"))
        elif "all_arrows_given" in raw_rossini:
            enforce_absent = bool(raw_rossini.get("all_arrows_given"))

        side_specs = (
            ("top", raw_rossini.get("top") or raw_rossini.get("t"), "vertical"),
            ("bottom", raw_rossini.get("bottom") or raw_rossini.get("b"), "vertical"),
            ("left", raw_rossini.get("left") or raw_rossini.get("l"), "horizontal"),
            ("right", raw_rossini.get("right") or raw_rossini.get("r"), "horizontal"),
        )

        constraints: List[GridConstraint] = []
        for side, raw_values, axis in side_specs:
            values = self._parse_rossini_side(raw_values, side)
            for index, raw_arrow in enumerate(values):
                arrow = self._normalize_rossini_arrow(raw_arrow, axis, side)
                cells = self._rossini_cells(side, index)
                if arrow in {"right", "down"}:
                    constraints.append(GridConstraint("strict_increasing", cells))
                elif arrow in {"left", "up"}:
                    constraints.append(GridConstraint("strict_decreasing", cells))
                elif enforce_absent:
                    constraints.append(GridConstraint("not_monotonic", cells))
        return constraints

    def _parse_rossini_side(self, raw_values: Any, side: str) -> List[str]:
        if raw_values in (None, ""):
            return [""] * 9
        if isinstance(raw_values, str):
            values = [
                char for char in raw_values
                if char in {"<", ">", "^", "v", "V", "U", "D", "L", "R", "↑", "↓", "←", "→", ".", "0", "_", "-", "?"}
            ]
        elif isinstance(raw_values, list):
            values = [str(value or "") for value in raw_values]
        else:
            raise ValueError(f"rossini.{side} doit etre une liste ou une chaine")
        if len(values) != 9:
            raise ValueError(f"rossini.{side} doit contenir 9 valeurs")
        return values

    def _normalize_rossini_arrow(self, raw_arrow: str, axis: str, side: str) -> str:
        arrow = str(raw_arrow or "").strip()
        if arrow in {"", ".", "0", "_", "-", "?"}:
            return ""
        normalized = {
            ">": "right",
            "R": "right",
            "r": "right",
            "→": "right",
            "<": "left",
            "L": "left",
            "l": "left",
            "←": "left",
            "^": "up",
            "U": "up",
            "u": "up",
            "↑": "up",
            "v": "down",
            "V": "down",
            "D": "down",
            "d": "down",
            "↓": "down",
        }.get(arrow)
        if normalized is None:
            raise ValueError(f"Fleche Rossini non supportee sur {side}: {raw_arrow}")
        if axis == "horizontal" and normalized not in {"left", "right"}:
            raise ValueError(f"rossini.{side} attend des fleches gauche/droite")
        if axis == "vertical" and normalized not in {"up", "down"}:
            raise ValueError(f"rossini.{side} attend des fleches haut/bas")
        return normalized

    def _rossini_cells(self, side: str, index: int) -> Tuple[Cell, Cell, Cell]:
        if side == "left":
            return ((index, 0), (index, 1), (index, 2))
        if side == "right":
            return ((index, 6), (index, 7), (index, 8))
        if side == "top":
            return ((0, index), (1, index), (2, index))
        if side == "bottom":
            return ((6, index), (7, index), (8, index))
        raise ValueError(f"Cote Rossini inconnu: {side}")

    def _validate_adjacent_cells(self, first_cell: Cell, second_cell: Cell) -> None:
        distance = abs(first_cell[0] - second_cell[0]) + abs(first_cell[1] - second_cell[1])
        if distance != 1:
            raise ValueError(
                "Les contraintes d'inegalite Sudoku doivent relier deux cellules adjacentes"
            )

    def _parse_sudoku_tokens(self, text: str, symbols: Sequence[str]) -> List[str]:
        if not text or not str(text).strip():
            raise ValueError("Aucune grille Sudoku fournie")

        blank_tokens = {"0", ".", "_"}
        symbol_by_upper = {str(symbol).upper(): str(symbol) for symbol in symbols}
        tokens: List[str] = []

        for raw_line in str(text).splitlines():
            line = raw_line.strip()
            if not line or SEPARATOR_LINE_RE.fullmatch(line):
                continue
            for char in line:
                normalized_symbol = symbol_by_upper.get(char.upper())
                if normalized_symbol is not None:
                    tokens.append(normalized_symbol)
                elif char in blank_tokens:
                    tokens.append(char)

        if len(tokens) != 81:
            raise ValueError(
                f"Une grille Sudoku classique doit contenir 81 cases, {len(tokens)} detectees"
            )
        return tokens

    def _parse_godoku_symbols(self, raw_symbols: Any, puzzle_text: str) -> List[str]:
        if raw_symbols not in (None, "", []):
            if isinstance(raw_symbols, list):
                symbols = [str(symbol).strip().upper() for symbol in raw_symbols if str(symbol).strip()]
            else:
                symbols = [
                    char.upper()
                    for char in str(raw_symbols)
                    if char.isalpha() or char.isdigit()
                ]
        else:
            symbols = []
            seen = set()
            for char in str(puzzle_text or ""):
                if not char.isalpha():
                    continue
                symbol = char.upper()
                if symbol in seen:
                    continue
                seen.add(symbol)
                symbols.append(symbol)

        if len(symbols) != 9 or len(set(symbols)) != 9:
            raise ValueError(
                "Godoku attend un alphabet de 9 symboles uniques via alphabet/symbols, ou 9 lettres distinctes dans la grille"
            )
        if any(len(symbol) != 1 for symbol in symbols):
            raise ValueError("Godoku attend des symboles d'un seul caractere")
        return symbols

    def _parse_sujiken_tokens(self, text: str, symbols: Sequence[str]) -> List[str]:
        if not text or not str(text).strip():
            raise ValueError("Aucune grille Sujiken fournie")

        blank_tokens = {"0", ".", "_"}
        symbol_set = set(symbols)
        parsed_rows: List[List[str]] = []

        for raw_line in str(text).splitlines():
            line = raw_line.strip()
            if not line or SEPARATOR_LINE_RE.fullmatch(line):
                continue
            row_tokens = [
                char for char in line if char in symbol_set or char in blank_tokens
            ]
            if row_tokens:
                parsed_rows.append(row_tokens)

        if len(parsed_rows) == 9 and all(
            len(row) >= row_index + 1 for row_index, row in enumerate(parsed_rows)
        ):
            return [
                token
                for row_index, row in enumerate(parsed_rows)
                for token in row[: row_index + 1]
            ]

        tokens = [token for row in parsed_rows for token in row]
        if len(tokens) != 45:
            raise ValueError(
                f"Une grille Sujiken doit contenir 45 cases actives, {len(tokens)} detectees"
            )
        return tokens

    def _parse_composite_sudoku_tokens(
        self,
        text: str,
        symbols: Sequence[str],
        active_cells: Sequence[Cell],
        rows: int,
        cols: int,
        label: str,
    ) -> Dict[Cell, str]:
        if not text or not str(text).strip():
            raise ValueError(f"Aucune grille {label} fournie")

        blank_tokens = {"0", ".", "_"}
        symbol_set = set(symbols)
        parsed_rows: List[List[str]] = []

        for raw_line in str(text).splitlines():
            line = raw_line.strip()
            if not line or SEPARATOR_LINE_RE.fullmatch(line):
                continue
            row_tokens = [
                char for char in line if char in symbol_set or char in blank_tokens
            ]
            if row_tokens:
                parsed_rows.append(row_tokens)

        givens: Dict[Cell, str] = {}
        if len(parsed_rows) == rows and all(len(row) >= cols for row in parsed_rows):
            for row, col in active_cells:
                token = parsed_rows[row][col]
                if token in symbol_set:
                    givens[(row, col)] = token
            return givens

        tokens = [token for row in parsed_rows for token in row]
        if len(tokens) != len(active_cells):
            raise ValueError(
                f"Une grille {label} doit contenir {len(active_cells)} cases actives, {len(tokens)} detectees"
            )

        for cell, token in zip(active_cells, tokens):
            if token in symbol_set:
                givens[cell] = token
        return givens

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
                    limit=(
                        int(raw_constraint["limit"])
                        if "limit" in raw_constraint and raw_constraint["limit"] is not None
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
        return max(1000, min(120000, value))

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
