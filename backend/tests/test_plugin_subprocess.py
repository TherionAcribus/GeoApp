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
