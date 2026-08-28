/**
 * Configuration for the single edition template (editions.njk).
 *
 * Lives in JS rather than YAML front matter because the pagination filter and
 * the permalink both need real functions — the permalink in particular has to
 * apply the single-edition collapse rule from lib/edition-path.js.
 */

"use strict";

const { editionPath } = require("../lib/edition-path");

module.exports = {
  layout: "cluster-layout.njk",

  pagination: {
    data: "clusters",
    size: 1,
    alias: "edition",
    // Unpublished editions must not generate a page. They stay in
    // clusters.json so the ZIP finder and the roadmap can see them, but a
    // reader arriving at an edition with no issues is worse than a 404.
    before: (editions) => editions.filter((e) => e.live),
  },

  // The site and the newsletter derive edition URLs from the same function,
  // so an email can never link somewhere the site does not serve.
  permalink: (data) => `${editionPath(data.edition, data.clusters)}index.html`,

  eleventyComputed: {
    clusterSlug: (data) => data.edition.slug,
    clusterName: (data) => data.edition.name,
    // The layout accepts a null issue and renders "first issue coming Friday".
    issue:       (data) => data.issues[data.edition.slug] || null,
    pageTitle:   (data) => `${data.edition.name} — My Town News`,
    pageDesc:    (data) =>
      `Weekly local news for ${nameList(data.edition.neighborhoods)}.`,
  },
};

/**
 * "A, B and C" — with a length cap, because meta descriptions are truncated
 * by search engines somewhere around 155 characters and The Sunset covers ten
 * neighborhoods.
 *
 * Worth knowing why this function exists at all: the thirteen hand-written
 * descriptions it replaces had all drifted from clusters.json. The Sunset's
 * claimed to cover Ocean Beach, which is not in its neighborhood list, while
 * omitting Parkside, Forest Hill, St. Francis Wood, Stonestown, Lakeshore and
 * Parkmerced. SoMa omitted Treasure Island and Yerba Buena Island; Downtown
 * omitted Jackson Square; Castro omitted Eureka Valley and Diamond Heights.
 * Every one of those was a search result and a social preview telling a
 * resident the paper did not cover them.
 */
function nameList(names, maxChars = 130) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "your neighborhood";

  const join = (arr) => arr.length === 1
    ? arr[0]
    : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;

  let full = join(list);
  if (full.length <= maxChars) return full;

  // Too long: name as many as fit, then acknowledge the rest honestly rather
  // than silently dropping neighborhoods the way the old descriptions did.
  for (let n = list.length - 1; n >= 2; n--) {
    const candidate = `${list.slice(0, n).join(", ")} and ${list.length - n} more neighborhoods`;
    if (candidate.length <= maxChars) return candidate;
  }
  return `${list[0]} and ${list.length - 1} more neighborhoods`;
}
