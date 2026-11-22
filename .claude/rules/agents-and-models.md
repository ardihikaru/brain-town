# Agents, models and frontend work (always)

Agents live in `.claude/agents/`; skills (Emil Kowalski, vendored) in `.claude/skills/`.

## Frontend work always goes through the agents
- Any frontend design, analysis, critique or review → **`frontend-designer`**.
- Any frontend implementation (`web/town/index.html`, `src/backoffice.src.html`,
  `web/backoffice/index.html`) → **`frontend-engineer`**.
- The main session and other agents do not edit frontend files themselves.
- Visual, interaction or motion changes: designer spec → engineer implements → designer reviews.

## Model lock
| Work | Model | Agents |
|---|---|---|
| Analysis, planning, design, review | **Opus 5.5** (`claude-opus-5-5`) | `lead-engineer`, `frontend-designer` |
| Coding | **Sonnet 5.5** (`claude-sonnet-5-5`) | `frontend-engineer`, `backend-engineer` |

The model is pinned in each agent's frontmatter. Never pass a `model` override when spawning them.

## Coordination
Any coding task with more than one step, or any parallel work, is run by **`lead-engineer`**:
1. It analyses the task and splits it into units that do not touch the same files.
2. It gives each unit its own branch and worktree under `.claude/worktrees/`.
3. It spawns the workers (in one message when independent, so they run in parallel).
4. It reviews every diff, combines the work and opens the PR per `worktree-and-pr.md`.

If nested agent spawning is not available, the main session takes the lead-engineer role and
follows the same steps, spawning the workers directly. A small single-file fix may go straight to
the right worker.

## Project rules beat skill advice
The skills assume React and libraries; this repo does not. No frameworks, bundlers or npm libraries
(no Motion, Vaul, Sonner, React). Use CSS transitions, keyframes, WAAPI and vanilla JS in single HTML
files. Always handle `prefers-reduced-motion`. `artifacts/` stays frozen. Never edit the vendored
skill files; see `.claude/skills/UPSTREAM.md` to re-sync.

## Non-Claude CLIs
Use the equivalent tiers: your strongest reasoning model for analysis/design/review, a Sonnet-class
coding model for implementation. Read the agent files as role briefs and the skills as plain
markdown under `.claude/skills/*/SKILL.md`.
