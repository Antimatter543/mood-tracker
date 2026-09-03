/**
 * Home's page title is the time-of-day greeting, and its glyph must switch on
 * the SAME hour boundaries — a "Good morning" next to a moon is the kind of
 * mismatch nobody notices until a user screenshots it.
 *
 * Both helpers are pure, so this walks all 24 hours rather than spot-checking.
 */
import { greetingForHour, greetingIconForHour } from '@/lib/greeting';

const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h);

describe('Home greeting', () => {
    it('greets by time of day', () => {
        expect(greetingForHour(0)).toBe('Good morning');
        expect(greetingForHour(11)).toBe('Good morning');
        expect(greetingForHour(12)).toBe('Good afternoon');
        expect(greetingForHour(17)).toBe('Good afternoon');
        expect(greetingForHour(18)).toBe('Good evening');
        expect(greetingForHour(23)).toBe('Good evening');
    });

    it('pairs each greeting with one glyph, on the same boundaries', () => {
        const pairs = new Map<string, Set<string>>();
        for (const h of ALL_HOURS) {
            const greeting = greetingForHour(h);
            if (!pairs.has(greeting)) pairs.set(greeting, new Set());
            pairs.get(greeting)!.add(greetingIconForHour(h));
        }

        expect([...pairs.keys()].sort()).toEqual([
            'Good afternoon',
            'Good evening',
            'Good morning',
        ]);
        // Exactly one glyph per greeting == the two functions never disagree.
        for (const [, glyphs] of pairs) expect(glyphs.size).toBe(1);
    });

    it('uses a distinct glyph per part of the day', () => {
        const glyphs = new Set(ALL_HOURS.map(greetingIconForHour));
        expect(glyphs.size).toBe(3);
    });

    it('covers every hour (no undefined greeting or glyph)', () => {
        for (const h of ALL_HOURS) {
            expect(typeof greetingForHour(h)).toBe('string');
            expect(typeof greetingIconForHour(h)).toBe('string');
        }
    });
});
