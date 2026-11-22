# Vendored skills: Emil Kowalski

The skill folders here (except any added later by this repo) are copied **verbatim** from
[`emilkowalski/skills`](https://github.com/emilkowalski/skills) (site: <https://emilkowal.ski/skill>,
which redirects to <https://aiforui.dev/skills>).

- Pinned commit: `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (main, 2026-11-15)
- License: MIT, Copyright Emil Kowalski. See [`_emil/LICENSE`](_emil/LICENSE).
- Do not edit the vendored files. Project-specific overrides live in
  [`../rules/agents-and-models.md`](../rules/agents-and-models.md) and they win over skill advice.

## Included (web-relevant)
emil-design-eng, animate, choreograph, animation-vocabulary, animation-performance,
review-animations, break-ui, find-animation-opportunities, improve-animations, remove-animations,
apple-design, gestures, mobile-native (mobile web), prototype, learn-taste, ask-emil,
pick-ui-library (kept because other skills link to it; its library picks do not apply here).
Upstream cheatsheets: `_emil/ui-cheatsheet.md`, `_emil/performance-cheatsheet.md`.

Skills marked `disable-model-invocation: true` (review-animations, prototype, learn-taste, ask-emil,
pick-ui-library) are user slash commands; agents read their `SKILL.md` directly instead.

## Excluded
animate-expo (React Native), ask-sonner (React toast library), write-swift (native iOS).
Brain Town is plain HTML/CSS/JS with no build step.

## Re-sync
```sh
SHA=<new commit>
for p in $(gh api "repos/emilkowalski/skills/git/trees/$SHA?recursive=1" \
    --jq '.tree[]|select(.type=="blob")|.path' | grep '^skills/'); do
  s=${p#skills/}; s=${s%%/*}; [ -d ".claude/skills/$s" ] || continue
  gh api -H "Accept: application/vnd.github.raw" \
    "repos/emilkowalski/skills/contents/$p?ref=$SHA" > ".claude/$p"
done
```
Then update the pinned commit above and check `git hash-object` against the upstream tree blob SHAs.
