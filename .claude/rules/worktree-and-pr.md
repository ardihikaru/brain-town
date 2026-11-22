# Worktree and PR rule (always)

1. **Always work in a git worktree.** Never edit files in the main checkout.
   ```
   git worktree add -b <type>/<name> .claude/worktrees/<type>-<name> main
   ```
   **Always put the worktree in this repo's `.claude/worktrees/` folder** (git-ignored), never
   next to the repo or in `/tmp`. Run from the main checkout root so the relative path resolves.
   One branch and one worktree per task. `<type>` is a Conventional Commit type (`feat`, `fix`, `chore`, `docs`).
2. Commit with Conventional Commits and push the branch.
3. **Open the PR** with `gh pr create`, using `.github/PULL_REQUEST_TEMPLATE.md`: fill every
   section in its own order. This product has no task-manager field; do not add one or ask for a task code.
   Cross-repo dependencies: say "Tidak ada" when none.
4. **Delete the worktree once the PR is created**: `git worktree remove <path>` (the branch
   stays on the remote). Confirm with `git worktree list`.
5. **Delete the branch once its PR is merged, every time.** Merge with
   `gh pr merge <n> --squash --delete-branch` (this removes the remote branch), then delete the
   local branch (`git branch -D <branch>`; squash merges need `-D`) and run
   `git fetch --prune`. Do not leave merged branches behind. Only touch your own branches:
   never delete another session's open branch or worktree.
6. **After every merge, pull the latest `main` in the local repo** (the main checkout, not only
   on a server): `git checkout main && git pull --ff-only`. It must succeed with no conflicts and
   leave `git status` clean and `main` equal to `origin/main`. If the pull fails or the checkout has
   local changes, stop and fix that (commit it through a worktree PR, or ask the user) rather than
   forcing it. When the merge is also being deployed, pull on the server too.
