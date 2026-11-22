# Back-office conventions

- Edit `src/backoffice.src.html`; regenerate `web/backoffice/index.html` (embed task docs at
  `/*__TASKS__*/`). `artifacts/` is frozen.
- No frameworks or bundlers in the frontend. The page must still work as static sample-data demo
  when no API is reachable.
- Backend (`backend/`, Go): stdlib first; handlers return 401 (bad token), 409 (duplicate),
  422 (invalid payload), 429 (rate limit), 202 (accepted). Ingest never blocks the sender.
- Tokens: store SHA-256 hash only, show plaintext once. Visibility masking is applied server-side
  through one function before any public output.
- Receivers only: GAOS, QA tool and mfardiansyah.id emitters live in their own repos.
