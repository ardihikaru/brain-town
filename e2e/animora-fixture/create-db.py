"""e2e only: creates the throwaway Animora database in the stack's ArcadeDB (the Animora server migrates it at boot).

Stdlib only. Env: ARCADEDB_URL, ARCADEDB_PASSWORD, ANIMORA_DB. Exits non-zero on any unexpected answer, so the
server never starts against a missing database.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("ARCADEDB_URL", "http://arcadedb:2480").rstrip("/")
PASSWORD = os.environ.get("ARCADEDB_PASSWORD", "")
DB = os.environ.get("ANIMORA_DB", "animora_e2e")
AUTH = "Basic " + base64.b64encode(f"root:{PASSWORD}".encode()).decode()


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Authorization": AUTH, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:200]


def main():
    if not PASSWORD:
        sys.exit("create-db: ARCADEDB_PASSWORD is required")
    deadline = time.time() + 120
    while True:
        try:
            if call("GET", "/api/v1/ready")[0] == 204:
                break
        except OSError:
            pass
        if time.time() > deadline:
            sys.exit("create-db: ArcadeDB was not ready in time")
        time.sleep(1)
    status, body = call("GET", f"/api/v1/exists/{DB}")
    if status == 200 and '"result":true' in body.replace(" ", ""):
        print(f"create-db: {DB} exists")
        return
    status, body = call("POST", "/api/v1/server", {"command": f"create database {DB}"})
    if status != 200:
        sys.exit(f"create-db: HTTP {status}: {body}")
    print(f"create-db: {DB} created")


main()
