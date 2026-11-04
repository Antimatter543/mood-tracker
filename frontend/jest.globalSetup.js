// jest.globalSetup.js
//
// Pin the whole suite to a NON-UTC timezone. Australia/Brisbane = UTC+10 with no
// daylight saving, so the offset is fixed and deterministic. Many tests assert
// local-day behaviour ("SQLite date() keyed in UTC lands late-evening entries on
// the wrong day"), which is invisible when the machine runs in UTC (every CI runner).
//
// WHY globalSetup and not `setupFiles`: setupFiles run INSIDE each test environment,
// after the worker process has already started, so a process.env.TZ set there is too
// late for any worker that already initialised Date (run 41391779525 failed 12+ tests
// on a UTC runner despite the old jest.tz.js). globalSetup runs once in the parent
// process before workers spawn, and workers inherit its environment.
// `__tests__/timezonePinned.test.ts` guards this.
module.exports = async () => {
  process.env.TZ = 'Australia/Brisbane';
};
