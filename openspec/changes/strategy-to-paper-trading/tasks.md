## 1. Data Model and Persistence

- [x] 1.1 Define paper deployment, paper limits, signal, risk decision, tick result, and order link data models.
- [x] 1.2 Add persistent storage for paper deployments and signal/order history, scoped by user id.
- [x] 1.3 Implement strategy snapshot creation from a user-owned strategy library record.
- [x] 1.4 Add validation for deployment configuration, including tradable universe and positive paper limits.

## 2. Paper Runtime Core

- [x] 2.1 Implement a supported strategy package loader that rejects unsupported formats without executing orders.
- [x] 2.2 Implement normalized signal generation for the first supported strategy format.
- [x] 2.3 Implement paper lifecycle transitions for draft, running, paused, and archived deployments.
- [x] 2.4 Implement manual tick execution with no-action, failed, rejected, and order-placed outcomes.

## 3. Risk Gate and Order Adapter

- [x] 3.1 Implement paper risk checks for allowed symbols, allowed sides, max single-order notional, max total exposure, max trades per day, and minimum cash buffer.
- [x] 3.2 Implement price resolution for notional or quantity conversion, with fail-closed behavior when pricing is unavailable.
- [x] 3.3 Implement the shadow trading order adapter using only `AccountType.VIRTUAL`.
- [x] 3.4 Link each order placement or rejection back to the originating signal and risk decision.

## 4. API Integration

- [x] 4.1 Add authenticated API endpoints to create and list paper deployments.
- [x] 4.2 Add authenticated API endpoints to start, pause, resume, archive, and manually run a deployment tick.
- [x] 4.3 Add authenticated API endpoint to fetch deployment status with latest tick, recent signals, decisions, and linked virtual orders.
- [x] 4.4 Ensure API access is scoped to the authenticated owner and rejects cross-user deployment access.

## 5. Frontend Integration

- [x] 5.1 Add deploy-to-paper action from the strategy library for eligible strategies.
- [x] 5.2 Add paper deployment status view with lifecycle controls and recent activity.
- [x] 5.3 Link paper deployment order outcomes to the existing shadow trading account view.
- [x] 5.4 Show validation and risk rejection reasons in user-facing UI states.

## 6. Verification

- [x] 6.1 Add unit tests for deployment validation, lifecycle transitions, and user isolation.
- [x] 6.2 Add unit tests for signal recording, risk rejection, missing-price rejection, and shadow order linking.
- [x] 6.3 Add API tests for create, lifecycle, tick, status, and cross-user denial paths.
- [x] 6.4 Add frontend tests for deploy action, status rendering, and rejection reason display.
- [x] 6.5 Run targeted backend and frontend test suites for the new paper deployment workflow.
