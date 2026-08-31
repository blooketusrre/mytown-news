#!/usr/bin/env node
/**
 * Emit the list of editions to publish, as JSON, for the workflow matrix.
 *
 * The matrix has to know the slugs before any job starts, and GitHub cannot
 * read clusters.json by itself — so a tiny planning job runs this and writes
 * the array to $GITHUB_OUTPUT.
 *
 * Usage:
 *   node scripts/list-editions.js                  # all live editions
 *   node scripts/list-editions.js north-waterfront # just this one
 *
 * Prints a JSON array to stdout. Exits 1 if the result would be empty,
 * because a matrix built from [] silently skips the whole job — which would
 * look like a clean run that published nothing.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT     = path.resolve(__dirname, "..");
const CLUSTERS = path.join(ROOT, "src", "_data", "clusters.json");
const only     = (process.argv[2] || "").trim();

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
