#!/usr/bin/env node
/* Tests for lib/directory-diff.js. Run on every production build. */
"use strict";
const assert = require("assert");
const { applyDirectoryDiff } = require("../lib/directory-diff");

const base = () => ({
  restaurants: [
    { name: "AttaBoys Comfort Cuisine", address: "289 W Center St", phone: "1", website: "https://a.example" },
    { name: "The Old Mill", address: "1 Mill Rd", phone: "2", website: "https://b.example" },
    { name: "Cafe Uno", address: "3 Main St", phone: "3", website: "https://c.example" },
    { name: "Taco Dos", address: "4 Main St", phone: "4", website: "https://d.example" },
  ],
  hotels: [{ name: "Harding Inn", address: "5 Main St" }],
  shops: [{ name: "Book Nook", address: "6 Main St" }],
  artEntertainment: [{ name: "Palace Theatre", address: "7 Main St" }],
  gymsRecreation: [{ name: "Y Gym", address: "8 Main St" }],
});
const names = (d, k) => d[k].map((v) => v.name);
let n = 0; const ok = (m) => { n++; console.log(`  ✓ ${m}`); };

// Closures
let r = applyDirectoryDiff(base(), { closed: [{ section: "restaurants", name: "old mill", evidence: "https://news.example/closed" }] });
assert.deepStrictEqual(names(r.directory, "restaurants"), ["AttaBoys Comfort Cuisine", "Cafe Uno", "Taco Dos"]);
ok("a closure with a source removes the venue, matching names loosely (\"old mill\" = \"The Old Mill\")");

r = applyDirectoryDiff(base(), { closed: [{ name: "Cafe Uno" }, { name: "Nowhere Diner", evidence: "https://x.example" }] });
assert.strictEqual(r.directory.restaurants.length, 4);
assert.strictEqual(r.log.ignored.length, 2);
ok("a closure without a source, or of a venue we don't list, is ignored and logged");

assert.throws(() => applyDirectoryDiff(base(), { closed: ["AttaBoys Comfort Cuisine", "The Old Mill", "Cafe Uno"].map((name) => ({ name, evidence: "https://x.example" })) }),
  /more than 30%/);
ok("closing more than 30% of the directory at once is refused");

// Corrections
r = applyDirectoryDiff(base(), { updated: [
  { name: "Taco Dos", changes: { phone: "740-555-0100", description: "new words", website: "not a url" }, source: "https://src.example" },
  { name: "Cafe Uno", changes: { phone: "9" } },
] });
const taco = r.directory.restaurants.find((v) => v.name === "Taco Dos");
assert.strictEqual(taco.phone, "740-555-0100");
assert.strictEqual(taco.website, "https://d.example");
assert.strictEqual(taco.description, undefined);
assert.strictEqual(r.directory.restaurants.find((v) => v.name === "Cafe Uno").phone, "3");
ok("a correction changes only address, phone or website, needs a source, and needs a real URL for website");

// Additions
r = applyDirectoryDiff(base(), { added: {
  restaurants: [{ name: "New Spot", address: "9 Main St", notable: "New" }, { name: "the cafe uno", address: "x" }, { name: "No Address" }],
  bars: [{ name: "X", address: "y" }],
} });
assert.deepStrictEqual(names(r.directory, "restaurants").slice(-1), ["New Spot"]);
assert.strictEqual(r.directory.restaurants.length, 5);
assert.ok(!("bars" in r.directory));
ok("an addition needs a name and address, may not duplicate a listing, and only goes into known sections");

r = applyDirectoryDiff(base(), { added: { shops: Array.from({ length: 8 }, (_, i) => ({ name: `Shop ${i}`, address: `${i} St` })) } });
assert.strictEqual(r.directory.shops.length, 1 + 5);
ok("additions are capped at 5 per section");

// No change
const original = base();
r = applyDirectoryDiff(original, {});
assert.deepStrictEqual(r.directory, base());
r.directory.restaurants.pop();
assert.strictEqual(original.restaurants.length, 4);
ok("an empty update changes nothing, and the input directory is never modified");

console.log(`Directory updates: ${n} tests passed`);
