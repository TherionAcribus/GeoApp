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
