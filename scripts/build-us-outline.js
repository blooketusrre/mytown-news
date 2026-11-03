/**
 * One-off generator for the national map's background outline.
 *
 * Run it with `node scripts/build-us-outline.js` after installing the dev
 * dependencies it needs:
 *
 *     npm install --no-save us-atlas@3 topojson-client@3 d3-geo@3
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
const { geoPath, geoAlbersUsa } = require("d3-geo");
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

// The projection parameters are recorded in the file itself. The agreement
// check above proves the two implementations compute the same *formula*, but
// it cannot catch the other failure: changing WIDTH, HEIGHT or SCALE in
// lib/us-projection.js and forgetting to re-run this script, which leaves a
// correct outline drawn at the old scale under dots placed at the new one.
// scripts/verify-build.js compares this attribute against the module.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ours.VIEWBOX}" aria-hidden="true" data-projection="albersUsa ${WIDTH}x${HEIGHT}@${SCALE} view ${ours.VIEWBOX}">
<defs>
<path id="land-shape" d="${render(states)}"/>
<!-- Drier tan in the west, greener in the east, as a land-use map shades it. -->
<linearGradient id="land" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#e3e4c8"/><stop offset="0.3" stop-color="#e8e3c6"/><stop offset="0.5" stop-color="#e3e9cd"/><stop offset="1" stop-color="#d3e4c2"/>
</linearGradient>
<!-- Relief: soft darker bands where the Rockies and the Appalachians run. -->
<linearGradient id="relief" x1="0" y1="0" x2="1" y2="0">
<stop offset="0.08" stop-color="#6f7a52" stop-opacity="0.10"/><stop offset="0.2" stop-color="#6f7a52" stop-opacity="0.22"/><stop offset="0.33" stop-color="#6f7a52" stop-opacity="0.14"/><stop offset="0.45" stop-color="#6f7a52" stop-opacity="0"/><stop offset="0.78" stop-color="#6f7a52" stop-opacity="0"/><stop offset="0.86" stop-color="#6f7a52" stop-opacity="0.13"/><stop offset="0.93" stop-color="#6f7a52" stop-opacity="0.04"/>
</linearGradient>
<!-- Terrain: broad mottling, like elevation or cover seen from above. -->
<filter id="terrain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="5" seed="11" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.45  0 0 0 0 0.27  1.6 0 0 0 -0.62" result="shade"/>
<feComposite in="shade" in2="SourceGraphic" operator="in"/>
</filter>
<!-- Grain: a fine field-and-farm texture on top. -->
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0.30  0 0 0 0 0.36  0 0 0 0 0.22  1.2 0 0 0 -0.45" result="gs"/>
<feComposite in="gs" in2="SourceGraphic" operator="in"/>
</filter>
</defs>
<use href="#land-shape" fill="url(#land)"/>
<use href="#land-shape" fill="url(#relief)"/>
<use href="#land-shape" fill="#000" filter="url(#terrain)" opacity="0.32"/>
<use href="#land-shape" fill="#000" filter="url(#grain)" opacity="0.16"/>
<path d="${render(borders)}" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
`;

const dest = path.join(__dirname, "..", "src", "assets", "img", "us-outline.svg");
fs.writeFileSync(dest, svg);
console.log(
  `Wrote ${path.relative(process.cwd(), dest)} — ` +
  `${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${WIDTH}×${HEIGHT}`
);
