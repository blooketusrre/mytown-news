#!/usr/bin/env node
/* Prints the <polygon> mask that keeps the coastal blue band off the land
   borders with Canada and Mexico, computed from the same projection as the
   map. Paste its output into the coasts mask in scripts/build-us-outline.js.
       node scripts/build-coast-mask.js */
const P = require("../lib/us-projection.js");
const xy = (lng, lat) => { const q = P.project(lng, lat); if (!q) throw new Error(`no projection for ${lng},${lat}`); return [q.x, q.y]; };
const f = (n) => n.toFixed(1);
const TOP = P.VIEW_Y;
function along(pts) { return pts.map(([a, b]) => xy(a, b)); }
// Each polygon covers the sea-side of a land border with Canada, from just
// inside the US (the land is drawn over it anyway) up to the top of the view,
// so the coastal band never appears along a border that is not a coast.
const polys = [];
// 49th parallel: WA to Lake of the Woods, and the MN arrowhead to Lake Superior.
{
  const line = [];
  for (let lng = -123.2; lng <= -95.2; lng += 0.5) line.push([lng, 48.6]);
  line.push([-95.2, 48.3], [-93, 48.0], [-90.5, 47.7], [-89.6, 47.6]);
  const pts = along(line);
  polys.push([[pts[0][0], TOP], ...pts, [pts[pts.length - 1][0], TOP]]);
}
// New York's St Lawrence border, Vermont, New Hampshire and northern Maine.
{
  const pts = along([[-76.4, 43.9], [-75.3, 44.6], [-74.7, 44.8], [-73.3, 44.8], [-71.5, 44.8], [-71.0, 45.1],
                     [-70.3, 46.2], [-69.3, 47.2], [-68.2, 47.1], [-67.95, 46.4], [-67.95, 45.7], [-67.6, 45.1]]);
  polys.push([[pts[0][0], TOP], ...pts, [pts[pts.length - 1][0] + 30, pts[pts.length - 1][1]], [pts[pts.length - 1][0] + 30, TOP]]);
}
// Alaska's border with the Yukon and BC, a meridian at 141°W.
{
  const a = along([[-141.4, 69.8], [-141.4, 60.3], [-137.8, 59.0], [-135.2, 59.6], [-133.3, 58.1], [-130.2, 55.9]]);
  polys.push([...a, ...a.slice().reverse().map(([x, y]) => [x + 40, y])]);
}
const svg = polys.map((pp) => `<polygon points="${pp.map(([x, y]) => f(x) + "," + f(y)).join(" ")}" fill="#000"/>`).join("");
process.stdout.write(svg);
// Mexico: the land border from Tijuana to El Paso, then the Rio Grande to Brownsville.
{
  const pts = along([[-117.25, 32.85], [-114.7, 33.0], [-114.8, 32.8], [-111.1, 31.6], [-108.2, 31.6], [-108.2, 32.1],
                     [-106.5, 32.1], [-104.9, 30.9], [-104.4, 29.9], [-103.2, 29.3], [-102.4, 30.1], [-101.4, 30.1],
                     [-100.6, 29.2], [-99.5, 27.8], [-99.1, 26.7], [-98.0, 26.4], [-97.4, 26.2]]);
  const BOTTOM = P.VIEW_Y + P.VIEW_H;
  // A strip just south of the border only, so Hawaii and Alaska keep their coasts.
  const strip = [...pts, ...pts.slice().reverse().map(([x, y]) => [x, y + 40])];
  const extra = `<polygon points="${strip.map(([x, y]) => f(x) + "," + f(y)).join(" ")}" fill="#000"/>`;
  process.stdout.write(extra);
}
