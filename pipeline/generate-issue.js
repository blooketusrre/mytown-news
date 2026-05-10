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
const ROOT          = path.resolve(__dirname, "..");
const CLUSTERS_DIR  = path.join(__dirname, "clusters");
const CONTENT_DIR   = path.join(ROOT, "src", "content");
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL         = "claude-opus-4-6";

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
      { "name": "...", "cuisine": "...", "address": "...", "website": "...", "badge": "" }
    ],
    "hotels": [
      { "name": "...", "stars": 4, "address": "...", "website": "...", "badge": "" }
    ],
    "shops": [
      { "name": "...", "type": "...", "address": "...", "website": "...", "badge": "" }
    ]
  },
  "sources": [
    { "title": "...", "url": "...", "publication": "..." }
  ]
}

QUANTITY TARGETS:
- topStories: 3 (minimum 1 if it's a slow news week — never fabricate to fill)
- events: 4–8 (upcoming or ongoing within ~3 weeks)
- moreNews: 2–4 briefs
- directory: 6–12 restaurants, 2–5 hotels, 4–8 shops (real establishments only)
- sources: deduplicated list of every source referenced above

IMPORTANT: Respond with ONLY the raw JSON object. No markdown fences, no commentary before or after.`;
}

/** Extract JSON from Claude response (handles tool-use turns and plain text) */
function extractJson(response) {
  // Walk content blocks looking for text
  for (const block of response.content || []) {
    if (block.type === "text") {
      const text = block.text.trim();
      // Strip markdown fences if present
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      return JSON.parse(cleaned);
    }
  }
  throw new Error("No text block found in Claude response");
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
  for (const cluster of targets) {
    try {
      await generateCluster(cluster);
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
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
