import sys
import threading
import time
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


class _HangingManager(_FakeManager):
    """PluginManager dont un plugin pend indéfiniment (simule un sub-plugin bloqué)."""

    def __init__(self, names, hanging_name, hang_seconds=30):
        super().__init__(names)
        self._hanging_name = hanging_name
        self._hang_seconds = hang_seconds

    def execute_plugin(self, name, inputs):
        if name == self._hanging_name:
            time.sleep(self._hang_seconds)
            return {"status": "ok", "results": []}
        return super().execute_plugin(name, inputs)


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


def test_direct_fallback_caps_timeout(tmp_path, monkeypatch):
    """Le fallback _execute_plugin_direct plafonne le timeout comme le PluginManager."""
    # Préparer un plugin sur disque avec un timeout déclaré très élevé
    plugin_dir = tmp_path / "official" / "slowplug"
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "plugin.json").write_text(
        '{"name": "slowplug", "plugin_type": "python", "entry_point": "main.py", "timeout_seconds": 300}',
        encoding="utf-8",
    )
    (plugin_dir / "main.py").write_text(
        "class SlowplugPlugin:\n"
        "    def execute(self, inputs):\n"
        "        return {'status': 'ok', 'results': []}\n",
        encoding="utf-8",
    )

    captured = {}

    def fake_wrappers():
        from gc_backend.plugins.wrappers import PluginMetadata

        def fake_create(plugin_type, metadata, plugin_manager=None):
            captured["timeout"] = metadata.timeout_seconds

            class _W:
                def initialize(self):
                    return True

                def execute(self, inputs):
                    return {"status": "ok", "results": []}

            return _W()

        return PluginMetadata, fake_create

    import plugins.official.metasolver.main as meta_mod
    monkeypatch.setattr(meta_mod, "_lazy_import_wrappers", fake_wrappers)

    plugin = MetaSolverPlugin()

    class _Mgr:
        plugins_dir = str(tmp_path)
        default_timeout = 60
        allow_long_running = False

    plugin.set_plugin_manager(_Mgr())

    result = plugin._execute_plugin_direct("slowplug", {"text": "X"})

    assert result == {"status": "ok", "results": []}
    # 300 déclaré -> plafonné à default_timeout (60) car allow_long_running=False
    assert captured["timeout"] == 60


def test_streaming_timeout_marks_hanging_plugin_and_returns_partial_result(monkeypatch):
    """Un sous-plugin qui pend ne doit pas bloquer le flux SSE indéfiniment.

    La deadline globale (mockée très courte) déclenche un abort : le plugin
    pendant est marqué "timeout" et un événement result partiel est émis.
    """
    import plugins.official.metasolver.main as meta_mod

    # Deadline très courte pour que le test soit rapide
    monkeypatch.setattr(meta_mod, "STREAMING_GLOBAL_TIMEOUT_S", 0.3)
    monkeypatch.setattr(meta_mod, "_STREAMING_POLL_INTERVAL_S", 0.1)

    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_HangingManager(["fast", "hanging"], "hanging", hang_seconds=30))

    events = list(plugin.execute_streaming({"text": "ABCDE", "mode": "decode", "preset": "all"}))

    # Le flux doit se terminer par un événement result (et non rester bloqué)
    assert events[-1]["event"] == "result"
    result_data = events[-1]["data"]
    # Status timeout (aucun résultat collecté car le plugin rapide seul ne
    # suffit pas forcément à produire du texte exploitable ici ; on accepte
    # aussi partial_success si le plugin rapide a produit quelque chose)
    assert result_data["status"] in {"timeout", "partial_success"}
    assert result_data["diagnostics"]["aborted"] == "timeout"

    # Le plugin pendant doit apparaître dans failed_plugins avec raison timeout
    failed_names = {f["plugin"] for f in result_data["failed_plugins"]}
    assert "hanging" in failed_names

    # Un événement plugin_error doit avoir été émis pour le plugin pendant
    errors = [e for e in events if e["event"] == "plugin_error" and e["data"].get("plugin") == "hanging"]
    assert len(errors) == 1
    assert "Délai" in errors[0]["data"]["reason"]


def test_streaming_cancel_event_aborts_and_returns_cancelled_status(monkeypatch):
    """Un cancel_event set par l'appelant doit interrompre le drain et renvoyer
    une réponse partielle avec status cancelled."""
    import plugins.official.metasolver.main as meta_mod

    monkeypatch.setattr(meta_mod, "STREAMING_GLOBAL_TIMEOUT_S", 30)
    monkeypatch.setattr(meta_mod, "_STREAMING_POLL_INTERVAL_S", 0.1)

    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_HangingManager(["hanging"], "hanging", hang_seconds=30))

    cancel_event = threading.Event()

    # Setter l'annulation juste après la soumission : on consomme l'init, puis
    # on set l'event avant de continuer à drainer.
    events = []
    gen = plugin.execute_streaming({"text": "ABCDE", "mode": "decode", "preset": "all"}, cancel_event=cancel_event)
    for event in gen:
        events.append(event)
        if event["event"] == "init":
            cancel_event.set()

    assert events[-1]["event"] == "result"
    result_data = events[-1]["data"]
    assert result_data["status"] in {"cancelled", "partial_success"}
    assert result_data["diagnostics"]["aborted"] == "cancelled"

    failed_names = {f["plugin"] for f in result_data["failed_plugins"]}
    assert "hanging" in failed_names
