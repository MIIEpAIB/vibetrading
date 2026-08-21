## ADDED Requirements

### Requirement: Deploy from strategy library
The strategies page SHALL provide a deployment wizard that starts from an
immutable strategy version and configures target, account, market, timeframe,
parameters, and risk policy.

#### Scenario: Open shadow deployment
- **WHEN** the user completes the shadow wizard
- **THEN** the UI navigates to the deployment detail view and shows live status
  from the created deployment id

### Requirement: Unified deployment detail
The frontend SHALL render shadow and live deployments through shared deployment
and QIFI account components.

#### Scenario: Shadow monitoring
- **WHEN** a shadow deployment is running
- **THEN** the UI shows deployment status, QIFI balances, positions, orders,
  trades, strategy signals, risk decisions, and runtime events

#### Scenario: Live monitoring
- **WHEN** a live deployment is running
- **THEN** the same view additionally shows broker connection, mandate,
  kill-switch, and reconciliation state

### Requirement: Real-time state
The frontend SHALL load durable initial state through API queries and consume
subsequent deployment/account updates from the QAPubSub-backed event gateway.

#### Scenario: Reconnect
- **WHEN** the browser loses its event connection
- **THEN** it reloads the deployment snapshot and resumes from the latest
  server state without browser-local trading state
