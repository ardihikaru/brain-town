#!/usr/bin/env bash
# Runs the k6 perf scripts against an ALREADY RUNNING local stack (brain-town-e2e) from the k6 Docker image.
# Use `npm run perf:local`: it starts a stack with raised ingest limits, runs this, and always shuts the stack down.
#
# Results (git-ignored): perf/results/{ingest,sse-fanout}-summary.json and api-stats.csv (docker stats, 1 s).
set -uo pipefail

PERF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$PERF_DIR/.." && pwd)"
ENV_FILE_PATH="$E2E_DIR/env/.env.local"
IMAGE="brain-town-e2e-k6:2.3.0-sse0.2.0"
API_CONTAINER="brain-town-e2e-api-1"
RESULTS="$PERF_DIR/results"

env_value() { grep -E "^$1=" "$ENV_FILE_PATH" | tail -n1 | cut -d= -f2-; }

BASE="${BRAIN_TOWN_URL:-$(env_value BRAIN_TOWN_URL)}"
case "$BASE" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo "✖ perf runs against the local stack only (got BRAIN_TOWN_URL=$BASE)" >&2; exit 2 ;;
esac

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "── building $IMAGE (k6 + xk6-sse, once) ──"
  docker build -t "$IMAGE" "$PERF_DIR" || exit 1
fi

rm -rf "$RESULTS" && mkdir -p "$RESULTS" && chmod 777 "$RESULTS"

# Sample the api container's memory and CPU every second while k6 runs.
(
  echo "time,mem_usage,mem_percent,cpu_percent"
  while true; do
    docker stats --no-stream --format "$(date +%T),{{.MemUsage}},{{.MemPerc}},{{.CPUPerc}}" "$API_CONTAINER" 2>/dev/null || break
    sleep 1
  done
) >"$RESULTS/api-stats.csv" &
STATS_PID=$!
trap 'kill $STATS_PID 2>/dev/null' EXIT

k6() {
  local script="$1"
  echo "── k6 run $script ──"
  docker run --rm --network host \
    -v "$PERF_DIR:/scripts:ro" -v "$RESULTS:/results" \
    -e BRAIN_TOWN_URL="$BASE" -e ADMIN_EMAIL="$(env_value ADMIN_EMAIL)" -e ADMIN_PASSWORD="$(env_value ADMIN_PASSWORD)" \
    "$IMAGE" run --quiet --summary-export "/results/${script%.js}-summary.json" "/scripts/$script"
}

status=0
k6 ingest.js || status=1
k6 sse-fanout.js || status=1

kill $STATS_PID 2>/dev/null
wait $STATS_PID 2>/dev/null

oom="$(docker inspect -f '{{.State.OOMKilled}}' "$API_CONTAINER")"
restarts="$(docker inspect -f '{{.RestartCount}}' "$API_CONTAINER")"
peak="$(tail -n +2 "$RESULTS/api-stats.csv" | cut -d, -f2 | cut -d/ -f1 | awk '
  { v=$1+0; if ($1 ~ /GiB/) v*=1024; else if ($1 ~ /KiB|kB/) v/=1024; else if ($1 ~ /[0-9]B$/ && $1 !~ /MiB/) v/=1048576; if (v>m) m=v }
  END { printf "%.1f MiB", m }')"
echo "── api container: peak memory $peak (limit 64 MiB), OOMKilled=$oom, restarts=$restarts ──"
if [[ "$oom" != "false" || "$restarts" != "0" ]]; then
  echo "✖ the api container was OOM-killed or restarted during the run" >&2
  status=1
fi
exit $status
