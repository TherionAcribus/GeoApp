import importlib.util
import sys
from pathlib import Path


def load_plugin():
    plugin_path = Path(__file__).parents[2] / "plugins" / "official" / "equation_solver" / "main.py"
    spec = importlib.util.spec_from_file_location("equation_solver_plugin", plugin_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.EquationSolverPlugin()


def test_equation_chain_columns_are_simplified():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "equations": """
N                                                             E

w1 - w2 = x                                          w1 - w2 = x1
x * 6 = y                                            x1 * 11 = y1
w3 + y = z                                           w3 - y1 = z1
z + 0.212 = ?                                        z1 - 0.157 = ?
""",
            "mode": "auto",
        }
    )

    assert result["status"] == "ok"
    outputs = [item["parameters"]["expression"] for item in result["results"]]
    assert outputs == [
        "6*w1 - 6*w2 + w3 + 0.212",
        "-11*w1 + 11*w2 + w3 - 0.157",
    ]


def test_known_values_evaluate_requested_results():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "equations": """
w1 - w2 = x
x * 6 = y
w3 + y = z
z + 0.212 = north?
""",
            "known_values": '{"w1": 10, "w2": 3, "w3": 1}',
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["parameters"]["label"] == "north"
    assert result["results"][0]["parameters"]["value"] == "43.212000000000"


def test_system_solving():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "equations": """
2*x + y = 7
x - y = 1
""",
            "mode": "solve",
            "solve_for": "x, y",
        }
    )

    assert result["status"] == "ok"
    assert result["solutions"] == [{"x": "8/3", "y": "5/3"}]


def test_common_implicit_multiplication_without_splitting_numbered_symbols():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "equations": """
w1 = 10
w2 = 3
2x + y = 7
x - y = 1
w1 - w2 = delta?
""",
            "mode": "auto",
        }
    )

    assert result["status"] == "ok"
    assert result["results"][0]["parameters"]["expression"] == "7"
