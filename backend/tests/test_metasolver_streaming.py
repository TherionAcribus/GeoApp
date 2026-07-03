import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin


class _FakeManager:
    """PluginManager minimal pour piloter execute_streaming sans backend."""

    def __init__(self, names):
        self._names = names
        self.plugins_dir = "/nonexistent"

    def list_plugins(self, enabled_only=True):
        return [{"name": n} for n in self._names]

    def get_plugin_info(self, name):
        return {
            "metadata": {
                "metasolver": {"eligible": True, "priority": 50},
                "capabilities": {"decode": True, "analyze": True},
                "input_types": {},
            }
        }

    def execute_plugin(self, name, inputs):
        return {
            "status": "ok",
            "summary": "ok",
            "results": [{"text_output": f"{name}_out", "confidence": 0.5}],
        }


def _collect_events(names):
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(names))
    return list(plugin.execute_streaming({"text": "ABCDE", "mode": "decode", "preset": "all"}))


def test_streaming_emits_one_start_per_plugin_and_final_result():
    names = ["p1", "p2", "p3"]
    events = _collect_events(names)

    starts = [e for e in events if e["event"] == "plugin_start"]
    dones = [e for e in events if e["event"] == "plugin_done"]

    assert len(starts) == len(names)
    assert len(dones) == len(names)
    # Un seul événement final "result"
    assert events[-1]["event"] == "result"
    assert sum(1 for e in events if e["event"] == "result") == 1


def test_streaming_start_precedes_done_for_each_plugin():
    names = ["p1", "p2", "p3"]
    events = _collect_events(names)

    def first_index(event_type, plugin_name):
        for i, e in enumerate(events):
            if e["event"] == event_type and e["data"].get("plugin") == plugin_name:
                return i
        return None

    for name in names:
        start_i = first_index("plugin_start", name)
        done_i = first_index("plugin_done", name)
        assert start_i is not None, f"pas de plugin_start pour {name}"
        assert done_i is not None, f"pas de plugin_done pour {name}"
        # Le démarrage réel doit précéder la complétion
        assert start_i < done_i


def test_streaming_init_lists_all_candidates():
    names = ["p1", "p2"]
    events = _collect_events(names)

    init = next(e for e in events if e["event"] == "init")
    assert init["data"]["total_plugins"] == 2
    assert set(init["data"]["plugins"]) == set(names)
