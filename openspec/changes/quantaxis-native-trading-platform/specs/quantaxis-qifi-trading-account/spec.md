## ADDED Requirements

### Requirement: Use QIFI as the account model
The system SHALL use QUANTAXIS QIFI accounts as the sole source of truth for
cash, frozen funds, positions, orders, trades, and account snapshots.

#### Scenario: Account snapshot
- **WHEN** a user requests a deployment account
- **THEN** the API returns a QIFI-derived snapshot with account, positions,
  orders, trades, and valuation fields

#### Scenario: Account mutation
- **WHEN** an approved shadow or live order is executed
- **THEN** account changes are committed through QIFI and emitted as durable
  account/order/trade events

### Requirement: No local production trading storage
The system SHALL NOT use process memory, browser storage, SQLite, or JSON files
as the production source of truth for trading accounts or orders.

#### Scenario: Local store unavailable
- **WHEN** the configured QUANTAXIS durable store is unavailable
- **THEN** trading commands fail closed and no account mutation is attempted

### Requirement: Preserve event history
The system SHALL retain order and trade event history sufficient to reconstruct
the QIFI account and explain each strategy decision.

#### Scenario: Rebuild account
- **WHEN** a QIFI runtime account is rehydrated
- **THEN** it can be rebuilt from the persisted account snapshot and ordered
  event sequence
