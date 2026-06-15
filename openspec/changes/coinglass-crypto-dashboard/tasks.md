## 1. Backend Data Service

- [x] 1.1 Add optional Redis and TimescaleDB client dependencies to backend dependency files.
- [x] 1.2 Implement a crypto market service for top 13 rows, K-line fetch, fallback data, Redis cache, and TimescaleDB upsert.

## 2. Backend API

- [x] 2.1 Add FastAPI models and routes for `/crypto/markets` and `/crypto/klines`.
- [x] 2.2 Add targeted backend tests for market row count, normalized K-line bars, and storage-degraded fallback behavior.

## 3. Frontend Dashboard

- [x] 3.1 Add frontend API types and methods for crypto market and K-line endpoints.
- [x] 3.2 Replace the home page with a Coinglass-inspired crypto dashboard, K-line chart, and 13-row data table.

## 4. Verification

- [x] 4.1 Run targeted backend tests.
- [x] 4.2 Run frontend build/type checks.
