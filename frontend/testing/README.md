# frontend/testing: shared test helpers

Test-only code. App code never imports from here (`__tests__/testingHelpers.test.tsx` scans for it).
Import each module directly. There is no barrel, because the modules load different production code.

| Module | Use it for |
|---|---|
| `builders.ts` | One builder per domain type, with defaults derived from production: `makeEntry`, `makeActivity` / `seedActivity`, `makeGroup`, `makePhoto`, `makeReminder`, `makeHealthDay`, `makeEntryRow`. Also day-string date helpers (`localAt`, `localMidnight`, `localIso`, `dayKeys`, `addDays`, `FIXED_NOW`). Override only the fields the test is about. |
| `fakeDb.ts` | `makeDb()` gives a mocked expo-sqlite DB that is also the write connection. It can be scripted by SQL pattern. `sqlCalls` / `sqlParams` find statements. `resetWriteLayer()` goes in `beforeEach`. |
| `realSqlite.ts` | A real engine (`node:sqlite`). Use `describeSqlite`, which FAILS on CI when sqlite is missing and never skips silently. `openSqlite({ schema })`, or `openMigratedSqlite()` for the shipped schema (runs every migration, seeds included). `countRows`. |
| `theme.ts` | Real theme tokens: `THEME` (the fresh-install theme) and `themeTokens(name)`. Mock with `jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule())`. |
| `platform.ts` | Platform mocks installed for EVERY suite by `jest.setup.ts`: reanimated, safe-area insets and `useKeyboardHeight`. Steer them with `setInsets(INSETS.THREE_BUTTON_NAV)`, `setKeyboardHeight(804)` and `animatedScroll.toEnd`. They reset before each test (`jest.afterEnv.ts`). A suite needing the real module calls `jest.unmock(...)`. |
| `rntl.ts` | Render-tree helpers: `styleOf`, `walkTree`, `findNodes`, `collectByStyle`, `countByType`, `svgStrings`. |
| `sourceScan.ts` | The shared source-scan helper, for shape bugs only. |

Rules (see code-quality-reference §9):
- Never redefine one of these per file.
- Never invent a palette, an inset or a default mood.
- Never read the real clock in a fixture.
