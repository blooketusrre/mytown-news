#!/usr/bin/env node
/**
 * My Town News — Quarterly Directory Refresh
 *
 * Regenerates only the business directory for one edition and splices it into
 * that edition's most recent issue file. The weekly run carries the directory
 * forward untouched; this is what makes the thing it carries current.
 *
 * Runs quarterly. Anything that opens in between goes into added-venues.json,
 * which the weekly run merges for free — so the refresh is correcting drift
 * rather than being the only route onto the page.
 *
 * Usage:
 *   node pipeline/generate-directory.js --cluster north-waterfront
 *   node pipeline/generate-directory.js --cluster north-waterfront --dry-run
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 *
 * ── Why this is a separate run ────────────────────────────────────────────
 * Five directory sections at 15–30 venues each dominated both the research and
 * the output of every weekly issue, to re-derive addresses and phone numbers
 * that had not changed since the week before. News is perishable; a
 * restaurant's address is not. Splitting them means the weekly job asks only
 * for what is actually new.
 *
 * ── What it does not do ───────────────────────────────────────────────────
 * It writes no new issue file. It edits the latest existing one in place, so
 * the published JSON keeps exactly the shape the site and the newsletter
 * already read — the directory simply becomes fresher without the surrounding
 * issue changing. If an edition has no issue yet, there is nothing to write
 * into and the run says so rather than inventing a file.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const {
  buildSystemPrompt,
  callClaude,
  extractJson,
  closedVenuesFor,
  stripClosedVenues,
  addPendingVenues,
} = require("./generate-issue.js");

const ROOT          = path.resolve(__dirname, "..");
const CLUSTERS_FILE = path.join(ROOT, "src", "_data", "clusters.json");
const CONTENT_DIR   = path.join(ROOT, "src", "content");
const DRY_RUN_DIR   = path.join(ROOT, "pipeline", "dry-run");

const args       = process.argv.slice(2);
const clusterArg = (() => {
  const i = args.indexOf("--cluster");
  return i !== -1 ? args[i + 1] : null;
})();
const DRY_RUN = (() => {
  if (args.includes("--dry-run")) return true;
  const v = String(process.env.DRY_RUN || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
})();

// Below GitHub's 60-minute hard cancel, as in the weekly pipeline. A directory
// refresh searches more venues than a news run and is the slower of the two.
const STARTED_AT   = Date.now();
const BUDGET_MIN   = Number(process.env.DIRECTORY_TIME_BUDGET_MIN || 20);

const SECTIONS = ["restaurants", "hotels", "shops", "artEntertainment", "gymsRecreation"];

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

/** Latest issue file for an edition, or null if it has never published. */
function latestIssueFile(slug) {
  const dir = path.join(CONTENT_DIR, slug);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function countVenues(directory) {
  return Object.values(directory || {})
    .reduce((t, v) => t + (Array.isArray(v) ? v.length : 0), 0);
}

/**
 * A directory that came back thinner than what we already have is more likely
 * a bad research run than a neighborhood that lost half its restaurants.
 * Replacing a good directory with a worse one is the one way this job can do
 * real damage, so it refuses rather than guesses.
 */
function isPlausibleReplacement(fresh, existing) {
  const f = countVenues(fresh);
  const e = countVenues(existing);
  if (f === 0) return { ok: false, why: "the new directory is empty" };
  if (e && f < e * 0.6) {
    return { ok: false, why: `the new directory has ${f} venues, down from ${e} — too large a drop to trust` };
  }
  return { ok: true, fresh: f, existing: e };
}

async function refreshDirectory(cluster) {
  console.log(`\n📒 Directory: ${cluster.name}`);

  const issueFile = latestIssueFile(cluster.slug);
  if (!issueFile) {
    throw new Error(
      `${cluster.slug} has no published issue yet — run the weekly pipeline ` +
      `first, which generates a directory when there is none to carry forward`
    );
  }

  const issue = JSON.parse(fs.readFileSync(issueFile, "utf8"));
  console.log(`  Target: ${path.relative(ROOT, issueFile)} (week of ${issue.weekOf})`);
  console.log(`  Current directory: ${countVenues(issue.directory)} venues`);

  const webSearchTool = { type: "web_search_20250305", name: "web_search" };
  const closedVenues  = closedVenuesFor(cluster.slug);
  const systemPrompt  = buildSystemPrompt(cluster, null, closedVenues, {
    includeNews: false,
    includeDirectory: true,
  });

  const userMessage =
    `Research and return the current business directory for ${cluster.name} ` +
    `(${cluster.neighborhoods.join(", ")}). Verify every venue is still open, ` +
    `following the directory verification rule. Return only valid JSON ` +
    `matching the schema in your instructions.`;

  // Same paused-turn handling as the weekly run: server-side web search returns
  // pause_turn when it needs another round, and a run that treated that as an
  // answer would silently produce nothing.
  const MAX_TURNS = 6;
  let messages = [{ role: "user", content: userMessage }];
  let response;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    response = await callClaude(systemPrompt, messages, [webSearchTool]);
    if (response.stop_reason !== "pause_turn") break;
    console.log(`  ⏸ Turn paused mid-research — continuing (${turn}/${MAX_TURNS})…`);
    messages = messages.concat([{ role: "assistant", content: response.content }]);
    if (turn === MAX_TURNS) throw new Error(`Still paused after ${MAX_TURNS} turns`);
  }

  let fresh;
  try {
    fresh = extractJson(response);
  } catch (err) {
    console.warn(`  ⚠ No JSON in first response (stop_reason: ${response.stop_reason || "unknown"}) — asking directly…`);
    const salvage = messages.concat([
      { role: "assistant", content: response.content },
      { role: "user", content:
        "Return the directory as a single JSON object matching the schema in " +
        "your instructions. Output only the JSON — no preamble, no markdown " +
        "fences. Do not search again; use only what you have already found." },
    ]);
    try {
      // The tool must stay declared: this history references it, and the API
      // rejects a continuation whose tools are missing.
      fresh = extractJson(await callClaude(systemPrompt, salvage, [webSearchTool]));
      console.log("  ✅ Recovered JSON on follow-up turn.");
    } catch (err2) {
      console.error(`  ✗ Salvage also failed: ${err2.message}`);
      throw err;
    }
  }

  if (!fresh.directory) throw new Error("response contained no directory");

  // Only the five known sections, so an invented one cannot reach the page.
  const next = {};
  SECTIONS.forEach((k) => { if (Array.isArray(fresh.directory[k])) next[k] = fresh.directory[k]; });

  const verdict = isPlausibleReplacement(next, issue.directory);
  if (!verdict.ok) {
    throw new Error(`refusing to replace the directory: ${verdict.why}`);
  }

  // Run the closure strip over the new directory, exactly as the weekly does.
  const staged = { ...issue, directory: next };

  // Hand-listed venues survive a refresh. A place that has not opened is still
  // invisible to research after the refresh, so without this the quarterly run
  // would quietly delete every pending entry the weekly run had added.
  const pending = addPendingVenues(staged, cluster.slug);
  pending.added.forEach((n)   => console.log(`  ＋ Kept from added-venues.json: ${n}`));
  pending.skipped.forEach((n) => console.log(`  ✓ ${n} is now found on its own — remove it from added-venues.json`));

  const removed = stripClosedVenues(staged, cluster.slug);
  removed.forEach((r) =>
    console.log(`  ⊘ Removed closed venue: "${r.name}" from ${r.category}`));

  const out = DRY_RUN
    ? path.join(DRY_RUN_DIR, cluster.slug, path.basename(issueFile))
    : issueFile;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(staged, null, 2), "utf8");

  SECTIONS.forEach((k) => {
    const a = (issue.directory && issue.directory[k] || []).length;
    const b = (staged.directory[k] || []).length;
    const d = b - a;
    console.log(`     ${k.padEnd(16)} ${String(a).padStart(3)} → ${String(b).padStart(3)}  ${d === 0 ? "" : (d > 0 ? `+${d}` : d)}`);
  });
  console.log(`  ${DRY_RUN ? "🧪 Rehearsal written" : "✅ Written"}: ${path.relative(ROOT, out)}`);
}

async function main() {
  let clusters;
  try {
    clusters = JSON.parse(fs.readFileSync(CLUSTERS_FILE, "utf8"));
  } catch (err) {
    console.error(`Could not read ${CLUSTERS_FILE}: ${err.message}`);
    process.exit(1);
  }

  const targets = clusters.filter((c) =>
    clusterArg ? c.slug === clusterArg : c.live === true);

  if (!targets.length) {
    console.error(clusterArg
      ? `No edition found with slug: ${clusterArg}`
      : "No live editions in src/_data/clusters.json");
    process.exit(1);
  }

  console.log("My Town News — Quarterly Directory Refresh");
  console.log(DRY_RUN
    ? "Mode: 🧪 DRY RUN — issue files will not be modified"
    : "Mode: 🚀 LIVE — the latest issue file will be rewritten in place");
  console.log(`Editions: ${targets.map((c) => c.slug).join(", ")}`);

  let failed = 0;
  for (const cluster of targets) {
    try {
      await refreshDirectory(cluster);
    } catch (err) {
      console.error(`\n✗ ${cluster.slug}: ${err.message}`);
      failed++;
    }
  }

  const mins = (Date.now() - STARTED_AT) / 60000;
  console.log(`\n⏱ Total: ${mins.toFixed(1)} min (budget ${BUDGET_MIN} min)`);

  if (failed > 0) {
    console.error(`\n❌ ${failed} edition(s) failed to refresh.`);
    process.exitCode = 1;
  }
  if (mins > BUDGET_MIN) {
    console.error(`\n⏰ TIME BUDGET EXCEEDED — ${mins.toFixed(1)} min against a ${BUDGET_MIN} min budget.`);
    console.error("   Raise it deliberately or make the refresh faster; do not");
    console.error("   let the next run discover GitHub's 60-minute hard cancel.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
