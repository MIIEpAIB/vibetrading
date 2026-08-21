## Context

The current application has a MySQL strategy library, an SQLite paper store,
an in-memory `shadow_trading` ledger, a JSON live deployment store, and an
internal QIFI-like implementation. These are not acceptable production
sources of truth for a restart-safe workflow.

QUANTAXIS becomes the trading-domain kernel. FastAPI remains the product API
and authentication boundary; React remains the product UI. The application
owns user, strategy, deployment, promotion, and permission metadata. The
QUANTAXIS data store owns market data and QIFI trading state.

## Goals

- Use QUANTAXIS-native contracts for strategy, market, account, runtime, and
  event handling.
- Give every deployment an immutable strategy snapshot and a durable QIFI
  account.
- Make shadow and live differ only at the final execution adapter.
- Recover active deployments and pending orders after process restart.
- Make the frontend operate on deployment and account ids, not ad-hoc query
  parameters or local storage.
- Remove legacy production paths rather than maintaining compatibility modes.

## Non-Goals

- Do not replace the existing authentication or strategy marketplace.
- Do not allow an LLM or strategy code to call broker SDKs directly.
- Do not automatically copy shadow positions into live accounts.
- Do not support broker-side paper accounts in this change.
- Do not make MySQL a second source of truth for orders, trades, or positions.

## Architecture

```text
React
  -> FastAPI command/query/event gateway
  -> Deployment Orchestrator
  -> QAEngine worker
  -> QAStrategy + QAMarket + QIFI
  -> QAPubSub
  -> QUANTAXIS durable store
```

The deployment target is `SHADOW` or `LIVE`. A promotion creates a new live
deployment from a shadow snapshot; it never mutates the source deployment.

### Domain Ownership

MySQL stores:

- users and broker bindings;
- strategy library records and immutable strategy versions;
- deployment metadata, parameter values, and risk policy;
- promotion and consent records;
- deployment permissions and audit references.

QUANTAXIS storage stores:

- market bars/ticks;
- QIFI account snapshots;
- orders, order events, trades, positions, and runtime event offsets.

The API exposes read projections assembled from these stores. It does not
reimplement account calculations.

### Runtime Contracts

`QAStrategy` is the only strategy execution contract. A strategy receives
normalized QAMarket data and QIFI account context and emits an order intent.
The runtime validates the intent against deployment policy before creating a
QIFI order.

`QAMarket` supplies market data and target-specific execution behavior.
`QAEngine` owns recurring deployment tasks and recovery tasks.
`QAPubSub` carries market, strategy, account, order, trade, deployment, and
recovery events.
`QAUtil` supplies symbol, timeframe, calendar, and market-rule normalization.

The only target-specific code is:

- `QuantaxisShadowExecutionAdapter`: sends approved intents to QAMarket
  simulation and records QIFI results.
- `BrokerLiveExecutionAdapter`: sends approved intents through the existing
  live mandate/kill-switch gate and maps broker acknowledgements back into
  QIFI events.

### Persistence and Recovery

Every mutating operation has an idempotency key and durable event sequence.
Deployment ticks use `(deployment_id, market_event_id, strategy_version_id)`.
Orders use `(account_cookie, client_order_id)`.

On startup:

1. load active deployments from MySQL;
2. rehydrate QIFI accounts and open orders from the QUANTAXIS store;
3. restore QAEngine jobs and QAPubSub offsets;
4. resume shadow jobs;
5. reconcile live broker state before resuming live jobs;
6. move ambiguous deployments to `RECOVERY_REQUIRED` and stop execution.

### Frontend

Use deployment-centric routes:

- `/deployments`
- `/deployments/:deploymentId`
- `/accounts/:accountCookie`
- `/live-trading/:deploymentId`

The strategy page starts a deployment wizard. Shadow and live pages share
deployment status, QIFI account, orders, trades, signals, and runtime event
components. Live adds broker, mandate, kill-switch, and reconciliation panels.
Initial data comes from query APIs; changes arrive through SSE/WebSocket backed
by QAPubSub. No trading state uses browser local storage.

## Migration and Removal

1. Pin and verify the installed QUANTAXIS API surface in an integration spike.
2. Create MySQL deployment metadata and migration records.
3. Implement QUANTAXIS adapters and QIFI persistence.
4. Migrate existing strategy versions and eligible deployment records.
5. Switch API and frontend to unified routes.
6. Stop writers to SQLite, memory, and JSON stores.
7. Verify restart and reconciliation behavior.
8. Delete legacy stores, routes, models, and compatibility fields.
