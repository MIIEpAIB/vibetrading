"""Utility helpers for the local ``empyrical`` compatibility shim."""

from __future__ import annotations

import pandas as pd


def default_returns_func() -> pd.Series:
    return pd.Series(dtype="float64")


__all__ = ["default_returns_func"]
