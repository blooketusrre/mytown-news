/**
 * Apply a directory *update* — closures, new openings, corrections — to the
 * directory an edition already has, instead of rebuilding it from scratch.
 *
 * Why: the quarterly refresh asked the model to re-research every venue in
 * every edition (about 50 each, 20 editions) and write the whole directory
 * back out, mostly to confirm that nothing had changed. That was the largest
 * single cost in October 2026. An update sends the current list, runs a few
 * targeted searches ("closed", "new opening" in that town), and returns only
 * what changed — a fraction of the searches and of the output.
 *
 * The model proposes; this file decides. Every change is checked here:
 *   - a closure needs a source URL, and must name a venue we actually list
 *   - an addition needs a name and address, must not duplicate a listing in
 *     any section, and is capped per section
 *   - a correction may only touch address, phone or website, and needs a source
 *   - closing more than 30% of a directory at once is refused outright: that
 *     is a bad research run, not a town that lost a third of its businesses
 *
 * Pure: no I/O. Returns the new directory and a log of what was applied and
 * what was ignored, and why.
 */

"use strict";

const SECTIONS = ["restaurants", "hotels", "shops", "artEntertainment", "gymsRecreation"];
const CORRECTABLE = ["address", "phone", "website"];
const MAX_ADDED_PER_SECTION = 5;
const MAX_CLOSED_SHARE = 0.3;

function defaultKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, "").replace(/^the /, "").replace(/\s+/g, " ").trim();
}

const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || "").trim());
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

function count(dir) {
  return SECTIONS.reduce((t, k) => t + (Array.isArray(dir[k]) ? dir[k].length : 0), 0);
}

/**
 * @param {object} existing  the edition's current directory
 * @param {object} diff      { closed: [], added: {section: []}, updated: [] }
 * @param {function} [key]   name normaliser (venueKey from generate-issue.js)
 */
function applyDirectoryDiff(existing, diff, key = defaultKey) {
  const dir = {};
  SECTIONS.forEach((k) => { dir[k] = Array.isArray(existing && existing[k]) ? existing[k].map((v) => ({ ...v })) : []; });
  const log = { closed: [], added: [], updated: [], ignored: [] };
  const d = diff || {};

  // Where each listed venue lives, by normalised name.
  const where = () => {
    const m = new Map();
    SECTIONS.forEach((k) => dir[k].forEach((v, i) => m.set(key(v.name), { section: k, index: i })));
    return m;
  };

  // ── Closures ────────────────────────────────────────────────────────────
  const closed = Array.isArray(d.closed) ? d.closed : [];
  const before = count(dir);
  const valid = [];
  for (const c of closed) {
    const name = c && c.name;
    if (!nonEmpty(name)) { log.ignored.push("a closure with no name"); continue; }
    if (!isUrl(c.evidence)) { log.ignored.push(`closure of "${name}": no source URL`); continue; }
    const at = where().get(key(name));
    if (!at) { log.ignored.push(`closure of "${name}": not in the directory`); continue; }
    valid.push({ name, at, evidence: c.evidence });
  }
  if (before && valid.length > before * MAX_CLOSED_SHARE) {
    throw new Error(
      `the update closes ${valid.length} of ${before} venues — more than ` +
      `${Math.round(MAX_CLOSED_SHARE * 100)}% at once is more likely a bad run than real closures`);
  }
  for (const c of valid) {
    const at = where().get(key(c.name));
    if (!at) continue;                       // already removed (listed twice)
    dir[at.section].splice(at.index, 1);
    log.closed.push(`${c.name} (${at.section}) — ${c.evidence}`);
  }

  // ── Corrections ─────────────────────────────────────────────────────────
  for (const u of Array.isArray(d.updated) ? d.updated : []) {
    const name = u && u.name;
    if (!nonEmpty(name)) { log.ignored.push("a correction with no name"); continue; }
    if (!isUrl(u.source)) { log.ignored.push(`correction to "${name}": no source URL`); continue; }
    const at = where().get(key(name));
    if (!at) { log.ignored.push(`correction to "${name}": not in the directory`); continue; }
    const changes = u.changes || {};
    const applied = [];
    for (const f of Object.keys(changes)) {
      if (!CORRECTABLE.includes(f)) { log.ignored.push(`correction to "${name}": ${f} cannot be changed by an update`); continue; }
      if (!nonEmpty(changes[f])) continue;
      if (f === "website" && !isUrl(changes[f])) { log.ignored.push(`correction to "${name}": website is not a URL`); continue; }
      const venue = dir[at.section][at.index];
      if (venue[f] === changes[f].trim()) continue;
      venue[f] = changes[f].trim();
      applied.push(f);
    }
    if (applied.length) log.updated.push(`${name}: ${applied.join(", ")}`);
  }

  // ── Additions ───────────────────────────────────────────────────────────
  const added = d.added && typeof d.added === "object" ? d.added : {};
  for (const section of Object.keys(added)) {
    if (!SECTIONS.includes(section)) { log.ignored.push(`additions to unknown section "${section}"`); continue; }
    let n = 0;
    for (const v of Array.isArray(added[section]) ? added[section] : []) {
      if (!v || !nonEmpty(v.name) || !nonEmpty(v.address)) { log.ignored.push(`an addition to ${section} with no name or address`); continue; }
      if (where().has(key(v.name))) { log.ignored.push(`"${v.name}" is already listed`); continue; }
      if (n >= MAX_ADDED_PER_SECTION) { log.ignored.push(`"${v.name}": more than ${MAX_ADDED_PER_SECTION} additions to ${section}`); continue; }
      dir[section].push({ ...v });
      log.added.push(`${v.name} (${section})`);
      n++;
    }
  }

  return { directory: dir, log };
}

module.exports = { applyDirectoryDiff, SECTIONS, CORRECTABLE, MAX_ADDED_PER_SECTION, MAX_CLOSED_SHARE };
