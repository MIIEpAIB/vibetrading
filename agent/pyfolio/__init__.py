"""Compatibility shim for the optional ``pyfolio`` dependency used by QUANTAXIS."""

from __future__ import annotations

from . import capacity
from . import interesting_periods
from . import perf_attrib
from . import pos
from . import round_trips
from . import timeseries
from . import txn
from . import utils


def show_perf_stats(returns, benchmark_returns=None, live_start_date=None):
    return timeseries.perf_stats(returns, factor_returns=benchmark_returns)


def create_returns_tear_sheet(returns, benchmark_rets=None, live_start_date=None):
    return timeseries.perf_stats(returns, factor_returns=benchmark_rets)


__version__ = "shim"

__all__ = [
    "capacity",
    "create_returns_tear_sheet",
    "interesting_periods",
    "perf_attrib",
    "pos",
    "round_trips",
    "show_perf_stats",
    "timeseries",
    "txn",
    "utils",
]
