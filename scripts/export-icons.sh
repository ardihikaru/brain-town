#!/usr/bin/env bash
# Re-exports the raster brand assets in web/brand/ from the hand-written SVG sources.
# One-off asset export, run only when a mark changes; the pages themselves have no build step.
# Needs: a Chromium-family browser (CHROME=... to override) and python3 with Pillow.
# Usage: scripts/export-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$CHROME" ] || { echo "no Chromium-family browser found; set CHROME=/path/to/browser" >&2; exit 1; }
B="$PWD/web/brand"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

shot() { # shot <page.html> <width> <height> <out.png>
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --virtual-time-budget=4000 \
    --window-size="$2,$3" --screenshot="$4" "file://$1" >/dev/null 2>&1
  [ -s "$4" ] || { echo "render failed: $4" >&2; exit 1; }
}
page() { # page <svg> <size> -> html path that shows the svg edge to edge
  local f="$TMP/$(basename "$1" .svg)-$2.html"
  printf '<!doctype html><html><body style="margin:0;background:transparent"><img src="file://%s" width="%s" height="%s" style="display:block"></body></html>' "$1" "$2" "$2" > "$f"
  echo "$f"
}

# favicon.ico: the 16 grid drawing at 16 px, the full drawing at 32 and 48 px.
shot "$(page "$B/mark-day-16.svg" 16)" 16 16 "$TMP/f16.png"
shot "$(page "$B/mark-day.svg" 32)" 32 32 "$TMP/f32.png"
shot "$(page "$B/mark-day.svg" 48)" 48 48 "$TMP/f48.png"
# App icons: full-bleed tile (the OS applies its own corner mask).
shot "$(page "$B/app-icon.svg" 180)" 180 180 "$B/apple-touch-icon.png"
shot "$(page "$B/app-icon.svg" 192)" 192 192 "$B/icon-192.png"
shot "$(page "$B/app-icon.svg" 512)" 512 512 "$B/icon-512.png"

# Social card, 1200x630.
cat > "$TMP/og.html" <<HTML
<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=IBM+Plex+Mono&family=IBM+Plex+Sans&display=swap" rel="stylesheet">
<style>
html,body{margin:0}
body{width:1200px;height:630px;background:#e9ede8;color:#1f2b3a;display:flex;align-items:center;justify-content:center;font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif}
.card{width:1040px;height:470px;background:#f6f7f1;border:3px solid #1f2b3a;border-radius:8px;box-shadow:10px 10px 0 rgba(31,43,58,.12);display:flex;align-items:center;gap:64px;padding:0 72px;box-sizing:border-box}
img{width:280px;height:280px;flex-shrink:0}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:22px;letter-spacing:.06em;text-transform:uppercase;color:#647282}
h1{font-family:"Bricolage Grotesque","Avenir Next","Segoe UI",sans-serif;font-weight:700;font-size:108px;line-height:1;letter-spacing:-.02em;margin:14px 0 22px}
p{font-size:30px;line-height:1.35;margin:0;color:#647282;max-width:560px}
</style></head><body><div class="card"><img src="file://$B/mark-day.svg" alt="">
<div><div class="eyebrow">town.mfardiansyah.id</div><h1>Brain Town</h1><p>A town inside my head. Every walker is one of my agents carrying a piece of work.</p></div></div></body></html>
HTML
shot "$TMP/og.html" 1200 630 "$TMP/og.png"

python3 -I - "$TMP" "$B" <<'PY'
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
frames = [Image.open(f"{tmp}/f{s}.png").convert("RGBA") for s in (16, 32, 48)]
frames[2].save(f"{out}/favicon.ico", format="ICO", append_images=frames[:2], sizes=[(16, 16), (32, 32), (48, 48)])
for name in ("apple-touch-icon.png", "icon-192.png", "icon-512.png"):
    Image.open(f"{out}/{name}").convert("RGB").save(f"{out}/{name}", optimize=True)
Image.open(f"{tmp}/og.png").convert("RGB").save(f"{out}/og.png", optimize=True)
PY
ls -l "$B"/favicon.ico "$B"/*.png
