"""Compatibility shim for QUANTAXIS' optional ``empyrical`` dependency."""

from __future__ import annotations

from math import sqrt
from typing import Iterable

import numpy as np
import pandas as pd


def _as_series(values) -> pd.Series:
    return pd.Series(values, dtype="float64")


def cum_returns(returns, starting_value: float = 0.0):
    series = _as_series(returns).fillna(0.0)
    if series.empty:
        return series
    cumulative = (1.0 + series).cumprod()
    if starting_value == 0.0:
        return cumulative - 1.0
    return starting_value * cumulative


def cum_returns_final(returns, starting_value: float = 0.0) -> float:
    series = _as_series(returns).fillna(0.0)
    if series.empty:
        return 0.0
    cumulative = (1.0 + series).prod()
    if starting_value == 0.0:
        return float(cumulative - 1.0)
    return float(starting_value * cumulative)


def annual_return(returns, annualization: int = 252) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    total = (1.0 + series).prod()
    periods = len(series)
    return float(total ** (annualization / periods) - 1.0)


def _period_factor(period: str | None) -> int:
    if period in (None, "daily"):
        return 252
    if period == "weekly":
        return 52
    if period == "monthly":
        return 12
    if period == "yearly":
        return 1
    return 252


def annual_volatility(returns, period: str | None = None, annualization: int | None = None) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    factor = annualization or _period_factor(period)
    return float(series.std(ddof=1) * sqrt(factor))


def sharpe_ratio(returns, risk_free: float = 0.0, period: str | None = None, annualization: int | None = None) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    factor = annualization or _period_factor(period)
    excess = series - (risk_free / factor)
    volatility = excess.std(ddof=1)
    if not volatility or np.isnan(volatility):
        return 0.0
    return float(excess.mean() / volatility * sqrt(factor))


def sortino_ratio(returns, required_return: float = 0.0, period: str | None = None, annualization: int | None = None) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    factor = annualization or _period_factor(period)
    downside = series[series < required_return / factor]
    downside_std = downside.std(ddof=1)
    if not downside_std or np.isnan(downside_std):
        return 0.0
    excess = series.mean() - (required_return / factor)
    return float(excess / downside_std * sqrt(factor))


def max_drawdown(returns) -> float:
    series = _as_series(returns).fillna(0.0)
    if series.empty:
        return 0.0
    cumulative = (1.0 + series).cumprod()
    peak = cumulative.cummax()
    drawdown = cumulative / peak - 1.0
    return float(drawdown.min())


def calmar_ratio(returns, period: str | None = None) -> float:
    drawdown = abs(max_drawdown(returns))
    if not drawdown:
        return 0.0
    return float(annual_return(returns, annualization=_period_factor(period)) / drawdown)


def stability_of_timeseries(returns) -> float:
    series = _as_series(returns).dropna()
    if len(series) < 2:
        return 0.0
    cumulative = np.log1p(series).cumsum()
    x = np.arange(len(cumulative), dtype=float)
    slope, intercept = np.polyfit(x, cumulative.to_numpy(dtype=float), 1)
    fitted = slope * x + intercept
    residual = cumulative.to_numpy(dtype=float) - fitted
    total_var = np.var(cumulative.to_numpy(dtype=float))
    if not total_var:
        return 0.0
    return float(1.0 - np.var(residual) / total_var)


def omega_ratio(returns, required_return: float = 0.0) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    excess = series - required_return
    gains = excess[excess > 0].sum()
    losses = -excess[excess < 0].sum()
    if not losses:
        return float("inf") if gains > 0 else 0.0
    return float(gains / losses)


def downside_risk(returns, required_return: float = 0.0, period: str | None = None, annualization: int | None = None) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    factor = annualization or _period_factor(period)
    downside = series[series < required_return / factor]
    if downside.empty:
        return 0.0
    return float(downside.std(ddof=1) * sqrt(factor))


def alpha(returns, factor_returns, risk_free: float = 0.0, period: str | None = None, annualization: int | None = None) -> float:
    alpha_value, _ = alpha_beta(returns, factor_returns, risk_free=risk_free, annualization=annualization or _period_factor(period))
    return alpha_value


def beta(returns, factor_returns, risk_free: float = 0.0, period: str | None = None, annualization: int | None = None) -> float:
    _, beta_value = alpha_beta(returns, factor_returns, risk_free=risk_free, annualization=annualization or _period_factor(period))
    return beta_value


def tail_ratio(returns) -> float:
    series = _as_series(returns).dropna()
    if series.empty:
        return 0.0
    upper = series.quantile(0.95)
    lower = abs(series.quantile(0.05))
    if not lower:
        return float("inf") if upper > 0 else 0.0
    return float(upper / lower)


def alpha_beta(returns, factor_returns, risk_free: float = 0.0, annualization: int = 252):
    returns_s = _as_series(returns).dropna()
    factor_s = _as_series(factor_returns).dropna()
    aligned = pd.concat([returns_s, factor_s], axis=1).dropna()
    if aligned.empty:
        return 0.0, 0.0
    returns_a = aligned.iloc[:, 0] - (risk_free / annualization)
    factor_a = aligned.iloc[:, 1] - (risk_free / annualization)
    variance = factor_a.var(ddof=1)
    if not variance or np.isnan(variance):
        return 0.0, 0.0
    beta = float(returns_a.cov(factor_a) / variance)
    alpha = float((returns_a.mean() - beta * factor_a.mean()) * annualization)
    return alpha, beta


def aggregate_returns(returns, convert_to: str):
    series = _as_series(returns).dropna()
    if series.empty:
        return series
    index = pd.to_datetime(series.index)
    grouped = pd.Series(series.to_numpy(), index=index)
    if convert_to == "weekly":
        return grouped.resample("W").apply(lambda s: (1.0 + s).prod() - 1.0)
    if convert_to == "monthly":
        return grouped.resample("M").apply(lambda s: (1.0 + s).prod() - 1.0)
    if convert_to == "yearly":
        return grouped.resample("Y").apply(lambda s: (1.0 + s).prod() - 1.0)
    return grouped


def perf_attrib(returns, positions, factor_returns, factor_loadings):
    return {
        "common_returns": _as_series(returns),
        "specific_returns": _as_series(returns) * 0.0,
        "total_returns": _as_series(returns),
    }


def compute_exposures(positions, factor_loadings):
    return pd.DataFrame(index=getattr(positions, "index", None))


__all__ = [
    "alpha_beta",
    "annual_return",
    "annual_volatility",
    "aggregate_returns",
    "alpha",
    "alpha_beta",
    "beta",
    "calmar_ratio",
    "compute_exposures",
    "cum_returns",
    "cum_returns_final",
    "downside_risk",
    "max_drawdown",
    "omega_ratio",
    "perf_attrib",
    "stability_of_timeseries",
    "tail_ratio",
    "sharpe_ratio",
    "sortino_ratio",
]
