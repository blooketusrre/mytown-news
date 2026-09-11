#!/usr/bin/env node
/**
 * Emit the list of editions to publish, as JSON, for the workflow matrix.
 *
 * The matrix has to know the slugs before any job starts, and GitHub cannot
 * read clusters.json by itself — so a tiny planning job runs this and writes
 * the array to $GITHUB_OUTPUT.
 *
 * Usage:
 *   node scripts/list-editions.js                       # all live editions
 *   node scripts/list-editions.js north-waterfront      # just this one
 *   node scripts/list-editions.js "" --skip-published   # only what is missing
 *
 * Prints a JSON array to stdout. Exits 1 if the result would be empty,
 * because a matrix built from [] silently skips the whole job — which would
 * look like a clean run that published nothing.
 *
 * ── --skip-published ──────────────────────────────────────────────────────
 * The single exception to that rule.
 *
 * The workflow now carries a second, later cron as a backstop, because on
 * 11 September 2026 the scheduled run never started at all: no failure, no
 * queued job, nothing to notice, and no newsletter.
 *
 * A backstop that republished everything would double the API bill every week
 * to insure against something that happens rarely. With this flag the planner
 * drops any edition whose issue file for this Friday is already committed, so
 * in the normal case — the primary run worked — the backstop costs one cheap
 * planning job and stops.
 *
 * Here, and only here, an empty list is success rather than failure: it means
 * every edition is already out. It prints [] and exits 0, and the workflow
 * skips the publish job on that value.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { thisWeekDate } = require("../lib/week");

const ROOT     = path.resolve(__dirname, "..");
const CLUSTERS = path.join(ROOT, "src", "_data", "clusters.json");
const CONTENT  = path.join(ROOT, "src", "content");

const args          = process.argv.slice(2);
const skipPublished = args.includes("--skip-published");
const only          = (args.filter((a) => !a.startsWith("--"))[0] || "").trim();

let editions;
try {
  editions = JSON.parse(fs.readFileSync(CLUSTERS, "utf8"));
} catch (err) {
  console.error(`Could not read ${path.relative(ROOT, CLUSTERS)}: ${err.message}`);
  process.exit(1);
}

const slugs = editions
  .filter((c) => (only ? c.slug === only : c.live === true))
  .map((c) => c.slug);

if (!slugs.length) {
  console.error(only
    ? `No edition found with slug "${only}"`
    : "No live editions in src/_data/clusters.json");
  process.exit(1);
}

/* ── Drop what is already out ─────────────────────────────────────────────
 * Deliberately based on the committed issue file rather than on anything in
 * Buttondown. The file is what the collect job writes and what the site
 * serves, it needs no API call and no key, and it is the same fact the
 * watchdog checks — so the backstop and the watchdog cannot disagree about
 * whether an edition published.
 *
 * Buttondown's own email_duplicate guard remains the backstop to the
 * backstop: if an issue was generated and committed but the send failed, the
 * file exists, this skips it, and nothing is mailed twice either way.
 */
let published = [];
if (skipPublished) {
  const week = thisWeekDate();
  published = slugs.filter((slug) =>
    fs.existsSync(path.join(CONTENT, slug, `${week}.json`)));

  const remaining = slugs.filter((s) => !published.includes(s));

  console.error(
    `Week of ${week}: ${published.length} of ${slugs.length} already published` +
    (remaining.length ? `, ${remaining.length} to go: ${remaining.join(", ")}` : "")
  );

  if (!remaining.length) {
    // Success, not failure. Every edition is out; there is nothing to run.
    console.error("Nothing to publish — the primary run covered every edition.");
    process.stdout.write("[]");
    process.exit(0);
  }

  slugs.length = 0;
  slugs.push(...remaining);
}

// GitHub's matrix limit is 256 jobs per workflow run and is not raisable.
// Fail here with an explanation rather than letting the platform truncate.
if (slugs.length > 256) {
  console.error(
    `${slugs.length} live editions exceeds GitHub's hard limit of 256 matrix ` +
    `jobs per run. Shard the matrix — give each job a batch of editions ` +
    `instead of one — or split across several workflows.`
  );
  process.exit(1);
}

process.stdout.write(JSON.stringify(slugs));
