/**
 * Starts the publish watchdog at 17:41 UTC every Friday, on Netlify's
 * scheduler.
 *
 * The watchdog exists to catch a Friday on which the publish never ran. While
 * it lived only on GitHub's scheduler, it shared the failure it was meant to
 * report: on 18 September it arrived 2h 16m late, and on a bad week it would
 * simply not have run. Triggered from here, a silent GitHub scheduler can no
 * longer silence the thing watching it.
 *
 * Keep the schedule in step with the cron in publish-watchdog.yml;
 * scripts/verify-build.js checks that they match.
 */
import { dispatchWorkflow, DispatchRefused } from "../lib/dispatch.mjs";

export default async (req, context) => {
  try {
    await dispatchWorkflow({ workflow: "publish-watchdog.yml", context });
  } catch (err) {
    if (err instanceof DispatchRefused) {
      console.log(`ℹ ${err.message}`);
      return;
    }
    console.error(`✗ ${err.message}`);
    throw err;
  }
};

export const config = {
  schedule: "41 17 * * 5",
};
