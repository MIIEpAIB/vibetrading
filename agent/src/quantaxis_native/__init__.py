"""QUANTAXIS-native strategy deployment integration.

This package owns only Vibe-Trading orchestration boundaries. Account, order,
position, matching, scheduling, and pub/sub primitives are loaded from
QUANTAXIS modules.
"""

from src.quantaxis_native.models import (
    DeploymentStatus,
    DeploymentTarget,
    QuantaxisDeployment,
    QuantaxisRuntimeStatus,
)
from src.quantaxis_native.adapters import (
    BrokerLiveExecutionAdapter,
    QifiProjectionAdapter,
    QuantaxisAdapterError,
    QuantaxisDurableStoreConfig,
    QuantaxisEngineAdapter,
    QuantaxisPubSubAdapter,
    QuantaxisShadowExecutionAdapter,
)
from src.quantaxis_native.service import QuantaxisDeploymentService, QuantaxisTradingError
from src.quantaxis_native.store import MySQLQuantaxisDeploymentStore
from src.quantaxis_native.migration import migrate_quantaxis_native_metadata
from src.quantaxis_native.strategy_runtime import (
    QuantaxisStrategyRuntimeError,
    RestrictedQAStrategyRuntime,
    StrategyOrderIntent,
)

__all__ = [
    "DeploymentStatus",
    "DeploymentTarget",
    "BrokerLiveExecutionAdapter",
    "MySQLQuantaxisDeploymentStore",
    "QifiProjectionAdapter",
    "QuantaxisAdapterError",
    "QuantaxisDurableStoreConfig",
    "QuantaxisDeployment",
    "QuantaxisDeploymentService",
    "QuantaxisEngineAdapter",
    "QuantaxisPubSubAdapter",
    "QuantaxisRuntimeStatus",
    "QuantaxisShadowExecutionAdapter",
    "QuantaxisStrategyRuntimeError",
    "QuantaxisTradingError",
    "RestrictedQAStrategyRuntime",
    "StrategyOrderIntent",
    "migrate_quantaxis_native_metadata",
]
