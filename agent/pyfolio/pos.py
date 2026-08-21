"""Minimal position helpers for the local ``pyfolio`` shim."""

from __future__ import annotations

import pandas as pd


def extract_pos(positions, ending_cash):
    return positions


def get_percent_alloc(positions):
    return pd.Series(dtype="float64")

