-- Clear crypto dashboard K-line data from TimescaleDB.
--
-- Run examples:
--   psql "$CRYPTO_TIMESCALE_DSN" -f agent/scripts/maintenance/clear_crypto_klines_timescale.sql
--   psql "host=127.0.0.1 port=5432 dbname=venus user=venus password=..." \
--     -v symbol="'BTC/USDT'" \
--     -v timeframe="'1h'" \
--     -f agent/scripts/maintenance/clear_crypto_klines_timescale.sql
--
-- Full reset option:
--   TRUNCATE TABLE crypto_klines;

BEGIN;

-- Default targeted cleanup for dashboard/test wave data.
DELETE FROM crypto_klines
WHERE symbol IN (
  'BTC/USDT',
  'ETH/USDT',
  'BNB/USDT',
  'SOL/USDT',
  'XRP/USDT',
  'DOGE/USDT',
  'ADA/USDT',
  'TRX/USDT',
  'AVAX/USDT',
  'SHIB/USDT',
  'LINK/USDT',
  'TON/USDT',
  'DOT/USDT'
);

-- Optional narrower delete; uncomment and run manually if needed.
-- DELETE FROM crypto_klines
-- WHERE symbol = 'BTC/USDT'
--   AND timeframe IN ('15m', '1h', '4h', '1d');

COMMIT;
