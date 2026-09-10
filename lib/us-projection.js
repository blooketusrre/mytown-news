/**
 * The single definition of the national map's coordinate space.
 *
 * Two things have to agree: the state outline baked into
 * src/assets/img/us-outline.svg by scripts/build-us-outline.js, and the city
 * dots placed at build time by the `usPoint` filter. If they were fitted
 * differently — even slightly — every dot would sit beside the map rather
 * than on it, and the failure would look like a plausible offset rather than
 * an obvious break. So both read WIDTH, HEIGHT and SCALE from here.
 *
 * ── Why this is hand-written rather than `require("d3-geo")` ──────────────
 * d3-geo v3 is ESM-only. netlify.toml pins NODE_VERSION to 20, where
 * `require()` of an ES module throws ERR_REQUIRE_ESM, and .eleventy.js is
 * CommonJS. The filter would work on a laptop running Node 22 and fail the
 * production build — the exact shape of bug this project keeps meeting.
 *
 * So the projection is implemented here with no dependencies. It is not
 * trusted on the strength of the arithmetic looking right:
 * scripts/build-us-outline.js compares this implementation against d3-geo's
 * geoAlbersUsa across a grid of points and refuses to write the outline if
 * they disagree by more than a hundredth of a pixel. That check runs on the
 * machine regenerating the map, which is the only machine that needs d3-geo.
 * scripts/verify-build.js additionally pins known values, so an edit here
 * cannot silently move every dot on the page.
 *
 * geoAlbersUsa insets Alaska and Hawaii and returns null outside the United
 * States. Null means "do not draw", not "crash".
 */
"use strict";

const RADIANS = Math.PI / 180;
const EPSILON = 1e-6;

// The projection's own fit. These three numbers define where a coordinate
// lands; they are not the viewBox.
const WIDTH  = 960;
const HEIGHT = 600;
const SCALE  = 1300;

// The viewBox, which is the tight bounds of the rendered land plus a small
// margin — not [0 0 960 600]. geoAlbersUsa puts the Alaska inset left of x=0
// and the southern tip of Texas below y=600, so a 960×600 box both clips the
// map and leaves a band of dead space above it. Measured with d3's
// geoPath().bounds() at the fit above: x from -65.1 to 949.6, y from 8.0 to
// 601.6.
//
// Percentages are taken against this box, so it has to be the same box the
// generated SVG declares. scripts/build-us-outline.js writes it from here and
// scripts/verify-build.js checks the file still agrees.
const VIEW_X = -70;
const VIEW_Y = 3;
const VIEW_W = 1025;
const VIEW_H = 604;

/**
 * Albers conic equal-area, in the form d3 composes it: rotate about the pole
 * by whole degrees of longitude, project, then scale and translate so that
 * `center` lands on `translate`.
 *
 * Every rotation Albers USA uses is longitude-only ([λ, 0]), so the general
 * three-axis rotation reduces to shifting the longitude — which is why there
 * is no quaternion arithmetic here.
 */
function conicEqualArea({ parallels, rotate, center, scale, translate }) {
  const [p0, p1] = parallels.map((d) => d * RADIANS);
  const sinP0 = Math.sin(p0);
  const n  = (sinP0 + Math.sin(p1)) / 2;
  const c  = 1 + sinP0 * (2 * n - sinP0);
  const r0 = Math.sqrt(c) / n;

  // The raw projection, on already-rotated radians.
  const raw = (lambda, phi) => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    const t = lambda * n;
    return [r * Math.sin(t), r0 - r * Math.cos(t)];
  };

  const rotateLambda = rotate[0] * RADIANS;
  const cLambda = center[0] * RADIANS;
  const cPhi    = center[1] * RADIANS;

  // Where the centre lands before translation, so it can be cancelled out.
  const [ccx, ccy] = raw(cLambda, cPhi);
  const dx = translate[0] - scale * ccx;
  const dy = translate[1] + scale * ccy;

  return function project(lng, lat) {
    // Rotate, then wrap into [-180°, 180°) so a point east of the antimeridian
    // does not reappear on the far side of the map.
    let lambda = lng * RADIANS + rotateLambda;
    lambda = ((lambda + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const [x, y] = raw(lambda, lat * RADIANS);
    return [dx + scale * x, dy - scale * y];
  };
}

const within = ([x, y], [[x0, y0], [x1, y1]]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * The composite projection at a given scale and translate. The three
 * sub-projections and their clip rectangles are d3's, reproduced so the inset
 * boxes for Alaska and Hawaii land where the generated outline puts them.
 */
function albersUsa(scale, translate) {
  const k = scale;
  const tx = translate[0];
  const ty = translate[1];

  const lower48 = conicEqualArea({
    parallels: [29.5, 45.5], rotate: [96, 0], center: [-0.6, 38.7],
    scale: k, translate: [tx, ty],
  });
  const lower48Clip = [[tx - 0.455 * k, ty - 0.238 * k], [tx + 0.455 * k, ty + 0.238 * k]];

  const alaska = conicEqualArea({
    parallels: [55, 65], rotate: [154, 0], center: [-2, 58.5],
    scale: k * 0.35, translate: [tx - 0.307 * k, ty + 0.201 * k],
  });
  const alaskaClip = [
    [tx - 0.425 * k + EPSILON, ty + 0.120 * k + EPSILON],
    [tx - 0.214 * k - EPSILON, ty + 0.234 * k - EPSILON],
  ];

  const hawaii = conicEqualArea({
    parallels: [8, 18], rotate: [157, 0], center: [-3, 19.9],
    scale: k, translate: [tx - 0.205 * k, ty + 0.212 * k],
  });
  const hawaiiClip = [
    [tx - 0.214 * k + EPSILON, ty + 0.166 * k + EPSILON],
    [tx - 0.115 * k - EPSILON, ty + 0.234 * k - EPSILON],
  ];

  const parts = [[lower48, lower48Clip], [alaska, alaskaClip], [hawaii, hawaiiClip]];

  return function project(lng, lat) {
    for (const [fn, clip] of parts) {
      const p = fn(lng, lat);
      if (within(p, clip)) return p;
    }
    return null;   // outside the United States
  };
}

const projectRaw = albersUsa(SCALE, [WIDTH / 2, HEIGHT / 2]);

/** (lng, lat) → { x, y } in the viewBox above, or null if off-map. */
function project(lng, lat) {
  const p = projectRaw(lng, lat);
  return p ? { x: p[0], y: p[1] } : null;
}

/**
 * The same point as percentages of the viewBox.
 *
 * The map is a fixed-aspect-ratio box with the outline as a background image,
 * so percentage positions stay correct at every width without any JavaScript
 * measuring anything — which is the failure mode the neighborhood map already
 * has twice.
 */
function projectPercent(lng, lat) {
  const p = project(lng, lat);
  if (!p) return null;
  return {
    left: ((p.x - VIEW_X) / VIEW_W) * 100,
    top:  ((p.y - VIEW_Y) / VIEW_H) * 100,
  };
}

/** The viewBox string the generated SVG must declare. */
const VIEWBOX = `${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`;

module.exports = {
  project, projectPercent, albersUsa,
  WIDTH, HEIGHT, SCALE,
  VIEW_X, VIEW_Y, VIEW_W, VIEW_H, VIEWBOX,
};
