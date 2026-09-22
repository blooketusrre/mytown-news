/**
 * Which Friday an issue belongs to.
 *
 * Extracted from pipeline/generate-issue.js so that scripts/list-editions.js
 * and the watchdog workflow can ask the same question without importing the
 * generator — which exits on load when ANTHROPIC_API_KEY is absent, and which
 * has no business being loaded by a planning step anyway.
 *
 * Two copies of this calculation disagreeing by a day would be a bad failure:
 * the planner would decide an edition still needs publishing while the
 * generator writes a file named for a different Friday, so the skip check
 * would never match and every backstop run would republish everything.
 */

"use strict";

/**
 * The upcoming (or current) Friday, as YYYY-MM-DD in UTC.
 *
 * On a Friday this returns that same day, so a run at 15:00 UTC and a
 * watchdog at 17:30 UTC agree about which issue they are talking about.
 */
function thisWeekDate(now = new Date()) {
  const day = now.getUTCDay();               // 0 = Sunday, 5 = Friday
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const friday = new Date(now);
  friday.setUTCDate(now.getUTCDate() + (daysUntilFriday === 7 ? 0 : daysUntilFriday));
  return friday.toISOString().slice(0, 10);
}

/**
 * A week date as "Sep 18, 2026", for the newsletter masthead.
 *
 * Anchored at UTC noon and formatted in UTC, for the same reason .eleventy.js
 * does it for the site: "2026-09-18" parses as UTC midnight, so formatting it
 * in local time anywhere west of Greenwich renders the 17th. The pipeline runs
 * on a GitHub runner set to UTC, so the naive version is correct by luck
 * rather than by design — and would start printing the wrong date the first
 * time anyone generated an issue from a laptop in California.
 *
 * Short month rather than the site's long one: this is small grey supporting
 * text under the edition name, and "September" crowds it.
 *
 * Returns "" for anything unparseable, so a malformed date shows nothing
 * rather than "Week of Invalid Date".
 *
 */
function formatWeek(iso) {
  const raw = String(iso == null ? "" : iso).trim();
  if (!raw) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00Z`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

module.exports = { thisWeekDate, formatWeek };
