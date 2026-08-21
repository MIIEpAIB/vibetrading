# QUANTAXIS-native runtime boundary

Supported runtime: QUANTAXIS `2.1.0-alpha2` from `QUANTAXIS_PATH`
(default `/opt/QUANTAXIS`).

The application must not import `QUANTAXIS` top-level in request or worker
code. `src.quantaxis_native.loader` installs a lightweight namespace package
and verifies only the framework contracts used by Vibe-Trading:

- `QAMarket`: `MARKET_PRESET`, `QA_Order`, `QA_OrderQueue`, `QA_Position`,
  `QA_PMS`
- `QIFI`: `QIFI_Account`
- `QAEngine`: `QA_Event`, `QA_Task`, `QA_Worker`
- `QAPubSub`: `publisher_topic`, `subscriber_topic`
- `QAStrategy`: `QAStrategyCtaBase`
- `QAUtil`: used by QUANTAXIS modules for market and runtime normalization

Ownership boundary:

- Vibe-Trading owns users, strategy library rows, immutable strategy snapshots,
  deployment metadata, promotion metadata, permissions, and UI/API commands.
- QUANTAXIS owns market data, QIFI accounts, orders, trades, positions,
  account mutations, runtime tasks, and event distribution.
- MySQL deployment tables are metadata and recovery indexes only; they are not
  an account, order, matching, or settlement source of truth.
- Browser storage, SQLite paper state, JSON live deployment state, and process
  memory are not production trading stores.

Runtime behavior fails closed. If the QUANTAXIS module surface, Mongo/QIFI
service, or QAPubSub runtime is unavailable, trading commands must return an
error instead of fabricating account or order state.
