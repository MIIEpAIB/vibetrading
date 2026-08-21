"""Minimal transaction helpers for the local ``pyfolio`` shim."""

from __future__ import annotations

import pandas as pd


def make_transaction_frame(transactions):
    return pd.DataFrame(transactions)


def get_turnover(transactions, positions=None, denominator="AGB"):
    return 0.0

