/**
 * The latest published issue for every edition, keyed by slug.
 *
 * This replaces thirteen near-identical <slug>/<slug>.11tydata.js files, each
 * of which globbed one directory and returned one issue. They differed only in
 * the slug in the path, which meant adding an edition meant hand-copying a
 * loader and remembering to change a string inside it.
 *
 * Reading every edition once here is also faster: one pass over src/content
 * instead of thirteen globs.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const CONTENT = path.join(__dirname, "..", "content");

module.exports = function () {
  const byslug = {};
  if (!fs.existsSync(CONTENT)) return byslug;

  for (const entry of fs.readdirSync(CONTENT, { withFileTypes: true })) {
    // src/content picks up .DS_Store on a Mac; only directories are editions.
    if (!entry.isDirectory()) continue;

    const dir   = path.join(CONTENT, entry.name);
    const files = fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();                                  // ISO dates sort chronologically

    if (!files.length) { byslug[entry.name] = null; continue; }

    const latest = path.join(dir, files[files.length - 1]);
    try {
      byslug[entry.name] = JSON.parse(fs.readFileSync(latest, "utf8"));
    } catch (err) {
      // A malformed issue must not take down the whole build — the edition
      // falls back to its "first issue coming Friday" state and the guard
      // reports the page as thin.
      console.warn(`[issues] Could not parse ${path.relative(CONTENT, latest)}: ${err.message}`);
      byslug[entry.name] = null;
    }
  }
  return byslug;
};
