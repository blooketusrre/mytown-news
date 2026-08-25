#!/usr/bin/env node
/**
 * My Town News — post-build verification
 *
 * Eleventy v3 skips a template when it throws and still exits 0, so a broken
 * page ships as a "successful" deploy. That is exactly how the homepage went
 * missing on 2026-08-06: the build log read "Wrote 17 files" instead of 18 and
 * nothing flagged it.
 *
 * This script asserts every page we expect actually exists and has real
 * content, then exits non-zero so Netlify fails the deploy loudly.
 *
 * Usage:  node scripts/verify-build.js [outputDir]
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT     = path.resolve(__dirname, "..");
const OUT      = path.resolve(ROOT, process.argv[2] || "_site");
const CLUSTERS = path.join(ROOT, "src", "_data", "clusters.json");

/* Pages that must exist on every build, independent of cluster config. */
const STATIC_PAGES = [
  "index.html",
  "about/index.html",
  "advertise/index.html",
  "privacy/index.html",
  "submit-tip/index.html",
  "subscribe/index.html",
  "subscribed/index.html",
];

/* Assets that must have been copied through. */
const ASSETS = [
  "assets/css/main.css",
];

/* A rendered page shorter than this is almost certainly a broken shell. */
const MIN_BYTES = 500;


/* ── Contrast (WCAG relative luminance) ────────────────────────────────── */
function srgb(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => srgb(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const NAVY = "#1a2744";
const AA = 4.5;

const errors   = [];
const warnings = [];

function check(relPath, label) {
  const abs = path.join(OUT, relPath);
  if (!fs.existsSync(abs)) {
    errors.push(`MISSING  ${relPath}${label ? `  (${label})` : ""}`);
    return;
  }
  const size = fs.statSync(abs).size;
  if (size < MIN_BYTES) {
    errors.push(`TOO SMALL  ${relPath} — ${size} bytes${label ? `  (${label})` : ""}`);
  }
}

/* ── Run ──────────────────────────────────────────────────────────────── */

if (!fs.existsSync(OUT)) {
  console.error(`\n✗ Build verification failed: output directory not found: ${OUT}\n`);
  process.exit(1);
}

STATIC_PAGES.forEach((p) => check(p));
ASSETS.forEach((p) => check(p));

let liveCount = 0;
try {
  const clusters = JSON.parse(fs.readFileSync(CLUSTERS, "utf8"));
  clusters.forEach((c) => {
    if (!c.live) return;
    liveCount++;
    check(path.join(c.slug, "index.html"), c.name);
  });
} catch (e) {
  errors.push(`Could not read or parse ${path.relative(ROOT, CLUSTERS)}: ${e.message}`);
}

/* The homepage is the page that broke before — sanity-check its guts, not
   just its size, so an empty-but-large shell still trips the guard. */
const homepage = path.join(OUT, "index.html");
if (fs.existsSync(homepage)) {
  const html = fs.readFileSync(homepage, "utf8");
  if (!/id="neighborhoods"/.test(html)) {
    errors.push('index.html is missing the "#neighborhoods" section');
  }
  const cardCount = (html.match(/class="cluster-list__item"/g) || []).length;
  if (liveCount && cardCount < liveCount) {
    warnings.push(`index.html lists ${cardCount} neighborhood cards but ${liveCount} clusters are live`);
  }
}

const expected = STATIC_PAGES.length + liveCount;
const actual   = expected - errors.filter((e) => e.startsWith("MISSING")).length;


/* ── Single source of truth for edition data ───────────────────────────── */
// pipeline/clusters/*.json used to define editions a second time, with
// different key names. The two drifted, and a colour changed in one place
// silently disagreed with the other for a week. Fail loudly if it returns.
if (fs.existsSync(path.join(ROOT, "pipeline", "clusters"))) {
  errors.push(
    "pipeline/clusters/ exists again — edition data must live only in " +
    "src/_data/clusters.json. Two definition files drift silently."
  );
}

const cssPath = path.join(OUT, "assets", "css", "main.css");
if (fs.existsSync(cssPath) && /\[data-cluster="[\w-]+"\]\s*\{[^}]*--accent:/.test(fs.readFileSync(cssPath, "utf8"))) {
  errors.push(
    "main.css hardcodes [data-cluster] accent tokens — they are generated " +
    "into base.njk from clusters.json. Two sources of colour will drift."
  );
}

/* ── Accent contrast, per edition ──────────────────────────────────────── */
// A single hue cannot stay legible on both a white card and the navy band.
// Ten of the original twelve editions failed AA here before anyone looked.
try {
  const editions = JSON.parse(fs.readFileSync(CLUSTERS, "utf8"));
  editions.filter((c) => c.live).forEach((c) => {
    const need = ["accent", "accentOnDark", "accentBtn", "accentInk"];
    const gaps = need.filter((k) => !/^#[0-9a-fA-F]{6}$/.test(c[k] || ""));
    if (gaps.length) {
      errors.push(`${c.slug}: missing or malformed ${gaps.join(", ")}`);
      return;
    }
    const onDark = contrast(c.accentOnDark, NAVY);
    const onBtn  = contrast(c.accentInk, c.accentBtn);
    if (onDark < AA) {
      errors.push(`${c.slug}: accentOnDark ${c.accentOnDark} is ${onDark.toFixed(2)}:1 on navy — needs ${AA}:1`);
    }
    if (onBtn < AA) {
      errors.push(`${c.slug}: accentInk on accentBtn is ${onBtn.toFixed(2)}:1 — needs ${AA}:1`);
    }
    if (!c.map || typeof c.map.lat !== "number" || typeof c.map.lng !== "number") {
      errors.push(`${c.slug}: missing map coordinates — the homepage map is built from these`);
    }
  });
  console.log(`  Contrast: ${editions.filter((c) => c.live).length} live editions checked against WCAG AA`);
} catch (e) {
  errors.push(`Could not check edition data: ${e.message}`);
}

/* ── Report ───────────────────────────────────────────────────────────── */

console.log("");
console.log("──────────────────────────────────────────────");
console.log("  Build verification");
console.log("──────────────────────────────────────────────");
console.log(`  Output:   ${path.relative(ROOT, OUT) || "."}`);
console.log(`  Pages:    ${actual}/${expected}`);
console.log(`  Clusters: ${liveCount} live`);

warnings.forEach((w) => console.log(`  ⚠ ${w}`));

if (errors.length) {
  console.error("");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  console.error("");
  console.error(`  Build verification FAILED — ${errors.length} problem(s).`);
  console.error("  Eleventy exits 0 even when a template throws, so check the");
  console.error("  build log above for a Nunjucks error on the missing page.");
  console.error("");
  process.exit(1);
}

console.log("  ✓ All expected pages present");
console.log("──────────────────────────────────────────────");
console.log("");
