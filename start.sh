#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

mode="${1:-web}"

usage() {
  cat <<'EOF'
Usage: ./start.sh [web|ios|android|native]

Starts:
  - FastAPI backend (uvicorn, reload)
  - Expo app (web by default)
EOF
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env_keys() {
  local file="$1"
  shift
  for key in "$@"; do
    if ! grep -Eqs "^${key}=" "$file"; then
      echo "Missing ${key} in ${file}" >&2
      exit 1
    fi
  done
}

get_env_value() {
  local file="$1"
  local key="$2"
  local raw
  raw="$(grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

dedupe_csv() {
  local csv="$1"
  local -a uniq=()
  local IFS=','
  local -a parts=()
  read -r -a parts <<< "$csv"
  local part
  for part in "${parts[@]:-}"; do
    part="$(trim "$part")"
    [[ -z "$part" ]] && continue
    local found=0
    local existing
    for existing in "${uniq[@]:-}"; do
      [[ -z "$existing" ]] && continue
      if [[ "$existing" == "$part" ]]; then
        found=1
        break
      fi
    done
    [[ $found -eq 0 ]] && uniq+=("$part")
  done
  local out=""
  for part in "${uniq[@]:-}"; do
    [[ -z "$part" ]] && continue
    if [[ -z "$out" ]]; then
      out="$part"
    else
      out="${out},${part}"
    fi
  done
  printf '%s' "$out"
}

parse_url_port() {
  local url="$1"
  if [[ "$url" =~ ^https?://[^/:]+:([0-9]+)($|/) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

case "$mode" in
  -h|--help)
    usage
    exit 0
    ;;
  web|ios|android|native)
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    usage
    exit 1
    ;;
esac

need_cmd uv
need_cmd npm
need_cmd curl
need_cmd lsof

backend_dir="${script_dir}/backend"
mobile_dir="${script_dir}/mobile"

backend_env="${backend_dir}/.env"
mobile_env="${mobile_dir}/.env"

if [[ ! -f "$backend_env" ]]; then
  echo "Missing ${backend_env}. Create it with:" >&2
  echo "  cp \"${backend_dir}/.env.example\" \"${backend_dir}/.env\"" >&2
  exit 1
fi
require_env_keys "$backend_env" SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY

if [[ ! -f "$mobile_env" ]]; then
  echo "Missing ${mobile_env}. Create it with:" >&2
  echo "  cp \"${mobile_dir}/.env.example\" \"${mobile_dir}/.env\"" >&2
  exit 1
fi
require_env_keys "$mobile_env" EXPO_PUBLIC_API_URL

backend_port="$(get_env_value "$backend_env" PORT)"
backend_port="${backend_port:-8000}"
backend_health_url="http://localhost:${backend_port}/health"

supabase_url="$(get_env_value "$backend_env" SUPABASE_URL)"
supabase_anon_key="$(get_env_value "$backend_env" SUPABASE_ANON_KEY)"
supabase_service_role_key="$(get_env_value "$backend_env" SUPABASE_SERVICE_ROLE_KEY)"

if [[ "$supabase_anon_key" == sb_secret_* ]]; then
  echo "SUPABASE_ANON_KEY looks like a secret key (sb_secret_...). Do not use it in the browser." >&2
  echo "Use your publishable/anon key (sb_publishable_...) for SUPABASE_ANON_KEY in ${backend_env}." >&2
  if [[ "$supabase_service_role_key" == sb_publishable_* ]]; then
    echo "It looks like SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are swapped in ${backend_env}." >&2
  fi
  exit 1
fi

if [[ "$supabase_service_role_key" == sb_publishable_* ]]; then
  echo "SUPABASE_SERVICE_ROLE_KEY looks like a publishable key (sb_publishable_...). Use a secret key (sb_secret_...) instead." >&2
  echo "Service role keys must never be exposed to the browser." >&2
  exit 1
fi

api_url="$(get_env_value "$mobile_env" EXPO_PUBLIC_API_URL)"
api_port=""
if [[ -n "$api_url" ]]; then
  if api_port="$(parse_url_port "$api_url")"; then
    if [[ "$api_port" != "$backend_port" ]]; then
      echo "Mismatch between backend PORT (${backend_port}) and EXPO_PUBLIC_API_URL (${api_url})." >&2
      echo "Fix either ${backend_env} (PORT) or ${mobile_env} (EXPO_PUBLIC_API_URL)." >&2
      exit 1
    fi
  else
    echo "EXPO_PUBLIC_API_URL must include an explicit port (ex: http://localhost:${backend_port})." >&2
    exit 1
  fi
fi

frontend_port="$(get_env_value "$mobile_env" EXPO_PACKAGER_PORT)"
frontend_port="$(trim "$frontend_port")"
frontend_port="${frontend_port:-8081}"

if lsof -nP -iTCP:"${backend_port}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend port ${backend_port} is already in use. Stop the process listening on it and retry." >&2
  lsof -nP -iTCP:"${backend_port}" -sTCP:LISTEN >&2 || true
  exit 1
fi

if lsof -nP -iTCP:"${frontend_port}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Expo port ${frontend_port} is already in use. Stop the process listening on it and retry." >&2
  lsof -nP -iTCP:"${frontend_port}" -sTCP:LISTEN >&2 || true
  exit 1
fi

existing_cors="$(get_env_value "$backend_env" CORS_ALLOW_ORIGINS)"
existing_cors="$(trim "$existing_cors")"
cors_allow_origins=""
if [[ "$existing_cors" == "*" ]]; then
  cors_allow_origins="*"
else
  cors_allow_origins="${existing_cors}"
  cors_allow_origins="${cors_allow_origins},http://localhost:${frontend_port},http://127.0.0.1:${frontend_port}"
  cors_allow_origins="${cors_allow_origins},http://localhost:${backend_port},http://127.0.0.1:${backend_port}"
  cors_allow_origins="$(dedupe_csv "$cors_allow_origins")"
fi

cleanup() {
  if [[ -n "${backend_pid:-}" ]]; then
    kill "$backend_pid" >/dev/null 2>&1 || true
  fi
}

on_signal() {
  cleanup
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM

echo "→ Backend: syncing deps"
(cd "$backend_dir" && uv sync)

echo "→ Backend: starting (port ${backend_port})"
pushd "$backend_dir" >/dev/null
CORS_ALLOW_ORIGINS="$cors_allow_origins" uv run uvicorn app.main:app --reload --port "$backend_port" --env-file .env &
backend_pid="$!"
popd >/dev/null

echo "→ Backend: waiting for ${backend_health_url}"
for _ in $(seq 1 40); do
  if curl -sf "$backend_health_url" >/dev/null; then
    echo "✓ Backend ready"
    break
  fi
  if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
    echo "Backend process exited. Check logs above." >&2
    exit 1
  fi
  sleep 0.25
done

if ! curl -sf "$backend_health_url" >/dev/null; then
  echo "Backend did not become ready. Check logs above." >&2
  exit 1
fi

if [[ ! -d "${mobile_dir}/node_modules" ]]; then
  echo "→ Mobile: installing deps"
  (cd "$mobile_dir" && npm install)
fi

echo "→ Mobile: starting (${mode})"
case "$mode" in
  web) (cd "$mobile_dir" && EXPO_PUBLIC_SUPABASE_URL="$supabase_url" EXPO_PUBLIC_SUPABASE_ANON_KEY="$supabase_anon_key" npm run web -- --port "$frontend_port") ;;
  ios) (cd "$mobile_dir" && EXPO_PUBLIC_SUPABASE_URL="$supabase_url" EXPO_PUBLIC_SUPABASE_ANON_KEY="$supabase_anon_key" npm run ios -- --port "$frontend_port") ;;
  android) (cd "$mobile_dir" && EXPO_PUBLIC_SUPABASE_URL="$supabase_url" EXPO_PUBLIC_SUPABASE_ANON_KEY="$supabase_anon_key" npm run android -- --port "$frontend_port") ;;
  native) (cd "$mobile_dir" && EXPO_PUBLIC_SUPABASE_URL="$supabase_url" EXPO_PUBLIC_SUPABASE_ANON_KEY="$supabase_anon_key" npm run start -- --port "$frontend_port") ;;
esac
