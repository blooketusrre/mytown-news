#!/usr/bin/env node
/*
 * Every link in the email must keep its own color inside Buttondown's
 * template. See lib/pin-link-colors.js. Run on every production build.
 *
 * Buttondown's stylesheet has exactly two rules that set a link's color:
 *     a     { color: #0069FF !important }
 *     a > * { color: inherit !important }
 * This applies both to a real edition's email, the way Buttondown's inliner
 * does, then resolves the color of each link's text by walking up from it.
 */
"use strict";
process.env.ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY  || "test";
process.env.BUTTONDOWN_API_KEY = process.env.BUTTONDOWN_API_KEY || "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pinLinkColors } = require("../lib/pin-link-colors");

/* ── A tiny tree, enough for the email's own markup ───────────────────── */
function parse(html) {
  const root = { tag: "#root", style: "", children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  const VOID = new Set(["br", "img", "meta", "hr", "link", "input", "col"]);
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { cur.children.push({ text: m[5], parent: cur }); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { while (cur.tag !== tag && cur.parent) cur = cur.parent; if (cur.parent) cur = cur.parent; continue; }
    const sm = /\bstyle="([^"]*)"/i.exec(m[3] || "");
    const el = { tag, style: sm ? sm[1] : "", children: [], parent: cur };
    cur.children.push(el);
    if (!VOID.has(tag) && !m[4] && tag !== "!doctype") cur = el;
  }
  return root;
}
const colorOf = (style) => { const m = /(?:^|;)\s*color\s*:\s*([^;!]+)/i.exec(style || ""); return m ? m[1].trim() : null; };

/* Buttondown's two rules, applied as its inliner and stylesheet would. */
function buttondown(root) {
  (function walk(el) {
    if (!el.children) return;
    if (el.tag === "a") {
      el.forced = "#0069FF";
      for (const c of el.children) if (c.tag) c.forced = "inherit";
    }
    el.children.forEach(walk);
  })(root);
}
function effectiveColor(el) {
  for (let e = el; e; e = e.parent) {
    if (e.forced && e.forced !== "inherit") return e.forced;   // !important beats inline
    if (e.forced === "inherit") continue;                     // !important inherit
    const c = colorOf(e.style);
    if (c && c !== "inherit") return c;
  }
  return "#000";
}
function links(root, out = []) {
  if (root.tag === "a") out.push(root);
  (root.children || []).forEach((c) => c.tag && links(c, out));
  return out;
}
function firstText(el) {
  for (const c of el.children || []) {
    if (c.text !== undefined && c.text.trim()) return c;
    if (c.tag) { const t = firstText(c); if (t) return t; }
  }
  return null;
}

/* ── 1. The transform itself ──────────────────────────────────────────── */
assert.strictEqual(
  pinLinkColors('<a href="x" style="color:#fff;text-decoration:none;">Hi</a>'),
  '<a href="x" style="color:#fff;text-decoration:none;" data-pinned="1"><span><span style="color:#fff;">Hi</span></span></a>');
assert.strictEqual(pinLinkColors('<a href="x" style="text-decoration:none">Hi</a>'),
  '<a href="x" style="text-decoration:none">Hi</a>', "a link with no color is left alone");
assert.strictEqual(pinLinkColors(pinLinkColors('<a style="color:red">x</a>')),
  pinLinkColors('<a style="color:red">x</a>'), "running twice changes nothing");
assert.strictEqual(pinLinkColors('<a style="background-color:#1a2744">x</a>'),
  '<a style="background-color:#1a2744">x</a>', "background-color is not mistaken for color");
console.log("  ✓ the transform pins a link's color, skips colorless links, is idempotent");

/* ── 2. A real edition, through Buttondown's rules ────────────────────── */
const { buildEmailHtml } = require("../pipeline/generate-issue.js");
const ROOT = path.resolve(__dirname, "..");
const clusters = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/clusters.json"), "utf8"));
let checked = 0;
for (const c of clusters.filter((x) => x.live)) {
  const dir = path.join(ROOT, "src/content", c.slug);
  if (!fs.existsSync(dir)) continue;
  const latest = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
  if (!latest) continue;
  const issue = JSON.parse(fs.readFileSync(path.join(dir, latest), "utf8"));
  const tree = parse(buildEmailHtml(issue, c));
  buttondown(tree);
  for (const a of links(tree)) {
    const wanted = colorOf(a.style);
    if (!wanted) continue;
    const t = firstText(a);
    if (!t) continue;
    const got = effectiveColor(t.parent).toLowerCase();
    assert.notStrictEqual(got, "#0069ff",
      `${c.slug}: link "${t.text.trim().slice(0, 40)}" would show Buttondown blue instead of ${wanted}`);
    assert.strictEqual(got, wanted.toLowerCase(),
      `${c.slug}: link "${t.text.trim().slice(0, 40)}" would show ${got}, not ${wanted}`);
    checked++;
  }
  // The wordmark specifically: "My Town" white, "News" the edition color.
  const html = buildEmailHtml(issue, c);
  assert.ok(/<span style="color:#ffffff;">My Town <span style="color:/i.test(html), `${c.slug}: wordmark not pinned white`);
}
assert.ok(checked > 100, `only ${checked} links checked — the test is not seeing the emails`);
console.log(`  ✓ ${checked} links across every live edition keep their colors under Buttondown's stylesheet`);
console.log("Email links: 2 tests passed");
