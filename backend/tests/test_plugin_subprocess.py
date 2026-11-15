"""
Tests de l'exécution en sous-processus des plugins ``heavy_cpu``.

Vérifie que :
- un plugin heavy_cpu s'exécute dans un processus enfant distinct ;
- le module du plugin n'est jamais importé dans le processus parent ;
- un dépassement de timeout TUE réellement le processus (contrairement
  au thread daemon in-process qui continuerait de tourner) ;
- une exception levée dans l'enfant remonte une erreur normalisée.
"""

import os
import sys
import json
import time
import tempfile
import shutil
from pathlib import Path

import pytest

from gc_backend.plugins.plugin_manager import PluginManager
from gc_backend.plugins.models import Plugin
from gc_backend import create_app
from gc_backend.database import db


@pytest.fixture
def app():
    """Crée une instance de l'application pour les tests."""
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def temp_plugins_dir():
    """Crée un répertoire temporaire pour les plugins de test."""
    temp_dir = tempfile.mkdtemp()
    plugins_dir = Path(temp_dir)
    (plugins_dir / 'official').mkdir(parents=True, exist_ok=True)
    (plugins_dir / 'custom').mkdir(parents=True, exist_ok=True)
    yield plugins_dir
    shutil.rmtree(temp_dir)


def _write_plugin(plugins_dir: Path, name: str, main_py: str,
                  heavy_cpu: bool = True, timeout_seconds: int = None) -> Path:
    """Écrit un plugin de test (plugin.json + main.py) dans official/."""
    plugin_dir = plugins_dir / 'official' / name
    plugin_dir.mkdir(parents=True, exist_ok=True)

    data = {
        "name": name,
        "version": "1.0.0",
        "plugin_api_version": "2.0",
        "description": "Plugin de test",
        "author": "Test",
        "plugin_type": "python",
        "entry_point": "main.py",
        "categories": ["Test"],
        "heavy_cpu": heavy_cpu,
    }
    if timeout_seconds is not None:
        data["timeout_seconds"] = timeout_seconds

    (plugin_dir / 'plugin.json').write_text(
        json.dumps(data), encoding='utf-8'
    )
    (plugin_dir / 'main.py').write_text(main_py, encoding='utf-8')
    return plugin_dir


class TestHeavyCpuSubprocess:
    """Exécution des plugins heavy_cpu dans un processus enfant."""

    def test_runs_in_separate_process(self, app, temp_plugins_dir):
        """Le plugin s'exécute dans un autre processus (pid différent) et
        son module n'est jamais importé dans le processus parent."""
        _write_plugin(
            temp_plugins_dir, 'heavy_plugin',
            'import os\n'
            'class HeavyPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": '
            '[{"id": "1", "text_output": str(os.getpid())}]}\n',
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('heavy_plugin', {})

        assert result['status'] == 'ok'
        child_pid = int(result['results'][0]['text_output'])
        assert child_pid != os.getpid()
        # Le module du plugin n'a jamais été importé dans ce processus :
        # initialize() diffère le chargement au sous-processus.
        assert 'geoapp_plugin_heavy_plugin.main' not in sys.modules

    def test_timeout_really_kills_child(self, app, temp_plugins_dir):
        """Un plugin heavy_cpu en boucle infinie est tué au timeout — le
        thread daemon in-process aurait continué à tourner."""
        _write_plugin(
            temp_plugins_dir, 'hang_plugin',
            'import time\n'
            'class HangPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        while True:\n'
            '            time.sleep(0.05)\n',
            timeout_seconds=2,
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        started = time.monotonic()
        result = manager.execute_plugin('hang_plugin', {})
        elapsed = time.monotonic() - started

        assert result['status'] == 'error'
        assert result['error']['type'] == 'TimeoutError'
        # spawn d'un interpréteur (~1-2s) + timeout 2s + kill
        assert elapsed < 30

    def test_child_exception_surfaces(self, app, temp_plugins_dir):
        """Une exception levée dans l'enfant remonte comme erreur
        normalisée du plugin."""
        _write_plugin(
            temp_plugins_dir, 'boom_plugin',
            'class BoomPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            "        raise ValueError('boom dans le sous-processus')\n",
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('boom_plugin', {})

        assert result['status'] == 'error'
        assert 'boom' in result['summary']

    def test_non_heavy_plugin_still_runs_in_process(
        self, app, temp_plugins_dir
    ):
        """Un plugin sans heavy_cpu reste exécuté in-process."""
        _write_plugin(
            temp_plugins_dir, 'light_plugin',
            'import os\n'
            'class LightPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": '
            '[{"id": "1", "text_output": str(os.getpid())}]}\n',
            heavy_cpu=False,
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('light_plugin', {})

        assert result['status'] == 'ok'
        child_pid = int(result['results'][0]['text_output'])
        assert child_pid == os.getpid()
        assert 'geoapp_plugin_light_plugin.main' in sys.modules


class TestPersistentWorkerPool:
    """Pool de workers persistants pour heavy_cpu (réutilisation, recyclage)."""

    @pytest.fixture(autouse=True)
    def _cleanup_workers(self):
        yield
        from gc_backend.plugins.subprocess_runner import get_worker_pool
        get_worker_pool().shutdown_all()

    @staticmethod
    def _pid_of(result):
        assert result['status'] == 'ok'
        return int(result['results'][0]['text_output'])

    def test_worker_reused_across_executions(self, app, temp_plugins_dir):
        """Deux exécutions du même plugin passent par le MÊME worker
        (plugin chargé une seule fois — pas de ré-import torch)."""
        _write_plugin(
            temp_plugins_dir, 'pid_plugin',
            'import os\n'
            'class PidPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": '
            '[{"id": "1", "text_output": str(os.getpid())}]}\n',
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        pid1 = self._pid_of(manager.execute_plugin('pid_plugin', {}))
        pid2 = self._pid_of(manager.execute_plugin('pid_plugin', {}))

        assert pid1 == pid2
        assert pid1 != os.getpid()

    def test_worker_state_persists_between_calls(self, app, temp_plugins_dir):
        """L'instance du plugin survit entre appels (modèle OCR déjà chargé,
        état conservé)."""
        _write_plugin(
            temp_plugins_dir, 'counter_plugin',
            'class CounterPluginPlugin:\n'
            '    def __init__(self):\n'
            '        self.count = 0\n'
            '    def execute(self, inputs):\n'
            '        self.count += 1\n'
            '        return {"status": "ok", "results": '
            '[{"id": "1", "text_output": str(self.count)}]}\n',
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        manager.execute_plugin('counter_plugin', {})
        result = manager.execute_plugin('counter_plugin', {})

        assert result['status'] == 'ok'
        assert result['results'][0]['text_output'] == '2'

    def test_worker_respawns_after_timeout_kill(self, app, temp_plugins_dir):
        """Un worker tué au timeout est respawn : l'exécution suivante
        tourne dans un NOUVEAU processus."""
        _write_plugin(
            temp_plugins_dir, 'loop_pid',
            'import os, time\n'
            'class LoopPidPlugin:\n'
            '    def execute(self, inputs):\n'
            '        if inputs.get("mode") == "loop":\n'
            '            while True:\n'
            '                time.sleep(0.05)\n'
            '        return {"status": "ok", "results": '
            '[{"id": "1", "text_output": str(os.getpid())}]}\n',
            timeout_seconds=2,
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        pid1 = self._pid_of(manager.execute_plugin('loop_pid', {}))

        killed = manager.execute_plugin('loop_pid', {'mode': 'loop'})
        assert killed['status'] == 'error'
        assert killed['error']['type'] == 'TimeoutError'

        pid2 = self._pid_of(manager.execute_plugin('loop_pid', {}))
        assert pid2 != pid1

    def test_worker_recycled_after_idle_ttl(self, app, temp_plugins_dir):
        """Un worker inactif au-delà du TTL est recyclé (nouveau pid)."""
        from gc_backend.plugins.subprocess_runner import get_worker_pool
        pool = get_worker_pool()
        old_ttl = pool.idle_ttl
        pool.idle_ttl = 0.3
        try:
            _write_plugin(
                temp_plugins_dir, 'idle_plugin',
                'import os\n'
                'class IdlePluginPlugin:\n'
                '    def execute(self, inputs):\n'
                '        return {"status": "ok", "results": '
                '[{"id": "1", "text_output": str(os.getpid())}]}\n',
            )
            manager = PluginManager(str(temp_plugins_dir), app)
            manager.discover_plugins()

            pid1 = self._pid_of(manager.execute_plugin('idle_plugin', {}))
            time.sleep(0.6)
            pid2 = self._pid_of(manager.execute_plugin('idle_plugin', {}))

            assert pid2 != pid1
        finally:
            pool.idle_ttl = old_ttl

    def test_unload_stops_worker(self, app, temp_plugins_dir):
        """Décharger/recharger le plugin tue le worker (le code modifié
        repart sur un worker frais)."""
        _write_plugin(
            temp_plugins_dir, 'reloadable_pl',
            'import os\n'
            'class ReloadablePlPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": '
            '[{"id": "1", "text_output": str(os.getpid())}]}\n',
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        pid1 = self._pid_of(manager.execute_plugin('reloadable_pl', {}))
        manager.unload_plugin('reloadable_pl')
        pid2 = self._pid_of(manager.execute_plugin('reloadable_pl', {}))

        assert pid2 != pid1

    def test_worker_error_surfaces(self, app, temp_plugins_dir):
        """Une exception du plugin dans le worker remonte en erreur normalisée."""
        _write_plugin(
            temp_plugins_dir, 'err_plugin',
            'class ErrPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            "        raise ValueError('worker boom')\n",
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('err_plugin', {})

        assert result['status'] == 'error'
        assert 'worker boom' in result['summary']
