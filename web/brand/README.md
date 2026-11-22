# Brain Town brand mark

The mark is the **Lit hall**: one long hall drawn in the town's own vocabulary (2:1 isometric
projection, heavy ink outline, shaded faces), with a row of three windows of which one is lit,
and the `✦` spark the town uses in its popups. Many rooms, one thought lit.

## Treatments

| Treatment | Where | Tile | Roof | Windows | Files |
| --- | --- | --- | --- | --- | --- |
| Day | Town, live (`live SSE`) | `#f6f7f1`, ink border | `#c8472f` | one lit `#ffd66b` | `mark-day.svg`, `mark-day-16.svg` |
| Demo | Town, simulated (`?sim=1`, or no `/events`) | `#f6f7f1`, dashed ink border | `#6f8fb3` | all dark, hollow spark | `mark-demo.svg`, `mark-demo-16.svg` |
| Night | Back-office | `#1f2b3a`, `#647282` rim | `#c8472f` | one lit, with glow | `mark-night.svg`, `mark-night-16.svg` |

The town page starts in Demo and switches to Day when the event stream opens, so the tab icon
tells you whether you are looking at real events.

## Two drawings per treatment

- `mark-*.svg` (64 grid): use at 32 px and larger.
- `mark-*-16.svg` (16 grid): a separate, simplified drawing for 16 to 24 px (tab icons). Do not
  scale the 64 grid down instead; its outlines fall below one pixel.

`app-icon.svg` is the Day drawing on a full-bleed tile, for icons the operating system masks.

## Colours

Only the page tokens are used: ink `#1f2b3a`, ink-soft `#647282`, ground `#f6f7f1`, panel
`#fbfcf8`, accent `#c8472f`, slate `#6f8fb3`, lit `#ffd66b`, gold `#dcae45`. Shaded faces follow
the town's `pal()`/`mix()` rule (`#dee1df`, `#3a4452`, `#2c3846`).

## Usage

- Keep clear space of at least one eighth of the tile width around the tile.
- Minimum size: 16 px (with the 16 grid drawing).
- Inside a page panel, use the hall without its tile; the panel is already an ink frame.
- Do not recolour, rotate, add effects or redraw the hall at another angle.

## Where the files are used

- Both pages carry their tab icon inline as a `data:` URI, so it works at `/`, `/town/` and
  `file://`. Those URIs must match the `-16.svg` files; change both together.
- `favicon.ico` and `apple-touch-icon.png` are also copied to the web root by `deploy/Dockerfile`
  for clients that ask for them by convention.
- `og.png` (1200x630) is the link-preview image.

## Re-exporting the rasters

After changing an SVG, run `scripts/export-icons.sh` (needs a Chromium-family browser and
python3 with Pillow) and commit the result. This is an asset export, not a build step.
