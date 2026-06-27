# Grid Puzzle Solver - Documentation technique

Ce document decrit l'architecture technique du solveur de grilles GeoApp :
moteur Z3, plugin officiel `grid_puzzle_solver`, atelier Theia `Grilles`,
persistance par geocache et points d'extension pour de futures variantes.

## Objectifs

Le systeme doit fournir une base generique pour resoudre des jeux de grilles,
pas seulement des Sudokus.

Les objectifs actuels sont :

- resoudre un Sudoku classique 4x4 a 16x16 ;
- resoudre un Sudoku X avec contraintes sur les deux diagonales principales ;
- resoudre un Anti Diagonal Sudoku avec au plus trois chiffres differents sur
  chaque grande diagonale ;
- resoudre un Sudoku Center Dot avec une extra-region formee par les centres
  des 9 blocs 3x3 ;
- resoudre un Windoku avec quatre extra-regions 3x3 ;
- resoudre un Sudoku Girandola avec une extra-region de 9 cases ;
- resoudre un Sudoku Asterisk avec une extra-region de 9 cases ;
- resoudre un Sujiken sur une grille triangulaire de 45 cases ;
- resoudre un Samurai Sudoku / Gattai-5 compose de cinq grilles 9x9 ;
- resoudre un Flower Sudoku / Musketry compose de cinq grilles 9x9 tres
  chevauchantes ;
- resoudre un Sohei Sudoku compose de quatre grilles 9x9 chevauchantes ;
- resoudre un Kazaguruma / Windmill Sudoku compose de cinq grilles 9x9 en
  moulin ;
- resoudre un Greater Than Sudoku / Compdoku avec contraintes `>` et `<`
  entre cases adjacentes ;
- resoudre un Nonogram / Picross avec indices de blocs par ligne et colonne ;
- resoudre un Kakuro / Cross Sums avec sommes horizontales et verticales ;
- resoudre un Hitori en rayant les doublons sans isoler les cases blanches ;
- resoudre un Slither Link avec une boucle fermee unique ;
- resoudre une Bataille navale / Bimaru avec flotte, totaux et navires non adjacents ;
- resoudre un Fillomino avec regions connectees de taille imposee ;
- permettre une saisie interactive dans une grille Theia ;
- permettre l'edition visuelle des bords d'inegalite pour Compdoku ;
- synchroniser une saisie rapide textuelle avec la grille ;
- extraire des cellules surveillees pour aider a construire une reponse
  d'enigme ;
- sauvegarder l'etat de travail par geocache ;
- garder un modele assez generique pour ajouter plus tard des variantes :
  Sudoku irregulier, Killer Sudoku, Kakuro, grilles a noircir, mots croises,
  etc.

## Vue d'ensemble

Le systeme est compose de quatre couches.

| Couche | Role | Fichiers principaux |
|---|---|---|
| Plugin Python | Moteur de resolution Z3 et presets de grilles | `plugins/official/grid_puzzle_solver/main.py`, `plugin.json` |
| Tests backend | Validation du moteur et des APIs associees | `backend/tests/test_grid_puzzle_solver_plugin.py`, `backend/tests/test_puzzle_states_api.py` |
| API de persistance | Stockage d'etats de grille par geocache | `backend/gc_backend/blueprints/puzzle_states.py`, `backend/gc_backend/geocaches/models.py` |
| UI Theia | Atelier interactif de grille | `frontend/theia-extensions/plugins/src/browser/grid-puzzle-workbench-widget.tsx`, `grid-puzzle-workbench-contribution.ts`, `style/grid-puzzle-workbench.css` |

Le plugin est volontairement appele `grid_puzzle_solver`, et non
`sudoku_solver`. Le Sudoku est le premier usage concret, mais le coeur du
moteur manipule des cellules, symboles, valeurs donnees et contraintes.

## Flux fonctionnel

Depuis une geocache :

1. L'utilisateur ouvre le bouton `# Grilles` ou le menu `Analyser > Grilles`.
2. `GeocacheDetailsWidget` construit un `GeocacheContext`.
3. `GridPuzzleWorkbenchContribution.openWithContext()` ouvre l'atelier
   `GridPuzzleWorkbenchWidget`.
4. L'atelier charge l'etat sauvegarde via `PluginsService.getPuzzleState()`.
5. L'utilisateur saisit la grille, choisit la variante et marque
   eventuellement des cellules surveillees.
6. L'atelier appelle `pluginsService.executePlugin('grid_puzzle_solver', ...)`.
7. Le plugin Python construit un probleme CSP, l'envoie a Z3 et renvoie les
   solutions.
8. L'atelier affiche la solution et les valeurs surveillees, puis sauvegarde
   l'etat via `savePuzzleState()`.

Depuis la liste des plugins :

1. Le clic sur `grid_puzzle_solver` est intercepte par
   `PluginExecutorContribution.openWithPlugin()`.
2. Au lieu d'ouvrir le formulaire generique du Plugin Executor, GeoApp ouvre
   directement l'atelier `Grilles`.

## Plugin officiel

Emplacement :

```text
plugins/official/grid_puzzle_solver
```

Fichiers :

| Fichier | Role |
|---|---|
| `plugin.json` | Manifeste GeoApp : metadonnees, entrees, sorties, dependances. |
| `main.py` | Moteur CSP/Z3 et point d'entree `execute(inputs)`. |
| `README.md` | Documentation courte du plugin. |

Dependance backend :

```text
z3-solver==4.16.0.0
```

declaree dans :

```text
backend/requirements.txt
```

## Contrat d'entree du plugin

Le point d'entree est :

```python
def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
```

Entrées principales :

| Cle | Type | Defaut | Description |
|---|---|---|---|
| `puzzle_type` | string | `sudoku_classic` | Variante a resoudre. |
| `grid` | string | vide | Grille 9x9 pour les presets Sudoku. |
| `puzzle` | string | vide | Alias accepte pour `grid`. |
| `text` | string | vide | Fallback pour integration geocache/plugin executor. |
| `spec` | string JSON | vide | Specification generique pour `custom_spec`. |
| `max_solutions` | number | `2` | Nombre maximum de solutions a enumerer. |
| `solver_timeout_ms` | number | `10000` | Timeout interne Z3, borne entre 1s et 120s. |
| `inequalities` | object/list/string | vide | Contraintes `>` / `<` pour Greater Than / Compdoku. |
| `comparisons` | object/list/string | vide | Alias de `inequalities`. |
| `vudoku` | object/list/string | vide | Coins Vudoku 8x8 (`grid`, `corners` ou liste d'objets). |
| `v_corners` | object/list/string | vide | Alias de `vudoku`. |
| `chains` | object/list/string | vide | Matrice NxN des chaines Chain / Strimko. |
| `streams` | object/list/string | vide | Alias de `chains`. |
| `rossini` | object | vide | Fleches de bord Rossini (`top`, `bottom`, `left`, `right`). |
| `arrows` | object | vide | Alias de `rossini`. |
| `xv` | object | vide | Marques de bord Sudoku XV (`horizontal`, `vertical`). |
| `marks` | object | vide | Alias de `xv`. |
| `kropki` | object | vide | Ronds Kropki (`horizontal`, `vertical`) : blanc, noir ou vide. |
| `dots` | object | vide | Alias de `kropki`. |
| `skyscraper` | object | vide | Indices exterieurs Skyscraper (`top`, `bottom`, `left`, `right`). |
| `clues` | object | vide | Alias de `skyscraper`. |
| `frame` | object | vide | Sommes exterieures Frame (`top`, `bottom`, `left`, `right`). |
| `outside_sums` | object | vide | Alias de `frame`. |
| `outside` | object | vide | Indices Outside (`top`, `bottom`, `left`, `right`). |
| `little_killer` | object/list/string | vide | Sommes diagonales Little Killer depuis les bords. |
| `diagonal_sums` | object/list/string | vide | Alias de `little_killer`. |
| `alphabet` | string/list | vide | Neuf lettres uniques pour Godoku / Wordoku. |
| `symbols` | string/list | vide | Alias accepte pour l'alphabet Godoku. |
| `parity` | object/list/string | vide | Contraintes Pair/Impair Even-Odd. |
| `even_odd` | object/list/string | vide | Alias de `parity`. |
| `row_clues` | string/list | vide | Indices de lignes Nonogram, une ligne par ligne ou JSON. |
| `rows` | string/list | vide | Alias de `row_clues` pour Nonogram. |
| `column_clues` | string/list | vide | Indices de colonnes Nonogram, une ligne par colonne ou JSON. |
| `col_clues`, `cols`, `columns` | string/list | vide | Alias de `column_clues` pour Nonogram. |
| `kakuro`, `layout` | object/string JSON | vide | Matrice Kakuro de cellules `black`, `white` et `clue`. |
| `shaded`, `hitori_shaded`, `marks` | string/list | vide | Marques noires Hitori alignees sur la grille. |
| `edges`, `lines`, `slither_edges` | object/string JSON | vide | Traits Slither Link `horizontal` et `vertical` deja traces. |
| `row_totals` | string/list | vide | Totaux de lignes Bataille navale. |
| `column_totals`, `col_totals` | string/list | vide | Totaux de colonnes Bataille navale. |
| `fleet`, `ships`, `battleship_fleet` | object/list/string JSON | flotte classique | Flotte Bataille navale: longueur vers quantite. |
| `watched_cells` | string/list | vide | Cellules a extraire apres resolution. |
| `watch_cells` | string/list | vide | Alias de `watched_cells`. |

Valeurs supportees pour `puzzle_type` :

| Valeur | Aliases | Role |
|---|---|---|
| `sudoku_classic` | `sudoku`, `classic_sudoku` | Sudoku 9x9 standard. |
| `sudoku_4x4` | `sudoku_4`, `classic_sudoku_4x4` | Sudoku classique 4x4 avec blocs 2x2. |
| `sudoku_6x6` | `sudoku_6`, `classic_sudoku_6x6` | Sudoku classique 6x6 avec blocs 2x3. |
| `sudoku_8x8` | `sudoku_8`, `classic_sudoku_8x8` | Sudoku classique 8x8 avec blocs 2x4. |
| `sudoku_10x10` | `sudoku_10`, `classic_sudoku_10x10` | Sudoku classique 10x10 avec blocs 2x5. |
| `sudoku_12x12` | `sudoku_12`, `classic_sudoku_12x12` | Sudoku classique 12x12 avec blocs 3x4. |
| `sudoku_15x15` | `sudoku_15`, `classic_sudoku_15x15` | Sudoku classique 15x15 avec blocs 3x5. |
| `sudoku_16x16` | `sudoku_16`, `classic_sudoku_16x16` | Sudoku classique 16x16 avec blocs 4x4. |
| `chain_sudoku_4x4` a `chain_sudoku_9x9` | `strimko_4x4` a `strimko_9x9`, `chain_sudoku` pour 9x9 | Chain Sudoku / Strimko : lignes, colonnes et chaines sans doublons. |
| `sudoku_x` | `x_sudoku`, `diagonal_sudoku` | Sudoku standard + diagonales principales sans doublons. |
| `sudoku_argyle` | `argyle`, `argyle_sudoku` | Sudoku standard + 8 diagonales partielles marquees sans doublons. |
| `sudoku_anti_diagonal` | `anti_diagonal_sudoku`, `antidiagonal_sudoku` | Sudoku standard + au plus trois chiffres differents sur chaque grande diagonale. |
| `sudoku_center_dot` | `center_dot`, `centerdot_sudoku` | Sudoku standard + extra-region des centres de blocs 3x3. |
| `sudoku_windoku` | `windoku`, `hyper_sudoku`, `four_box_sudoku` | Sudoku standard + quatre extra-regions 3x3. |
| `sudoku_girandola` | `girandola`, `girandole_sudoku` | Sudoku standard + extra-region Girandola de 9 cases. |
| `sudoku_asterisk` | `asterisk`, `asterisk_sudoku` | Sudoku standard + extra-region Asterisk de 9 cases. |
| `sujiken` | `sudoku_sujiken`, `half_sudoku`, `triangular_sudoku` | Grille triangulaire de 45 cases, lignes/colonnes/diagonales/regions sans doublons. |
| `samurai_sudoku` | `samurai`, `gattai_5`, `gattai5` | Cinq grilles Sudoku 9x9 chevauchantes dans un plateau 21x21. |
| `flower_sudoku` | `flower`, `fleur_sudoku`, `musketry_sudoku` | Cinq grilles Sudoku 9x9 tres chevauchantes dans un plateau 15x15. |
| `sohei_sudoku` | `sohei` | Quatre grilles Sudoku 9x9 chevauchantes dans un plateau 21x21. |
| `kazaguruma_sudoku` | `kazaguruma`, `windmill_sudoku` | Cinq grilles Sudoku 9x9 chevauchantes dans un plateau 21x21 en moulin. |
| `sudoku_greater_than` | `greater_than`, `compdoku`, `inequality_sudoku` | Sudoku standard + comparaisons `>` / `<` entre cases adjacentes. |
| `sudoku_vudoku` | `vudoku` | Sudoku standard + coins V de trois cases, sommet egal a la somme ou difference des deux branches. |
| `sudoku_rossini` | `rossini`, `rossini_sudoku` | Sudoku standard + fleches exterieures ordonnant les trois premieres cases vues depuis un bord. |
| `sudoku_xv` | `xv`, `xv_sudoku` | Sudoku standard + marques de bord `X` / `V` pour les sommes 10 et 5. |
| `sudoku_kropki` | `kropki`, `kropki_sudoku`, `dots_sudoku` | Sudoku standard + ronds blancs/noirs entre cases adjacentes. |
| `sudoku_skyscraper` | `skyscraper`, `skyscraper_sudoku` | Sudoku standard + indices exterieurs comptant les batiments visibles. |
| `sudoku_frame` | `frame`, `frame_sudoku`, `outside_sum_sudoku` | Sudoku standard + sommes exterieures des trois cases voisines du bord. |
| `sudoku_outside` | `outside`, `outside_sudoku` | Sudoku standard + chiffres exterieurs presents dans les trois premieres cases vues depuis le bord. |
| `sudoku_little_killer` | `little_killer`, `little_killer_sudoku` | Sudoku standard + sommes diagonales exterieures, repetitions autorisees sur les diagonales. |
| `sudoku_little_unique_killer` | `little_unique_killer`, `little_unique_killer_sudoku`, `unique_little_killer` | Sudoku standard + sommes diagonales exterieures sans repetitions sur chaque diagonale flechee. |
| `sudoku_godoku` | `godoku`, `wordoku`, `alphabet_sudoku` | Sudoku standard avec 9 lettres au lieu des chiffres. |
| `sudoku_even_odd` | `even_odd`, `evenodd`, `odd_even_sudoku` | Sudoku standard + contraintes de parite sur certaines cases. |
| `sudoku_non_consecutive` | `non_consecutive`, `nonconsecutive_sudoku` | Sudoku standard + interdiction des chiffres consecutifs dans les cases adjacentes. |
| `sudoku_mine` | `mine_sudoku`, `minesudoku`, `sudoku_mine_9x9` | Sudoku Mine 9x9 : 3 mines par ligne, colonne et bloc 3x3, indices adjacents. |
| `sudoku_mine_6x6` | `mine_sudoku_6x6`, `minesudoku_6x6` | Sudoku Mine 6x6 : 2 mines par ligne, colonne et region 2x3, indices adjacents. |
| `sudoku_tripod_4x4` a `sudoku_tripod_8x8` | `tripod`, `tripod_sudoku`, `sudoku_tripod` pour 5x5 | Tripod NxN avec regions reconstruites depuis les points noirs aux intersections. |
| `nonogram` | `picross`, `griddlers`, `hanjie` | Nonogram classique : les indices de lignes et colonnes decrivent les blocs noircis. |
| `kakuro` | `cross_sums`, `crosssum`, `cross_sum` | Kakuro : sommes de series de chiffres 1-9 sans repetition. |
| `hitori` | `hitori_puzzle` | Hitori : doublons rayes, noirs non adjacents et blancs connectes. |
| `slitherlink` | `slither_link`, `slither`, `loop_the_loop`, `surizarinku` | Slither Link : une boucle unique autour des indices 0-3. |
| `battleship` | `battleships`, `bimaru`, `solitaire_battleships`, `battleship_solitaire` | Bataille navale : flotte sans contacts et totaux de lignes/colonnes. |
| `fillomino` | `polyomino`, `polyominous`, `allied_occupation` | Fillomino : regions connectees dont la taille egale leur valeur. |
| `custom_spec` | `custom`, `json_spec` | Probleme CSP decrit en JSON. |

Format de grille Sudoku :

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

Les cases vides peuvent etre notees :

- `0`
- `.`
- `_`

Les separateurs de lignes, espaces, pipes et lignes de separation sont ignores,
tant que 81 cases interpretables sont detectees.

## Contrat de sortie du plugin

Reponse OK :

```json
{
  "status": "ok",
  "summary": "Grille resolue avec une solution unique",
  "results": [
    {
      "id": "solution_1",
      "text_output": "5 3 4 6 7 8 9 1 2\n...",
      "confidence": 1.0,
      "grid": [["5", "3", "4"], "..."],
      "watched_values": {"r1c1": "5"},
      "watched_text": "5",
      "parameters": {
        "variant": "sudoku_classic",
        "rows": 9,
        "cols": 9,
        "symbols": ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
      },
      "metadata": {
        "solution_index": 1,
        "givens_count": 30,
        "constraint_count": 27
      }
    }
  ],
  "solution_count": 1,
  "unique": true,
  "truncated": false,
  "watched_cells": ["r1c1"],
  "watched_values": {"r1c1": "5"},
  "watched_text": "5",
  "metadata": {
    "variant": "sudoku_classic",
    "rows": 9,
    "cols": 9,
    "symbols": ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    "givens_count": 30,
    "constraint_count": 27,
    "max_solutions": 2,
    "solver_timeout_ms": 10000
  },
  "plugin_info": {
    "name": "grid_puzzle_solver",
    "version": "0.1.0",
    "execution_time_ms": 12
  }
}
```

Reponse erreur :

```json
{
  "status": "error",
  "summary": "Une grille Sudoku classique doit contenir 81 cases, 3 detectees",
  "results": [],
  "plugin_info": {
    "name": "grid_puzzle_solver",
    "version": "0.1.0",
    "execution_time_ms": 1
  },
  "error": {
    "type": "ValueError",
    "message": "Une grille Sudoku classique doit contenir 81 cases, 3 detectees"
  }
}
```

## Modele CSP interne

Le moteur utilise trois structures principales.

### `Cell`

Une cellule est un tuple zero-based :

```python
Cell = Tuple[int, int]
```

Exemples :

| Reference utilisateur | Cell interne |
|---|---|
| `r1c1` | `(0, 0)` |
| `r9c9` | `(8, 8)` |

### `GridConstraint`

```python
@dataclass(frozen=True)
class GridConstraint:
    kind: str
    cells: Tuple[Cell, ...] = ()
    value: Optional[str] = None
    total: Optional[int] = None
    limit: Optional[int] = None
    forbidden_totals: Tuple[int, ...] = ()
    clues: Tuple[int, ...] = ()
```

Contraintes supportees :

| `kind` | Champs utiles | Semantique |
|---|---|---|
| `all_different` | `cells` | Toutes les cellules ont des valeurs distinctes. |
| `equals` | `cells`, `value` | Une cellule vaut une valeur precise. |
| `not_equal` | `cells` | Equivalent a `all_different` sur au moins deux cellules. |
| `contains_value` | `cells`, `value` | Au moins une cellule de la zone contient la valeur donnee. |
| `sum` | `cells`, `total` | Somme numerique des cellules egale au total. |
| `max_distinct` | `cells`, `limit` | Nombre de valeurs distinctes inferieur ou egal a `limit`. |
| `greater_than` | `cells` | La premiere cellule est strictement superieure a la seconde. |
| `less_than` | `cells` | La premiere cellule est strictement inferieure a la seconde. |
| `strict_increasing` | `cells` | Trois cellules strictement croissantes dans l'ordre donne. |
| `strict_decreasing` | `cells` | Trois cellules strictement decroissantes dans l'ordre donne. |
| `not_monotonic` | `cells` | Trois cellules qui ne sont ni strictement croissantes ni strictement decroissantes. |
| `sum_not_in` | `cells`, `forbidden_totals` | Somme des cellules differente de chacun des totaux interdits. |
| `vudoku` | `cells` | Trois cellules en V : la premiere cellule est le sommet, egale a la somme ou a la difference absolue des deux autres. |
| `kropki_white` | `cells` | Deux cellules adjacentes contiennent des chiffres consecutifs. |
| `kropki_black` | `cells` | Deux cellules adjacentes contiennent deux chiffres dont l'un vaut le double de l'autre. |
| `kropki_none` | `cells` | Deux cellules adjacentes ne sont ni consecutives ni dans un rapport double/moitie. |
| `visible_count` | `cells`, `total` | Nombre de valeurs visibles depuis le debut de la sequence ordonnee. |
| `parity` | `cells`, `value` | Une cellule est paire (`even`) ou impaire (`odd`). |
| `non_consecutive` | `cells` | Deux cellules adjacentes ne peuvent pas differer de 1. |
| `nonogram_line` | `cells`, `clues` | La sequence binaire des cellules doit correspondre aux blocs noircis indiques. |

### `GridCspProblem`

```python
@dataclass
class GridCspProblem:
    rows: int
    cols: int
    symbols: List[str]
    active_cells: List[Cell]
    givens: Dict[Cell, str]
    constraints: List[GridConstraint]
    numeric_values: Dict[str, int]
    variant: str
```

Ce modele est volontairement plus large qu'un Sudoku :

- `rows` / `cols` decrivent la grille rectangulaire ;
- `active_cells` permet de modeliser des formes non rectangulaires ;
- `symbols` decrit le domaine fini ;
- `givens` contient les valeurs imposees ;
- `constraints` porte les regles ;
- `numeric_values` permet les contraintes de somme ;
- `variant` sert a identifier le preset ou la spec.

## Encodage Z3

Chaque cellule active devient une variable entiere :

```python
variables = {
    cell: z3.Int(f"r{cell[0] + 1}c{cell[1] + 1}")
    for cell in problem.active_cells
}
```

Le domaine est indexe par position dans `symbols` :

```python
solver.add(variable >= 0, variable < len(problem.symbols))
```

Exemple pour `symbols = ["1", "2", "3"]` :

| Valeur Z3 | Symbole |
|---|---|
| `0` | `"1"` |
| `1` | `"2"` |
| `2` | `"3"` |

Avantages :

- le domaine reste uniforme ;
- les symboles peuvent etre non numeriques a terme ;
- les contraintes numeriques passent par `numeric_values`.

Les valeurs donnees sont encodees avec :

```python
solver.add(variables[cell] == symbol_to_index[symbol])
```

Les contraintes `all_different` et `not_equal` utilisent :

```python
z3.Distinct(...)
```

Les contraintes `sum` utilisent une expression `z3.If` qui convertit l'index
de symbole en valeur numerique.

Les contraintes `parity` utilisent la meme conversion numerique, puis ajoutent
un modulo :

```python
numeric_expr % 2 == 0  # pair
numeric_expr % 2 == 1  # impair
```

Les contraintes `non_consecutive` convertissent les deux cellules en valeurs
numeriques et interdisent une difference absolue de 1 :

```python
z3.Abs(first_expr - second_expr) != 1
```

Les contraintes `vudoku` convertissent les trois cellules en valeurs numeriques.
La premiere cellule est toujours le sommet du V :

```python
vertex_expr == first_arm_expr + second_arm_expr
z3.Or(vertex_expr == first_arm_expr + second_arm_expr,
      vertex_expr == z3.Abs(first_arm_expr - second_arm_expr))
```

Les contraintes `kropki_*` convertissent deux cellules adjacentes en valeurs
numeriques :

```python
consecutive_expr = z3.Abs(first_expr - second_expr) == 1
double_expr = z3.Or(first_expr == second_expr * 2,
                    second_expr == first_expr * 2)
```

Un couple `1` / `2` satisfait donc a la fois un rond blanc et un rond noir. Un
bord vide en Kropki standard ajoute `Not(consecutive_expr)` et
`Not(double_expr)`.

## Enumeration des solutions

Le solveur enumere jusqu'a `max_solutions`.

Apres chaque modele trouve, il ajoute une clause bloquante :

```python
solver.add(z3.Or(variable != model.eval(variable, model_completion=True)
                 for variable in variables.values()))
```

Interpretation :

| Situation | Champs retournes |
|---|---|
| Aucune solution | `solution_count = 0`, `unique = false` |
| Une seule solution et Z3 a prouve l'exhaustion | `unique = true` |
| Plusieurs solutions | `unique = false` |
| Limite atteinte avant exhaustion | `truncated = true` |

Le defaut `max_solutions = 2` est volontaire :

- 1 solution trouvee puis `unsat` prouve l'unicite ;
- 2 solutions suffisent a prouver la non-unicite dans la plupart des usages ;
- cela evite d'enumerer inutilement des milliers de solutions.

## Presets Sudoku

### Sudoku classique

`puzzle_type = sudoku_classic`

Contraintes :

- 9 lignes `all_different` ;
- 9 colonnes `all_different` ;
- 9 blocs 3x3 `all_different`.

Total :

```text
27 contraintes
```

### Sudoku classiques multi-tailles

`puzzle_type = sudoku_4x4`, `sudoku_6x6`, `sudoku_8x8`, `sudoku_10x10`,
`sudoku_12x12`, `sudoku_15x15`, `sudoku_16x16`

Ces variantes reprennent exactement la logique du Sudoku classique :

- chaque ligne contient tous les symboles une seule fois ;
- chaque colonne contient tous les symboles une seule fois ;
- chaque bloc contient tous les symboles une seule fois.

Configurations :

| Variante | Taille | Blocs | Symboles |
|---|---:|---|---|
| `sudoku_4x4` | 4x4 | 2x2 | `1234` |
| `sudoku_6x6` | 6x6 | 2x3 | `123456` |
| `sudoku_8x8` | 8x8 | 2x4 | `12345678` |
| `sudoku_10x10` | 10x10 | 2x5 | `123456789A` |
| `sudoku_12x12` | 12x12 | 3x4 | `123456789ABC` |
| `sudoku_15x15` | 15x15 | 3x5 | `123456789ABCDEF` |
| `sudoku_16x16` | 16x16 | 4x4 | `123456789ABCDEFG` |

Les tailles superieures a 9 utilisent donc des lettres comme symboles de
valeur. `0`, `.`, et `_` restent reserves aux cases vides.

Dans l'atelier Theia, les traits epais suivent automatiquement la forme de bloc
de la variante choisie. La saisie rapide attend `N x N` caracteres utiles.

### Chain Sudoku / Strimko

`puzzle_type = chain_sudoku_4x4` a `chain_sudoku_9x9`

Alias :

```text
strimko_4x4
strimko_sudoku_4x4
sudoku_chain_4x4
sudoku_chaines_4x4
chain_sudoku  # 9x9 par defaut
strimko       # 9x9 par defaut
```

Contraintes :

- chaque ligne contient les symboles `1..N` une seule fois ;
- chaque colonne contient les symboles `1..N` une seule fois ;
- chaque chaine contient exactement `N` ronds et rejette les doublons.

Format des chaines :

```json
{
  "grid": [
    "AABB",
    "CCDD",
    "BBAA",
    "DDCC"
  ]
}
```

Le moteur accepte aussi une matrice brute ou les alias `streams` / `regions`.
Chaque identifiant non vide est le nom d'une chaine. Pour une grille NxN, le
moteur exige exactement N chaines et chaque chaine doit apparaitre exactement N
fois.

Dans l'atelier Theia, Chain / Strimko affiche les cellules sous forme de ronds.
Le mode `Chaines` permet de choisir une chaine active puis de peindre les ronds.
Les couleurs sont serialisees dans `chains.grid`. Par defaut, aucune chaine
n'est assignee : les compteurs de la palette guident la construction jusqu'a
obtenir N chaines de N ronds.

### Sudoku X

`puzzle_type = sudoku_x`

Contraintes :

- toutes les contraintes du Sudoku classique ;
- diagonale principale `r1c1 -> r9c9` en `all_different` ;
- diagonale secondaire `r1c9 -> r9c1` en `all_different`.

Total :

```text
29 contraintes
```

Dans l'atelier Theia, les deux diagonales sont marquees en orange quand la
variante `Sudoku X` est selectionnee.

### Argyle Sudoku

`puzzle_type = sudoku_argyle`

Alias :

```text
argyle
argyle_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- 8 diagonales partielles marquees sont des regions `all_different` ;
- les deux grandes diagonales principales de Sudoku X ne sont pas incluses.

Regions ajoutees :

| Region | Cases | Taille |
|---|---|---:|
| Argyle 1 | `r1c5 r2c6 r3c7 r4c8 r5c9` | 5 |
| Argyle 2 | `r1c2 r2c3 r3c4 r4c5 r5c6 r6c7 r7c8 r8c9` | 8 |
| Argyle 3 | `r2c1 r3c2 r4c3 r5c4 r6c5 r7c6 r8c7 r9c8` | 8 |
| Argyle 4 | `r5c1 r6c2 r7c3 r8c4 r9c5` | 5 |
| Argyle 5 | `r1c5 r2c4 r3c3 r4c2 r5c1` | 5 |
| Argyle 6 | `r1c8 r2c7 r3c6 r4c5 r5c4 r6c3 r7c2 r8c1` | 8 |
| Argyle 7 | `r2c9 r3c8 r4c7 r5c6 r6c5 r7c4 r8c3 r9c2` | 8 |
| Argyle 8 | `r5c9 r6c8 r7c7 r8c6 r9c5` | 5 |

Dans l'atelier Theia, ces diagonales sont dessinees par des traits orange dans
les cellules concernees. Les conflits locaux utilisent les memes regions
`all_different`.

### Anti Diagonal Sudoku

`puzzle_type = sudoku_anti_diagonal`

Alias :

```text
anti_diagonal_sudoku
antidiagonal_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- la diagonale principale `r1c1 -> r9c9` utilise au plus 3 chiffres
  differents ;
- la diagonale secondaire `r1c9 -> r9c1` utilise au plus 3 chiffres
  differents.

Ces contraintes sont modelisees avec `GridConstraint(kind="max_distinct",
limit=3)`.

Total :

```text
29 contraintes
```

Dans l'atelier Theia, les deux diagonales sont marquees en magenta quand la
variante `Anti Diagonal` est selectionnee. Si une saisie depasse les trois
chiffres differents sur une diagonale, les cases concernees sont signalees en
rouge.

### Center Dot

`puzzle_type = sudoku_center_dot`

Contraintes :

- toutes les contraintes du Sudoku classique ;
- les 9 cases centrales des blocs 3x3 forment une region supplementaire
  `all_different`.

Cellules de l'extra-region :

```text
r2c2 r2c5 r2c8
r5c2 r5c5 r5c8
r8c2 r8c5 r8c8
```

Total :

```text
28 contraintes
```

Dans l'atelier Theia, les cases Center Dot sont marquees par un point vert
quand la variante `Center Dot` est selectionnee.

### Windoku

`puzzle_type = sudoku_windoku`

Alias :

```text
windoku
hyper_sudoku
four_box_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- quatre regions supplementaires 3x3 en `all_different`.

Extra-regions 1-based :

```text
r2c2 -> r4c4
r2c6 -> r4c8
r6c2 -> r8c4
r6c6 -> r8c8
```

Total :

```text
31 contraintes
```

Dans l'atelier Theia, les quatre regions Windoku sont teintees et encadrees
en violet quand la variante `Windoku` est selectionnee.

### Girandola

`puzzle_type = sudoku_girandola`

Alias :

```text
girandola
girandole_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- les 9 cases Girandola forment une region supplementaire `all_different`.

Cellules de l'extra-region :

```text
r1c1 r1c9
r2c5
r5c2 r5c5 r5c8
r8c5
r9c1 r9c9
```

Total :

```text
28 contraintes
```

Dans l'atelier Theia, les cases Girandola sont marquees en cyan quand la
variante `Girandola` est selectionnee.

### Asterisk

`puzzle_type = sudoku_asterisk`

Alias :

```text
asterisk
asterisk_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- les 9 cases Asterisk forment une region supplementaire `all_different`.

Cellules de l'extra-region :

```text
r2c5
r3c3 r3c7
r5c2 r5c5 r5c8
r7c3 r7c7
r8c5
```

Total :

```text
28 contraintes
```

Dans l'atelier Theia, les cases Asterisk sont marquees en magenta quand la
variante `Asterisk` est selectionnee.

### Sujiken

`puzzle_type = sujiken`

Alias :

```text
sudoku_sujiken
half_sudoku
triangular_sudoku
```

Sujiken n'utilise pas la grille Sudoku carree complete. Le modele interne reste
une matrice 9x9, mais seules les 45 cases du triangle inferieur gauche sont
actives :

```text
r1c1
r2c1 r2c2
r3c1 r3c2 r3c3
...
r9c1 r9c2 r9c3 r9c4 r9c5 r9c6 r9c7 r9c8 r9c9
```

Contraintes :

- chaque ligne active ne contient aucun doublon ;
- chaque colonne active ne contient aucun doublon ;
- chaque diagonale active `rNc1 -> r9c...` ne contient aucun doublon ;
- les 6 regions delimitees par les traits epais ne contiennent aucun doublon.

Regions :

```text
Triangle haut gauche: r1c1 / r2c1-r2c2 / r3c1-r3c3
Carre milieu gauche: r4c1-r6c3
Triangle central: r4c4 / r5c4-r5c5 / r6c4-r6c6
Carre bas gauche: r7c1-r9c3
Carre bas: r7c4-r9c6
Triangle bas droit: r7c7 / r8c7-r8c8 / r9c7-r9c9
```

Total :

```text
33 contraintes
```

Format de saisie accepte :

```text
8
34
129
4856
76295
931487
5783612
21457963
693248571
```

Le parser accepte aussi une matrice 9 lignes produite par l'atelier Theia :
seules les `row + 1` premieres cases de chaque ligne sont lues.

Dans l'atelier Theia, la variante `Sujiken` affiche uniquement les 45 cases
actives du triangle.

### Samurai Sudoku / Gattai-5

`puzzle_type = samurai_sudoku`

Alias :

```text
samurai
gattai_5
gattai5
```

Samurai Sudoku assemble cinq grilles Sudoku 9x9 sur un plateau 21x21. Les coins
3x3 des grilles exterieures chevauchent les coins 3x3 de la grille centrale.

Offsets zero-based des cinq grilles :

```text
haut gauche : (0, 0)
haut droit  : (0, 12)
centre      : (6, 6)
bas gauche  : (12, 0)
bas droit   : (12, 12)
```

Le modele contient :

```text
369 cases actives
135 contraintes Sudoku
```

Les contraintes sont les 27 contraintes standard de chaque grille 9x9 :

- 9 lignes ;
- 9 colonnes ;
- 9 blocs 3x3.

Les cases chevauchantes sont partagees par construction : une meme variable Z3
appartient a deux grilles quand elle est dans une zone de recouvrement.

Format de saisie principal :

```text
697245813...346958271
852391467...729614835
143687925...851273649
935418672...198746523
416723598...534892167
278569134...672135984
389174256714983527416
524936781923465381792
761852349856217469358
......594167328......
......127538649......
......638249751......
125847963481572891436
789365412375896432175
643291875692134657982
568724391...961743258
271936548...783529614
394158726...425186793
852419637...649378521
936572184...258914367
417683259...317265849
```

Le parser accepte aussi une representation compacte de 369 cases actives en
ordre ligne/colonne. Les caracteres `0`, `.`, `_` representent les cases vides.

Dans l'atelier Theia, la variante `Samurai Sudoku` affiche uniquement les cases
actives du plateau 21x21 et conserve les separations 3x3 de chaque grille.

### Flower Sudoku / Musketry

`puzzle_type = flower_sudoku`

Alias :

```text
flower
fleur_sudoku
musketry_sudoku
```

Flower Sudoku assemble cinq grilles Sudoku 9x9 sur un plateau 15x15. Les
recouvrements sont beaucoup plus importants que dans Samurai : le carre central
est entierement couvert par les quatre carres exterieurs.

Offsets zero-based des cinq grilles :

```text
haut   : (0, 3)
gauche : (3, 0)
centre : (3, 3)
droite : (3, 6)
bas    : (6, 3)
```

Le modele contient :

```text
189 cases actives
135 contraintes Sudoku
```

Chaque grille 9x9 ajoute ses 27 contraintes standard :

- 9 lignes ;
- 9 colonnes ;
- 9 blocs 3x3.

Format de saisie principal :

```text
...254613897...
...396785412...
...817924653...
789425361789245
421673598124367
356189247365819
694531872946153
578942136578492
132768459231678
817356924817536
943217685493721
265894713652984
...423561789...
...175298364...
...689347125...
```

Le parser accepte aussi une representation compacte de 189 cases actives en
ordre ligne/colonne. Les caracteres `0`, `.`, `_` representent les cases vides.

Dans l'atelier Theia, la variante `Flower Sudoku` affiche uniquement les cases
actives du plateau 15x15 et conserve les separations 3x3 de chaque grille.

### Sohei Sudoku

`puzzle_type = sohei_sudoku`

Alias :

```text
sohei
```

Sohei Sudoku assemble quatre grilles Sudoku 9x9 sur un plateau 21x21. La forme
laisse un trou central 3x3 inactif et place une grille sur chaque branche.

Offsets zero-based des quatre grilles :

```text
haut   : (0, 6)
gauche : (6, 0)
droite : (6, 12)
bas    : (12, 6)
```

Le modele contient :

```text
288 cases actives
108 contraintes Sudoku
```

Chaque grille 9x9 ajoute ses 27 contraintes standard :

- 9 lignes ;
- 9 colonnes ;
- 9 blocs 3x3.

Les zones de recouvrement partagent les memes variables Z3, comme pour Samurai
et Flower. Le trou central ne cree aucune variable.

Format de saisie principal :

```text
......452638917......
......683719452......
......719254836......
......861945273......
......245873691......
......937126548......
594218376492185967423
738569124587369428175
216743598361724135869
345927681...816579234
671485932...497213658
982631745...253684791
163894257614938746512
859172463928571892346
427356819357642351987
......921876453......
......345192786......
......678543129......
......582769314......
......794231865......
......136485297......
```

Le parser accepte aussi une representation compacte de 288 cases actives en
ordre ligne/colonne. Les caracteres `0`, `.`, `_` representent les cases vides.

Dans l'atelier Theia, la variante `Sohei Sudoku` affiche uniquement les cases
actives du plateau 21x21 et conserve les separations 3x3 de chaque grille.

### Kazaguruma / Windmill Sudoku

`puzzle_type = kazaguruma_sudoku`

Alias :

```text
kazaguruma
windmill_sudoku
```

Kazaguruma Sudoku assemble cinq grilles Sudoku 9x9 en forme de moulin a vent.
La grille centrale est placee au coeur de la forme et chevauche les quatre
ailes.

Offsets zero-based des cinq grilles :

```text
haut   : (0, 3)
droite : (3, 12)
centre : (6, 6)
gauche : (9, 0)
bas    : (12, 9)
```

Le plateau logique mesure 21 lignes et 21 colonnes.

Le modele contient :

```text
333 cases actives
135 contraintes Sudoku
```

Chaque grille 9x9 ajoute ses 27 contraintes standard :

- 9 lignes ;
- 9 colonnes ;
- 9 blocs 3x3.

Format de saisie principal :

```text
...471283965.........
...625791843.........
...398456217.........
...549627138497653821
...736819524265819374
...182345679381742956
...854172396548237169
...913564782139568247
...267938451726194583
693718245967813426795
275934816235974385612
184526397814652971438
859367421679385214...
417892653148297365...
326145789523461978...
548679132965178423...
961283574487932651...
732451968312654789...
.........896523147...
.........734816592...
.........251749836...
```

Le parser accepte aussi une representation compacte de 333 cases actives en
ordre ligne/colonne. Les caracteres `0`, `.`, `_` representent les cases vides.

Dans l'atelier Theia, la variante `Kazaguruma` affiche uniquement les cases
actives du plateau 21x21 et conserve les separations 3x3 de chaque grille.

### Greater Than / Compdoku

`puzzle_type = sudoku_greater_than`

Alias :

```text
greater_than
compdoku
inequality_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- une contrainte `greater_than` ou `less_than` pour chaque symbole `>` / `<`
  place entre deux cases adjacentes.

Le format principal envoye par l'atelier est :

```json
{
  "horizontal": [
    ">.......",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........"
  ],
  "vertical": [
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    "........."
  ]
}
```

`horizontal` contient 9 lignes de 8 symboles. Chaque symbole compare la case
de gauche a la case de droite.

`vertical` contient 8 lignes de 9 symboles. Chaque symbole compare la case du
haut a la case du bas.

Formats alternatifs acceptes par le moteur :

```json
[
  {"cells": ["r1c1", "r1c2"], "relation": ">"},
  {"from": "r2c3", "to": "r3c3", "op": "<"}
]
```

ou des lignes texte :

```text
r1c1>r1c2
r2c3<r3c3
```

Les deux cellules d'une inegalite doivent etre adjacentes orthogonalement.

Dans l'atelier Theia, la variante `Greater Than` affiche des emplacements entre
les cases. Un clic alterne entre vide, `>` et `<`. Les bords sont sauvegardes
avec l'etat de la grille.

### Vudoku

`puzzle_type = sudoku_vudoku`

Alias :

```text
vudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- chaque coin Vudoku occupe trois cases d'un carre 2x2 ;
- la case au sommet du V vaut soit la somme des deux cases de branche, soit
  leur difference absolue.

Le format principal envoye par l'atelier est une matrice 8x8, car chaque coin
se pose sur l'intersection de quatre cases :

```json
{
  "grid": [
    ".A......",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........"
  ]
}
```

Chaque symbole de cette matrice decrit le sommet du V dans le carre 2x2 :

| Symbole | Alias | Sommet | Branches |
|---|---|---|---|
| `A` | `1`, `tl`, `nw` | haut-gauche | haut-droite + bas-gauche |
| `B` | `2`, `tr`, `ne` | haut-droite | haut-gauche + bas-droite |
| `C` | `3`, `bl`, `sw` | bas-gauche | haut-gauche + bas-droite |
| `D` | `4`, `br`, `se` | bas-droite | haut-droite + bas-gauche |

Les valeurs vides acceptees sont `""`, `.`, `0`, `_`, `-` et `?`.

Formats alternatifs acceptes :

```json
[
  {"row": 1, "col": 2, "orientation": "tl"},
  {"row": 4, "col": 5, "corner": "br"}
]
```

`row` et `col` sont 1-based et designent le coin haut-gauche du carre 2x2 qui
porte le V.

Dans l'atelier Theia, la variante `Vudoku` affiche des boutons aux
intersections de cases. Un clic alterne entre vide, haut-gauche, haut-droite,
bas-droite et bas-gauche. Les conflits locaux colorent les trois cases du V
quand les trois valeurs sont saisies mais que la relation somme/difference est
fausse.

### Rossini Sudoku

`puzzle_type = sudoku_rossini`

Alias :

```text
rossini
rossini_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- une fleche de bord impose que les trois premieres cases vues depuis ce bord
  soient strictement ordonnees ;
- le chiffre le plus eleve est toujours dans la direction de la fleche ;
- en mode complet, l'absence de fleche impose que le triplet vu depuis ce bord
  ne soit ni strictement croissant ni strictement decroissant.

Format envoye par l'atelier :

```json
{
  "top": ["", "D", "", "", "", "U", "", "D", ""],
  "bottom": ["", "", "", "U", "", "", "", "", "D"],
  "left": ["", "", "", "", "", "", "L", "", "R"],
  "right": ["", "R", "R", "", "", "", "", "", "R"],
  "enforce_absent": true
}
```

Les quatre tableaux contiennent chacun 9 entrees. Les valeurs vides peuvent etre
`""`, `.`, `0`, `_`, `-` ou `?`. Les fleches Unicode sont acceptees, ainsi que
les formes ASCII `U`, `D`, `L`, `R`, `^`, `v`, `<`, `>`.

Interpretation :

| Bord | Triplet contraint | Fleche croissante dans l'ordre du triplet | Fleche decroissante |
|---|---|---|---|
| `top` | `r1cX`, `r2cX`, `r3cX` | `v` / `D` / `↓` | `^` / `U` / `↑` |
| `bottom` | `r7cX`, `r8cX`, `r9cX` | `v` / `D` / `↓` | `^` / `U` / `↑` |
| `left` | `rXc1`, `rXc2`, `rXc3` | `>` / `R` / `→` | `<` / `L` / `←` |
| `right` | `rXc7`, `rXc8`, `rXc9` | `>` / `R` / `→` | `<` / `L` / `←` |

Dans l'atelier Theia, la variante `Rossini` affiche des boutons de bord autour
de la grille. Un clic alterne les fleches possibles pour le bord concerne puis
revient a vide. Les conflits locaux colorent les trois cases concernees en
rouge avant meme l'appel au solveur.

### Sudoku XV

`puzzle_type = sudoku_xv`

Alias :

```text
xv
xv_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- une marque `X` entre deux cases adjacentes impose une somme egale a 10 ;
- une marque `V` entre deux cases adjacentes impose une somme egale a 5 ;
- en mode complet, l'absence de marque entre deux cases adjacentes impose une
  somme differente de 5 et de 10.

Format envoye par l'atelier :

```json
{
  "horizontal": [
    ".V......",
    "...X....",
    "..V.X...",
    "..V.....",
    "....X.X.",
    "..V.....",
    "X...V...",
    ".X......",
    "....X..."
  ],
  "vertical": [
    "..X..X..X",
    ".......X.",
    "..VV.....",
    ".........",
    "...V.....",
    "..X.X....",
    ".........",
    "........."
  ],
  "enforce_absent": true
}
```

`horizontal` contient 9 lignes de 8 marques. Chaque marque concerne la paire
gauche/droite.

`vertical` contient 8 lignes de 9 marques. Chaque marque concerne la paire
haut/bas.

Les valeurs vides peuvent etre `""`, `.`, `0`, `_` ou `-`. Les marques `x` et
`v` minuscules sont acceptees.

Formats alternatifs acceptes par le moteur :

```json
[
  {"cells": ["r1c2", "r1c3"], "symbol": "V"},
  {"from": "r2c4", "to": "r2c5", "mark": "X"}
]
```

ou des lignes texte :

```text
r1c2Vr1c3
r2c4Xr2c5
```

Dans l'atelier Theia, la variante `Sudoku XV` affiche des emplacements entre
les cases. Un clic alterne entre vide, `X` et `V`. Les emplacements vides
restent visibles car ils representent eux aussi une contrainte.

### Kropki Sudoku

`puzzle_type = sudoku_kropki`

Alias :

```text
kropki
kropki_sudoku
dots_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- un rond blanc entre deux cases adjacentes impose deux chiffres consecutifs ;
- un rond noir entre deux cases adjacentes impose que l'un des deux chiffres
  vaille le double de l'autre ;
- le couple `1` / `2` peut donc satisfaire un rond blanc ou un rond noir ;
- en mode complet, l'absence de rond impose que les deux chiffres ne soient ni
  consecutifs, ni dans un rapport double/moitie.

Format envoye par l'atelier :

```json
{
  "horizontal": [
    ".W.WB...",
    "WB......",
    ".....W..",
    "W.W.....",
    "...B....",
    "......W.",
    ".W..W...",
    "W.W.....",
    "...B.W.."
  ],
  "vertical": [
    ".........",
    ".W..W..BW",
    "......B.W",
    "B.W..WWWB",
    "WW.....BW",
    ".....B...",
    ".......W.",
    ".....WB.."
  ],
  "enforce_absent": true
}
```

`horizontal` contient 9 lignes de 8 marques. Chaque marque concerne la paire
gauche/droite.

`vertical` contient 8 lignes de 9 marques. Chaque marque concerne la paire
haut/bas.

Valeurs acceptees :

| Valeur | Sens |
|---|---|
| `W`, `white`, `o`, `○` | Rond blanc : chiffres consecutifs. |
| `B`, `black`, `●` | Rond noir : rapport double/moitie. |
| `""`, `.`, `0`, `_`, `-` | Absence de rond. |

Formats alternatifs acceptes par le moteur :

```json
[
  {"cells": ["r1c2", "r1c3"], "dot": "white"},
  {"from": "r2c4", "to": "r3c4", "color": "black"}
]
```

ou des lignes texte :

```text
r1c2Wr1c3
r2c4blackr3c4
```

Dans l'atelier Theia, la variante `Kropki` affiche des emplacements entre les
cases. Un clic alterne entre vide, rond blanc et rond noir. Les emplacements
vides restent visibles car ils representent la contrainte negative standard.

### Skyscraper Sudoku

`puzzle_type = sudoku_skyscraper`

Alias :

```text
skyscraper
skyscraper_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- chaque chiffre de la grille est interprete comme une hauteur de batiment ;
- un indice exterieur indique combien de batiments sont visibles quand on lit
  la ligne ou la colonne depuis ce bord ;
- un batiment est visible s'il est plus haut que tous les batiments precedents
  dans la direction de lecture.

Format envoye par l'atelier :

```json
{
  "top": [3, 1, 3, 6, 3, 2, 3, 2, 2],
  "bottom": [1, 3, 3, 2, 5, 2, 3, 2, 4],
  "left": [2, 3, 2, 3, 4, 3, 3, 3, 1],
  "right": [4, 4, 1, 2, 2, 5, 2, 3, 3]
}
```

Les quatre tableaux contiennent chacun 9 entrees. Les valeurs vides peuvent
etre `""`, `.`, `0`, `_`, `-` ou `?`, et signifient qu'aucun indice n'est
pose sur ce bord. Les chaines compactes comme `"313632322"` sont aussi
acceptees.

Interpretation :

| Bord | Sequence contrainte |
|---|---|
| `top` | colonne lue de `r1` vers `r9` |
| `bottom` | colonne lue de `r9` vers `r1` |
| `left` | ligne lue de `c1` vers `c9` |
| `right` | ligne lue de `c9` vers `c1` |

Dans l'atelier Theia, la variante `Skyscraper` affiche des champs numeriques
autour de la grille. Les conflits locaux ne sont signales que lorsque les 9
cases de la ligne ou colonne concernee sont remplies.

### Frame Sudoku / Outside Sum

`puzzle_type = sudoku_frame`

Alias :

```text
frame
frame_sudoku
outside_sum_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- un indice exterieur indique la somme des trois cases les plus proches de ce
  bord dans la ligne ou colonne concernee.

Format envoye par l'atelier :

```json
{
  "top": [15, 18, 12, 11, 21, 13, 15, 17, 13],
  "bottom": [15, 9, 21, 10, 16, 19, 13, 15, 17],
  "left": [8, 15, 22, 11, 13, 21, 18, 19, 8],
  "right": [22, 8, 15, 22, 12, 11, 15, 13, 17]
}
```

Les quatre tableaux contiennent chacun 9 entrees. Les valeurs vides peuvent
etre `""`, `.`, `0`, `_`, `-` ou `?`, et signifient qu'aucun indice n'est
pose sur ce bord. Les chaines separees par espaces, par exemple
`"15 18 12 11 21 13 15 17 13"`, sont aussi acceptees.

Interpretation :

| Bord | Triplet somme |
|---|---|
| `top` | `r1cX`, `r2cX`, `r3cX` |
| `bottom` | `r7cX`, `r8cX`, `r9cX` |
| `left` | `rXc1`, `rXc2`, `rXc3` |
| `right` | `rXc7`, `rXc8`, `rXc9` |

Dans l'atelier Theia, la variante `Frame` affiche des champs numeriques autour
de la grille. Les conflits locaux sont signales des que les trois cases du
triplet concerne sont remplies.

### Outside Sudoku

`puzzle_type = sudoku_outside`

Alias :

```text
outside
outside_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- un chiffre exterieur doit apparaitre dans les trois premieres cases vues
  depuis ce bord, dans la ligne ou colonne concernee ;
- plusieurs chiffres peuvent etre donnes sur le meme bord et le meme index, par
  exemple `"76"`.

Format envoye par l'atelier :

```json
{
  "top": ["4", "21", "", "", "6", "4", "", "7", ""],
  "bottom": ["", "3", "", "", "9", "7", "", "6", ""],
  "left": ["76", "41", "8", "76", "54", "2", "24", "7", "3"],
  "right": ["1", "6", "73", "4", "39", "87", "6", "54", "28"]
}
```

Les quatre tableaux contiennent chacun 9 entrees. Les valeurs vides peuvent
etre `""`, `.`, `0`, `_`, `-` ou `?`, et signifient qu'aucun indice n'est pose
sur ce bord. Chaque entree peut contenir de 1 a 3 chiffres distincts.

Interpretation :

| Bord | Zone de presence |
|---|---|
| `top` | `r1cX`, `r2cX`, `r3cX` |
| `bottom` | `r9cX`, `r8cX`, `r7cX` |
| `left` | `rXc1`, `rXc2`, `rXc3` |
| `right` | `rXc9`, `rXc8`, `rXc7` |

Dans l'atelier Theia, la variante `Outside` affiche des champs autour de la
grille. Les conflits locaux sont signales des que les trois cases concernees
sont remplies.

### Little Killer Sudoku

`puzzle_type = sudoku_little_killer`

Alias :

```text
little_killer
little_killer_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- chaque indice exterieur impose la somme de toute la diagonale visee ;
- les chiffres peuvent se repeter sur cette diagonale, aucune contrainte
  `all_different` supplementaire n'est ajoutee.

Format envoye par l'atelier :

```json
{
  "top": [
    {"total": "2", "direction": "dl"},
    {"total": "11", "direction": "dl"},
    "",
    {"total": "14", "direction": "dl"},
    {"total": "29", "direction": "dl"},
    "",
    {"total": "27", "direction": "dl"},
    "",
    {"total": "29", "direction": "dl"}
  ],
  "left": ["", "", {"total": "26", "direction": "dr"}, "", "", "", "", "", ""],
  "right": ["", "", {"total": "3", "direction": "dl"}, "", "", "", "", "", ""]
}
```

Les quatre tableaux `top`, `bottom`, `left`, `right` contiennent chacun 9
entrees. Une entree vide ignore l'indice. Une entree peut etre un objet
`{"total":29,"direction":"dr"}` ou une notation compacte comme `29dr`.

Directions :

| Direction | Sens |
|---|---|
| `dl` | bas-gauche |
| `dr` | bas-droite |
| `ul` | haut-gauche |
| `ur` | haut-droite |

Dans l'atelier Theia, chaque indice affiche un champ de somme et un bouton de
direction. Les conflits locaux sont signales des que toute la diagonale
concernee est remplie.

### Little Unique Killer Sudoku

`puzzle_type = sudoku_little_unique_killer`

Alias :

```text
little_unique_killer
little_unique_killer_sudoku
unique_little_killer
unique_little_killer_sudoku
```

Contraintes :

- toutes les contraintes du Little Killer Sudoku ;
- chaque diagonale flechee est aussi une region `all_different` ;
- les doublons sont donc interdits dans les cellules qui composent la somme.

Le format d'entree est identique a `sudoku_little_killer` et reutilise le champ
`little_killer`. Dans l'atelier Theia, les memes controles de somme et de
direction sont utilises, avec une detection locale des doublons sur les
diagonales flechees.

### Godoku / Wordoku / Alphabet Sudoku

`puzzle_type = sudoku_godoku`

Alias :

```text
godoku
wordoku
alphabet_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- le domaine contient 9 lettres uniques au lieu des chiffres `1` a `9` ;
- chaque ligne, colonne et bloc 3x3 contient chacune des 9 lettres exactement
  une fois.

Format de grille :

```text
ORESNMBAU
NMUABEROS
SBAOURMNE
BORMESAUN
USNRABEMO
EAMNOUSBR
MNSURAOEB
AUBESONRM
REOBMNUSA
```

Les cases vides peuvent etre notees `0`, `.` ou `_`.

Alphabet :

```json
{
  "alphabet": "ORESNMBAU"
}
```

Si `alphabet` ou `symbols` est absent, le moteur tente d'inferer les 9 lettres
depuis la grille. Cette inference fonctionne seulement si les 9 lettres
distinctes apparaissent deja dans les donnees. Sinon, l'alphabet doit etre
renseigne explicitement.

Dans l'atelier Theia, la variante `Godoku` accepte directement les lettres dans
les cases et dans la saisie rapide. Le champ `Alphabet Godoku` des options sert
a fournir les 9 lettres quand la grille de depart ne les contient pas toutes.

### Even-Odd Sudoku / Pair-Impair

`puzzle_type = sudoku_even_odd`

Alias :

```text
even_odd
evenodd
odd_even_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- chaque case marquee `even` / `pair` doit contenir un chiffre pair ;
- chaque case marquee `odd` / `impair` doit contenir un chiffre impair.

Format des marques de parite :

```json
{
  "parity": {
    "grid": [
      "OOEEOEOOE",
      "EOEOOOOEE",
      "OOEOEEOEO",
      "EOOOEOEEO",
      "EEEEOOOOO",
      "OOOOEEEOE",
      "OEOOOOEEE",
      "EEOEOOEOO",
      "OEOEEEOOO"
    ]
  }
}
```

Valeurs acceptees :

| Marque | Sens |
|---|---|
| `E`, `even`, `pair`, `P` | Case paire. |
| `O`, `odd`, `impair`, `I` | Case impaire. |
| `0`, `.`, `_`, `-`, vide | Aucune contrainte de parite. |

Dans l'atelier Theia, la variante `Even-Odd` ajoute un mode `Parite`. Un clic
sur une case alterne entre vide, pair et impair. Les cases paires sont grises ;
les cases impaires gardent une base claire avec un marqueur central. Les
conflits locaux sont signales si une valeur deja saisie ne respecte pas la
parite marquee.

### Nonogram / Picross

`puzzle_type = nonogram`

Alias :

```text
picross
griddlers
hanjie
```

Contraintes :

- chaque cellule contient soit une case blanche (`.`), soit une case noircie
  (`#`) ;
- chaque ligne doit correspondre exactement a ses blocs de cases noircies ;
- chaque colonne doit correspondre exactement a ses blocs de cases noircies ;
- une grille optionnelle peut imposer des cases deja connues.

Format des indices :

```json
{
  "row_clues": [[1], [3], [5], [3], [1]],
  "column_clues": [[1], [3], [5], [3], [1]]
}
```

Les champs `row_clues` et `column_clues` acceptent aussi un format texte, une
ligne par ligne/colonne :

```text
1
3
5
3
1
```

Une ligne vide de blocs doit etre notee `0`, `.`, `-` ou `_`. La grille
optionnelle accepte `#`, `X`, `1` pour une case noircie ; `.`, `-`, `0` pour
une case blanche ; `?`, `_` pour une case inconnue.

Le moteur encode chaque ligne/colonne comme une contrainte `nonogram_line`.
Cette contrainte enumere les motifs binaires compatibles avec les indices puis
laisse Z3 croiser les contraintes de lignes et de colonnes. Cette approche est
suffisante pour les Nonograms classiques et garde le modele pret pour Hitori,
Kakuro ou d'autres grilles a cellules noircies.

L'atelier Theia expose un plateau Nonogram dynamique : le controle `Lignes x
Colonnes` definit directement les dimensions et affiche leurs valeurs. Les
indices de lignes et de colonnes sont saisis directement autour des cases et
acceptent plusieurs nombres par indice. En mode `Saisie`, une case alterne
entre inconnue, noircie et blanche ; les marques sont
transmises au solveur comme donnees partielles et sont sauvegardees avec le
brouillon de geocache. Le mode `Surveiller` continue de servir a selectionner
les cases de reponse. Un indice qui ne peut pas tenir dans la ligne ou colonne
correspondante est affiche en rouge pendant la saisie.

### Kakuro / Cross Sums

`puzzle_type = kakuro`

Alias :

```text
cross_sums
crosssum
cross_sum
```

Le champ `kakuro` (ou `layout`) contient une matrice JSON. Une cellule est
`black`, `white` ou `clue`. Dans une cellule `clue`, `across` indique la somme
de la serie blanche vers la droite et `down` la somme de la serie blanche vers
le bas.

```json
{
  "cells": [
    ["#", {"down": 4}, {"down": 4}],
    [{"across": 4}, {"kind": "white"}, {"kind": "white"}],
    [{"across": 4}, {"kind": "white"}, {"kind": "white"}]
  ]
}
```

La grille optionnelle `grid` alignee sur cette matrice donne les chiffres deja
poses. Chaque serie impose une contrainte `sum` et `all_different` : les
chiffres vont de 1 a 9, ne se repetent pas, et chaque case blanche appartient
a une unique somme horizontale et une unique somme verticale.

L'atelier Theia affiche les cases noires, les diagonales de sommes et les
cases blanches dans une grille editable. Les outils permettent de convertir une
case en noire, somme ou blanche. Les doublons et les sommes deja depassees sont
colores en rouge avant l'appel au solveur.

### Hitori

`puzzle_type = hitori`

Alias :

```text
hitori_puzzle
```

La grille contient des nombres positifs. Le solveur choisit les cases a rayer
afin que les nombres restants ne se repetent plus sur une ligne ou une colonne.
Une matrice optionnelle `shaded` force des marques deja posees : `#`, `X`, `1`
ou `true` signifient une case rayee.

Les contraintes sont :

- deux cases rayees ne peuvent pas partager un cote ;
- une case rayee doit correspondre a un nombre repete sur sa ligne ou sa
  colonne ;
- toutes les cases non rayees sont connectees par les cotes ;
- toutes les repetitions de ligne et colonne sont couvertes par au moins une
  case rayee.

Les solutions utilisent `#` pour une case rayee. Dans l'atelier Theia, le mode
`Nombres` sert a renseigner la grille et le mode `Rayer` alterne les marques
manuelles. Les rayures adjacentes, les rayures inutiles et les blancs isoles
sont affiches en rouge.

### Slither Link

`puzzle_type = slitherlink`

Aliases :

```text
slither_link
slither
loop_the_loop
surizarinku
```

La grille est une matrice rectangulaire d'indices `0` a `3`. Une case vide,
`.`, `-` ou `_` n'impose aucun indice. L'objet optionnel `edges` contient les
traits deja traces : `horizontal` a `(lignes + 1) x colonnes` et `vertical` a
`lignes x (colonnes + 1)`.

Le solveur applique les contraintes suivantes :

- chaque indice egale le nombre de traits sur les quatre cotes de sa case ;
- chaque point inutilise a degre `0`, chaque point de la boucle a degre `2` ;
- une seule composante de points utilises est autorisee, donc une unique boucle
  fermee non vide est produite.

Les segments de chaque solution sont retournes dans `results[].edges`. Dans
l'atelier Theia, les dimensions, les indices et les traits horizontaux ou
verticaux sont tous editables. Les fleches du clavier parcourent les cases
d'indices.

### Bataille navale / Bimaru

`puzzle_type = battleship`

Aliases :

```text
battleships
bimaru
solitaire_battleships
battleship_solitaire
```

La grille utilise `#`, `X` ou `1` pour un fragment de navire connu, `.`, `~`
ou `0` pour la mer connue, et `?`, `_` ou `-` pour une case inconnue. Les
tableaux `row_totals` et `column_totals` indiquent le nombre de fragments par
ligne et colonne. La flotte est un objet JSON longueur-vers-quantite, par
defaut `{ "1": 4, "2": 3, "3": 2, "4": 1 }`.

Le solveur enumere les emplacements horizontaux et verticaux possibles pour
chaque longueur de navire. Il selectionne exactement le nombre voulu de chaque
taille, couvre chaque fragment une seule fois, respecte les totaux, puis exclut
toute paire de navires qui se touche, y compris par un angle.

Dans l'atelier Theia, les dimensions, les totaux, la flotte et les trois etats
de chaque case (inconnue, navire, mer) sont editables. Les fleches du clavier
parcourent les cases.

### Fillomino

`puzzle_type = fillomino`

Aliases :

```text
polyomino
polyominous
allied_occupation
```

La grille est rectangulaire et contient des nombres positifs. Les cases vides
acceptent `.`, `0`, `_`, `-` ou `?`. Dans une saisie texte, les nombres de plus
d'un chiffre doivent etre separes par des espaces ou des virgules.

Le moteur enumere les polyominos connectes compatibles avec chaque case encore
libre, puis couvre la grille sans recouvrement. Chaque region a exactement le
nombre de cellules indique par sa valeur, et deux regions de meme taille ne
peuvent pas se toucher par un cote. Cette recherche accepte aussi les regions
necessaires qui ne contiennent pas d'indice initial.

L'atelier Theia permet de regler librement les dimensions, de saisir des
nombres a plusieurs chiffres et de parcourir les cases avec les fleches. Un
bloc deja plus grand que sa valeur est colore en rouge.

### Non-Consecutive Sudoku

`puzzle_type = sudoku_non_consecutive`

Alias :

```text
non_consecutive
nonconsecutive_sudoku
```

Contraintes :

- toutes les contraintes du Sudoku classique ;
- chaque paire de cases orthogonalement adjacentes ne peut pas contenir deux
  chiffres consecutifs ;
- les diagonales ne sont pas concernees par cette regle.

Le moteur ajoute 144 contraintes `non_consecutive` :

- 72 paires horizontales ;
- 72 paires verticales.

Exemple interdit :

```text
r1c1 = 3
r1c2 = 2 ou 4
```

Dans l'atelier Theia, la variante `Non-Consecutive` ne demande aucune saisie de
marques supplementaires. Les conflits locaux sont signales en rouge des que
deux cases voisines remplies contiennent des chiffres consecutifs.

### Sudoku Mine

`puzzle_type = sudoku_mine`

Alias :

```text
mine_sudoku
minesudoku
sudoku_mine_9x9
```

La variante `sudoku_mine_6x6` accepte aussi :

```text
mine_sudoku_6x6
minesudoku_6x6
```

Contraintes 9x9 :

- chaque cellule contient soit une mine (`M`), soit aucune mine (`.`) ;
- chaque ligne contient exactement 3 mines ;
- chaque colonne contient exactement 3 mines ;
- chaque bloc 3x3 contient exactement 3 mines ;
- chaque indice numerique impose le nombre de mines dans les cases adjacentes
  horizontalement, verticalement et diagonalement ;
- une case indice ne peut pas contenir de mine.

Contraintes 6x6 :

- meme principe binaire ;
- chaque ligne, colonne et region 2x3 contient exactement 2 mines.

Format de grille :

```text
11.1.....
.......3.
..3....2.
4.....2..
...3..3..
..3.....4
.1...3...
.3.......
......121
```

Pour Sudoku Mine, les chiffres `0` a `8` sont des indices. Les cases inconnues
doivent donc etre saisies avec `.`, `_` ou `-`; `0` n'est pas interprete comme
une case vide dans cette variante.

Dans l'atelier Theia, les indices restent visibles dans la solution et les mines
trouvees sont affichees avec `M`.

### Tripod Sudoku / Sudoku Trepied

`puzzle_type = sudoku_tripod_4x4` a `sudoku_tripod_8x8`

Alias :

```text
tripod
tripod_sudoku
sudoku_tripod
```

Contraintes :

- la taille N est comprise entre 4 et 8 ;
- les chiffres 1 a N apparaissent une seule fois dans chaque ligne ;
- les chiffres 1 a N apparaissent une seule fois dans chaque colonne ;
- le moteur reconstruit N regions connectees de N cases ;
- chaque region reconstruite contient les chiffres 1 a N une seule fois ;
- les points noirs donnes indiquent exactement les intersections ou 3 lignes
  de frontiere se rencontrent ;
- aucun croisement a 4 lignes n'est autorise.

Modele Z3 specialise :

- `values[r,c]` represente le chiffre de la cellule ;
- `regions[r,c]` represente l'identifiant de region reconstruit ;
- `distances[r,c]` force la connectivite de chaque region par distances
  strictement decroissantes vers une racine ;
- une frontiere entre deux cellules adjacentes existe lorsque leurs identifiants
  de region sont differents ;
- le degre de chaque sommet de grille est calcule a partir des segments de
  frontiere incidents et des bords externes.

Format des points :

```json
{
  "tripod": {
    "dots": [
      "......",
      "1....1",
      "1....1",
      "1....1",
      "1....1",
      "......"
    ]
  }
}
```

`tripod.dots` est une matrice (N+1)x(N+1) placee sur les intersections de lignes,
pas sur les cellules. `1`, `x`, `*` ou `#` indiquent un point noir ; `0`, `.`,
`_` ou `-` indiquent une intersection vide.

Dans l'atelier Theia, les variantes `Tripod 4x4` a `Tripod 8x8` affichent des boutons circulaires sur
les intersections. Les points actifs sont noirs. La solution renvoie aussi
`region_grid`, une carte numerotee des regions reconstruites.

## Specification generique `custom_spec`

Le mode `custom_spec` accepte une specification JSON.

Exemple minimal :

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

Champs supportes :

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `variant` | string | non | Nom fonctionnel de la variante. |
| `rows` | number | oui | Nombre de lignes. |
| `cols` | number | oui | Nombre de colonnes. |
| `symbols` | array string | oui | Domaine fini des valeurs. |
| `active_cells` | array cell refs | non | Cellules actives. Par defaut toute la grille. |
| `givens` | object/list | non | Valeurs imposees. |
| `regions` | array arrays | non | Raccourci pour ajouter des `all_different`. |
| `constraints` | array objects | non | Contraintes declaratives. |
| `numeric_values` | object/list | non | Valeurs numeriques des symboles pour `sum`. |

References de cellules acceptees :

```text
r1c1
0,0
[0, 0]
{"row": 1, "col": 1}
{"r": 1, "c": 1}
```

Pour les objets, `base` peut etre fourni :

```json
{"row": 0, "col": 0, "base": 0}
```

Contraintes custom :

```json
{
  "type": "sum",
  "cells": ["r1c1", "r1c2", "r1c3"],
  "total": 6
}
```

ou :

```json
{
  "type": "equals",
  "cell": "r1c1",
  "value": "3"
}
```

## Atelier Theia `Grilles`

Emplacements :

```text
frontend/theia-extensions/plugins/src/browser/grid-puzzle-workbench-widget.tsx
frontend/theia-extensions/plugins/src/browser/grid-puzzle-workbench-contribution.ts
frontend/theia-extensions/plugins/src/browser/style/grid-puzzle-workbench.css
```

Bindings :

```text
frontend/theia-extensions/plugins/src/browser/plugins-frontend-module.ts
```

Contribution :

```ts
GridPuzzleWorkbenchContribution extends AbstractViewContribution<GridPuzzleWorkbenchWidget>
```

Command :

```ts
plugins.openGridPuzzleWorkbench
```

Fonctionnalites actuelles :

- grille interactive 9x9 ;
- saisie au clavier ;
- navigation avec les fleches ;
- suppression avec `Backspace`, `Delete`, `0`, `.`, `_` ;
- traits epais entre les blocs 3x3 ;
- synchronisation grille -> saisie rapide ;
- synchronisation saisie rapide -> grille quand 81 cases sont detectees ;
- mode `Saisie` ;
- mode `Surveiller` ;
- `Ctrl+clic` pour surveiller une cellule en mode saisie ;
- choix de variante `Classique` / `Sudoku X` / `Anti Diagonal` /
  `Center Dot` / `Windoku` / `Girandola` / `Asterisk` / `Sujiken` /
  `Samurai Sudoku` / `Flower Sudoku` / `Sohei Sudoku` / `Kazaguruma` /
  `Greater Than` / `Vudoku` / `Kropki` / `Chain` ;
- diagonales orange en mode Sudoku X ;
- diagonales magenta en mode Anti Diagonal ;
- points verts sur les centres de blocs en mode Center Dot ;
- regions violettes en mode Windoku ;
- cases cyan en mode Girandola ;
- cases magenta en mode Asterisk ;
- rendu triangulaire de 45 cases en mode Sujiken ;
- rendu 21x21 de 369 cases actives en mode Samurai Sudoku ;
- rendu 15x15 de 189 cases actives en mode Flower Sudoku ;
- rendu 21x21 de 288 cases actives en mode Sohei Sudoku ;
- rendu 21x21 de 333 cases actives en mode Kazaguruma ;
- bords cliquables `>` / `<` en mode Greater Than / Compdoku ;
- coins V cliquables aux intersections de cases en mode Vudoku ;
- fleches de bord cliquables en mode Rossini ;
- bords cliquables `X` / `V` en mode Sudoku XV ;
- ronds blancs/noirs cliquables en mode Kropki ;
- mode `Chaines` pour peindre les chaines Strimko ;
- indices exterieurs numeriques en mode Skyscraper ;
- sommes exterieures numeriques en mode Frame ;
- saisie de lettres et alphabet optionnel en mode Godoku ;
- mode `Parite` avec cases pair/impair en mode Even-Odd ;
- detection locale des voisins consecutifs en mode Non-Consecutive ;
- points d'intersection cliquables en mode Tripod ;
- indices lignes/colonnes editables autour de la grille Nonogram ;
- marquage manuel des cases inconnues, noircies ou blanches en mode Nonogram ;
- editeur de cases noires, sommes diagonales et chiffres en mode Kakuro ;
- saisie des nombres et rayage manuel des cases en mode Hitori ;
- dimensions, indices et traits manuels pour Slither Link ;
- dimensions, flotte, totaux et marques manuelles pour Bataille navale ;
- dimensions et nombres multi-chiffres pour Fillomino ;
- affichage de la premiere solution ;
- reprise de la solution dans la grille ;
- extraction des cellules surveillees ;
- sauvegarde/rechargement si l'atelier est ouvert depuis une geocache.

### Etat React principal

| Etat | Type | Role |
|---|---|---|
| `grid` | `string[][]` | Valeurs courantes de la grille. |
| `quickText` | `string` | Representation texte de la grille. |
| `puzzleType` | `sudoku_classic`, variantes classiques `sudoku_4x4` a `sudoku_16x16`, `chain_sudoku_4x4` a `chain_sudoku_9x9`, `sudoku_x`, `sudoku_argyle`, `sudoku_anti_diagonal`, `sudoku_center_dot`, `sudoku_windoku`, `sudoku_girandola`, `sudoku_asterisk`, `sujiken`, `samurai_sudoku`, `flower_sudoku`, `sohei_sudoku`, `kazaguruma_sudoku`, `sudoku_greater_than`, `sudoku_vudoku`, `sudoku_rossini`, `sudoku_xv`, `sudoku_kropki`, `sudoku_skyscraper`, `sudoku_frame`, `sudoku_outside`, `sudoku_little_killer`, `sudoku_little_unique_killer`, `sudoku_godoku`, `sudoku_even_odd`, `sudoku_non_consecutive`, `sudoku_mine`, `sudoku_mine_6x6`, `nonogram`, `kakuro`, `hitori`, `slitherlink`, `battleship`, `fillomino` ou `sudoku_tripod_4x4` a `sudoku_tripod_8x8` | Variante active. |
| `horizontalInequalities` | `string[][]` | Symboles `>` / `<` entre deux cases d'une meme ligne. |
| `verticalInequalities` | `string[][]` | Symboles `>` / `<` entre deux cases d'une meme colonne. |
| `vudokuCorners` | `string[][]` | Coins Vudoku 8x8 : `tl`, `tr`, `bl`, `br` ou vide. |
| `rossiniArrows` | object | Fleches de bord `top`, `bottom`, `left`, `right` pour Rossini. |
| `xvHorizontalMarks` | `string[][]` | Marques `X` / `V` entre deux cases d'une meme ligne. |
| `xvVerticalMarks` | `string[][]` | Marques `X` / `V` entre deux cases d'une meme colonne. |
| `kropkiHorizontalDots` | `string[][]` | Ronds `white` / `black` entre deux cases d'une meme ligne. |
| `kropkiVerticalDots` | `string[][]` | Ronds `white` / `black` entre deux cases d'une meme colonne. |
| `skyscraperClues` | object | Indices exterieurs `top`, `bottom`, `left`, `right` pour Skyscraper. |
| `frameClues` | object | Sommes exterieures `top`, `bottom`, `left`, `right` pour Frame. |
| `outsideClues` | object | Chiffres exterieurs `top`, `bottom`, `left`, `right` pour Outside. |
| `littleKillerClues` | object | Sommes et directions diagonales `top`, `bottom`, `left`, `right` pour Little Killer. |
| `godokuAlphabet` | string | Alphabet de 9 lettres pour Godoku. |
| `nonogramRowClues` | string | Indices de lignes Nonogram, une entree par ligne. |
| `nonogramColumnClues` | string | Indices de colonnes Nonogram, une entree par colonne. |
| `kakuroLayout` | `KakuroCell[][]` | Cases `black`, `clue` (sommes `across` / `down`) et `white` du Kakuro. |
| `hitoriRows`, `hitoriCols` | number | Dimensions de la grille Hitori. |
| `hitoriShaded` | `boolean[][]` | Cases rayees manuellement dans Hitori. |
| `slitherRows`, `slitherCols` | number | Dimensions de la grille Slither Link. |
| `slitherEdges` | object | Traits `horizontal` et `vertical` manuels du Slither Link. |
| `battleshipRows`, `battleshipCols` | number | Dimensions de la grille Bataille navale. |
| `battleshipRowTotals`, `battleshipColumnTotals` | `string[]` | Totaux de lignes et colonnes Bataille navale. |
| `battleshipFleet` | object | Quantite de navires par longueur. |
| `fillominoRows`, `fillominoCols` | number | Dimensions de la grille Fillomino. |
| `parityMarks` | `string[][]` | Marques `even` / `odd` par cellule pour Even-Odd. |
| `tripodDots` | `boolean[][]` | Points noirs (N+1)x(N+1) aux intersections pour Tripod. |
| `chainGrid` | `number[][]` | Affectation des chaines Chain / Strimko. |
| `activeChain` | number | Chaine peinte par le mode `Chaines`. |
| `watchCells` | `string[]` | Cellules surveillees au format `r1c1`. |
| `mode` | `edit`, `watch`, `parity` ou `chain` | Mode d'interaction. |
| `maxSolutions` | number | Limite d'enumeration. |
| `timeoutMs` | number | Timeout Z3. |
| `solveState` | object | Etat d'execution et resultat. |
| `persistence` | object | Etat de chargement/sauvegarde. |

### Saisie rapide

La representation texte est produite par :

```ts
gridToText(grid)
```

Les cellules vides sont serialisees en `0`.

Le texte est interprete par :

```ts
parseGridText(text)
```

La grille n'est mise a jour automatiquement depuis le textarea que si le texte
contient exactement 81 tokens interpretables. Cela permet de coller une grille
complete sans casser la grille pendant une saisie partielle.

### Navigation clavier

La grille garde des refs HTML :

```ts
cellRefs.current[row][col]
```

Les fleches appellent :

```ts
focusCell(row + deltaRow, col + deltaCol)
```

Le focus est borne a la grille.

## Integration avec les details de geocache

Fichiers :

```text
frontend/theia-extensions/zones/src/browser/geocache-details-widget.tsx
frontend/theia-extensions/zones/src/browser/geocache-details-sections.tsx
```

Le widget de details injecte :

```ts
GridPuzzleWorkbenchContribution
```

Puis expose :

```ts
openGridPuzzleWorkbench()
```

Cette methode construit le meme `GeocacheContext` que le Plugin Executor et
ouvre l'atelier :

```ts
this.gridPuzzleWorkbenchContribution.openWithContext(context)
```

Un bouton visible `# Grilles` est affiche dans l'entete de la geocache.

Le menu `Analyser > Grilles` reste disponible.

## Routage depuis la liste des plugins

Fichier :

```text
frontend/theia-extensions/plugins/src/browser/plugins-contribution.ts
```

Le plugin `grid_puzzle_solver` est un cas particulier.

Quand l'utilisateur clique sur ce plugin dans la liste des plugins, GeoApp
n'ouvre pas le formulaire generique du Plugin Executor. Il ouvre directement
l'atelier `Grilles`.

Constante :

```ts
PluginsCommands.GRID_PUZZLE_SOLVER_PLUGIN = 'grid_puzzle_solver'
```

## Persistance par geocache

Modele SQLAlchemy :

```text
backend/gc_backend/geocaches/models.py
```

Classe :

```python
class GeocachePuzzleState(db.Model):
    __tablename__ = 'geocache_puzzle_state'
```

Colonnes :

| Colonne | Type | Role |
|---|---|---|
| `id` | integer | Cle primaire. |
| `geocache_id` | integer FK | Geocache associee. |
| `puzzle_type` | string | Variante (`sudoku_classic`, `sudoku_x`, etc.). |
| `state_key` | string | Cle secondaire, defaut `default`. |
| `title` | string | Libelle humain. |
| `state_json` | text | Etat UI serialise. |
| `created_at` | datetime | Creation. |
| `updated_at` | datetime | Derniere modification. |

Contrainte unique :

```text
(geocache_id, puzzle_type, state_key)
```

Cela permet de stocker separement :

- un Sudoku classique pour une cache ;
- un Sudoku X pour la meme cache ;
- plus tard plusieurs grilles d'une meme variante avec des `state_key`
  differents.

## API de persistance

Blueprint :

```text
backend/gc_backend/blueprints/puzzle_states.py
```

Routes :

| Methode | Route | Role |
|---|---|---|
| `GET` | `/api/geocaches/<id>/puzzle-states` | Liste tous les etats de la geocache. |
| `GET` | `/api/geocaches/<id>/puzzle-states/current?puzzle_type=...&state_key=...` | Recupere un etat. |
| `PUT` | `/api/geocaches/<id>/puzzle-states/current` | Cree ou met a jour un etat. |
| `DELETE` | `/api/geocaches/<id>/puzzle-states/current?puzzle_type=...&state_key=...` | Supprime un etat. |

Payload de sauvegarde :

```json
{
  "puzzle_type": "sudoku_x",
  "state_key": "default",
  "title": "Sudoku X GC12345",
  "state": {
    "grid": [["", "", ""], "..."],
    "puzzleType": "sudoku_x",
    "quickText": "000000000\n...",
    "inequalities": {
      "horizontal": [["", ">", ""], "..."],
      "vertical": [["", "<", ""], "..."]
    },
    "vudoku": {
      "grid": [
        ["", "tl", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "br", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", ""]
      ]
    },
    "rossini": {
      "top": ["", "D", "", "", "", "U", "", "D", ""],
      "bottom": ["", "", "", "", "", "", "", "", ""],
      "left": ["", "", "", "", "", "", "", "", ""],
      "right": ["", "", "", "", "", "", "", "", ""]
    },
    "xv": {
      "horizontal": [["", "V", "", "", "", "", "", ""], "..."],
      "vertical": [["", "", "X", "", "", "X", "", "", "X"], "..."]
    },
    "kropki": {
      "horizontal": [["", "white", "", "white", "black", "", "", ""], "..."],
      "vertical": [["", "", "", "", "", "", "", "", ""], "..."]
    },
    "chains": {
      "grid": [
        [1, 1, 2, 2],
        [3, 3, 4, 4],
        [2, 2, 1, 1],
        [4, 4, 3, 3]
      ]
    },
    "skyscraper": {
      "top": ["3", "1", "3", "6", "3", "2", "3", "2", "2"],
      "bottom": ["1", "3", "3", "2", "5", "2", "3", "2", "4"],
      "left": ["2", "3", "2", "3", "4", "3", "3", "3", "1"],
      "right": ["4", "4", "1", "2", "2", "5", "2", "3", "3"]
    },
    "frame": {
      "top": ["15", "18", "12", "11", "21", "13", "15", "17", "13"],
      "bottom": ["15", "9", "21", "10", "16", "19", "13", "15", "17"],
      "left": ["8", "15", "22", "11", "13", "21", "18", "19", "8"],
      "right": ["22", "8", "15", "22", "12", "11", "15", "13", "17"]
    },
    "littleKiller": {
      "top": [{"total": "29", "direction": "dr"}],
      "bottom": [],
      "left": [],
      "right": []
    },
    "godokuAlphabet": "ORESNMBAU",
    "watchCells": ["r1c1", "r9c9"],
    "maxSolutions": 2,
    "solverTimeoutMs": 10000,
    "lastResult": {},
    "updatedAt": "2026-05-31T12:00:00.000Z"
  }
}
```

Reponse :

```json
{
  "geocache_id": 123,
  "created": false,
  "state": {
    "id": 1,
    "geocache_id": 123,
    "puzzle_type": "sudoku_x",
    "state_key": "default",
    "title": "Sudoku X GC12345",
    "state": {},
    "created_at": "2026-05-31T12:00:00+00:00",
    "updated_at": "2026-05-31T12:05:00+00:00"
  }
}
```

## Client frontend de persistance

Fichiers :

```text
frontend/theia-extensions/plugins/src/common/plugin-protocol.ts
frontend/theia-extensions/plugins/src/browser/services/plugins-service.ts
```

Types :

```ts
PuzzleStateRecord
PuzzleStateListResponse
PuzzleStateGetResponse
PuzzleStateSaveRequest
PuzzleStateSaveResponse
PuzzleStateDeleteResponse
```

Methodes :

```ts
listPuzzleStates(geocacheId: number)
getPuzzleState(geocacheId: number, puzzleType?: string, stateKey?: string)
savePuzzleState(geocacheId: number, request: PuzzleStateSaveRequest)
deletePuzzleState(geocacheId: number, puzzleType?: string, stateKey?: string)
```

## Tests

Tests du moteur :

```text
backend/tests/test_grid_puzzle_solver_plugin.py
```

Couverture actuelle :

- Sudoku classique avec solution unique ;
- grille Sudoku invalide ;
- Sudokus classiques 4x4, 6x6, 8x8, 10x10, 12x12, 15x15 et 16x16 valides ;
- Sudoku classique multi-taille refuse un doublon de ligne ;
- Chain / Strimko valide avec chaines compatibles ;
- Chain / Strimko refuse un doublon dans une chaine ;
- Sudoku X valide ;
- grille classique complete refusee en Sudoku X ;
- Argyle valide ;
- grille classique complete refusee en Argyle ;
- Anti Diagonal valide ;
- grille classique complete refusee en Anti Diagonal ;
- Center Dot valide ;
- grille classique complete refusee en Center Dot ;
- Windoku valide ;
- grille classique complete refusee en Windoku ;
- Girandola valide ;
- grille classique complete refusee en Girandola ;
- Asterisk valide ;
- grille classique complete refusee en Asterisk ;
- Sujiken valide ;
- Sujiken refuse une valeur repetee dans une colonne ;
- Samurai Sudoku valide ;
- Samurai Sudoku refuse une valeur repetee dans une ligne ;
- Flower Sudoku valide ;
- Flower Sudoku refuse une valeur repetee dans une ligne ;
- Sohei Sudoku valide ;
- Sohei Sudoku refuse une valeur repetee dans une ligne ;
- Kazaguruma Sudoku valide ;
- Kazaguruma Sudoku refuse une valeur repetee dans une ligne ;
- Greater Than valide avec une relation adjacente compatible ;
- Greater Than refuse une relation adjacente contradictoire ;
- Vudoku valide avec un coin compatible ;
- Vudoku refuse un coin contradictoire ;
- Rossini valide avec des fleches de bord compatibles ;
- Rossini refuse une fleche de bord contradictoire ;
- Sudoku XV valide avec marques de bord compatibles ;
- Sudoku XV refuse une marque de bord contradictoire ;
- Kropki valide avec ronds et absences de ronds compatibles ;
- Kropki refuse un rond contradictoire ;
- Skyscraper valide avec indices exterieurs compatibles ;
- Skyscraper refuse un indice exterieur contradictoire ;
- Frame valide avec sommes exterieures compatibles ;
- Frame refuse une somme exterieure contradictoire ;
- Godoku valide avec symboles lettres ;
- Godoku refuse une lettre repetee dans une ligne ;
- Even-Odd valide avec marques pair/impair compatibles ;
- Even-Odd refuse une marque pair/impair contradictoire ;
- Non-Consecutive valide une grille sans voisins consecutifs ;
- Non-Consecutive refuse une grille avec voisins consecutifs ;
- Nonogram valide un Picross 5x5 unique ;
- Nonogram refuse une case donnee contradictoire ;
- Kakuro resout des sommes croisees avec chiffres distincts ;
- Kakuro refuse un doublon dans une meme somme ;
- Hitori raye les doublons tout en gardant les blancs connectes ;
- Hitori refuse deux rayures adjacentes ;
- Slither Link resout une boucle unique et retourne ses segments ;
- Slither Link refuse un trait force autour d'un indice `0` ;
- Bataille navale place une flotte sans contacts et respecte les totaux ;
- Bataille navale refuse deux fragments connus en diagonale ;
- Fillomino construit des regions connectees de tailles imposees ;
- Tripod valide avec reconstruction de regions ;
- Tripod refuse un point noir impossible ;
- extraction des cellules surveillees ;
- spec generique type Latin square.

Tests de persistance :

```text
backend/tests/test_puzzle_states_api.py
```

Couverture actuelle :

- lecture d'un etat absent ;
- creation et mise a jour ;
- listage ;
- suppression ;
- validation `state` objet ;
- geocache inexistante.

Commandes utiles :

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_grid_puzzle_solver_plugin.py
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_puzzle_states_api.py
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_grid_puzzle_solver_plugin.py backend\tests\test_puzzle_states_api.py
```

Build frontend :

```powershell
cd frontend
yarn workspace @mysterai/theia-plugins build
yarn workspace theia-ide-zones-ext build
```

Verification de whitespace :

```powershell
git diff --check
```

## Ajouter une nouvelle variante Sudoku

Exemple : Sudoku diagonal supplementaire, Sudoku anti-roi, Sudoku pair/impair.

Etapes recommandees :

1. Ajouter une valeur `puzzle_type` dans `main.py`.
2. Construire le probleme via `_build_sudoku_problem(...)` ou un nouveau
   builder dedie.
3. Ajouter les contraintes propres a la variante.
4. Mettre a jour `plugin.json`.
5. Ajouter l'option dans `GridPuzzleWorkbenchWidget`.
6. Ajouter les classes CSS de visualisation ou les controles d'edition si la
   variante a des zones ou des bords visibles.
7. Ajouter au moins deux tests :
   - une grille valide ;
   - une grille invalide ou un cas qui prouve la contrainte supplementaire.
8. Mettre a jour `README.md` et cette documentation si la variante devient
   publique.

Pour une contrainte de region :

```python
constraints.append(
    GridConstraint("all_different", tuple(cells))
)
```

Pour une valeur imposee :

```python
constraints.append(
    GridConstraint("equals", ((row, col),), value="5")
)
```

Pour une somme :

```python
constraints.append(
    GridConstraint("sum", tuple(cells), total=23)
)
```

## Ajouter une variante non Sudoku

Pour une variante vraiment differente, preferer `custom_spec` ou un builder
dedie qui retourne `GridCspProblem`.

Checklist :

1. Definir `rows`, `cols`, `symbols`.
2. Definir `active_cells`.
3. Parser les valeurs donnees.
4. Ajouter les contraintes.
5. Definir `numeric_values` si des sommes ou calculs sont necessaires.
6. Verifier que le resultat peut etre rendu dans l'UI actuelle ou prevoir un
   nouveau workbench specialise.

Exemple de builder :

```python
def _build_my_variant_problem(self, raw_input: Any) -> GridCspProblem:
    rows = 5
    cols = 5
    symbols = ["black", "white"]
    active_cells = [(row, col) for row in range(rows) for col in range(cols)]
    constraints = [
        GridConstraint("not_equal", ((0, 0), (0, 1))),
    ]
    return GridCspProblem(
        rows=rows,
        cols=cols,
        symbols=symbols,
        active_cells=active_cells,
        givens={},
        constraints=constraints,
        numeric_values={"black": 0, "white": 1},
        variant="my_variant",
    )
```

## Limites actuelles

Le moteur est deja generique, mais l'UI actuelle est encore orientee Sudoku.

Limites connues :

- l'atelier reste principalement oriente Sudoku, avec des rendus dedies pour
  Sujiken, Samurai Sudoku, Flower Sudoku, Sohei Sudoku et Kazaguruma ;
- les symboles UI sont limites aux chiffres `1-9` ;
- une seule grille par variante est exposee dans l'UI (`state_key = default`) ;
- pas encore d'editeur visuel pour regions irregulieres ;
- la validation visuelle des indices Nonogram/Picross reste elementaire et ne
  detecte pas encore toutes les contradictions entre les cases marquees ;
- pas encore d'editeur de contraintes custom ;
- les grilles de mots ou a noircir necessiteront probablement un nouveau mode
  UI au-dessus du meme stockage et/ou du meme moteur.

## Decisions d'architecture

### Pourquoi Z3 ?

Z3 permet de modeliser un grand nombre de variantes de grilles avec des
contraintes declaratives :

- egalite ;
- difference ;
- regions ;
- sommes ;
- contraintes conditionnelles futures ;
- recherche de plusieurs solutions ;
- preuve d'absence de solution.

Il evite de coder un solveur specifique pour chaque famille de grilles.

### Pourquoi stocker un JSON d'etat ?

Les variantes futures auront des besoins UI differents. Un JSON souple permet
de stocker :

- grille ;
- variante ;
- cellules surveillees ;
- options ;
- dernier resultat ;
- metadata future.

Le couple `(puzzle_type, state_key)` fournit la structure minimale sans figer
le contenu.

### Pourquoi separer plugin et workbench ?

Le plugin est un moteur executable par l'infrastructure GeoApp.

L'atelier est une experience utilisateur specialisee :

- navigation clavier ;
- saisie visuelle ;
- marquage de cellules ;
- sauvegarde de brouillon ;
- rendu de variantes.

Cette separation permet de reutiliser le moteur ailleurs, tout en gardant une
UI confortable pour les usages frequents.

## Fichiers a surveiller lors des evolutions

| Besoin | Fichiers a modifier |
|---|---|
| Nouvelle contrainte moteur | `plugins/official/grid_puzzle_solver/main.py` |
| Nouveau champ d'entree plugin | `plugins/official/grid_puzzle_solver/plugin.json` |
| Nouvelle variante visible dans l'UI | `grid-puzzle-workbench-widget.tsx`, `grid-puzzle-workbench.css` |
| Nouveau stockage UI | `puzzle_states.py`, `GeocachePuzzleState`, `plugin-protocol.ts`, `plugins-service.ts` |
| Nouveau bouton depuis geocache | `geocache-details-widget.tsx`, `geocache-details-sections.tsx` |
| Tests moteur | `backend/tests/test_grid_puzzle_solver_plugin.py` |
| Tests API stockage | `backend/tests/test_puzzle_states_api.py` |

## Commandes de reprise rapide

Depuis la racine du projet :

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend\tests\test_grid_puzzle_solver_plugin.py backend\tests\test_puzzle_states_api.py
```

Depuis `frontend` :

```powershell
yarn workspace @mysterai/theia-plugins build
yarn workspace theia-ide-zones-ext build
```

Puis redemarrer :

- le backend Flask si `main.py`, `requirements.txt`, models ou blueprints ont
  change ;
- l'interface Theia si les fichiers frontend ont change.
