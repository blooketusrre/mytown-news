/* Weather icons, in colour (November 2026): a gold sun, grey-blue clouds,
   blue rain, a gold bolt. Each part carries its own fill and stroke, so an
   icon looks the same wherever it is drawn and needs no stylesheet.

   One source for both places they appear: inline on the site (the
   weatherIcon shortcode in .eleventy.js), and as PNGs in the email, where
   inline SVG does not render in Gmail or Outlook. After changing anything
   here, run `node scripts/build-weather-icons.js` and commit the PNGs. */
"use strict";
const SUN = "#e9a21f", SUN_RIM = "#c77f0a", CLOUD = "#dfe5ee", CLOUD_RIM = "#7c8aa0",
      DARK = "#b9c3d1", RAIN = "#2f7fc4", BOLT = "#f2b51d";
const sun = (cx, cy, r, rays) =>
  `<g stroke="${SUN_RIM}" stroke-width="1.5" stroke-linecap="round"><path d="${rays}"/></g>` +
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}" stroke="${SUN_RIM}" stroke-width="1.2"/>`;
const cloud = (d, fill = CLOUD) => `<path d="${d}" fill="${fill}" stroke="${CLOUD_RIM}" stroke-width="1.3" stroke-linejoin="round"/>`;
const CLOUD_HI = "M17 12.4H7.5a3.6 3.6 0 0 1 0-7.2 4.7 4.7 0 0 1 8.9 1 3.1 3.1 0 0 1 .6 6.2Z";
const WEATHER_ICONS = {
  sunny:  sun(12, 12, 4.4, "M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"),
  partly: sun(8.6, 8.6, 3.3, "M8.6 2.4v1.6M2.4 8.6h1.6M4.2 4.2l1.1 1.1M13 4.2l-1.1 1.1") +
          cloud("M17.4 19.6H8.9a3.5 3.5 0 0 1 0-7 4.6 4.6 0 0 1 8.7 1 3 3 0 0 1-.2 6Z"),
  cloudy: cloud("M17.4 18.6H7.9a4 4 0 0 1 0-8 5.2 5.2 0 0 1 9.9 1.1 3.4 3.4 0 0 1-.4 6.9Z"),
  fog:    cloud(CLOUD_HI) + `<path d="M4 16.2h16M6.4 19.6h11.2" stroke="${CLOUD_RIM}" stroke-width="1.5" stroke-linecap="round"/>`,
  rain:   cloud(CLOUD_HI, DARK) + `<path d="M8.8 15.6l-1 3M12.4 15.6l-1 3M16 15.6l-1 3" stroke="${RAIN}" stroke-width="1.8" stroke-linecap="round"/>`,
  storm:  cloud("M17 11.4H7.5a3.6 3.6 0 0 1 0-7.2 4.7 4.7 0 0 1 8.9 1 3.1 3.1 0 0 1 .6 6.2Z", DARK) +
          `<path d="M12.9 12.6l-2.9 4.6h3.1l-2.1 4.2" fill="none" stroke="${BOLT}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const iconKey = (cond) => (WEATHER_ICONS[cond] ? cond : "cloudy");
function weatherSvg(cond, attrs = 'aria-hidden="true" focusable="false"') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ${attrs}>${WEATHER_ICONS[iconKey(cond)]}</svg>`;
}
module.exports = { WEATHER_ICONS, weatherSvg, iconKey };
