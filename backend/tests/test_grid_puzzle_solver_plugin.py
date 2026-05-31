import importlib.util
import sys
from pathlib import Path


def load_plugin():
    plugin_path = (
        Path(__file__).parents[2]
        / "plugins"
        / "official"
        / "grid_puzzle_solver"
        / "main.py"
    )
    spec = importlib.util.spec_from_file_location("grid_puzzle_solver_plugin", plugin_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.GridpuzzlesolverPlugin()


def test_classic_sudoku_solution_is_unique():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_classic",
            "grid": """
                530070000
                600195000
                098000060
                800060003
                400803001
                700020006
                060000280
                000419005
                000080079
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["solution_count"] == 1
    assert result["results"][0]["text_output"].splitlines()[0] == "5 3 4 6 7 8 9 1 2"
    assert result["results"][0]["grid"][8] == ["3", "4", "5", "2", "8", "6", "1", "7", "9"]


def test_invalid_sudoku_reports_clear_error():
    plugin = load_plugin()

    result = plugin.execute({"puzzle_type": "sudoku_classic", "grid": "123"})

    assert result["status"] == "error"
    assert "81 cases" in result["summary"]


def test_sudoku_x_accepts_diagonal_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_x",
            "grid": """
                153872694
                982164357
                647953218
                764219583
                529738461
                318645729
                431586972
                276391845
                895427136
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_x"
    assert result["metadata"]["constraint_count"] == 29


def test_sudoku_x_rejects_classic_grid_with_repeated_diagonal_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_x",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_watched_cells_are_extracted_in_requested_order():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_classic",
            "grid": """
                530070000
                600195000
                098000060
                800060003
                400803001
                700020006
                060000280
                000419005
                000080079
            """,
            "watched_cells": "r1c1 r1c2 r9c9",
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["watched_values"] == {"r1c1": "5", "r1c2": "3", "r9c9": "9"}
    assert result["watched_text"] == "539"
    assert result["results"][0]["watched_text"] == "539"


def test_custom_spec_can_solve_latin_square():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "custom_spec",
            "spec": """
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
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is False
    assert result["solution_count"] == 2
    assert result["metadata"]["variant"] == "mini_latin_square"
