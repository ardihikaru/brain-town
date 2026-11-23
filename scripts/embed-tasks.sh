#!/usr/bin/env bash
# Builds web/backoffice/index.html from src/backoffice.src.html by embedding the integration
# task files (artifacts/.../tasks/*.md) at the /*__TASKS__*/ placeholder.
# Usage: scripts/embed-tasks.sh          write web/backoffice/index.html
#        scripts/embed-tasks.sh --check  exit 1 if the web copy is out of date (for CI / PRs)
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I - "${1:-}" <<'PY'
import glob, json, os, sys
src = open("src/backoffice.src.html", encoding="utf-8").read()
tasks = {os.path.basename(f): open(f, encoding="utf-8").read()
         for f in sorted(glob.glob("artifacts/v1/*/brain-town/tasks/*.md"))}
extra = {"brain-town-integration-animora.md": "docs/integrations/animora.md"}
for key, path in extra.items():
    assert os.path.isfile(path), "missing " + path
    tasks[key] = open(path, encoding="utf-8").read()
assert tasks, "no task files found under artifacts/v1/*/brain-town/tasks/"
assert not any("</script" in t.lower() for t in tasks.values()), "task text must not contain </script"
marker = "/*__TASKS__*/{}"
assert src.count(marker) == 1, "placeholder /*__TASKS__*/{} not found exactly once"
out = src.replace(marker, json.dumps(tasks))
dst = "web/backoffice/index.html"
if sys.argv[1] == "--check":
    cur = open(dst, encoding="utf-8").read() if os.path.exists(dst) else ""
    if cur != out:
        print("web/backoffice/index.html is out of date: run scripts/embed-tasks.sh"); sys.exit(1)
    print("in sync")
else:
    open(dst, "w", encoding="utf-8").write(out); print("wrote", dst)
PY
