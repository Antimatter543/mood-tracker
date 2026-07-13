/**
 * Tests for the DatePicker normalization helper and local-day helpers.
 *
 * We pin TZ behavior by running ops at the JS Date level (which honors the
 * test environment's local TZ) and asserting against the *local-day* helpers.
 * The whole point of these helpers is that the assertion shouldn't care which
 * TZ the test environment is in.
 */
import {
    localDateString,
    startOfLocalDay,
    endOfLocalDay,
    isSameLocalDay,
} from '@/components/forms/dateHelpersStub';
import { normalizePickedDate, normalizePickedTime } from '@/components/forms/DatePicker';

describe('localDateString', () => {
    it('returns YYYY-MM-DD with zero-padded month and day', () => {
        const d = new Date(2026, 0, 5, 10, 0, 0); // Jan 5 local
        expect(localDateString(d)).toBe('2026-01-05');
    });

    it('uses local calendar parts, not UTC', () => {
        // A date constructed via local components should always round-trip
        // through localDateString to the same Y-M-D regardless of TZ.
        const d = new Date(2026, 11, 31, 23, 59, 0); // Dec 31 23:59 local
        expect(localDateString(d)).toBe('2026-12-31');
    });
});

describe('startOfLocalDay / endOfLocalDay', () => {
    it('startOfLocalDay sets time to 00:00:00.000 in local time', () => {
        const d = new Date(2026, 5, 15, 14, 30, 25, 500); // Jun 15 14:30:25.500
        const start = startOfLocalDay(d);
        expect(start.getFullYear()).toBe(2026);
        expect(start.getMonth()).toBe(5);
        expect(start.getDate()).toBe(15);
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);
        expect(start.getSeconds()).toBe(0);
        expect(start.getMilliseconds()).toBe(0);
    });

    it('endOfLocalDay sets time to 23:59:59.999 in local time', () => {
        const d = new Date(2026, 5, 15, 1, 0, 0);
        const end = endOfLocalDay(d);
        expect(end.getHours()).toBe(23);
        expect(end.getMinutes()).toBe(59);
        expect(end.getSeconds()).toBe(59);
        expect(end.getMilliseconds()).toBe(999);
    });

    it('does not mutate the input Date', () => {
        const d = new Date(2026, 5, 15, 14, 30, 25);
        const before = d.getTime();
        startOfLocalDay(d);
        endOfLocalDay(d);
        expect(d.getTime()).toBe(before);
    });
});

describe('isSameLocalDay', () => {
    it('returns true for two times on the same local calendar day', () => {
        const a = new Date(2026, 2, 5, 1, 0, 0);
        const b = new Date(2026, 2, 5, 23, 59, 0);
        expect(isSameLocalDay(a, b)).toBe(true);
    });

    it('returns false for adjacent local days', () => {
        const a = new Date(2026, 2, 5, 23, 59, 0);
        const b = new Date(2026, 2, 6, 0, 0, 0);
        expect(isSameLocalDay(a, b)).toBe(false);
    });
});

// CONTRACT CHANGE (2026-07-13): the form now edits BOTH date and time, so
// normalizePickedDate PRESERVES the current time-of-day when the day changes
// (it used to CLAMP to local midnight and discard the time). These tests encode
// the new contract.
describe('normalizePickedDate (DatePicker integration)', () => {
    it('passes through the current Date when picker returns the same local day', () => {
        const current = new Date(2026, 2, 5, 14, 0, 0); // user previously chose Mar 5 2pm
        const picked = new Date(2026, 2, 5, 0, 0, 0); // picker re-emits Mar 5 midnight
        const out = normalizePickedDate(picked, current);
        // Should be the SAME Date reference — avoids spurious re-renders.
        expect(out).toBe(current);
    });

    it('PRESERVES the current time-of-day when the picker chooses a different day', () => {
        // New behaviour: no more midnight clamp. Only the calendar day moves; the
        // hours/minutes/seconds carried by `current` survive.
        const current = new Date(2026, 2, 5, 14, 30, 45); // Mar 5 14:30:45
        const picked = new Date(2026, 2, 6, 0, 0, 0); // picker emits Mar 6 (midnight)
        const out = normalizePickedDate(picked, current);
        expect(out.getFullYear()).toBe(2026);
        expect(out.getMonth()).toBe(2);
        expect(out.getDate()).toBe(6);
        // Time-of-day is kept, NOT clamped to 00:00.
        expect(out.getHours()).toBe(14);
        expect(out.getMinutes()).toBe(30);
        expect(out.getSeconds()).toBe(45);
    });

    it('does not mutate the input current Date', () => {
        const current = new Date(2026, 2, 5, 14, 30, 0);
        const before = current.getTime();
        normalizePickedDate(new Date(2026, 2, 9, 0, 0, 0), current);
        expect(current.getTime()).toBe(before);
    });

    it('round-trips through toISOString / new Date without crossing a day boundary', () => {
        // The local day the user picked must survive serialization (the app keys
        // days via localDateString, never UTC date()), even with a time-of-day.
        const current = new Date(2026, 2, 1, 9, 15, 0);
        const picked = new Date(2026, 2, 5, 0, 0, 0);
        const normalized = normalizePickedDate(picked, current);
        const round = new Date(normalized.toISOString());
        expect(isSameLocalDay(round, normalized)).toBe(true);
        expect(localDateString(round)).toBe('2026-03-05');
        // The preserved time also round-trips.
        expect(round.getHours()).toBe(9);
        expect(round.getMinutes()).toBe(15);
    });
});

describe('normalizePickedTime (DatePicker integration)', () => {
    it('sets the picked hour+minute on the CURRENT local day (day unchanged)', () => {
        const current = new Date(2026, 2, 5, 14, 30, 45); // Mar 5 14:30:45
        // The native time picker returns a Date that may sit on a different day;
        // only its H:M matters — the result stays on `current`'s calendar day.
        const picked = new Date(2026, 5, 20, 8, 5, 0); // Jun 20 08:05 (arbitrary day)
        const out = normalizePickedTime(picked, current);
        expect(out.getFullYear()).toBe(2026);
        expect(out.getMonth()).toBe(2);
        expect(out.getDate()).toBe(5); // still Mar 5
        expect(out.getHours()).toBe(8);
        expect(out.getMinutes()).toBe(5);
        expect(out.getSeconds()).toBe(0); // seconds zeroed for a clean minute
    });

    it('returns the current Date unchanged when hour+minute are identical', () => {
        const current = new Date(2026, 2, 5, 14, 30, 20);
        const picked = new Date(2026, 8, 1, 14, 30, 59); // same H:M, different day/seconds
        const out = normalizePickedTime(picked, current);
        // Identity — avoids a spurious re-render.
        expect(out).toBe(current);
    });

    it('stays on the current day for a late-night time (no roll to the previous/next day)', () => {
        const current = new Date(2026, 2, 5, 12, 0, 0);
        expect(normalizePickedTime(new Date(2026, 2, 5, 23, 59, 0), current).getDate()).toBe(5);
        expect(normalizePickedTime(new Date(2026, 2, 5, 0, 1, 0), current).getDate()).toBe(5);
    });

    it('does not mutate the input current Date', () => {
        const current = new Date(2026, 2, 5, 14, 30, 0);
        const before = current.getTime();
        normalizePickedTime(new Date(2026, 2, 5, 6, 15, 0), current);
        expect(current.getTime()).toBe(before);
    });
});
