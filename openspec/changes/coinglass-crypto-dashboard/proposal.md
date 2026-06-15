## Why

The current home page is a product-style trading assistant landing page, while the requested experience is a Coinglass-style crypto market dashboard. The app also lacks a first-class crypto K-line API that can persist candles into Redis and TimescaleDB for reuse by the UI.

## What Changes

- Replace the home page with a dense market dashboard inspired by Coinglass: top metric boxes, secondary market widgets, a K-line chart, and a "Cryptocurrency Data Analysis" table.
- Add API endpoints for top cryptocurrency rows and OHLCV K-line data.
- Fetch mainstream crypto market data through `ccxt` and persist K-line bars to Redis plus TimescaleDB when those services are available.
- Keep storage credentials in backend configuration/env defaults only; do not expose database secrets in frontend code.

## Capabilities

### New Capabilities
- `crypto-market-dashboard`: Home page crypto dashboard, top 13 cryptocurrency table, K-line API, and Redis/TimescaleDB-backed candle caching.

### Modified Capabilities

None.

## Impact

- Frontend: `frontend/src/pages/Home.tsx`, `frontend/src/lib/api.ts`, chart rendering and loading/error states.
- Backend: new crypto market service and API routes under `agent/src` / `agent/api_server.py`.
- Dependencies: Python Redis and PostgreSQL clients for optional persistence.
- Systems: Redis at `127.0.0.1` and TimescaleDB database `venus` on `127.0.0.1`.
