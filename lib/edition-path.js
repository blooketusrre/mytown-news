/**
 * Where an edition lives — the one function that decides.
 *
 * Required by both .eleventy.js (as a filter, for links and permalinks) and
 * pipeline/generate-issue.js (for the "read it online" link in every
 * newsletter). Those two disagreeing would mean the email pointing at a URL
 * the site does not serve, discovered by a subscriber rather than by us, so
 * there is deliberately one implementation and both sides import it.
 *
 * ── The collapse rule ─────────────────────────────────────────────────────
 * Most towns are not San Francisco. A town with one edition should live at
 * /oceanside/, not /oceanside/oceanside/, and should not get a hub page whose
 * only content is a single link — a hub listing one item is a dead click.
 *
 *   /san-francisco/                    hub — there are twelve to choose from
 *   /san-francisco/north-waterfront/   an edition inside a multi-edition city
 *   /oceanside/                        the edition itself
 *
 * A city that grows from one edition to several needs its old URL redirected
 * into the new structure. That is a good problem, it will be rare, and the
 * redirect is two lines.
 */

"use strict";

/** Live editions belonging to a city, in clusters.json order. */
function editionsInCity(editions, citySlug) {
  return (editions || []).filter((e) => e.live && e.citySlug === citySlug);
}

/** True when a city should collapse its single edition up to the city path. */
function isSingleEditionCity(editions, citySlug) {
  return editionsInCity(editions, citySlug).length === 1;
}

/** Absolute site path for one edition, with trailing slash. */
function editionPath(edition, editions) {
  if (!edition || !edition.citySlug) {
    throw new Error(
      `Edition "${edition && edition.slug}" has no citySlug — every edition ` +
      `must belong to a city in src/_data/cities.json`
    );
  }
  return isSingleEditionCity(editions, edition.citySlug)
    ? `/${edition.citySlug}/`
    : `/${edition.citySlug}/${edition.slug}/`;
}

/** Absolute site path for a city. Equals the edition path when it collapses. */
function cityPath(citySlug) {
  return `/${citySlug}/`;
}

/** Cities that warrant a hub page: more than one live edition. */
function citiesNeedingHub(cities, editions) {
  return (cities || []).filter(
    (c) => c.live && editionsInCity(editions, c.slug).length > 1
  );
}

module.exports = {
  editionsInCity,
  isSingleEditionCity,
  editionPath,
  cityPath,
  citiesNeedingHub,
};
