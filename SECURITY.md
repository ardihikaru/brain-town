# Security policy

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/ardihikaru/brain-town/security/advisories/new),
not in public issues. You will get an answer within a few days.

In scope: the pages in `web/`, the container and nginx config in `deploy/`, and the
integration contracts in `docs/integrations/` (for example, anything that would leak tokens or
personal data from a visit beacon).

Integration tokens (`bt_live_…`) and database credentials must only ever live in server-side
env files or CI secrets, never in the browser or in this repository.
