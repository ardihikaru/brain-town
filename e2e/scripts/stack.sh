#!/usr/bin/env bash
# Local Brain Town stack for E2E and perf runs: compose project brain-town-e2e, 127.0.0.1 only.
#
#   scripts/stack.sh up       build + start web, api, ArcadeDB (--profile db) and the feed fixture; wait for health.
#                             Then, when the mfardiansyah.id repo is found (SITE_REPO_DIR, SITE_REF), the site services
#                             (--profile site: real site web + api x3, https front, throwaway databases) and wait for them.
#   scripts/stack.sh down     docker compose down -v --remove-orphans (site profile included), then prove nothing is left
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
SITE_DIR="$STACK_DIR/site"
SITE_ENV_FILE="$SITE_DIR/site.env"
# Compose profiles: the Brain Town stack always; "site" only after enable_site (phase 2 of `up`, and `down`).
PROFILE_ARGS=(--profile db)
enable_site() { PROFILE_ARGS+=(--profile site); }

compose() {
  local args=(-p "$PROJECT" --project-directory "$REPO_DIR" -f "$REPO_DIR/compose.yml" -f "$E2E_DIR/compose.e2e.yml" "${PROFILE_ARGS[@]}")
  if [[ -f "$ENV_FILE_PATH" ]]; then args+=(--env-file "$ENV_FILE_PATH"); fi
  if [[ -f "$SITE_ENV_FILE" ]]; then args+=(--env-file "$SITE_ENV_FILE"); fi
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
  # Second certificate for the mfardiansyah.id https front: the site only sends to https, Brain Town only pulls https.
  openssl req -newkey rsa:2048 -nodes -subj "/CN=brain-town-tls" -keyout "$tls/front.key" -out "$tls/front.csr" 2>/dev/null
  printf 'subjectAltName=DNS:brain-town-tls,DNS:site-pull-tls\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' >"$tls/front.cnf"
  openssl x509 -req -in "$tls/front.csr" -CA "$tls/ca.crt" -CAkey "$tls/ca.key" -CAcreateserial -days 7 \
    -extfile "$tls/front.cnf" -out "$tls/front.crt" 2>/dev/null
  rm -f "$tls/ca.key" "$tls/server.csr" "$tls/ext.cnf" "$tls/front.csr" "$tls/front.cnf" "$tls/ca.srl"
  chmod 644 "$tls/ca.crt" "$tls/server.crt" "$tls/server.key" "$tls/front.crt" "$tls/front.key"
}

# Exports a clean copy of the site repo (read-only use: `git archive`, independent of its working tree) into
# .stack/site/src. SITE_REPO_DIR defaults to the sibling "mfardiansyah.id" of the MAIN checkout (worktrees live under
# .claude/worktrees, so the main checkout is found through the common git dir). Returns 1 (with a warning) when the
# repo or ref is missing: the stack then starts without the site pieces and the site specs skip.
export_site_source() {
  local repo ref common main
  repo="$(env_value SITE_REPO_DIR "")"
  ref="$(env_value SITE_REF main)"
  if [[ -z "$repo" ]]; then
    common="$(git -C "$REPO_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [[ -n "$common" ]]; then main="$(dirname "$common")"; else main="$REPO_DIR"; fi
    repo="$(dirname "$main")/mfardiansyah.id"
  fi
  if [[ ! -d "$repo" ]] || ! git -C "$repo" rev-parse --verify -q "$ref^{commit}" >/dev/null 2>&1; then
    echo "⚠ site repo or ref not found (SITE_REPO_DIR=$repo, SITE_REF=$ref): starting WITHOUT the mfardiansyah.id services; the site specs will skip" >&2
    return 1
  fi
  rm -rf "$SITE_DIR/src" && mkdir -p "$SITE_DIR/src"
  chmod 700 "$SITE_DIR"
  git -C "$repo" archive "$ref" | tar -x -C "$SITE_DIR/src"
  echo "✔ site source  $repo @ $ref ($(git -C "$repo" rev-parse --short "$ref^{commit}"))"
}

# Random site admin password for this stack only; never printed, removed with .stack on `down`.
write_site_env() {
  (
    umask 077
    printf 'SITE_ADMIN_USER=e2e-admin\nSITE_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 12)" >"$SITE_ENV_FILE"
  )
}

wait_site_healthy() {
  local port deadline
  deadline=$((SECONDS + 240))
  for port in 18281 18282 18283 18284; do
    until curl -fs -o /dev/null --max-time 3 "http://127.0.0.1:$port/healthz"; do
      if ((SECONDS > deadline)); then
        echo "✖ site service on :$port did not become healthy in time" >&2
        compose ps >&2 || true
        compose logs --tail=40 site-init site-api tls-front >&2 || true
        return 1
      fi
      sleep 1
    done
    echo "✔ healthy  http://127.0.0.1:$port/healthz"
  done
}

start_site() {
  local base
  base="$(env_value BRAIN_TOWN_URL http://127.0.0.1:18280)"
  write_site_env
  ADMIN_EMAIL="$(env_value ADMIN_EMAIL "")" ADMIN_PASSWORD="$(env_value ADMIN_PASSWORD "")" BRAIN_TOWN_URL="$base" SITE_DIR="$SITE_DIR" \
    node "$E2E_DIR/site-fixture/provision.mjs"
  enable_site
  # --no-recreate: the Brain Town services already run (and hold the integrations just created); only the site starts.
  compose up -d --build --no-recreate
  wait_site_healthy
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
    if export_site_source; then start_site; fi
    ;;
  down)
    enable_site
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
