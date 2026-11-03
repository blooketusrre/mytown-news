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
<!-- Texture: three or four close greens in soft patches, with no regional
     meaning. Noise is quantised into a few steps so it reads as tones, not
     as a gradient or as topography. -->
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
<!-- The deeper blue just off the West Coast, fading out to sea. -->
<filter id="coast-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="feather" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter><mask id="west-coast" maskUnits="userSpaceOnUse" x="-70" y="3" width="1025" height="604"><rect x="-110" y="40" width="300" height="355" fill="#fff" filter="url(#feather)"/></mask>
</defs>
<g mask="url(#west-coast)"><use href="#land-shape" fill="none" stroke="#79b4da" stroke-width="34" stroke-linejoin="round" filter="url(#coast-blur)" opacity="0.85"/></g>
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
