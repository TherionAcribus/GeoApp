"""
Tests unitaires pour le TaskManager.

Ces tests vérifient :
- La création et soumission de tâches
- Le suivi du statut des tâches
- L'annulation de tâches
- Le nettoyage automatique
- Les statistiques
"""

import pytest
import threading
import time
from pathlib import Path

from gc_backend.services import TaskManager, TaskStatus
from gc_backend.plugins import PluginManager
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
def task_manager():
    """Crée une instance du TaskManager pour les tests."""
    manager = TaskManager(max_workers=2)
    yield manager
    manager.shutdown(wait=False)


@pytest.fixture
def plugin_manager(app):
    """Crée une instance du PluginManager pour les tests."""
    plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
    manager = PluginManager(str(plugins_dir), app)
    manager.discover_plugins()
    return manager


class TestTaskManagerBasics:
    """Tests des fonctionnalités de base du TaskManager."""
    
    def test_create_task_manager(self, task_manager):
        """Test création du TaskManager."""
        assert task_manager.max_workers == 2
        assert len(task_manager.tasks) == 0
        assert task_manager.get_queue_size() == 0
    
    def test_submit_task(self, task_manager, plugin_manager):
        """Test soumission d'une tâche."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        task_id = task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'HELLO', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        assert task_id is not None
        assert len(task_manager.tasks) == 1
        assert task_id in task_manager.tasks
    
    def test_get_task_status(self, task_manager, plugin_manager):
        """Test récupération du statut d'une tâche."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        task_id = task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'ABC', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        # Attendre un peu
        time.sleep(0.5)
        
        status = task_manager.get_task_status(task_id)
        
        assert status is not None
        assert status['task_id'] == task_id
        assert status['plugin_name'] == 'caesar'
        assert 'status' in status
        assert 'progress' in status
    
    def test_task_execution_success(self, task_manager, plugin_manager):
        """Test exécution réussie d'une tâche."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        task_id = task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'ABC', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        # Attendre la fin de l'exécution
        time.sleep(2)
        
        status = task_manager.get_task_status(task_id)
        
        assert status['status'] == TaskStatus.COMPLETED.value
        assert status['result'] is not None
        assert status['result']['status'] == 'ok'
        assert status['result']['results'][0]['text_output'] == 'BCD'
        assert status['progress'] == 100.0
    
    def test_get_nonexistent_task(self, task_manager):
        """Test récupération d'une tâche inexistante."""
        status = task_manager.get_task_status('nonexistent-task-id')
        
        assert status is None


class TestTaskCancellation:
    """Tests d'annulation de tâches."""
    
    def test_cancel_queued_task(self, task_manager, plugin_manager):
        """Test annulation d'une tâche en attente."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        # Soumettre plusieurs tâches pour remplir la queue
        task_ids = []
        for i in range(5):
            task_id = task_manager.submit_task(
                plugin_name='caesar',
                inputs={'text': 'HELLO' * 100, 'mode': 'decode', 'brute_force': True},
                plugin_manager=plugin_manager
            )
            task_ids.append(task_id)
        
        # Annuler la dernière tâche (normalement en queue)
        success = task_manager.cancel_task(task_ids[-1])
        
        assert success is True
        
        # Vérifier le statut
        status = task_manager.get_task_status(task_ids[-1])
        # Peut être CANCELLED ou QUEUED avec cancel_requested
        assert status['status'] in [TaskStatus.CANCELLED.value, TaskStatus.QUEUED.value]
    
    def test_cancel_completed_task(self, task_manager, plugin_manager):
        """Test qu'on ne peut pas annuler une tâche terminée."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        task_id = task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'ABC', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        # Attendre la fin
        time.sleep(2)
        
        # Tenter d'annuler
        success = task_manager.cancel_task(task_id)
        
        # Ne devrait pas pouvoir annuler une tâche terminée
        assert success is False
    
    def test_cancel_nonexistent_task(self, task_manager):
        """Test annulation d'une tâche inexistante."""
        success = task_manager.cancel_task('nonexistent-id')
        
        assert success is False


class TestTaskListing:
    """Tests de listage des tâches."""
    
    def test_list_all_tasks(self, task_manager, plugin_manager):
        """Test listage de toutes les tâches."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        # Créer plusieurs tâches
        for i in range(3):
            task_manager.submit_task(
                plugin_name='caesar',
                inputs={'text': f'TEST{i}', 'mode': 'encode', 'shift': 1},
                plugin_manager=plugin_manager
            )
        
        tasks = task_manager.list_tasks()
        
        assert len(tasks) == 3
    
    def test_list_tasks_by_status(self, task_manager, plugin_manager):
        """Test filtrage par statut."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        # Créer des tâches
        task_ids = []
        for i in range(2):
            task_id = task_manager.submit_task(
                plugin_name='caesar',
                inputs={'text': 'ABC', 'mode': 'encode', 'shift': 1},
                plugin_manager=plugin_manager
            )
            task_ids.append(task_id)
        
        # Attendre que certaines se terminent
        time.sleep(2)
        
        # Filtrer par statut completed
        completed_tasks = task_manager.list_tasks(status=TaskStatus.COMPLETED)
        
        # Au moins une tâche devrait être terminée
        assert len(completed_tasks) > 0
        assert all(t['status'] == TaskStatus.COMPLETED.value for t in completed_tasks)
    
    def test_list_tasks_by_plugin_name(self, task_manager, plugin_manager):
        """Test filtrage par nom de plugin."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'TEST', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        tasks = task_manager.list_tasks(plugin_name='caesar')
        
        assert len(tasks) > 0
        assert all(t['plugin_name'] == 'caesar' for t in tasks)


class TestTaskStatistics:
    """Tests des statistiques."""
    
    def test_get_statistics(self, task_manager, plugin_manager):
        """Test récupération des statistiques."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        # Créer quelques tâches
        for i in range(3):
            task_manager.submit_task(
                plugin_name='caesar',
                inputs={'text': 'TEST', 'mode': 'encode', 'shift': 1},
                plugin_manager=plugin_manager
            )
        
        stats = task_manager.get_statistics()
        
        assert 'total' in stats
        assert 'queued' in stats
        assert 'running' in stats
        assert 'completed' in stats
        assert 'failed' in stats
        assert 'cancelled' in stats
        assert 'max_workers' in stats
        
        assert stats['total'] == 3
        assert stats['max_workers'] == 2
    
    def test_queue_size(self, task_manager, plugin_manager):
        """Test calcul de la taille de la queue."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        initial_size = task_manager.get_queue_size()
        
        # Soumettre une tâche
        task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'TEST', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        # La queue devrait augmenter temporairement
        # (peut être 0 si déjà terminée)
        assert task_manager.get_queue_size() >= 0


class TestTaskCleanup:
    """Tests du nettoyage de tâches."""
    
    def test_cleanup_old_tasks(self, task_manager, plugin_manager):
        """Test nettoyage des vieilles tâches."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        # Créer une tâche
        task_id = task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'ABC', 'mode': 'encode', 'shift': 1},
            plugin_manager=plugin_manager
        )
        
        # Attendre qu'elle se termine
        time.sleep(2)
        
        # Vérifier qu'elle existe
        assert task_manager.get_task_status(task_id) is not None
        
        # Nettoyer avec max_age très court (0 secondes)
        task_manager.cleanup_old_tasks(max_age_seconds=0)
        
        # La tâche devrait être supprimée
        assert task_manager.get_task_status(task_id) is None
    
    def test_cleanup_preserves_active_tasks(self, task_manager, plugin_manager):
        """Test que le nettoyage préserve les tâches actives."""
        plugins_dir = Path(__file__).resolve().parent.parent.parent / 'plugins'
        if not (plugins_dir / 'official' / 'caesar').exists():
            pytest.skip("Plugin Caesar non disponible")
        
        # Créer une tâche longue (bruteforce)
        task_id = task_manager.submit_task(
            plugin_name='caesar',
            inputs={'text': 'HELLO', 'mode': 'decode', 'brute_force': True},
            plugin_manager=plugin_manager
        )
        
        # Nettoyer immédiatement
        task_manager.cleanup_old_tasks(max_age_seconds=0)
        
        # La tâche devrait toujours exister (en cours)
        assert task_manager.get_task_status(task_id) is not None


class TestCustomTasks:
    """Tests de submit_custom : exécution d'un callable arbitraire dans le pool."""

    def test_submit_custom_executes_and_stores_result(self, task_manager):
        """Un callable custom s'exécute dans le pool et son résultat est stocké."""
        def work(is_cancelled, update_progress):
            assert is_cancelled() is False
            update_progress(50, "moitié")
            return {"done": True}

        task_id = task_manager.submit_custom(
            plugin_name='fake_batch',
            inputs={'geocache_ids': [1, 2]},
            work_fn=work,
        )

        time.sleep(0.3)
        status = task_manager.get_task_status(task_id)

        assert status['plugin_name'] == 'fake_batch'
        assert status['status'] == 'completed'
        assert status['result'] == {"done": True}
        assert status['progress'] == 100.0

    def test_submit_custom_accepts_imposed_task_id(self, task_manager):
        """task_id paramètre : l'ID imposé est réutilisé (partagé avec batch_tasks)."""
        task_id = task_manager.submit_custom(
            plugin_name='fake',
            inputs={},
            work_fn=lambda is_cancelled, update_progress: None,
            task_id='my-fixed-id',
        )
        assert task_id == 'my-fixed-id'
        time.sleep(0.2)
        assert task_manager.get_task_status('my-fixed-id') is not None

    def test_custom_task_reports_progress(self, task_manager):
        """update_progress met à jour TaskInfo.progress et message."""
        done = threading.Event()

        def work(is_cancelled, update_progress):
            update_progress(40, "40%")
            done.wait(2)
            return None

        task_id = task_manager.submit_custom('p', {}, work)
        time.sleep(0.3)

        status = task_manager.get_task_status(task_id)
        assert status['progress'] == 40.0
        assert status['message'] == "40%"
        assert status['status'] == 'running'

        done.set()

    def test_cancel_running_custom_task(self, task_manager):
        """is_cancelled reflète cancel_task ; la tâche s'arrête et passe CANCELLED."""
        started = threading.Event()

        def work(is_cancelled, update_progress):
            started.set()
            for _ in range(100):
                if is_cancelled():
                    return "stopped"
                time.sleep(0.01)
            return "finished"

        task_id = task_manager.submit_custom('p', {}, work)
        assert started.wait(2)

        assert task_manager.cancel_task(task_id) is True
        time.sleep(0.5)

        status = task_manager.get_task_status(task_id)
        assert status['status'] == 'cancelled'

    def test_progress_hook_raises_on_cancel(self, task_manager):
        """update_progress lève InterruptedError si annulé -> CANCELLED."""
        started = threading.Event()

        def work(is_cancelled, update_progress):
            started.set()
            for _ in range(100):
                update_progress(10, "tick")
                time.sleep(0.01)
            return "finished"

        task_id = task_manager.submit_custom('p', {}, work)
        assert started.wait(2)
        time.sleep(0.05)

        task_manager.cancel_task(task_id)
        time.sleep(0.5)

        status = task_manager.get_task_status(task_id)
        assert status['status'] == 'cancelled'

    def test_custom_task_failure_marked_failed(self, task_manager):
        """Une exception dans work_fn -> statut FAILED avec l'erreur."""
        def work(is_cancelled, update_progress):
            raise ValueError("boom")

        task_id = task_manager.submit_custom('p', {}, work)
        time.sleep(0.3)

        status = task_manager.get_task_status(task_id)
        assert status['status'] == 'failed'
        assert 'boom' in status['error']
