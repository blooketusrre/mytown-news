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
const { editionPath } = require("../lib/edition-path");
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
    check(path.join(editionPath(c, clusters), "index.html"), c.name);
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

/* ── Every edition page must name the neighborhoods it covers ─────────────
 * A reader arriving from search knows their own neighborhood, not our name
 * for the group it belongs to. Someone in Telegraph Hill has no way to guess
 * they want "North Waterfront".
 *
 * The masthead had a line for this from the start, but it rendered
 * issue.neighborhoods — a field the pipeline's JSON schema never asked for.
 * It was empty on all thirteen editions for months. An empty <p> looks
 * exactly like a design choice, so nothing surfaced it.
 *
 * Checking the rendered page for the actual neighborhood names is the only
 * version of this check that would have caught that: the element existed,
 * the template was "correct", and only the output was wrong.
 */
try {
  const all      = JSON.parse(fs.readFileSync(CLUSTERS, "utf8"));
  const editions = all.filter((c) => c.live);
  let checked = 0;
  editions.forEach((c) => {
    const f = path.join(OUT, editionPath(c, all), "index.html");
    if (!fs.existsSync(f)) return;              // already reported as MISSING
    // Compare on decoded text: Nunjucks escapes the apostrophe in
    // "Fisherman's Wharf" to &#39;, and curly vs straight quotes differ
    // between the data file and the rendered page.
    const norm = (s) => s
      .replace(/&amp;/g, "&")
      .replace(/&#0*39;|&#x0*27;|&apos;|[’‘]/gi, "'")
      .replace(/&quot;|[“”]/g, '"');
    const html = norm(fs.readFileSync(f, "utf8"));
    const missing = (c.neighborhoods || []).filter((n) => !html.includes(norm(n)));
    if (missing.length) {
      errors.push(
        `${c.slug}/index.html never names ${missing.join(", ")} — ` +
        `a reader who lives there cannot tell this is their edition`
      );
    } else {
      checked++;
    }
  });
  if (checked) console.log(`  Coverage: ${checked} edition pages name their neighborhoods`);
} catch (e) {
  errors.push(`Could not check edition coverage lines: ${e.message}`);
}

// Hub pages count too: a multi-edition city adds one page that is not an
// edition and not a static page.
const hubCount = (() => {
  try {
    const { citiesNeedingHub } = require("../lib/edition-path");
    return citiesNeedingHub(
      JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_data", "cities.json"), "utf8")),
      JSON.parse(fs.readFileSync(CLUSTERS, "utf8"))
    ).length;
  } catch { return 0; }
})();
const expected = STATIC_PAGES.length + liveCount + hubCount;
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

/* ── "Cluster" is an internal word ────────────────────────────────────────
 * We group neighborhoods into editions and call them clusters in the code.
 * Readers have never heard the term. It leaked into the subscribe page, the
 * about page, the homepage, the empty-edition state, and nine published
 * story bodies before anyone noticed — the last of those because the word
 * sat in the pipeline's system prompt, so Claude reasonably wrote it into
 * prose ("the Marina cluster", "two of the cluster's biggest venues").
 *
 * The ordinary English sense is fine — "a cluster of galleries" is good
 * writing. What we ban is using it as a label for one of our own coverage
 * areas, which in practice always looks like "the/this <something> cluster".
 * Matching that shape keeps the innocent usage legal.
 *
 * Templates are an error: we write them once and control every word.
 * Generated content is a warning: a Friday deploy should not fail because a
 * story legitimately described a cluster of restaurants, and the real
 * defence there is the prompt rule, not this check.
 */
{
  /* Our jargon has a specific grammatical shape: "cluster" is the head noun,
   * introduced by a determiner and modified by at most a few words naming the
   * place — "the Marina cluster", "this cluster", "the Bayview and Excelsior
   * cluster", "the city's neighborhood clusters".
   *
   * The innocent sense looks different: "a cluster of galleries" takes the
   * article "a" and is followed by "of". Excluding those two, and refusing to
   * cross punctuation, separates the cases. An earlier, looser version
   * flagged "walked through the North Waterfront, past a cluster of
   * galleries", which is perfectly good writing.
   */
  const JARGON = /\b(?:this|that|these|those|the|our|each|every)\s+(?:(?!an?\b)[\w'’&.-]+\s+){0,3}clusters?\b(?!\s+of\b)/i;

  const templates = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "content") walk(p); }
      else if (e.name.endsWith(".njk")) templates.push(p);
    }
  })(path.join(ROOT, "src"));
  templates.push(path.join(ROOT, "pipeline", "generate-issue.js"));

  // Blank out a region while preserving newlines, so reported line numbers
  // still point at the right place in the real file.
  const blank = (src, re) => src.replace(re, (m) => m.replace(/[^\n]/g, " "));

  templates.forEach((f) => {
    let src = fs.readFileSync(f, "utf8");
    // Comments and developer-facing notes may say "cluster" freely — the
    // concept still exists in the code, it just never reaches a reader.
    src = blank(src, /wording-check:\s*off[\s\S]*?wording-check:\s*on/g);
    src = blank(src, /\{#[\s\S]*?#\}/g);      // Nunjucks comments
    src = blank(src, /\/\*[\s\S]*?\*\//g);    // JS block comments
    src = blank(src, /^\s*\/\/.*$/gm);        // JS line comments

    src.split("\n").forEach((line, i) => {
      if (line.includes("${")) return;        // template interpolation is code
      const m = line.match(JARGON);
      if (m) {
        errors.push(`${path.relative(ROOT, f)}:${i + 1} says "${m[0].trim()}" — "cluster" is internal jargon, say "edition" or name the neighborhoods`);
      }
    });
  });

  const contentDir = path.join(ROOT, "src", "content");
  if (fs.existsSync(contentDir)) {
    let hits = 0;
    fs.readdirSync(contentDir).forEach((slug) => {
      const d = path.join(contentDir, slug);
      if (!fs.statSync(d).isDirectory()) return;
      fs.readdirSync(d).filter((f) => f.endsWith(".json")).forEach((f) => {
        const m = fs.readFileSync(path.join(d, f), "utf8").match(JARGON);
        if (m) { hits++; warnings.push(`${slug}/${f} says "${m[0].trim()}" — reader-facing jargon`); }
      });
    });
    if (!hits) console.log("  Wording: no reader-facing use of \"cluster\"");
  }
}

/* ── Events must be ordered, and the nav must track the right section ─────
 * Both were reader-visible bugs found by looking at the page rather than by
 * any test: events appeared in the order research happened to produce them,
 * and clicking a nav item highlighted the previous section because the
 * scrollspy band began above where anchor jumps actually land.
 *
 * Neither has a natural output assertion — sorted output is tautological
 * once the sort is applied, and scroll position does not exist at build
 * time — so what is checked is that the fixes are still wired in.
 */
try {
  const layout = fs.readFileSync(
    path.join(ROOT, "src", "_includes", "cluster-layout.njk"), "utf8");
  const base = fs.readFileSync(
    path.join(ROOT, "src", "_includes", "base.njk"), "utf8");
  const gen = fs.readFileSync(
    path.join(ROOT, "pipeline", "generate-issue.js"), "utf8");

  if (!/issue\.events\s*\|\s*sortEvents/.test(layout)) {
    errors.push("cluster-layout.njk renders events unsorted — they arrive in research order, not date order");
  }
  // The salvage retry must declare the web_search tool. The conversation it
  // continues contains server_tool_use blocks, and the API rejects a request
  // whose history references a tool the request does not define — so calling
  // it without tools made every salvage fail on a malformed request.
  if (!/callClaude\(systemPrompt, salvageMessages, \[webSearchTool\]\)/.test(gen)) {
    errors.push(
      "the JSON salvage retry no longer declares webSearchTool — the API " +
      "rejects a continuation whose history references an undeclared tool"
    );
  }
  if (/throw err;\s*\n\s*\}\s*\n\s*\}/.test(gen) && !/Salvage attempt also failed/.test(gen)) {
    errors.push("the salvage failure is swallowed again — err2 must be reported or the real cause stays hidden");
  }
  if (!/sortEvents\(issue\.events/.test(gen)) {
    errors.push("the newsletter renders events unsorted — it would disagree with the web page");
  }
  if (/new IntersectionObserver/.test(base)) {
    errors.push(
      "base.njk is back on IntersectionObserver for scrollspy — the band " +
      "started above where anchor jumps land, so every click highlighted " +
      "the previous section"
    );
  }
  if (!/navH \+ 28/.test(base)) {
    errors.push("scrollspy reading line no longer matches scroll-padding-top (--nav-h + 28px)");
  }
  console.log("  Reading:  events sorted in both renderers, scrollspy measures position");
} catch (e) {
  errors.push(`Could not verify reading-experience fixes: ${e.message}`);
}

/* ── Phase 2: city paths, the collapse rule, and legacy redirects ─────────
 * Editions live under their city. A city with several editions gets a hub;
 * a city with one serves that edition directly at /<city>/, because a hub
 * page listing a single link is a dead click and most towns will have one
 * edition.
 *
 * The redirect check is the one that protects readers rather than tidiness:
 * every issue already mailed links to a pre-migration URL, so a missing rule
 * 404s a newsletter that is already in somebody's inbox and cannot be edited.
 */
try {
  const editions = JSON.parse(fs.readFileSync(CLUSTERS, "utf8"));
  const cities   = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_data", "cities.json"), "utf8"));
  const toml     = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  const { editionPath, isSingleEditionCity, citiesNeedingHub } = require("../lib/edition-path");

  const live = editions.filter((e) => e.live);

  live.forEach((e) => {
    if (!e.citySlug) {
      errors.push(`${e.slug}: no citySlug — every edition must belong to a city`);
      return;
    }
    if (!cities.some((c) => c.slug === e.citySlug)) {
      errors.push(`${e.slug}: citySlug "${e.citySlug}" is not in cities.json`);
      return;
    }

    const rel = editionPath(e, editions);
    if (!fs.existsSync(path.join(OUT, rel, "index.html"))) {
      errors.push(`MISSING ${rel} — ${e.slug} has no page at its city path`);
    }

    // The pre-Phase-2 URL must still resolve, forever — but only for the
    // editions that ever had one. A town launched after the migration never
    // lived at /<slug>/, so demanding a redirect for it would be noise, and
    // noise is how a real missing redirect gets waved through.
    if (!e.legacyTopLevelUrl) return;
    const legacy = new RegExp(`from\\s*=\\s*"/${e.slug}/\\*"`);
    if (!legacy.test(toml)) {
      errors.push(
        `netlify.toml has no redirect for the old /${e.slug}/ URL — ` +
        `every issue already mailed links there`
      );
    }
  });

  // Single-edition cities must not emit a redundant second level.
  cities.filter((c) => c.live).forEach((c) => {
    if (isSingleEditionCity(editions, c.slug)) {
      const only = live.find((e) => e.citySlug === c.slug);
      const redundant = path.join(OUT, c.slug, only.slug, "index.html");
      if (fs.existsSync(redundant)) {
        errors.push(
          `/${c.slug}/${only.slug}/ exists but ${c.slug} has one edition — ` +
          `it should collapse to /${c.slug}/`
        );
      }
    }
  });

  // Multi-edition cities must have a hub, and it must list every edition.
  citiesNeedingHub(cities, editions).forEach((c) => {
    const hub = path.join(OUT, c.slug, "index.html");
    if (!fs.existsSync(hub)) {
      errors.push(`MISSING /${c.slug}/ — a city with several editions needs a hub page`);
      return;
    }
    const html = fs.readFileSync(hub, "utf8");
    live.filter((e) => e.citySlug === c.slug).forEach((e) => {
      if (!html.includes(editionPath(e, editions))) {
        errors.push(`/${c.slug}/ hub does not link to ${e.slug}`);
      }
    });
  });

  // Buttondown tags collide within a newsletter, not across the whole product.
  const byCity = {};
  live.forEach((e) => {
    (byCity[e.citySlug] = byCity[e.citySlug] || []).push(e.slug);
  });
  Object.entries(byCity).forEach(([city, slugs]) => {
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
    if (dupes.length) errors.push(`${city}: duplicate edition slugs ${[...new Set(dupes)].join(", ")}`);
  });

  console.log(`  Cities:   ${cities.filter((c) => c.live).length} live, ${citiesNeedingHub(cities, editions).length} with hubs, ${live.length} editions placed`);
} catch (e) {
  errors.push(`Could not verify city structure: ${e.message}`);
}

/* ── The publish pipeline must stay survivable ────────────────────────────
 * On 2026-08-28 the weekly job was cancelled at GitHub's 60-minute ceiling
 * partway through the tenth of thirteen editions. Nine finished issues were
 * on disk; zero newsletters were sent, because delivery ran in a second pass
 * that the job never reached.
 *
 * Three properties now stand between that and a repeat, and every one of
 * them is a single line that a future edit could remove without any test
 * noticing:
 *
 *   1. delivery happens per edition, not in a later phase
 *   2. fail-fast is off, so one edition cannot cancel the others
 *   3. the per-job timeout stays well under the 60-minute hard ceiling
 *   4. the script measures itself against a time budget
 */
try {
  const wf  = fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "weekly-publish.yml"), "utf8");
  const gen = fs.readFileSync(
    path.join(ROOT, "pipeline", "generate-issue.js"), "utf8");

  if (!/await\s+deliverCluster\(/.test(gen)) {
    errors.push(
      "generate-issue.js no longer delivers inside the generation loop — " +
      "a run that dies early would send nothing at all"
    );
  }
  if (!/timeWarnings|TOTAL_BUDGET_MIN/.test(gen)) {
    errors.push("generate-issue.js lost its time budget — the next approach to the 60-minute ceiling would be silent");
  }
  if (!/fail-fast:\s*false/.test(wf)) {
    errors.push(
      "weekly-publish.yml no longer sets fail-fast: false — one failing " +
      "edition would cancel every other edition mid-run"
    );
  }
  const timeouts = [...wf.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
  if (!timeouts.length) {
    errors.push("weekly-publish.yml has no timeout-minutes — jobs would inherit the 60-minute ceiling that caused the 2026-08-28 outage");
  } else if (Math.max(...timeouts) > 45) {
    errors.push(`weekly-publish.yml has a ${Math.max(...timeouts)}-minute timeout — keep jobs well under GitHub's 60-minute hard cancel`);
  }
  if (!/matrix:\s*\n\s*edition:/.test(wf)) {
    errors.push("weekly-publish.yml is no longer split by edition — thirteen serial editions is what hit the timeout");
  }
  console.log("  Pipeline: per-edition delivery, fail-fast off, timeouts under the ceiling");
} catch (e) {
  errors.push(`Could not verify the publish pipeline: ${e.message}`);
}

/* ── The dry-run switch must stay connected ───────────────────────────────
 * The workflow has offered a "Dry run" checkbox since launch, but until
 * 2026-08-24 it only skipped the git commit: the generator still ran and
 * still mailed every subscriber. Anyone testing a change with it would have
 * published a newsletter believing they had not.
 *
 * Four links in that chain, each easy to sever by accident, none of which
 * any existing test would notice:
 *   1. the workflow passes DRY_RUN to the generate step
 *   2. the generator reads it
 *   3. the generator refuses to send while it is set
 *   4. rehearsal output stays out of git and out of src/content/
 * Assert all four here, where a break fails a deploy instead of a Thursday.
 */
try {
  const wf  = fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "weekly-publish.yml"), "utf8");
  const gen = fs.readFileSync(
    path.join(ROOT, "pipeline", "generate-issue.js"), "utf8");
  const ign = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");

  if (!/^\s*DRY_RUN:\s*\$\{\{\s*github\.event\.inputs\.dry_run\s*\}\}\s*$/m.test(wf)) {
    errors.push(
      "weekly-publish.yml no longer passes DRY_RUN to the generate step — " +
      "the dry-run checkbox would send real newsletters"
    );
  }
  if (!/process\.env\.DRY_RUN/.test(gen)) {
    errors.push("generate-issue.js no longer reads process.env.DRY_RUN");
  }
  if (!/refusing to send/.test(gen)) {
    errors.push(
      "generate-issue.js lost the DRY_RUN guard inside sendClusterEmail — " +
      "a rehearsal could reach the Buttondown send"
    );
  }
  if (!/^pipeline\/dry-run\/$/m.test(ign)) {
    errors.push("pipeline/dry-run/ is no longer gitignored — rehearsals would be committed");
  }
  if (fs.existsSync(path.join(ROOT, "src", "content", "dry-run"))) {
    errors.push("a dry run wrote into src/content/ — rehearsal output must stay out of the site");
  }
  console.log("  Dry run: switch verified end to end (workflow → script → send guard)");
} catch (e) {
  errors.push(`Could not verify the dry-run switch: ${e.message}`);
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
