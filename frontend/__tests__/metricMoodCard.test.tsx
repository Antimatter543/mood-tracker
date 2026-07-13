/**
 * Render tests for MetricMoodCard's stats line (the "nerdy numbers" the user
 * asked for). The stat MATH is covered by correlationStats.test.ts and the
 * correlation shape by healthMoodCorrelation.test.ts; this guards the COMPONENT
 * wiring a device pass can't cheaply re-verify:
 *   - an ok (directional) result renders r / p / n + a strength·significance tag,
 *   - a flat-but-finite result still renders the numbers (the honest detail),
 *   - notEnoughData renders NO stats line (never a number),
 *   - the "?" toggle reveals/hides the plain-language explainer.
 *
 * Follows the same useThemeColors mock pattern as moodMetricOverlayCard.test.tsx
 * so no SettingsProvider is needed.
 */
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return {
        ...actual,
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
    };
});

import MetricMoodCard, {
    type MetricMoodCardConfig,
} from '@/components/visualisations/MetricMoodCard';
import {
    sleepMoodCorrelation,
    type MetricMoodCorrelation,
    type HealthMetricDay,
} from '@/components/visualisations/transforms/healthMoodCorrelation';

const days = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);

const hRow = (date: string, sleep: number): HealthMetricDay => ({
    date,
    sleepTotalMinutes: sleep,
    avgHeartRate: null,
    minHeartRate: null,
    avgHrvMillis: null,
});

/** Strong positive: more sleep → better mood, 8 days → ok directional. */
const directional = (): MetricMoodCorrelation => {
    const d = days(8);
    const sleep = [300, 360, 390, 420, 450, 480, 510, 540];
    const mood = [3, 4, 4, 5, 6, 6, 7, 8];
    return sleepMoodCorrelation(
        d.map((day, i) => hRow(day, sleep[i])),
        d.map((day, i) => ({ day, avg: mood[i] }))
    );
};

/** Near-zero r (symmetric mood over evenly-spaced sleep) → ok + flat, r finite. */
const flatFinite = (): MetricMoodCorrelation => {
    const d = days(8);
    const mood = [5, 5, 6, 6, 6, 6, 5, 5];
    return sleepMoodCorrelation(
        d.map((day, i) => hRow(day, 300 + i * 30)),
        d.map((day, i) => ({ day, avg: mood[i] }))
    );
};

const config = (correlation: MetricMoodCorrelation): MetricMoodCardConfig => ({
    icon: 'moon-outline',
    title: 'Sleep & mood',
    metricNoun: 'sleep',
    halfWords: { lower: 'shorter-sleep', upper: 'longer-sleep' },
    formatMetric: (v) => `${(v / 60).toFixed(1)}h`,
    methodNote: 'method note',
    correlation,
});

describe('MetricMoodCard — stats line', () => {
    it('directional ok: renders r / p / n and a strength·significance tag', async () => {
        const c = directional();
        expect(c.status).toBe('ok');
        const view = await render(<MetricMoodCard {...config(c)} />);

        expect(view.getByTestId('metric-mood-stats')).toBeTruthy();
        // numbers line: r = …, p = …, n = 8 (n equals the pair count).
        expect(view.getByText(/^r = /)).toBeTruthy();
        expect(view.getByText(/n = 8/)).toBeTruthy();
        // secondary tag: a strong positive link over 8 days.
        expect(view.getByText(/very strong positive/)).toBeTruthy();
    });

    it('flat-but-finite ok: still renders the numbers (the honest nerdy detail)', async () => {
        const c = flatFinite();
        expect(c.status).toBe('ok');
        if (c.status === 'ok') {
            expect(c.direction).toBe('flat');
            expect(c.r).not.toBeNull();
            expect(c.pValue).not.toBeNull();
        }
        const view = await render(<MetricMoodCard {...config(c)} />);

        expect(view.getByTestId('metric-mood-stats')).toBeTruthy();
        expect(view.getByText(/^r = /)).toBeTruthy();
        // negligible strength, no direction word for a flat r.
        expect(view.getByText(/^negligible · /)).toBeTruthy();
    });

    it('notEnoughData: renders NO stats line (never a number)', async () => {
        const c = sleepMoodCorrelation([], []);
        expect(c.status).toBe('notEnoughData');
        const view = await render(<MetricMoodCard {...config(c)} />);

        expect(view.queryByTestId('metric-mood-stats')).toBeNull();
        expect(view.getByText(/Keep logging/i)).toBeTruthy();
    });

    it('the "?" toggle reveals and hides the plain-language explainer', async () => {
        const view = await render(<MetricMoodCard {...config(directional())} />);

        // collapsed by default
        expect(view.queryByText(/r is the correlation/)).toBeNull();

        await act(async () => {
            fireEvent.press(view.getByLabelText('What do these numbers mean?'));
        });
        expect(view.getByText(/r is the correlation/)).toBeTruthy();

        await act(async () => {
            fireEvent.press(view.getByLabelText('What do these numbers mean?'));
        });
        expect(view.queryByText(/r is the correlation/)).toBeNull();
    });
});
