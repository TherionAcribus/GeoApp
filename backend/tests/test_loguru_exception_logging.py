"""
Tests du logging d'exceptions avec loguru.

Vérifie que les appels logger.* dans le code loguru utilisent
``logger.opt(exception=e)`` (et non ``exc_info=True``, qui n'existe pas chez
loguru) : la traceback doit être capturée et un message contenant des
accolades ne doit pas faire échouer le logging lui-même.
"""

import tempfile
import shutil
from pathlib import Path

from loguru import logger

from gc_backend.plugins.wrappers import (
    PluginMetadata,
    PluginType,
    PythonPluginWrapper,
)


def test_wrapper_execute_logs_traceback_and_survives_braces():
    """Un plugin dont execute() lève une erreur contenant des accolades doit
    produire un log ERROR avec traceback (record['exception']) sans que
    l'exception ne remonte."""
    temp_dir = tempfile.mkdtemp()
    try:
        plugin_dir = Path(temp_dir)
        (plugin_dir / 'main.py').write_text(
            'class BoomPlugin:\n'
            '    def execute(self, inputs):\n'
            '        raise ValueError("bad {value} here")\n',
            encoding='utf-8',
        )

        wrapper = PythonPluginWrapper(
            PluginMetadata(
                name='boom',
                version='1.0.0',
                plugin_type=PluginType.PYTHON,
                entry_point='main.py',
                path=str(plugin_dir),
                timeout_seconds=0,
            )
        )
        assert wrapper.initialize()

        records = []
        sink_id = logger.add(lambda m: records.append(m.record), level="ERROR")
        try:
            result = wrapper.execute({})
        finally:
            logger.remove(sink_id)

        assert isinstance(result, dict)
        assert result['status'] == 'error'

        assert any(
            record["exception"] is not None
            and record["exception"].type is ValueError
            for record in records
        ), "Aucun record ERROR avec traceback ValueError capturé"
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_no_exc_info_kwarg_with_loguru():
    """Garde-fou statique : aucun fichier utilisant loguru ne doit passer
    exc_info= (paramètre stdlib inexistant chez loguru)."""
    gc_backend_dir = Path(__file__).parent.parent / 'gc_backend'

    offenders = []
    for py_file in gc_backend_dir.rglob('*.py'):
        if py_file.name == 'logging_config.py':
            continue
        text = py_file.read_text(encoding='utf-8')
        if 'from loguru import logger' in text and 'exc_info=' in text:
            offenders.append(str(py_file.relative_to(gc_backend_dir.parent)))

    assert not offenders, (
        "Fichiers loguru utilisant encore exc_info= : "
        + ", ".join(offenders)
    )
