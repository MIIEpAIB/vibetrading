## ADDED Requirements

### Requirement: Create paper deployment from saved strategy
The system SHALL allow an authenticated user to create a paper deployment from a saved strategy library record, snapshotting the strategy package and deployment configuration at creation time.

#### Scenario: Deployment creation succeeds
- **WHEN** a user creates a paper deployment for a strategy they own with valid paper limits
- **THEN** the system stores a deployment with status `draft`, the source strategy id, a strategy snapshot, and the configured paper limits

#### Scenario: Missing strategy is rejected
- **WHEN** a user creates a paper deployment for a strategy id that does not exist or is not owned by them
- **THEN** the system rejects the request without creating a deployment

#### Scenario: Invalid paper limits are rejected
- **WHEN** a user creates a paper deployment with non-positive notional limits or an empty tradable universe
- **THEN** the system rejects the request and returns the validation reason

### Requirement: Manage paper deployment lifecycle
The system SHALL support lifecycle transitions for paper deployments without mutating the source strategy library record.

#### Scenario: Start deployment
- **WHEN** a user starts a `draft` or `paused` deployment
- **THEN** the system changes the deployment status to `running` and records the transition timestamp

#### Scenario: Pause deployment
- **WHEN** a user pauses a `running` deployment
- **THEN** the system changes the deployment status to `paused` and prevents subsequent scheduled ticks from placing new virtual orders

#### Scenario: Archive deployment
- **WHEN** a user archives a deployment
- **THEN** the system changes the deployment status to `archived` and prevents future ticks or resume operations for that deployment

### Requirement: Execute paper ticks through signal contract
The system SHALL execute each paper deployment tick by producing normalized strategy signals before any virtual order is considered.

#### Scenario: Tick records signal
- **WHEN** a running deployment tick evaluates strategy logic and emits a trade signal
- **THEN** the system records the signal with deployment id, strategy snapshot version, symbol, action, reason, data timestamp, and raw metadata

#### Scenario: Tick with no action
- **WHEN** strategy logic emits no actionable signal during a tick
- **THEN** the system records the tick result as no-action and places no virtual order

#### Scenario: Unsupported strategy package is rejected
- **WHEN** a deployment tick cannot load or execute the strategy snapshot using a supported strategy format
- **THEN** the system records the tick as failed and places no virtual order

### Requirement: Apply paper risk checks before virtual orders
The system SHALL check paper limits before adapting any signal into a virtual order.

#### Scenario: Signal passes risk checks
- **WHEN** a signal is within allowed symbols, side permissions, single-order notional, total exposure, daily trade count, and cash buffer limits
- **THEN** the system allows order adaptation and records the risk decision as `allowed`

#### Scenario: Signal breaches risk checks
- **WHEN** a signal breaches any configured paper limit
- **THEN** the system records the risk decision as `rejected` with the breached limit and places no virtual order

#### Scenario: Missing price rejects quantity order
- **WHEN** a signal requires quantity or notional calculation but no usable market price is available
- **THEN** the system rejects the signal before order placement and records the pricing failure

### Requirement: Route accepted orders to virtual shadow account
The system SHALL route accepted paper orders only through the virtual shadow trading service.

#### Scenario: Accepted market order is placed virtually
- **WHEN** an allowed signal is adapted into a market order
- **THEN** the system calls the shadow trading service with `AccountType.VIRTUAL` and records the returned shadow order id and status

#### Scenario: Shadow order rejection is linked to signal
- **WHEN** the shadow trading service rejects an accepted paper order due to insufficient virtual funds or another virtual ledger rule
- **THEN** the system records the rejection status and links it to the originating signal

#### Scenario: Live broker route is never used
- **WHEN** a paper deployment places an order
- **THEN** the system MUST NOT call live broker connector order tools or live mandate commit paths

### Requirement: Inspect paper deployment status
The system SHALL provide a status view for each paper deployment including lifecycle state, latest tick, recent signals, risk decisions, linked virtual orders, and summary performance fields.

#### Scenario: Status includes recent activity
- **WHEN** a user requests deployment status
- **THEN** the system returns deployment metadata, current status, latest tick outcome, recent signal history, and linked virtual order outcomes

#### Scenario: User isolation is enforced
- **WHEN** a user requests a deployment owned by another user
- **THEN** the system denies access without returning deployment details
