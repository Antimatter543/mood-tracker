/**
 * Verifies the jest timezone pin (jest.tz.js) is actually in effect.
 *
 * The whole timezone-day-keying bug class is invisible when jest runs in UTC.
 * `jest.tz.js` pins TZ=Australia/Brisbane (UTC+10, no DST) as the FIRST entry
 * in package.json `setupFiles`. If that pin is ever dropped or reordered, this
 * fails loudly — protecting every other TZ-sensitive test from silently
 * reverting to a UTC environment where the regression tests would pass
 * vacuously.
 */
describe('jest timezone pin', () => {
  it('runs under Australia/Brisbane (UTC+10, offset -600 minutes)', () => {
    expect(process.env.TZ).toBe('Australia/Brisbane');
    // getTimezoneOffset() returns minutes BEHIND UTC, negative for east-of-UTC.
    // Brisbane is UTC+10 with no DST, so it's -600 year-round.
    expect(new Date('2026-06-13T00:00:00Z').getTimezoneOffset()).toBe(-600);
    expect(new Date('2026-12-25T00:00:00Z').getTimezoneOffset()).toBe(-600);
  });

  it('local-component dates resolve to the Brisbane instant (proves the env, not just the var)', () => {
    // Local midnight Brisbane on 2026-06-11 is 2026-06-10T14:00:00Z. This is the
    // exact "backdated entry stored as previous UTC day" scenario the day-keying
    // fix targets — if TZ weren't pinned, this instant would differ.
    expect(new Date(2026, 5, 11, 0, 0, 0).toISOString()).toBe('2026-06-10T14:00:00.000Z');
  });
});
