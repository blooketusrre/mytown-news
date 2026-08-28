/**
 * Configuration for the city hub page (city-hub.njk).
 *
 * Only cities with more than one live edition get a hub. A town with a single
 * edition *is* its hub — /oceanside/ serves the edition itself. A page whose
 * entire content is one link is a dead click, and on the market read behind
 * this business most cities will have exactly one edition.
 */

"use strict";

const { citiesNeedingHub, editionsInCity } = require("../lib/edition-path");

module.exports = {
  layout: "base.njk",

  pagination: {
    data: "cities",
    size: 1,
    alias: "city",
    before: (cities, data) => citiesNeedingHub(cities, data.clusters),
  },

  permalink: (data) => `/${data.city.slug}/index.html`,

  eleventyComputed: {
    cityEditions: (data) => editionsInCity(data.clusters, data.city.slug),
    pageTitle:    (data) => `${data.city.name} — My Town News`,
    pageDesc:     (data) => data.city.description,
  },
};
