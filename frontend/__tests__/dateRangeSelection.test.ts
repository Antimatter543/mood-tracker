/**
 * Unit tests for the Stats date-range picker's selection logic
 * (transforms/dateRangeSelection.ts).
 *
 * This is the two-tap protocol a user drives with their thumb, so the bugs it
 * can hide are all "the calendar did something other than what I pointed at":
 *   - a second tap EARLIER than the first silently becoming a backwards range
 *     (or being swallowed with no feedback),
 *   - a third tap extending a finished range instead of starting a new one, so
 *     the user can never re-pick without closing the sheet,
 *   - a marking dict that leaves the middle of the range unpainted, which reads
 *     as "only the two ends are selected",
 *   - a summary line that spells the range differently from the header label it
 *     is about to become.
 */
import {
    advanceSelection,
    buildRangeMarking,
    isComplete,
    selectionRange,
    selectionSummary,
    type RangeSelection,
} from '@/components/visualisations/transforms/dateRangeSelection';
import { formatDayRangeLabel } from '@/components/visualisations/transforms/periodWindow';
import { DATE_FORMAT_PREFS } from '@/lib/dateFormat';

const TODAY = '2026-08-29';

const COLORS = {
    endpoint: '#4CAF50',
    onEndpoint: '#FFFFFF',
    fill: 'rgba(76,175,80,0.1)',
    onFill: '#FFFFFF',
};

describe('advanceSelection — the two-tap protocol', () => {
    it('first tap opens a range, leaving the end unset', () => {
        expect(advanceSelection(null, '2026-08-15')).toEqual({
            startDay: '2026-08-15',
            endDay: null,
        });
    });

    it('second tap closes the range', () => {
        const open = advanceSelection(null, '2026-08-15');
        expect(advanceSelection(open, '2026-08-29')).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-29',
        });
    });

    it('a second tap BEFORE the start becomes the start, not an error', () => {
        const open = advanceSelection(null, '2026-08-29');
        expect(advanceSelection(open, '2026-08-15')).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-29',
        });
    });

    it('tapping the same day twice selects that single day', () => {
        const open = advanceSelection(null, '2026-08-15');
        expect(advanceSelection(open, '2026-08-15')).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-15',
        });
    });

    it('a tap on a COMPLETE range starts over (no accidental extension)', () => {
        const complete: RangeSelection = { startDay: '2026-08-15', endDay: '2026-08-29' };
        expect(advanceSelection(complete, '2026-07-01')).toEqual({
            startDay: '2026-07-01',
            endDay: null,
        });
    });

    it('orders correctly across month and year boundaries', () => {
        const open = advanceSelection(null, '2026-01-05');
        expect(advanceSelection(open, '2025-12-20')).toEqual({
            startDay: '2025-12-20',
            endDay: '2026-01-05',
        });
    });
});

describe('isComplete / selectionRange', () => {
    it('treats an open range as incomplete and yields no range', () => {
        const open: RangeSelection = { startDay: '2026-08-15', endDay: null };
        expect(isComplete(open)).toBe(false);
        expect(selectionRange(open)).toBeNull();
        expect(isComplete(null)).toBe(false);
        expect(selectionRange(null)).toBeNull();
    });

    it('yields the range once closed', () => {
        const done: RangeSelection = { startDay: '2026-08-15', endDay: '2026-08-29' };
        expect(isComplete(done)).toBe(true);
        expect(selectionRange(done)).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-29',
        });
    });
});

describe('buildRangeMarking', () => {
    it('marks nothing when nothing is selected', () => {
        expect(buildRangeMarking(null, COLORS)).toEqual({});
    });

    it('gives immediate feedback on the first tap (a closed single pill)', () => {
        const marking = buildRangeMarking({ startDay: '2026-08-15', endDay: null }, COLORS);
        expect(Object.keys(marking)).toEqual(['2026-08-15']);
        expect(marking['2026-08-15']).toEqual({
            startingDay: true,
            endingDay: true,
            color: COLORS.endpoint,
            textColor: COLORS.onEndpoint,
        });
    });

    it('paints EVERY day between the ends, not just the ends', () => {
        const marking = buildRangeMarking(
            { startDay: '2026-08-27', endDay: '2026-08-30' },
            COLORS,
        );
        expect(Object.keys(marking).sort()).toEqual([
            '2026-08-27',
            '2026-08-28',
            '2026-08-29',
            '2026-08-30',
        ]);
        expect(marking['2026-08-27']).toEqual({
            startingDay: true,
            color: COLORS.endpoint,
            textColor: COLORS.onEndpoint,
        });
        expect(marking['2026-08-30']).toEqual({
            endingDay: true,
            color: COLORS.endpoint,
            textColor: COLORS.onEndpoint,
        });
        // Interior days carry the softer fill and no rounding flags.
        expect(marking['2026-08-28']).toEqual({
            color: COLORS.fill,
            textColor: COLORS.onFill,
        });
    });

    it('spans month and year boundaries without a gap', () => {
        const marking = buildRangeMarking(
            { startDay: '2025-12-30', endDay: '2026-01-02' },
            COLORS,
        );
        expect(Object.keys(marking).sort()).toEqual([
            '2025-12-30',
            '2025-12-31',
            '2026-01-01',
            '2026-01-02',
        ]);
    });

    it('marks a one-day range as a single round pill', () => {
        const marking = buildRangeMarking(
            { startDay: '2026-08-15', endDay: '2026-08-15' },
            COLORS,
        );
        expect(marking).toEqual({
            '2026-08-15': {
                startingDay: true,
                endingDay: true,
                color: COLORS.endpoint,
                textColor: COLORS.onEndpoint,
            },
        });
    });

    it('has a day count matching the inclusive span for a long range', () => {
        const marking = buildRangeMarking(
            { startDay: '2026-08-15', endDay: '2026-09-13' },
            COLORS,
        );
        expect(Object.keys(marking)).toHaveLength(30);
    });

    it('falls back to endpoints only on an absurd span instead of looping forever', () => {
        const marking = buildRangeMarking(
            { startDay: '1900-01-01', endDay: '2026-08-15' },
            COLORS,
        );
        expect(Object.keys(marking).sort()).toEqual(['1900-01-01', '2026-08-15']);
    });

    it('hardcodes no palette — every colour comes from the caller', () => {
        const marking = buildRangeMarking(
            { startDay: '2026-08-27', endDay: '2026-08-29' },
            COLORS,
        );
        const used = new Set(
            Object.values(marking).flatMap((m) => [m.color, m.textColor]),
        );
        for (const value of used) {
            expect(Object.values(COLORS)).toContain(value);
        }
    });
});

describe('selectionSummary', () => {
    it('prompts for each tap in turn', () => {
        expect(selectionSummary(null, TODAY, 'system')).toBe('Tap a start date');
        expect(
            selectionSummary({ startDay: '2026-08-15', endDay: null }, TODAY, 'system'),
        ).toBe('Now tap an end date');
    });

    it('reports the range and its inclusive day count', () => {
        expect(
            selectionSummary(
                { startDay: '2026-08-15', endDay: '2026-09-13' },
                TODAY,
                'system',
            ),
        ).toBe('Aug 15 – Sep 13 · 30 days');
    });

    it('says "1 day" for a single day, not "1 days"', () => {
        expect(
            selectionSummary(
                { startDay: '2026-08-15', endDay: '2026-08-15' },
                TODAY,
                'system',
            ),
        ).toBe('Aug 15 · 1 day');
    });

    // The promise this function makes is "the label you see here is the label
    // you are about to get". That only holds if BOTH sides honour the user's
    // date_format, so the check runs under every pref rather than the default
    // alone — a summary that silently kept month-first while the header went
    // day-first would pass a single-pref version of this test.
    it.each(DATE_FORMAT_PREFS)(
        'spells the range exactly as the Stats header will (%s)',
        (pref) => {
            const range = { startDay: '2026-08-15', endDay: '2026-09-13' };
            const headerLabel = formatDayRangeLabel(range, TODAY, pref, 'day');
            expect(selectionSummary({ ...range }, TODAY, pref)).toContain(headerLabel);
        },
    );

    it('carries the day count through every pref', () => {
        expect(
            selectionSummary(
                { startDay: '2026-08-15', endDay: '2026-09-13' },
                TODAY,
                'dmy',
            ),
        ).toBe('15 Aug – 13 Sep · 30 days');
        expect(
            selectionSummary(
                { startDay: '2026-08-15', endDay: '2026-08-15' },
                TODAY,
                'ymd',
            ),
        ).toBe('08-15 · 1 day');
    });
});
