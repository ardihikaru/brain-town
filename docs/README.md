# Brain Town documentation

This is the initial documentation, built from the v1 package (22 Nov 2026).

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | Concepts, the event model, components, data store and design rules. |
| [api.md](api.md) | The back-office service: endpoints, ingest status codes, SSE, masking. |
| [deployment.md](deployment.md) | Running locally, the container, and the author's demo + production deployment. |
| [integrations/gaos.md](integrations/gaos.md) | Contract for [GAOS](https://github.com/ardihikaru/gaos): products, tasks, design gate, agents. |
| [integrations/qa-tool.md](integrations/qa-tool.md) | Contract for the QA Tool: a Playwright reporter that streams test runs. |
| [integrations/mfardiansyah-id.md](integrations/mfardiansyah-id.md) | Contract for [mfardiansyah.id](https://mfardiansyah.id): feed, publish hook, visit beacon. |
| [integrations/animora.md](integrations/animora.md) | Contract for Animora: rendered, scheduled, published and failed videos, connected accounts, `/feed.json` pull fallback. |
| [package-notes.md](package-notes.md) | The README that shipped with the v1 package. |
| [../e2e/README.md](../e2e/README.md) | E2E (Playwright) and performance (k6) tests against the local stack; test catalog and perf baseline. |

The original package is kept unchanged under [`../artifacts/v1/`](../artifacts/v1/).
