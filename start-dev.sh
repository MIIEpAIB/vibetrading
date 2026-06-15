#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${VIBE_DEV_STATE_DIR:-$ROOT/.vibe-dev}"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"

BACKEND_HOST="${VIBE_BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${VIBE_BACKEND_PORT:-8899}"
FRONTEND_HOST="${VIBE_FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${VIBE_FRONTEND_PORT:-8765}"
SETUP_LOG="$LOG_DIR/setup.log"
LOCAL_HOST="${VIBE_LOCAL_HOST:-127.0.0.1}"
PUBLIC_HOST="${VIBE_PUBLIC_HOST:-}"
PROXY_AUTH_FILE="$STATE_DIR/dev-proxy-auth.key"

mkdir -p "$LOG_DIR" "$PID_DIR"

usage() {
  cat <<USAGE
Usage: ./start-dev.sh [command]

Commands:
  up|start          Ensure backend and frontend dev services are running (default)
  status            Show detected service status and URLs
  stop              Stop services started by this script
  restart           Stop services started by this script, then start again
  logs [service]    Tail backend, frontend, or setup logs
  urls              Print local and external dev URLs

Environment:
  VIBE_BACKEND_HOST       Backend bind host (default: 0.0.0.0)
  VIBE_BACKEND_PORT       Backend port (default: 8899)
  VIBE_FRONTEND_HOST      Frontend bind host (default: 0.0.0.0)
  VIBE_FRONTEND_PORT      Frontend port (default: 8765)
  VIBE_LOCAL_HOST         Local host used by health checks (default: 127.0.0.1)
  VIBE_PUBLIC_HOST        Public host/IP shown in external URLs (auto-detected)
  VIBE_DEV_SKIP_INSTALL   Set to 1 to skip dependency installation
  PYTHON                  Python binary to use instead of .venv/python3
USAGE
}

log() {
  printf '[start-dev] %s\n' "$*"
}

die() {
  log "error: $*" >&2
  exit 1
}

validate_port() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || ((value < 1 || value > 65535)); then
    die "$name must be a TCP port number, got '$value'"
  fi
}

validate_port VIBE_BACKEND_PORT "$BACKEND_PORT"
validate_port VIBE_FRONTEND_PORT "$FRONTEND_PORT"

if [[ -n "${PYTHON:-}" ]]; then
  PYTHON_BIN="$PYTHON"
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT/.venv/bin/python"
elif [[ -x "$ROOT/agent/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT/agent/.venv/bin/python"
else
  PYTHON_BIN="python3"
fi

ensure_dev_proxy_auth() {
  if [[ -n "${VIBE_DEV_PROXY_AUTH:-}" ]]; then
    printf '%s' "$VIBE_DEV_PROXY_AUTH"
    return
  fi
  if [[ ! -s "$PROXY_AUTH_FILE" ]]; then
    umask 077
    "$PYTHON_BIN" -c 'import secrets; print(secrets.token_urlsafe(32))' >"$PROXY_AUTH_FILE"
  fi
  tr -d '\r\n' <"$PROXY_AUTH_FILE"
}

pid_file() {
  printf '%s/%s.pid' "$PID_DIR" "$1"
}

log_file() {
  printf '%s/%s.log' "$LOG_DIR" "$1"
}

service_url() {
  case "$1" in
    backend) printf 'http://%s:%s/health' "$LOCAL_HOST" "$BACKEND_PORT" ;;
    frontend) printf 'http://%s:%s' "$LOCAL_HOST" "$FRONTEND_PORT" ;;
    *) return 2 ;;
  esac
}

detect_public_host() {
  if [[ -n "$PUBLIC_HOST" ]]; then
    printf '%s' "$PUBLIC_HOST"
    return
  fi

  if command -v hostname >/dev/null 2>&1; then
    local ip
    for ip in $(hostname -I 2>/dev/null || true); do
      case "$ip" in
        127.*|169.254.*|::1) continue ;;
      esac
      printf '%s' "$ip"
      return
    done
  fi

  printf '<server-ip>'
}

service_port() {
  case "$1" in
    backend) printf '%s' "$BACKEND_PORT" ;;
    frontend) printf '%s' "$FRONTEND_PORT" ;;
    *) return 2 ;;
  esac
}

is_pid_running() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  [[ -f "$file" ]] && kill -0 "$(cat "$file")" 2>/dev/null
}

cleanup_stale_pid() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  if [[ -f "$file" ]] && ! kill -0 "$(cat "$file")" 2>/dev/null; then
    rm -f "$file"
  fi
}

port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v port=":$port" '$4 ~ port "$" { found = 1 } END { exit !found }'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v port=":$port" '$4 ~ port "$" { found = 1 } END { exit !found }'
  else
    return 1
  fi
}

url_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "$url" >/dev/null 2>&1
  else
    "$PYTHON_BIN" - "$url" >/dev/null 2>&1 <<'PY'
import sys
import urllib.request

urllib.request.urlopen(sys.argv[1], timeout=2).read(1)
PY
  fi
}

backend_ok() {
  "$PYTHON_BIN" - "$(service_url backend)" >/dev/null 2>&1 <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(sys.argv[1], timeout=2) as response:
        payload = json.load(response)
except Exception:
    raise SystemExit(1)

if payload.get("status") == "healthy" and payload.get("service") == "Vibe-Trading API":
    raise SystemExit(0)
raise SystemExit(1)
PY
}

service_ready() {
  case "$1" in
    backend) backend_ok ;;
    frontend) url_ok "$(service_url frontend)" ;;
    *) return 2 ;;
  esac
}

service_state() {
  local service="$1"
  local port
  port="$(service_port "$service")"

  cleanup_stale_pid "$service"
  if service_ready "$service"; then
    printf 'ready'
  elif is_pid_running "$service"; then
    printf 'starting'
  elif port_listening "$port"; then
    printf 'blocked'
  else
    printf 'stopped'
  fi
}

run_logged() {
  local label="$1"
  shift
  log "$label..."
  {
    printf '\n=== %s (%s) ===\n' "$label" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  } >>"$SETUP_LOG"
  if "$@" >>"$SETUP_LOG" 2>&1; then
    log "$label done"
  else
    log "$label failed; see $SETUP_LOG"
    return 1
  fi
}

ensure_backend_dependencies() {
  if [[ "${VIBE_DEV_SKIP_INSTALL:-0}" == "1" ]]; then
    log "backend dependency install skipped by VIBE_DEV_SKIP_INSTALL=1"
    return
  fi

  if [[ -z "${PYTHON:-}" && ! -x "$ROOT/.venv/bin/python" ]]; then
    run_logged "creating backend virtualenv" python3 -m venv "$ROOT/.venv"
    PYTHON_BIN="$ROOT/.venv/bin/python"
  fi

  run_logged "installing backend package" "$PYTHON_BIN" -m pip install -e "$ROOT"
}

ensure_frontend_dependencies() {
  if [[ "${VIBE_DEV_SKIP_INSTALL:-0}" == "1" ]]; then
    log "frontend dependency install skipped by VIBE_DEV_SKIP_INSTALL=1"
    return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    die "npm is required to start the frontend"
  fi
  run_logged "installing frontend packages" bash -lc 'cd "$1" && npm install' _ "$ROOT/frontend"
}

ensure_dependencies() {
  ensure_backend_dependencies
  ensure_frontend_dependencies
}

spawn_service() {
  local service="$1"
  shift
  local file
  local log_path
  file="$(pid_file "$service")"
  log_path="$(log_file "$service")"

  cleanup_stale_pid "$service"
  if is_pid_running "$service"; then
    log "$service already has pid $(cat "$file")"
    return
  fi

  printf '\n=== start %s (%s) ===\n' "$service" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$log_path"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >>"$log_path" 2>&1 < /dev/null &
  else
    "$@" >>"$log_path" 2>&1 < /dev/null &
  fi
  printf '%s\n' "$!" >"$file"
  log "$service started pid=$(cat "$file") log=$log_path"
}

start_backend() {
  spawn_service backend env PYTHONPATH="$ROOT/agent" VIBE_DEV_PROXY_AUTH="$(ensure_dev_proxy_auth)" "$PYTHON_BIN" -c \
    'import cli, sys; raise SystemExit(cli.main(sys.argv[1:]))' \
    serve --host "$BACKEND_HOST" --port "$BACKEND_PORT"
}

start_frontend() {
  spawn_service frontend env VIBE_DEV_PROXY_AUTH="$(ensure_dev_proxy_auth)" bash -lc '
    cd "$1"
    export VITE_API_URL="${VITE_API_URL:-http://$5:$4}"
    exec npm run dev -- --host "$2" --port "$3" --strictPort
  ' _ "$ROOT/frontend" "$FRONTEND_HOST" "$FRONTEND_PORT" "$BACKEND_PORT" "$LOCAL_HOST"
}

wait_for_service() {
  local service="$1"
  local attempts="${2:-60}"
  local url
  url="$(service_url "$service")"

  log "waiting for $service at $url"
  for ((i = 1; i <= attempts; i++)); do
    if service_ready "$service"; then
      log "$service ready"
      return 0
    fi
    if [[ "$(service_state "$service")" == "stopped" ]]; then
      log "$service exited early; see $(log_file "$service")"
      return 1
    fi
    sleep 1
  done
  log "$service not ready after ${attempts}s; see $(log_file "$service")"
  return 1
}

ensure_no_blocked_ports() {
  local service
  local state
  for service in backend frontend; do
    state="$(service_state "$service")"
    if [[ "$state" == "blocked" ]]; then
      die "$service port $(service_port "$service") is occupied but $(service_url "$service") is not healthy; refusing to overwrite it"
    fi
  done
}

cmd_up() {
  local backend_state
  local frontend_state
  backend_state="$(service_state backend)"
  frontend_state="$(service_state frontend)"

  if [[ "$backend_state" == "ready" && "$frontend_state" == "ready" ]]; then
    log "backend and frontend are already healthy; reusing existing environment"
    cmd_urls
    return
  fi

  if [[ "$backend_state" == "starting" ]]; then
    wait_for_service backend 20 || true
  fi
  if [[ "$frontend_state" == "starting" ]]; then
    wait_for_service frontend 20 || true
  fi

  backend_state="$(service_state backend)"
  frontend_state="$(service_state frontend)"
  if [[ "$backend_state" == "ready" && "$frontend_state" == "ready" ]]; then
    log "backend and frontend became healthy; reusing existing environment"
    cmd_urls
    return
  fi

  ensure_no_blocked_ports
  ensure_dependencies

  local jobs=()
  if [[ "$(service_state backend)" == "stopped" ]]; then
    start_backend &
    jobs+=("$!")
  else
    log "backend already reachable at $(service_url backend)"
  fi
  if [[ "$(service_state frontend)" == "stopped" ]]; then
    start_frontend &
    jobs+=("$!")
  else
    log "frontend already reachable at $(service_url frontend)"
  fi

  local job
  for job in "${jobs[@]}"; do
    wait "$job"
  done

  wait_for_service backend 60
  wait_for_service frontend 60
  cmd_urls
}

stop_service() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  if [[ ! -f "$file" ]]; then
    log "$service was not started by start-dev.sh"
    return
  fi

  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    log "stopping $service pid=$pid"
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

cmd_stop() {
  stop_service frontend
  stop_service backend
}

cmd_status() {
  local service
  local state
  for service in backend frontend; do
    state="$(service_state "$service")"
    case "$state" in
      ready)
        if is_pid_running "$service"; then
          printf '%-8s ready pid=%s url=%s log=%s\n' "$service" "$(cat "$(pid_file "$service")")" "$(service_url "$service")" "$(log_file "$service")"
        else
          printf '%-8s ready external url=%s\n' "$service" "$(service_url "$service")"
        fi
        ;;
      starting)
        printf '%-8s starting pid=%s url=%s log=%s\n' "$service" "$(cat "$(pid_file "$service")")" "$(service_url "$service")" "$(log_file "$service")"
        ;;
      blocked)
        printf '%-8s blocked port=%s url=%s\n' "$service" "$(service_port "$service")" "$(service_url "$service")"
        ;;
      stopped)
        printf '%-8s stopped url=%s\n' "$service" "$(service_url "$service")"
        ;;
    esac
  done
  cmd_urls
}

cmd_logs() {
  local service="${1:-all}"
  case "$service" in
    backend|frontend)
      touch "$(log_file "$service")"
      tail -f "$(log_file "$service")"
      ;;
    setup)
      touch "$SETUP_LOG"
      tail -f "$SETUP_LOG"
      ;;
    all)
      touch "$(log_file backend)" "$(log_file frontend)" "$SETUP_LOG"
      tail -f "$(log_file backend)" "$(log_file frontend)" "$SETUP_LOG"
      ;;
    *)
      die "unknown log service: $service"
      ;;
  esac
}

cmd_urls() {
  local public_host
  public_host="$(detect_public_host)"
  cat <<URLS
Frontend local:    http://$LOCAL_HOST:$FRONTEND_PORT
Frontend external: http://$public_host:$FRONTEND_PORT (bind: $FRONTEND_HOST)
Agent public:      http://$public_host:$FRONTEND_PORT/agent
Backend local:     http://$LOCAL_HOST:$BACKEND_PORT
URLS
  if [[ "$BACKEND_HOST" == "0.0.0.0" || "$BACKEND_HOST" == "::" ]]; then
    cat <<URLS
Backend external:  http://$public_host:$BACKEND_PORT (bind: $BACKEND_HOST; API key required for non-local clients)
API docs external: http://$public_host:$BACKEND_PORT/docs
URLS
  fi
}

case "${1:-up}" in
  up|start) cmd_up ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  restart)
    cmd_stop
    cmd_up
    ;;
  logs)
    shift || true
    cmd_logs "${1:-all}"
    ;;
  urls) cmd_urls ;;
  -h|--help|help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
