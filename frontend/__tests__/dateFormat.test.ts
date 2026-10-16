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
    formatMonth,
    normalizeDateFormatPref,
    pinSystemTo,
    type DateFormatPref,
    type DateStyle,
    type MonthStyle,
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
    'weekdayShort',
];

const ALL_MONTH_STYLES: MonthStyle[] = ['long', 'short'];

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

describe('formatDate — weekdayShort (the week chart axis)', () => {
    it('is the English short weekday under every explicit preference', () => {
        // A weekday on its own has no day/month order and no numeric form, so the
        // three explicit prefs agree — and ymd does NOT turn it into digits.
        for (const pref of ['mdy', 'dmy', 'ymd'] as DateFormatPref[]) {
            expect(formatDate(SEP_18, pref, 'weekdayShort')).toBe('Fri');
            expect(formatDate(JAN_5, pref, 'weekdayShort')).toBe('Mon');
        }
    });

    it("keeps `system` byte-identical to the old call sites' own toLocaleDateString", () => {
        // weeklyMood's week axis (and chartUtils.formatDayLabel) used exactly this
        // call before the setting reached them, so `system` must emit its bytes.
        expect(formatDate(SEP_18, 'system', 'weekdayShort')).toBe(
            SEP_18.toLocaleDateString(undefined, { weekday: 'short' }),
        );
    });

    it('names all seven weekdays, Sunday first, by the LOCAL calendar day', () => {
        // 2026-09-13 is a Sunday. Day keys parse as local midnight.
        const names = Array.from({ length: 7 }, (_, i) =>
            formatDate(`2026-09-${String(13 + i).padStart(2, '0')}`, 'dmy', 'weekdayShort'),
        );
        expect(names).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    });
});

describe('formatMonth — a month with no day', () => {
    it('spells the English month for mdy and dmy, which agree (a month has no day/month order)', () => {
        for (const pref of ['mdy', 'dmy'] as DateFormatPref[]) {
            expect(formatMonth(SEP_18, pref, 'long')).toBe('September');
            expect(formatMonth(SEP_18, pref, 'short')).toBe('Sep');
            expect(formatMonth(JAN_5, pref, 'long')).toBe('January');
            expect(formatMonth(JAN_5, pref, 'short')).toBe('Jan');
        }
    });

    it('writes YYYY-MM under ymd, zero-padded, whichever style is asked for', () => {
        // ymd emits no month name at any style (see longDate), so a month alone is
        // the numeric YYYY-MM — the same spelling periodWindow uses.
        for (const style of ALL_MONTH_STYLES) {
            expect(formatMonth(SEP_18, 'ymd', style)).toBe('2026-09');
            expect(formatMonth(JAN_5, 'ymd', style)).toBe('2026-01');
        }
    });

    it('names every one of the twelve months (no off-by-one in the table)', () => {
        const long = Array.from({ length: 12 }, (_, m) => formatMonth(new Date(2026, m, 15), 'dmy', 'long'));
        const short = Array.from({ length: 12 }, (_, m) => formatMonth(new Date(2026, m, 15), 'mdy', 'short'));
        expect(long).toEqual([
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ]);
        expect(short).toEqual([
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
        ]);
    });

    it('English names equal en-US Intl output, month by month (the heatmap + MoM baseline)', () => {
        // The heatmap used toLocaleDateString('en-US', { month: 'short' }) and the
        // Month-over-Month card a hardcoded long table. Both pin `system` to this
        // English table, so it has to BE what those call sites emitted.
        for (let m = 0; m < 12; m++) {
            const d = new Date(2026, m, 15);
            expect(formatMonth(d, 'mdy', 'short')).toBe(d.toLocaleDateString('en-US', { month: 'short' }));
            expect(formatMonth(d, 'mdy', 'long')).toBe(d.toLocaleDateString('en-US', { month: 'long' }));
        }
    });

    it('appends a 2-digit year after the joiner, for the name-based prefs', () => {
        expect(formatMonth(SEP_18, 'mdy', 'short', { yearJoiner: ' ' })).toBe('Sep 26');
        expect(formatMonth(SEP_18, 'dmy', 'short', { yearJoiner: " '" })).toBe("Sep '26");
        // Zero-padded, not "5": 2005 -> "05".
        expect(formatMonth(new Date(2005, 0, 15), 'mdy', 'short', { yearJoiner: " '" })).toBe("Jan '05");
    });

    it('ignores the joiner under ymd, which already carries the full year', () => {
        expect(formatMonth(SEP_18, 'ymd', 'short', { yearJoiner: ' ' })).toBe('2026-09');
        expect(formatMonth(SEP_18, 'ymd', 'long', { yearJoiner: " '" })).toBe('2026-09');
    });

    it("keeps `system` byte-identical to weeklyMood's old month call (device locale)", () => {
        // monthYearLabel was `${toLocaleDateString(undefined,{month:'short'})} '${yy}`.
        const old = `${SEP_18.toLocaleDateString(undefined, { month: 'short' })} '26`;
        expect(formatMonth(SEP_18, 'system', 'short', { yearJoiner: " '" })).toBe(old);
        expect(formatMonth(SEP_18, 'system', 'long')).toBe(
            SEP_18.toLocaleDateString(undefined, { month: 'long' }),
        );
    });

    it('reads a bare YYYY-MM-DD day key as LOCAL midnight (the 1st stays in its own month)', () => {
        expect(formatMonth('2026-06-01', 'mdy', 'short')).toBe('Jun');
        expect(formatMonth('2026-01-01', 'dmy', 'long')).toBe('January');
        expect(formatMonth('2026-12-31', 'ymd', 'short')).toBe('2026-12');
    });

    it('returns an empty string for an unparseable date rather than throwing', () => {
        for (const pref of DATE_FORMAT_PREFS) {
            for (const style of ALL_MONTH_STYLES) {
                expect(formatMonth('garbage', pref, style)).toBe('');
                expect(formatMonth(new Date(NaN), pref, style, { yearJoiner: ' ' })).toBe('');
            }
        }
    });

    it('never returns an empty string for a valid date (every preference x month style)', () => {
        for (const pref of DATE_FORMAT_PREFS) {
            for (const style of ALL_MONTH_STYLES) {
                expect(formatMonth(SEP_18, pref, style)).not.toBe('');
                expect(formatMonth(JAN_5, pref, style, { yearJoiner: ' ' })).not.toBe('');
            }
        }
    });
});

describe('pinSystemTo', () => {
    it('resolves `system` to the pinned legacy preference', () => {
        expect(pinSystemTo('system', 'mdy')).toBe('mdy');
        expect(pinSystemTo('system', 'dmy')).toBe('dmy');
    });

    it('lets every explicit preference through untouched', () => {
        for (const pref of ['mdy', 'dmy', 'ymd'] as const) {
            expect(pinSystemTo(pref, 'dmy')).toBe(pref);
            expect(pinSystemTo(pref, 'mdy')).toBe(pref);
        }
    });

    it('is what keeps a hardcoded-English site from following the device locale', () => {
        // The overlay's old label was a hand-written day-first "18 Sep". Routed
        // through plain `system` it would follow the device (en-US: "Sep 18").
        // Pinned, `system` is that exact string whatever the device says.
        expect(formatDate(SEP_18, pinSystemTo('system', 'dmy'), 'mediumNoYear')).toBe('18 Sep');
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
