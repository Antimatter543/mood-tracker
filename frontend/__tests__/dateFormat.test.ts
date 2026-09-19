/**
 * Unit tests for lib/dateFormat.ts — the app's one numeric-date display policy.
 *
 * WHY: a 5-star Play reviewer asked to change MM/DD to DD/MM. Every display site
 * now routes through `formatDate`, so this file is where that promise is pinned.
 *
 * The three explicit preferences are deterministic and locale-independent, so
 * they are asserted EXACTLY. `system` deliberately delegates to
 * `toLocaleDateString`, whose output varies with the environment's locale — it is
 * therefore asserted structurally (and by NOT being the explicit forms), never
 * against a hardcoded string.
 */
import {
    DATE_FORMAT_PREFS,
    DEFAULT_DATE_FORMAT,
    dateFormatOptions,
    formatDate,
    normalizeDateFormatPref,
    type DateFormatPref,
    type DateStyle,
} from '@/lib/dateFormat';

// Thursday, 18 September 2026, 13:42 LOCAL. Local constructor (month index 8).
const SEP_18 = new Date(2026, 8, 18, 13, 42, 0);
// Single-digit month AND day, so padding is exercised: 5 January 2026 (Monday).
const JAN_5 = new Date(2026, 0, 5, 9, 0, 0);

const ALL_STYLES: DateStyle[] = [
    'numeric',
    'numericShort',
    'long',
    'longNoYear',
    'medium',
    'mediumNoYear',
    'mediumWeekday',
];

describe('normalizeDateFormatPref', () => {
    it('accepts every real preference', () => {
        for (const pref of DATE_FORMAT_PREFS) {
            expect(normalizeDateFormatPref(pref)).toBe(pref);
        }
    });

    it('falls back to the default for anything else', () => {
        // Settings are persisted as TEXT, so a stale/hand-edited row can hold
        // anything. It must degrade to the pre-setting behaviour, not crash.
        for (const junk of [undefined, null, '', 'DD/MM', 'MDY', 42, {}]) {
            expect(normalizeDateFormatPref(junk)).toBe(DEFAULT_DATE_FORMAT);
        }
    });

    it("defaults to 'system' so an upgrading user sees no change", () => {
        expect(DEFAULT_DATE_FORMAT).toBe('system');
    });
});

describe('formatDate — explicit preferences, every style', () => {
    it('formats mdy', () => {
        expect(formatDate(SEP_18, 'mdy', 'numeric')).toBe('09/18/2026');
        expect(formatDate(SEP_18, 'mdy', 'numericShort')).toBe('09/18');
        expect(formatDate(SEP_18, 'mdy', 'long')).toBe('Friday, September 18, 2026');
        expect(formatDate(SEP_18, 'mdy', 'longNoYear')).toBe('Friday, September 18');
        expect(formatDate(SEP_18, 'mdy', 'medium')).toBe('Sep 18, 2026');
        expect(formatDate(SEP_18, 'mdy', 'mediumNoYear')).toBe('Sep 18');
        expect(formatDate(SEP_18, 'mdy', 'mediumWeekday')).toBe('Fri, Sep 18');
    });

    it('formats dmy', () => {
        expect(formatDate(SEP_18, 'dmy', 'numeric')).toBe('18/09/2026');
        expect(formatDate(SEP_18, 'dmy', 'numericShort')).toBe('18/09');
        expect(formatDate(SEP_18, 'dmy', 'long')).toBe('Friday, 18 September 2026');
        expect(formatDate(SEP_18, 'dmy', 'longNoYear')).toBe('Friday, 18 September');
        expect(formatDate(SEP_18, 'dmy', 'medium')).toBe('18 Sep 2026');
        expect(formatDate(SEP_18, 'dmy', 'mediumNoYear')).toBe('18 Sep');
        expect(formatDate(SEP_18, 'dmy', 'mediumWeekday')).toBe('Fri, 18 Sep');
    });

    it('formats ymd (ISO numeric everywhere, since it has no month-name order)', () => {
        expect(formatDate(SEP_18, 'ymd', 'numeric')).toBe('2026-09-18');
        expect(formatDate(SEP_18, 'ymd', 'numericShort')).toBe('09-18');
        expect(formatDate(SEP_18, 'ymd', 'long')).toBe('Friday, 2026-09-18');
        expect(formatDate(SEP_18, 'ymd', 'longNoYear')).toBe('Friday, 09-18');
        expect(formatDate(SEP_18, 'ymd', 'medium')).toBe('2026-09-18');
        expect(formatDate(SEP_18, 'ymd', 'mediumNoYear')).toBe('09-18');
        expect(formatDate(SEP_18, 'ymd', 'mediumWeekday')).toBe('Fri, 09-18');
    });

    it('zero-pads single-digit months and days in the numeric styles', () => {
        // The whole point of a fixed numeric format is that 05/01 and 01/05 are
        // told apart by the SETTING, not guessed from the digit count.
        expect(formatDate(JAN_5, 'mdy', 'numeric')).toBe('01/05/2026');
        expect(formatDate(JAN_5, 'dmy', 'numeric')).toBe('05/01/2026');
        expect(formatDate(JAN_5, 'ymd', 'numeric')).toBe('2026-01-05');
        expect(formatDate(JAN_5, 'mdy', 'numericShort')).toBe('01/05');
        expect(formatDate(JAN_5, 'dmy', 'numericShort')).toBe('05/01');
    });

    it('does NOT pad the day in the month-name styles', () => {
        // "5 January 2026", not "05 January 2026" — padding only belongs to the
        // all-numeric forms.
        expect(formatDate(JAN_5, 'dmy', 'long')).toBe('Monday, 5 January 2026');
        expect(formatDate(JAN_5, 'mdy', 'medium')).toBe('Jan 5, 2026');
    });
});

describe('formatDate — year boundary', () => {
    // Dec 31 / Jan 1 is where an off-by-one month index or a UTC slip shows up.
    const dec31 = new Date(2025, 11, 31, 23, 30, 0);
    const jan1 = new Date(2026, 0, 1, 0, 30, 0);

    it('keeps Dec 31 and Jan 1 on their own calendar years', () => {
        expect(formatDate(dec31, 'dmy', 'numeric')).toBe('31/12/2025');
        expect(formatDate(dec31, 'mdy', 'numeric')).toBe('12/31/2025');
        expect(formatDate(dec31, 'ymd', 'numeric')).toBe('2025-12-31');
        expect(formatDate(jan1, 'dmy', 'numeric')).toBe('01/01/2026');
        expect(formatDate(jan1, 'mdy', 'medium')).toBe('Jan 1, 2026');
        expect(formatDate(jan1, 'ymd', 'numeric')).toBe('2026-01-01');
    });

    it('names December and January, not an off-by-one month', () => {
        expect(formatDate(dec31, 'dmy', 'long')).toBe('Wednesday, 31 December 2025');
        expect(formatDate(jan1, 'dmy', 'long')).toBe('Thursday, 1 January 2026');
    });
});

describe('formatDate — input shapes', () => {
    it('parses a bare YYYY-MM-DD day key as LOCAL midnight, not UTC', () => {
        // `new Date('2026-09-18')` is UTC midnight and names the 17th for anyone
        // west of UTC. Every transform in the app hands us these day keys.
        expect(formatDate('2026-09-18', 'dmy', 'numeric')).toBe('18/09/2026');
        expect(formatDate('2026-01-01', 'ymd', 'numeric')).toBe('2026-01-01');
    });

    it('accepts an ISO instant', () => {
        const iso = new Date(2026, 8, 18, 13, 42).toISOString();
        expect(formatDate(iso, 'dmy', 'numeric')).toBe('18/09/2026');
    });

    it('returns an empty string for an unparseable date rather than throwing', () => {
        for (const pref of DATE_FORMAT_PREFS) {
            for (const style of ALL_STYLES) {
                expect(formatDate('garbage', pref, style)).toBe('');
                expect(formatDate(new Date(NaN), pref, style)).toBe('');
            }
        }
    });
});

describe('formatDate — system preference', () => {
    it('produces a non-empty string for every style', () => {
        for (const style of ALL_STYLES) {
            expect(formatDate(SEP_18, 'system', style).length).toBeGreaterThan(0);
        }
    });

    it('names the local calendar day, whatever the locale orders', () => {
        // Locale-agnostic assertion: the day number must be in there, and the
        // month-name styles must spell the month.
        expect(formatDate(SEP_18, 'system', 'numeric')).toContain('18');
        expect(formatDate(SEP_18, 'system', 'long')).toContain('September');
        expect(formatDate(SEP_18, 'system', 'medium')).toContain('Sep');
    });

    it('omits the year in the no-year styles and includes it otherwise', () => {
        expect(formatDate(SEP_18, 'system', 'numeric')).toMatch(/2026|26/);
        expect(formatDate(SEP_18, 'system', 'longNoYear')).not.toContain('2026');
        expect(formatDate(SEP_18, 'system', 'mediumNoYear')).not.toContain('2026');
        expect(formatDate(SEP_18, 'system', 'numericShort')).not.toContain('2026');
    });
});

describe('every preference x style pair is defined', () => {
    // Class-level invariant: adding a style or a preference without handling the
    // combination must fail here rather than render an empty date on some screen.
    it('never returns an empty string for a valid date', () => {
        for (const pref of DATE_FORMAT_PREFS) {
            for (const style of ALL_STYLES) {
                expect(formatDate(SEP_18, pref, style)).not.toBe('');
                expect(formatDate(JAN_5, pref, style)).not.toBe('');
            }
        }
    });

    it('gives the three explicit preferences three DIFFERENT numeric dates', () => {
        const rendered = (['mdy', 'dmy', 'ymd'] as DateFormatPref[]).map((p) =>
            formatDate(SEP_18, p, 'numeric'),
        );
        expect(new Set(rendered).size).toBe(3);
    });
});

describe('dateFormatOptions', () => {
    it('offers exactly the four preferences, in registry order', () => {
        expect(dateFormatOptions(SEP_18).map((o) => o.value)).toEqual([
            'system',
            'mdy',
            'dmy',
            'ymd',
        ]);
    });

    it("labels each option with today's date as a live example", () => {
        const options = dateFormatOptions(SEP_18);
        const byValue = Object.fromEntries(options.map((o) => [o.value, o.label]));
        expect(byValue.dmy).toBe('DD/MM/YYYY (18/09/2026)');
        expect(byValue.mdy).toBe('MM/DD/YYYY (09/18/2026)');
        expect(byValue.ymd).toBe('YYYY-MM-DD (2026-09-18)');
        expect(byValue.system).toContain('System default (');
    });

    it('builds the example from the date it is GIVEN (not module-load time)', () => {
        expect(dateFormatOptions(JAN_5).find((o) => o.value === 'dmy')?.label).toBe(
            'DD/MM/YYYY (05/01/2026)',
        );
    });
});
