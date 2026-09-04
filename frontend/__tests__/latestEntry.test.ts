// latestEntry.test.ts — "what did I actually write that day", for the scrub readout.
//
// The whole suite runs in Australia/Brisbane (UTC+10, no DST — jest.tz.js).
// That matters here: an entry stored at 2026-09-02T15:30:00Z is 2026-09-03
// 01:30 LOCAL, and this map MUST key it to the 3rd. Keying it in UTC is the
// exact day-shift class the visualisation layer is built to avoid.

import {
    firstNoteLine,
    formatEntryTime,
    formatReadoutDay,
    latestEntryPerDay,
    type EntryDetailRow,
} from '@/components/visualisations/transforms/latestEntry';

const entry = (
    id: number,
    date: string,
    mood: number,
    notes: string | null = null
): EntryDetailRow => ({ id, date, mood, notes });

describe('latestEntryPerDay', () => {
    it('is empty for no rows', () => {
        expect(latestEntryPerDay([]).size).toBe(0);
    });

    it('keeps the MOST RECENT entry when a day has several', () => {
        const map = latestEntryPerDay([
            entry(1, '2026-09-02T00:00:00.000Z', 3, 'morning'),
            entry(2, '2026-09-02T09:00:00.000Z', 8, 'evening'),
        ]);
        // 00:00Z = 10am local, 09:00Z = 7pm local — same local day, later wins.
        expect(map.get('2026-09-02')?.mood).toBe(8);
        expect(map.get('2026-09-02')?.note).toBe('evening');
    });

    it('does not depend on row order', () => {
        const rows = [
            entry(2, '2026-09-02T09:00:00.000Z', 8),
            entry(1, '2026-09-02T00:00:00.000Z', 3),
        ];
        expect(latestEntryPerDay(rows).get('2026-09-02')?.mood).toBe(8);
    });

    it('keys to the LOCAL day across the UTC midnight boundary', () => {
        // 15:30Z on the 2nd is 01:30 on the 3rd in Brisbane.
        const map = latestEntryPerDay([entry(1, '2026-09-02T15:30:00.000Z', 6)]);
        expect(map.has('2026-09-03')).toBe(true);
        expect(map.has('2026-09-02')).toBe(false);
    });

    it('separates two entries that share a UTC day but not a local one', () => {
        const map = latestEntryPerDay([
            entry(1, '2026-09-02T02:00:00.000Z', 4), // 2nd, noon local
            entry(2, '2026-09-02T20:00:00.000Z', 9), // 3rd, 6am local
        ]);
        expect(map.get('2026-09-02')?.mood).toBe(4);
        expect(map.get('2026-09-03')?.mood).toBe(9);
    });

    it('skips degenerate rows instead of throwing (a half-imported DB is real)', () => {
        const map = latestEntryPerDay([
            entry(1, 'not-a-date', 5),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: 2, date: '2026-09-02T01:00:00.000Z', mood: 'x' as any, notes: null },
            entry(3, '2026-09-02T02:00:00.000Z', 7),
        ]);
        expect(map.size).toBe(1);
        expect(map.get('2026-09-02')?.mood).toBe(7);
    });

    it('carries the time and the first note line for the winning entry', () => {
        const map = latestEntryPerDay([
            entry(1, '2026-09-02T04:30:00.000Z', 6, '  \n  went for a run\nthen slept  '),
        ]);
        const got = map.get('2026-09-02')!;
        expect(got.note).toBe('went for a run');
        // 04:30Z = 14:30 Brisbane. Matched loosely because the format is
        // LOCALE-driven: a 12-hour locale renders "2:30 pm", a 24-hour one "14:30".
        expect(got.time).toMatch(/\b(14|2):30\b/);
    });
});

describe('firstNoteLine', () => {
    it('returns null when there is nothing to show', () => {
        expect(firstNoteLine(null)).toBeNull();
        expect(firstNoteLine(undefined)).toBeNull();
        expect(firstNoteLine('')).toBeNull();
        expect(firstNoteLine('   \n  \n ')).toBeNull();
    });

    it('takes the first NON-EMPTY line, trimmed', () => {
        expect(firstNoteLine('\n\n  hello world  \nsecond')).toBe('hello world');
    });

    it('never slices mid-word — a whole line or nothing', () => {
        const long = 'a'.repeat(400);
        expect(firstNoteLine(long)).toBe(long);
    });
});

describe('formatEntryTime', () => {
    it('renders the LOCAL clock time', () => {
        // Loose on the 12h/24h split (locale-driven), strict on the CLOCK.
        expect(formatEntryTime('2026-09-02T04:30:00.000Z')).toMatch(/\b(14|2):30\b/);
        // 23:05Z is 09:05 the NEXT local morning.
        expect(formatEntryTime('2026-09-02T23:05:00.000Z')).toMatch(/\b0?9:05\b/);
    });

    it('returns an empty string rather than throwing on garbage', () => {
        expect(formatEntryTime('nope')).toBe('');
    });
});

describe('formatReadoutDay', () => {
    it('names the day the user means, not the UTC one', () => {
        // Parsed at LOCAL midnight; a bare `new Date('2026-09-02')` would be UTC
        // midnight and name the 1st for anyone west of UTC.
        const label = formatReadoutDay('2026-09-02');
        expect(label).toContain('2');
        expect(label).toContain('Sep');
        expect(label).toContain('Wed');
    });

    it('passes an unparseable day straight through instead of throwing', () => {
        expect(formatReadoutDay('garbage')).toBe('garbage');
    });
});
