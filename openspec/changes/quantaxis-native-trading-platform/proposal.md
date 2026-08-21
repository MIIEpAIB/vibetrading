## Why

Strategies, shadow trading, and live trading currently use separate execution,
account, scheduling, and persistence implementations. This makes a strategy
hard to promote safely, loses in-memory shadow state on restart, and requires
compatibility branches that duplicate QUANTAXIS capabilities. The platform
needs one QUANTAXIS-native trading domain with durable recovery and one
frontend workflow from strategy version to shadow account to live deployment.

## What Changes

- Add a QUANTAXIS-native deployment runtime using `QAStrategy`, `QAMarket`,
  `QIFI`, `QAEngine`, `QAPubSub`, and `QAUtil`.
- Add one deployment model for shadow and live targets with immutable strategy
  snapshots and explicit promotion to a new live deployment.
- Persist deployment metadata in MySQL and QUANTAXIS market/account/order
  state in the configured QUANTAXIS data store; remove production SQLite,
  process-memory, and JSON-file trading state.
- Add durable scheduler leases, event ids, idempotency keys, startup
  recovery, and live broker reconciliation.
- Replace paper/shadow/live-specific APIs with unified deployment, account,
  event, and promotion APIs.
- Update the strategies, shadow-trading, and live-trading pages to use the
  unified deployment workflow and QIFI account projections.
- **BREAKING** Remove `broker_paper`, old paper deployment routes, legacy
  shadow in-memory execution, local paper storage, and the internal QIFI
  implementation after migration.

## Capabilities

### New Capabilities

- `quantaxis-strategy-deployment`: Create, run, pause, recover, and promote
  immutable strategy deployments across shadow and live targets.
- `quantaxis-qifi-trading-account`: Persist and expose QIFI accounts,
  orders, trades, positions, and event history with restart-safe recovery.
- `quantaxis-runtime-events`: Execute deployments through QAEngine and
  distribute market/runtime/account events through QAPubSub.
- `strategy-trading-frontend`: Provide unified strategy deployment,
  shadow-account monitoring, live promotion, and real-time event interaction.

### Modified Capabilities

- `owned-strategy-library`: Strategy records expose deployable immutable
  versions and parameter schemas rather than being executed directly from
  mutable library rows.

## Impact

- Backend: strategy persistence, deployment services, QUANTAXIS adapters,
  QIFI account integration, QAEngine workers, QAPubSub gateway, broker
  adapters, recovery, and API routes.
- Frontend: `StrategyLibrary`, `ShadowTrading`, `LiveTrading`, API types,
  deployment routes, event subscriptions, and account projections.
- Data: MySQL deployment metadata and QUANTAXIS durable market/account/order
  storage; one-time migration from SQLite, memory, and JSON stores.
- Operations: pinned QUANTAXIS runtime dependencies plus MongoDB/QUANTAXIS
  store, MySQL, and the QAEngine/QAPubSub worker processes.
