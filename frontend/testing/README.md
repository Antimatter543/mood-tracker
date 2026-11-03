# frontend/testing: shared test helpers

Test-only code. App code never imports from here (`__tests__/testingHelpers.test.tsx` scans for it).
Import each module directly. There is no barrel, because the modules load different production code.

| Module | Use it for |
|---|---|
| `builders.ts` | One builder per domain type, with defaults derived from production: `makeEntry` / `makeEntries(n, i => over)`, `makeActivity` / `seedActivity`, `makeGroup` / `seedGroup`, `makePhoto`, `makeReminder`, `makeHealthDay`, `makeEntryRow`. Also day-string date helpers (`localAt`, `localMidnight`, `localIso`, `dayKey`, `dayKeys`, `addDays`, `FIXED_DAY`, `FIXED_NOW`). Override only the fields the test is about. |
| `fakeDb.ts` | `makeDb()` gives a mocked expo-sqlite DB that is also the write connection. It can be scripted by SQL pattern. `sqlCalls` / `sqlParams` find statements. `resetWriteLayer()` goes in `beforeEach`. Works in suites that mock `expo-sqlite` or `writeTransaction` themselves. |
| `mockSqliteDb.ts` | The mock DB object itself (`createMockDatabase`), shared with `__mocks__/expo-sqlite.ts`. Prefer `makeDb()`. |
| `realSqlite.ts` | A real engine (`node:sqlite`). Use `describeSqlite`, which FAILS on CI when sqlite is missing and never skips silently. `openSqlite({ schema })`, or `openMigratedSqlite()` for the shipped schema (runs every migration, seeds included). `countRows`. Rows are null-prototype objects: compare with `toEqual`. |
| `theme.ts` | Real theme tokens: `THEME` (the fresh-install theme) and `themeTokens(name)`. Mock with `jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule())`. |
| `platform.ts` | Platform mocks installed for EVERY suite by `jest.setup.ts`: reanimated, safe-area insets and `useKeyboardHeight`. Steer them with `setInsets(INSETS.THREE_BUTTON_NAV)`, `setKeyboardHeight(804)` and `animatedScroll.toEnd`. |
| `async.ts` | `deferred<T>()`: a promise the test settles by hand. |
| `rntl.ts` | Render-tree helpers: `styleOf`, `walkTree`, `findNodes`, `collectByStyle`, `countByType`, `svgStrings`. |
| `sourceScan.ts` | The shared source-scan helper, for shape bugs only. |

## Rules (see code-quality-reference §9)
- Never redefine one of these per file. An input shape that only ONE suite uses (a transform's raw row type, say) may stay a local helper in that suite: do not invent a shared builder for it.
- Never invent a palette, an inset or a default mood.
- Never read the real clock in a fixture. (Clock injection is a separate change; until it lands, leave a suite's existing `jest.useFakeTimers` / `setSystemTime` / `Date.now` handling as it is.)

## Platform mocks
- State resets before EVERY test (`jest.afterEnv.ts`). Call `setInsets` / `setKeyboardHeight` in a `beforeEach` or inside the test. A call in `beforeAll` is undone before the first test.
- A suite's own `jest.mock('react-native-safe-area-context' | 'react-native-reanimated' | '@/hooks/useKeyboardHeight', ...)` silently REPLACES the global mock, and `setInsets` then does nothing. Delete the local mock when you adopt the setters.
- The state lives on `globalThis`, so the setters keep working after `jest.resetModules()` / `jest.isolateModules()`.
- `jest.setup.ts` also keeps gesture-handler on its plain-JS path. The reanimated stub would otherwise pass gesture-handler's "is reanimated installed" probe.

## Converting old local date helpers
Builders take `'YYYY-MM-DD'` strings and throw on an impossible day (`'2026-02-30'`, month `00`). Check the month base of the helper you replace. An off-by-one moves the input and the expectation together, so the test still passes.

| Old local helper | Shared equivalent | Note |
|---|---|---|
| `new Date(2026, 5, 15)` (0-based month) | `localMidnight('2026-06-15')` | month + 1 |
| `at(2026, 5, 15, 9)` (0-based month) | `localAt('2026-06-15', 9)` | month + 1 |
| `at(2026, 6, 15, 9)` (1-based month) | `localAt('2026-06-15', 9)` | same digits |
| `localMidnight(y, m0, d)` returning an ISO string | `localIso('YYYY-MM-DD', 0)` | the shared `localMidnight` returns a Date |
| `new Date(y, m0, d, h).toISOString()` | `localIso('YYYY-MM-DD', h)` | |
| `days(n)` | `dayKeys(n, from)` | pass the old start day explicitly |

Run `npx tsc --noEmit` on every converted batch: a Date where a string was expected only shows up there.
