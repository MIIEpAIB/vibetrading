"""Prepare vn.py CTA backtest artifacts for exported strategies."""

from __future__ import annotations

import ast
import json
import shutil
from pathlib import Path
from typing import Any

from src.agent.tools import BaseTool
from src.integrations.vnpy_bridge import (
    build_backtest_plan,
    check_vnpy_availability,
    render_cta_backtest_script,
)
from src.tools.path_utils import safe_run_dir


class PrepareVnpyBacktestTool(BaseTool):
    """Generate a vn.py CTA Backtester runner from a Vibe-Trading run."""

    name = "prepare_vnpy_backtest"
    description = (
        "Prepare vn.py CTA Backtester artifacts from a run_dir and an exported "
        "CtaTemplate strategy. This does not execute vn.py or place orders."
    )
    parameters = {
        "type": "object",
        "properties": {
            "run_dir": {"type": "string", "description": "Vibe-Trading run directory"},
            "strategy_file": {
                "type": "string",
                "description": "Optional strategy file path relative to run_dir or absolute under run_dir",
            },
            "strategy_class": {
                "type": "string",
                "description": "Optional exported CtaTemplate class name; inferred when omitted",
            },
        },
        "required": ["run_dir"],
    }
    repeatable = True
    is_readonly = False

    def execute(self, **kwargs: Any) -> str:
        try:
            run_path = safe_run_dir(str(kwargs["run_dir"]))
            config_path = run_path / "config.json"
            if not config_path.exists():
                return _error("config.json not found")

            config = json.loads(config_path.read_text(encoding="utf-8"))
            strategy_file = _resolve_strategy_file(run_path, kwargs.get("strategy_file"))
            if strategy_file is None:
                return _error("No exported vn.py strategy found under artifacts/vnpy_strategy")

            strategy_class = str(kwargs.get("strategy_class") or "").strip()
            if not strategy_class:
                strategy_class = _infer_strategy_class(strategy_file)
            if not strategy_class:
                return _error(f"No Strategy class found in {strategy_file.name}")

            plan = build_backtest_plan(config)
            out_dir = run_path / "artifacts" / "vnpy_strategy"
            out_dir.mkdir(parents=True, exist_ok=True)
            if strategy_file.parent.resolve() != out_dir.resolve():
                copied_strategy = out_dir / strategy_file.name
                shutil.copy2(strategy_file, copied_strategy)
                strategy_file = copied_strategy

            runner_path = out_dir / "run_vnpy_backtest.py"
            runner_path.write_text(
                render_cta_backtest_script(
                    plan=plan,
                    strategy_file=strategy_file,
                    strategy_class=strategy_class,
                ),
                encoding="utf-8",
            )

            availability = check_vnpy_availability()
            manifest = {
                "status": "ok",
                "backend": "vnpy_cta",
                "runner": str(runner_path),
                "strategy_file": str(strategy_file),
                "strategy_class": strategy_class,
                "plan": plan.to_dict(),
                "vnpy": availability.to_dict(),
                "note": (
                    "vn.py is optional; install vn.py in the target environment before "
                    "running run_vnpy_backtest.py"
                ),
            }
            manifest_path = out_dir / "vnpy_bridge.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            manifest["manifest"] = str(manifest_path)
            return json.dumps(manifest, ensure_ascii=False)
        except Exception as exc:
            return _error(str(exc))


def _resolve_strategy_file(run_path: Path, supplied: Any) -> Path | None:
    if supplied:
        candidate = Path(str(supplied)).expanduser()
        resolved = candidate.resolve() if candidate.is_absolute() else (run_path / candidate).resolve()
        if not resolved.is_relative_to(run_path.resolve()):
            raise ValueError("strategy_file must stay inside run_dir")
        if not resolved.exists():
            raise ValueError(f"strategy_file not found: {supplied}")
        return resolved

    strategy_dir = run_path / "artifacts" / "vnpy_strategy"
    if not strategy_dir.exists():
        return None
    candidates = sorted(
        path for path in strategy_dir.glob("*Strategy.py")
        if path.name != "run_vnpy_backtest.py"
    )
    return candidates[0] if candidates else None


def _infer_strategy_class(strategy_file: Path) -> str:
    tree = ast.parse(strategy_file.read_text(encoding="utf-8"), filename=str(strategy_file))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name.endswith("Strategy"):
            return node.name
    return ""


def _error(message: str) -> str:
    return json.dumps({"status": "error", "error": message}, ensure_ascii=False)
