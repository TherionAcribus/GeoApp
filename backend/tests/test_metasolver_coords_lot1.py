"""Tests des corrections Lot 1 sur le metasolver.

- 1.3 : le toggle ``detect_coordinates`` est propagé aux sous-plugins
- 1.4 : ``primary_coordinates`` est déterministe (ordre de priorité, pas d'achèvement)
"""

import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin  # noqa: E402


class _CapturingManager:
    """Capture les inputs reçus par chaque sous-plugin.

    ``specs`` : dict name -> {priority, input_types, coordinates, sleep}.
    """

    def __init__(self, specs):
        self._specs = specs
        self.plugins_dir = "/nonexistent"
        self.received_inputs = {}

    def list_plugins(self, enabled_only=True):
        return [{"name": n} for n in self._specs]

    def get_plugin_info(self, name):
        spec = self._specs[name]
        return {
            "metadata": {
                "metasolver": {"eligible": True, "priority": spec.get("priority", 50)},
                "capabilities": {"decode": True, "analyze": True},
                "input_types": spec.get("input_types", {}),
            }
        }

    def execute_plugin(self, name, inputs):
        self.received_inputs[name] = dict(inputs)
        spec = self._specs[name]
        if spec.get("sleep"):
            time.sleep(spec["sleep"])
        result = {
            "status": "ok",
            "summary": "ok",
            "results": [{"text_output": f"{name}_out", "confidence": 0.5}],
        }
        if spec.get("coordinates"):
            result["primary_coordinates"] = spec["coordinates"]
        return result


# ─────────────────────────────────────────────────────────────────────────────
# 1.3 — Propagation du toggle detect_coordinates
# ─────────────────────────────────────────────────────────────────────────────

def _run(specs, inputs):
    plugin = MetaSolverPlugin()
    manager = _CapturingManager(specs)
    plugin.set_plugin_manager(manager)
    response = plugin.execute({"text": "ABCDE", "mode": "decode", "preset": "all", **inputs})
    return response, manager


def test_detect_coordinates_false_is_propagated():
    specs = {
        "p_dc": {"input_types": {"detect_coordinates": {"type": "checkbox"}}},
        "p_gps": {"input_types": {"enable_gps_detection": {"type": "checkbox"}}},
    }
    _, manager = _run(specs, {"detect_coordinates": False})

    assert manager.received_inputs["p_dc"]["detect_coordinates"] is False
    assert manager.received_inputs["p_gps"]["enable_gps_detection"] is False


def test_detect_coordinates_true_is_propagated():
    specs = {
        "p_dc": {"input_types": {"detect_coordinates": {"type": "checkbox"}}},
    }
    _, manager = _run(specs, {"detect_coordinates": True})

    assert manager.received_inputs["p_dc"]["detect_coordinates"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 1.4 — primary_coordinates déterministe
# ─────────────────────────────────────────────────────────────────────────────

_COORDS_HIGH = {"exist": True, "ddm": "N 48° 39.286 E 006° 11.685"}
_COORDS_LOW = {"exist": True, "ddm": "N 12° 00.000 E 001° 00.000"}


def test_primary_coordinates_follows_priority_execute():
    # p_high plus prioritaire mais plus lent : il termine EN DERNIER.
    specs = {
        "p_high": {"priority": 90, "coordinates": _COORDS_HIGH, "sleep": 0.05},
        "p_low": {"priority": 10, "coordinates": _COORDS_LOW},
    }
    response, _ = _run(specs, {})
    # Malgré l'achèvement tardif, la priorité l'emporte de façon déterministe.
    assert response["primary_coordinates"] == _COORDS_HIGH


def test_primary_coordinates_deterministic_streaming():
    specs = {
        "p_high": {"priority": 90, "coordinates": _COORDS_HIGH, "sleep": 0.05},
        "p_low": {"priority": 10, "coordinates": _COORDS_LOW},
    }
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_CapturingManager(specs))
    events = list(plugin.execute_streaming({"text": "ABCDE", "mode": "decode", "preset": "all"}))
    final = events[-1]["data"]
    assert final["primary_coordinates"] == _COORDS_HIGH


def test_primary_coordinates_none_when_no_coords():
    specs = {"p1": {"priority": 50}, "p2": {"priority": 40}}
    response, _ = _run(specs, {})
    assert response["primary_coordinates"] is None
