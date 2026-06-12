// jest.tz.js
//
// Pin the test suite to a NON-UTC timezone BEFORE any test code (or any module
// that captures the TZ at import time) runs. This is the single most important
// guard against the whole class of "SQLite date()/strftime keyed in UTC, so
// backdated/late-evening entries land on the wrong local day" bugs — those are
// INVISIBLE when jest runs in UTC (the CI/dev machine's default), which is
// exactly why such a bug shipped undetected.
//
// MUST be FIRST in package.json `jest.setupFiles` (before jest.setup.ts), so
// process.env.TZ is set before Node's Date machinery is initialised.
//
// Australia/Brisbane = UTC+10 with NO daylight saving → a fixed, deterministic
// offset. The app's owner is in AEST (UTC+10), so this also mirrors the real
// reported symptom exactly.
process.env.TZ = 'Australia/Brisbane';
