## ADDED Requirements

### Requirement: Dashboard Home Layout
The system SHALL render the application home page as a Coinglass-inspired crypto market dashboard with top metric boxes, secondary market widgets, a K-line chart area, and a "Cryptocurrency Data Analysis" section.

#### Scenario: Home page renders dashboard sections
- **WHEN** a user opens `/`
- **THEN** the page displays metric boxes, the `Cryptocurrency Data Analysis` heading, and a market table.

### Requirement: Top Cryptocurrency Table
The system SHALL display exactly 13 mainstream cryptocurrency rows in the dashboard table when market data is available or fallback data is used.

#### Scenario: Top 13 table rows are returned
- **WHEN** the frontend requests dashboard market data
- **THEN** the backend returns 13 rows for mainstream assets including BTC and ETH.

### Requirement: Crypto Market API
The system SHALL expose a backend endpoint that returns crypto dashboard rows, aggregate metrics, and source status without requiring frontend database credentials.

#### Scenario: Market endpoint hides storage credentials
- **WHEN** the frontend requests crypto dashboard market data
- **THEN** the response contains market values and source status, not Redis or TimescaleDB passwords.

### Requirement: Crypto K-line API
The system SHALL expose a backend endpoint that returns normalized OHLCV K-line bars for a requested cryptocurrency symbol and timeframe.

#### Scenario: K-line endpoint returns normalized bars
- **WHEN** the frontend requests K-line data for `BTC/USDT`
- **THEN** the backend returns bars with `time`, `open`, `high`, `low`, `close`, and `volume` fields.

### Requirement: Redis and TimescaleDB Persistence
The system SHALL cache K-line payloads in Redis and upsert normalized K-line bars into TimescaleDB when those services are reachable.

#### Scenario: Storage is available
- **WHEN** K-line data is fetched and Redis plus TimescaleDB are reachable
- **THEN** Redis receives a cached payload and TimescaleDB contains the normalized OHLCV rows.

#### Scenario: Storage is unavailable
- **WHEN** Redis or TimescaleDB is unavailable
- **THEN** the K-line endpoint still returns bars from exchange or fallback data and includes a degraded storage status.

### Requirement: Frontend K-line Integration
The system SHALL render backend K-line data on the dashboard and allow users to switch among supported mainstream symbols without a page reload.

#### Scenario: User selects another symbol
- **WHEN** a user selects a different symbol in the dashboard table
- **THEN** the K-line chart reloads for that symbol and keeps the table visible.
