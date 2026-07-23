#!/usr/bin/env node
/**
 * My Town News — Weekly Issue Generator
 *
 * Usage:
 *   node pipeline/generate-issue.js                  # all live clusters
 *   node pipeline/generate-issue.js --cluster north-waterfront
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const clusterArg = (() => {
  const idx = args.indexOf("--cluster");
  return idx !== -1 ? args[idx + 1] : null;
})();

// ─── Config ────────────────────────────────────────────────────────────────
const ROOT            = path.resolve(__dirname, "..");
const CLUSTERS_DIR    = path.join(__dirname, "clusters");
const CONTENT_DIR     = path.join(ROOT, "src", "content");
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const BUTTONDOWN_KEY  = process.env.BUTTONDOWN_API_KEY;
const SITE_URL        = "https://mytown.news";
const MODEL           = "claude-opus-4-6";

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

/** Anthropic Messages API call (single turn) */
async function callClaude(systemPrompt, userMessage, tools = []) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
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

function buildSystemPrompt(cluster) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the research editor for My Town News, a hyperlocal weekly newspaper covering San Francisco neighborhoods.

Today is ${today}. You are preparing the issue for the week of ${thisWeekDate()}.

Your cluster: ${cluster.name}
Neighborhoods: ${cluster.neighborhoods.join(", ")}

EDITORIAL RULES — NON-NEGOTIABLE:
1. Every factual claim must be traceable to a real, verifiable public source (city agency, established news outlet, neighborhood association, business website, library/cultural calendar, official press release).
2. Do NOT invent quotes. If a quote appears, it must come from a verifiable published statement — include the exact source URL.
3. Named individuals appear only in their publicly documented roles (officials, business owners, published authors). No private individuals unless they have given a public statement.
4. Do NOT fabricate events, dates, business names, or addresses.
5. If a story cannot be verified, omit it entirely. A shorter issue with real news beats a longer issue with invented content.
6. Search the web for current news. Prioritize stories from the last 14 days; events should be upcoming or ongoing.

CONTENT STRUCTURE (return as JSON only — no markdown wrapper):
{
  "clusterSlug": "${cluster.slug}",
  "clusterName": "${cluster.name}",
  "weekOf": "${thisWeekDate()}",
  "topStories": [
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
  "directory": {
    "restaurants": [
      {
        "name": "...",
        "cuisineGroup": "Italian & Deli",
        "type": "Italian delicatessen",
        "description": "One sentence about this place.",
        "address": "373 Columbus Ave",
        "phone": "415-421-2337",
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
        "neighborhood": "...",
        "notable": ""
      }
    ]
  },
  "sources": [
    { "title": "...", "url": "...", "publication": "..." }
  ]
}

DIRECTORY GROUPING GUIDANCE:
- cuisineGroup options: "Coffee & Cafés", "Italian & Deli", "Seafood & American", "Asian", "Mexican & Latin American", "Mediterranean & Middle Eastern", "Brunch & Breakfast", "Pizza & Sandwiches", "Bars & Wine Bars", "Bakeries & Desserts", "Vegetarian & Vegan", "Other"
- shopGroup options: "Books & Literature", "Fashion & Clothing", "Home & Gifts", "Specialty Food & Wine", "Beauty & Wellness", "Art Supplies & Hobby", "Hardware & Services", "Other"
- venueGroup (art): "Art Galleries", "Theater & Comedy", "Music Venues", "Cinema", "Museums & Cultural"
- venueGroup (gyms): "Yoga & Pilates", "Gyms & CrossFit", "Sports & Courts", "Cycling & Rowing", "Martial Arts", "Pools & Aquatics", "Parks & Outdoor Recreation"
- notable field: "Landmark" for long-established institutions, "New" for opened in the last year, or "" for standard listings

QUANTITY TARGETS:
- topStories: 3 (minimum 1 if it's a slow news week — never fabricate to fill)
- events: 4–8 (upcoming or ongoing within ~3 weeks)
- moreNews: 2–4 briefs
- restaurants: 15–30 (comprehensive coverage — every notable café, restaurant, bar, and bakery in the cluster)
- hotels: 5–15 (all hotels and inns in the cluster)
- shops: 10–20 (notable independent shops, bookstores, specialty stores, services)
- artEntertainment: 8–15 (galleries, theaters, music venues, cinemas, museums)
- gymsRecreation: 8–15 (gyms, yoga studios, sports courts, pools, notable parks)
- sources: deduplicated list of every source referenced above

CRITICAL: Your response must be ONLY the raw JSON object — nothing else. Do not write any introduction, explanation, or commentary. Do not say "I'll research" or "Here is the issue." Begin your response with { and end with }. No markdown fences.`;
}

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

async function generateCluster(clusterConfig) {
  console.log(`\n📰 Generating: ${clusterConfig.name}`);
  const weekDate = thisWeekDate();
  const outDir   = path.join(CONTENT_DIR, clusterConfig.slug);
  const outFile  = path.join(outDir, `${weekDate}.json`);

  // Skip if already generated today
  if (fs.existsSync(outFile)) {
    console.log(`  ✓ Already exists: ${outFile}`);
    return;
  }

  // ── 1. Research with Claude (web search enabled) ────────────────────────
  console.log("  🔍 Researching current news…");
  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
  };

  const systemPrompt = buildSystemPrompt(clusterConfig);
  const userMessage  = `Please research and write this week's My Town News issue for ${clusterConfig.name} (${clusterConfig.neighborhoods.join(", ")}). Search for real, current news stories and upcoming events in these neighborhoods. Return only valid JSON matching the schema in your instructions.`;

  let response;
  try {
    response = await callClaude(systemPrompt, userMessage, [webSearchTool]);
  } catch (err) {
    console.error(`  ✗ Claude API error: ${err.message}`);
    throw err;
  }

  // Handle agentic loop — Claude may do multiple web_search tool calls before
  // returning final text. We do a simplified single-turn extraction here since
  // the Anthropic API's web_search tool resolves results server-side.
  let issue;
  try {
    issue = extractJson(response);
  } catch (err) {
    console.error("  ✗ JSON parse error. Raw response excerpt:");
    const excerpt = JSON.stringify(response.content || response).slice(0, 500);
    console.error("  ", excerpt);
    throw err;
  }

  // ── 2. Validate ─────────────────────────────────────────────────────────
  const errors = validateIssue(issue);
  if (errors.length > 0) {
    console.warn("  ⚠ Validation warnings:");
    errors.forEach((e) => console.warn("    -", e));
    // Non-fatal: we log and continue. Fatal issues (empty topStories) will
    // have been caught above.
  }

  // ── 3. Write output ──────────────────────────────────────────────────────
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(issue, null, 2), "utf8");
  console.log(`  ✅ Written: ${outFile}`);
  console.log(`     ${issue.topStories.length} top stories, ${(issue.events||[]).length} events, ${(issue.moreNews||[]).length} briefs`);
}

// ─── Email HTML builder ──────────────────────────────────────────────────────

function buildEmailHtml(issue, cluster) {
  const issueUrl = `${SITE_URL}/${cluster.slug}/`;
  const accent   = cluster.accentColor || "#c8943a";

  const storiesHtml = (issue.topStories || []).map(s => `
    <tr><td style="padding:0 0 28px 0;border-bottom:1px solid #e8e3da;">
      <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${accent};">${s.tag || ""}</p>
      <h2 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:900;line-height:1.2;color:#1a2744;">${s.headline}</h2>
      <p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:11px;color:#6b6560;">${s.byline || ""} · ${s.date || ""}</p>
      <p style="margin:0 0 12px 0;font-family:Georgia,serif;font-size:15px;line-height:1.68;color:#1c1c1e;">${(s.body || "").split("\n\n")[0]}</p>
      <a href="${s.sourceUrl || "#"}" style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:${accent};text-decoration:none;">Source: ${s.sourceName || ""} →</a>
    </td></tr>
    <tr><td style="height:24px;"></td></tr>
  `).join("");

  const eventsHtml = (issue.events || []).slice(0, 5).map(ev => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #d8d2c8;">
      <p style="margin:0 0 2px 0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${accent};">${ev.date || ""}</p>
      <p style="margin:0 0 3px 0;font-family:Georgia,serif;font-size:14px;font-weight:700;color:#1a2744;">${ev.title || ""}</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#6b6560;">📍 ${ev.location || ""}${ev.time ? " · " + ev.time : ""}</p>
    </td></tr>
  `).join("");

  const moreHtml = (issue.moreNews || []).map(s => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #e8e3da;">
      <p style="margin:0 0 4px 0;font-family:Georgia,serif;font-size:14px;font-weight:700;color:#1a2744;">${s.headline}</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b6560;">${(s.body || "").split("\n\n")[0].slice(0, 160)}…</p>
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
    <p style="margin:6px 0 0 0;font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.65);">${issue.clusterName}</p>
    <p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.3);">Week of ${issue.weekOf || ""}</p>
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
        <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1a2744;">More from the Neighborhood</p>
      </td></tr>
      ${moreHtml}
    </table>
  </td></tr>` : ""}

  <!-- CTA -->
  <tr><td style="background:#1a2744;padding:28px 40px;text-align:center;">
    <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.55);">Read the full issue — including the complete neighborhood directory — online:</p>
    <a href="${issueUrl}" style="display:inline-block;background:${accent};color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:13px 28px;border-radius:2px;">Read Full Issue →</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 40px;text-align:center;">
    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:11px;color:#6b6560;">My Town News · mytown.news · ${cluster.city || "San Francisco"}</p>
    <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#a09890;">Free &amp; Independent. No ads. No spam.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Buttondown sender ───────────────────────────────────────────────────────

async function sendClusterEmail(cluster, issue) {
  const subject = `My Town News — ${cluster.name} ${cluster.city || ""}`.trim();
  const body    = buildEmailHtml(issue, cluster);

  const payload = JSON.stringify({
    subject,
    body,
    status: "about_to_send",
    included_tags: [cluster.slug],   // send only to subscribers tagged with this cluster
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.buttondown.email",
        path: "/v1/emails",
        method: "POST",
        headers: {
          "Authorization": `Token ${BUTTONDOWN_KEY}`,
          "Content-Type": "application/json",
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

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // Load cluster configs from pipeline/clusters/*.json
  const clusterFiles = fs.readdirSync(CLUSTERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(CLUSTERS_DIR, f));

  if (clusterFiles.length === 0) {
    console.error("No cluster config files found in pipeline/clusters/");
    process.exit(1);
  }

  const clusters = clusterFiles.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));

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
  console.log(`Week of: ${thisWeekDate()}`);
  console.log(`Clusters to generate: ${targets.map((c) => c.slug).join(", ")}`);

  let failed = 0;
  const generated = [];

  for (const cluster of targets) {
    try {
      await generateCluster(cluster);
      generated.push(cluster);
    } catch (err) {
      console.error(`\n✗ Failed for ${cluster.slug}: ${err.message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} cluster(s) failed.`);
    process.exit(1);
  }

  console.log("\n✅ All clusters generated successfully.");

  // ── Send newsletters via Buttondown ──────────────────────────────────────
  if (BUTTONDOWN_KEY) {
    console.log("\n📧 Sending newsletters via Buttondown…");
    for (const cluster of generated) {
      try {
        const weekDate  = thisWeekDate();
        const issueFile = path.join(CONTENT_DIR, cluster.slug, `${weekDate}.json`);
        const issue     = JSON.parse(fs.readFileSync(issueFile, "utf8"));
        const result    = await sendClusterEmail(cluster, issue);
        if (result.id) {
          console.log(`  ✅ Queued: "${cluster.name}" (id: ${result.id})`);
        } else {
          console.log(`  ⚠ Unexpected response for ${cluster.slug}:`, JSON.stringify(result).slice(0, 200));
        }
      } catch (err) {
        console.error(`  ✗ Email failed for ${cluster.slug}: ${err.message}`);
      }
    }
  } else {
    console.log("\n⚠ BUTTONDOWN_API_KEY not set — skipping email send.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
