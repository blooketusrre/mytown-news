/**
 * Remove the citation markup the model adds when it quotes a web search result.
 *
 * With the web_search tool on, Claude sometimes wraps text taken from a search
 * result in <cite index="46-4,46-5">…</cite>. That markup is meant for an API
 * client to turn into footnotes; this pipeline copies the model's JSON
 * straight into the site and the email, so the tags arrived as literal text.
 * Between 21 August and 16 October 2026 that happened 381 times across 13
 * issues in 9 editions, every one of them shown to readers as
 * `<cite index="46-4,46-5">` in the middle of a story.
 *
 * The citation itself is not lost: every story carries sourceUrl and
 * sourceName, which the templates render as "Read the full story".
 *
 * Applied to every string in the issue, at any depth, so a new field cannot
 * slip past it. Pure; returns a new value.
 */

"use strict";

const CITE_TAG = /<\/?cite\b[^>]*>/gi;

function stripCitationText(s) {
  if (typeof s !== "string" || !/<\/?cite\b/i.test(s)) return s;
  return s
    .replace(CITE_TAG, "")
    .replace(/[ \t]{2,}/g, " ")        // tags between sentences left double spaces
    .replace(/ +([.,;:!?])/g, "$1")    // and spaces before punctuation
    .replace(/^[ \t]+|[ \t]+$/gm, "")   // and at the start or end of a line
    .trim();
}

function stripCitations(value) {
  if (typeof value === "string") return stripCitationText(value);
  if (Array.isArray(value)) return value.map(stripCitations);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripCitations(v);
    return out;
  }
  return value;
}

/** True if any string anywhere in value still contains cite markup. */
function hasCitations(value) {
  if (typeof value === "string") return /<\/?cite\b/i.test(value);
  if (Array.isArray(value)) return value.some(hasCitations);
  if (value && typeof value === "object") return Object.values(value).some(hasCitations);
  return false;
}

module.exports = { stripCitations, stripCitationText, hasCitations };
