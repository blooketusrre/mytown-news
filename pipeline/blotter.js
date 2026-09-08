/**
 * Weekly police-report summary, from DataSF.
 *
 * Source: San Francisco Police Department Incident Reports, dataset wg3w-h783
 * on data.sfgov.org. Public, free, no API key, updated daily.
 *
 * ── Why a summary and not a blotter ───────────────────────────────────────
 * There is no blotter to reprint. SFPD publishes no narrative incident log —
 * no district newsletters with write-ups — only structured records. Anything
 * readable has to be composed from them, and three properties of the data
 * decide how:
 *
 *   1. Volume is wildly uneven. In the week to 8 September 2026: Mission 227
 *      incidents, Tenderloin 222, South of Market 187 — against Glen Park 2,
 *      Japantown 2, Twin Peaks 2. A feature built around individual incidents
 *      is a firehose in one edition and empty in another.
 *
 *   2. Much of it is not crime. Of the top categories that week, Warrant
 *      (126), Other Miscellaneous (122), Non-Criminal (85), Missing Person
 *      (42), Lost Property (28) and Recovered Vehicle (27) are administrative.
 *      A raw list reads as "Aided Case, Aided Case, Lost Property".
 *
 *   3. Every record is an initial report — an allegation, not a conviction,
 *      and some are later unfounded. Publishing one at street level puts an
 *      unverified claim next to an address.
 *
 * So this reports counts and a trend, never individual incidents, and always
 * against a four-week average so a single busy week does not read as a spike.
 * Raw counts across neighborhoods are deliberately not offered for comparison:
 * without denominators — daytime population, reporting rates, policing
 * intensity — the Tenderloin always "wins", which is misleading and corrosive
 * for a publication whose whole argument is local trust.
 */

"use strict";

const https = require("https");

const DATASET   = "wg3w-h783";
const HOST      = "data.sfgov.org";
const DASHBOARD = "https://www.sanfranciscopolice.org/stay-safe/crime-data/crime-dashboard";

/**
 * Categories that are records of police activity rather than reports of crime.
 * Including them roughly doubles the count and tells a reader nothing: a found
 * wallet and a recovered car are not what anyone means by "what happened here
 * this week".
 */
const ADMINISTRATIVE = new Set([
  "Non-Criminal",
  "Lost Property",
  "Recovered Vehicle",
  "Missing Person",
  "Warrant",
  "Other Miscellaneous",
  "Miscellaneous Investigation",
  "Case Closure",
  "Suspicious Occ",
  "Courtesy Report",
  "Fire Report",
  "Traffic Collision",
  "Vehicle Impounded",
  "Vehicle Misplaced",
]);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: HOST, path, method: "GET", headers: { Accept: "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) return reject(new Error(`DataSF ${res.statusCode}: ${data.slice(0, 200)}`));
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("DataSF request timed out")));
    req.end();
  });
}

const iso = (d) => d.toISOString().slice(0, 19);

/** SoQL `in(...)` list, single-quoted and escaped. */
function inList(names) {
  return names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(",");
}

/**
 * Summarise the seven days before `asOf` for one edition.
 *
 * Returns null rather than throwing when the data is unavailable — a police
 * summary is worth having and not worth failing a newsletter over. The caller
 * simply omits the section.
 */
async function fetchBlotter(cluster, asOf = new Date()) {
  const names = cluster.analysisNeighborhoods || [];
  if (!names.length) return null;

  const end   = new Date(asOf);
  const start = new Date(end.getTime() - 7 * 864e5);
  const prev  = new Date(end.getTime() - 35 * 864e5);   // four weeks before that
  const where = (from, to) =>
    `analysis_neighborhood in(${inList(names)}) AND incident_datetime > '${iso(from)}' AND incident_datetime <= '${iso(to)}'`;

  const q = (w, extra = "") =>
    `/resource/${DATASET}.json?$select=incident_category,count(*) AS n&$where=${encodeURIComponent(w)}` +
    `&$group=incident_category&$order=n DESC&$limit=60${extra}`;

  const [thisWeek, priorFour] = await Promise.all([
    get(q(where(start, end)).replace(/ /g, "%20")),
    get(q(where(prev, start)).replace(/ /g, "%20")),
  ]);

  const real = (rows) => rows.filter((r) => r.incident_category && !ADMINISTRATIVE.has(r.incident_category));
  const sum  = (rows) => rows.reduce((t, r) => t + Number(r.n || 0), 0);

  const week  = real(thisWeek);
  const total = sum(week);
  if (!total) return null;                       // nothing worth a section

  const priorAvg = Math.round(sum(real(priorFour)) / 4);

  return {
    total,
    priorAvg,
    // Direction only when the change is big enough to mean something. Week to
    // week these counts move by a handful on their own; calling a 5% wobble a
    // rise would be inventing a trend.
    trend: !priorAvg ? null
         : total > priorAvg * 1.15 ? "up"
         : total < priorAvg * 0.85 ? "down"
         : "steady",
    top: week.slice(0, 4).map((r) => ({ category: r.incident_category, count: Number(r.n) })),
    from: start.toISOString().slice(0, 10),
    to:   end.toISOString().slice(0, 10),
    neighborhoods: names,
    // Deep link to the same query a reader can run themselves. The point of a
    // summary is that it is checkable.
    sourceUrl: `https://data.sfgov.org/d/${DATASET}`,
    dashboardUrl: DASHBOARD,
  };
}

module.exports = { fetchBlotter, ADMINISTRATIVE };
