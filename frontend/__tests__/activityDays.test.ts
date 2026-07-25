import { activityDaySet } from '@/components/visualisations/transforms/activityDays';

// Suite runs under the Brisbane pin (UTC+10, no DST — see jest.tz.js), so an
// instant's UTC calendar day can differ from its LOCAL calendar day. The dots
// must land on the user's LOCAL day.
describe('activityDaySet — keys raw instants to LOCAL days (Brisbane UTC+10)', () => {
  it('keys a UTC-edge instant to its LOCAL day, not the UTC day', () => {
    // 14:00Z Jun 30 = 00:00 Jul 1 in Brisbane -> local day is Jul 1.
    const set = activityDaySet([{ date: '2026-06-30T14:00:00.000Z' }]);
    expect(set.has('2026-07-01')).toBe(true);
    expect(set.has('2026-06-30')).toBe(false); // the naive UTC .slice(0,10) day
  });

  it('handles a late-evening entry across a month/year boundary', () => {
    // 15:00Z Jul 31 = 01:00 Aug 1 Brisbane.
    expect([...activityDaySet([{ date: '2026-07-31T15:00:00.000Z' }])]).toEqual([
      '2026-08-01',
    ]);
  });

  it('collapses multiple entries on the same local day to a single key', () => {
    const set = activityDaySet([
      { date: '2026-07-15T00:00:00.000Z' }, // 10:00 local Jul 15
      { date: '2026-07-15T09:00:00.000Z' }, // 19:00 local Jul 15
      { date: '2026-07-14T20:00:00.000Z' }, // 06:00 local Jul 15
    ]);
    expect([...set]).toEqual(['2026-07-15']);
  });

  it('empty / degenerate input yields an empty set and never throws', () => {
    expect(activityDaySet([]).size).toBe(0);
    expect(activityDaySet(undefined as unknown as { date: string }[]).size).toBe(0);
    expect(
      activityDaySet([
        { date: 'not-a-date' },
        { date: '' },
        null as unknown as { date: string },
      ]).size,
    ).toBe(0);
  });
});
