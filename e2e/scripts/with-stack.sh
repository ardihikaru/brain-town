#!/usr/bin/env bash
# Runs a command against a fresh local stack and ALWAYS shuts the stack down afterwards
# (normal exit, failure, Ctrl-C or kill): stack up → command → stack down.
#
#   scripts/with-stack.sh npx playwright test [args]     (npm run test:local -- [args])
#   scripts/with-stack.sh --perf bash perf/run.sh        (npm run perf:local)
#
# --perf raises INGEST_RATE / INGEST_BURST for this stack only, so k6 measures the API, not the limiter.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/.."

if [[ "${1:-}" == "--perf" ]]; then
  shift
  export INGEST_RATE=100000 INGEST_BURST=100000
fi
if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--perf] <command...>" >&2
  exit 2
fi

teardown() {
  echo "── shutting down the local stack (brain-town-e2e) ──"
  bash "$HERE/stack.sh" down
}
trap teardown EXIT
trap 'exit 130' INT TERM

bash "$HERE/stack.sh" up || exit 1
"$@"
exit $?
