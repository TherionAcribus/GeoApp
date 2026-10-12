import logging
import os
import sys
from typing import Dict, Union

from loguru import logger


def _format_record(record: Dict) -> str:
    record["extra"]["source"] = record["extra"].get(
        "source",
        f"{record['name']}:{record['function']}:{record['line']}",
    )
    return "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level:<8} | {extra[source]} - {message}\n{exception}"


class InterceptHandler(logging.Handler):
    """Route stdlib logging records through loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: Union[str, int] = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        source = f"{record.name}:{record.funcName}:{record.lineno}"
        logger.bind(source=source).opt(exception=record.exc_info).log(level, record.getMessage())


def configure_logging() -> None:
    log_level = os.environ.get("GEOAPP_LOG_LEVEL", "DEBUG").upper()

    logger.remove()
    logger.add(
        sys.stderr,
        level=log_level,
        format=_format_record,
        enqueue=False,
        backtrace=False,
        diagnose=False,
    )

    logging.basicConfig(handlers=[InterceptHandler()], level=log_level, force=True)

    for logger_name in ("werkzeug", "flask.app", "gc_backend"):
        std_logger = logging.getLogger(logger_name)
        std_logger.handlers.clear()
        std_logger.propagate = True
        std_logger.setLevel(log_level)

    _quiet_hot_path_loggers(log_level)


# Modules de chemin chaud dont les traces DEBUG sont trop bavardes pour le niveau
# par défaut. Le détecteur de coordonnées est appelé par le scorer pour chaque
# candidat d'un bruteforce et trace chacun de ses 18 formats : jusqu'à ~80 lignes
# par appel, qui triplent son temps d'exécution. Ces modules restent donc à INFO,
# sauf demande explicite : GEOAPP_LOG_VERBOSE=coordinates (noms séparés par des
# virgules, dernier segment du nom du module).
_HOT_PATH_LOGGERS = (
    "gc_backend.blueprints.coordinates",
)


def _quiet_hot_path_loggers(log_level: str) -> None:
    verbose = {
        name.strip().lower()
        for name in os.environ.get("GEOAPP_LOG_VERBOSE", "").split(",")
        if name.strip()
    }
    base_level = getattr(logging, log_level, logging.DEBUG)
    if not isinstance(base_level, int):
        base_level = logging.DEBUG

    for logger_name in _HOT_PATH_LOGGERS:
        if logger_name.rsplit(".", 1)[-1] in verbose:
            logging.getLogger(logger_name).setLevel(logging.DEBUG)
        else:
            # Jamais plus bavard que INFO, jamais moins strict que le niveau global.
            logging.getLogger(logger_name).setLevel(max(logging.INFO, base_level))
