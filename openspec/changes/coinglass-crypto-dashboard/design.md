## Context

The existing home page is a React/Tailwind landing page with static sample market rows. The backend already has FastAPI routes and a `ccxt` dependency, but no Redis or TimescaleDB integration and no crypto dashboard API. The requested dashboard needs live crypto rows, a K-line chart, and persistence into Redis plus TimescaleDB using local service credentials.

## Goals / Non-Goals

**Goals:**
- Provide a Coinglass-inspired, data-dense home page with top metric boxes, secondary widgets, a K-line chart, and a top 13 cryptocurrency table.
- Add backend crypto endpoints for market rows and OHLCV bars.
- Cache K-line responses in Redis and upsert candles into TimescaleDB when available.
- Keep the UI usable when Redis, TimescaleDB, or the exchange call fails by returning deterministic fallback data.

**Non-Goals:**
- Exact visual cloning of Coinglass or scraping Coinglass private APIs.
- Real futures liquidation, funding, or open interest feeds from paid/proprietary providers.
- User-configurable database credentials in the frontend.

## Decisions

- Use `ccxt` with Binance-compatible spot symbols for current tickers and OHLCV. This matches an existing dependency and avoids adding exchange-specific HTTP code.
- Add `agent/src/crypto_market.py` as the service boundary. FastAPI routes stay thin and the service owns symbol lists, normalization, fallback data, Redis reads/writes, TimescaleDB schema, and exchange fetching.
- Persist K-lines opportunistically. Redis stores serialized API payloads under bounded TTL keys for fast dashboard reloads; TimescaleDB stores normalized OHLCV rows with a unique key on `(symbol, timeframe, time)`.
- Use environment-configurable connection values with defaults matching the request: Redis host `127.0.0.1`, TimescaleDB host `127.0.0.1`, database/user `venus`, and password loaded only by the backend process.
- Frontend uses ECharts directly for the dashboard K-line so it can match the compact dashboard layout without taking over the existing reusable research chart component.

## Risks / Trade-offs

- Exchange network calls can fail or be blocked -> return fallback rows/bars and mark the source status in the payload.
- New Python clients may be missing in a partially installed environment -> imports are optional at runtime; storage silently degrades with an error status instead of failing the route.
- Funding, open interest, and liquidation values are approximations without a dedicated derivatives data provider -> label them as dashboard market fields and keep calculations deterministic.
- TimescaleDB extension creation may be unavailable to the configured user -> create a regular PostgreSQL table first and attempt hypertable conversion only when supported.

## Migration Plan

1. Add optional Redis/PostgreSQL client dependencies.
2. Add crypto market service and FastAPI routes.
3. Replace home page with dashboard UI consuming those routes.
4. Validate frontend build and targeted backend tests.
5. Rollback by restoring the previous `Home.tsx` and removing the new routes/service if needed.
