## Context

The project already has three relevant pieces:

- The strategy library persists user strategy records and code.
- The shadow trading service owns a virtual wallet, virtual order state, and in-memory matching for market and limit orders.
- The live runtime has scheduling, mandate, halt, and audit patterns for real broker execution, but those semantics are intentionally stricter than paper trading.

The missing piece is a controlled bridge from a saved strategy result to the virtual account. A chat transcript or generated code must not mutate the virtual account directly; it must be converted into a deployment, executed through a stable signal contract, checked by paper risk limits, and then adapted to the shadow trading order API.

## Goals / Non-Goals

**Goals:**

- Let a user deploy a saved strategy to the virtual shadow account for simulated execution.
- Preserve provenance from strategy library record to deployment, signal, and order.
- Provide start, pause, resume, inspect, and archive lifecycle controls.
- Keep all paper orders isolated from live broker connectors.
- Store enough signal and order history to explain why a virtual trade happened or why it was rejected.

**Non-Goals:**

- No live broker execution.
- No guarantee that arbitrary generated strategy code is safe to execute without sandboxing.
- No full portfolio optimizer rewrite.
- No replacement of Shadow Account journal extraction or report generation.

## Decisions

### Deployment Record as the Boundary

Create a paper deployment record that references a strategy library item by id and snapshots the executable strategy package at deployment time.

Rationale: strategy library records can be edited after deployment. Snapshotting keeps historical paper trades explainable and reproducible.

Alternative considered: execute directly from the current strategy library row on every tick. This is simpler but makes past simulated trades ambiguous after a strategy edit.

### Stable Signal Contract Before Orders

Strategies produce normalized signal events before any order is placed. A signal includes deployment id, strategy version, symbol, action, confidence or target weight if available, reason, source data timestamp, and raw metadata.

Rationale: signals are easier to test, inspect, and reject than broker-shaped orders. This also lets the UI show "strategy wanted to buy" separately from "paper risk allowed an order".

Alternative considered: have strategies emit shadow orders directly. This couples strategy code to the ledger and makes risk rejection harder to explain.

### Paper Risk Gate Before Shadow Orders

Add a paper-specific risk gate with deployment limits such as max single-order notional, max total exposure, max trades per day, allowed symbols, allowed sides, and minimum cash buffer. The gate returns allow or reject with a reason before the order adapter calls the shadow trading service.

Rationale: even simulated execution should be bounded and explainable. The live mandate system is conceptually useful, but paper trading should not require live consent or broker funding.

Alternative considered: reuse live mandate records. This would blur paper and live semantics and create unnecessary authorization friction.

### Order Adapter Uses Existing Shadow Trading Service

Accepted paper orders are placed through `shadow_trading_service.place_order()` using `AccountType.VIRTUAL`. The adapter never writes wallet balances or order state directly.

Rationale: the virtual ledger already owns reservation, matching, cancellation, account snapshots, and order serialization.

Alternative considered: add a separate paper ledger. This duplicates balance and matching behavior and risks inconsistent reporting.

### Runtime Starts Minimal, Scheduler-Aware

The first runtime can support explicit "run tick now" plus a simple periodic schedule. Market-event triggers can be added later behind the same deployment/tick contract.

Rationale: manual and scheduled ticks validate the contract without forcing a broader trigger engine integration immediately.

Alternative considered: immediately reuse the full live runner. That runner is designed around broker reconciliation and live mandates, which are not required for isolated paper trading.

## Risks / Trade-offs

- Generated strategy code execution is unsafe if run as plain Python. → Restrict v1 to known strategy package formats or run strategy code through the existing hardened execution path before allowing arbitrary Python.
- Shadow trading service is currently in-memory. → Persist deployment and signal history independently, and treat virtual account persistence as a separate concern if not already configured in the target environment.
- Market prices can be stale or unavailable. → Record data timestamp on signals and reject quantity orders when pricing is missing.
- Strategy edits can confuse deployed behavior. → Snapshot strategy package and version at deployment creation.
- Paper results may overstate performance because fills are simplified. → Store execution assumptions and expose them in deployment status.

## Migration Plan

1. Add persistence for paper deployments and paper signal/order links.
2. Add API endpoints for create, start, pause, resume, archive, run tick, and status.
3. Implement the strategy package loader and signal contract for supported strategy formats.
4. Add the paper risk gate and shadow order adapter.
5. Add UI controls from strategy library into paper deployment status and shadow account monitoring.
6. Rollback by leaving strategy library and shadow trading routes unchanged; paper deployments can be archived without affecting virtual wallets.

## Open Questions

- Which strategy formats should be supported first: structured StrategySpec only, Python code, Pine export, or Shadow Account rules?
- Should paper deployment state live in MySQL only, or should there be a file-backed fallback for local development?
- Should scheduled ticks run in the API process initially, or through a separate worker process?
