# Contributing to Brain Town

Thanks for helping build the town.

## Ground rules

- **No build step.** The town and the back-office are single HTML files with inline CSS and
  JS. Keep them that way: no frameworks and no bundlers.
- **Events are the only input.** New behaviour in the town should be a reaction to an event on
  the bus. Document any new event type in the `EVENT BUS` comment and in `docs/`.
- **Keep `artifacts/` frozen.** It is the original v1 package. Edit `web/` and `src/` instead.
- **Back-office source.** Edit `src/backoffice.src.html`; `web/backoffice/index.html` is the
  same page with the integration docs embedded.

## Workflow

1. Open an issue describing the change (or pick an existing one).
2. Branch from `main`, e.g. `feat/harbour-district` or `fix/night-lighting`.
3. Check it in a browser: open the file, or run `docker compose up --build`.
4. Open a pull request with what changed, why, and how you tested it. Add screenshots for
   visual changes.

## Adding a platform integration

Write a contract in `docs/integrations/<platform>.md`, following the existing ones: settings,
when to send, the JSON for each event, rules (timeouts, idempotency, privacy), a "Done when"
checklist and a `curl` example.
