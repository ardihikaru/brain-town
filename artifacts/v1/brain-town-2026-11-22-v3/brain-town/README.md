# Brain Town — package of 22 Nov 2026 (third build: pavement rule, farm harvest, times of day, sky crashes)

| Folder | What it is | How to open |
|---|---|---|
| `town/index.html` | The town page (single file, simulated events). | Open in a browser. Needs internet only for the web fonts. |
| `back-office/index.html` | Static back-office with sample data. | Open in a browser. |
| `back-office/backoffice.src.html` | Back-office source before the task files are embedded. | For editing. |
| `tasks/` | One integration task file per platform repo: GAOS, QA tool, mfardiansyah.id. | Hand each to its repo. |

## Not in this zip

The architecture and system design document lives online and could not be written into this zip:
https://claude.ai/artifact/7jfJgb8DTH4d6BT6CvZ1HF
Use the document's own Export menu to save it as Markdown, Word or PDF.

## Live versions

- Town: https://claude.ai/artifact/E8oTgHiGzbyosGo7tNmjgE
- Back-office: https://claude.ai/artifact/GK1z18G7W4DT2vMQBTbLR3

## Switching the town to real events

In the browser console, or in a script tag after the page loads:

    brainTown.connect('https://town.mfardiansyah.id/events')

Org, repo and channel names are placeholders in the `CONFIG` block near the top of the town's script.
