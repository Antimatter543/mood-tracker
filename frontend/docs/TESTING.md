# Testing: which layer a change owes

Read this when you decide what tests a change needs. The rule is: use the cheapest layer that would have caught the bug. A device finds the same bug for 20 minutes of a person's time; a jest test finds it in a second on every PR. The Pixel pass (L6) is for what only hardware can show. Its fixed checklist is `frontend/docs/device-qa-checklist.md`.

Helpers and their rules: `frontend/testing/README.md`. Release and CI mechanics: the repo `CLAUDE.md` ("Build / test / gates", "On-device QA").

## Cadence (read first)

- Per commit: `npx tsc --noEmit` and the scoped tests for the files you touched, for example `cd frontend && npx jest __tests__/streakStats.test.ts`.
- The full suite runs in CI (`.github/workflows/pr-checks.yml`: `npx tsc --noEmit`, then `npx jest --silent --ci`) on every PR and every push to main. Never run it on the laptop; it makes Anti's machine lag. `scripts/release.sh` gates on a green `pr-checks.yml` run for the same tree, not on a local jest run.
- Never start an emulator, record goldens, or run `frontend/scripts/e2e-smoke.sh` on the laptop. The script drives whatever adb device is attached. CI does all three.
- Native builds go to CI too (`release-apk.yml`), never local.

## Routing table

| Layer | A change owes it when | Run | Why this layer |
|---|---|---|---|
| L0 tsc | Always. Any TypeScript edit. | `cd frontend && npx tsc --noEmit` | Free and whole-repo. It is the only check that sees a wrong prop or a Date where a string was expected. |
| L1 pure transforms and builders | You add or change a function from data to data: a chart transform, a date formatter, a streak rule. | `npx jest __tests__/<name>.test.ts`. Builders: `testing/builders.ts`. | No React and no DB, so it runs in milliseconds and can be exhaustive. Pass `now` / `today` in; do not read the clock. |
| L2 RNTL components | A screen or component renders or reacts differently: labels, empty states, press handlers, theme tokens, insets. | `npx jest __tests__/<name>.test.tsx`. Helpers: `testing/rntl.ts`, `testing/theme.ts`, `testing/platform.ts`. | Catches a wrong render path without a device. It does not prove layout, touch dispatch or animation; those need L5 or L6. |
| L3 real-SQLite integration | You touch SQL, a migration, a write path, or a read that depends on a join or ordering. | `npx jest __tests__/<name>.integration.test.ts`. Helpers: `describeSqlite`, `openMigratedSqlite()` in `testing/realSqlite.ts`. | A mocked DB only returns what the test scripts, so it cannot show that the shipped schema and the query agree. `describeSqlite` fails on CI when sqlite is missing and never skips silently. |
| L4 source scans | A bug is about SHAPE that neither tsc nor a behavioural test sees: a banned import, a call that must sit next to another, "every X also does Y". Read files only through `testing/sourceScan.ts`. | `npx jest __tests__/<name>.test.ts` | Cheap and blunt, so it is allowed for shape only. Cite the bug commit in the header, assert the invariant and not the spelling, and delete it once tsc or lint enforces the shape. A scan that checks behaviour is a missing L1-L3 test. |
| L5 emulator Maestro smoke | A flow depends on real navigation, touch dispatch through the in-tree overlays, or the release bundle. | CI only: `gh workflow run e2e.yml -R Antimatter543/mood-tracker --ref <branch> -f flows=03-timeline-delete-undo`, or label the PR `run-e2e`. Flows: `frontend/.maestro/smoke/*.yaml`. | A QA APK on an API 34 emulator drives the overlays the way a finger does, in CI, for free. It takes about 20 minutes, so it carries a few smoke flows, not coverage. |
| L5b goldens | A layout or visual change a person would otherwise have to look at. | CI only. Another lane (E) is building this; see the goldens subsection of the repo `CLAUDE.md` once it lands. | Placeholder row: this file does not describe goldens until that subsection exists. |
| L6 the Pixel release pass | Once per release. | A `device-tester` run on the Pixel 3 from `frontend/docs/device-qa-checklist.md`, never a fresh prose walk. | Only the real device has Health Connect, real notification timing, real fling cost, the Play install path and real fingers. |

Pick the lowest row that can see the failure. Add a higher row only for what the lower rows cannot see.

## Where things live

- `frontend/__tests__/`: every jest suite. Anything under it is a suite, so helpers do not go here.
- `frontend/testing/`: shared test helpers (builders, `fakeDb`, `realSqlite`, `theme`, `platform`, `clock`, `rntl`, `sourceScan`). App code never imports from it. Do not redefine one per file; see its README.
- `frontend/__mocks__/`: module mocks (`expo-sqlite`, `expo-notifications`, `expo-argon2`, the FlashList probe under `@shopify/`).
- `frontend/.maestro/smoke/`: the CI smoke flows, with `subflows/launch.yaml` and `subflows/add-entry.yaml`. A new flow needs the yaml and its name in `SMOKE_FLOWS` in `frontend/scripts/e2e-smoke.sh`; `__tests__/maestroFlowLint.test.ts` checks they agree.
- `frontend/.maestro/soulsync-tour.yaml` and `timeline-fling.yaml`: device walks for the Pixel pass. CI does not run them.
- Test data on a device or emulator: the QA seed link (below), not hand-made entries.

## The injected clock

App code reads time through `now()` from `frontend/lib/clock.ts`, never `new Date()` or `Date.now()` for "now". `__tests__/clockInjection.test.ts` scans for violations. Pure transforms take `now` / `today` as a required parameter.

In a test, call `freezeNow()` from `@/testing/clock` in `beforeEach` or inside the test (the freeze is cleared before every test, so `beforeAll` does nothing), and assert against the instant it returns, exactly. Why: a hardcoded date against code that reads the wall clock passes until that date arrives, then goes red on every branch at once. A "between before and after" bracket races midnight.

CI backs this with `.github/workflows/future-clock.yml`. It reruns the whole suite with the clock shifted a year and three years ahead (libfaketime), weekly and on PRs that touch transforms, `databases/` or the clock files. Other horizons: `gh workflow run future-clock.yml -R Antimatter543/mood-tracker --ref <branch> -f days='[30, 730]'`. A red leg is a new time bomb; pin that test's now with `freezeNow`. Jest runs in Australia/Brisbane time, pinned by `jest.globalSetup.js`.

## The QA seed link

QA builds only (`EXPO_PUBLIC_QA=1`) accept `myapp://qa/seed?scenario=<empty|week|timeline300|yearBoundary>&now=<UTC instant>`. It wipes the DB, seeds the scenario, and optionally freezes the app clock, so a flow sees the same data and the same "today" every run. Smoke flows reach it through `openLink` in `.maestro/smoke/subflows/launch.yaml` and then wait on testID `qa-seed-status`. Why: a seed link is deterministic and fast; tapping through entry forms is neither.

It must never ship. Release-absence is proved three ways:

- `__tests__/qaSeedGuard.test.ts`, in the PR gate.
- `.github/workflows/qa-seed-guard.yml`, which greps a release bundle and a QA bundle on each PR. The QA bundle is the positive control.
- A step in `release-apk.yml` that runs `.github/scripts/qa-seed-bundle-check.sh <bundle> absent` on the real APK and AAB bundles before upload.

Only `qa-seed-guard.yml` and `e2e*.yml` may set `EXPO_PUBLIC_QA`; never `release-apk.yml`, `eas.json`, `app.json` or a tracked `.env`.

## A bug found on a device also gets a cheaper test

When a device pass or a user report finds a bug, the fix is not done until the layer that should have caught it has a test. Ask which row above could have seen it, write that test, and prove it with a counterfactual: revert the fix (or apply the old rule) and watch the new test fail. A test that was never red proves nothing. State the counterfactual in the PR. If the honest answer is "only L6", say that, and add the case to `device-qa-checklist.md`.

Why: a device finding is a one-time catch and the test is the permanent one. The testing plan (`ops/routes/soulsync/research/testing-conversion-plan.md`) counted 7 of 15 past bugs as cheap jest catches that went unwritten.

## Class bugs get a class test at feature time

If a bug is one instance of a pattern, test the pattern, not the instance, and write it when you add the feature so the next write path or screen is covered before it exists.

- **A setting must reach every screen (#14, #17).** `10002fa` made the Stats period header follow `date_format` (#14). `b6929ea` found four more charts with the same gap (#17). `__tests__/visualisationsDateFormatInvariant.test.ts` now checks every visualisation, not one.
- **Every write must broadcast (2026-07-13, `1c050b8`).** The July fix refreshed Home after an entry write. Activity-catalogue writes and Health Connect disconnect/sync kept the same stale-screen shape until `1c050b8` (2026-09-05). `__tests__/writesBroadcastDataRefresh.test.ts` is the class test, an L4 scan because the shape is "every write path also refetches".
- **One rule, not several (#7).** The streak was computed in several places with different answers. `1a9009c` and `5b506e3` moved it to one rule and one history; `__tests__/streakStats.test.ts` and `__tests__/loadStreakStats.test.ts` pin it.

The same applies to bugs only a device could show. The blank-page bug from a live reanimated style on a page container hit Stats (2026-07-13) and Home (2026-09-05); `__tests__/layoutContentNotAnimated.test.tsx` now pins the shape that caused it.

## Before you open the PR

1. `npx tsc --noEmit` is clean.
2. The scoped tests for the touched files pass.
3. A bug fix has a test that failed before the fix, and the PR states the counterfactual.
4. New behaviour has tests at the lowest layer that can see it.
5. Date, locale or timezone logic uses `freezeNow` or a passed-in `now`.
6. Anything only a device can show is in `device-qa-checklist.md`, not left as a prose step.
