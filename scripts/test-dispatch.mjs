/**
 * Tests for netlify/lib/dispatch.mjs, run on every production build.
 *
 * The function they cover can start a live publish that mails every
 * subscriber. The guards that stop it doing so from a deploy preview, or on
 * the wrong day, are one deleted line away from not existing — and nothing
 * else in the build would notice. So these run as part of build:prod, and a
 * failure fails the deploy.
 *
 * No network: GitHub is a fake fetch, Netlify's context is a plain object.
 */
import { dispatchWorkflow, DispatchRefused } from "../netlify/lib/dispatch.mjs";

const FRIDAY = new Date("2026-10-02T14:07:00Z");
const TUESDAY = new Date("2026-09-29T14:07:00Z");
const LIVE = { deploy: { published: true, context: "production" } };
const PREVIEW = { deploy: { published: false, context: "deploy-preview" } };

function fakeFetch(statuses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return { status, text: async () => `body-${status}` };
  };
  fn.calls = calls;
  return fn;
}

const quiet = { log: console.log, warn: console.warn };
console.log = (...a) => { if (String(a[0]).startsWith("  ")) quiet.log(...a); };
console.warn = () => {};
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log("  ✓", name); pass++; }
  catch (e) { console.log("  ✗", name, "—", e.message); fail++; }
}
const base = { workflow: "weekly-publish.yml", token: "tok", backoffMs: [1, 1] };

await t("live deploy, Friday, 204 → dispatches once", async () => {
  const f = fakeFetch([204]);
  const r = await dispatchWorkflow({ ...base, context: LIVE, now: FRIDAY, fetchImpl: f,
    inputs: { dry_run: "false", skip_published: "true", cluster: "" } });
  if (!r.ok || f.calls.length !== 1) throw new Error("expected one successful call");
  const c = f.calls[0];
  if (!c.url.endsWith("/repos/blooketusrre/mytown-news/actions/workflows/weekly-publish.yml/dispatches")) throw new Error("wrong URL " + c.url);
  const body = JSON.parse(c.init.body);
  if (body.ref !== "main") throw new Error("ref not main");
  if (body.inputs.dry_run !== "false" || body.inputs.skip_published !== "true") throw new Error("inputs wrong");
  if (c.init.headers.Authorization !== "Bearer tok") throw new Error("auth header wrong");
});

await t("deploy preview → refused, GitHub never called", async () => {
  const f = fakeFetch([204]);
  try { await dispatchWorkflow({ ...base, context: PREVIEW, now: FRIDAY, fetchImpl: f }); throw new Error("did not refuse"); }
  catch (e) { if (!(e instanceof DispatchRefused)) throw e; }
  if (f.calls.length) throw new Error("GitHub was called from a preview");
});

await t("missing context entirely → refused", async () => {
  const f = fakeFetch([204]);
  try { await dispatchWorkflow({ ...base, context: undefined, now: FRIDAY, fetchImpl: f }); throw new Error("did not refuse"); }
  catch (e) { if (!(e instanceof DispatchRefused)) throw e; }
  if (f.calls.length) throw new Error("GitHub was called");
});

await t("Tuesday → refused (would publish next week's issues early)", async () => {
  const f = fakeFetch([204]);
  try { await dispatchWorkflow({ ...base, context: LIVE, now: TUESDAY, fetchImpl: f }); throw new Error("did not refuse"); }
  catch (e) { if (!(e instanceof DispatchRefused)) throw e; }
  if (f.calls.length) throw new Error("GitHub was called on a Tuesday");
});

await t("no token → hard error, not a quiet refusal", async () => {
  const f = fakeFetch([204]);
  try { await dispatchWorkflow({ ...base, token: "", context: LIVE, now: FRIDAY, fetchImpl: f }); throw new Error("did not throw"); }
  catch (e) { if (e instanceof DispatchRefused || !/GITHUB_DISPATCH_TOKEN/.test(e.message)) throw new Error("wrong error: " + e.message); }
});

await t("500, 502, then 204 → succeeds on the third attempt", async () => {
  const f = fakeFetch([500, 502, 204]);
  const r = await dispatchWorkflow({ ...base, context: LIVE, now: FRIDAY, fetchImpl: f });
  if (!r.ok || r.attempts !== 3) throw new Error("attempts=" + r.attempts);
});

await t("500 every time → fails loudly after three attempts", async () => {
  const f = fakeFetch([500]);
  try { await dispatchWorkflow({ ...base, context: LIVE, now: FRIDAY, fetchImpl: f }); throw new Error("did not throw"); }
  catch (e) { if (!/after 3 attempts/.test(e.message)) throw new Error("wrong error: " + e.message); }
  if (f.calls.length !== 3) throw new Error("calls=" + f.calls.length);
});

await t("401 (expired token) → no retry, message names the likely cause", async () => {
  const f = fakeFetch([401]);
  try { await dispatchWorkflow({ ...base, context: LIVE, now: FRIDAY, fetchImpl: f }); throw new Error("did not throw"); }
  catch (e) { if (!/expired|Actions: Read and write/.test(e.message)) throw new Error("unhelpful: " + e.message); }
  if (f.calls.length !== 1) throw new Error("retried a 401, calls=" + f.calls.length);
});

await t("429 (rate limited) → retried, not treated as permanent", async () => {
  const f = fakeFetch([429, 204]);
  const r = await dispatchWorkflow({ ...base, context: LIVE, now: FRIDAY, fetchImpl: f });
  if (r.attempts !== 2) throw new Error("attempts=" + r.attempts);
});

await t("watchdog may skip the Friday check when asked", async () => {
  const f = fakeFetch([204]);
  const r = await dispatchWorkflow({ ...base, workflow: "publish-watchdog.yml", fridayOnly: false, context: LIVE, now: TUESDAY, fetchImpl: f });
  if (!r.ok) throw new Error("not ok");
});

quiet.log(`  Dispatch: ${pass} trigger tests passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
