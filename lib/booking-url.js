/**
 * A restaurant's reservations link: accepted only when it is a booking page on
 * one of the services restaurants actually use (November 2026). Anything else
 * — a search-results page we built, a guess, the restaurant's own home page —
 * is dropped, because a "Reservations" button that lands somewhere you cannot
 * book is worse than none. The restaurant's own site is already "Visit website".
 */
"use strict";

const BOOKING_HOSTS = [
  "opentable.com", "resy.com", "exploretock.com", "sevenrooms.com", "yelp.com",
];

function bookingUrl(raw) {
  const s = String(raw || "").trim();
  if (!/^https:\/\/\S+$/i.test(s)) return "";
  let u;
  try { u = new URL(s); } catch { return ""; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const ok = BOOKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!ok) return "";
  // A search page is not a booking page.
  if (/\/s(earch)?\/?$|[?&](term|q|find_desc)=/i.test(u.pathname + u.search)) return "";
  // Yelp only for its reservations pages, not a review page.
  if (host.endsWith("yelp.com") && !/^\/reservations\//i.test(u.pathname)) return "";
  return s;
}

module.exports = { bookingUrl, BOOKING_HOSTS };
