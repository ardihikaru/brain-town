## What
<!-- What changed -->

## Why
<!-- Problem or need this addresses -->

## Testing
<!-- How you tested it (commands, browser checks) -->

## Screenshots
<!-- For visual changes; otherwise "N/A" -->

## Cross-repo dependencies
<!-- GAOS / QA tool / mfardiansyah.id / Animora changes needed; "Tidak ada" if none -->

## Checklist
- [ ] `src/backoffice.src.html` and `web/backoffice/index.html` are in sync (if touched)
- [ ] `artifacts/` untouched
- [ ] No secrets or `.env*` committed
- [ ] Docs updated (`docs/`, README roadmap) if behaviour changed
- [ ] E2E (if `e2e/` or behaviour touched): `cd e2e && npm run check` passes
- [ ] E2E: new/changed specs pass 3× (`npm run test:local -- --repeat-each=3`)
- [ ] E2E: local stack shut down after the run (`docker ps -a --filter name=brain-town-e2e` is empty)
- [ ] E2E: test catalog updated (`e2e/docs/test-catalog/`, `npm run catalog`)
