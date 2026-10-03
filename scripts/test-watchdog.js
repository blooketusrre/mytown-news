/**
 * Tests for the watchdog's lateness check, run on every production build.
 *
 * The watchdog passed on 2 October although all twenty editions went out
 * 2h 50m late, because it only asked whether the files existed. These cover
 * the rule that would have caught it: a file first committed after the send
 * time is late. Pure function, no git, no network.
 */
"use strict";
const { lateEditions } = require("./check-published");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ✓", name); }
  catch (e) { fail++; console.log("  ✗", name, "—", e.message); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}`); };
const W = "2026-10-02";

t("2 October as it happened — all at 19:20 → all late", () => {
  const r = lateEditions({ a: "2026-10-02T19:20:55+00:00", b: "2026-10-02T19:20:55+00:00" }, W, "16:30");
  eq(r.map((x) => x.slug), ["a", "b"], "slugs");
});
t("an on-time Friday — committed 14:31 → nothing late", () => {
  eq(lateEditions({ a: "2026-10-02T14:31:00+00:00" }, W, "16:30"), [], "late");
});
t("one edition retried after the send → only that one", () => {
  const r = lateEditions({ a: "2026-10-02T14:31:00Z", b: "2026-10-02T17:05:00Z" }, W, "16:30");
  eq(r.map((x) => x.slug), ["b"], "slugs");
});
t("exactly at the send time is on time", () => {
  eq(lateEditions({ a: "2026-10-02T16:30:00Z" }, W, "16:30"), [], "late");
});
t("timezone offsets are honoured, not read as UTC", () => {
  // 10:00 Pacific is 17:00 UTC — late, though the clock reads 10:00.
  eq(lateEditions({ a: "2026-10-02T10:00:00-07:00" }, W, "16:30").length, 1, "count");
});
t("unknown commit time (shallow history) is not reported as late", () => {
  eq(lateEditions({ a: null }, W, "16:30"), [], "late");
});

console.log(`  Watchdog: ${pass} lateness tests passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
