"""Test de parité execute() vs execute_streaming().

Garantit que la réponse finale des deux modes est identique (hors timing), afin de
sécuriser la factorisation du Lot 2 (execute délègue à execute_streaming).
"""

import copy
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin  # noqa: E402


class _ScrambledManager:
    """Plugins avec priorités variées, ordres d'achèvement mélangés, et un échec."""

    def __init__(self):
        # name -> (priority, sleep_s, behaviour)
        self._specs = {
            "p_alpha": {"priority": 90, "sleep": 0.04, "ok": True},
            "p_beta": {"priority": 70, "sleep": 0.0, "ok": True},
            "p_gamma": {"priority": 50, "sleep": 0.02, "ok": False},   # échec métier
            "p_delta": {"priority": 30, "sleep": 0.0, "ok": True},
        }
        self.plugins_dir = "/nonexistent"

    def list_plugins(self, enabled_only=True):
        return [{"name": n} for n in self._specs]

    def get_plugin_info(self, name):
        spec = self._specs[name]
        return {
            "metadata": {
                "metasolver": {"eligible": True, "priority": spec["priority"]},
                "capabilities": {"decode": True, "analyze": True},
                "input_types": {},
            }
        }

    def execute_plugin(self, name, inputs):
        spec = self._specs[name]
        if spec["sleep"]:
            time.sleep(spec["sleep"])
        if not spec["ok"]:
            return {"status": "error", "summary": f"{name} a échoué", "results": []}
        return {
            "status": "ok",
            "summary": "ok",
            "results": [
                {"text_output": f"{name} resultat un", "confidence": 0.4},
                {"text_output": f"{name} resultat deux", "confidence": 0.3},
            ],
        }


_TIMING_KEYS = {
    "execution_time_ms", "total_execution_ms", "elapsed_ms",
    "slowest_plugin_ms", "avg_plugin_ms", "sum_plugin_ms",
    "parallelism_speedup",
}


def _strip_timing(obj):
    """Retire récursivement les champs de timing (non déterministes)."""
    if isinstance(obj, dict):
        return {k: _strip_timing(v) for k, v in obj.items() if k not in _TIMING_KEYS}
    if isinstance(obj, list):
        return [_strip_timing(v) for v in obj]
    return obj


def _run_execute():
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_ScrambledManager())
    return plugin.execute({"text": "ABCDEFGH", "mode": "decode", "preset": "all"})


def _run_streaming_result():
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_ScrambledManager())
    events = list(plugin.execute_streaming({"text": "ABCDEFGH", "mode": "decode", "preset": "all"}))
    return events[-1]["data"]


def test_execute_and_streaming_final_result_match():
    exec_resp = _strip_timing(_run_execute())
    stream_resp = _strip_timing(_run_streaming_result())
    assert exec_resp == stream_resp


def test_ordering_is_deterministic_across_runs():
    # Deux exécutions streaming successives doivent produire le même ordre.
    a = _strip_timing(_run_streaming_result())
    b = _strip_timing(_run_streaming_result())
    assert a["results"] == b["results"]
    assert list(a["combined_results"].keys()) == list(b["combined_results"].keys())
    assert a["plugin_info"]["executed_plugins"] == b["plugin_info"]["executed_plugins"]
    assert a["failed_plugins"] == b["failed_plugins"]
