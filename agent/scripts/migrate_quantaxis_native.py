"""Migrate legacy paper/live deployment metadata to QUANTAXIS-native records."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from src.live.paths import live_root
from src.paper_trading.store import _default_db_path
from src.quantaxis_native import MySQLQuantaxisDeploymentStore, migrate_quantaxis_native_metadata
from src.quantaxis_native.migration import MigrationReport, load_live_deployments_from_json, load_paper_deployments_from_sqlite
from src.strategies.store import MySQLStrategyStore


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paper-db", type=Path, default=_default_db_path(), help="Legacy paper SQLite database path")
    parser.add_argument("--live-json", type=Path, default=live_root() / "deployments.json", help="Legacy live deployments JSON path")
    parser.add_argument("--apply", action="store_true", help="Write migrated records; default is dry-run")
    args = parser.parse_args()

    paper_deployments = load_paper_deployments_from_sqlite(args.paper_db)
    live_deployments = load_live_deployments_from_json(args.live_json)
    if not args.apply and not paper_deployments and not live_deployments:
        print(json.dumps({"dry_run": True, **MigrationReport().to_dict()}, ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    report = migrate_quantaxis_native_metadata(
        strategy_store=MySQLStrategyStore(),
        deployment_store=MySQLQuantaxisDeploymentStore(),
        paper_deployments=paper_deployments,
        live_deployments=live_deployments,
        dry_run=not args.apply,
    )
    print(json.dumps({"dry_run": not args.apply, **report.to_dict()}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
