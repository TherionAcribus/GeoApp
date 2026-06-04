# Grid Puzzle Solver

Generic finite-domain grid solver powered by Z3.

## Current preset

- `sudoku_classic`: classic 9x9 Sudoku.
- `sudoku_x`: classic 9x9 Sudoku plus both main diagonals as all-different
  regions. The interactive UI highlights those diagonals in orange.
- `sudoku_anti_diagonal`: classic 9x9 Sudoku where each main diagonal uses at
  most three different digits. The interactive UI highlights those diagonals in
  magenta.
- `sudoku_center_dot`: classic 9x9 Sudoku plus the nine center cells of the
  3x3 boxes as an extra all-different region. The interactive UI marks those
  cells with a green dot.
- `sudoku_windoku`: classic 9x9 Sudoku plus four extra 3x3 all-different
  regions at rows/cols 2-4 and 6-8. The interactive UI highlights those
  regions in purple.
- `sudoku_girandola`: classic 9x9 Sudoku plus a nine-cell all-different
  Girandola region. The interactive UI highlights those cells in cyan.
- `sudoku_asterisk`: classic 9x9 Sudoku plus a nine-cell all-different
  Asterisk region. The interactive UI highlights those cells in magenta.
- `sujiken`: triangular 45-cell Sudoku. Rows, columns, diagonals and the six
  thick-line regions all reject repeated digits.
- `samurai_sudoku`: five overlapping 9x9 Sudoku grids in the classic Gattai-5
  21x21 layout.
- `flower_sudoku`: five heavily overlapping 9x9 Sudoku grids in the compact
  15x15 Flower / Musketry layout.
- `sohei_sudoku`: four overlapping 9x9 Sudoku grids in a 21x21 layout with a
  central 3x3 hole.
- `kazaguruma_sudoku`: five overlapping 9x9 Sudoku grids in a 21x21 windmill
  layout.
- `sudoku_greater_than`: classic 9x9 Sudoku plus adjacent `>` / `<`
  inequalities. The interactive UI lets users toggle border symbols between
  cells.
- `sudoku_rossini`: classic 9x9 Sudoku plus edge arrows. Each arrow constrains
  the first three cells seen from that side to be strictly ordered, with the
  highest digit in the arrow direction. Empty edges can also forbid monotonic
  triples.
- `sudoku_xv`: classic 9x9 Sudoku plus `X` / `V` border marks. `X` means the
  adjacent pair sums to 10, `V` means it sums to 5, and an empty border can
  forbid both sums.
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
- ordered triplet constraints (`strict_increasing`, `strict_decreasing`,
  `not_monotonic`) for edge-clue variants such as Rossini;
- sum exclusion constraints (`sum_not_in`) for negative border clues such as
  empty Sudoku XV borders;
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
- variant selector for classic Sudoku, Sudoku X, Anti Diagonal, Center Dot,
  Windoku, Girandola, Asterisk, Sujiken, Samurai Sudoku, Flower Sudoku,
  Sohei Sudoku, Kazaguruma and Greater Than;
- editable `>` / `<` borders for Greater Than / Compdoku;
- editable edge arrows for Rossini;
- editable `X` / `V` borders for Sudoku XV;
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
