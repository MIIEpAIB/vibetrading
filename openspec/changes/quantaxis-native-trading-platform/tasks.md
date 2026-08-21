## 1. QUANTAXIS Runtime Spike

- [x] 1.1 Pin the supported QUANTAXIS version and document the verified APIs for QAMarket, QIFI, QAEngine, QAPubSub, QAUtil, and QAStrategy.
- [x] 1.2 Add integration fixtures for a QAMarket event, QAStrategy intent, QIFI account mutation, QAEngine task, and QAPubSub event.
- [x] 1.3 Define the application-owned adapter boundary for QUANTAXIS without duplicating account, order, matching, or scheduling logic.

## 2. Unified Persistence and Domain

- [x] 2.1 Add immutable strategy version hashes and parameter schemas.
- [x] 2.2 Add MySQL deployment, promotion, permission, runtime lease, and recovery metadata.
- [x] 2.3 Add QUANTAXIS durable-store configuration and QIFI account/order/trade event projections.
- [x] 2.4 Implement idempotency keys and event sequence constraints for ticks, intents, orders, and trades.
- [x] 2.5 Add one-time migration for existing strategy versions and eligible paper/live deployment metadata.

## 3. QUANTAXIS Strategy and Execution

- [x] 3.1 Replace the internal QIFI implementation with the verified QUANTAXIS QIFI adapter.
- [x] 3.2 Replace custom shadow wallet, matching, and settlement with QAMarket/QIFI execution.
- [x] 3.3 Convert deployable strategy code to the QAStrategy contract with a restricted runtime boundary.
- [x] 3.4 Implement the shared strategy tick pipeline and target-specific shadow/live execution adapters.
- [x] 3.5 Route live orders through the existing mandate, kill-switch, and broker connector gate.

## 4. QAEngine, QAPubSub, and Recovery

- [x] 4.1 Register shadow/live deployment tasks with QAEngine.
- [x] 4.2 Publish market, signal, account, order, trade, deployment, and recovery events through QAPubSub.
- [x] 4.3 Implement worker leases, event offsets, duplicate-event protection, and graceful task cancellation.
- [x] 4.4 Implement startup recovery for deployments, QIFI accounts, open orders, and scheduler state.
- [x] 4.5 Implement live broker reconciliation before a recovered live deployment can resume.

## 5. Unified API

- [x] 5.1 Add deployment-centric create/list/detail/lifecycle APIs.
- [x] 5.2 Add QIFI account snapshot, order, trade, signal, and event APIs.
- [x] 5.3 Add shadow-to-live promotion and prerequisite validation APIs.
- [x] 5.4 Add SSE/WebSocket event gateway backed by QAPubSub.
- [x] 5.5 Remove old paper/shadow deployment routes and compatibility fields.

## 6. Frontend Workflow

- [x] 6.1 Add immutable strategy-version and parameter-schema controls to the strategy library.
- [x] 6.2 Add deployment wizard from strategies to shadow or live.
- [x] 6.3 Add shared deployment detail view with QIFI account, positions, orders, trades, signals, risk, and runtime events.
- [x] 6.4 Add shadow promotion flow with live broker, mandate, consent, and reconciliation states.
- [x] 6.5 Add real-time event subscription, reconnect, loading, empty, failure, and recovery-required states.
- [x] 6.6 Remove localStorage/import drafts and old `?paper`/`?strategy` deployment navigation.

## 7. Removal, Migration, and Verification

- [x] 7.1 Remove SQLite paper storage, in-memory production shadow state, live JSON deployment storage, and internal QIFI production code.
- [x] 7.2 Remove broker-paper compatibility mode and hardcoded market/risk defaults.
- [x] 7.3 Add backend tests for QUANTAXIS adapters, persistence, idempotency, recovery, promotion, and live safety.
- [x] 7.4 Add frontend tests for wizard, shared deployment view, event reconnect, promotion, and recovery-required states.
- [x] 7.5 Run backend, frontend, migration, and restart verification suites.
