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
| `mark-email.png` | newsletter masthead, 96px shown at 44px | rendered from `mark-mono.svg` |

## Why the newsletter needs its own file

No email client renders inline SVG reliably and Gmail strips `data:` URIs, so
the mark has to be a hosted raster referenced by absolute URL. It is white on
transparent because it sits on the navy masthead, and rendered at 96px for a
44px slot so it stays sharp on a phone.

Rendered from `mark-mono.svg`, not `mark.svg` — the latter carries a navy
background, which on a navy masthead is invisible right up until the day that
colour changes. To regenerate:

```python
import cairosvg
src = open('src/assets/img/mark-mono.svg').read().replace('currentColor', '#ffffff')
cairosvg.svg2png(bytestring=src.encode(), write_to='src/assets/img/mark-email.png',
                 output_width=96, output_height=96, background_color=None)
```

Most clients block images by default, so the mark is never the only thing
carrying the name: it has alt text and sits above a wordmark that is live
text. `scripts/verify-build.js` asserts both, and asserts that the file the
email points at is actually in the build.

## Why two icon files

The mark is three house roofs with the centre one taller. At the detailed
proportions that is six vertical wall strokes, which merge into a block
below roughly 24px — so `mark-small.svg` is separate geometry: wider gaps,
taller walls, thicker strokes. Above 24px the detailed version is used.

If the mark is ever redrawn, both files need redrawing — the simplified
one is not generated from the other.

## Geometry

Both marks are generated from five parameters (half-widths, overlap, wall
heights) and mirrored about x=128 arithmetically, so symmetry cannot drift
if someone edits them by hand. Every roof is exactly 45 degrees — rise
equals run — so all three pitches match by construction. If you change the
artwork, re-check that the right house still mirrors the left and that the
centre apex sits at x=128.

The overlap is deliberate: the outer houses tuck 26 units behind the centre
house, which is what puts visible background between the outer wall and the
centre wall. At an earlier 13-unit overlap those two strokes read as a
single thick doubled line. Past about 38 units the roofs cross and the mark
stops reading as houses.

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
