"""Compatibility shim for QUANTAXIS' optional ``zenlog`` dependency."""

from __future__ import annotations

import logging


class Log:
    """Small drop-in logger object compatible with ``from zenlog import log``."""

    def __init__(self, name: str = "pythonConfig", level: int = logging.INFO) -> None:
        self._logger = logging.getLogger(name)
        self._logger.setLevel(level)

    def critical(self, message, *args, **kwargs):  # noqa: ANN001
        self._logger.critical(message, *args, **kwargs)

    crit = c = fatal = critical

    def error(self, message, *args, **kwargs):  # noqa: ANN001
        self._logger.error(message, *args, **kwargs)

    err = e = error

    def warning(self, message, *args, **kwargs):  # noqa: ANN001
        self._logger.warning(message, *args, **kwargs)

    warn = w = warning

    def info(self, message, *args, **kwargs):  # noqa: ANN001
        self._logger.info(message, *args, **kwargs)

    inf = nfo = i = info

    def debug(self, message, *args, **kwargs):  # noqa: ANN001
        self._logger.debug(message, *args, **kwargs)

    dbg = d = debug

    def level(self, lvl=None):  # noqa: ANN001
        if lvl is None:
            return self._logger.level
        self._logger.setLevel(lvl)
        return self._logger.level


log = Log()

__all__ = ["Log", "log", "logging"]
