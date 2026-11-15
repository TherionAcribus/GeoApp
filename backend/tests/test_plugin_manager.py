"""
Tests unitaires pour le PluginManager.

Ces tests vérifient :
- La découverte de plugins dans official/ et custom/
- La validation contre le schéma JSON
- L'enregistrement en base de données
- Le nettoyage des plugins supprimés
- Le filtrage et la liste des plugins
"""

import pytest
import json
import tempfile
import shutil
import threading
from pathlib import Path

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
    
    # Créer structure official/ et custom/
    (plugins_dir / 'official').mkdir(parents=True, exist_ok=True)
    (plugins_dir / 'custom').mkdir(parents=True, exist_ok=True)
    
    yield plugins_dir
    
    # Nettoyage
    shutil.rmtree(temp_dir)


@pytest.fixture
def valid_plugin_json():
    """Retourne un plugin.json valide pour les tests."""
    return {
        "name": "test_plugin",
        "version": "1.0.0",
        "plugin_api_version": "2.0",
        "description": "Plugin de test",
        "author": "Test Author",
        "plugin_type": "python",
        "entry_point": "main.py",
        "categories": ["Test"],
        "input_types": {
            "text": {
                "type": "string",
                "label": "Texte à traiter"
            }
        }
    }


def create_test_plugin(
    plugins_dir: Path,
    source: str,
    plugin_name: str,
    plugin_data: dict
) -> Path:
    """
    Crée un plugin de test dans le répertoire spécifié.
    
    Args:
        plugins_dir: Répertoire racine des plugins
        source: 'official' ou 'custom'
        plugin_name: Nom du plugin
        plugin_data: Données du plugin.json
        
    Returns:
        Path: Chemin vers le dossier du plugin créé
    """
    plugin_dir = plugins_dir / source / plugin_name
    plugin_dir.mkdir(parents=True, exist_ok=True)
    
    # Écrire plugin.json
    with open(plugin_dir / 'plugin.json', 'w', encoding='utf-8') as f:
        json.dump(plugin_data, f, indent=2)
    
    # Créer un main.py vide
    (plugin_dir / 'main.py').write_text('# Plugin de test\n')
    
    return plugin_dir


class TestPluginManagerDiscovery:
    """Tests de découverte de plugins."""
    
    def test_discover_empty_directories(self, app, temp_plugins_dir):
        """Test découverte avec répertoires vides."""
        manager = PluginManager(str(temp_plugins_dir), app)
        
        discovered = manager.discover_plugins()
        
        assert len(discovered) == 0
    
    def test_discover_single_official_plugin(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test découverte d'un plugin official."""
        # Créer un plugin de test
        create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        discovered = manager.discover_plugins()
        
        assert len(discovered) == 1
        assert discovered[0]['name'] == 'test_plugin'
        assert discovered[0]['source'] == 'official'
        
        # Vérifier en DB
        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            assert plugin is not None
            assert plugin.source == 'official'
            assert plugin.version == '1.0.0'
    
    def test_discover_multiple_plugins(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test découverte de plusieurs plugins dans different sources."""
        # Plugin official
        official_data = valid_plugin_json.copy()
        official_data['name'] = 'official_plugin'
        create_test_plugin(
            temp_plugins_dir, 'official', 'official_plugin', official_data
        )
        
        # Plugin custom
        custom_data = valid_plugin_json.copy()
        custom_data['name'] = 'custom_plugin'
        create_test_plugin(
            temp_plugins_dir, 'custom', 'custom_plugin', custom_data
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        discovered = manager.discover_plugins()
        
        assert len(discovered) == 2
        
        plugin_names = {p['name'] for p in discovered}
        assert 'official_plugin' in plugin_names
        assert 'custom_plugin' in plugin_names
        
        # Vérifier sources
        sources = {p['name']: p['source'] for p in discovered}
        assert sources['official_plugin'] == 'official'
        assert sources['custom_plugin'] == 'custom'
    
    def test_discover_invalid_json_syntax(
        self, app, temp_plugins_dir
    ):
        """Test avec un JSON invalide syntaxiquement."""
        plugin_dir = temp_plugins_dir / 'official' / 'bad_plugin'
        plugin_dir.mkdir(parents=True)
        
        # Écrire un JSON invalide
        (plugin_dir / 'plugin.json').write_text('{invalid json}')
        
        manager = PluginManager(str(temp_plugins_dir), app)
        discovered = manager.discover_plugins()
        
        # Le plugin ne doit pas être découvert
        assert len(discovered) == 0
        
        # Mais une erreur doit être enregistrée
        errors = manager.get_discovery_errors()
        assert len(errors) > 0
    
    def test_discover_invalid_schema(
        self, app, temp_plugins_dir
    ):
        """Test avec un plugin.json valide en JSON mais invalide selon le schéma."""
        invalid_data = {
            "name": "invalid_plugin",
            # Manque version, plugin_type, entry_point
        }
        
        create_test_plugin(
            temp_plugins_dir, 'official', 'invalid_plugin', invalid_data
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        discovered = manager.discover_plugins()
        
        # Le plugin ne doit pas être découvert
        assert len(discovered) == 0


class TestPluginManagerValidation:
    """Tests de validation de plugins."""
    
    def test_validate_valid_plugin(self, app, valid_plugin_json):
        """Test validation d'un plugin valide."""
        manager = PluginManager('dummy_path')
        
        is_valid = manager._validate_plugin_json(valid_plugin_json)
        
        assert is_valid is True
    
    def test_validate_missing_required_field(self, app, valid_plugin_json):
        """Test validation avec champ requis manquant."""
        invalid_data = valid_plugin_json.copy()
        del invalid_data['name']  # Champ requis
        
        manager = PluginManager('dummy_path')
        is_valid = manager._validate_plugin_json(invalid_data)
        
        assert is_valid is False
    
    def test_validate_invalid_plugin_type(self, app, valid_plugin_json):
        """Test validation avec type de plugin invalide."""
        invalid_data = valid_plugin_json.copy()
        invalid_data['plugin_type'] = 'invalid_type'
        
        manager = PluginManager('dummy_path')
        is_valid = manager._validate_plugin_json(invalid_data)
        
        assert is_valid is False
    
    def test_validate_invalid_name_format(self, app, valid_plugin_json):
        """Test validation avec format de nom invalide (pas snake_case)."""
        invalid_data = valid_plugin_json.copy()
        invalid_data['name'] = 'Invalid-Name-With-Dashes'
        
        manager = PluginManager('dummy_path')
        is_valid = manager._validate_plugin_json(invalid_data)
        
        assert is_valid is False


class TestPluginManagerUpdate:
    """Tests de mise à jour de plugins."""
    
    def test_update_plugin_version(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test mise à jour de la version d'un plugin."""
        # Créer plugin v1.0.0
        create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            assert plugin.version == '1.0.0'
        
        # Modifier version
        updated_data = valid_plugin_json.copy()
        updated_data['version'] = '2.0.0'
        
        # Recréer le plugin avec nouvelle version
        plugin_dir = temp_plugins_dir / 'official' / 'test_plugin'
        with open(plugin_dir / 'plugin.json', 'w') as f:
            json.dump(updated_data, f)
        
        # Redécouvrir
        manager.discover_plugins()
        
        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            assert plugin.version == '2.0.0'


class TestPluginManagerCleanup:
    """Tests de nettoyage de plugins supprimés."""
    
    def test_cleanup_deleted_plugin(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test suppression en DB d'un plugin supprimé physiquement."""
        # Créer et découvrir un plugin
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        with app.app_context():
            assert Plugin.query.count() == 1
        
        # Supprimer physiquement le plugin
        shutil.rmtree(plugin_dir)
        
        # Redécouvrir
        manager.discover_plugins()
        
        with app.app_context():
            # Le plugin doit être supprimé de la DB
            assert Plugin.query.count() == 0


class TestPluginManagerListing:
    """Tests de listage et filtrage de plugins."""
    
    def test_list_all_plugins(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test listage de tous les plugins."""
        # Créer 2 plugins
        data1 = valid_plugin_json.copy()
        data1['name'] = 'plugin1'
        create_test_plugin(temp_plugins_dir, 'official', 'plugin1', data1)
        
        data2 = valid_plugin_json.copy()
        data2['name'] = 'plugin2'
        create_test_plugin(temp_plugins_dir, 'custom', 'plugin2', data2)
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        plugins = manager.list_plugins()
        
        assert len(plugins) == 2
    
    def test_list_plugins_by_source(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test filtrage par source."""
        # Créer plugins dans différentes sources
        data1 = valid_plugin_json.copy()
        data1['name'] = 'official1'
        create_test_plugin(temp_plugins_dir, 'official', 'official1', data1)
        
        data2 = valid_plugin_json.copy()
        data2['name'] = 'custom1'
        create_test_plugin(temp_plugins_dir, 'custom', 'custom1', data2)
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        # Filtrer official
        official_plugins = manager.list_plugins(source='official')
        assert len(official_plugins) == 1
        assert official_plugins[0]['name'] == 'official1'
        
        # Filtrer custom
        custom_plugins = manager.list_plugins(source='custom')
        assert len(custom_plugins) == 1
        assert custom_plugins[0]['name'] == 'custom1'
    
    def test_list_plugins_by_category(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test filtrage par catégorie."""
        # Plugin avec catégorie "Test"
        data1 = valid_plugin_json.copy()
        data1['name'] = 'test_cat'
        data1['categories'] = ['Test']
        create_test_plugin(temp_plugins_dir, 'official', 'test_cat', data1)
        
        # Plugin avec catégorie "Other"
        data2 = valid_plugin_json.copy()
        data2['name'] = 'other_cat'
        data2['categories'] = ['Other']
        create_test_plugin(temp_plugins_dir, 'official', 'other_cat', data2)
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        # Filtrer par catégorie
        test_plugins = manager.list_plugins(category='Test')
        assert len(test_plugins) == 1
        assert test_plugins[0]['name'] == 'test_cat'
    
    def test_list_enabled_only(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test filtrage par statut enabled."""
        # Créer plugin
        create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        # Désactiver le plugin
        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            plugin.enabled = False
            db.session.commit()
        
        # Lister avec enabled_only=True
        enabled_plugins = manager.list_plugins(enabled_only=True)
        assert len(enabled_plugins) == 0
        
        # Lister avec enabled_only=False
        all_plugins = manager.list_plugins(enabled_only=False)
        assert len(all_plugins) == 1


class TestPluginManagerUtilities:
    """Tests des méthodes utilitaires."""
    
    def test_get_plugin_info(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Test récupération des informations d'un plugin."""
        create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        
        info = manager.get_plugin_info('test_plugin')
        
        assert info is not None
        assert info['name'] == 'test_plugin'
        assert info['version'] == '1.0.0'
        assert 'metadata' in info  # include_metadata=True par défaut
    
    def test_get_plugin_info_not_found(self, app, temp_plugins_dir):
        """Test récupération d'un plugin inexistant."""
        manager = PluginManager(str(temp_plugins_dir), app)
        
        info = manager.get_plugin_info('nonexistent')
        
        assert info is None
    
    def test_clear_errors(self, app):
        """Test nettoyage des erreurs."""
        manager = PluginManager('dummy_path')
        manager._loading_errors['path1'] = 'error1'
        manager._loading_errors['path2'] = 'error2'
        
        assert len(manager.get_discovery_errors()) == 2
        
        manager.clear_errors()
        
        assert len(manager.get_discovery_errors()) == 0


class TestPluginManagerHotReload:
    """Tests du hot-reload : tout plugin chargé (officiel comme custom) dont
    le point d'entrée est édité est rechargé au prochain get_plugin."""

    def test_official_plugin_reloads_on_source_edit(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin official chargé puis édité est rechargé automatiquement."""
        import os

        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        entry = plugin_dir / 'main.py'
        entry.write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        wrapper1 = manager.get_plugin('test_plugin')
        assert wrapper1 is not None
        assert 'test_plugin' in manager._watched_sources

        # Éditer la source avec un mtime strictement postérieur
        new_mtime = os.path.getmtime(entry) + 10
        os.utime(entry, (new_mtime, new_mtime))

        wrapper2 = manager.get_plugin('test_plugin')
        assert wrapper2 is not None
        # Le plugin a été rechargé : pas la même instance de wrapper
        assert wrapper2 is not wrapper1


class TestPluginManagerEntryPointCheck:
    """Tests de la vérification d'existence du point d'entrée à la découverte."""

    def test_missing_entry_point_reported_in_discovery_errors(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin.json valide mais sans main.py doit remonter une erreur
        de découverte (au lieu d'échouer silencieusement au premier get_plugin)."""
        plugin_dir = temp_plugins_dir / 'official' / 'no_entry_plugin'
        plugin_dir.mkdir(parents=True)

        # plugin.json valide pointant vers un entry_point inexistant
        with open(plugin_dir / 'plugin.json', 'w', encoding='utf-8') as f:
            json.dump(valid_plugin_json, f)

        manager = PluginManager(str(temp_plugins_dir), app)
        discovered = manager.discover_plugins()

        # Le plugin n'est pas découvert
        assert len(discovered) == 0

        # Mais l'erreur est remontée via get_discovery_errors()
        errors = manager.get_discovery_errors()
        assert str(plugin_dir) in errors
        assert 'Point d' in errors[str(plugin_dir)]
        assert 'main.py' in errors[str(plugin_dir)]


class TestPluginManagerRelocation:
    """Tests de déplacement d'un plugin : un plugin déplacé (custom -> official
    ou dossier renommé) doit survivre à une SEULE découverte, en conservant sa
    ligne DB (id, enabled) et en mettant à jour path/source."""

    def test_moved_plugin_survives_single_discovery(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin déplacé de custom/ vers official/ n'est pas supprimé."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'test_plugin', valid_plugin_json
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            plugin_id = plugin.id
            plugin.enabled = False
            db.session.commit()

        # Déplacer le dossier vers official/
        new_dir = temp_plugins_dir / 'official' / 'test_plugin'
        shutil.move(str(plugin_dir), str(new_dir))

        # Une seule découverte doit suffire
        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            assert plugin is not None
            assert plugin.id == plugin_id
            assert plugin.path == str(new_dir)
            assert plugin.source == 'official'
            assert plugin.enabled is False

    def test_renamed_plugin_dir_survives_single_discovery(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un dossier renommé dans custom/ (name inchangé dans plugin.json)
        n'est pas supprimé."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'test_plugin', valid_plugin_json
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            plugin_id = plugin.id

        # Renommer le dossier (le name du plugin.json ne change pas)
        new_dir = temp_plugins_dir / 'custom' / 'test_plugin_renamed'
        shutil.move(str(plugin_dir), str(new_dir))

        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            assert plugin is not None
            assert plugin.id == plugin_id
            assert plugin.path == str(new_dir)
            assert plugin.source == 'custom'

    def test_moved_plugin_is_unloaded_and_reloads_from_new_path(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin chargé puis déplacé est déchargé à la découverte, puis
        rechargé depuis son nouvel emplacement au prochain get_plugin."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'test_plugin', valid_plugin_json
        )
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        wrapper = manager.get_plugin('test_plugin')
        assert wrapper is not None
        assert 'test_plugin' in manager.loaded_plugins

        new_dir = temp_plugins_dir / 'official' / 'test_plugin'
        shutil.move(str(plugin_dir), str(new_dir))

        manager.discover_plugins()

        # Le wrapper pointant vers l'ancien dossier a été déchargé
        assert 'test_plugin' not in manager.loaded_plugins

        # Le prochain get_plugin recharge depuis le nouveau chemin
        wrapper = manager.get_plugin('test_plugin')
        assert wrapper is not None
        assert wrapper.metadata.path == str(new_dir)

        result = manager.execute_plugin('test_plugin', {})
        assert result['status'] == 'ok'


class TestPluginManagerDiscoveryErrorStatus:
    """Tests de remontée des erreurs de découverte dans le statut des plugins.

    _loading_errors est indexé par CHEMIN de dossier pour les erreurs de
    découverte : le statut d'un plugin enregistré doit donc aussi regarder
    son path, et les dossiers jamais enregistrés sont exposés via
    get_orphan_discovery_errors().
    """

    def test_status_reports_discovery_error_for_registered_plugin(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin enregistré dont le plugin.json devient invalide affiche
        l'erreur dans get_plugin_status (et sa ligne DB survit)."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        # Corrompre le plugin.json (champ requis manquant)
        invalid_data = valid_plugin_json.copy()
        del invalid_data['version']
        with open(plugin_dir / 'plugin.json', 'w', encoding='utf-8') as f:
            json.dump(invalid_data, f)

        manager.discover_plugins()

        status = manager.get_plugin_status()
        assert 'test_plugin' in status
        assert status['test_plugin']['error']
        assert 'version' in status['test_plugin']['error']

        with app.app_context():
            assert Plugin.query.filter_by(name='test_plugin').first() is not None

    def test_status_reports_missing_entry_point_for_registered_plugin(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin enregistré dont le point d'entrée disparaît affiche
        l'erreur dans get_plugin_status."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        (plugin_dir / 'main.py').unlink()

        manager.discover_plugins()

        status = manager.get_plugin_status()
        assert 'test_plugin' in status
        assert status['test_plugin']['error']
        assert 'Point d' in status['test_plugin']['error']

    def test_orphan_discovery_errors_only_lists_unregistered_dirs(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """get_orphan_discovery_errors contient les dossiers jamais enregistrés,
        pas les chemins des plugins présents en DB."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )

        # Dossier invalide dès le départ : jamais enregistré en DB
        orphan_dir = temp_plugins_dir / 'custom' / 'orphan_plugin'
        orphan_dir.mkdir(parents=True)
        orphan_data = valid_plugin_json.copy()
        orphan_data['name'] = 'orphan_plugin'
        orphan_data['plugin_type'] = 'invalid_type'
        with open(orphan_dir / 'plugin.json', 'w', encoding='utf-8') as f:
            json.dump(orphan_data, f)
        (orphan_dir / 'main.py').write_text('# orphan\n')

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        # Corrompre ensuite le plugin enregistré
        invalid_data = valid_plugin_json.copy()
        del invalid_data['version']
        with open(plugin_dir / 'plugin.json', 'w', encoding='utf-8') as f:
            json.dump(invalid_data, f)

        manager.discover_plugins()

        orphans = manager.get_orphan_discovery_errors()
        assert str(orphan_dir) in orphans
        assert str(plugin_dir) not in orphans

    def test_schema_error_message_contains_reason(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """L'erreur stockée pour un plugin.json invalide selon le schéma
        contient la raison jsonschema (champ et valeur fautifs)."""
        invalid_data = valid_plugin_json.copy()
        invalid_data['plugin_type'] = 'rust'
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', invalid_data
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        errors = manager.get_discovery_errors()
        error = errors[str(plugin_dir)]
        assert error.startswith("Validation échouée:")
        assert 'plugin_type' in error or 'rust' in error


class TestPluginManagerHotReloadMultiFile:
    """Tests du hot-reload multi-fichiers : l'édition d'un module frère ou
    du plugin.json recharge le wrapper au prochain get_plugin."""

    def test_sibling_edit_triggers_reload_e2e(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin multi-fichiers exécuté, dont le helper est édité, est
        rechargé automatiquement (execute retourne la nouvelle valeur)."""
        import os

        data = valid_plugin_json.copy()
        data['name'] = 'rel_e2e_plugin'
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'rel_e2e_plugin', data
        )
        helper = plugin_dir / 'e2e_helper.py'
        helper.write_text("VALUE = 'v1'\n", encoding='utf-8')
        (plugin_dir / 'main.py').write_text(
            'from .e2e_helper import VALUE\n'
            'class RelE2ePluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": [{"text_output": VALUE}]}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('rel_e2e_plugin', {})
        assert result['status'] == 'ok'
        assert result['results'][0]['text_output'] == 'v1'

        # Éditer le helper avec un mtime strictement postérieur
        helper.write_text("VALUE = 'v2'\n", encoding='utf-8')
        new_mtime = os.path.getmtime(helper) + 10
        os.utime(helper, (new_mtime, new_mtime))

        result = manager.execute_plugin('rel_e2e_plugin', {})
        assert result['status'] == 'ok'
        assert result['results'][0]['text_output'] == 'v2'

    def test_plugin_json_change_unloads_wrapper(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Une modification de plugin.json décharge le wrapper chargé : le
        prochain get_plugin repart des métadonnées fraîches."""
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', valid_plugin_json
        )
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        assert manager.get_plugin('test_plugin') is not None
        assert 'test_plugin' in manager.loaded_plugins

        updated_data = valid_plugin_json.copy()
        updated_data['version'] = '1.0.1'
        with open(plugin_dir / 'plugin.json', 'w', encoding='utf-8') as f:
            json.dump(updated_data, f)

        manager.discover_plugins()

        assert 'test_plugin' not in manager.loaded_plugins

        wrapper = manager.get_plugin('test_plugin')
        assert wrapper is not None
        assert wrapper.metadata.version == '1.0.1'


class TestPluginManagerDuplicateNames:
    """Tests de dédoublonnage par nom : un custom l'emporte sur un official
    de même nom ; à source égale, le dossier au chemin trié en premier."""

    def _dup_json(self, valid_plugin_json, version):
        data = valid_plugin_json.copy()
        data['name'] = 'dup_plugin'
        data['version'] = version
        return data

    def test_custom_overrides_official_same_name(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """official/dup (v1) + custom/dup (v2), même name : le custom gagne."""
        official_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'dup',
            self._dup_json(valid_plugin_json, '1.0.0')
        )
        custom_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'dup',
            self._dup_json(valid_plugin_json, '2.0.0')
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        discovered = manager.discover_plugins()

        assert [p['name'] for p in discovered].count('dup_plugin') == 1

        with app.app_context():
            plugin = Plugin.query.filter_by(name='dup_plugin').first()
            assert plugin is not None
            assert plugin.source == 'custom'
            assert plugin.version == '2.0.0'
            assert plugin.path == str(custom_dir)

        errors = manager.get_discovery_errors()
        assert str(official_dir) in errors
        assert 'double' in errors[str(official_dir)]

        orphans = manager.get_orphan_discovery_errors()
        assert str(official_dir) in orphans

    def test_duplicate_name_discovery_is_stable(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Une re-découverte ne doit pas faire flip-flopper la ligne ni
        décharger le plugin chargé."""
        for source in ('official', 'custom'):
            plugin_dir = create_test_plugin(
                temp_plugins_dir, source, 'dup',
                self._dup_json(valid_plugin_json, '1.0.0')
            )
            (plugin_dir / 'main.py').write_text(
                'class DupPluginPlugin:\n'
                '    def execute(self, inputs):\n'
                '        return {"status": "ok", "results": []}\n',
                encoding='utf-8',
            )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        assert manager.get_plugin('dup_plugin') is not None
        assert 'dup_plugin' in manager.loaded_plugins

        with app.app_context():
            before = Plugin.query.filter_by(name='dup_plugin').first()
            row_id, row_path, row_source = before.id, before.path, before.source

        manager.discover_plugins()

        assert 'dup_plugin' in manager.loaded_plugins

        with app.app_context():
            after = Plugin.query.filter_by(name='dup_plugin').first()
            assert after.id == row_id
            assert after.path == row_path
            assert after.source == row_source

    def test_duplicate_name_same_source_first_path_wins(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Deux dossiers custom de même name : le chemin trié en premier
        gagne, l'autre est signalé."""
        a_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'a_dir',
            self._dup_json(valid_plugin_json, '1.0.0')
        )
        b_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'b_dir',
            self._dup_json(valid_plugin_json, '1.0.0')
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='dup_plugin').first()
            assert plugin is not None
            assert plugin.path == str(a_dir)

        errors = manager.get_discovery_errors()
        assert str(b_dir) in errors
        assert 'double' in errors[str(b_dir)]

    def test_removing_custom_duplicate_falls_back_to_official(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Supprimer le custom dupliqué fait revenir l'official, même ligne."""
        official_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'dup',
            self._dup_json(valid_plugin_json, '1.0.0')
        )
        custom_dir = create_test_plugin(
            temp_plugins_dir, 'custom', 'dup',
            self._dup_json(valid_plugin_json, '2.0.0')
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        with app.app_context():
            row_id = Plugin.query.filter_by(name='dup_plugin').first().id

        shutil.rmtree(custom_dir)
        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='dup_plugin').first()
            assert plugin is not None
            assert plugin.id == row_id
            assert plugin.source == 'official'
            assert plugin.version == '1.0.0'
            assert plugin.path == str(official_dir)

        errors = manager.get_discovery_errors()
        assert not any('double' in error for error in errors.values())


class TestPluginManagerRuntimePreferences:
    """Tests de refresh_runtime_preferences : une préférence executor
    modifiée doit se répercuter sur les wrappers déjà chargés."""

    def test_refresh_runtime_preferences_updates_loaded_wrapper_timeout(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Changer timeoutSec / allowLongRunning met à jour le timeout du
        wrapper chargé, sans rechargement."""
        from gc_backend.utils.preferences import set_preference_value

        data = valid_plugin_json.copy()
        data['timeout_seconds'] = 120
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', data
        )
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        wrapper = manager.get_plugin('test_plugin')
        assert wrapper is not None
        # Capé par le timeout par défaut (60)
        assert wrapper.metadata.timeout_seconds == 60

        with app.app_context():
            set_preference_value('geoApp.plugins.executor.timeoutSec', 20)
        manager.refresh_runtime_preferences()

        assert manager.default_timeout == 20
        assert manager.loaded_plugins['test_plugin'] is wrapper
        assert wrapper.metadata.timeout_seconds == 20

        with app.app_context():
            set_preference_value('geoApp.plugins.executor.allowLongRunning', True)
        manager.refresh_runtime_preferences()

        assert wrapper.metadata.timeout_seconds == 120

    def test_refresh_runtime_preferences_keeps_meta_plugins_without_watchdog(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Les plugins meta restent à timeout 0 (pas de watchdog) avant et
        après un changement de timeoutSec."""
        from gc_backend.utils.preferences import set_preference_value

        data = valid_plugin_json.copy()
        data['name'] = 'meta_plugin'
        data['kinds'] = ['meta']
        data['timeout_seconds'] = 120
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'meta_plugin', data
        )
        (plugin_dir / 'main.py').write_text(
            'class MetaPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        wrapper = manager.get_plugin('meta_plugin')
        assert wrapper is not None
        assert wrapper.metadata.timeout_seconds == 0

        with app.app_context():
            set_preference_value('geoApp.plugins.executor.timeoutSec', 20)
        manager.refresh_runtime_preferences()

        assert wrapper.metadata.timeout_seconds == 0


class TestPluginManagerExecutionLimit:
    """Tests de la borne executor.maxParallelRuns sur les exécutions
    simultanées de plugins."""

    def _make_marker_plugin(
        self, temp_plugins_dir, valid_plugin_json,
        name='test_plugin', main_py=None, sleep='0.15'
    ):
        """Plugin qui ajoute 'S' en début et 'E' en fin d'exécution à une
        liste MARKERS de son module (partagée entre exécutions concurrentes,
        lue via sys.modules['geoapp_plugin_<name>'].MARKERS)."""
        data = valid_plugin_json.copy()
        data['name'] = name
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', name, data
        )
        class_name = ''.join(
            part.capitalize() for part in name.split('_')
        ) + 'Plugin'
        if main_py is None:
            main_py = (
                'import time\n'
                'MARKERS = []\n'
                f'class {class_name}:\n'
                '    def execute(self, inputs):\n'
                "        MARKERS.append('S')\n"
                f'        time.sleep({sleep})\n'
                "        MARKERS.append('E')\n"
                '        return {"status": "ok", "results": []}\n'
            )
        (plugin_dir / 'main.py').write_text(main_py, encoding='utf-8')
        return plugin_dir

    @staticmethod
    def _markers(name):
        # Le point d'entrée main.py est chargé comme sous-module du package
        # geoapp_plugin_<name> (cf. wrappers.py).
        import sys
        return sys.modules[f'geoapp_plugin_{name}.main'].MARKERS

    def test_executions_serialized_when_limit_is_one(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Avec max_parallel_runs=1, trois exécutions concurrentes se
        sérialisent : marqueurs strictement alternés S,E,S,E,S,E."""
        self._make_marker_plugin(
            temp_plugins_dir, valid_plugin_json, name='limit_serial_plugin'
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.max_parallel_runs = 1
        manager.discover_plugins()

        threads = [
            threading.Thread(
                target=manager.execute_plugin,
                args=('limit_serial_plugin', {})
            )
            for _ in range(3)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)

        assert self._markers('limit_serial_plugin') == ['S', 'E'] * 3

    def test_executions_overlap_when_limit_allows(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Avec max_parallel_runs=3, trois exécutions concurrentes se
        recouvrent : les trois 'S' précèdent le premier 'E'."""
        self._make_marker_plugin(
            temp_plugins_dir, valid_plugin_json, name='limit_overlap_plugin'
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.max_parallel_runs = 3
        manager.discover_plugins()

        barrier = threading.Barrier(3)
        threads = [
            threading.Thread(
                target=lambda: (
                    barrier.wait(),
                    manager.execute_plugin('limit_overlap_plugin', {}),
                )
            )
            for _ in range(3)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)

        markers = self._markers('limit_overlap_plugin')
        assert markers.count('S') == 3 and markers.count('E') == 3
        assert markers[:3] == ['S', 'S', 'S']

    def test_nested_plugin_execution_does_not_deadlock(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Un plugin non-meta qui exécute un autre plugin en interne ne se
        bloque pas, même avec max_parallel_runs=1."""
        # Plugin enfant
        self._make_marker_plugin(
            temp_plugins_dir, valid_plugin_json,
            name='limit_child_plugin', sleep='0'
        )
        # Plugin orchestrateur (non-meta) : appelle l'enfant dans le même
        # thread que son execute (le thread worker du wrapper hérite de la
        # profondeur d'exécution via contextvars).
        main_py = (
            'class LimitOrchestratorPlugin:\n'
            '    def __init__(self):\n'
            '        self._plugin_manager = None\n'
            '    def set_plugin_manager(self, pm):\n'
            '        self._plugin_manager = pm\n'
            '    def execute(self, inputs):\n'
            '        child = self._plugin_manager.execute_plugin('
            "'limit_child_plugin', {})\n"
            '        return {"status": "ok", "results": [], '
            '"child_status": child.get("status")}\n'
        )
        data = valid_plugin_json.copy()
        data['name'] = 'limit_orchestrator'
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'limit_orchestrator', data
        )
        (plugin_dir / 'main.py').write_text(main_py, encoding='utf-8')

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.max_parallel_runs = 1
        manager.discover_plugins()

        result_box = {}
        done = threading.Event()

        def run():
            result_box['result'] = manager.execute_plugin('limit_orchestrator', {})
            done.set()

        t = threading.Thread(target=run, daemon=True)
        t.start()
        assert done.wait(timeout=20), (
            "Exécution imbriquée bloquée par la borne maxParallelRuns"
        )
        assert result_box['result']['status'] == 'ok'

    def test_meta_plugin_consumes_no_slot(
        self, app, temp_plugins_dir, valid_plugin_json, tmp_path
    ):
        """Un plugin kinds=['meta'] n'occupe pas de slot : il peut
        s'exécuter pendant qu'un plugin feuille tient l'unique slot."""
        import sys
        import time

        self._make_marker_plugin(
            temp_plugins_dir, valid_plugin_json,
            name='limit_leaf_plugin', sleep='2.0'
        )
        data = valid_plugin_json.copy()
        data['name'] = 'limit_meta_plugin'
        data['kinds'] = ['meta']
        meta_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'limit_meta_plugin', data
        )
        (meta_dir / 'main.py').write_text(
            'class MetaPluginPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.max_parallel_runs = 1
        manager.discover_plugins()

        leaf_result = {}
        t1 = threading.Thread(
            target=lambda: leaf_result.setdefault(
                'r', manager.execute_plugin('limit_leaf_plugin', {})),
            daemon=True,
        )
        t1.start()

        # Attendre que le plugin feuille tienne le slot (marqueur 'S')
        deadline = time.time() + 10
        while time.time() < deadline:
            module = sys.modules.get('geoapp_plugin_limit_leaf_plugin.main')
            if module is not None and 'S' in module.MARKERS:
                break
            time.sleep(0.02)
        else:
            pytest.fail("Le plugin feuille n'a pas démarré")

        # Le meta doit finir AVANT la fin du sommeil du plugin feuille :
        # s'il consommait un slot, il attendrait ~2s.
        started = time.time()
        meta_result = manager.execute_plugin('limit_meta_plugin', {})
        elapsed = time.time() - started

        assert meta_result['status'] == 'ok'
        assert elapsed < 1.0, (
            f"Le plugin meta a attendu un slot ({elapsed:.2f}s)"
        )
        assert 'E' not in self._markers('limit_leaf_plugin')

        t1.join(timeout=30)
        assert not t1.is_alive()
        assert leaf_result['r']['status'] == 'ok'

    def test_max_parallel_runs_preference_applies_hot(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Changer la préférence executor.maxParallelRuns met à jour
        manager.max_parallel_runs via refresh_runtime_preferences."""
        from gc_backend.utils.preferences import set_preference_value

        self._make_marker_plugin(
            temp_plugins_dir, valid_plugin_json, name='limit_pref_plugin'
        )
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        assert manager.max_parallel_runs == 2  # défaut du schéma

        with app.app_context():
            set_preference_value('geoApp.plugins.executor.maxParallelRuns', 4)
        manager.refresh_runtime_preferences()
        assert manager.max_parallel_runs == 4

        with app.app_context():
            set_preference_value('geoApp.plugins.executor.maxParallelRuns', 1)
        manager.refresh_runtime_preferences()
        assert manager.max_parallel_runs == 1


class TestPluginManagerEnableDisable:
    """Tests de set_plugin_enabled : activer/désactiver un plugin à chaud."""

    def _make_executable_plugin(
        self, temp_plugins_dir, valid_plugin_json, name='test_plugin'
    ):
        data = valid_plugin_json.copy()
        data['name'] = name
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', name, data
        )
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )
        return plugin_dir

    def test_set_plugin_enabled_disable(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Désactiver un plugin chargé le décharge, bloque get_plugin et
        execute retourne plugin_disabled (cache d'infos invalidé)."""
        self._make_executable_plugin(temp_plugins_dir, valid_plugin_json)

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        assert manager.get_plugin('test_plugin') is not None

        # Réchauffer le cache d'infos pour vérifier son invalidation
        assert manager.get_plugin_info('test_plugin')['enabled'] is True

        result = manager.set_plugin_enabled('test_plugin', False)
        assert result is not None
        assert result['enabled'] is False

        assert 'test_plugin' not in manager.loaded_plugins
        assert manager.get_plugin('test_plugin') is None

        exec_result = manager.execute_plugin('test_plugin', {})
        assert exec_result['status'] == 'error'
        assert exec_result['error']['code'] == 'plugin_disabled'

        assert manager.get_plugin_info('test_plugin')['enabled'] is False

    def test_set_plugin_enabled_reenable_and_unknown(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Réactiver rend le plugin exécutable ; un nom inconnu → None."""
        self._make_executable_plugin(temp_plugins_dir, valid_plugin_json)

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        manager.set_plugin_enabled('test_plugin', False)
        result = manager.set_plugin_enabled('test_plugin', True)
        assert result is not None
        assert result['enabled'] is True

        exec_result = manager.execute_plugin('test_plugin', {})
        assert exec_result['status'] == 'ok'

        assert manager.set_plugin_enabled('unknown_plugin', True) is None

    def test_disabled_state_survives_rediscovery(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """La désactivation survit à une re-découverte, même après un bump
        de version du plugin.json."""
        plugin_dir = self._make_executable_plugin(
            temp_plugins_dir, valid_plugin_json
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        manager.set_plugin_enabled('test_plugin', False)

        # Bump de version puis re-découverte
        updated_data = valid_plugin_json.copy()
        updated_data['version'] = '1.0.1'
        with open(plugin_dir / 'plugin.json', 'w', encoding='utf-8') as f:
            json.dump(updated_data, f)

        manager.discover_plugins()

        with app.app_context():
            plugin = Plugin.query.filter_by(name='test_plugin').first()
            assert plugin.enabled is False
            assert plugin.version == '1.0.1'

    def test_unknown_plugin_execute_is_unavailable(
        self, app, temp_plugins_dir
    ):
        """Un plugin inexistant retourne plugin_unavailable (pas disabled)."""
        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        exec_result = manager.execute_plugin('nonexistent_plugin', {})
        assert exec_result['status'] == 'error'
        assert exec_result['error']['code'] == 'plugin_unavailable'


class TestPluginManagerDependencies:
    """Tests du rapport des dépendances manquantes (distributions pip et
    plugins requis) — jamais bloquant, simple avertissement."""

    def _make_plugin(
        self, temp_plugins_dir, valid_plugin_json, name, dependencies=None
    ):
        data = valid_plugin_json.copy()
        data['name'] = name
        if dependencies is not None:
            data['dependencies'] = dependencies
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', name, data
        )
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )
        return plugin_dir

    def test_status_reports_missing_distribution(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Une distribution absente est rapportée, une installée non ; un
        plugin sans dependencies a une liste vide."""
        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'test_plugin',
            dependencies=["definitely-not-installed-pkg-xyz", "jsonschema"]
        )
        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'nodep_plugin'
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        status = manager.get_plugin_status()
        assert status['test_plugin']['missing_dependencies'] == [
            "definitely-not-installed-pkg-xyz"
        ]
        assert status['nodep_plugin']['missing_dependencies'] == []

    def test_dependency_name_normalization(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Casse et specifiers de version ignorés : Jsonschema>=1.0 est
        considéré installé."""
        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'test_plugin',
            dependencies=["Jsonschema>=1.0", "pytest"]
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        status = manager.get_plugin_status()
        assert status['test_plugin']['missing_dependencies'] == []

    def test_plugin_dependency_enabled_and_disabled(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Une dépendance nommant un autre plugin est satisfaite s'il est
        activé ; 'plugin désactivé' sinon ; nom nu si le plugin n'existe pas."""
        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'plugin_a',
            dependencies=["plugin_b"]
        )
        b_dir = self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'plugin_b'
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        status = manager.get_plugin_status()
        assert status['plugin_a']['missing_dependencies'] == []

        manager.set_plugin_enabled('plugin_b', False)
        status = manager.get_plugin_status()
        assert status['plugin_a']['missing_dependencies'] == [
            "plugin_b (plugin désactivé)"
        ]

        # Sans le dossier de B (ni distribution de ce nom) : dépendance nue
        shutil.rmtree(b_dir)
        manager.discover_plugins()
        status = manager.get_plugin_status()
        assert status['plugin_a']['missing_dependencies'] == ["plugin_b"]

    def test_dependency_check_is_cached(
        self, app, temp_plugins_dir, valid_plugin_json, monkeypatch
    ):
        """La vérification de distribution est mémoïsée et re-vérifiée à la
        découverte suivante."""
        import importlib.metadata

        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'test_plugin',
            dependencies=["jsonschema", "requests"]
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        calls = []
        real_distribution = importlib.metadata.distribution

        def counting_distribution(name):
            calls.append(name)
            return real_distribution(name)

        monkeypatch.setattr(
            importlib.metadata, 'distribution', counting_distribution
        )

        manager.get_plugin_status()
        manager.get_plugin_status()
        assert len(calls) == 2

        # La découverte vide le cache : re-vérification des deux deps
        manager.discover_plugins()
        manager.get_plugin_status()
        assert len(calls) == 4

    def test_execute_error_warns_about_missing_dependencies(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Une exécution en erreur avec dépendances manquantes ajoute un
        warning ; une exécution réussie n'en a pas."""
        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'test_plugin',
            dependencies=["definitely-not-installed-pkg-xyz"]
        )
        plugin_dir = temp_plugins_dir / 'official' / 'test_plugin'
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        raise ValueError("boom")\n',
            encoding='utf-8',
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('test_plugin', {})
        assert result['status'] == 'error'
        warnings = result.get('warnings') or []
        assert any(
            w.startswith('Dépendances manquantes:') for w in warnings
        )

        # Plugin fonctionnel : pas de warning même avec la dépendance absente
        import os
        main_py = plugin_dir / 'main.py'
        main_py.write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "results": []}\n',
            encoding='utf-8',
        )
        new_mtime = os.path.getmtime(main_py) + 10
        os.utime(main_py, (new_mtime, new_mtime))
        manager.reload_plugin('test_plugin')

        result = manager.execute_plugin('test_plugin', {})
        assert result['status'] == 'ok'
        warnings = result.get('warnings') or []
        assert not any(
            w.startswith('Dépendances manquantes:') for w in warnings
        )

    def test_dependency_check_never_imports(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """La vérification ne doit jamais importer le paquet (easyocr/torch
        seraient bien trop lourds)."""
        import sys

        self._make_plugin(
            temp_plugins_dir, valid_plugin_json, 'test_plugin',
            dependencies=["definitely-not-installed-pkg-xyz"]
        )

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()
        manager.get_plugin_status()

        assert 'definitely_not_installed_pkg_xyz' not in sys.modules


class TestPluginManagerInputValidation:
    """Tests de la validation opt-in des inputs dans execute_plugin."""

    def _make_plugin(self, temp_plugins_dir, valid_plugin_json):
        data = valid_plugin_json.copy()
        data['input_types'] = {
            'text': {'type': 'string', 'label': 'Texte', 'required': True},
            'shift': {'type': 'number', 'label': 'Décalage', 'min': 1, 'max': 25},
        }
        plugin_dir = create_test_plugin(
            temp_plugins_dir, 'official', 'test_plugin', data
        )
        (plugin_dir / 'main.py').write_text(
            'class TestPlugin:\n'
            '    def execute(self, inputs):\n'
            '        return {"status": "ok", "summary": "executed",\n'
            '                "results": [{"id": "marker"}]}\n',
            encoding='utf-8',
        )
        return plugin_dir

    def test_validate_inputs_rejects_and_skips_execution(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Avec validate_inputs=True, des inputs invalides retournent une
        erreur 'invalid_inputs' SANS exécuter le plugin."""
        self._make_plugin(temp_plugins_dir, valid_plugin_json)

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        # 'text' requis manquant + 'shift' hors min/max
        result = manager.execute_plugin(
            'test_plugin', {'shift': 99}, validate_inputs=True
        )

        assert result['status'] == 'error'
        assert result['error']['code'] == 'invalid_inputs'
        assert result['error']['type'] == 'InputValidationError'
        assert set(result['error']['fields']) == {'text', 'shift'}
        # Le plugin n'a pas été exécuté (pas de résultat marqueur)
        assert result['results'] == []

    def test_validate_inputs_default_off_executes(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Sans validate_inputs (défaut), le même payload est exécuté —
        les orchestrateurs internes envoient des inputs partiels."""
        self._make_plugin(temp_plugins_dir, valid_plugin_json)

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin('test_plugin', {'shift': 99})

        assert result['status'] == 'ok'
        assert result['results'][0]['id'] == 'marker'

    def test_validate_inputs_valid_payload_executes(
        self, app, temp_plugins_dir, valid_plugin_json
    ):
        """Avec validate_inputs=True et des inputs valides, exécution normale."""
        self._make_plugin(temp_plugins_dir, valid_plugin_json)

        manager = PluginManager(str(temp_plugins_dir), app)
        manager.discover_plugins()

        result = manager.execute_plugin(
            'test_plugin', {'text': 'HELLO', 'shift': 3},
            validate_inputs=True
        )

        assert result['status'] == 'ok'
        assert result['results'][0]['id'] == 'marker'
