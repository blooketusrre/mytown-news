#!/usr/bin/env node
/**
 * My Town News — Weekly Issue Generator
 *
 * Usage:
 *   node pipeline/generate-issue.js                  # all live clusters
 *   node pipeline/generate-issue.js --cluster north-waterfront
 *   node pipeline/generate-issue.js --dry-run        # rehearse, send nothing
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 *
 * Optional env vars:
 *   BUTTONDOWN_API_KEY   — omit to generate content without sending
 *   DRY_RUN=true         — same as --dry-run
 *
 * ── About dry runs ────────────────────────────────────────────────────────
 * A dry run is a full rehearsal: it researches, generates, validates and
 * renders the newsletter HTML exactly as a live run would, then stops short
 * of the one irreversible step — the POST to Buttondown that puts mail in
 * subscribers' inboxes.
 *
 * Two things make it safe to run at any time:
 *
 *   1. Output is diverted to pipeline/dry-run/ instead of src/content/, so a
 *      rehearsal cannot be mistaken for the real issue by Thursday's job, by
 *      the site build, or by git.
 *   2. Every Buttondown call it makes is read-only. The tag lookup still
 *      runs, because a missing tag is a real failure worth rehearsing. The
 *      send does not.
 *
 * It still spends Anthropic credits and still performs live web searches —
 * "dry" refers to delivery, not to effort.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");
const { editionPath } = require("../lib/edition-path");
const { sortEvents } = require("../lib/event-order");

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const clusterArg = (() => {
  const idx = args.indexOf("--cluster");
  return idx !== -1 ? args[idx + 1] : null;
})();

// Accepts the flag or the env var, because the flag is what a human types and
// the env var is what GitHub Actions can pass from a workflow_dispatch input.
// Only explicit affirmatives count: an unset input arrives as "" on scheduled
// runs, and the default for anything unrecognised must be "this is live".
// The directory is regenerated quarterly, not weekly (see generate-directory.js).
// Default behaviour is decided by the data rather than by a flag: if the
// previous issue has a directory, carry it forward; if it does not — a town
// launching, or a first issue — generate one so the edition is never published
// with an empty Directory section. A flag the weekly workflow could forget to
// pass would fail in exactly that case.
const FORCE_DIRECTORY = args.includes("--force-directory");
const NO_DIRECTORY    = args.includes("--no-directory");

const DRY_RUN = (() => {
  if (args.includes("--dry-run")) return true;
  const v = String(process.env.DRY_RUN || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
})();

// ─── Config ────────────────────────────────────────────────────────────────
const ROOT            = path.resolve(__dirname, "..");
// Single source of truth for edition definitions. The site reads this file
// too — it used to be duplicated in pipeline/clusters/*.json with different
// key names, which is how the newsletter and the web page could disagree.
const CLUSTERS_FILE   = path.join(ROOT, "src", "_data", "clusters.json");
const CONTENT_DIR     = path.join(ROOT, "src", "content");
// Rehearsal output lives outside src/ so Eleventy never sees it, git ignores
// it, and a dry run can never satisfy the "already generated this week" check
// that would cause Thursday's real run to skip an edition.
const DRY_RUN_DIR     = path.join(ROOT, "pipeline", "dry-run");
/** Where this run writes an edition's JSON. */
function outDirFor(slug) {
  return path.join(DRY_RUN ? DRY_RUN_DIR : CONTENT_DIR, slug);
}

// ── Time budgets ───────────────────────────────────────────────────────────
// GitHub cancels a job at 60 minutes with no warning and no notification —
// which is exactly what happened on 2026-08-28. These budgets sit below that
// ceiling so an approaching timeout announces itself as a red run while there
// is still headroom, rather than as a week with no newsletter.
//
// Per edition rather than only overall, because with the matrix split each
// job runs a single edition and the total is no longer the meaningful number.
const STARTED_AT         = Date.now();
const EDITION_BUDGET_MIN = Number(process.env.EDITION_TIME_BUDGET_MIN || 12);
const TOTAL_BUDGET_MIN   = Number(process.env.TOTAL_TIME_BUDGET_MIN || 40);
const timeWarnings       = [];

const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const BUTTONDOWN_KEY  = process.env.BUTTONDOWN_API_KEY;
const SITE_URL        = "https://mytown.news";
const MODEL           = "claude-sonnet-4-6";

if (!ANTHROPIC_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }

// ─── Helpers ───────────────────────────────────────────────────────────────

/** ISO date string for this Friday (or today if Friday) — used as filename */
function thisWeekDate() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sun, 5 = Fri
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const friday = new Date(now);
  friday.setUTCDate(now.getUTCDate() + (daysUntilFriday === 7 ? 0 : daysUntilFriday));
  return friday.toISOString().slice(0, 10);
}

/** Anthropic Messages API call. Takes a full messages array so the caller can
 *  continue a paused turn (see generateCluster). */
async function callClaude(systemPrompt, messages, tools = []) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 24000,
    system: systemPrompt,
    messages: Array.isArray(messages)
      ? messages
      : [{ role: "user", content: messages }],
    ...(tools.length ? { tools } : {}),
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Research prompt ────────────────────────────────────────────────────────

/* wording-check: off
   This block has to quote the banned phrasing in order to ban it, so the
   wording guard in scripts/verify-build.js skips everything between these
   two sentinels. Keep the exemption this small. */
const VOCABULARY_RULE = `
VOCABULARY:

Never use the word "cluster" to describe this edition or its coverage area.
It is our internal term for a group of neighborhoods and means nothing to a
reader. Phrases like "the Marina cluster", "this cluster", and "the Bayview
and Excelsior cluster" have all appeared in published issues, and all read as
jargon. Write "the Marina and Pacific Heights area", "these neighborhoods",
or simply name the neighborhood instead.

("Cluster" in its ordinary English sense is fine — "a cluster of galleries",
"the clustering of data centers". The ban is on using it as a label for one
of our own coverage areas.)`;
/* wording-check: on */

function buildSystemPrompt(cluster, prevIssue, closedVenues, opts = {}) {
  const today = new Date().toISOString().slice(0, 10);

  // Show the model what ran last week so it can avoid repeating the lead.
  // The deterministic rotation after generation is the real guarantee; this
  // just improves the odds we never need it.
  let lastWeekBlock = "";
  const prevStories = (prevIssue && prevIssue.topStories) || [];
  if (prevStories.length) {
    const lines = prevStories.map((s, i) =>
      `  ${i === 0 ? "LEAD" : "    "} — ${s.headline}${s.sourceUrl ? ` (${s.sourceUrl})` : ""}`
    ).join("\n");
    lastWeekBlock = `

LAST WEEK'S ISSUE (week of ${prevIssue.weekOf || "previous"}):
${lines}

CONTINUITY RULE — IMPORTANT:
Do not lead this week's issue with a story that led last week. Readers who
opened both issues should see something new in the widest column. If a story
above is still developing and still within the ten-day window, you may carry
it — place it lower in topStories, or in moreNews, and write it forward:
report what has changed since last week rather than restating the original
news. If genuinely nothing has changed, omit it.`;
  }

  // Naming the known-closed venues explicitly is cheaper and far more reliable
  // than hoping a fresh search rediscovers a closure that happened years ago.
  let closedBlock = "";
  if (closedVenues && closedVenues.length) {
    closedBlock = `

PERMANENTLY CLOSED — DO NOT LIST THESE, EVER:
${closedVenues.map(v => `  - ${v.name}${v.closed ? ` (closed ${v.closed})` : ""}`).join("\n")}

These have been verified closed. Their websites may still resolve or redirect
somewhere that looks active. Do not include them in the directory, and do not
present them as operating in a story or event.`;
  }

  // Where to look. These have sat unused in clusters.json since launch — the
  // prompt never read them, so every edition was researched from a blank
  // slate. Harmless in San Francisco, where a general search finds the SF
  // Standard and SFist unprompted. Not harmless in a town whose newspaper
  // closed: there, naming the council agenda portal, the school district and
  // the theater listings is the difference between an issue and an empty page.
  let sourceBlock = "";
  const hints = cluster.sourceHints || [];
  const terms = cluster.primarySearchTerms || [];
  if (hints.length || terms.length) {
    sourceBlock = `

WHERE TO LOOK:
${terms.length ? `
Search terms that identify this area:
${terms.map((t) => `  - ${t}`).join("\n")}` : ""}
${hints.length ? `
Sources worth checking directly. Not an exhaustive list and not a
restriction — search freely — but these are the primary records for this
area and are often the only place a story exists at all:
${hints.map((h) => `  - ${h}`).join("\n")}` : ""}

In a town that has lost its newspaper there may be no article to summarise.
The story is then in the primary record itself: what the council actually
voted on, what the police blotter shows, what the school board approved,
what is opening or closing on Main Street. Report from the document. Say
plainly where it came from and when the meeting or filing happened.

Never pad. Three real stories are a good week; one real story and two
inventions is a dead publication. If a week is genuinely quiet, say so in
fewer stories rather than manufacturing volume.`;
  }

  const wantNews = opts.includeNews !== false;
  const wantDir  = opts.includeDirectory !== false;

  // ── The directory is expensive and barely changes ──────────────────────
  // Five directory sections at 15–30 entries each dominate both the research
  // and the output of a run, and a restaurant's address is the same in
  // October as it was in September. Weekly runs now carry last week's
  // directory forward and ask only for news; a separate quarterly job asks
  // only for the directory. Composing the prompt from named blocks is what
  // lets one function serve both without a second copy drifting from this one.
  const blocks = [];

  blocks.push(`You are the research editor for My Town News, a hyperlocal weekly newspaper covering San Francisco neighborhoods.

Today is ${today}. You are preparing the ${wantNews && wantDir ? "issue" : wantNews ? "issue" : "business directory"} for the week of ${thisWeekDate()}.

Your edition: ${cluster.name}
Neighborhoods: ${cluster.neighborhoods.join(", ")}${sourceBlock}${wantNews ? lastWeekBlock : ""}${closedBlock}
${VOCABULARY_RULE}
`);

  // Only the directory needs the closure-verification discipline, and it is
  // the single longest block in the prompt.
  if (wantDir) blocks.push(DIRECTORY_VERIFICATION_RULE);

  blocks.push(EDITORIAL_RULES);

  blocks.push(`CONTENT STRUCTURE (return as JSON only — no markdown wrapper):
{
  "clusterSlug": "${cluster.slug}",
  "clusterName": "${cluster.name}",
  "weekOf": "${thisWeekDate()}",
`);

  if (wantNews) blocks.push(NEWS_SCHEMA);
  if (wantDir)  blocks.push(DIRECTORY_SCHEMA);

  blocks.push(`  "sources": [
    { "title": "...", "url": "...", "publication": "..." }
  ]
}
`);

  if (wantDir)  blocks.push(DIRECTORY_GUIDANCE);
  if (wantNews) blocks.push(BRIEFS_RULE);

  const targets = ["QUANTITY TARGETS:"];
  if (wantNews) targets.push(
    "- topStories: 3 (minimum 1 if it's a slow news week — never fabricate to fill)",
    "- events: 4–8 (upcoming or ongoing within ~3 weeks)",
    "- moreNews: 0–4 briefs (see BRIEFS below — fewer is fine, invented is not)");
  if (wantDir) targets.push(
    "- restaurants: 15–30 (comprehensive coverage — every notable café, restaurant, bar, and bakery in these neighborhoods)",
    "- hotels: 5–15 (all hotels and inns in these neighborhoods)",
    "- shops: 10–20 (notable independent shops, bookstores, specialty stores, services)",
    "- artEntertainment: 8–15 (galleries, theaters, music venues, cinemas, museums)",
    "- gymsRecreation: 8–15 (gyms, yoga studios, sports courts, pools, notable parks)");
  targets.push("- sources: deduplicated list of every source referenced above");
  blocks.push(targets.join("\n") + "\n");

  blocks.push(`CRITICAL: Your response must be ONLY the raw JSON object — nothing else. Do not write any introduction, explanation, or commentary. Do not say "I'll research" or "Here is the issue." Begin your response with { and end with }. No markdown fences.`);

  return blocks.join("\n");
}

// ── Prompt blocks, composed above ────────────────────────────────────────
// Named rather than inline so the weekly (news) and quarterly (directory) runs
// draw from exactly the same text. Two copies would drift, and the copy that
// drifts is the one nobody reads.

const DIRECTORY_VERIFICATION_RULE = `DIRECTORY VERIFICATION RULE — NON-NEGOTIABLE:

Do not only look for evidence a venue is open. A closed restaurant often keeps
a live website, a domain that redirects elsewhere, and years of old reviews —
all of which look like evidence of life. You must actively look for evidence it
has CLOSED, and treat that evidence as decisive.

For every venue you intend to list:

1. SEARCH FOR CLOSURE FIRST. Run a search along the lines of
   "<venue name> <city> closed" or "<venue name> permanently closed".
   Local outlets report closures reliably. If any credible outlet reports the
   venue closed, OMIT IT — regardless of what its website shows.

2. TREAT THESE AS EVIDENCE OF CLOSURE, not of operation:
   - the website redirects to a different domain, especially a personal name,
     a restaurant group, or an unrelated business
   - the domain is parked, for sale, or shows a hosting placeholder
   - the most recent social media post is more than 12 months old
   - a listing is labelled "Permanently closed" or "Temporarily closed"
   - recent reviews describe it as closed, even if the listing is still up

3. ONLY THEN confirm operation, with a DATED signal from the last 12 months:
   a recent review, a recent social post, current hours, or press coverage
   that refers to it as currently operating. "The website loads" is not a
   dated signal and is not sufficient on its own.

4. WHEN IN DOUBT, LEAVE IT OUT. A shorter directory that is entirely accurate
   is worth far more than a longer one containing a restaurant that closed two
   years ago. Readers who act on a wrong listing stop trusting every listing.

`;

const EDITORIAL_RULES = `EDITORIAL RULES — NON-NEGOTIABLE:
1. Every factual claim must be traceable to a real, verifiable public source (city agency, established news outlet, neighborhood association, business website, library/cultural calendar, official press release).
2. Do NOT invent quotes. If a quote appears, it must come from a verifiable published statement — include the exact source URL.
3. Named individuals appear only in their publicly documented roles (officials, business owners, published authors). No private individuals unless they have given a public statement.
4. Do NOT fabricate events, dates, business names, or addresses.
5. If a story cannot be verified, omit it entirely. A shorter issue with real news beats a longer issue with invented content.
6. Search the web for current news. Only include stories published within the last 10 days. Do not include events or news that occurred more than 10 days ago (e.g., no July 4th stories if today is July 14 or later).
7. Order events soonest first, then ongoing or through-date events. lib/event-order.js re-sorts deterministically after generation, so this is a preference rather than a guarantee — but returning them in order makes the result easier to check by eye.

`;

const NEWS_SCHEMA = `  "topStories": [
    {
      "headline": "...",
      "dek": "One-sentence summary.",
      "body": "3–5 paragraph story. No invented quotes. Factual, news-style.",
      "sourceUrl": "https://...",
      "sourceName": "Publication or Agency Name",
      "tags": ["tag1", "tag2"]
    }
  ],
  "events": [
    {
      "title": "...",
      "startDate": "YYYY-MM-DD",  // omit only for genuinely ongoing events
      "date": "Day, Month D" or "Ongoing" or "Through Month D",
      "time": "H:MM AM/PM" or "Various times" or "",
      "location": "Venue name, address or neighborhood",
      "description": "1–2 sentences.",
      "sourceUrl": "https://...",
      "sourceName": "..."
    }
  ],
  "moreNews": [
    {
      "headline": "...",
      "body": "1–2 paragraph brief.",
      "sourceUrl": "https://...",
      "sourceName": "...",
      "tags": ["tag1"]
    }
  ],
`;

const DIRECTORY_SCHEMA = `  "directory": {
    "restaurants": [
      {
        "name": "...",
        "cuisineGroup": "Italian & Deli",
        "type": "Italian delicatessen",
        "description": "One sentence about this place.",
        "address": "373 Columbus Ave",
        "phone": "415-421-2337",
        "website": "https://...",
        "neighborhood": "North Beach",
        "notable": "Landmark"
      }
    ],
    "hotels": [
      {
        "name": "...",
        "type": "Boutique hotel",
        "description": "One sentence about this hotel.",
        "address": "...",
        "phone": "...",
        "website": "https://...",
        "neighborhood": "...",
        "notable": ""
      }
    ],
    "shops": [
      {
        "name": "...",
        "shopGroup": "Books & Literature",
        "type": "Independent bookstore",
        "description": "One sentence about this shop.",
        "address": "...",
        "phone": "...",
        "website": "https://...",
        "neighborhood": "...",
        "notable": "Landmark"
      }
    ],
    "artEntertainment": [
      {
        "name": "...",
        "venueGroup": "Art Galleries",
        "type": "Contemporary art gallery",
        "description": "One sentence about this venue.",
        "address": "...",
        "phone": "...",
        "website": "https://...",
        "neighborhood": "...",
        "notable": ""
      }
    ],
    "gymsRecreation": [
      {
        "name": "...",
        "venueGroup": "Yoga & Pilates",
        "type": "Yoga studio",
        "description": "One sentence about this venue.",
        "address": "...",
        "phone": "...",
        "website": "https://...",
        "neighborhood": "...",
        "notable": ""
      }
    ]
  },
`;

const DIRECTORY_GUIDANCE = `DIRECTORY GROUPING GUIDANCE:
- cuisineGroup options: "Coffee & Cafés", "Italian & Deli", "Seafood & American", "Asian", "Mexican & Latin American", "Mediterranean & Middle Eastern", "Brunch & Breakfast", "Pizza & Sandwiches", "Bars & Wine Bars", "Bakeries & Desserts", "Vegetarian & Vegan", "Other"
- shopGroup options: "Books & Literature", "Fashion & Clothing", "Home & Gifts", "Specialty Food & Wine", "Beauty & Wellness", "Art Supplies & Hobby", "Hardware & Services", "Other"
- venueGroup (art): "Art Galleries", "Theater & Comedy", "Music Venues", "Cinema", "Museums & Cultural"
- venueGroup (gyms): "Yoga & Pilates", "Gyms & CrossFit", "Sports & Courts", "Cycling & Rowing", "Martial Arts", "Pools & Aquatics", "Parks & Outdoor Recreation"
- notable field: "Landmark" for long-established institutions, "New" for opened in the last year, or "" for standard listings

`;

const BRIEFS_RULE = `BRIEFS (the moreNews section):

This section carries the smaller items: a business opening or closing, a
council designation, a project reaching completion, a grant awarded, a road
closure. In a place that has lost its newspaper these will often come from
primary sources rather than news outlets — a city or county website, a
meeting agenda, a school district notice, a chamber newsletter. That is
legitimate and expected. Reporting from the record is the job here.

Two requirements, both about honesty rather than recency:

1. STATE WHEN. Every brief must say plainly when the thing happened or will
   happen — "opened in May", "approved at the 12 August council meeting",
   "scheduled for completion this month". A reader must never have to guess
   whether an item is from this week or last spring. An older item is
   welcome; an undated one is not.

2. DO NOT INVENT AND DO NOT REPEAT. A brief must not restate a story
   already in topStories, and must not be padding assembled to reach a
   count. Returning one brief, or none, is a correct answer in a quiet week.
   An empty section is honest; a manufactured one is not.

`;

/** Extract JSON from Claude response (handles tool-use turns and plain text) */
function extractJson(response) {
  const blocks = response.content || [];
  const textBlocks = blocks.filter(b => b.type === "text");

  // Scan from last text block backwards — the final JSON output comes last,
  // after any "I'll research..." preamble or tool-use blocks.
  for (const block of [...textBlocks].reverse()) {
    const text = block.text.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    // Find a JSON object anywhere in this block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        // not valid JSON, try the next block
      }
    }
  }
  throw new Error("No JSON found in Claude response");
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateIssue(issue) {
  const errors = [];
  if (!issue.topStories || issue.topStories.length === 0)
    errors.push("topStories is empty");
  for (const s of issue.topStories || []) {
    if (!s.sourceUrl || !s.sourceUrl.startsWith("http"))
      errors.push(`topStory "${s.headline}" missing valid sourceUrl`);
    if (!s.headline) errors.push("topStory missing headline");
  }
  for (const e of issue.events || []) {
    if (!e.title) errors.push("event missing title");
  }
  for (const s of issue.sources || []) {
    if (!s.url || !s.url.startsWith("http"))
      errors.push(`source "${s.title}" has invalid url`);
  }
  return errors;
}

// ─── Main per-cluster generator ──────────────────────────────────────────────

/** Venues confirmed closed. The model re-proposes them week after week --
 *  Birch & Rye appeared in two consecutive issues -- so a prompt instruction
 *  alone is not enough. This list is injected into the prompt AND enforced
 *  after generation. */
const CLOSED_VENUES = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "closed-venues.json"), "utf8"));
  } catch (e) {
    console.warn("  ⚠ Could not read closed-venues.json:", e.message);
    return [];
  }
})();

/** Loose name key: case, punctuation, ampersands and a leading "the" all vary
 *  between sources, and none of them change which restaurant is meant. */
function venueKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/^the /, "")
    .replace(/\s+/g, " ")
    .trim();
}

function closedVenuesFor(clusterSlug) {
  return CLOSED_VENUES.filter(v => !v.cluster || v.cluster === clusterSlug);
}

/** Remove any directory entry naming a known-closed venue. Returns what it
 *  removed so the run can say so out loud rather than silently correcting. */
function stripClosedVenues(issue, clusterSlug) {
  const closed = closedVenuesFor(clusterSlug);
  if (!closed.length || !issue.directory) return [];
  const keys = new Map(closed.map(v => [venueKey(v.name), v]));
  const removed = [];
  for (const [category, entries] of Object.entries(issue.directory)) {
    if (!Array.isArray(entries)) continue;
    issue.directory[category] = entries.filter(e => {
      const hit = keys.get(venueKey(e && e.name));
      if (hit) removed.push({ name: e.name, category, closed: hit.closed });
      return !hit;
    });
  }
  return removed;
}

/** Normalised identity for a story, used to spot the same item recurring
 *  week to week. Source URL is the strong signal; the headline is a fallback
 *  for when an outlet changes its URL or we picked up the story elsewhere. */
// ─── Manual directory additions ──────────────────────────────────────────────

const ADDED_VENUES = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "added-venues.json"), "utf8"));
  } catch (e) {
    console.warn("  ⚠ Could not read added-venues.json:", e.message);
    return {};
  }
})();

/**
 * Merge hand-listed venues into a directory.
 *
 * The mirror of stripClosedVenues. That removes places the research wrongly
 * lists; this adds places it cannot find — usually because they have not
 * opened, so nothing exists written in the present tense and a search returns
 * a plan rather than a restaurant.
 *
 * Deterministic and free: no API call, no directory regeneration. It runs on
 * every weekly issue, so an addition appears the next Friday rather than
 * waiting up to a quarter for the refresh.
 *
 * `openingFrom` carries the interesting behaviour. Before that date the venue
 * is listed as Coming Soon; on or after it, as New. An opening can therefore
 * be queued weeks ahead and flips itself on the day, with no second edit and
 * no window in which something is described as open before it is.
 */
function addPendingVenues(issue, clusterSlug, today = new Date()) {
  const entries = ADDED_VENUES[clusterSlug];
  if (!Array.isArray(entries) || !entries.length) return { added: [], skipped: [], stale: [] };

  issue.directory = issue.directory || {};
  const added = [], skipped = [], stale = [];

  entries.forEach((entry) => {
    const section = entry.section;
    if (!section) return;
    const list = (issue.directory[section] = issue.directory[section] || []);

    // Once the quarterly refresh finds it, the hand-written copy is redundant —
    // and two entries for one restaurant is worse than none.
    if (list.some((v) => venueKey(v.name) === venueKey(entry.name))) {
      skipped.push(entry.name);
      return;
    }

    // With a date, the entry flips itself on the day. Without one, an explicit
    // "Coming Soon" stays Coming Soon until someone edits it — a venue whose
    // opening date is genuinely unknown must not be described as open because
    // no date was supplied.
    const opens  = entry.openingFrom ? new Date(`${entry.openingFrom}T00:00:00Z`) : null;
    const isOpen = opens ? today >= opens : entry.notable !== "Coming Soon";

    const venue = { ...entry };
    delete venue.section;
    delete venue.openingFrom;
    Object.keys(venue).forEach((k) => { if (k.startsWith("_")) delete venue[k]; });
    // Once open, "Coming Soon" must not survive as the entry's own notable —
    // that is the pre-opening state, not a preference to preserve. Any other
    // label the entry carries (typically "Landmark") is kept.
    venue.notable = !isOpen ? "Coming Soon"
                  : (entry.notable && entry.notable !== "Coming Soon") ? entry.notable
                  : "New";

    list.push(venue);
    added.push(`${entry.name}${isOpen ? "" : " (Coming Soon)"}`);

    // If we are still hand-listing a place six months after it opened, the
    // research is failing to find something that plainly exists, and that is
    // worth knowing rather than papering over indefinitely.
    if (opens && today - opens > 180 * 864e5) stale.push(entry.name);
  });

  return { added, skipped, stale };
}

function storyKeys(story) {
  const keys = [];
  if (story.sourceUrl) {
    keys.push(String(story.sourceUrl).trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, ""));
  }
  if (story.headline) {
    keys.push("h:" + String(story.headline).toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim());
  }
  return keys;
}

/**
 * Drop briefs that repeat a top story, and flag briefs that never say when.
 *
 * The prompt asks for both, and the prompt is a request. This is the pass
 * that holds — the same shape as the closed-venue strip and the lead
 * rotation, for the same reason: the 4 September Heber rehearsal produced
 * four solid stories and then three briefs assembled to fill the section.
 *
 * Undated items are reported, not removed. An older item is welcome — in a
 * town with no paper, a restaurant that opened in May may genuinely be news
 * to a reader — but it has to say so. Removing it would throw away exactly
 * the primary-source reporting this publication exists to do.
 */
function tidyBriefs(issue) {
  const briefs = issue.moreNews;
  if (!Array.isArray(briefs) || !briefs.length) return { dropped: [], undated: [] };

  const topKeys = new Set();
  (issue.topStories || []).forEach((st) => storyKeys(st).forEach((k) => topKeys.add(k)));

  const dropped = [];
  const undated = [];
  const kept = [];

  // Any of: a month name, an ISO date, "this week/month", "last spring", a
  // year, or an ordinal date. Deliberately generous — the check is for
  // "does this locate itself in time at all", not for a date format.
  const DATED = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b20\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\b(this|last|next)\s+(week|month|year|spring|summer|fall|autumn|winter)\b|\b(today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

  briefs.forEach((b) => {
    const keys = storyKeys(b);
    if (keys.some((k) => topKeys.has(k))) {
      dropped.push(b.headline || "(untitled)");
      return;
    }
    kept.push(b);
    const text = `${b.headline || ""} ${b.dek || ""} ${b.body || ""}`;
    if (!DATED.test(text)) undated.push(b.headline || "(untitled)");
  });

  issue.moreNews = kept;
  return { dropped, undated };
}

/** Load the most recent previous issue for a cluster, excluding this week's. */
function loadPreviousIssue(clusterSlug, currentWeek) {
  const dir = path.join(CONTENT_DIR, clusterSlug);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".json") && f !== `${currentWeek}.json`)
    .sort();
  if (!files.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8"));
  } catch (e) {
    return null;
  }
}

/** If this week leads with a story that led last week, promote the first
 *  genuinely new story above it. The repeat is kept — it may still be inside
 *  the ten-day window and worth carrying — just not in the widest column two
 *  weeks running, which reads as though nothing happened. */
function rotateRepeatedLead(issue, prevIssue) {
  const stories = issue.topStories || [];
  if (!prevIssue || stories.length < 2) return null;

  const prevLead = (prevIssue.topStories || [])[0];
  if (!prevLead) return null;

  const prevKeys = new Set(storyKeys(prevLead));
  const isRepeat = s => storyKeys(s).some(k => prevKeys.has(k));

  if (!isRepeat(stories[0])) return null;

  const freshIdx = stories.findIndex((s, i) => i > 0 && !isRepeat(s));
  if (freshIdx === -1) return null; // everything is a repeat — leave it alone

  const [fresh] = stories.splice(freshIdx, 1);
  stories.unshift(fresh);
  return { demoted: prevLead.headline, promoted: fresh.headline };
}

async function generateCluster(clusterConfig) {
  console.log(`\n📰 Generating: ${clusterConfig.name}`);
  const weekDate = thisWeekDate();
  const outDir   = outDirFor(clusterConfig.slug);
  const outFile  = path.join(outDir, `${weekDate}.json`);

  // Skip if already generated today. In a dry run this checks the rehearsal
  // path, not src/content — otherwise a rehearsal held after the real run
  // would silently do nothing and look like a pass.
  if (fs.existsSync(outFile)) {
    console.log(`  ✓ Already exists: ${outFile}`);
    return;
  }
  if (DRY_RUN && fs.existsSync(path.join(CONTENT_DIR, clusterConfig.slug, `${weekDate}.json`))) {
    console.log(`  ℹ A real issue for ${weekDate} already exists — rehearsing alongside it, not touching it.`);
  }

  const prevIssue = loadPreviousIssue(clusterConfig.slug, weekDate);

  // ── 1. Research with Claude (web search enabled) ────────────────────────
  console.log("  🔍 Researching current news…");
  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
  };

  // ── Directory: carry forward, or generate if there is nothing to carry ──
  // Five sections of 15–30 venues each dominated every weekly run's research
  // and output, to re-derive addresses that had not changed. A quarterly job
  // refreshes them; the weekly one copies the last answer and merges any
  // hand-listed additions.
  const carried = (prevIssue && prevIssue.directory
                   && Object.keys(prevIssue.directory).length) ? prevIssue.directory : null;
  const includeDirectory = FORCE_DIRECTORY ? true
                         : NO_DIRECTORY    ? false
                         : !carried;
  if (includeDirectory && !FORCE_DIRECTORY) {
    console.log("  ℹ No directory to carry forward — generating one this run.");
  } else if (!includeDirectory) {
    const n = Object.values(carried).reduce((t, v) => t + (Array.isArray(v) ? v.length : 0), 0);
    console.log(`  ↻ Carrying forward the directory from ${prevIssue.weekOf} (${n} venues) — not regenerating.`);
  }

  const closedVenues = closedVenuesFor(clusterConfig.slug);
  const systemPrompt = buildSystemPrompt(clusterConfig, prevIssue, closedVenues,
                                         { includeDirectory });
  const userMessage  = `Please research and write this week's My Town News issue for ${clusterConfig.name} (${clusterConfig.neighborhoods.join(", ")}). Search for real, current news stories and upcoming events in these neighborhoods. Return only valid JSON matching the schema in your instructions.`;

  // The server-side web_search tool runs the research loop inside the API, but
  // a long research turn can come back with stop_reason "pause_turn" — the
  // model has more to do and expects us to hand its own output back so it can
  // continue. Treating that single response as final is why three clusters
  // failed on 2026-08-21 with "No JSON found": the turn had paused mid-search
  // and the final JSON had not been written yet.
  const MAX_TURNS = 6;
  let messages = [{ role: "user", content: userMessage }];
  let response;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    try {
      response = await callClaude(systemPrompt, messages, [webSearchTool]);
    } catch (err) {
      console.error(`  ✗ Claude API error: ${err.message}`);
      throw err;
    }

    if (response.stop_reason === "max_tokens") {
      console.error("  ✗ Response cut off — hit max_tokens limit. Increase max_tokens.");
      break;
    }

    if (response.stop_reason !== "pause_turn") break;

    console.log(`  ⏸ Turn paused mid-research — continuing (${turn}/${MAX_TURNS})…`);
    messages = messages.concat([{ role: "assistant", content: response.content }]);

    if (turn === MAX_TURNS) {
      console.error(`  ✗ Still paused after ${MAX_TURNS} turns — giving up.`);
    }
  }

  let issue;
  try {
    issue = extractJson(response);
  } catch (err) {
    // The research happened but the JSON never got written — the turn ended
    // (stop_reason "end_turn") after the search phase consumed the budget.
    // Civic Center & Hayes Valley hits this repeatedly: at six neighbourhoods
    // it has the widest scope of any edition and does the most searching.
    //
    // The findings are already in the conversation, so ask for the JSON on its
    // own turn — with no tools attached, so it cannot start searching again and
    // must serialise what it already has.
    console.warn(`  ⚠ No JSON in first response (stop_reason: ${response.stop_reason || "unknown"}) — asking for it directly…`);

    const salvageMessages = messages.concat([
      { role: "assistant", content: response.content },
      {
        role: "user",
        content:
          "Return the issue as a single JSON object matching the schema in your " +
          "instructions. Output only the JSON — no preamble, no explanation, no " +
          "markdown fences. Do not search again; use only what you have already found. " +
          "If a section has no verifiable content, return an empty array for it.",
      },
    ]);

    try {
      // The tool must still be declared. This conversation contains
      // server_tool_use and web_search_tool_result blocks, and the API
      // rejects a request whose history references a tool the request does
      // not define. Calling this with no tools — as it did until 2026-08-29 —
      // made every salvage attempt fail on a malformed request rather than on
      // anything to do with the content. The instruction not to search again
      // is in the message; declaring the tool does not oblige it to be used.
      const salvage = await callClaude(systemPrompt, salvageMessages, [webSearchTool]);
      issue = extractJson(salvage);
      console.log("  ✅ Recovered JSON on follow-up turn.");
    } catch (err2) {
      // Report why the salvage failed, not only why the first attempt did.
      // This used to `throw err` and never print err2, so a broken salvage
      // was indistinguishable from a model that simply would not answer —
      // which is precisely the confusion that hid the missing-tool bug.
      console.error(`  ✗ First attempt: no JSON (stop_reason: ${response.stop_reason || "unknown"})`);
      console.error(`  ✗ Salvage attempt also failed: ${err2.message}`);
      const blocks = (response.content || []).map((b) => b.type);
      console.error(`     first-attempt block types: ${blocks.join(", ") || "(none)"}`);
      const texts = (response.content || []).filter((b) => b.type === "text");
      if (texts.length) {
        console.error(`     last text block began: ${String(texts[texts.length - 1].text).slice(0, 300)}`);
      } else {
        console.error("     the model returned no text block at all — it ended its turn after searching");
      }
      throw err;
    }
  }

  // ── 2. Strip anything on the closed list ────────────────────────────────
  // The prompt asks for this too, but Birch & Rye survived into two
  // consecutive issues, so the deterministic pass is the one that holds.
  // Restore the carried directory before the closure strip, so a venue added
  // to closed-venues.json this week is removed even from a directory we did
  // not regenerate. Otherwise a closure would sit on the page for up to a
  // quarter, which is exactly the failure the strip exists to prevent.
  if (!includeDirectory && carried) {
    issue.directory = JSON.parse(JSON.stringify(carried));
  }
  if (!issue.directory || !Object.keys(issue.directory).length) {
    console.warn("  ⚠ This issue has no directory — the Directory section will be empty.");
  }

  // Hand-listed venues go in before the closure strip, so an entry here can
  // still be removed by closed-venues.json if the two ever disagree.
  const pending = addPendingVenues(issue, clusterConfig.slug);
  pending.added.forEach((n)   => console.log(`  ＋ Added from added-venues.json: ${n}`));
  pending.skipped.forEach((n) => console.log(`  ✓ ${n} is now in the directory on its own — remove it from added-venues.json`));
  pending.stale.forEach((n)   => console.warn(`  ⚠ ${n} opened over six months ago and is still hand-listed — the refresh is not finding it`));

  const removedClosed = stripClosedVenues(issue, clusterConfig.slug);
  removedClosed.forEach(r => {
    console.log(`  ⊘ Removed closed venue: "${r.name}" from ${r.category}${r.closed ? ` (closed ${r.closed})` : ""}`);
  });

  // ── 3. Continuity: never lead twice with the same story ─────────────────
  // The prompt asks for this, but a prompt is a request, not a guarantee.
  // This check is deterministic, so the same headline cannot occupy the lead
  // column two weeks running regardless of what came back.
  const rotated = rotateRepeatedLead(issue, prevIssue);
  if (rotated) {
    console.log(`  ↻ Repeated lead demoted: "${rotated.demoted.slice(0, 60)}…"`);
    console.log(`    Promoted instead:      "${rotated.promoted.slice(0, 60)}…"`);
  }

  // ── 3b. Briefs: no duplicates of the lead, and nothing undated ──────────
  const briefCheck = tidyBriefs(issue);
  briefCheck.dropped.forEach((h) =>
    console.log(`  ⊘ Brief repeated a top story — dropped: "${String(h).slice(0, 60)}"`));
  briefCheck.undated.forEach((h) =>
    console.warn(`  ⚠ Brief never says when it happened: "${String(h).slice(0, 60)}"`));

  // ── 4. Validate ─────────────────────────────────────────────────────────
  const errors = validateIssue(issue);
  if (errors.length > 0) {
    console.warn("  ⚠ Validation warnings:");
    errors.forEach((e) => console.warn("    -", e));
    // Non-fatal: we log and continue. Fatal issues (empty topStories) will
    // have been caught above.
  }

  // ── 5. Write output ──────────────────────────────────────────────────────
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(issue, null, 2), "utf8");
  console.log(`  ✅ Written: ${path.relative(ROOT, outFile)}${DRY_RUN ? "  (rehearsal)" : ""}`);
  console.log(`     ${issue.topStories.length} top stories, ${(issue.events||[]).length} events, ${(issue.moreNews||[]).length} briefs`);
}

// ─── Email HTML builder ──────────────────────────────────────────────────────

/** Trim to a word budget, preferring a sentence boundary. Mirrors the
 *  `excerpt` filter in .eleventy.js so email and web read consistently. */
function emailExcerpt(str, maxWords = 90) {
  if (!str) return "";
  const text  = String(str).replace(/\s+/g, " ").trim();
  const words = text.split(" ");
  if (words.length <= maxWords) return text;
  const clipped = words.slice(0, maxWords).join(" ");
  const re = /([.!?])\s+(?=[A-Z"“'])/g;
  let cut = -1, m;
  while ((m = re.exec(clipped)) !== null) cut = m.index;
  if (cut > clipped.length * 0.55) return clipped.slice(0, cut + 1);
  return clipped.replace(/[,;:\s]+$/, "") + "…";
}

/** Escape user-facing strings so a stray < or & can't break the email HTML. */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmailHtml(issue, cluster) {
  // Through lib/edition-path.js, the same function the site uses to build its
  // permalinks. Hardcoding `/${cluster.slug}/` here would have kept mailing
  // pre-Phase-2 URLs after every page moved under its city.
  const allEditions = JSON.parse(fs.readFileSync(CLUSTERS_FILE, "utf8"));
  const issueUrl = `${SITE_URL}${editionPath(cluster, allEditions)}`;
  const accent   = cluster.accent || "#c8943a";
  // Named neighborhoods under the edition title, for the same reason the web
  // masthead carries them: a forwarded issue lands in front of someone who
  // knows their own neighborhood but not which edition covers it. Taken from
  // the edition definition, never from the generated issue.
  const hoods    = (cluster.neighborhoods || []).join(" · ");
  // "the Neighborhood" is right in San Francisco and wrong in a five-town
  // valley. cities.json carries the word each city uses for its areas.
  const cityRec  = (() => {
    try {
      const cities = JSON.parse(fs.readFileSync(
        path.join(ROOT, "src", "_data", "cities.json"), "utf8"));
      return cities.find((c) => c.slug === cluster.citySlug) || null;
    } catch { return null; }
  })();
  const areaNoun = (cityRec && cityRec.areaNoun) || "neighborhood";
  const areaTitle = areaNoun.charAt(0).toUpperCase() + areaNoun.slice(1);

  // Tolerates both the old schema (tag/byline/date) and the current one
  // (tags[]/dek); anything absent is omitted rather than left as an
  // orphaned separator.
  const storiesHtml = (issue.topStories || []).map(s => {
    const kicker = (s.tags && s.tags.length ? s.tags[0] : s.tag) || "";
    const meta   = [s.byline, s.date].filter(Boolean).join(" · ");
    return `
    <tr><td style="padding:0 0 28px 0;border-bottom:1px solid #e8e3da;">
      ${kicker ? `<p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${accent};">${esc(kicker)}</p>` : ""}
      <h2 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:900;line-height:1.2;color:#1a2744;">${esc(s.headline)}</h2>
      ${s.dek ? `<p style="margin:0 0 10px 0;font-family:Georgia,serif;font-size:15px;font-style:italic;line-height:1.5;color:#6b6560;">${esc(s.dek)}</p>` : ""}
      ${meta ? `<p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:11px;color:#6b6560;">${esc(meta)}</p>` : ""}
      <p style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:15px;line-height:1.68;color:#1c1c1e;">${esc(emailExcerpt(s.body, 90))}</p>
      <a href="${s.sourceUrl || "#"}" style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:${accent};text-decoration:none;">Read the full story: ${esc(s.sourceName || "source")} →</a>
    </td></tr>
    <tr><td style="height:24px;"></td></tr>
  `;
  }).join("");

  // Emoji rather than the SVG icons used on the web — inline SVG support is
  // unreliable across email clients, and emoji degrade gracefully everywhere.
  const eventsHtml = sortEvents(issue.events, issue.weekOf).slice(0, 5).map(ev => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #d8d2c8;">
      ${ev.date ? `<p style="margin:0 0 2px 0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${accent};">${esc(ev.date)}</p>` : ""}
      <p style="margin:0 0 3px 0;font-family:Georgia,serif;font-size:14px;font-weight:700;color:#1a2744;">${esc(ev.title)}</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#6b6560;">📍 ${esc(ev.location)}${ev.time ? " · " + esc(ev.time) : ""}</p>
    </td></tr>
  `).join("");

  const moreHtml = (issue.moreNews || []).map(s => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #e8e3da;">
      <p style="margin:0 0 4px 0;font-family:Georgia,serif;font-size:14px;font-weight:700;color:#1a2744;">${esc(s.headline)}</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b6560;">${esc(s.dek || emailExcerpt(s.body, 32))}</p>
      ${s.sourceUrl ? `<a href="${s.sourceUrl}" style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:${accent};text-decoration:none;">${esc(s.sourceName || "Read more")} →</a>` : ""}
    </td></tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${issue.clusterName} — My Town News</title>
</head>
<body style="margin:0;padding:0;background:#faf8f3;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3;">
<tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Masthead -->
  <tr><td style="background:#1a2744;padding:32px 40px 24px;text-align:center;">
    <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${accent};">${cluster.city || "San Francisco"} · Free &amp; Independent · Every Friday</p>
    <h1 style="margin:0 0 6px 0;font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:900;color:#ffffff;letter-spacing:-1px;">My Town <span style="color:${accent};">News</span></h1>
    <p style="margin:6px 0 0 0;font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.65);">${esc(issue.clusterName || cluster.name)}</p>
    ${hoods ? `<p style="margin:5px 0 0 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.38);">${esc(hoods)}</p>` : ""}
    <p style="margin:5px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.3);">Week of ${esc(issue.weekOf || "")}</p>
  </td></tr>
  <tr><td style="height:3px;background:${accent};"></td></tr>

  <!-- Top Stories -->
  <tr><td style="background:#ffffff;padding:32px 40px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 20px 0;border-bottom:2px solid #1a2744;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1a2744;">This Week's Top Stories</p>
      </td></tr>
      <tr><td style="height:24px;"></td></tr>
      ${storiesHtml}
    </table>
  </td></tr>

  ${eventsHtml ? `
  <!-- Events -->
  <tr><td style="background:#f0ede6;padding:28px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 4px 0;border-bottom:2px solid #1a2744;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1a2744;">Upcoming Events</p>
      </td></tr>
      ${eventsHtml}
    </table>
  </td></tr>` : ""}

  ${moreHtml ? `
  <!-- More News -->
  <tr><td style="background:#ffffff;padding:24px 40px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:0 0 4px 0;border-bottom:2px solid #1a2744;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1a2744;">More from the ${areaTitle}</p>
      </td></tr>
      ${moreHtml}
    </table>
  </td></tr>` : ""}

  <!-- CTA -->
  <tr><td style="background:#1a2744;padding:28px 40px;text-align:center;">
    <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.55);">Every event, the full neighborhood directory, and all our sources.</p>
    <a href="${issueUrl}" style="display:inline-block;background:${accent};color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:13px 28px;border-radius:2px;">Open the full edition →</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 40px;text-align:center;">
    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:11px;color:#6b6560;">My Town News · mytown.news · ${cluster.city || "San Francisco"}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#a09890;">Free &amp; Independent. No spam.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Buttondown sender ───────────────────────────────────────────────────────

/** Fetch all Buttondown tags and return a map of tag name → tag ID */
async function fetchButtondownTagIds() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.buttondown.email",
        path: "/v1/tags?limit=100",
        method: "GET",
        headers: { "Authorization": `Token ${BUTTONDOWN_KEY}` },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const tagMap = {};
            const tags = parsed.results || parsed;
            if (Array.isArray(tags)) {
              tags.forEach((t) => { if (t.name && t.id) tagMap[t.name] = t.id; });
            }
            resolve(tagMap);
          } catch (e) {
            console.warn("  ⚠ Could not parse tag list response:", data.slice(0, 200));
            resolve({});
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** Subject line. Extracted so the dry-run preview cannot drift from the
 *  real send — a rehearsal that renders a different subject is worthless. */
function emailSubject(cluster) {
  // Name the city only when it adds something. Built as name + city, this
  // rendered "My Town News — Heber City Heber City" for every town whose
  // single edition *is* the city — which, on this market read, is most of
  // them. San Francisco editions still get their city, because "North
  // Waterfront" alone does not place itself in an inbox.
  const city = (cluster.city || "").trim();
  const name = (cluster.name || "").trim();
  const suffix = city && city.toLowerCase() !== name.toLowerCase() ? `, ${city}` : "";
  return `My Town News — ${name}${suffix}`;
}

/** Audience filter: send only to subscribers tagged with this cluster.
 *  Buttondown replaced included_tags with a structured filters object
 *  (2024-08-15). The filter value must be the tag's ID, not its name.
 *  An empty filter list means EVERY subscriber, which is why a missing tag
 *  is treated as loudly as it is below. */
function buildFilters(tagId) {
  return tagId
    ? { filters: [{ field: "subscriber.tags", operator: "contains", value: tagId }], groups: [], predicate: "and" }
    : { filters: [], groups: [], predicate: "and" };
}

async function sendClusterEmail(cluster, issue, tagId) {
  if (DRY_RUN) {
    // Belt and braces. main() already routes dry runs to the preview path, so
    // reaching here means a future edit wired a send into a rehearsal — fail
    // loudly rather than mail 13 neighborhoods by accident.
    throw new Error("sendClusterEmail called during a dry run — refusing to send.");
  }
  const subject = emailSubject(cluster);
  const body    = buildEmailHtml(issue, cluster);
  const filters = buildFilters(tagId);

  const payload = JSON.stringify({ subject, body, status: "about_to_send", filters });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.buttondown.email",
        path: "/v1/emails",
        method: "POST",
        headers: {
          "Authorization": `Token ${BUTTONDOWN_KEY}`,
          "Content-Type": "application/json",
          // Buttondown refuses to create an email with status "about_to_send"
          // unless this header is present — a deliberate guard against an
          // integration blasting a live send by accident. Without it the API
          // returns 'sending_requires_confirmation' and nothing is delivered,
          // which is exactly what happened to all nine editions on 2026-08-21.
          "X-Buttondown-Live-Dangerously": "true",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Render what a live run would have sent, and write it next to the issue
 *  JSON as an .html file you can open in a browser. Returns a summary line.
 *
 *  This is the whole point of the rehearsal: not "did the script survive",
 *  but "is the thing it was about to mail out actually correct". */
function previewClusterEmail(cluster, issue, tagId) {
  const subject = emailSubject(cluster);
  const body    = buildEmailHtml(issue, cluster);
  const filters = buildFilters(tagId);

  const weekDate = thisWeekDate();
  const outDir   = outDirFor(cluster.slug);
  const outFile  = path.join(outDir, `${weekDate}.email.html`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, body, "utf8");

  return {
    subject,
    filters,
    file: path.relative(ROOT, outFile),
    bytes: Buffer.byteLength(body),
  };
}

/** Deliver one edition — send it, or render a preview in a dry run.
 *
 *  Called immediately after the edition is generated, not in a later pass.
 *  Every failure here is contained to this edition: a rejected send, a
 *  missing tag or a malformed issue file must never stop the next
 *  neighborhood from getting its newsletter. */
async function deliverCluster(cluster, tagMap, counters) {
  if (!BUTTONDOWN_KEY) {
    if (!DRY_RUN) counters.failedEmail++;   // a live run that mails nobody has failed
    return;
  }
  if (!tagMap) {
    console.error(`  ✗ No tag map available — cannot deliver ${cluster.slug}`);
    counters.failedEmail++;
    return;
  }

  try {
    const weekDate  = thisWeekDate();
    const issueFile = path.join(outDirFor(cluster.slug), `${weekDate}.json`);
    const issue     = JSON.parse(fs.readFileSync(issueFile, "utf8"));
    const tagId     = tagMap[cluster.slug];
    if (!tagId) {
      console.warn(`  ⚠ No Buttondown tag for "${cluster.slug}" — this would mail EVERY subscriber`);
    }

    if (DRY_RUN) {
      const p = previewClusterEmail(cluster, issue, tagId);
      console.log(`  🧪 Would send: "${p.subject}"`);
      console.log(`       audience: ${tagId ? `tag ${tagId}` : "⚠ ALL SUBSCRIBERS (no tag)"}`);
      console.log(`       preview:  ${p.file} (${(p.bytes / 1024).toFixed(1)} KB)`);
      if (tagId) counters.previewed++; else counters.failedEmail++;
      return;
    }

    const result = await sendClusterEmail(cluster, issue, tagId);
    if (result.id) {
      console.log(`  ✅ Queued: "${cluster.name}" → tag: ${tagId || "ALL"} (email id: ${result.id})`);
      counters.sent++;
    } else if (result.code === "email_duplicate") {
      // Buttondown refuses to send the same issue twice. That is a feature,
      // not a fault: it is what makes re-running a partially failed job safe
      // for subscribers. Treat it as a skip, not a failure.
      console.log(`  ↷ Already sent this week — skipping ${cluster.slug}`);
      counters.skipped++;
    } else {
      console.error(`  ✗ Send rejected for ${cluster.slug}:`, JSON.stringify(result).slice(0, 300));
      counters.failedEmail++;
    }
  } catch (err) {
    console.error(`  ✗ Delivery failed for ${cluster.slug}: ${err.message}`);
    counters.failedEmail++;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // Load cluster configs from pipeline/clusters/*.json
  let clusters;
  try {
    clusters = JSON.parse(fs.readFileSync(CLUSTERS_FILE, "utf8"));
  } catch (err) {
    console.error(`Could not read ${CLUSTERS_FILE}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(clusters) || clusters.length === 0) {
    console.error("No editions defined in src/_data/clusters.json");
    process.exit(1);
  }

  // Filter to requested cluster or all live clusters
  const targets = clusters.filter((c) => {
    if (clusterArg) return c.slug === clusterArg;
    return c.live === true;
  });

  if (targets.length === 0) {
    console.error(clusterArg
      ? `No cluster config found for slug: ${clusterArg}`
      : "No live clusters found in pipeline/clusters/"
    );
    process.exit(1);
  }

  console.log(`My Town News — Weekly Issue Generator`);
  if (DRY_RUN) {
    console.log(`Mode: 🧪 DRY RUN — nothing will be mailed to subscribers`);
    console.log(`      Output goes to ${path.relative(ROOT, DRY_RUN_DIR)}/, not src/content/`);
  } else {
    console.log(`Mode: 🚀 LIVE — newsletters will be delivered`);
  }
  console.log(`Week of: ${thisWeekDate()}`);
  console.log(`Clusters to generate: ${targets.map((c) => c.slug).join(", ")}`);

  const counters = { sent: 0, skipped: 0, failedEmail: 0, previewed: 0 };
  let failed = 0;
  const generated = [];

  // ── Buttondown tag map, fetched once ─────────────────────────────────────
  // Deliberately outside the loop (one request, not thirteen) but wrapped,
  // because it used to be awaited bare. When this request failed it rejected
  // out of main() and killed the whole run before a single email was sent —
  // a network blip on one GET could silence every edition.
  let tagMap = null;
  if (BUTTONDOWN_KEY) {
    try {
      tagMap = await fetchButtondownTagIds();
      const names = Object.keys(tagMap);
      console.log(`\nℹ Fetched ${names.length} Buttondown tag(s): ${names.join(", ") || "(none)"}`);
    } catch (err) {
      console.error(`\n✗ Could not fetch Buttondown tags: ${err.message}`);
      console.error("  Editions will still generate, but nothing can be mailed without them.");
      tagMap = null;
    }
  } else {
    console.log(DRY_RUN
      ? "\n⚠ BUTTONDOWN_API_KEY not set — audience tags cannot be checked in this rehearsal."
      : "\n⚠ BUTTONDOWN_API_KEY not set — no email will be sent.");
  }

  // ── Generate and deliver, one edition at a time ──────────────────────────
  // Delivery used to happen in a second loop after every edition had been
  // generated. On 2026-08-28 the job hit the runner's 60-minute ceiling
  // partway through edition ten: nine finished issues sat on disk and not one
  // of them was mailed, because the send phase had not been reached yet.
  //
  // Shipping each edition as soon as it exists means a run that dies early
  // costs the editions that did not finish, not the ones that did.
  for (const cluster of targets) {
    const t0 = Date.now();
    try {
      await generateCluster(cluster);
      generated.push(cluster);
    } catch (err) {
      console.error(`\n✗ Failed for ${cluster.slug}: ${err.message}`);
      failed++;
      continue;                       // nothing to deliver
    }

    await deliverCluster(cluster, tagMap, counters);

    const mins = (Date.now() - t0) / 60000;
    console.log(`  ⏱ ${cluster.slug}: ${mins.toFixed(1)} min`);
    if (mins > EDITION_BUDGET_MIN) {
      timeWarnings.push(
        `${cluster.slug} took ${mins.toFixed(1)} min (budget ${EDITION_BUDGET_MIN})`
      );
    }
  }

  if (failed > 0) {
    console.warn(`\n⚠ ${failed} edition(s) had errors — see above. Continuing with what was generated.`);
  }
  console.log(`\n✅ ${generated.length} edition(s) generated successfully.`);

  if (DRY_RUN) {
    console.log(`\n🧪 ${counters.previewed} newsletter(s) rendered and verified, ${counters.failedEmail} would have misfired.`);
    console.log(`   Nothing was sent. Open the .email.html files to read what would have gone out.`);
  } else if (BUTTONDOWN_KEY) {
    const skipNote = counters.skipped ? `, ${counters.skipped} already sent` : "";
    console.log(`\n📧 ${counters.sent} sent${skipNote}, ${counters.failedEmail} failed.`);
  }

  // ── Time budget ──────────────────────────────────────────────────────────
  // The 60-minute cancellation was preceded by weeks of visible warning that
  // nobody was reading: 36 min, then 49, 51, 52, then over the cliff. A run
  // that quietly grows toward its own ceiling should say so while there is
  // still room to act, so exceeding the budget fails the run outright —
  // after delivery, so the failure costs a red badge and not a newsletter.
  const totalMin = (Date.now() - STARTED_AT) / 60000;
  console.log(`\n⏱ Total: ${totalMin.toFixed(1)} min (budget ${TOTAL_BUDGET_MIN} min)`);
  if (totalMin > TOTAL_BUDGET_MIN) {
    timeWarnings.push(`whole run took ${totalMin.toFixed(1)} min (budget ${TOTAL_BUDGET_MIN})`);
  }

  if (timeWarnings.length) {
    console.error("\n⏰ TIME BUDGET EXCEEDED");
    timeWarnings.forEach((w) => console.error(`   • ${w}`));
    console.error("   This run finished, but it is approaching the runner's hard");
    console.error("   timeout. Raise the budget deliberately or make generation");
    console.error("   faster — do not let the next run discover the ceiling.");
    process.exitCode = 1;
  }

  if (failed > 0 || counters.failedEmail > 0) {
    console.error(
      `\n❌ Run incomplete: ${failed} edition(s) failed to generate, ` +
      `${counters.failedEmail} email(s) ${DRY_RUN ? "would have failed to send" : "failed to send"}.`
    );
    process.exitCode = 1;
  } else if (DRY_RUN && !timeWarnings.length) {
    console.log(`\n✅ Rehearsal clean. src/content/ was not touched — a live run is what publishes.`);
  }
}

// Exported so pipeline/generate-directory.js can reuse the prompt blocks, the
// API client and the closed-venue strip rather than keeping a second copy of
// each. Two copies of a prompt drift, and the one that drifts is the one
// nobody is reading.
module.exports = {
  buildSystemPrompt,
  callClaude,
  extractJson,
  thisWeekDate,
  closedVenuesFor,
  stripClosedVenues,
  addPendingVenues,
  venueKey,
  outDirFor,
  DRY_RUN,
};

// Only run the weekly pipeline when invoked directly. Required as a module —
// which is how the directory script reuses the above — main() must not fire.
if (require.main !== module) return;

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
