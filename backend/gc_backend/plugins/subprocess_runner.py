"""
Exécution isolée des plugins ``heavy_cpu`` dans un processus enfant.

Motivation : l'exécution in-process repose sur un thread daemon dont le
timeout ne fait que rendre la main à l'appelant — un plugin bloqué en
boucle CPU continue de consommer un cœur. Le sous-processus offre un vrai
kill (``terminate``/``kill``) et isole l'interpréteur du backend (imports
lourds type torch/z3, crashs natifs éventuels).

Limites assumées :
- pas de ``plugin_manager`` injecté dans l'enfant : un plugin heavy_cpu
  ne peut pas appeler ``execute_plugin`` (pas d'orchestration imbriquée) ;
- le contexte Flask de l'enfant est minimal (``db.session`` + config) :
  les blueprints/services du backend ne sont pas démarrés ;
- inputs et résultat doivent être sérialisables par pickle (les payloads
  JSON des plugins le sont) ;
- chaque exécution paie le coût d'un interpréteur Python neuf (contexte
  ``spawn``, obligatoire sous Windows).
"""

import multiprocessing as mp
import os
import queue as queue_mod
import time
import traceback
from typing import Any, Dict, Optional

from loguru import logger


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
            # heavy_cpu=False exprès : l'enfant charge et exécute le
            # plugin localement, sans récursion de sous-processus.
        )
        wrapper = PythonPluginWrapper(metadata, plugin_manager=None)
        app_ctx = _push_minimal_app_context(name)
        try:
            app_ctx.push()
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
        args=(plugin_path, entry_point, plugin_name, inputs, result_queue),
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
