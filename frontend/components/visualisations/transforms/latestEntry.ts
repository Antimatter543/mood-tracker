// latestEntry.ts
//
// PURE transform: "what did I actually write on this day?"
//
// The mood-trend chart plots a day's AVERAGE. When the user holds the chart on
// a day, an average is not the thing they remember — the entry is. This maps
// each local day to its MOST RECENT entry so the scrub readout can show the
// time, the mood and the first line of the note behind that day's dot.
//
// Day-keying goes through `localDateString`, the app's single timezone
// authority (see transforms/dailyAverages.ts DOCTRINE): SQL range-filters on
// stored UTC instants and never buckets them, so an entry written at 11pm local
// belongs to that local day here and everywhere else.

import { localDateString } from '@/databases/dateHelpers';

/** A row of `ENTRY_DETAILS_IN_RANGE` — a raw stored instant plus its content. */
export type EntryDetailRow = {
    id: number;
    /** Stored UTC ISO instant. */
    date: string;
    mood: number;
    notes: string | null;
};

/** The day's most recent entry, formatted for display. */
export type LatestEntry = {
    /** Local clock time, e.g. "2:30 pm". */
    time: string;
    mood: number;
    /** First non-empty line of the note, or null when there is no note. */
    note: string | null;
};

/**
 * Local clock time of a stored instant, e.g. "2:30 pm".
 *
 * Locale-driven (`undefined` locale = the device's), so a 24-hour-clock user
 * sees "14:30". Returns '' for an unparseable instant — a readout with a
 * missing time is a cosmetic gap; a throw on the render path is a white screen.
 */
export const formatEntryTime = (instant: string): string => {
    const d = new Date(instant);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/**
 * First non-empty line of a note, trimmed. Null when there is nothing to show.
 *
 * Only the first LINE, because the readout is one line tall: taking the first N
 * characters instead would slice a multi-line note mid-word and read as
 * corruption rather than as a preview.
 */
export const firstNoteLine = (notes: string | null | undefined): string | null => {
    if (typeof notes !== 'string') return null;
    for (const line of notes.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) return trimmed;
    }
    return null;
};

/**
 * A local day ("YYYY-MM-DD") as a human date, e.g. "Tue 2 Sep".
 *
 * Parsed as LOCAL midnight (`T00:00:00`), never bare — `new Date('2026-09-02')`
 * parses as UTC midnight and names the PREVIOUS day for anyone west of UTC.
 * That is the same day-shift class the whole visualisation layer is built to
 * avoid (see transforms/dailyAverages.ts DOCTRINE). Returns the raw input for
 * an unparseable day rather than throwing.
 */
export const formatReadoutDay = (day: string): string => {
    const d = new Date(`${day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return day;
    return d.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
};

/**
 * Map of local day -> that day's MOST RECENT entry.
 *
 * Rows may arrive in any order; the latest stored instant wins per day. Rows
 * with an unparseable date or a non-finite mood are skipped rather than
 * throwing (degenerate data must never break the chart — an empty database and
 * a half-imported one are both real code paths here).
 */
export const latestEntryPerDay = (
    rows: readonly EntryDetailRow[]
): Map<string, LatestEntry> => {
    // Track the winning instant per day so a later row can displace an earlier one.
    const bestAt = new Map<string, number>();
    const out = new Map<string, LatestEntry>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        const t = new Date(row.date).getTime();
        if (Number.isNaN(t)) continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;

        const day = localDateString(row.date);
        const current = bestAt.get(day);
        if (current !== undefined && current >= t) continue;

        bestAt.set(day, t);
        out.set(day, {
            time: formatEntryTime(row.date),
            mood: row.mood,
            note: firstNoteLine(row.notes),
        });
    }

    return out;
};
