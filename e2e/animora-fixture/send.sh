#!/bin/sh
# e2e only: feeds every envelope in /events to the REAL naskah-to-video sender (python -m app.braintown send), twice.
# The second pass must also say "delivered" (Brain Town answers 409 and the sender counts that as delivered).
# Prints one "delivered|failed <file> pass<N>" line per send, never the token or the body. Exit 1 when any failed.
cd /nv || exit 1
rc=0
for f in /events/*.json; do
  for pass in 1 2; do
    if python -m app.braintown send <"$f" >/dev/null 2>&1; then
      echo "delivered $(basename "$f") pass$pass"
    else
      echo "failed $(basename "$f") pass$pass"
      rc=1
    fi
  done
done
exit $rc
