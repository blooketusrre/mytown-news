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
const { execFileSync } = require("child_process");
const { thisWeekDate } = require("../lib/week");

/* ── On time, not just present ────────────────────────────────────────────
 * On 2 October every edition published — at 19:20 UTC, 2h 50m after the
 * 16:30 send, because the on-time Netlify trigger did not fire and GitHub's
 * own cron arrived five hours late. This watchdog ran at 21:26, found all
 * twenty files, and passed. Readers got their newsletter at lunchtime and
 * nothing said so.
 *
 * A watchdog that checks *whether* and not *when* is blind to the failure
 * that actually happens here. So it now also reads, from git, when each
 * edition's file for this week was first committed, and fails if any landed
 * after the send time. It does not matter which scheduler runs the watchdog,
 * or how late: the commit time is permanent.
 *
 * Kept in step with SEND_AT_UTC in pipeline/generate-issue.js; both read the
 * same environment variable with the same default.
 */
const SEND_AT_UTC = (process.env.SEND_AT_UTC || "16:30").trim();

/** Editions whose file was first committed after the send time. Pure. */
function lateEditions(addedAt, week, sendAt = SEND_AT_UTC) {
  const deadline = new Date(`${week}T${sendAt}:00Z`).getTime();
  return Object.entries(addedAt)
    .filter(([, iso]) => iso && new Date(iso).getTime() > deadline)
    .map(([slug, iso]) => ({ slug, at: iso }));
}

/** When each file was first added, from git. null where history is missing. */
function addedTimes(slugs, week, root) {
  const out = {};
  for (const slug of slugs) {
    try {
      const iso = execFileSync("git",
        ["log", "--diff-filter=A", "--format=%cI", "--", `src/content/${slug}/${week}.json`],
        { cwd: root, encoding: "utf8" }).trim().split("\n").pop();
      out[slug] = iso || null;
    } catch {
      out[slug] = null;
    }
  }
  return out;
}

module.exports = { lateEditions, addedTimes, SEND_AT_UTC };
if (require.main !== module) return;

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

// Lateness, for the editions that did publish.
const present = editions.map((c) => c.slug).filter((s) => !missing.includes(s));
const added = addedTimes(present, week, ROOT);
const unknown = present.filter((s) => !added[s]);
const late = lateEditions(added, week);

if (unknown.length === present.length && present.length) {
  // No history at all means a shallow checkout, not a late publish. Say so
  // rather than pass or fail on a guess.
  console.warn(
    `\n⚠ Cannot tell when this week's issues were committed — the checkout has no ` +
    `history. publish-watchdog.yml must check out with fetch-depth: 0.`
  );
}

if (late.length) {
  const last = late.map((l) => l.at).sort().pop();
  const hhmm = last.slice(11, 16);
  console.error(
    `\n✗ Published late: ${late.length} edition(s) committed after the ${SEND_AT_UTC} UTC send, ` +
    `the last at ${hhmm} UTC.\n` +
    `  ${late.map((l) => l.slug).join(", ")}\n\n` +
    `  Every subscriber of those editions received this week's issue late. The usual\n` +
    `  cause is that the 14:07 Netlify trigger did not start the run and GitHub's own\n` +
    `  cron did, hours behind. Check Netlify → Functions → trigger-weekly-publish\n` +
    `  today: its log is kept for 24 hours and will say whether it ran and why not.`
  );
}

if (missing.length || thin.length || late.length) process.exit(1);

console.log(`✓ Every live edition published this week, all before the ${SEND_AT_UTC} UTC send.`);
