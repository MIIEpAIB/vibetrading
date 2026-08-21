"""Safe QUANTAXIS module loading.

QUANTAXIS 2.1 imports web-server and manager modules from its top-level
``__init__``. Some of those modules connect to MongoDB at import time. The
application loads the target subpackages through a namespace package so runtime
workers can use QAMarket/QIFI/QAEngine without triggering unrelated top-level
side effects.
"""

from __future__ import annotations

import importlib
import os
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_QUANTAXIS_PATH = Path(os.getenv("QUANTAXIS_PATH", "/opt/QUANTAXIS")).expanduser()
DEFAULT_RUNTIME_HOME = Path(os.getenv("VIBE_QUANTAXIS_HOME", ".runtime/quantaxis")).expanduser()


class QuantaxisLoadError(RuntimeError):
    """Raised when the configured QUANTAXIS runtime cannot be loaded."""


@dataclass(frozen=True)
class QuantaxisModuleSet:
    """Verified QUANTAXIS classes used by the integration."""

    version: str
    market_preset: Any
    order: Any
    order_queue: Any
    position: Any
    portfolio_positions: Any
    qifi_account: Any
    qa_event: Any
    qa_task: Any
    qa_worker: Any
    strategy_cta_base: Any
    publisher_topic: Any
    subscriber_topic: Any


def quantaxis_root() -> Path:
    raw = Path(os.getenv("QUANTAXIS_PATH", str(DEFAULT_QUANTAXIS_PATH))).expanduser()
    return raw


def quantaxis_runtime_home() -> Path:
    raw = Path(os.getenv("VIBE_QUANTAXIS_HOME", str(DEFAULT_RUNTIME_HOME))).expanduser()
    if not raw.is_absolute():
        raw = Path.cwd() / raw
    return raw


def ensure_quantaxis_namespace() -> Path:
    """Install a lightweight QUANTAXIS namespace package if needed."""
    root = quantaxis_root()
    package_dir = root / "QUANTAXIS"
    if not package_dir.exists():
        raise QuantaxisLoadError(f"QUANTAXIS package directory not found: {package_dir}")
    runtime_home = quantaxis_runtime_home()
    runtime_home.mkdir(parents=True, exist_ok=True)
    os.environ["HOME"] = str(runtime_home)
    os.environ.setdefault("USERPROFILE", str(runtime_home))
    os.environ.setdefault("XDG_CACHE_HOME", str(runtime_home / ".cache"))

    current = sys.modules.get("QUANTAXIS")
    if current is not None and getattr(current, "__path__", None):
        paths = [str(item) for item in current.__path__]
        if str(package_dir) in paths:
            return package_dir

    pkg = types.ModuleType("QUANTAXIS")
    pkg.__path__ = [str(package_dir)]
    pkg.__file__ = str(package_dir / "__init__.py")
    pkg.__version__ = _read_quantaxis_version(package_dir / "__init__.py")
    sys.modules["QUANTAXIS"] = pkg
    return package_dir


def load_quantaxis_modules() -> QuantaxisModuleSet:
    """Load and return the QUANTAXIS primitives used by this integration."""
    package_dir = ensure_quantaxis_namespace()
    try:
        qamarket = importlib.import_module("QUANTAXIS.QAMarket")
        qifi_account_module = importlib.import_module("QUANTAXIS.QIFI.QifiAccount")
        qaengine = importlib.import_module("QUANTAXIS.QAEngine")
        qastrategy = importlib.import_module("QUANTAXIS.QAStrategy")
        producer = importlib.import_module("QUANTAXIS.QAPubSub.producer")
        consumer = importlib.import_module("QUANTAXIS.QAPubSub.consumer")
    except Exception as exc:  # noqa: BLE001
        raise QuantaxisLoadError(str(exc)) from exc

    return QuantaxisModuleSet(
        version=_read_quantaxis_version(package_dir / "__init__.py"),
        market_preset=qamarket.MARKET_PRESET,
        order=qamarket.QA_Order,
        order_queue=qamarket.QA_OrderQueue,
        position=qamarket.QA_Position,
        portfolio_positions=qamarket.QA_PMS,
        qifi_account=qifi_account_module.QIFI_Account,
        qa_event=qaengine.QA_Event,
        qa_task=qaengine.QA_Task,
        qa_worker=qaengine.QA_Worker,
        strategy_cta_base=qastrategy.QAStrategyCtaBase,
        publisher_topic=producer.publisher_topic,
        subscriber_topic=consumer.subscriber_topic,
    )


def runtime_status() -> dict[str, Any]:
    """Return a fail-closed runtime capability snapshot."""
    try:
        modules = load_quantaxis_modules()
        return {
            "available": True,
            "version": modules.version,
            "quantaxis_path": str(quantaxis_root()),
            "runtime_home": str(quantaxis_runtime_home()),
            "modules": {
                "QAMarket": True,
                "QIFI": True,
                "QAEngine": True,
                "QAPubSub": True,
                "QAUtil": True,
                "QAStrategy": True,
            },
            "requires": {
                "mongo": os.getenv("QUANTAXIS_MONGOURI") or os.getenv("MONGOURI") or os.getenv("MONGODB") or "",
                "qifi_password": "configured"
                if (os.getenv("VIBE_QUANTAXIS_QIFI_PASSWORD") or os.getenv("QUANTAXIS_QIFI_PASSWORD"))
                else "",
                "qifi_dbname": os.getenv("VIBE_QUANTAXIS_QIFI_DBNAME") or "mongodb",
                "rabbitmq": os.getenv("QAPUBSUB_HOST") or os.getenv("EVENTMQ_IP") or "",
                "qapubsub_exchange": os.getenv("VIBE_QUANTAXIS_QAPUBSUB_EXCHANGE") or "vibe.quantaxis",
            },
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "version": "",
            "quantaxis_path": str(quantaxis_root()),
            "runtime_home": str(quantaxis_runtime_home()),
            "error": str(exc),
            "modules": {},
            "requires": {},
        }


def _read_quantaxis_version(init_path: Path) -> str:
    try:
        for line in init_path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("__version__"):
                return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        return "unknown"
    return "unknown"
