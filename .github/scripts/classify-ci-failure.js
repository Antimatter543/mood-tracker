'use strict';

/**
 * .github/scripts/classify-ci-failure.js
 *
 * Decide whether a FAILED "Release APK" run died because of GitHub's
 * infrastructure (safe to re-run) or because of our code/config (must stay red).
 *
 * WHY THIS EXISTS: on 2026-07-25 run 30156783723 attempt 1 was killed 27 minutes
 * into the Play AAB gradle build by
 *
 *     ##[error]The runner has received a shutdown signal. This can happen when
 *     the runner service is stopped, or a manually started runner is canceled.
 *     ##[error]The operation was canceled.
 *
 * GitHub reclaimed the hosted runner VM mid-compile. Nothing was wrong with the
 * commit — attempt 2 passed unchanged. But the release lane sat RED until a human
 * noticed the failure email and clicked re-run, which on a live Play app blocks
 * staged promotes. No in-job retry can cover this class: the VM itself dies, so
 * the fix has to live one level up, at the run level (see
 * .github/workflows/rerun-infra-failures.yml).
 *
 * THE DANGEROUS FAILURE MODE of any auto-retry is laundering a REAL build break
 * into "just a flake" — burning 30-55 minutes of CI and, worse, making a broken
 * lane look merely unreliable. So this classifier is deliberately conservative:
 *   - the transient allow-list contains ONLY signatures that mean the runner or
 *     the Actions platform failed, never signatures that could come from our
 *     code (a network blip inside gradle is NOT on the list — extend it only
 *     with evidence, per "harden after it fails twice the same way");
 *   - REAL_FAILURE_SIGNATURES take PRECEDENCE, so anything carrying a genuine
 *     error stays red even if an infrastructure phrase also appears;
 *   - anything unrecognised is NOT transient (fail safe = no retry).
 *
 * IMPORTANT — read the FULL JOB log, not just the failed step's log. In the
 * 2026-07-25 incident the `shutdown signal` line appeared ONLY in the job-level
 * log (`0_build.txt` of the attempt log archive); the failing step's own log held
 * nothing but the generic `The operation was canceled.`. `gh run view
 * --log-failed` shows only failed steps and would therefore MISS the one line
 * that identifies this class. The workflow downloads the whole attempt archive.
 */

/**
 * The GitHub-hosted runner, or the Actions platform itself, failed — our build
 * never got a fair chance to pass or fail on its own merits.
 *
 * Deliberately NOT here: `The operation was canceled.` on its own. That line also
 * appears on a concurrency cancel, a manual cancel, and a `timeout-minutes`
 * timeout, none of which a blind re-run should paper over.
 */
const TRANSIENT_INFRA_SIGNATURES = [
  // Hosted runner VM reclaimed mid-job (the 2026-07-25 SoulSync case).
  'The runner has received a shutdown signal',
  // Runner process died / network partition between runner and Actions service.
  'lost communication with the server',
  // The cloud provider pulled the VM out from under the job.
  'The request was cancelled by the remote provider',
  // Actions CDN blip fetching a third-party action tarball.
  'Failed to download action',
];

/**
 * A genuine, reproducible failure. Matching ANY of these vetoes a transient
 * match — a real break must never be retried into looking flaky.
 *
 * Verified against the real 2026-07-25 log: a runner shutdown kills gradle before
 * it can print its `FAILURE: Build failed with an exception` banner, so listing
 * that banner here cannot mis-veto the very class this guard exists for.
 */
const REAL_FAILURE_SIGNATURES = [
  // gradle compiled/assembled and genuinely failed.
  'FAILURE: Build failed with an exception',
  // Job hit its own time limit; a re-run would just burn another slot.
  'exceeded the maximum execution time',
  // Our own Health Connect manifest guards in release-apk.yml (both directions).
  '::error::Default manifest is MISSING',
  '::error::Expected exactly 4 android.permission.health',
  '::error::Play AAB manifest STILL declares',
  // Artifact-location guards.
  'No release APK found',
  'No release AAB found',
  // A publish step already exhausted its own in-step backoff — the API is not
  // momentarily blipping, it is persistently refusing.
  'publish failed after',
];

/**
 * @param {string} logText Full job log of the failed attempt.
 * @returns {{transient: boolean, reason: string}} `transient: true` only when the
 *   failure is attributable to GitHub's infrastructure and re-running is safe.
 */
function classifyCiFailure(logText) {
  const text = typeof logText === 'string' ? logText : '';

  if (text.trim() === '') {
    // No log to reason about (expired, or the download failed). Fail safe.
    return { transient: false, reason: 'empty or unavailable log — not retrying' };
  }

  // Deny-list first: a real error present anywhere outranks any infra phrase.
  const realFailure = REAL_FAILURE_SIGNATURES.find((sig) => text.includes(sig));
  if (realFailure) {
    return {
      transient: false,
      reason: `real failure signature present: "${realFailure}"`,
    };
  }

  const infra = TRANSIENT_INFRA_SIGNATURES.find((sig) => text.includes(sig));
  if (infra) {
    return { transient: true, reason: `transient infrastructure: "${infra}"` };
  }

  return {
    transient: false,
    reason: 'no known transient-infrastructure signature — treating as a real failure',
  };
}

module.exports = {
  classifyCiFailure,
  TRANSIENT_INFRA_SIGNATURES,
  REAL_FAILURE_SIGNATURES,
};

// --- CLI ------------------------------------------------------------------
// Usage: node .github/scripts/classify-ci-failure.js <path-to-log>
//
// ALWAYS exits 0, even for a real failure: this runs in the retry workflow, and
// exiting non-zero there would turn "we correctly declined to retry" into a
// second red run and a second failure email (alarm fatigue). The verdict travels
// via the step output instead.
if (require.main === module) {
  const fs = require('fs');
  const logPath = process.argv[2];

  let logText = '';
  try {
    logText = fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    console.log(`Could not read log at "${logPath}": ${err.message}`);
  }

  const { transient, reason } = classifyCiFailure(logText);
  console.log(`transient=${transient} (${reason})`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `transient=${transient}\nreason=${reason}\n`
    );
  }
}
