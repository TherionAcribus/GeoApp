# Grid Puzzle Solver

Generic finite-domain grid solver powered by Z3.

## Current preset

- `sudoku_classic`: classic 9x9 Sudoku.
- `sudoku_4x4`, `sudoku_6x6`, `sudoku_8x8`, `sudoku_10x10`,
  `sudoku_12x12`, `sudoku_15x15`, `sudoku_16x16`: classic Sudoku with
  alternate grid sizes and rectangular/square boxes. Symbols are `1-9`, then
  `A-G` when needed.
- `sudoku_x`: classic 9x9 Sudoku plus both main diagonals as all-different
  regions. The interactive UI highlights those diagonals in orange.
- `sudoku_argyle`: classic 9x9 Sudoku plus eight marked partial diagonals in
  an Argyle diamond pattern. Those marked diagonals are all-different regions;
  the two main Sudoku X diagonals are not included.
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
- `sudoku_vudoku`: classic 9x9 Sudoku plus V-shaped three-cell corners. The
  vertex digit must equal either the sum or the absolute difference of the two
  branch digits.
- `sudoku_rossini`: classic 9x9 Sudoku plus edge arrows. Each arrow constrains
  the first three cells seen from that side to be strictly ordered, with the
  highest digit in the arrow direction. Empty edges can also forbid monotonic
  triples.
- `sudoku_xv`: classic 9x9 Sudoku plus `X` / `V` border marks. `X` means the
  adjacent pair sums to 10, `V` means it sums to 5, and an empty border can
  forbid both sums.
- `sudoku_kropki`: classic 9x9 Sudoku plus white and black dots between
  adjacent cells. A white dot means consecutive digits, a black dot means one
  digit is double the other, and an empty border can forbid both relations.
- `sudoku_skyscraper`: classic 9x9 Sudoku plus outside visibility clues. Each
  clue counts how many increasing-height skyscrapers are visible from that
  side of a row or column.
- `sudoku_frame`: classic 9x9 Sudoku plus outside sum clues. Each clue gives
  the sum of the three nearest cells in the corresponding row or column.
- `sudoku_outside`: classic 9x9 Sudoku plus outside digit clues. Each outside
  digit must appear in the first three cells seen from that side; multiple
  digits can be given for the same row or column side.
- `sudoku_little_killer`: classic 9x9 Sudoku plus diagonal outside sum clues.
  Each clue gives the sum of the cells on the indicated diagonal; repeats are
  allowed along that diagonal.
- `sudoku_little_unique_killer`: Little Killer Sudoku where every indicated
  sum diagonal also rejects repeated digits.
- `sudoku_godoku`: classic 9x9 Sudoku using nine letters instead of digits.
  The alphabet can be provided explicitly or inferred from the givens when all
  nine letters are present.
- `sudoku_even_odd`: classic 9x9 Sudoku plus cell parity constraints. Marked
  cells can be forced to even or odd values; the interactive UI shows even
  cells in grey and odd cells with a light marker.
- `sudoku_non_consecutive`: classic 9x9 Sudoku where orthogonally adjacent
  cells cannot contain consecutive digits.
- `sudoku_mine`: 9x9 Sudoku Mine. Place mines so every row, column and 3x3
  box contains exactly three mines; numeric clues count adjacent mines.
- `sudoku_mine_6x6`: 6x6 Sudoku Mine. Place two mines in every row, column
  and 2x3 box; numeric clues count adjacent mines.
- `sudoku_tripod_4x4` through `sudoku_tripod_8x8`: Tripod Sudoku. The solver
  reconstructs N connected N-cell regions from the marked tripod dots, then
  applies row, column and region uniqueness. The legacy `sudoku_tripod` alias
  is treated as 5x5.
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
- all-different regions, including configurable Sudoku rows, columns and
  boxes for 4x4 through 16x16 presets;
- partial marked diagonals for variants such as Argyle;
- declarative constraints (`all_different`, `equals`, `not_equal`, `sum`);
- comparison constraints (`greater_than`, `less_than`) for adjacent-cell
  variants such as Compdoku;
- V-corner constraints (`vudoku`) where a vertex equals the sum or difference
  of two branch cells;
- ordered triplet constraints (`strict_increasing`, `strict_decreasing`,
  `not_monotonic`) for edge-clue variants such as Rossini;
- sum exclusion constraints (`sum_not_in`) for negative border clues such as
  empty Sudoku XV borders;
- Kropki adjacency constraints (`kropki_white`, `kropki_black`,
  `kropki_none`) for consecutive, double/half, and absent-dot borders;
- visibility count constraints (`visible_count`) for outside-clue variants such
  as Skyscraper Sudoku;
- contains-value constraints (`contains_value`) for Outside Sudoku;
- diagonal outside sum constraints for Little Killer and Little Unique Killer
  Sudoku;
- parity constraints (`parity`) for variants such as Even-Odd Sudoku;
- non-consecutive adjacency constraints (`non_consecutive`) for variants where
  neighboring cells cannot differ by 1;
- binary mine placement with adjacent mine-count clues for Sudoku Mine;
- a specialized Tripod model with value variables, region variables, vertex
  degree constraints and connected-region constraints;
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
- variant selector for classic Sudoku in multiple sizes, Sudoku X, Argyle,
  Anti Diagonal, Center Dot, Windoku, Girandola, Asterisk, Sujiken, Samurai Sudoku,
  Flower Sudoku,
  Sohei Sudoku, Kazaguruma, Greater Than, Vudoku, Rossini, Sudoku XV, Kropki,
  Skyscraper, Frame, Outside, Little Killer, Little Unique Killer, Godoku, Even-Odd,
  Non-Consecutive and Tripod 4x4 through 8x8;
- Sudoku Mine entry using clue digits and solved mine markers;
- editable outside digit clues for Outside Sudoku;
- editable Tripod dots at grid intersections;
- editable `>` / `<` borders for Greater Than / Compdoku;
- editable V-corners for Vudoku;
- editable edge arrows for Rossini;
- editable `X` / `V` borders for Sudoku XV;
- editable white/black dots for Kropki Sudoku;
- editable outside visibility clues for Skyscraper Sudoku;
- editable outside three-cell sum clues for Frame Sudoku;
- editable diagonal outside sum clues for Little Killer and Little Unique
  Killer Sudoku;
- letter entry and optional alphabet field for Godoku / Wordoku;
- editable parity marks for Even-Odd Sudoku;
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
