"""
Exécution isolée des plugins ``heavy_cpu`` dans un processus enfant.

Motivation : l'exécution in-process repose sur un thread daemon dont le
timeout ne fait que rendre la main à l'appelant — un plugin bloqué en
boucle CPU continue de consommer un cœur. Le sous-processus offre un vrai
kill (``terminate``/``kill``) et isole l'interpréteur du backend (imports
lourds type torch/z3, crashs natifs éventuels).

Deux modes d'isolation :
- ``run_in_subprocess`` : processus éphémère par exécution (one-shot) ;
- ``get_worker_pool`` : worker persistant par plugin, qui ne charge le
  plugin qu'une fois (évite de ré-importer torch/z3 à chaque appel) tout
  en gardant le vrai kill au timeout. Utilisé par les plugins heavy_cpu.

Limites assumées :
- pas de ``plugin_manager`` injecté dans l'enfant : un plugin heavy_cpu
  ne peut pas appeler ``execute_plugin`` (pas d'orchestration imbriquée) ;
- le contexte Flask de l'enfant est minimal (``db.session`` + config) :
  les blueprints/services du backend ne sont pas démarrés ;
- inputs et résultat doivent être sérialisables par pickle (les payloads
  JSON des plugins le sont) ;
- un worker persistant garde la mémoire du plugin (ex. modèles chargés)
  entre les exécutions : il est recyclé après WORKER_IDLE_TTL d'inactivité.
"""

import atexit
import multiprocessing as mp
import os
import queue as queue_mod
import threading
import time
import traceback
from typing import Any, Dict, Optional

from loguru import logger

# Un worker persistant restant inutilisé plus longtemps que ce délai est
# recyclé à la prochaine exécution (évite de garder torch en RAM à vie).
WORKER_IDLE_TTL = 600.0

# L'initialisation du worker (import du plugin, ex. torch pour easyocr) peut
# être très lente : délai généreux avant de déclarer le worker mort.
WORKER_INIT_TIMEOUT = 120.0


def _push_minimal_app_context(plugin_name: str):
    """
    Contexte applicatif minimal pour l'enfant : ``db.session`` et
    ``current_app.config`` fonctionnels — certains plugins lisent la base
    (ex. geocache_id -> images de la géocache). Même logique d'URI que
    ``create_app`` (TESTING -> base en mémoire ou GEOAPP_TEST_DATABASE_URI).
    """
    from flask import Flask

    from ..config import Config
    from ..database import db

    mini_app = Flask(f'geoapp-plugin-child-{plugin_name}')
    mini_app.config.from_object(Config)
    if os.environ.get('TESTING') == '1':
        mini_app.config['TESTING'] = True
        mini_app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
            'GEOAPP_TEST_DATABASE_URI', 'sqlite:///:memory:'
        )
    db.init_app(mini_app)
    return mini_app.app_context()


def _child_entry(
    plugin_dir: str,
    entry_point: str,
    name: str,
    inputs: Dict[str, Any],
    result_queue,
    needs_network: bool = False,
) -> None:
    """
    Point d'entrée du processus enfant.

    Doit rester une fonction top-level (picklable sous spawn). Charge le
    plugin via le wrapper standard — donc même convention de classe et
    isolation des modules frères qu'in-process — puis appelle execute().
    """
    try:
        from .wrappers import (
            PluginMetadata,
            PluginType,
            PythonPluginWrapper,
        )

        metadata = PluginMetadata(
            name=name,
            version='subprocess',
            plugin_type=PluginType.PYTHON,
            entry_point=entry_point,
            path=plugin_dir,
            timeout_seconds=0,
            needs_network=needs_network,
            # heavy_cpu=False exprès : l'enfant charge et exécute le
            # plugin localement, sans récursion de sous-processus.
        )
        wrapper = PythonPluginWrapper(metadata, plugin_manager=None)
        app_ctx = _push_minimal_app_context(name)
        try:
            app_ctx.push()
            if not needs_network:
                _install_network_guard()
            if not wrapper.initialize():
                result_queue.put({
                    'ok': False,
                    'error': "Échec d'initialisation du plugin en sous-processus",
                })
                return

            result = wrapper._instance.execute(inputs)
        finally:
            try:
                app_ctx.pop()
            except Exception:
                pass
        result_queue.put({'ok': True, 'result': result})

    except BaseException as exc:
        # Tout ce qui peut être renvoyé au parent l'est (le traceback est
        # une string, pas l'objet — non picklable tel quel).
        try:
            result_queue.put({
                'ok': False,
                'error': f'{type(exc).__name__}: {exc}',
                'traceback': traceback.format_exc(),
            })
        except Exception:
            pass


def run_in_subprocess(
    plugin_path: str,
    entry_point: str,
    plugin_name: str,
    inputs: Dict[str, Any],
    timeout: Optional[float] = None,
    needs_network: bool = False,
) -> Dict[str, Any]:
    """
    Exécute un plugin Python dans un processus enfant dédié.

    Args:
        plugin_path: Dossier du plugin (contient entry_point)
        entry_point: Fichier d'entrée (ex. 'main.py')
        plugin_name: Nom du plugin (logs, nom du process)
        inputs: Paramètres d'entrée du plugin
        timeout: Durée max en secondes ; au-delà le processus est tué.
            ``None`` = pas de limite.

    Returns:
        dict: Résultat brut du plugin

    Raises:
        TimeoutError: Le plugin a dépassé le délai (processus tué)
        RuntimeError: Crash du processus ou erreur remontée par l'enfant
    """
    ctx = mp.get_context('spawn')
    result_queue = ctx.Queue()
    proc = ctx.Process(
        target=_child_entry,
        args=(plugin_path, entry_point, plugin_name, inputs, result_queue,
              needs_network),
        daemon=True,
        name=f'plugin-subproc-{plugin_name}',
    )

    logger.debug(
        f"Exécution de {plugin_name} en sous-processus "
        f"(timeout={timeout if timeout else 'aucun'})"
    )
    started = time.monotonic()
    proc.start()

    msg: Optional[Dict[str, Any]] = None
    try:
        # Lecture du résultat en drainant la queue PENDANT que l'enfant
        # tourne : nécessaire pour les gros résultats (le thread feeder de
        # l'enfant attend que le pipe soit vidé pour terminer — un
        # proc.join() avant get() pourrait donc bloquer indéfiniment).
        while True:
            try:
                msg = result_queue.get(timeout=0.2)
                break
            except queue_mod.Empty:
                if not proc.is_alive():
                    # Processus terminé : dernière tentative de lecture.
                    try:
                        msg = result_queue.get_nowait()
                    except queue_mod.Empty:
                        raise RuntimeError(
                            f"Le plugin {plugin_name} s'est terminé sans "
                            f"produire de résultat (exitcode={proc.exitcode})"
                        )
                    break
                if timeout is not None and time.monotonic() - started > timeout:
                    proc.terminate()
                    proc.join(5)
                    if proc.is_alive():
                        proc.kill()
                        proc.join(2)
                    raise TimeoutError(
                        f"Plugin {plugin_name} tué après {timeout}s "
                        "en sous-processus"
                    )
    finally:
        if proc.is_alive():
            proc.terminate()
            proc.join(2)

    # L'enfant a produit son résultat : il devrait s'arrêter vite une fois
    # le pipe vidé ; terminate() couvre le cas où il resterait accroché.
    proc.join(5)
    if proc.is_alive():
        proc.terminate()
        proc.join(2)

    try:
        result_queue.close()
        result_queue.join_thread()
    except Exception:
        pass

    if not msg.get('ok'):
        tb = msg.get('traceback')
        if tb:
            logger.debug(
                f"Traceback du plugin {plugin_name} en sous-processus:\n{tb}"
            )
        raise RuntimeError(
            f"Plugin {plugin_name} en échec en sous-processus: "
            f"{msg.get('error', 'erreur inconnue')}"
        )

    logger.debug(
        f"Plugin {plugin_name} exécuté en sous-processus en "
        f"{time.monotonic() - started:.2f}s"
    )
    return msg['result']


# =============================================================================
# Garde réseau pour les plugins exécutés en sous-processus
# =============================================================================
#
# Un plugin qui ne déclare PAS ``needs_network: true`` n'a aucune raison
# d'ouvrir une connexion non-locale. La garde patch ``socket.socket`` DANS
# LE PROCESSUS ENFANT pour bloquer connect/sendto/sendmsg/bind vers des
# adresses non-loopback, plus la résolution DNS de noms non-locaux.
# Limites : protection applicative, pas un sandbox OS — un appel natif
# (lib C) contournerait le patch ; la boucle locale reste autorisée.

_NETWORK_BLOCK_MSG = (
    'Accès réseau bloqué pour ce plugin '
    '(déclarer "needs_network": true dans plugin.json si nécessaire)'
)


def _is_loopback_host(host) -> bool:
    """True si l'hôte désigne la boucle locale (sans résolution DNS)."""
    if not host:
        return False
    h = str(host).strip().lower().strip('[]')
    if h in ('localhost', 'localhost.localdomain'):
        return True
    try:
        import ipaddress
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def _install_network_guard() -> None:
    """Installe la garde réseau dans le processus courant (appeler dans l'enfant)."""
    import socket as _socket

    _BaseSocket = _socket.socket

    def _check_address(address) -> None:
        """Lève PermissionError si l'adresse n'est pas loopback."""
        host = address[0] if isinstance(address, tuple) else address
        if not _is_loopback_host(host):
            raise PermissionError(_NETWORK_BLOCK_MSG)

    def _check_args(args) -> None:
        """Cherche une adresse (host, port) dans les arguments positionnels."""
        for arg in reversed(args):
            if isinstance(arg, tuple):
                _check_address(arg)
                return

    class _GuardedSocket(_BaseSocket):
        def connect(self, address):
            _check_address(address)
            return super().connect(address)

        def connect_ex(self, address):
            _check_address(address)
            return super().connect_ex(address)

        def sendto(self, data, *args):
            _check_args(args)
            return super().sendto(data, *args)

        def sendmsg(self, *args, **kwargs):
            _check_args(args)
            return super().sendmsg(*args, **kwargs)

        def bind(self, address):
            _check_address(address)
            return super().bind(address)

    _orig_getaddrinfo = _socket.getaddrinfo

    def _guarded_getaddrinfo(host, *args, **kwargs):
        if host is not None and not _is_loopback_host(host):
            raise PermissionError(_NETWORK_BLOCK_MSG)
        return _orig_getaddrinfo(host, *args, **kwargs)

    def _blocked_resolver(*args, **kwargs):
        raise PermissionError(_NETWORK_BLOCK_MSG)

    _socket.socket = _GuardedSocket
    _socket.getaddrinfo = _guarded_getaddrinfo
    _socket.gethostbyname = _blocked_resolver
    _socket.gethostbyname_ex = _blocked_resolver


# =============================================================================
# Pool de workers persistants pour les plugins heavy_cpu
# =============================================================================
#
# Un worker par plugin : processus enfant gardé en vie qui charge le plugin une
# seule fois (torch/z3 importés au premier appel seulement) puis traite les
# exécutions à la demande via un pipe. Avantages vs spawn par exécution :
# - pas de ré-import des dépendances lourdes à chaque appel ;
# - état interne du plugin conservé entre appels (ex. modèle OCR déjà chargé).
# Le vrai kill au timeout est conservé : un worker bloqué est tué puis respawn
# à la demande. Un worker inactif plus de WORKER_IDLE_TTL est aussi recyclé.


def _worker_entry(child_conn, plugin_path: str, entry_point: str, name: str,
                  needs_network: bool) -> None:
    """
    Boucle d'un worker persistant (processus enfant).

    Initialise le plugin et le contexte applicatif une fois, envoie
    ``{'ready': True}``, puis traite les requêtes ``{'inputs': ...}`` jusqu'à
    réception du sentinel ``None`` ou fermeture du pipe.
    """
    app_ctx = None
    try:
        from .wrappers import (
            PluginMetadata,
            PluginType,
            PythonPluginWrapper,
        )
        from ..database import db

        metadata = PluginMetadata(
            name=name,
            version='worker',
            plugin_type=PluginType.PYTHON,
            entry_point=entry_point,
            path=plugin_path,
            timeout_seconds=0,
            needs_network=needs_network,
            # heavy_cpu=False : le worker exécute localement, sans récursion.
        )
        wrapper = PythonPluginWrapper(metadata, plugin_manager=None)
        app_ctx = _push_minimal_app_context(name)
        app_ctx.push()

        # Garde réseau avant l'import du plugin : sans needs_network, aucune
        # connexion non-loopback ne doit sortir du worker.
        if not needs_network:
            _install_network_guard()

        if not wrapper.initialize():
            child_conn.send({'ready': False, 'error': "Échec d'initialisation du plugin"})
            return
        child_conn.send({'ready': True})

        while True:
            try:
                req = child_conn.recv()
            except (EOFError, BrokenPipeError, OSError):
                break
            if req is None:
                break
            try:
                result = wrapper._instance.execute(req.get('inputs', {}))
                child_conn.send({'ok': True, 'result': result})
            except BaseException as exc:
                try:
                    child_conn.send({
                        'ok': False,
                        'error': f'{type(exc).__name__}: {exc}',
                        'traceback': traceback.format_exc(),
                    })
                except Exception:
                    break
            finally:
                try:
                    db.session.remove()
                except Exception:
                    pass

    except BaseException as exc:
        try:
            child_conn.send({
                'ready': False,
                'error': f'{type(exc).__name__}: {exc}',
                'traceback': traceback.format_exc(),
            })
        except Exception:
            pass
    finally:
        if app_ctx is not None:
            try:
                app_ctx.pop()
            except Exception:
                pass


class _WorkerProcess:
    """Worker persistant d'un plugin heavy_cpu (1 processus, accès sérialisé)."""

    def __init__(self, plugin_path: str, entry_point: str, name: str, idle_ttl: float,
                 needs_network: bool = False):
        self.plugin_path = plugin_path
        self.entry_point = entry_point
        self.name = name
        self.idle_ttl = idle_ttl
        self.needs_network = needs_network
        self.lock = threading.Lock()
        self._proc = None
        self._conn = None
        self.last_used = 0.0

    def _kill_locked(self) -> None:
        """Tue le processus worker. Doit être appelé sous ``self.lock``."""
        proc, conn = self._proc, self._conn
        self._proc = None
        self._conn = None
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        if proc is not None:
            if proc.is_alive():
                proc.terminate()
                proc.join(2)
                if proc.is_alive():
                    proc.kill()
                    proc.join(2)
            else:
                proc.join(0)

    def _spawn_locked(self) -> None:
        """Démarre le worker et attend sa ready. Doit être appelé sous ``self.lock``."""
        self._kill_locked()
        ctx = mp.get_context('spawn')
        parent_conn, child_conn = ctx.Pipe(duplex=True)
        proc = ctx.Process(
            target=_worker_entry,
            args=(child_conn, self.plugin_path, self.entry_point, self.name,
                  self.needs_network),
            daemon=True,
            name=f'plugin-worker-{self.name}',
        )
        self._conn = parent_conn
        self._proc = proc
        proc.start()
        child_conn.close()

        try:
            if not parent_conn.poll(WORKER_INIT_TIMEOUT):
                raise RuntimeError(
                    f"Worker {self.name}: initialisation dépassée "
                    f"({WORKER_INIT_TIMEOUT:.0f}s, import du plugin trop long ?)"
                )
            msg = parent_conn.recv()
            if not msg.get('ready'):
                tb = msg.get('traceback')
                if tb:
                    logger.debug(f"Traceback init worker {self.name}:\n{tb}")
                raise RuntimeError(
                    f"Worker {self.name}: {msg.get('error', 'init échouée')}"
                )
            self.last_used = time.monotonic()
            logger.debug(f"Worker persistant démarré pour {self.name} (pid={proc.pid})")
        except BaseException:
            self._kill_locked()
            raise

    def execute(self, inputs: Dict[str, Any], timeout: Optional[float],
                needs_network: Optional[bool] = None) -> Dict[str, Any]:
        """Exécute le plugin dans le worker (accès sérialisé par plugin)."""
        with self.lock:
            # Le flag réseau vient des métadonnées lues à l'exécution : s'il a
            # changé (plugin.json modifié puis redécouvert), le worker respawn.
            if needs_network is not None and needs_network != self.needs_network:
                self.needs_network = needs_network
                self._kill_locked()

            expired = (
                self.idle_ttl is not None
                and time.monotonic() - self.last_used > self.idle_ttl
            )
            if self._proc is None or not self._proc.is_alive() or expired:
                if expired:
                    logger.debug(f"Worker {self.name} recyclé après inactivité")
                self._spawn_locked()

            conn = self._conn
            try:
                conn.send({'inputs': inputs})
            except (EOFError, BrokenPipeError, OSError) as e:
                self._kill_locked()
                raise RuntimeError(f"Worker {self.name} injoignable: {e}")

            if not conn.poll(timeout):
                self._kill_locked()
                raise TimeoutError(
                    f"Plugin {self.name} tué après {timeout}s (worker persistant)"
                )
            try:
                msg = conn.recv()
            except (EOFError, BrokenPipeError, OSError) as e:
                self._kill_locked()
                raise RuntimeError(f"Worker {self.name} mort pendant l'exécution: {e}")

            self.last_used = time.monotonic()

            if not msg.get('ok'):
                tb = msg.get('traceback')
                if tb:
                    logger.debug(f"Traceback du plugin {self.name} (worker):\n{tb}")
                raise RuntimeError(
                    f"Plugin {self.name} en échec (worker): "
                    f"{msg.get('error', 'erreur inconnue')}"
                )
            return msg['result']

    def shutdown(self) -> None:
        """Arrêt propre du worker : sentinel de sortie puis kill si besoin."""
        with self.lock:
            proc, conn = self._proc, self._conn
            if proc is not None and proc.is_alive() and conn is not None:
                try:
                    conn.send(None)
                    proc.join(5)
                except Exception:
                    pass
            self._kill_locked()


class WorkerPool:
    """Pool de workers persistants, un par plugin heavy_cpu."""

    def __init__(self, idle_ttl: float = WORKER_IDLE_TTL):
        self.idle_ttl = idle_ttl
        self._workers: Dict[str, _WorkerProcess] = {}
        self._lock = threading.Lock()

    def execute(
        self,
        plugin_path: str,
        entry_point: str,
        plugin_name: str,
        inputs: Dict[str, Any],
        timeout: Optional[float] = None,
        needs_network: bool = False,
    ) -> Dict[str, Any]:
        """Exécute le plugin dans son worker persistant (spawn lazy au 1er appel)."""
        with self._lock:
            worker = self._workers.get(plugin_name)
            if worker is None:
                worker = _WorkerProcess(
                    plugin_path, entry_point, plugin_name, self.idle_ttl,
                    needs_network=needs_network,
                )
                self._workers[plugin_name] = worker
        return worker.execute(inputs, timeout, needs_network=needs_network)

    def shutdown(self, plugin_name: str) -> None:
        """Arrête le worker d'un plugin (unload, reload, suppression)."""
        with self._lock:
            worker = self._workers.pop(plugin_name, None)
        if worker is not None:
            worker.shutdown()

    def shutdown_all(self) -> None:
        """Arrête tous les workers (fin du backend)."""
        with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for worker in workers:
            worker.shutdown()


_worker_pool = WorkerPool()


def get_worker_pool() -> WorkerPool:
    """Pool partagé des workers heavy_cpu."""
    return _worker_pool


atexit.register(_worker_pool.shutdown_all)
