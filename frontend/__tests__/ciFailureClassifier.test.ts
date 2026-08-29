/**
 * __tests__/ciFailureClassifier.test.ts
 *
 * Guards the CI auto-retry decision (.github/scripts/classify-ci-failure.js, driven
 * by .github/workflows/rerun-infra-failures.yml).
 *
 * WHY THIS EXISTS: an auto-retry has exactly one catastrophic failure mode —
 * laundering a REAL build break into "just a flake", so a broken release lane looks
 * merely unreliable while burning 30-55 minutes of CI per pointless attempt. The
 * property that must hold forever is therefore not "runner shutdowns get retried"
 * but "**nothing else does**". Both directions are asserted below, with the positive
 * case pinned to the verbatim log of the real incident (run 30156783723 attempt 1,
 * 2026-07-25) rather than to a phrase someone remembered.
 *
 * These are pure string/fs assertions — no device, no native module, no network.
 */
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CJS CI script, shared verbatim with the workflow that runs it via `node`
const {
  classifyCiFailure,
  REAL_FAILURE_SIGNATURES,
} = require('../../.github/scripts/classify-ci-failure.js');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/release-apk.yml');
const RETRY_WORKFLOW = path.join(
  REPO_ROOT,
  '.github/workflows/rerun-infra-failures.yml'
);

/**
 * Verbatim tail of the real failure: "Release APK" run 30156783723 attempt 1,
 * 2026-07-25, killed 27 minutes into `bundleRelease`. Note what is NOT here — no
 * gradle `FAILURE:` banner, because the runner died before gradle could print one.
 * That absence is exactly what makes the deny-list below safe.
 */
const RUNNER_SHUTDOWN_LOG = [
  '2026-07-25T12:12:15.1191574Z > Task :app:expandReleaseArtProfileWildcards',
  '2026-07-25T12:12:16.2170356Z > Task :app:mergeReleaseJavaResource',
  '2026-07-25T12:12:27.6337246Z ##[error]The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.',
  '2026-07-25T12:12:28.0279120Z ##[error]The operation was canceled.',
  '2026-07-25T12:12:28.0441908Z Cleaning up orphan processes',
].join('\n');

/** A genuine gradle break: compiles, fails, prints its banner. */
const GRADLE_FAILURE_LOG = [
  '2026-07-25T12:00:00.0000000Z > Task :app:compileReleaseKotlin FAILED',
  "2026-07-25T12:00:01.0000000Z e: file:///home/runner/work/app/Main.kt:3:1 unresolved reference: nope",
  '2026-07-25T12:00:02.0000000Z FAILURE: Build failed with an exception.',
  '2026-07-25T12:00:03.0000000Z ##[error]Process completed with exit code 1.',
].join('\n');

describe('classifyCiFailure — retries runner/platform faults', () => {
  it('retries the real 2026-07-25 runner-shutdown failure', () => {
    const verdict = classifyCiFailure(RUNNER_SHUTDOWN_LOG);
    expect(verdict.transient).toBe(true);
    expect(verdict.reason).toContain('The runner has received a shutdown signal');
  });

  it('retries a runner that lost communication with the Actions service', () => {
    expect(
      classifyCiFailure(
        '##[error]The runner has lost communication with the server. Verify the machine is running.'
      ).transient
    ).toBe(true);
  });

  it('retries an Actions CDN failure fetching a third-party action', () => {
    expect(
      classifyCiFailure('##[error]Failed to download action ' + "'https://api.github.com/repos/actions/checkout/tarball/v4'.").transient
    ).toBe(true);
  });
});

describe('classifyCiFailure — never launders a real break into a retry', () => {
  it('does NOT retry a genuine gradle build failure', () => {
    const verdict = classifyCiFailure(GRADLE_FAILURE_LOG);
    expect(verdict.transient).toBe(false);
    expect(verdict.reason).toContain('FAILURE: Build failed with an exception');
  });

  it('does NOT retry a bare "operation was canceled" (concurrency / manual cancel / timeout)', () => {
    // The failing STEP's log in the 2026-07-25 incident contained only this line —
    // which is why the workflow must scan the whole job log, and why this phrase on
    // its own must never be treated as a retryable signature.
    expect(
      classifyCiFailure(
        '2026-07-25T12:12:28.0279120Z ##[error]The operation was canceled.'
      ).transient
    ).toBe(false);
  });

  it('does NOT retry a job that exceeded its own time limit', () => {
    expect(
      classifyCiFailure(
        '##[error]The job running on runner GitHub Actions 9 has exceeded the maximum execution time of 360 minutes.'
      ).transient
    ).toBe(false);
  });

  it('does NOT retry when a real failure and an infra phrase BOTH appear (deny-list wins)', () => {
    // A retry decision must degrade safely: if we cannot tell the two apart, the run
    // stays red. Ordering inside the log must not change the verdict either.
    const realThenInfra = `${GRADLE_FAILURE_LOG}\n${RUNNER_SHUTDOWN_LOG}`;
    const infraThenReal = `${RUNNER_SHUTDOWN_LOG}\n${GRADLE_FAILURE_LOG}`;
    expect(classifyCiFailure(realThenInfra).transient).toBe(false);
    expect(classifyCiFailure(infraThenReal).transient).toBe(false);
  });

  it('does NOT retry an unrecognised failure (fail safe)', () => {
    expect(
      classifyCiFailure('##[error]Process completed with exit code 1.').transient
    ).toBe(false);
  });

  it.each([undefined, null, '', '   \n  '])(
    'does NOT retry when the log is unavailable (%p)',
    (log) => {
      expect(classifyCiFailure(log as unknown as string).transient).toBe(false);
    }
  );
});

describe('CLASS INVARIANT: every guarded release-apk.yml error is on the deny-list', () => {
  // The deny-list names our own `::error::` guard messages by literal text. Renaming a
  // guard in release-apk.yml without updating the list would silently orphan the entry
  // and let that guard's failure be auto-retried. This ties the two files together so
  // that drift fails here instead of in production.
  const releaseWorkflow = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');
  const ownGuardSignatures: string[] = REAL_FAILURE_SIGNATURES.filter(
    (sig: string) => sig.startsWith('::error::')
  );

  it('has at least one workflow guard on the deny-list', () => {
    expect(ownGuardSignatures.length).toBeGreaterThan(0);
  });

  it.each(ownGuardSignatures)(
    'release-apk.yml still emits %s',
    (signature: string) => {
      expect(releaseWorkflow).toContain(signature);
    }
  );

  it('classifies each guard failure as a real (non-retryable) failure', () => {
    for (const signature of ownGuardSignatures) {
      const verdict = classifyCiFailure(`some log\n${signature} something\n`);
      expect(verdict.transient).toBe(false);
    }
  });
});

describe('CLASS INVARIANT: the auto-retry workflow cannot loop or mask breaks', () => {
  const retryWorkflow = fs.readFileSync(RETRY_WORKFLOW, 'utf8');
  // The workflow's comments deliberately NAME the forbidden patterns while explaining
  // why they are avoided — so negative assertions must only see executable lines.
  // (YAML comments and the shell comments inside `run:` blocks both use leading `#`.)
  const retryWorkflowCode = retryWorkflow
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  it('only acts on a hard failure, never on a cancelled run', () => {
    expect(retryWorkflow).toContain(
      "github.event.workflow_run.conclusion == 'failure'"
    );
  });

  it('gates the rerun on attempt 1 only — the infinite-loop stop', () => {
    // A rerun re-fires `workflow_run: completed`; without this gate the workflow would
    // retry its own retry forever.
    expect(retryWorkflow).toContain("steps.attempt.outputs.run_attempt == '1'");
    const rerunStep = retryWorkflow.slice(retryWorkflow.indexOf('Re-run failed jobs'));
    expect(rerunStep).toContain("steps.attempt.outputs.run_attempt == '1'");
    expect(rerunStep).toContain("steps.classify.outputs.transient == 'true'");
  });

  it('reads run_attempt from the REST API, not the undocumented webhook field', () => {
    expect(retryWorkflowCode).toContain("--jq '.run_attempt'");
    expect(retryWorkflowCode).not.toContain(
      'github.event.workflow_run.run_attempt'
    );
  });

  it('scans the FULL attempt log, never just the failed step', () => {
    // The line identifying a runner shutdown lives only in the job-level log, so
    // `--log-failed` would miss the entire class this workflow exists for.
    expect(retryWorkflowCode).toContain('/attempts/1/logs');
    expect(retryWorkflowCode).not.toContain('--log-failed');
  });
});

describe('CLASS INVARIANT: every release publish step retries transient API errors', () => {
  const releaseWorkflow = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');

  it('wraps every `gh release create` in a backoff retry', () => {
    // Both publish steps run at the very end of a 30-55 minute job, so an un-retried
    // one-shot API call there can throw away the whole build (Nudge run 29710052363,
    // 2026-07-20). Count them so a newly added publish step must be wrapped too.
    const creates = releaseWorkflow.match(/gh release create/g) ?? [];
    const retries = releaseWorkflow.match(/retry_with_backoff/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect(retries.length).toBeGreaterThanOrEqual(creates.length);
  });

  it('sources the shared retry helper rather than re-implementing backoff', () => {
    expect(releaseWorkflow).toContain('.github/scripts/retry.sh');
    expect(fs.existsSync(path.join(REPO_ROOT, '.github/scripts/retry.sh'))).toBe(true);
  });
});
