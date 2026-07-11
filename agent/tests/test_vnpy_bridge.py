"""Tests for the optional vn.py bridge."""

from __future__ import annotations

import json
from pathlib import Path

from src.integrations.vnpy_bridge import (
    build_backtest_plan,
    interval_to_vnpy,
    normalize_vt_symbol,
    render_cta_backtest_script,
)
from src.tools.vnpy_bridge_tool import PrepareVnpyBacktestTool


def test_normalize_vt_symbol_crypto_defaults_to_okx_for_okx_source() -> None:
    assert normalize_vt_symbol("BTC-USDT", source="okx") == "BTC/USDT.OKX"
    assert normalize_vt_symbol("ETH/USDT", source="ccxt") == "ETH/USDT.BINANCE"


def test_normalize_vt_symbol_a_share_suffixes() -> None:
    assert normalize_vt_symbol("000001.SZ") == "000001.SZSE"
    assert normalize_vt_symbol("600000.SH") == "600000.SSE"
    assert normalize_vt_symbol("000001") == "000001.SZSE"


def test_interval_to_vnpy_preserves_window_metadata() -> None:
    assert interval_to_vnpy("1m") == ("MINUTE", 1)
    assert interval_to_vnpy("15m") == ("MINUTE", 15)
    assert interval_to_vnpy("4H") == ("HOUR", 4)
    assert interval_to_vnpy("1D") == ("DAILY", 1)


def test_build_backtest_plan_from_crypto_config() -> None:
    plan = build_backtest_plan(
        {
            "source": "okx",
            "codes": ["BTC-USDT"],
            "interval": "1H",
            "start_date": "2024-01-01",
            "end_date": "2024-02-01",
            "initial_capital": 10000,
            "slippage": 0.0005,
            "vnpy_setting": {"fast_window": 10, "slow_window": 30},
        }
    )

    assert plan.vt_symbol == "BTC/USDT.OKX"
    assert plan.interval_name == "HOUR"
    assert plan.capital == 10000
    assert plan.setting == {"fast_window": 10, "slow_window": 30}


def test_render_cta_backtest_script_uses_strategy_and_plan(tmp_path: Path) -> None:
    strategy_file = tmp_path / "MaCrossStrategy.py"
    strategy_file.write_text("class MaCrossStrategy: pass\n", encoding="utf-8")
    plan = build_backtest_plan(
        {
            "source": "tushare",
            "codes": ["000001.SZ"],
            "start_date": "2020-01-01",
            "end_date": "2021-01-01",
        }
    )

    script = render_cta_backtest_script(
        plan=plan,
        strategy_file=strategy_file,
        strategy_class="MaCrossStrategy",
    )

    assert "from MaCrossStrategy import MaCrossStrategy" in script
    assert "vt_symbol='000001.SZSE'" in script
    assert "Interval.DAILY" in script


def test_prepare_vnpy_backtest_tool_generates_artifacts(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_RUN_ROOTS", str(tmp_path))
    run_dir = tmp_path / "run-1"
    strategy_dir = run_dir / "artifacts" / "vnpy_strategy"
    strategy_dir.mkdir(parents=True)
    (run_dir / "config.json").write_text(
        json.dumps(
            {
                "source": "okx",
                "codes": ["BTC-USDT"],
                "interval": "1H",
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
            }
        ),
        encoding="utf-8",
    )
    (strategy_dir / "MaCrossStrategy.py").write_text(
        "class MaCrossStrategy:\n    pass\n",
        encoding="utf-8",
    )

    body = json.loads(PrepareVnpyBacktestTool().execute(run_dir=str(run_dir)))

    assert body["status"] == "ok"
    assert body["plan"]["vt_symbol"] == "BTC/USDT.OKX"
    assert Path(body["runner"]).exists()
    assert Path(body["manifest"]).exists()

