## ADDED Requirements

### Requirement: Create immutable deployment
The system SHALL create a deployment from an owned immutable strategy version,
with a target of `SHADOW` or `LIVE`, an account binding, market configuration,
parameters, and risk policy.

#### Scenario: Shadow deployment is created
- **WHEN** an authenticated user selects an owned strategy version and valid
  shadow account configuration
- **THEN** the system creates a `DRAFT` deployment with a strategy snapshot,
  a dedicated QIFI account cookie, and no live broker capability

#### Scenario: Mutable strategy row is rejected
- **WHEN** a deployment request references a strategy without an immutable
  version
- **THEN** the request is rejected and no runtime task is created

### Requirement: Execute deployments through QUANTAXIS
The system SHALL execute strategy deployments using QAStrategy, QAMarket,
QIFI, QAEngine, QAPubSub, and QAUtil contracts.

#### Scenario: Shadow tick
- **WHEN** QAEngine receives a due shadow market event
- **THEN** QAStrategy evaluates the QAMarket input, the deployment policy
  validates the intent, and the QIFI account receives the resulting order
  and trade events through the shadow execution adapter

#### Scenario: Live tick
- **WHEN** QAEngine receives a due live market event
- **THEN** the same strategy and policy pipeline runs, and only the live
  execution adapter may call the broker mandate-gated connector

#### Scenario: Strategy cannot mutate account directly
- **WHEN** strategy code attempts to access account mutation or broker
  connector APIs
- **THEN** the runtime rejects the strategy package before execution

### Requirement: Manage deployment lifecycle
The system SHALL support `DRAFT`, `READY`, `RUNNING`, `PAUSED`, `STOPPED`,
`RECOVERY_REQUIRED`, and `ARCHIVED` states with validated transitions.

#### Scenario: Pause prevents new work
- **WHEN** a running deployment is paused
- **THEN** QAEngine stops new ticks while existing order state remains durable

#### Scenario: Recovery is required
- **WHEN** startup recovery or live reconciliation cannot prove a consistent
  state
- **THEN** the deployment enters `RECOVERY_REQUIRED` and cannot resume until
  an explicit recovery action succeeds

### Requirement: Promote shadow to live
The system SHALL create a new live deployment from a shadow deployment without
mutating the shadow deployment or copying its account balance and positions.

#### Scenario: Promotion succeeds
- **WHEN** the user owns a valid shadow deployment, binds a live broker
  account, confirms live risk policy, and completes mandate consent
- **THEN** the system creates a separate live deployment with the same
  strategy version and a new live account binding

#### Scenario: Promotion is blocked
- **WHEN** the broker binding, mandate, kill switch, strategy validation, or
  reconciliation prerequisites fail
- **THEN** the system rejects promotion with a specific reason

### Requirement: Persist and recover runtime state
The system SHALL persist deployment commands, market offsets, QIFI account
state, orders, trades, and runtime events with idempotency protection.

#### Scenario: Duplicate market event
- **WHEN** the same deployment receives the same market event more than once
- **THEN** only one strategy tick and one order intent may be committed

#### Scenario: Server restart
- **WHEN** the API or QAEngine worker restarts
- **THEN** active deployments, QIFI accounts, open orders, and event offsets
  are restored without losing committed data or duplicating orders
