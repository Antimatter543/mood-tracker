/**
 * MoodTrendReadout — what a held point on the mood-trend chart actually SAYS.
 *
 * This is the whole payoff of the hold gesture, and it is the one place where
 * an interpolated day could quietly be presented as something the user
 * recorded. Pinned here:
 *   - a real day shows its average, the entry's time + mood, and the note's
 *     first line;
 *   - a GAP day says so in words and shows NO average;
 *   - a day whose entry has no note renders the mood line and nothing else
 *     (no empty italic sliver);
 *   - the panel and bubble variants say the SAME things (they are one
 *     component precisely so the card and the expanded view cannot disagree).
 *
 * Also covers `maWindowFor`, the overlay-window policy that moved out of the
 * chart component when the data pipeline was extracted.
 */
import { render } from '@testing-library/react-native';

jest.mock('@/styles/global', () => ({
    useThemeColors: () => ({
        background: '#141418',
        cardBackground: '#1E1F24',
        secondaryBackground: '#26272C',
        text: '#FFFFFF',
        textSecondary: '#AAAAAA',
        border: 'rgba(255,255,255,0.1)',
        accent: '#4CAF50',
        accentDark: '#3d8b40',
        accentLight: 'rgba(76,175,80,0.1)',
        overlays: {
            tag: '#222222',
            tagBorder: '#333333',
            border: '#333333',
            textSecondary: '#888888',
        },
        elevation: { shadowColor: '#000000', shadowOpacity: 0.3, elevation: 4 },
        isDark: true,
    }),
}));

import MoodTrendReadout from '@/components/visualisations/MoodTrendReadout';
import { maWindowFor } from '@/components/visualisations/transforms/moodSeries';
import type { LatestEntry } from '@/components/visualisations/transforms/latestEntry';

const DAY = '2026-09-02';
const entry: LatestEntry = { time: '2:30 pm', mood: 7, note: 'went for a run' };

describe('MoodTrendReadout — a logged day', () => {
    it('names the day, its average, and the entry behind it', async () => {
        const view = await render(
            <MoodTrendReadout day={DAY} average={6.4} entry={entry} />
        );
        expect(view.queryByText(/Wed/)).not.toBeNull();
        expect(view.queryByText('Avg mood 6.4')).not.toBeNull();
        expect(view.queryByText('2:30 pm · mood 7.0')).not.toBeNull();
        expect(view.queryByText('went for a run')).not.toBeNull();
    });

    it('renders the mood line and nothing more when the entry has no note', async () => {
        const view = await render(
            <MoodTrendReadout day={DAY} average={6.4} entry={{ ...entry, note: null }} />
        );
        expect(view.queryByText('2:30 pm · mood 7.0')).not.toBeNull();
        expect(view.queryByText('went for a run')).toBeNull();
    });

    it('still shows the average when the day has no entry detail to show', async () => {
        const view = await render(
            <MoodTrendReadout day={DAY} average={5} entry={null} />
        );
        expect(view.queryByText('Avg mood 5.0')).not.toBeNull();
        expect(view.queryByText(/mood 7/)).toBeNull();
    });
});

describe('MoodTrendReadout — a day with no entry', () => {
    it('says the point is interpolated, and shows NO average', async () => {
        const view = await render(
            <MoodTrendReadout day={DAY} average={null} entry={null} />
        );
        // The line still crosses this day (dashed). An interpolated crossing
        // must never be presented as a recorded mood.
        expect(view.queryByText('No entry — interpolated')).not.toBeNull();
        expect(view.queryByText(/Avg mood/)).toBeNull();
    });
});

describe('MoodTrendReadout — variants agree', () => {
    it('the panel says exactly what the bubble says', async () => {
        const bubble = await render(
            <MoodTrendReadout day={DAY} average={6.4} entry={entry} variant="bubble" />
        );
        const panel = await render(
            <MoodTrendReadout day={DAY} average={6.4} entry={entry} variant="panel" />
        );
        for (const text of ['Avg mood 6.4', '2:30 pm · mood 7.0', 'went for a run']) {
            expect(bubble.queryByText(text)).not.toBeNull();
            expect(panel.queryByText(text)).not.toBeNull();
        }
    });
});

describe('maWindowFor', () => {
    it('never overlays a trend on a week — a 7-day mean of 7 days is the data', () => {
        expect(maWindowFor('week')).toBe(0);
    });

    it('widens the window as the period widens, and never shrinks it', () => {
        const windows = (['week', 'month', '3months', 'year', 'alltime'] as const).map(
            maWindowFor
        );
        for (let i = 1; i < windows.length; i++) {
            expect(windows[i]).toBeGreaterThanOrEqual(windows[i - 1]);
        }
    });

    it('is always a whole, non-negative number of days', () => {
        for (const tf of ['week', 'month', '3months', 'year', 'alltime'] as const) {
            const w = maWindowFor(tf);
            expect(Number.isInteger(w)).toBe(true);
            expect(w).toBeGreaterThanOrEqual(0);
        }
    });
});
