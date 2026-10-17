#!/usr/bin/env node
/* Tests for lib/strip-citations.js. Run on every production build. */
"use strict";
const assert = require("assert");
const { stripCitations, hasCitations } = require("../lib/strip-citations");

const cases = [
  ["16 October as it happened",
   '<cite index="46-4,46-5">Fisherman\'s Wharf is getting a rink.</cite> <cite index="47-4,47-5">It opens Nov. 4.</cite>',
   "Fisherman's Wharf is getting a rink. It opens Nov. 4."],
  ["paragraph breaks survive",
   '<cite index="1-1">First.</cite>\n\n<cite index="2-1">Second.</cite>',
   "First.\n\nSecond."],
  ["a tag before punctuation leaves no stray space",
   'The rink opens <cite index="3-2">Nov. 4</cite> .',
   "The rink opens Nov. 4."],
  ["text with no tags is returned untouched",
   "Plain  text, with  its own spacing.",
   "Plain  text, with  its own spacing."],
  ["upper case and odd attributes",
   '<CITE index="9-9" data-x="1">Loud.</CITE>',
   "Loud."],
];
for (const [name, input, want] of cases) {
  assert.strictEqual(stripCitations(input), want, name);
  console.log(`  ✓ ${name}`);
}

const issue = {
  topStories: [{ headline: "<cite index=\"1\">H</cite>", body: "<cite index=\"2\">B</cite>", tags: ["<cite>t</cite>"] }],
  events: [{ name: "x", details: { note: "<cite index=\"3\">deep</cite>" } }],
  count: 3, live: true, none: null,
};
const clean = stripCitations(issue);
assert.strictEqual(hasCitations(issue), true);
assert.strictEqual(hasCitations(clean), false);
assert.deepStrictEqual(clean.topStories[0], { headline: "H", body: "B", tags: ["t"] });
assert.strictEqual(clean.events[0].details.note, "deep");
assert.strictEqual(clean.count, 3); assert.strictEqual(clean.live, true); assert.strictEqual(clean.none, null);
console.log("  ✓ every string at any depth is cleaned; numbers, booleans and null are kept");

console.log("Citations: 6 tests passed");
