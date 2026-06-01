# Grid Puzzle Solver

Generic finite-domain grid solver powered by Z3.

## Current preset

- `sudoku_classic`: classic 9x9 Sudoku.
- `sudoku_x`: classic 9x9 Sudoku plus both main diagonals as all-different
  regions. The interactive UI highlights those diagonals in orange.
- `sudoku_center_dot`: classic 9x9 Sudoku plus the nine center cells of the
  3x3 boxes as an extra all-different region. The interactive UI marks those
  cells with a green dot.
- `sudoku_windoku`: classic 9x9 Sudoku plus four extra 3x3 all-different
  regions at rows/cols 2-4 and 6-8. The interactive UI highlights those
  regions in purple.
- `sudoku_greater_than`: classic 9x9 Sudoku plus adjacent `>` / `<`
  inequalities. The interactive UI lets users toggle border symbols between
  cells.
- Empty cells can be written as `0`, `.`, or `_`.
- Separators such as spaces, pipes, and row divider lines are ignored.

Example:

```text
530070000
600195000
098000060
800060003
400803001
700020006
060000280
000419005
000080079
```

## Architecture

The plugin is intentionally named `grid_puzzle_solver`, not `sudoku_solver`.
Sudoku is just the first builder on top of a generic CSP model:

- rectangular dimensions and optional active cells;
- finite symbol domain;
- givens;
- all-different regions;
- declarative constraints (`all_different`, `equals`, `not_equal`, `sum`);
- comparison constraints (`greater_than`, `less_than`) for adjacent-cell
  variants such as Compdoku;
- solution enumeration with uniqueness detection.
- an internal Z3 timeout (`solver_timeout_ms`) for highly open grids.
- watched cells (`watched_cells`) so an interactive UI can extract answer
  fragments after solving.

This keeps the future path open for irregular Sudoku, killer Sudoku, kakuro-like
sum grids, black-cell grids, and eventually word grids with richer constraints.

## UI direction

The plugin is the engine, not the full user experience. The interactive layer is
the Theia "Grilles" workbench:

- cell-by-cell entry for givens;
- quick paste textarea for fast Sudoku import;
- variant selector for classic Sudoku, Sudoku X, Center Dot, Windoku and
  Greater Than;
- editable `>` / `<` borders for Greater Than / Compdoku;
- watch mode to mark answer cells;
- solve action calling this plugin;
- extracted watched values returned as `watched_values` and `watched_text`.

## Custom spec sketch

```json
{
  "variant": "mini_latin_square",
  "rows": 3,
  "cols": 3,
  "symbols": ["1", "2", "3"],
  "givens": {"r1c1": "1"},
  "regions": [
    ["r1c1", "r1c2", "r1c3"],
    ["r2c1", "r2c2", "r2c3"],
    ["r3c1", "r3c2", "r3c3"],
    ["r1c1", "r2c1", "r3c1"],
    ["r1c2", "r2c2", "r3c2"],
    ["r1c3", "r2c3", "r3c3"]
  ],
  "constraints": []
}
```
