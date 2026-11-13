/**
 * QA seed channel: shared constants.
 *
 * SECURITY: everything under `lib/qa/` is a TEST-ONLY backdoor that rewrites the
 * on-device database. It exists ONLY in builds made with `EXPO_PUBLIC_QA=1`
 * (the CI e2e/emulator lane). The single entry point is the guarded `require`
 * in `app/_layout.tsx`. In every other build babel-preset-expo inlines the flag
 * to `undefined`, Metro's constant-folding pass deletes the `if` block BEFORE it
 * collects dependencies, and this directory never enters the bundle.
 *
 * Proof that it stays out of release builds:
 *   - `__tests__/qaSeedGuard.test.ts`: the guard's exact shape, nothing else
 *     imports `lib/qa`, no release config sets the flag, and the guard really
 *     folds away under the production transform (with a counterfactual).
 *   - `.github/workflows/qa-seed-guard.yml`: bundles release vs QA on every PR
 *     and greps both for QA_SEED_MARKER and QA_SEED_PATH (0 vs >= 1).
 *   - `.github/workflows/release-apk.yml`: the same grep on the JS bundle
 *     extracted from the real release APK and AAB.
 *
 * Both strings below are used at RUNTIME (log prefix, link matching) so the
 * minifier keeps them as literals. That is what makes the bundle grep a real
 * positive control in the QA build.
 */

/** Grep marker. Present in a QA bundle, absent from every release bundle. */
export const QA_SEED_MARKER = 'soulsync-qa-seed:present';

/** Deep-link path (after the scheme). Also grepped for by CI. */
export const QA_SEED_PATH = 'qa/seed';

/**
 * The app's URL scheme (app.json `expo.scheme`; a test keeps them in sync).
 * `myapp` is a generic scheme other apps can claim too. That does not change
 * this link's risk: release builds do not contain the handler at all.
 */
export const QA_LINK_SCHEME = 'myapp';

/** Allowlisted fixtures. Anything else is rejected before any I/O. */
export const QA_SCENARIOS = ['empty', 'week', 'timeline300', 'yearBoundary', 'oneBucket', 'weekHealth'] as const;
export type QaScenario = (typeof QA_SCENARIOS)[number];

/**
 * `user_settings` key written by every successful seed. A seed refuses to wipe a
 * database that holds entries but lacks this key (hand-entered data), so a stray
 * link fired at a QA build by another app can't destroy real-looking data.
 * The settings loader only reads registry keys, so the extra row is inert.
 */
export const QA_SEEDED_SETTING_KEY = 'qa_seeded';

/**
 * `user_settings` key holding the seed's frozen "now" (UTC ISO), absent when the
 * link had none. The frozen clock (lib/clock.ts) lives in memory, so a relaunch
 * would otherwise revert "today" to the device clock while the data stays
 * anchored at the seed's instant; QaSeedHost re-applies it on every launch.
 */
export const QA_FROZEN_NOW_SETTING_KEY = 'qa_frozen_now';

/** Hard cap on the raw link length, checked BEFORE any decoding. */
export const QA_MAX_LINK_LENGTH = 256;
