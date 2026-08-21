"""Minimal utility helpers for the local ``pyfolio`` shim."""

from __future__ import annotations

import empyrical.utils

from .timeseries import DAILY

APPROX_BDAYS_PER_MONTH = 21
APPROX_BDAYS_PER_YEAR = 252

default_returns_func = empyrical.utils.default_returns_func

