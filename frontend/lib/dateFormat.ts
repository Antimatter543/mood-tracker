// dateFormat.ts
//
// The app's ONE numeric-date display policy.
//
// WHY THIS EXISTS: a 5-star Play reviewer asked "is there a way I can change the
// MM/DD format to DD/MM? I'm from a different country". Before this module every
// screen formatted dates its own way — some through `toLocaleDateString` (which
// follows the DEVICE locale), one (the chart x-axis) hardcoded to US `M/D`. The
// `date_format` setting (databases/settings.ts) now decides, and every display
// site routes through `formatDate` here.
//
// CONTRACT:
//   - This module is DISPLAY ONLY. Storage keys and day-keying stay in
//     databases/dateHelpers.ts (`localDateString` is still the one day-keying
//     authority, and its `YYYY-MM-DD` output is DATA, never affected by this
//     preference).
//   - `system` reproduces the pre-setting behaviour EXACTLY: `toLocaleDateString`
//     with the same options the call site used before, i.e. the device locale
//     decides. It is the default, so an existing user sees no change.
//   - The three explicit prefs are deterministic and locale-independent: month
//     names are English (the app's UI language; see also the hardcoded month
//     arrays this module replaced in app/(tabs)/index.tsx and the `'en-US'`
//     heatmap labels).
//   - Pure + side-effect free, so transforms can import it without pulling in
//     React or SQLite. Components read the pref via hooks/useDateFormat.ts;
//     PURE TRANSFORMS TAKE IT AS A PARAMETER (never a hook) — and the parameter
//     is REQUIRED, so a new call site cannot silently forget to pass it.

/** The user's numeric-date ordering preference (setting key `date_format`). */
export type DateFormatPref = 'system' | 'mdy' | 'dmy' | 'ymd';

export const DATE_FORMAT_PREFS = ['system', 'mdy', 'dmy', 'ymd'] as const;

export const DEFAULT_DATE_FORMAT: DateFormatPref = 'system';

/**
 * Coerce a stored/unknown value to a valid pref. Settings are persisted as
 * TEXT, and an older install (or a hand-edited DB) can hold anything, so every
 * read funnels through here rather than trusting the string.
 */
export function normalizeDateFormatPref(raw: unknown): DateFormatPref {
    return DATE_FORMAT_PREFS.includes(raw as DateFormatPref)
        ? (raw as DateFormatPref)
        : DEFAULT_DATE_FORMAT;
}

/**
 * The display shapes the app needs. Each one corresponds to a real call site's
 * pre-existing format, so `system` can reproduce it byte-for-byte:
 *
 *   numeric         full numeric date          18/09/2026 · 09/18/2026 · 2026-09-18
 *   numericShort    day+month, no year         18/09 · 09/18 · 09-18      (chart axes)
 *   long            weekday + month name + yr  Thursday, 18 September 2026
 *   longNoYear      weekday + month name       Thursday, 18 September     (Home header)
 *   medium          short month + year         18 Sep 2026
 *   mediumNoYear    short month, no year       18 Sep
 *   mediumWeekday   short weekday + month      Thu, 18 Sep
 */
export type DateStyle =
    | 'numeric'
    | 'numericShort'
    | 'long'
    | 'longNoYear'
    | 'medium'
    | 'mediumNoYear'
    | 'mediumWeekday';

/**
 * The `toLocaleDateString` options each style used BEFORE the setting existed.
 * `system` still uses exactly these, which is what makes the default a no-op
 * for existing users.
 */
const SYSTEM_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions | undefined> = {
    // `undefined` (not `{}`) — a bare toLocaleDateString() is the locale's own
    // short date, which is what RecoveryPatterns / Health Connect showed.
    numeric: undefined,
    numericShort: { month: 'numeric', day: 'numeric' },
    long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    longNoYear: { weekday: 'long', month: 'long', day: 'numeric' },
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    mediumNoYear: { month: 'short', day: 'numeric' },
    mediumWeekday: { weekday: 'short', day: 'numeric', month: 'short' },
};

const MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const WEEKDAYS_LONG = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Local-calendar parts. Local getters, never getUTC* — see dateHelpers.ts. */
type Parts = {
    year: number;
    /** 1-12, NOT the 0-based `getMonth()`. */
    month: number;
    day: number;
    weekday: number;
};

const partsOf = (d: Date): Parts => ({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: d.getDay(),
});

/**
 * Format one date for display.
 *
 * Accepts a Date, an ISO instant, or a `YYYY-MM-DD` day key — the latter is
 * parsed as LOCAL midnight (`T00:00:00` appended), never bare, because
 * `new Date('2026-09-18')` is UTC midnight and names the PREVIOUS day for
 * anyone west of UTC.
 *
 * Returns `''` for an unparseable date; call sites that want to echo their raw
 * input back (e.g. degenerate day keys in the Timeline) check that themselves.
 */
export function formatDate(
    date: Date | string,
    pref: DateFormatPref,
    style: DateStyle
): string {
    const d = toLocalDate(date);
    if (!d) return '';

    if (pref === 'system') {
        return d.toLocaleDateString(undefined, SYSTEM_OPTIONS[style]);
    }

    const p = partsOf(d);

    switch (style) {
        case 'numeric':
            return numericDate(p, pref, true);
        case 'numericShort':
            return numericDate(p, pref, false);
        case 'long':
            return `${WEEKDAYS_LONG[p.weekday]}, ${longDate(p, pref, true)}`;
        case 'longNoYear':
            return `${WEEKDAYS_LONG[p.weekday]}, ${longDate(p, pref, false)}`;
        case 'medium':
            return mediumDate(p, pref, true);
        case 'mediumNoYear':
            return mediumDate(p, pref, false);
        case 'mediumWeekday':
            return `${WEEKDAYS_SHORT[p.weekday]}, ${mediumDate(p, pref, false)}`;
    }
}

/** `18/09/2026` · `09/18/2026` · `2026-09-18` (or without the year). */
function numericDate(p: Parts, pref: Exclude<DateFormatPref, 'system'>, withYear: boolean): string {
    const mm = pad2(p.month);
    const dd = pad2(p.day);
    switch (pref) {
        case 'mdy':
            return withYear ? `${mm}/${dd}/${p.year}` : `${mm}/${dd}`;
        case 'dmy':
            return withYear ? `${dd}/${mm}/${p.year}` : `${dd}/${mm}`;
        case 'ymd':
            return withYear ? `${p.year}-${mm}-${dd}` : `${mm}-${dd}`;
    }
}

/**
 * `18 September 2026` · `September 18, 2026`. `ymd` has no month-name ordering
 * of its own, so it falls back to its ISO numeric form (documented in the
 * setting's description: YYYY-MM-DD is always numeric).
 */
function longDate(p: Parts, pref: Exclude<DateFormatPref, 'system'>, withYear: boolean): string {
    const month = MONTHS_LONG[p.month - 1];
    switch (pref) {
        case 'mdy':
            return withYear ? `${month} ${p.day}, ${p.year}` : `${month} ${p.day}`;
        case 'dmy':
            return withYear ? `${p.day} ${month} ${p.year}` : `${p.day} ${month}`;
        case 'ymd':
            return numericDate(p, 'ymd', withYear);
    }
}

/** `18 Sep 2026` · `Sep 18, 2026` · `2026-09-18`. */
function mediumDate(p: Parts, pref: Exclude<DateFormatPref, 'system'>, withYear: boolean): string {
    const month = MONTHS_SHORT[p.month - 1];
    switch (pref) {
        case 'mdy':
            return withYear ? `${month} ${p.day}, ${p.year}` : `${month} ${p.day}`;
        case 'dmy':
            return withYear ? `${p.day} ${month} ${p.year}` : `${p.day} ${month}`;
        case 'ymd':
            return numericDate(p, 'ymd', withYear);
    }
}

/**
 * Parse whatever the call sites hand us into a local-calendar Date, or null.
 * A bare `YYYY-MM-DD` gets `T00:00:00` so it lands on LOCAL midnight.
 */
const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toLocalDate(date: Date | string): Date | null {
    const d =
        typeof date === 'string'
            ? new Date(YMD_ONLY.test(date) ? `${date}T00:00:00` : date)
            : date;
    return Number.isNaN(d.getTime()) ? null : d;
}

/** The Settings picker's label for one pref, with no example attached. */
const PREF_LABELS: Record<DateFormatPref, string> = {
    system: 'System default',
    mdy: 'MM/DD/YYYY',
    dmy: 'DD/MM/YYYY',
    ymd: 'YYYY-MM-DD',
};

export const DATE_FORMAT_OPTION_LABELS = PREF_LABELS;

/**
 * The Settings picker options, each annotated with how `now` renders under that
 * pref — "DD/MM/YYYY (18/09/2026)". Built at RENDER time (not module load) so
 * the example is today's date even in a session left open across midnight, and
 * pure so it can be unit-tested.
 */
export function dateFormatOptions(now: Date): Array<{ label: string; value: DateFormatPref }> {
    return DATE_FORMAT_PREFS.map((value) => ({
        value,
        label: `${PREF_LABELS[value]} (${formatDate(now, value, 'numeric')})`,
    }));
}
