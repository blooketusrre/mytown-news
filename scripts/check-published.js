#!/usr/bin/env node
/**
 * Did this week's newsletter actually go out?
 *
 * Run by .github/workflows/publish-watchdog.yml on Friday afternoon, after
 * both publish crons have had their chance. Exits non-zero if any live
 * edition is missing its issue file for this Friday, because a failed
 * workflow is an email and a silent Friday is not.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * On 11 September 2026 the scheduled publish never started. GitHub's Actions
 * list had no entry for that Friday at all: nothing failed, so nothing was
 * reported, and the first sign of trouble was an empty inbox hours later.
 *
 * Every other guard in this repo catches a thing that went wrong. This one
 * catches a thing that did not happen, which turns out to be the harder case
 * and the one that actually bit.
 *
 * Deliberately reads the committed file rather than asking Buttondown:
 * scripts/list-editions.js --skip-published uses exactly the same fact, so
 * the backstop and the watchdog cannot disagree about whether an edition
 * published; it needs no API key, so it keeps working through a credential
 * rotation or a Buttondown outage; and the file is what the site serves.
 *
 * Usage:  node scripts/check-published.js [YYYY-MM-DD]
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { thisWeekDate } = require("../lib/week");

const ROOT     = path.resolve(__dirname, "..");
const CLUSTERS = path.join(ROOT, "src", "_data", "clusters.json");
const CONTENT  = path.join(ROOT, "src", "content");

const week = (process.argv[2] || "").trim() || thisWeekDate();

let editions;
try {
  editions = JSON.parse(fs.readFileSync(CLUSTERS, "utf8")).filter((c) => c.live);
} catch (err) {
  console.error(`Could not read clusters.json: ${err.message}`);
  process.exit(1);
}

if (!editions.length) {
  console.error("No live editions — nothing to check, which is itself worth knowing.");
  process.exit(1);
}

const missing = [];
const thin    = [];

editions.forEach((c) => {
  const file = path.join(CONTENT, c.slug, `${week}.json`);
  if (!fs.existsSync(file)) { missing.push(c.slug); return; }

  // A file that exists but holds no stories is a different failure wearing
  // the same clothes, and it would satisfy a bare existence check.
  try {
    const issue = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(issue.topStories) || !issue.topStories.length) thin.push(c.slug);
  } catch {
    thin.push(c.slug);
  }
});

console.log(`Week of ${week} — ${editions.length - missing.length}/${editions.length} editions published`);

if (missing.length) {
  console.error(`\n✗ No issue file for: ${missing.join(", ")}`);
  console.error(
    `\n  Either the scheduled run did not happen, or those editions failed.\n` +
    `  Check Actions → Weekly Publish. If there is no run for today at all,\n` +
    `  that is the 11 September failure again: trigger it by hand with\n` +
    `  "Skip editions already published this week" ticked, which will\n` +
    `  generate only what is missing.`
  );
}

if (thin.length) {
  console.error(`\n✗ Issue file present but carries no stories: ${thin.join(", ")}`);
}

if (missing.length || thin.length) process.exit(1);

console.log("✓ Every live edition published this week.");
