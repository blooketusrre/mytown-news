#!/usr/bin/env python3
"""
Draw the homepage banner: a small-town main street at dusk.

An original illustration rather than a photograph, so there is nothing to
license, it weighs a few kilobytes, and it uses the site's own navy and gold.
Deterministic (seeded), so rebuilding it gives the same picture.

    python3 scripts/build-main-street.py > src/assets/img/main-street.svg
"""
import random

random.seed(7)
W, H = 1400, 560
GROUND = 470            # where the storefronts meet the sidewalk

NAVY_DEEP = "#141c33"
BUILDING = ["#1d2742", "#212c4a", "#1a2440", "#243052"]
TRIM = "#2c3a60"
LIT = ["#f3c47a", "#e9b062", "#f6d494"]
DARK_WIN = "#2a3657"

out = []
add = out.append

add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A small-town main street at dusk">')
add('''<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1a2744"/>
    <stop offset="0.38" stop-color="#3b4468"/>
    <stop offset="0.62" stop-color="#8a6a6a"/>
    <stop offset="0.80" stop-color="#d79a5c"/>
    <stop offset="0.92" stop-color="#efc27c"/>
  </linearGradient>
  <radialGradient id="sun" cx="0.62" cy="0.80" r="0.42">
    <stop offset="0" stop-color="#ffe2a8" stop-opacity="0.85"/>
    <stop offset="0.4" stop-color="#f3b866" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#f3b866" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="lamp" r="0.5">
    <stop offset="0" stop-color="#ffe4a6" stop-opacity="0.9"/>
    <stop offset="1" stop-color="#ffe4a6" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="street" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1b2440"/>
    <stop offset="1" stop-color="#121a2f"/>
  </linearGradient>
</defs>''')
add(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
add(f'<rect width="{W}" height="{H}" fill="url(#sun)"/>')

# Distant hills and trees behind the town.
hill = f"M0 {GROUND-70} "
x = 0
while x <= W:
    hill += f"Q{x+90} {GROUND-120-random.randint(0,40)} {x+180} {GROUND-80-random.randint(0,25)} "
    x += 180
hill += f"L{W} {H} L0 {H} Z"
add(f'<path d="{hill}" fill="#2b3456" opacity="0.9"/>')

def windows(x, y, w, h, cols, rows, lit_share=0.55):
    pad_x = w * 0.14
    gap = (w - 2 * pad_x) / cols
    ww = gap * 0.52
    wh = min(h / rows * 0.55, 34)
    for r in range(rows):
        for c in range(cols):
            wx = x + pad_x + c * gap + (gap - ww) / 2
            wy = y + 18 + r * (h / rows)
            fill = random.choice(LIT) if random.random() < lit_share else DARK_WIN
            add(f'<rect x="{wx:.1f}" y="{wy:.1f}" width="{ww:.1f}" height="{wh:.1f}" rx="1.5" fill="{fill}"/>')
            add(f'<rect x="{wx-2:.1f}" y="{wy+wh:.1f}" width="{ww+4:.1f}" height="3" fill="{TRIM}"/>')

def storefront(x, w, h, kind):
    top = GROUND - h
    color = random.choice(BUILDING)
    # Body
    add(f'<rect x="{x}" y="{top}" width="{w}" height="{h}" fill="{color}"/>')
    # Parapet / false front
    if kind == "stepped":
        add(f'<path d="M{x} {top} L{x} {top-14} L{x+w*0.25} {top-14} L{x+w*0.25} {top-26} L{x+w*0.75} {top-26} L{x+w*0.75} {top-14} L{x+w} {top-14} L{x+w} {top} Z" fill="{color}"/>')
    elif kind == "gable":
        add(f'<path d="M{x-4} {top} L{x+w/2} {top-38} L{x+w+4} {top} Z" fill="{color}"/>')
    elif kind == "arched":
        add(f'<path d="M{x} {top} L{x} {top-10} Q{x+w/2} {top-40} {x+w} {top-10} L{x+w} {top} Z" fill="{color}"/>')
    # Cornice
    add(f'<rect x="{x-4}" y="{top-4}" width="{w+8}" height="7" fill="{TRIM}"/>')
    # Upper floors
    floors = max(1, int((h - 95) / 62))
    windows(x, top + 6, w, h - 100, max(2, int(w / 52)), floors)
    # Shop band: sign, awning, big lit window, door
    sign_y = GROUND - 92
    add(f'<rect x="{x+6}" y="{sign_y}" width="{w-12}" height="14" fill="{TRIM}"/>')
    awn = random.choice(["#7a3a33", "#2f5a55", "#8a6a2e", "#5a3a5e"])
    add(f'<path d="M{x+4} {sign_y+16} L{x+w-4} {sign_y+16} L{x+w+6} {sign_y+38} L{x-6} {sign_y+38} Z" fill="{awn}" opacity="0.9"/>')
    shop = random.choice(LIT)
    add(f'<rect x="{x+10}" y="{sign_y+42}" width="{w*0.62}" height="{GROUND-sign_y-48}" fill="{shop}" opacity="0.92"/>')
    add(f'<rect x="{x+w*0.70}" y="{sign_y+46}" width="{w*0.2}" height="{GROUND-sign_y-46}" fill="{DARK_WIN}"/>')

def clock_tower(x, w, h):
    top = GROUND - h
    color = "#1f2946"
    add(f'<rect x="{x}" y="{top}" width="{w}" height="{h}" fill="{color}"/>')
    add(f'<rect x="{x-6}" y="{top-6}" width="{w+12}" height="9" fill="{TRIM}"/>')
    # Tower
    tw = w * 0.38
    tx = x + (w - tw) / 2
    add(f'<rect x="{tx}" y="{top-110}" width="{tw}" height="110" fill="{color}"/>')
    add(f'<rect x="{tx-5}" y="{top-114}" width="{tw+10}" height="7" fill="{TRIM}"/>')
    add(f'<path d="M{tx-6} {top-114} L{tx+tw/2} {top-170} L{tx+tw+6} {top-114} Z" fill="{color}"/>')
    add(f'<rect x="{tx+tw/2-1.5}" y="{top-190}" width="3" height="22" fill="{color}"/>')
    cx, cy = tx + tw / 2, top - 70
    add(f'<circle cx="{cx}" cy="{cy}" r="{tw*0.3:.1f}" fill="#f6d79a"/>')
    add(f'<path d="M{cx} {cy} L{cx} {cy-tw*0.2:.1f} M{cx} {cy} L{cx+tw*0.15:.1f} {cy+2}" stroke="{NAVY_DEEP}" stroke-width="2.5" stroke-linecap="round"/>')
    # Columns and lit entrance
    for i in range(4):
        cxx = x + w * (0.2 + i * 0.2)
        add(f'<rect x="{cxx-5}" y="{GROUND-120}" width="10" height="120" fill="{TRIM}"/>')
    add(f'<rect x="{x+w*0.42}" y="{GROUND-70}" width="{w*0.16}" height="70" fill="{LIT[0]}"/>')
    windows(x, top + 8, w, h - 135, 4, 1, lit_share=0.8)

def lamp(x):
    add(f'<circle cx="{x}" cy="{GROUND-78}" r="34" fill="url(#lamp)"/>')
    add(f'<rect x="{x-1.5}" y="{GROUND-74}" width="3" height="80" fill="{NAVY_DEEP}"/>')
    add(f'<circle cx="{x}" cy="{GROUND-78}" r="6" fill="#ffe4a6"/>')

def tree(x, s):
    add(f'<rect x="{x-2}" y="{GROUND-30*s}" width="4" height="{30*s}" fill="{NAVY_DEEP}"/>')
    add(f'<ellipse cx="{x}" cy="{GROUND-46*s}" rx="{22*s}" ry="{26*s}" fill="#1a2a3a"/>')

# The street of buildings, left to right. The left third sits under the fade.
x = 120
plan = [(150, 205, "stepped"), (120, 160, "flat"), (170, 250, "arched"),
        (130, 185, "gable"), ("tower", 230, 230), (140, 195, "stepped"),
        (115, 150, "flat"), (165, 220, "arched"), (125, 175, "gable"), (150, 200, "stepped")]
for p in plan:
    if p[0] == "tower":
        clock_tower(x, p[1], p[2]); x += p[1] + 6
    else:
        storefront(x, p[0], p[1], p[2]); x += p[0] + 6

for lx in (300, 560, 830, 1100, 1330):
    lamp(lx)
for tx, s in ((70, 1.1), (1385, 1.0)):
    tree(tx, s)

# Sidewalk and street, with the warm light reflected in it.
add(f'<rect x="0" y="{GROUND}" width="{W}" height="12" fill="#2a3557"/>')
add(f'<rect x="0" y="{GROUND+12}" width="{W}" height="{H-GROUND-12}" fill="url(#street)"/>')
for i in range(9):
    rx = 220 + i * 140 + random.randint(-20, 20)
    add(f'<rect x="{rx}" y="{GROUND+24+random.randint(0,30)}" width="{random.randint(30,70)}" height="3" rx="1.5" fill="#f3c47a" opacity="{random.uniform(0.15,0.35):.2f}"/>')
for i in range(0, W, 90):
    add(f'<rect x="{i+20}" y="{GROUND+52}" width="44" height="4" fill="#e7c98a" opacity="0.35"/>')

add('</svg>')
print("\n".join(out))
