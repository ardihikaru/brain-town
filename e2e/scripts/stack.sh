#!/usr/bin/env bash
# Local Brain Town stack for E2E and perf runs: compose project brain-town-e2e, 127.0.0.1 only.
#
#   scripts/stack.sh up       build + start web, api, ArcadeDB (--profile db) and the feed fixture; wait for health
#   scripts/stack.sh down     docker compose down -v --remove-orphans, then prove nothing is left
#   scripts/stack.sh status   list the project's containers and volumes
#
# Rule (.claude/rules/e2e-automation.md): after ANY local E2E or perf run, the stack is shut down with `down`.
# `npm run test:local` / `perf:local` / `check:all` do that for you, also on failure or Ctrl-C.
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$E2E_DIR/.." && pwd)"
PROJECT=brain-town-e2e
ENV_FILE_PATH="$E2E_DIR/env/.env.local"
STACK_DIR="$E2E_DIR/.stack"

compose() {
  local args=(-p "$PROJECT" --project-directory "$REPO_DIR" -f "$REPO_DIR/compose.yml" -f "$E2E_DIR/compose.e2e.yml" --profile db)
  if [[ -f "$ENV_FILE_PATH" ]]; then args+=(--env-file "$ENV_FILE_PATH"); fi
  docker compose "${args[@]}" "$@"
}

# Reads one KEY=value from the env file without sourcing it (values are never printed).
env_value() {
  local key="$1" def="$2" v
  v="${!key:-}"
  if [[ -z "$v" && -f "$ENV_FILE_PATH" ]]; then v="$(grep -E "^${key}=" "$ENV_FILE_PATH" | tail -n1 | cut -d= -f2- || true)"; fi
  printf '%s' "${v:-$def}"
}

make_tls() {
  local tls="$STACK_DIR/tls"
  rm -rf "$tls" && mkdir -p "$tls"
  # Throwaway CA + server certificate for the feed fixture (hostname feed-fixture). Regenerated on every `up`.
  openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=Brain Town E2E throwaway CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout "$tls/ca.key" -out "$tls/ca.crt" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=feed-fixture" -keyout "$tls/server.key" -out "$tls/server.csr" 2>/dev/null
  printf 'subjectAltName=DNS:feed-fixture\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' >"$tls/ext.cnf"
  openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.crt" -CAkey "$tls/ca.key" -CAcreateserial -days 7 \
    -extfile "$tls/ext.cnf" -out "$tls/server.crt" 2>/dev/null
  rm -f "$tls/ca.key" "$tls/server.csr" "$tls/ext.cnf" "$tls/ca.srl"
  chmod 644 "$tls/ca.crt" "$tls/server.crt" "$tls/server.key"
}

wait_healthy() {
  local base url deadline
  base="$(env_value BRAIN_TOWN_URL http://127.0.0.1:18280)"
  deadline=$((SECONDS + 180))
  for url in "$base/healthz" "$base/api/healthz"; do
    until curl -fs -o /dev/null --max-time 3 "$url"; do
      if ((SECONDS > deadline)); then
        echo "✖ $url did not become healthy in time" >&2
        compose ps >&2 || true
        compose logs --tail=40 api >&2 || true
        return 1
      fi
      sleep 1
    done
    echo "✔ healthy  $url"
  done
}

verify_down() {
  local left
  left="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}')"
  left+="$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}')"
  left+="$(docker network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}')"
  if [[ -n "$left" ]]; then
    echo "✖ $PROJECT still has resources:" >&2
    echo "$left" >&2
    return 1
  fi
  echo "✔ $PROJECT is fully down (no containers, volumes or networks left)"
}

cmd="${1:-}"
case "$cmd" in
  up)
    if [[ ! -f "$ENV_FILE_PATH" ]]; then node "$E2E_DIR/scripts/init-env.mjs"; fi
    mkdir -p "$STACK_DIR/feed"
    chmod 755 "$STACK_DIR" "$STACK_DIR/feed"
    : >"$STACK_DIR/web.env"
    make_tls
    compose up -d --build --remove-orphans
    wait_healthy
    ;;
  down)
    compose down -v --remove-orphans --timeout 10
    rm -rf "$STACK_DIR"
    verify_down
    ;;
  status)
    docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format 'table {{.Names}}\t{{.Status}}'
    docker volume ls --filter "label=com.docker.compose.project=$PROJECT"
    ;;
  *)
    echo "usage: $0 up|down|status" >&2
    exit 2
    ;;
esac
