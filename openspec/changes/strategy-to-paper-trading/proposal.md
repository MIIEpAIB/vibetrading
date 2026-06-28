## Why

Agent conversations can produce useful strategy ideas, but today there is no controlled path from a validated strategy result into the existing virtual trading account. Users need a deployable paper-trading workflow that preserves strategy provenance, applies risk checks, and routes only normalized orders into the shadow ledger.

## What Changes

- Add a strategy-to-paper deployment capability that turns a saved strategy into a structured paper deployment.
- Introduce a stable strategy execution contract: strategy package, signal output, risk decision, and normalized virtual order.
- Add lifecycle states for paper deployments so users can start, pause, inspect, and archive simulated strategy runs.
- Route accepted paper orders through the existing shadow trading service instead of giving the agent direct access to account mutation.
- Surface paper deployment status, recent signals, order outcomes, and rejection reasons for monitoring.

## Capabilities

### New Capabilities

- `strategy-paper-deployment`: Deploy saved strategy outputs to the virtual shadow trading account through a controlled paper-trading runtime.

### Modified Capabilities

- None.

## Impact

- Backend: strategy library, shadow trading service, runtime scheduling or trigger path, and API routes for deployment control and monitoring.
- Frontend: strategy library and shadow trading views can expose deploy/start/pause/status controls.
- Data: new persisted paper deployment records, signal history, and order-link audit records.
- Safety: paper execution remains isolated from live broker connectors and uses explicit risk limits before placing virtual orders.
