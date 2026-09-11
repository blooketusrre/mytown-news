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

module.exports = { thisWeekDate };
