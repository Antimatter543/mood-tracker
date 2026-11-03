/**
 * Render-structure tests for MoodMetricOverlayCard (the mood × metric overlay).
 * The alignment MATH is covered by moodMetricOverlay.test.ts and the path math by
 * chartGeometry.test.ts; this guards the COMPONENT wiring a device pass can't
 * cheaply re-verify:
 *   - only metrics WITH enough data get a toggle (no HRV toggle without HRV),
 *   - it measures width via onLayout then draws the dual-series chart,
 *   - switching the toggle changes the selected metric,
 *   - too little data → the calm "keep logging" empty state (no chart).
 *
 * jest-expo mocks react-native-svg; we count rendered svg primitives by node
 * type name from the JSON tree.
 */
import { render, fireEvent, act } from '@testing-library/react-native';
import { dayKeys, makeHealthDay } from '@/testing/builders';
import { countByType } from '@/testing/rntl';

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());

import MoodMetricOverlayCard from '@/components/visualisations/MoodMetricOverlayCard';
import type { HealthMetricDay } from '@/components/visualisations/transforms/healthMoodCorrelation';

const days = (n: number): string[] => dayKeys(n, '2026-06-01');

/** 8 days with sleep + resting/avg HR (no HRV) + a mood each. */
const richRows = (): HealthMetricDay[] =>
    days(8).map((date, i) =>
        // restingHeartRate / avgHrvMillis stay null: no dedicated resting reading
        // (restingHr uses the min proxy) and no HRV source.
        makeHealthDay({
            date,
            sleepTotalMinutes: 360 + i * 20,
            avgHeartRate: 68 + i,
            minHeartRate: 52 + i,
        })
    );
const richMoods = () => days(8).map((day, i) => ({ day, avg: 4 + (i % 4) }));

const renderMeasured = async (
    rows: HealthMetricDay[],
    moods: { day: string; avg: number }[],
    width = 320
) => {
    const view = await render(
        <MoodMetricOverlayCard healthRows={rows} dailyMoods={moods} />
    );
    const wrap = view.queryByTestId('mood-metric-overlay-chart');
    if (wrap) {
        await act(async () => {
            fireEvent(wrap, 'layout', {
                nativeEvent: { layout: { width, height: 160, x: 0, y: 0 } },
            });
        });
    }
    return view;
};

describe('MoodMetricOverlayCard', () => {
    it('renders a toggle only for metrics WITH data (sleep + resting/avg HR, no HRV)', async () => {
        const view = await renderMeasured(richRows(), richMoods());
        expect(view.getByTestId('overlay-toggle-sleep')).toBeTruthy();
        expect(view.getByTestId('overlay-toggle-restingHr')).toBeTruthy();
        expect(view.getByTestId('overlay-toggle-avgHr')).toBeTruthy();
        // No HRV data → no HRV toggle (the device-without-HRV case).
        expect(view.queryByTestId('overlay-toggle-hrv')).toBeNull();
    });

    it('measures width then draws the dual-series chart (mood dots + metric dots)', async () => {
        const view = await renderMeasured(richRows(), richMoods());
        const json = view.toJSON();
        // Two series of dots + at least one line path.
        expect(countByType(json, 'Circle')).toBeGreaterThan(4);
        expect(countByType(json, 'Path')).toBeGreaterThan(0);
    });

    it('switching the toggle changes the selected metric', async () => {
        const view = await renderMeasured(richRows(), richMoods());
        // Sleep is the default (first available) → selected.
        expect(view.getByTestId('overlay-toggle-sleep').props.accessibilityState.selected).toBe(true);
        expect(view.getByTestId('overlay-toggle-restingHr').props.accessibilityState.selected).toBe(false);

        await act(async () => {
            fireEvent.press(view.getByTestId('overlay-toggle-restingHr'));
        });

        expect(view.getByTestId('overlay-toggle-restingHr').props.accessibilityState.selected).toBe(true);
        expect(view.getByTestId('overlay-toggle-sleep').props.accessibilityState.selected).toBe(false);
    });

    it('too little data → calm keep-logging state, no chart', async () => {
        // One day only → no metric reaches OVERLAY_MIN_POINTS.
        const view = await renderMeasured(
            [makeHealthDay({ date: '2026-06-01', sleepTotalMinutes: 420, avgHeartRate: 70, minHeartRate: 55 })],
            [{ day: '2026-06-01', avg: 6 }]
        );
        expect(view.getByText(/Keep logging/i)).toBeTruthy();
        expect(view.queryByTestId('overlay-toggle-sleep')).toBeNull();
        expect(view.queryByTestId('mood-metric-overlay-chart')).toBeNull();
    });
});
