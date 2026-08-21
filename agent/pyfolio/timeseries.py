"""Minimal timeseries helpers for the local ``pyfolio`` shim."""

from __future__ import annotations

from collections import OrderedDict

import empyrical as ep
import numpy as np
import pandas as pd

DAILY = "daily"


def perf_stats(returns, factor_returns=None, positions=None, transactions=None, turnover_denom="AGB"):
    returns = pd.Series(returns, dtype="float64")
    stats = OrderedDict(
        [
            ("Annual return", ep.annual_return(returns)),
            ("Cumulative returns", ep.cum_returns_final(returns)),
            ("Annual volatility", ep.annual_volatility(returns)),
            ("Sharpe ratio", ep.sharpe_ratio(returns)),
            ("Calmar ratio", ep.calmar_ratio(returns)),
            ("Stability", ep.stability_of_timeseries(returns)),
            ("Max drawdown", ep.max_drawdown(returns)),
            ("Omega ratio", ep.omega_ratio(returns)),
            ("Sortino ratio", ep.sortino_ratio(returns)),
            ("Skew", float(pd.Series(returns).skew() if len(returns) else 0.0)),
            ("Kurtosis", float(pd.Series(returns).kurt() if len(returns) else 0.0)),
            ("Tail ratio", ep.tail_ratio(returns)),
            ("Daily value at risk", float(returns.mean() - 2.0 * returns.std())),
        ]
    )
    return pd.Series(stats)

