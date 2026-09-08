/**
 * Seven-day forecast, per edition, from the National Weather Service.
 *
 * Source: api.weather.gov. Public domain US government data — no API key, no
 * rate-limit tier to buy, and no commercial restriction.
 *
 * ── Why NWS and not Open-Meteo ────────────────────────────────────────────
 * Open-Meteo is the obvious first hit and is free *for non-commercial use*.
 * My Town News is a commercial publication with an advertising plan, so that
 * free tier does not apply and it would eventually mean a subscription — or,
 * worse, a quiet terms violation nobody notices until it matters. NWS has no
 * such condition, and it covers every US town, which the next fourteen
 * editions will need.
 *
 * The one requirement is a User-Agent identifying the caller with a contact
 * address; NWS asks for this so they can reach an operator whose client is
 * misbehaving. We send the publication's own published address.
 *
 * ── Why per edition and not one citywide forecast ─────────────────────────
 * Brian suggested a single forecast for all fourteen editions since they are
 * all in San Francisco. San Francisco is the one city where that fails: the
 * Mission and the Outer Sunset routinely differ by 10-20°F on the same
 * afternoon — the Mission at 72° in sun while the Outer Sunset sits at 58°
 * under the marine layer, and up to 25° apart in extremes. A citywide number
 * would be wrong for roughly half the editions, and wrong in a way readers
 * would immediately notice, in the section of the paper whose entire claim is
 * that it knows their neighborhood.
 *
 * Each edition already carries lat/lng for the homepage map, so this costs
 * nothing extra, and it works unchanged for Heber City and everywhere after.
 */

"use strict";

const https = require("https");

const CONTACT = process.env.WEATHER_CONTACT || "hello@mytown.news";
const AGENT   = `mytown.news (${CONTACT})`;

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "User-Agent": AGENT, Accept: "application/geo+json" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`NWS ${res.statusCode}: ${data.slice(0, 160)}`));
          }
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("NWS request timed out")));
    req.end();
  });
}

/**
 * Reduce a forecast to one word we can pair with an icon.
 *
 * NWS shortForecast is prose — "Partly Sunny then Slight Chance Rain Showers".
 * Order matters here: anything mentioning rain is rain regardless of what else
 * it says, because that is the part a reader is deciding on.
 */
function condition(shortForecast = "") {
  const t = shortForecast.toLowerCase();
  if (/thunder/.test(t))                    return "storm";
  if (/rain|shower|drizzle/.test(t))        return "rain";
  if (/fog|haze|mist/.test(t))              return "fog";
  if (/cloudy|overcast/.test(t))            return /partly|mostly sunny/.test(t) ? "partly" : "cloudy";
  if (/sun|clear/.test(t))                  return /partly|mostly cloudy/.test(t) ? "partly" : "sunny";
  return "cloudy";
}

/**
 * Seven days of highs, lows and conditions for one point.
 *
 * NWS returns alternating daytime and overnight periods, so a day's high comes
 * from its daytime period and its low from the night that follows. A run
 * starting in the evening gets a night period first, which is why the pairing
 * walks the array rather than assuming it begins with a day.
 *
 * Returns null on any failure. A forecast is a nicety; losing the newsletter
 * over one would not be.
 */
async function fetchForecast(lat, lng, days = 7) {
  const point = await get(`https://api.weather.gov/points/${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`);
  const url = point && point.properties && point.properties.forecast;
  if (!url) throw new Error("NWS returned no forecast URL for that point");

  const forecast = await get(url);
  const periods = (forecast.properties && forecast.properties.periods) || [];
  if (!periods.length) throw new Error("NWS returned no periods");

  const byDate = new Map();
  for (const p of periods) {
    const date = String(p.startTime || "").slice(0, 10);
    if (!date) continue;
    const entry = byDate.get(date) || { date, high: null, low: null, summary: "", condition: null, precip: null };

    if (p.isDaytime) {
      entry.high      = p.temperature;
      entry.summary   = p.shortForecast || entry.summary;
      entry.condition = condition(p.shortForecast);
      const pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
      if (typeof pop === "number") entry.precip = pop;
    } else if (entry.low === null) {
      entry.low = p.temperature;
      // An overnight-only day still needs something to show.
      if (!entry.condition) {
        entry.condition = condition(p.shortForecast);
        entry.summary   = p.shortForecast || entry.summary;
      }
    }
    byDate.set(date, entry);
  }

  // Overnight lows belong to the day that precedes them in a forecast table:
  // "Friday 64/54" means Friday's high and Friday night's low.
  const dates = [...byDate.keys()].sort();
  for (let i = 0; i < dates.length - 1; i++) {
    const day = byDate.get(dates[i]);
    if (day.low === null) day.low = byDate.get(dates[i + 1]).low;
  }

  let out = dates.map((d) => byDate.get(d)).filter((d) => d.high !== null || d.low !== null);

  // A run that starts after dark gets an overnight period first, which yields a
  // leading "day" with a low and no high. Publishing that renders as "—/54"
  // and reads like a bug. The weekly job runs at 08:00 Pacific so this should
  // not arise, but a delayed or manual run at the wrong hour would hit it.
  while (out.length && out[0].high === null) out.shift();

  out = out.slice(0, days);

  return out.length ? out : null;
}

module.exports = { fetchForecast, condition };
