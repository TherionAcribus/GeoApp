# Grid Puzzle Solver - Documentation technique

Ce document decrit l'architecture technique du solveur de grilles GeoApp :
moteur Z3, plugin officiel `grid_puzzle_solver`, atelier Theia `Grilles`,
persistance par geocache et points d'extension pour de futures variantes.

## Objectifs

Le systeme doit fournir une base generique pour resoudre des jeux de grilles,
pas seulement des Sudokus.

Les objectifs actuels sont :

- resoudre un Sudoku classique 9x9 ;
- resoudre un Sudoku X avec contraintes sur les deux diagonales principales ;
- resoudre un Sudoku Center Dot avec une extra-region formee par les centres
  des 9 blocs 3x3 ;
- resoudre un Windoku avec quatre extra-regions 3x3 ;
- resoudre un Sudoku Girandola avec une extra-region de 9 cases ;
- resoudre un Greater Than Sudoku / Compdoku avec contraintes `>` et `<`
  entre cases adjacentes ;
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
| `solver_timeout_ms` | number | `10000` | Timeout interne Z3. |
| `inequalities` | object/list/string | vide | Contraintes `>` / `<` pour Greater Than / Compdoku. |
| `comparisons` | object/list/string | vide | Alias de `inequalities`. |
| `watched_cells` | string/list | vide | Cellules a extraire apres resolution. |
| `watch_cells` | string/list | vide | Alias de `watched_cells`. |

Valeurs supportees pour `puzzle_type` :

| Valeur | Aliases | Role |
|---|---|---|
| `sudoku_classic` | `sudoku`, `classic_sudoku` | Sudoku 9x9 standard. |
| `sudoku_x` | `x_sudoku`, `diagonal_sudoku` | Sudoku standard + diagonales principales sans doublons. |
| `sudoku_center_dot` | `center_dot`, `centerdot_sudoku` | Sudoku standard + extra-region des centres de blocs 3x3. |
| `sudoku_windoku` | `windoku`, `hyper_sudoku`, `four_box_sudoku` | Sudoku standard + quatre extra-regions 3x3. |
| `sudoku_girandola` | `girandola`, `girandole_sudoku` | Sudoku standard + extra-region Girandola de 9 cases. |
| `sudoku_greater_than` | `greater_than`, `compdoku`, `inequality_sudoku` | Sudoku standard + comparaisons `>` / `<` entre cases adjacentes. |
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
```

Contraintes supportees :

| `kind` | Champs utiles | Semantique |
|---|---|---|
| `all_different` | `cells` | Toutes les cellules ont des valeurs distinctes. |
| `equals` | `cells`, `value` | Une cellule vaut une valeur precise. |
| `not_equal` | `cells` | Equivalent a `all_different` sur au moins deux cellules. |
| `sum` | `cells`, `total` | Somme numerique des cellules egale au total. |
| `greater_than` | `cells` | La premiere cellule est strictement superieure a la seconde. |
| `less_than` | `cells` | La premiere cellule est strictement inferieure a la seconde. |

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
- choix de variante `Classique` / `Sudoku X` / `Center Dot` / `Windoku` /
  `Girandola` / `Greater Than` ;
- diagonales orange en mode Sudoku X ;
- points verts sur les centres de blocs en mode Center Dot ;
- regions violettes en mode Windoku ;
- cases cyan en mode Girandola ;
- bords cliquables `>` / `<` en mode Greater Than / Compdoku ;
- affichage de la premiere solution ;
- reprise de la solution dans la grille ;
- extraction des cellules surveillees ;
- sauvegarde/rechargement si l'atelier est ouvert depuis une geocache.

### Etat React principal

| Etat | Type | Role |
|---|---|---|
| `grid` | `string[][]` | Valeurs courantes de la grille. |
| `quickText` | `string` | Representation texte de la grille. |
| `puzzleType` | `sudoku_classic`, `sudoku_x`, `sudoku_center_dot`, `sudoku_windoku`, `sudoku_girandola` ou `sudoku_greater_than` | Variante active. |
| `horizontalInequalities` | `string[][]` | Symboles `>` / `<` entre deux cases d'une meme ligne. |
| `verticalInequalities` | `string[][]` | Symboles `>` / `<` entre deux cases d'une meme colonne. |
| `watchCells` | `string[]` | Cellules surveillees au format `r1c1`. |
| `mode` | `edit` ou `watch` | Mode d'interaction. |
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
- Sudoku X valide ;
- grille classique complete refusee en Sudoku X ;
- Center Dot valide ;
- grille classique complete refusee en Center Dot ;
- Windoku valide ;
- grille classique complete refusee en Windoku ;
- Girandola valide ;
- grille classique complete refusee en Girandola ;
- Greater Than valide avec une relation adjacente compatible ;
- Greater Than refuse une relation adjacente contradictoire ;
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

- l'atelier affiche uniquement une grille 9x9 ;
- les symboles UI sont limites aux chiffres `1-9` ;
- une seule grille par variante est exposee dans l'UI (`state_key = default`) ;
- pas encore d'editeur visuel pour regions irregulieres ;
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
