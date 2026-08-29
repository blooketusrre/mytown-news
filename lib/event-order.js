/**
 * Put events in the order a reader expects: soonest first, ongoing last.
 *
 * The pipeline returns events in whatever order the research happened to
 * produce, which is roughly the order sources were read. On the page that
 * looked arbitrary — a Saturday concert above a Thursday council meeting,
 * an ongoing exhibition in the middle of the week.
 *
 * Shared by the site and the newsletter so the two orderings cannot diverge.
 *
 * ── Dates ────────────────────────────────────────────────────────────────
 * `startDate` (ISO) is the field to trust and the pipeline now asks for it.
 * Issues published before that change only carry the display string — "Friday,
 * August 7" — so there is a fallback parser. It needs a reference year, since
 * "August 7" in an issue dated 2026-01-02 means the August that has not
 * happened yet, not the one seven months ago.
 */

"use strict";

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** True for events with no single start — exhibitions, residencies, markets. */
function isOngoing(ev) {
  if (!ev) return false;
  if (ev.ongoing === true) return true;
  const d = String(ev.date || "").trim().toLowerCase();
  return d === "ongoing" || d.startsWith("through") || d.startsWith("until");
}

/**
 * Milliseconds for sorting, or null when the date cannot be read.
 * @param {object} ev        the event
 * @param {string} weekOf    the issue's ISO date, used to infer the year
 */
function eventTime(ev, weekOf) {
  if (!ev) return null;

  if (ev.startDate) {
    const t = Date.parse(`${ev.startDate}T00:00:00Z`);
    if (!Number.isNaN(t)) return t;
  }

  const text = String(ev.date || "").trim();
  if (!text) return null;

  // "Friday, August 7" / "August 7" / "Aug 7, 2026" / "Sat Aug 7"
  const m = text.match(/([A-Za-z]+)\s+(\d{1,2})(?:\s*,\s*(\d{4}))?/);
  if (!m) return null;

  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  const day = Number(m[2]);

  if (m[3]) return Date.UTC(Number(m[3]), month, day);

  // No year given. Anchor to the issue week, and if that lands more than six
  // months in the past assume the event belongs to the following year — which
  // is what "January 4" means in an issue published in late December.
  const ref = weekOf ? new Date(`${weekOf}T00:00:00Z`) : new Date();
  let year = ref.getUTCFullYear();
  let t = Date.UTC(year, month, day);
  if (t < ref.getTime() - 183 * 864e5) t = Date.UTC(year + 1, month, day);
  return t;
}

/**
 * Sorted copy: dated events soonest first, then ongoing, then anything whose
 * date could not be read. Unreadable dates go last rather than being dropped —
 * a reader can still judge a listing we failed to parse, and silently hiding
 * events is how a venue stops trusting the listing.
 */
function sortEvents(events, weekOf) {
  const list = Array.isArray(events) ? events.slice() : [];
  return list
    .map((ev, i) => ({
      ev,
      i,                                    // keeps the sort stable
      bucket: isOngoing(ev) ? 1 : (eventTime(ev, weekOf) === null ? 2 : 0),
      t: eventTime(ev, weekOf),
    }))
    .sort((a, b) =>
      a.bucket !== b.bucket ? a.bucket - b.bucket
      : a.bucket === 0      ? (a.t - b.t) || (a.i - b.i)
      :                       a.i - b.i
    )
    .map((x) => x.ev);
}

module.exports = { sortEvents, eventTime, isOngoing };
