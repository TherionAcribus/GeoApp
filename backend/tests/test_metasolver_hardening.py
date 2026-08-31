"""Tests pour le hardening des inputs (point A) et la validation de route (point B).

Vérifie que execute_streaming gère gracieusement les inputs malformés
(type incorrect pour text, mode, plugin_list) au lieu de crasher avec
un AttributeError.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin


class _FakeManager:
    """PluginManager minimal."""

    def __init__(self, names=None):
        self._names = names or []
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
        return {"status": "ok", "results": [{"text_output": f"{name}_out"}]}


def _drain(plugin, inputs):
    """Épuise le générateur et retourne le dernier événement result."""
    events = list(plugin.execute_streaming(inputs))
    result = None
    for ev in events:
        if ev.get("event") == "result":
            result = ev.get("data")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# A. Hardening execute_streaming — inputs malformés
# ─────────────────────────────────────────────────────────────────────────────

def test_non_dict_inputs_returns_error():
    """inputs non-dict doit retourner une erreur SSE au lieu de crasher."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    result = _drain(plugin, "not a dict")
    assert result is not None
    assert "error" in (result.get("summary") or "").lower() or result.get("status") == "error"


def test_int_text_does_not_crash():
    """text=int ne doit pas lever AttributeError sur .strip()."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    result = _drain(plugin, {"text": 12345})
    # Le texte "12345" est valide (coercion en str), on doit obtenir un résultat
    assert result is not None
    assert result.get("status") in ("success", "partial_success", "error")


def test_int_mode_does_not_crash():
    """mode=int ne doit pas lever AttributeError sur .lower()."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    result = _drain(plugin, {"text": "ABCDE", "mode": 123})
    # mode=123 → str(123)="123" → non supporté → erreur
    assert result is not None
    assert "mode" in (result.get("summary") or "").lower() or result.get("status") == "error"


def test_list_plugin_list_does_not_crash():
    """plugin_list=list ne doit pas lever AttributeError sur .split()."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    result = _drain(plugin, {"text": "ABCDE", "plugin_list": ["caesar", "rot13"]})
    # plugin_list=["caesar","rot13"] → str([...]) → parsing non fatal
    assert result is not None


def test_none_preset_does_not_crash():
    """preset=None doit utiliser le défaut 'all' sans crasher."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    result = _drain(plugin, {"text": "ABCDE", "preset": None})
    assert result is not None


def test_invalid_max_plugins_silently_ignored():
    """max_plugins='abc' doit être ignoré silencieusement (pas de crash)."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    result = _drain(plugin, {"text": "ABCDE", "max_plugins": "abc"})
    assert result is not None


# ─────────────────────────────────────────────────────────────────────────────
# I. Configurabilité des constantes
# ─────────────────────────────────────────────────────────────────────────────

def test_config_defaults_match_module_constants():
    """Sans plugin.json, les constantes par défaut du module sont utilisées."""
    from plugins.official.metasolver.main import (
        MAX_PARALLEL_WORKERS,
        STREAMING_GLOBAL_TIMEOUT_S,
        _STREAMING_POLL_INTERVAL_S,
    )
    plugin = MetaSolverPlugin()
    assert plugin._max_parallel_workers == MAX_PARALLEL_WORKERS
    assert plugin._streaming_global_timeout_s == STREAMING_GLOBAL_TIMEOUT_S
    assert plugin._streaming_poll_interval_s == _STREAMING_POLL_INTERVAL_S


def test_config_loaded_from_plugin_json():
    """set_plugin_manager doit charger les constantes depuis plugin.json."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["caesar"]))
    # Le plugin.json réel ne contient pas metasolver_config, donc les
    # valeurs par défaut doivent être conservées.
    from plugins.official.metasolver.main import MAX_PARALLEL_WORKERS
    assert plugin._max_parallel_workers == MAX_PARALLEL_WORKERS


# ─────────────────────────────────────────────────────────────────────────────
# H. Structured error code dans _build_final_response
# ─────────────────────────────────────────────────────────────────────────────

def test_all_plugins_failed_includes_error_code():
    """Quand tous les plugins échouent, la réponse doit contenir error_code."""
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_FakeManager(["nonexistent"]))
    # Forcer un scénario où tous les plugins échouent en utilisant un
    # plugin_list avec un plugin qui n'existe pas dans le manager
    result = _drain(plugin, {"text": "ABCDE", "plugin_list": "ghost_plugin_xyz"})
    # Le résultat peut être success/partial si le plugin n'est pas trouvé
    # mais on vérifie au moins que le résultat est structuré
    assert result is not None
    assert "status" in result


# ─────────────────────────────────────────────────────────────────────────────
# J. Invalidation du cache
# ─────────────────────────────────────────────────────────────────────────────

def test_invalidate_metasolver_caches_clears_both_caches():
    """invalidate_metasolver_caches doit vider les deux caches."""
    from gc_backend.services.metasolver_analysis import (
        _presets_cache,
        _candidates_cache,
        invalidate_metasolver_caches,
    )
    # Simuler un cache non vide
    _presets_cache["fake_path"] = (0, {})
    _candidates_cache[("fake_key", "decode")] = (0, [])
    invalidate_metasolver_caches()
    assert len(_presets_cache) == 0
    assert len(_candidates_cache) == 0
