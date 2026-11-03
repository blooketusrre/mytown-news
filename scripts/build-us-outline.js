/**
 * One-off generator for the national map's background outline.
 *
 * Run it with `node scripts/build-us-outline.js` after installing the dev
 * dependencies it needs:
 *
 *     npm install --no-save us-atlas@3 world-atlas@2 topojson-client@3 d3-geo@3
 *
 * It rewrites src/assets/img/us-outline.svg. It is deliberately NOT part of
 * the site build. us-atlas is several megabytes of source geometry the site
 * has no reason to carry on every deploy, d3-geo v3 is ESM-only and would
 * break the Node 20 build that netlify.toml pins, and the shape of the
 * United States does not change between deploys.
 *
 * ── The check that matters ────────────────────────────────────────────────
 * The outline is rendered with d3-geo. The city dots are placed at build time
 * by lib/us-projection.js, which reimplements the same projection with no
 * dependencies. If those two ever diverge, every dot moves off the map by a
 * plausible-looking amount rather than breaking visibly.
 *
 * So this script refuses to write the file unless the two agree across a grid
 * of thousands of points. This is the only machine that has d3-geo, so it is
 * the only place the comparison can be made.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { geoPath, geoAlbersUsa, geoAlbers } = require("d3-geo");
const topojson = require("topojson-client");
const ours = require("../lib/us-projection");

const { WIDTH, HEIGHT, SCALE } = ours;
const TOLERANCE = 0.01;   // hundredths of a pixel in a 960-wide viewBox

const reference = geoAlbersUsa().scale(SCALE).translate([WIDTH / 2, HEIGHT / 2]);

/* ── Agreement check, before anything is written ─────────────────────────── */
let compared = 0;
let worst = 0;
let worstAt = null;
let clipDisagreements = 0;

for (let lat = 18; lat <= 72; lat += 0.5) {
  for (let lng = -179; lng <= -66; lng += 0.5) {
    const a = reference([lng, lat]);
    const b = ours.project(lng, lat);
    // One says "inside the United States", the other says "outside it".
    if (Boolean(a) !== Boolean(b)) { clipDisagreements++; continue; }
    if (!a) continue;
    compared++;
    const d = Math.hypot(a[0] - b.x, a[1] - b.y);
    if (d > worst) { worst = d; worstAt = [lng, lat]; }
  }
}

if (clipDisagreements || worst > TOLERANCE) {
  console.error(
    `✗ lib/us-projection.js disagrees with d3-geo: ` +
    `${clipDisagreements} clip disagreement(s), worst offset ${worst.toFixed(4)}px` +
    (worstAt ? ` at ${worstAt.join(", ")}` : "") + `.\n` +
    `  The outline and the city dots would not line up. Not writing the file.`
  );
  process.exit(1);
}
console.log(
  `✓ projection agrees with d3-geo across ${compared.toLocaleString()} points ` +
  `(worst offset ${worst.toExponential(1)}px)`
);

/* ── Render ──────────────────────────────────────────────────────────────── */
const us = require("us-atlas/states-10m.json");
const states  = topojson.feature(us, us.objects.states);
const borders = topojson.mesh(us, us.objects.states, (a, b) => a !== b);

// Whole pixels in a 960-wide viewBox. The outline is a background drawn at
// roughly a third of that on screen, so sub-pixel precision buys nothing
// visible and costs about half the file size.
const render = geoPath(reference).digits(0);

/* ── The neighbours ─────────────────────────────────────────────────────────
 * Since November 2026 the map shows Canada, Mexico and the Caribbean as plain
 * land around a textured United States, as in the design mock-up, so the
 * coasts and borders read the way a reader expects.
 *
 * Natural Earth land (world-atlas, public domain), drawn with the plain
 * Albers projection that geoAlbersUsa uses for the lower 48 — the same scale
 * and translate — so it lines up with the states exactly. Clipped well
 * outside the view so the coastal band is never drawn along a clip edge. */
const [VX, VY, VW, VH] = ours.VIEWBOX.split(" ").map(Number);
const M = 90;
const lower48 = geoAlbers().scale(SCALE).translate([WIDTH / 2, HEIGHT / 2])
  .clipExtent([[VX - M, VY - M], [VX + VW + M, VY + VH + M]]);
const world = require("world-atlas/land-50m.json");
const neighbours = geoPath(lower48).digits(0)(topojson.feature(world, world.objects.land));

/* Natural Earth's land layer fills the Great Lakes in. These are the lakes,
 * traced by hand from coordinates. Only their Canadian shores show: the
 * United States is drawn on top with its own exact shoreline, so on the US
 * side each outline simply runs through land. Manitoulin Island is put back
 * over Lake Huron. */
const LAKES = [
  // Superior: Canadian north shore, then back through Michigan and Wisconsin.
  [[-89.6, 48.0], [-89.2, 48.4], [-88.3, 48.75], [-87.3, 48.8], [-86.4, 48.72], [-85.9, 48.1], [-84.9, 47.95],
   [-84.7, 47.4], [-84.6, 46.9], [-84.4, 46.5], [-84.6, 46.35], [-87.0, 46.2], [-90.0, 46.3], [-92.2, 46.62], [-90.9, 47.3]],
  // Michigan: wholly in the US, which shows its own shoreline.
  [[-87.9, 41.55], [-87.4, 41.55], [-86.5, 42.2], [-86.2, 43.0], [-86.45, 44.0], [-85.6, 45.0], [-84.8, 45.85],
   [-86.5, 46.0], [-87.7, 45.3], [-88.0, 44.5], [-87.6, 43.5], [-87.95, 42.5]],
  // Huron with Georgian Bay and the North Channel.
  [[-84.2, 46.42], [-83.5, 46.28], [-82.3, 46.22], [-81.3, 46.1], [-80.6, 45.92], [-80.3, 45.45], [-79.9, 44.9],
   [-80.6, 44.55], [-80.95, 44.6], [-81.3, 45.0], [-81.65, 45.26], [-81.35, 44.95], [-81.6, 44.6], [-81.7, 44.15],
   [-81.75, 43.6], [-82.0, 43.2], [-82.4, 43.0], [-83.0, 43.5], [-84.0, 44.0], [-84.4, 45.4], [-84.6, 46.0]],
  // Erie.
  [[-83.15, 42.05], [-82.6, 41.95], [-82.5, 41.9], [-81.8, 42.27], [-81.0, 42.66], [-80.2, 42.6], [-80.15, 42.53],
   [-79.5, 42.86], [-79.0, 42.92], [-78.85, 42.75], [-80.0, 42.1], [-81.5, 41.4], [-83.45, 41.7]],
  // Ontario.
  [[-79.1, 43.26], [-79.85, 43.3], [-79.4, 43.64], [-78.5, 43.92], [-77.6, 44.02], [-77.0, 43.88], [-76.9, 44.1],
   [-76.5, 44.22], [-76.2, 44.1], [-76.3, 43.5], [-77.6, 43.25]],
];
const ISLANDS = [
  // Manitoulin.
  [[-83.0, 45.95], [-82.0, 46.0], [-81.65, 45.85], [-81.75, 45.65], [-82.5, 45.55], [-82.9, 45.75]],
];
const ring = (pts) => "M" + pts.map(([lng, lat]) => lower48([lng, lat]).map((v) => Math.round(v)).join(",")).join("L") + "Z";
const lakes = LAKES.map(ring).join("");
const islands = ISLANDS.map(ring).join("");

/* Alaska and Hawaii are insets. On a map that now has neighbours they sit on
 * top of the Pacific and northern Mexico, so each gets a small box of open
 * water, as insets do on printed maps. */
const box = (fips, pad) => {
  const f = states.features.find((x) => String(x.id) === fips);
  const [[x0, y0], [x1, y1]] = geoPath(reference).bounds(f);
  // Kept inside the view, with a small margin, so no box runs off the edge.
  const bx0 = Math.max(x0 - pad, VX + 6), by0 = Math.max(y0 - pad, VY + 6);
  const bx1 = Math.min(x1 + pad, VX + VW - 6), by1 = Math.min(y1 + pad, VY + VH - 6);
  return { x: Math.round(bx0), y: Math.round(by0), w: Math.round(bx1 - bx0), h: Math.round(by1 - by0) };
};
const insets = [box("02", 14), box("15", 12)];
const insetRects = insets.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/>`).join("");

// The projection parameters are recorded in the file itself. The agreement
// check above proves the two implementations compute the same *formula*, but
// it cannot catch the other failure: changing WIDTH, HEIGHT or SCALE in
// lib/us-projection.js and forgetting to re-run this script, which leaves a
// correct outline drawn at the old scale under dots placed at the new one.
// scripts/verify-build.js compares this attribute against the module.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ours.VIEWBOX}" aria-hidden="true" data-projection="albersUsa ${WIDTH}x${HEIGHT}@${SCALE} view ${ours.VIEWBOX}">
<defs>
<path id="land-shape" d="${render(states)}"/>
<path id="neighbours" d="${neighbours}"/>
<clipPath id="inset-water">${insetRects}</clipPath>
<!-- Texture on the United States only: three or four close greens in soft
     patches, with no regional meaning, and a faint grain. -->
<filter id="patches" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.007 0.009" numOctaves="3" seed="23" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.66  0 0 0 0 0.45  1 0 0 0 0" result="c"/>
<feComponentTransfer in="c" result="q"><feFuncA type="discrete" tableValues="0 0 0.5 1"/></feComponentTransfer>
<feComposite in="q" in2="SourceGraphic" operator="in"/>
</filter>
<filter id="highlights" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.011 0.014" numOctaves="2" seed="5" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.96  0 0 0 0 0.97  0 0 0 0 0.90  1 0 0 0 0" result="c"/>
<feComponentTransfer in="c" result="q"><feFuncA type="discrete" tableValues="0 0 0 1"/></feComponentTransfer>
<feComposite in="q" in2="SourceGraphic" operator="in"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="2" seed="4" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0.40  0 0 0 0 0.48  0 0 0 0 0.34  1.2 0 0 0 -0.5" result="gs"/>
<feComposite in="gs" in2="SourceGraphic" operator="in"/>
</filter>
<!-- A band of deeper blue along every coast, fading out to sea: a blurred
     stroke of all the land, drawn underneath it. Land borders are inside
     the land now, so the band only ever shows on water. -->
<filter id="coast-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="8"/></filter>
</defs>
<g fill="none" stroke="#86bfe0" stroke-width="30" stroke-linejoin="round" filter="url(#coast-blur)" opacity="0.8">
<use href="#neighbours"/><use href="#land-shape"/>
</g>
<use href="#neighbours" fill="#edf0e6"/>
<path d="${lakes}" fill="#b3d6eb"/>
<path d="${islands}" fill="#edf0e6"/>
<g fill="#d6e8f2" stroke="#c4dcea" stroke-width="1">${insetRects}</g>
<g clip-path="url(#inset-water)"><use href="#land-shape" fill="none" stroke="#86bfe0" stroke-width="30" stroke-linejoin="round" filter="url(#coast-blur)" opacity="0.8"/></g>
<use href="#land-shape" fill="#e3e9d2"/>
<use href="#land-shape" fill="#000" filter="url(#patches)" opacity="0.16"/>
<use href="#land-shape" fill="#000" filter="url(#highlights)" opacity="0.45"/>
<use href="#land-shape" fill="#000" filter="url(#grain)" opacity="0.10"/>
<path d="${render(borders)}" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
`;

const dest = path.join(__dirname, "..", "src", "assets", "img", "us-outline.svg");
fs.writeFileSync(dest, svg);
console.log(
  `Wrote ${path.relative(process.cwd(), dest)} — ` +
  `${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${WIDTH}×${HEIGHT}`
);
