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
<!-- A band of deeper blue along every coast, the same on all of them, fading out
     to sea; masked off the land borders with Canada and Mexico, which are not coasts.
     Mask polygons computed from lib/us-projection.js along the border. -->
<filter id="coast-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="feather" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter><mask id="coasts" maskUnits="userSpaceOnUse" x="-70" y="3" width="1025" height="604"><rect x="-70" y="3" width="1025" height="604" fill="#fff"/><g filter="url(#feather)"><polygon points="83.6,3.0 83.6,16.2 90.9,18.3 98.2,20.4 105.5,22.4 112.8,24.4 120.1,26.4 127.4,28.3 134.8,30.2 142.1,32.1 149.5,33.9 156.9,35.6 164.3,37.4 171.6,39.1 179.0,40.7 186.5,42.4 193.9,43.9 201.3,45.5 208.7,47.0 216.2,48.4 223.6,49.9 231.1,51.2 238.5,52.6 246.0,53.9 253.5,55.2 261.0,56.4 268.5,57.6 276.0,58.7 283.5,59.8 291.0,60.9 298.5,61.9 306.0,62.9 313.5,63.9 321.0,64.8 328.6,65.7 336.1,66.5 343.7,67.3 351.2,68.0 358.8,68.8 366.3,69.4 373.9,70.1 381.4,70.7 389.0,71.2 396.6,71.7 404.1,72.2 411.7,72.6 419.3,73.0 426.8,73.4 434.4,73.7 442.0,74.0 449.6,74.2 457.2,74.4 464.7,74.6 472.3,74.7 479.9,74.8 487.5,74.8 495.1,74.8 502.7,74.7 502.7,81.5 536.4,87.5 575.1,92.6 589.0,94.0 589.0,3.0" fill="#000"/><polygon points="807.5,3.0 807.5,148.4 821.5,129.0 830.0,122.5 851.9,117.3 879.9,110.2 885.9,101.6 890.0,74.6 898.9,48.6 915.9,45.9 924.2,59.9 928.8,75.1 938.2,86.5 968.2,86.5 968.2,3.0" fill="#000"/><polygon points="124.1,468.5 138.3,542.4 154.5,549.4 163.4,542.1 174.4,551.2 192.8,563.4 232.8,563.4 214.4,551.2 203.4,542.1 194.5,549.4 178.3,542.4 164.1,468.5" fill="#000"/><polygon points="91.3,389.1 139.2,395.8 136.4,399.9 201.1,439.4 256.4,447.4 257.8,436.1 290.1,440.0 318.0,470.3 325.7,493.8 348.1,509.3 365.1,492.3 384.7,493.6 399.4,514.8 420.0,547.4 427.3,572.5 449.6,579.8 461.8,584.5 461.8,624.5 449.6,619.8 427.3,612.5 420.0,587.4 399.4,554.8 384.7,533.6 365.1,532.3 348.1,549.3 325.7,533.8 318.0,510.3 290.1,480.0 257.8,476.1 256.4,487.4 201.1,479.4 136.4,439.9 139.2,435.8 91.3,429.1" fill="#000"/></g></mask>
</defs>
<g mask="url(#coasts)"><use href="#land-shape" fill="none" stroke="#86bfe0" stroke-width="30" stroke-linejoin="round" filter="url(#coast-blur)" opacity="0.8"/></g>
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
