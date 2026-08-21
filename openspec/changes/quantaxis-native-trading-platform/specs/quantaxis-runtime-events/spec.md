## ADDED Requirements

### Requirement: Run through QAEngine
The system SHALL register deployment, recovery, and reconciliation work as
QAEngine tasks rather than executing recurring ticks inside the API process.

#### Scenario: Deployment task is scheduled
- **WHEN** a deployment transitions to `RUNNING`
- **THEN** the orchestrator persists and registers one QAEngine task for that
  deployment, and the API process does not execute the recurring tick

### Requirement: Publish through QAPubSub
The system SHALL publish market, strategy, account, order, trade, deployment,
and recovery events through QAPubSub with stable event ids and sequences.

#### Scenario: Frontend receives an order event
- **WHEN** a QIFI order changes state
- **THEN** the backend event gateway publishes a deployment-scoped event that
  subscribed frontend clients can consume

### Requirement: Recover with leases
The system SHALL use durable worker leases and event offsets to prevent two
workers from executing the same deployment tick concurrently.

#### Scenario: Expired lease
- **WHEN** a worker lease expires during execution
- **THEN** the deployment is recovered through idempotency checks before any
  new order intent is accepted
