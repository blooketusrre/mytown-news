/**
 * Start a GitHub Actions workflow from outside GitHub's scheduler.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * GitHub's cron scheduler has not run this repository's schedules on time.
 * Measured over three Fridays in September 2026:
 *
 *   Weekly Publish      11 Sep   due 15:00   ran 18:14   3h 14m late
 *   Weekly Publish      18 Sep   due 15:00   never ran
 *   Publish Watchdog    18 Sep   due 17:41   ran 19:57   2h 16m late
 *   Quarterly Directory 18 Sep   due 19:00   ran 21:20   2h 20m late
 *   Weekly Publish      25 Sep   due 14:07   nothing by 17:46, backstop included
 *
 * GitHub documents that scheduled workflows may be delayed or dropped under
 * load. A second cron did not help, because it rides the same scheduler; and
 * a watchdog on that scheduler cannot reliably report the scheduler's own
 * failures.
 *
 * A workflow_dispatch, by contrast, starts immediately — it is what the "Run
 * workflow" button does. So a Netlify scheduled function presses that button
 * on time, and the GitHub crons stay behind it as an independent backstop.
 * The two have to fail on the same day for a Friday to be missed.
 *
 * ── The guards, and why each one ─────────────────────────────────────────
 *  - Published production deploy only. Netlify's "Run now" button works on
 *    deploy previews too, and a dispatch from a preview is a real dispatch:
 *    it would publish and mail every subscriber. The token is also scoped to
 *    the Production context in Netlify, so this is the second of two locks.
 *  - Friday (UTC) only, when asked. thisWeekDate() rolls forward to next
 *    Friday on any other day, so a "Run now" clicked on a Tuesday would
 *    publish next week's issues four days early and mail them. On a Friday
 *    after the week's run it is harmless: the planner finds every edition
 *    already published and stops after one job.
 *  - Retries. A transient 5xx from GitHub should not cost a Friday. Three
 *    attempts inside Netlify's 30-second limit, then fail loudly.
 */

const REPO = "blooketusrre/mytown-news";
const API = "https://api.github.com";

export class DispatchRefused extends Error {}

/**
 * @param {object} o
 * @param {string} o.workflow     workflow file name, e.g. "weekly-publish.yml"
 * @param {object} [o.inputs]     workflow_dispatch inputs — all values strings
 * @param {object} o.context      the Netlify Context object
 * @param {boolean} [o.fridayOnly]
 * @param {Function} [o.fetchImpl] injectable for tests
 * @param {Date} [o.now]           injectable for tests
 * @param {string} [o.token]       injectable for tests; defaults to env
 * @param {number[]} [o.backoffMs]
 */
export async function dispatchWorkflow({
  workflow,
  inputs = {},
  context,
  fridayOnly = true,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  token = process.env.GITHUB_DISPATCH_TOKEN,
  backoffMs = [2000, 5000],
}) {
  const deploy = (context && context.deploy) || {};

  if (deploy.published !== true) {
    throw new DispatchRefused(
      `Not dispatching ${workflow}: this function belongs to a ${deploy.context || "unknown"} ` +
      `deploy that is not the published site. Only the live deploy may start a real publish.`
    );
  }

  if (fridayOnly && now.getUTCDay() !== 5) {
    throw new DispatchRefused(
      `Not dispatching ${workflow}: it is ${now.toISOString().slice(0, 10)}, not a Friday in UTC. ` +
      `On any other day the pipeline would build next Friday's issues early and mail them.`
    );
  }

  if (!token) {
    throw new Error(
      `GITHUB_DISPATCH_TOKEN is not set for this deploy. Add it in Netlify under ` +
      `Site configuration → Environment variables, scoped to Functions and to the ` +
      `Production context, then redeploy.`
    );
  }

  const url = `${API}/repos/${REPO}/actions/workflows/${workflow}/dispatches`;
  const body = JSON.stringify({ ref: "main", inputs });
  const attempts = backoffMs.length + 1;
  let last = "";

  for (let i = 1; i <= attempts; i++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "mytown-news-netlify-trigger",
      },
      body,
    });

    // 204 No Content is GitHub's success for a dispatch.
    if (res.status === 204 || res.status === 200) {
      console.log(`✓ Dispatched ${workflow} on main (attempt ${i}/${attempts}) with inputs ${JSON.stringify(inputs)}`);
      return { ok: true, attempts: i };
    }

    const text = await res.text().catch(() => "");
    last = `${res.status} ${text.slice(0, 300)}`;

    // 4xx other than rate limiting will not fix itself on retry: a bad token,
    // a missing permission, a renamed workflow. Stop and say so.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new Error(
        `GitHub refused the dispatch of ${workflow}: ${last}. ` +
        (res.status === 401 || res.status === 403
          ? `The token has probably expired or lacks "Actions: Read and write" on ${REPO}.`
          : res.status === 404
            ? `Check the workflow file name and that the token can see ${REPO}.`
            : `The request itself was rejected.`)
      );
    }

    console.warn(`⚠ Dispatch of ${workflow} failed (attempt ${i}/${attempts}): ${last}`);
    if (i < attempts) await new Promise((r) => setTimeout(r, backoffMs[i - 1]));
  }

  throw new Error(`Could not dispatch ${workflow} after ${attempts} attempts: ${last}`);
}
