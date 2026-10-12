"""Niveau de log des modules de chemin chaud (détecteur de coordonnées).

Les assertions portent sur le niveau configuré (`getEffectiveLevel`) et non sur
`isEnabledFor` : d'autres fichiers de test appellent `logging.disable()`, qui
agit sur tout le processus.
"""

import logging

import pytest

from gc_backend.logging_config import configure_logging

COORDINATES_LOGGER = 'gc_backend.blueprints.coordinates'


@pytest.fixture
def logging_env(monkeypatch):
    """Applique un environnement de log, puis rétablit la configuration d'origine."""
    def apply(**env):
        for name in ('GEOAPP_LOG_LEVEL', 'GEOAPP_LOG_VERBOSE'):
            monkeypatch.delenv(name, raising=False)
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        configure_logging()
        return logging.getLogger(COORDINATES_LOGGER)

    yield apply
    monkeypatch.undo()
    configure_logging()


def test_coordinates_detector_is_quiet_by_default(logging_env):
    """Niveau global DEBUG par défaut, mais le détecteur reste à INFO."""
    coordinates_logger = logging_env()

    assert logging.getLogger('gc_backend').getEffectiveLevel() == logging.DEBUG
    assert coordinates_logger.getEffectiveLevel() == logging.INFO


def test_verbose_env_restores_detector_debug(logging_env):
    coordinates_logger = logging_env(GEOAPP_LOG_VERBOSE=' Coordinates , autre')

    assert coordinates_logger.getEffectiveLevel() == logging.DEBUG


def test_detector_never_looser_than_global_level(logging_env):
    """Un niveau global plus strict que INFO s'applique aussi au détecteur."""
    coordinates_logger = logging_env(GEOAPP_LOG_LEVEL='WARNING')

    assert coordinates_logger.getEffectiveLevel() == logging.WARNING


def test_other_modules_keep_the_global_level(logging_env):
    logging_env()

    assert logging.getLogger('gc_backend.blueprints.plugins').getEffectiveLevel() == logging.DEBUG
