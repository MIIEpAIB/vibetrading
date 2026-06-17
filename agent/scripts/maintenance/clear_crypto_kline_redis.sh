#!/usr/bin/env bash
set -euo pipefail

# Clear crypto dashboard K-line cache keys.
#
# Environment:
#   REDIS_CLI         redis-cli executable, default: redis-cli
#   REDIS_HOST        default: CRYPTO_REDIS_HOST or 127.0.0.1
#   REDIS_PORT        default: CRYPTO_REDIS_PORT or 6379
#   REDIS_DB          default: CRYPTO_REDIS_DB or 0
#   REDIS_PASSWORD    default: CRYPTO_REDIS_PASSWORD, optional
#   REDIS_FLUSHALL    set to 1 to run FLUSHALL instead of targeted deletion
#   KLINE_PATTERN     default: crypto:klines:*
#
# Examples:
#   bash agent/scripts/maintenance/clear_crypto_kline_redis.sh
#   KLINE_PATTERN='crypto:klines:BTCUSDT:*' bash agent/scripts/maintenance/clear_crypto_kline_redis.sh
#   bash agent/scripts/maintenance/clear_crypto_kline_redis.sh --flushall
#   set -a; . agent/.env; set +a; REDIS_FLUSHALL=1 bash agent/scripts/maintenance/clear_crypto_kline_redis.sh

redis_cli="${REDIS_CLI:-redis-cli}"
redis_host="${REDIS_HOST:-${CRYPTO_REDIS_HOST:-127.0.0.1}}"
redis_port="${REDIS_PORT:-${CRYPTO_REDIS_PORT:-6379}}"
redis_db="${REDIS_DB:-${CRYPTO_REDIS_DB:-0}}"
redis_password="${REDIS_PASSWORD:-${CRYPTO_REDIS_PASSWORD:-}}"
pattern="${KLINE_PATTERN:-crypto:klines:*}"
flushall="${REDIS_FLUSHALL:-0}"

args=(-h "$redis_host" -p "$redis_port" -n "$redis_db")
if [[ -n "$redis_password" ]]; then
  args+=(-a "$redis_password" --no-auth-warning)
fi

if [[ "${1:-}" == "--flushall" ]]; then
  flushall=1
  shift
fi
if [[ "$#" -gt 0 ]]; then
  printf 'Unknown argument: %s\n' "$1" >&2
  exit 2
fi

ping_output="$("$redis_cli" "${args[@]}" PING 2>&1 || true)"
if [[ "$ping_output" == *"AUTH failed"* || "$ping_output" == *"WRONGPASS"* || "$ping_output" == *"NOAUTH"* ]]; then
  printf 'Redis auth failed with configured password; retrying without auth.\n' >&2
  args=(-h "$redis_host" -p "$redis_port" -n "$redis_db")
  ping_output="$("$redis_cli" "${args[@]}" PING 2>&1 || true)"
fi
if [[ "$ping_output" != *"PONG"* ]]; then
  printf 'Redis is not reachable: %s\n' "$ping_output" >&2
  exit 1
fi

if [[ "$flushall" == "1" || "$flushall" == "true" || "$flushall" == "yes" ]]; then
  "$redis_cli" "${args[@]}" FLUSHALL >/dev/null
  printf 'Redis FLUSHALL completed for %s:%s db %s\n' "$redis_host" "$redis_port" "$redis_db"
  exit 0
fi

deleted=0
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  "$redis_cli" "${args[@]}" DEL "$key" >/dev/null
  deleted=$((deleted + 1))
done < <("$redis_cli" "${args[@]}" --scan --pattern "$pattern")

printf 'Deleted %s Redis key(s) matching %s\n' "$deleted" "$pattern"
