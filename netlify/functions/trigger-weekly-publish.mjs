/**
 * Starts the weekly publish at 14:07 UTC every Friday, on Netlify's scheduler
 * rather than GitHub's. See netlify/lib/dispatch.mjs for why.
 *
 * The inputs are passed explicitly rather than left to the workflow's
 * defaults, so the behaviour of a scheduled Friday does not depend on what
 * the defaults happen to be the next time someone edits the workflow:
 *
 *   dry_run         "false"  — this is the real run
 *   skip_published  "true"   — anything already out this week is skipped,
 *                              which is what makes the GitHub crons that
 *                              still fire behind this one nearly free
 *   cluster         ""       — every live edition
 *
 * Keep the schedule in step with the primary cron in weekly-publish.yml;
 * scripts/verify-build.js checks that they match.
 */
import { dispatchWorkflow, DispatchRefused } from "../lib/dispatch.mjs";

export default async (req, context) => {
  try {
    await dispatchWorkflow({
      workflow: "weekly-publish.yml",
      inputs: { dry_run: "false", skip_published: "true", cluster: "" },
      context,
    });
  } catch (err) {
    if (err instanceof DispatchRefused) {
      // A deliberate refusal — a preview deploy, or the wrong day — is not a
      // failure. Log it plainly and stop.
      console.log(`ℹ ${err.message}`);
      return;
    }
    console.error(`✗ ${err.message}`);
    throw err;   // shows as a failed invocation in Netlify's function log
  }
};

export const config = {
  schedule: "7 14 * * 5",
};
