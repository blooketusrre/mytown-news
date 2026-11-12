#!/usr/bin/env node
/* Writes the email's weather icons, src/assets/img/weather/<condition>.png,
   from lib/weather-icons.js. 96px square, shown at 32px: sharp on retina
   screens. Needs ImageMagick (`convert`). Re-run after changing the icons. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { WEATHER_ICONS, weatherSvg } = require("../lib/weather-icons");
const OUT = path.resolve(__dirname, "..", "src", "assets", "img", "weather");
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wx-"));
for (const cond of Object.keys(WEATHER_ICONS)) {
  const svg = path.join(tmp, `${cond}.svg`);
  fs.writeFileSync(svg, weatherSvg(cond, 'width="96" height="96"'));
  const png = path.join(OUT, `${cond}.png`);
  execFileSync("convert", ["-background", "none", "-density", "384", svg, "-resize", "96x96", png]);
  console.log(`  ${path.relative(process.cwd(), png)}  ${fs.statSync(png).size} bytes`);
}
