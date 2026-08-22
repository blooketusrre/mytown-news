# Brand assets

| File | Used for | Source |
|---|---|---|
| `mark.svg` | SVG favicon; master artwork | hand-authored |
| `mark-small.svg` | 16px favicon only | simplified `mark.svg` |
| `favicon-32.png` | 32px favicon | rendered from `mark.svg` |
| `favicon-16.png` | 16px favicon | rendered from `mark-small.svg` |
| `apple-touch-icon.png` | iOS home screen, 180px | rendered from `mark.svg` |
| `og-image.png` | social share card, 1200×630 | rendered from `og-image.svg` |
| `og-image.svg` | source for the share card | hand-authored |

## Why two icon files

The full mark carries a clock face, four columns and a door seam. Below
roughly 24px those merge into an unreadable block, so `mark-small.svg`
drops the clock, uses three columns instead of four, and thickens every
stroke. Above 24px the detailed version is used.

If the mark is ever redrawn, both files need redrawing — the simplified
one is not generated from the other.

## Regenerating the PNGs

```bash
pip install cairosvg --break-system-packages

python3 - <<'PY'
import cairosvg
cairosvg.svg2png(url='mark.svg',       write_to='favicon-32.png',       output_width=32,   output_height=32)
cairosvg.svg2png(url='mark-small.svg', write_to='favicon-16.png',       output_width=16,   output_height=16)
cairosvg.svg2png(url='mark.svg',       write_to='apple-touch-icon.png', output_width=180,  output_height=180)
cairosvg.svg2png(url='og-image.svg',   write_to='og-image.png',         output_width=1200, output_height=630)
PY
```

## The share card font

`og-image.svg` sets the wordmark in **Playfair Display Bold** — the same
family the site masthead loads from Google Fonts, so the share card and the
site are typographically identical.

To regenerate, the font must be visible to fontconfig first:

```bash
cp PlayfairDisplay-Bold.ttf ~/.fonts/ && fc-cache -f
```

Then run the snippet above. If Playfair Display is missing, cairosvg falls
back silently to Georgia or a default serif rather than erroring — so check
the output rather than assuming it worked.

## After changing the share card

Facebook, LinkedIn and Slack cache share images aggressively. Use each
platform's debugger to force a refresh, or the old image will keep
appearing for weeks.
