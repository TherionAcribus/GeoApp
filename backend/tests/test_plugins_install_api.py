"""
Tests des routes d'installation de plugins custom.

- POST /api/plugins/install   : upload d'une archive .zip
- POST /api/plugins/scaffold  : génération d'un squelette
- DELETE /api/plugins/<name>  : suppression d'un plugin custom
"""

import io
import json
import zipfile
from pathlib import Path

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.plugins import PluginManager
from gc_backend.plugins.models import Plugin
from gc_backend.blueprints.plugins._common import init_plugin_manager, get_plugin_manager


def _plugin_json(name: str, **extra) -> str:
    data = {
        "name": name,
        "version": "1.0.0",
        "plugin_api_version": "2.0",
        "plugin_type": "python",
        "entry_point": "main.py",
        "description": f"Plugin {name}",
        "kinds": ["code"],
    }
    data.update(extra)
    return json.dumps(data)


def _make_zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _post_zip(client, data: bytes, filename: str = 'plugin.zip'):
    return client.post(
        '/api/plugins/install',
        data={'file': (io.BytesIO(data), filename)},
        content_type='multipart/form-data',
    )


@pytest.fixture
def install_env(tmp_path):
    """App avec un plugins_dir temporaire (official + custom vides).

    Le PluginManager global est remplacé pour isoler les tests du vrai
    répertoire plugins/, puis restauré à la fin.
    """
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    plugins_dir = tmp_path / 'plugins'
    (plugins_dir / 'official').mkdir(parents=True)
    (plugins_dir / 'custom').mkdir(parents=True)

    with app.app_context():
        db.create_all()
        previous_manager = get_plugin_manager()
        manager = PluginManager(str(plugins_dir), app)
        manager.discover_plugins()
        init_plugin_manager(manager)
        app.plugin_manager = manager
        yield app, plugins_dir
        init_plugin_manager(previous_manager)
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(install_env):
    return install_env[0].test_client()


class TestInstallPlugin:
    """POST /api/plugins/install"""

    def test_install_zip_at_root(self, client, install_env):
        app, plugins_dir = install_env
        zip_data = _make_zip({
            'plugin.json': _plugin_json('zip_root_pl'),
            'main.py': 'class ZipRootPlPlugin:\n    def execute(self, inputs):\n        return {}\n',
        })

        response = _post_zip(client, zip_data)
        assert response.status_code == 201
        assert response.get_json()['plugin_name'] == 'zip_root_pl'

        assert (plugins_dir / 'custom' / 'zip_root_pl' / 'plugin.json').exists()
        assert (plugins_dir / 'custom' / 'zip_root_pl' / 'main.py').exists()
        with app.app_context():
            assert Plugin.query.filter_by(name='zip_root_pl', source='custom').first()

    def test_install_zip_in_subfolder(self, client, install_env):
        _, plugins_dir = install_env
        zip_data = _make_zip({
            'nested_dir/plugin.json': _plugin_json('zip_nested'),
            'nested_dir/main.py': 'pass\n',
            'nested_dir/data/info.txt': 'hello',
        })

        response = _post_zip(client, zip_data)
        assert response.status_code == 201

        plugin_dir = plugins_dir / 'custom' / 'zip_nested'
        assert (plugin_dir / 'plugin.json').exists()
        assert (plugin_dir / 'data' / 'info.txt').exists()

    def test_install_rejects_non_zip(self, client):
        response = _post_zip(client, b'not a zip', filename='plugin.txt')
        assert response.status_code == 400

    def test_install_rejects_bad_zip(self, client):
        response = _post_zip(client, b'PK\x00\x00 garbage')
        assert response.status_code == 400

    def test_install_rejects_missing_plugin_json(self, client):
        response = _post_zip(client, _make_zip({'main.py': 'pass\n'}))
        assert response.status_code == 400
        assert 'plugin.json' in response.get_json()['error']

    def test_install_rejects_multiple_plugin_json(self, client):
        zip_data = _make_zip({
            'a/plugin.json': _plugin_json('pl_a'),
            'b/plugin.json': _plugin_json('pl_b'),
        })
        response = _post_zip(client, zip_data)
        assert response.status_code == 400

    def test_install_rejects_traversal(self, client):
        zip_data = _make_zip({
            'plugin.json': _plugin_json('zip_trav'),
            '../evil.py': 'pass\n',
        })
        response = _post_zip(client, zip_data)
        assert response.status_code == 400
        assert 'raversal' in response.get_json()['error']

    def test_install_rejects_blocked_extension(self, client):
        zip_data = _make_zip({
            'plugin.json': _plugin_json('zip_exe'),
            'main.py': 'pass\n',
            'payload.exe': b'MZ\x90\x00',
        })
        response = _post_zip(client, zip_data)
        assert response.status_code == 400
        assert 'payload.exe' in response.get_json()['error']

    def test_install_rejects_schema_invalid(self, client):
        zip_data = _make_zip({
            'plugin.json': json.dumps({"name": "NO-UPPER!", "version": "x"}),
            'main.py': 'pass\n',
        })
        response = _post_zip(client, zip_data)
        assert response.status_code == 422

    def test_install_conflict_existing(self, client):
        zip_data = _make_zip({
            'plugin.json': _plugin_json('zip_dup'),
            'main.py': 'pass\n',
        })
        assert _post_zip(client, zip_data).status_code == 201
        assert _post_zip(client, zip_data).status_code == 409

    def test_install_over_official_warns(self, client, install_env):
        _, plugins_dir = install_env
        off_dir = plugins_dir / 'official' / 'shared_name'
        off_dir.mkdir()
        (off_dir / 'plugin.json').write_text(_plugin_json('shared_name'), encoding='utf-8')
        (off_dir / 'main.py').write_text('pass\n', encoding='utf-8')
        install_env[0].plugin_manager.discover_plugins()

        zip_data = _make_zip({
            'plugin.json': _plugin_json('shared_name'),
            'main.py': 'pass\n',
        })
        response = _post_zip(client, zip_data)
        assert response.status_code == 201
        assert 'warning' in response.get_json()

    def test_install_no_file(self, client):
        response = client.post('/api/plugins/install', data={}, content_type='multipart/form-data')
        assert response.status_code == 400


class TestScaffoldPlugin:
    """POST /api/plugins/scaffold"""

    def test_scaffold_creates_executable_plugin(self, client, install_env):
        app, plugins_dir = install_env

        response = client.post('/api/plugins/scaffold', json={
            'name': 'my_new_tool',
            'description': 'Outil de test',
            'author': 'Tester',
        })
        assert response.status_code == 201

        plugin_dir = plugins_dir / 'custom' / 'my_new_tool'
        assert (plugin_dir / 'plugin.json').exists()
        assert (plugin_dir / 'main.py').exists()

        data = json.loads((plugin_dir / 'plugin.json').read_text(encoding='utf-8'))
        assert data['name'] == 'my_new_tool'
        assert data['description'] == 'Outil de test'

        # Le squelette généré doit être chargeable et exécutable
        info = app.plugin_manager.get_plugin('my_new_tool')
        assert info is not None
        result = app.plugin_manager.execute_plugin('my_new_tool', {'text': 'ABC'})
        assert result['status'] == 'ok'

    def test_scaffold_rejects_invalid_name(self, client):
        for bad_name in ['Bad-Name!', 'x', 'a' * 65, 'avec espace']:
            response = client.post('/api/plugins/scaffold', json={'name': bad_name})
            assert response.status_code == 400, bad_name

    def test_scaffold_conflict_existing(self, client):
        payload = {'name': 'dup_scaffold'}
        assert client.post('/api/plugins/scaffold', json=payload).status_code == 201
        assert client.post('/api/plugins/scaffold', json=payload).status_code == 409


class TestUninstallPlugin:
    """DELETE /api/plugins/<name>"""

    def test_delete_custom_plugin(self, client, install_env):
        app, plugins_dir = install_env
        client.post('/api/plugins/scaffold', json={'name': 'to_delete'})
        plugin_dir = plugins_dir / 'custom' / 'to_delete'
        assert plugin_dir.exists()

        response = client.delete('/api/plugins/to_delete')
        assert response.status_code == 200
        assert not plugin_dir.exists()
        with app.app_context():
            assert Plugin.query.filter_by(name='to_delete').first() is None

    def test_delete_official_rejected(self, client, install_env):
        app, plugins_dir = install_env
        off_dir = plugins_dir / 'official' / 'official_pl'
        off_dir.mkdir()
        (off_dir / 'plugin.json').write_text(_plugin_json('official_pl'), encoding='utf-8')
        (off_dir / 'main.py').write_text('pass\n', encoding='utf-8')
        app.plugin_manager.discover_plugins()

        response = client.delete('/api/plugins/official_pl')
        assert response.status_code == 403
        assert off_dir.exists()

    def test_delete_unknown_plugin(self, client):
        response = client.delete('/api/plugins/never_existed')
        assert response.status_code == 404
