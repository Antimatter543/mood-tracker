/**
 * Health Connect figures on the Timeline: a finished day that has entries shows a
 * pulse in its mood pill, coloured by how the day went, that opens a card with every
 * figure and what it means. Today (not over yet) and days without data get none.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import {
    HEALTH_RATING_COLORS,
    dayHealthByDay,
    dayHealthFromMetric,
    dayHealthItems,
    dayHealthRating,
    formatSleep,
    type DayHealth,
} from '@/components/timeline/dayHealth';
import { DayHeader, dayHealthButtonLabel } from '@/components/timeline/DayHeader';
import { OverlayProvider } from '@/context/OverlayHost';
import { buildTimelineRows, type TimelineHealth, type TimelineHeaderRow } from '@/components/timeline/timelineRows';
import type { DailyHealthMetrics } from '@/lib/healthConnectPure';
import { localIso, makeEntry } from '@/testing/builders';
import { THEME } from '@/testing/theme';

jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: { theme: 'light', theme_mode: 'light' }, updateSetting: jest.fn() }),
}));

const metric = (date: string, over: Partial<DailyHealthMetrics> = {}): DailyHealthMetrics => ({
    date,
    sleepTotalMinutes: 445,
    sleepStages: {},
    avgHeartRate: 71.6,
    minHeartRate: 52,
    restingHeartRate: 57.4,
    avgHrvMillis: 41.2,
    ...over,
});

const full: DayHealth = { sleepMinutes: 445, restingHeartRate: 57.4, avgHeartRate: 71.6, avgHrvMillis: 41.2 };

const health = (days: string[], todayKey: string): TimelineHealth => ({
    byDay: new Map(days.map((d) => [d, full])),
    todayKey,
});

const headers = (rows: ReturnType<typeof buildTimelineRows>) =>
    rows.filter((r): r is TimelineHeaderRow => r.type === 'header');

describe('dayHealth', () => {
    it('formats sleep as hours and minutes', () => {
        expect(formatSleep(445)).toBe('7h 25m');
        expect(formatSleep(480)).toBe('8h');
        expect(formatSleep(42)).toBe('42m');
        expect(formatSleep(59.6)).toBe('1h');
    });

    it('prefers the dedicated resting heart rate and falls back to the day minimum', () => {
        expect(dayHealthFromMetric(metric('2026-09-20'))?.restingHeartRate).toBe(57.4);
        expect(dayHealthFromMetric(metric('2026-09-20', { restingHeartRate: null }))?.restingHeartRate).toBe(52);
    });

    it('is null for a day with nothing to show, and such days are dropped', () => {
        const empty = metric('2026-09-20', {
            sleepTotalMinutes: null,
            avgHeartRate: null,
            minHeartRate: null,
            restingHeartRate: null,
            avgHrvMillis: NaN,
        });
        expect(dayHealthFromMetric(empty)).toBeNull();
        expect([...dayHealthByDay([empty, metric('2026-09-21')]).keys()]).toEqual(['2026-09-21']);
    });

    it('lists only the figures the day has, in a fixed order, rating sleep and resting heart rate only', () => {
        expect(dayHealthItems(full).map((i) => [i.value, i.rating])).toEqual([
            ['7h 25m', 'good'],
            ['57 bpm', 'good'],
            ['72 bpm', null],
            ['41 ms', null],
        ]);
        expect(
            dayHealthItems({ sleepMinutes: null, restingHeartRate: null, avgHeartRate: 64, avgHrvMillis: null }).map(
                (i) => i.key
            )
        ).toEqual(['heartRate']);
    });

    it.each([
        [300, 'poor'],
        [390, 'fair'],
        [480, 'good'],
        [570, 'fair'],
        [660, 'poor'],
    ])('rates %i minutes of sleep as %s', (minutes, rating) => {
        expect(dayHealthItems({ ...full, sleepMinutes: minutes })[0].rating).toBe(rating);
    });

    // 60-100 bpm is the usual adult range at rest; a resting 84 is not a red day.
    it.each([
        [38, 'fair'],
        [57, 'good'],
        [80, 'good'],
        [84, 'fair'],
        [100, 'fair'],
        [101, 'poor'],
    ])('rates a resting heart rate of %i bpm as %s', (bpm, rating) => {
        expect(dayHealthItems({ ...full, restingHeartRate: bpm })[1].rating).toBe(rating);
    });

    // HRV differs a lot between people and with age, so a fixed band cannot judge it.
    it.each([12, 25, 60])('never rates an HRV of %i ms, so it cannot colour the day', (ms) => {
        const hrv = dayHealthItems({ ...full, avgHrvMillis: ms }).find((i) => i.key === 'hrv')!;
        expect(hrv.rating).toBeNull();
        expect(hrv.note).not.toMatch(/your body/i);
        expect(dayHealthRating({ ...full, avgHrvMillis: ms })).toBe('good');
    });

    it('rates the day by the mean of its rated figures', () => {
        expect(dayHealthRating(full)).toBe('good');
        expect(dayHealthRating({ ...full, sleepMinutes: 390, restingHeartRate: 90 })).toBe('fair');
        expect(dayHealthRating({ ...full, sleepMinutes: 300, restingHeartRate: 90, avgHrvMillis: 30 })).toBe('poor');
        expect(dayHealthRating({ sleepMinutes: null, restingHeartRate: null, avgHeartRate: 64, avgHrvMillis: null })).toBeNull();
    });
});

describe('buildTimelineRows with health', () => {
    const entries = [
        makeEntry({ id: 3, date: localIso('2026-09-28', 9) }),
        makeEntry({ id: 2, date: localIso('2026-09-27', 9) }),
        makeEntry({ id: 1, date: localIso('2026-09-25') }),
    ];

    it('gives the header of each finished day its health data, and adds no rows', () => {
        const rows = buildTimelineRows(entries, false, health(['2026-09-27', '2026-09-26'], '2026-09-29'));
        expect(rows).toHaveLength(buildTimelineRows(entries, false).length);
        expect(headers(rows).map((h) => [h.dayKey, h.health ?? null])).toEqual([
            ['2026-09-28', null],
            ['2026-09-27', full],
            ['2026-09-25', null],
        ]);
    });

    it('never shows health for today or a day that may continue on the next page', () => {
        expect(headers(buildTimelineRows(entries, false, health(['2026-09-28'], '2026-09-28')))[0].health).toBeUndefined();
        expect(headers(buildTimelineRows(entries, true, health(['2026-09-25'], '2026-09-29')))[2].health).toBeUndefined();
    });
});

describe('DayHeader health', () => {
    const header = (h?: DayHealth) => (
        <OverlayProvider>
            <DayHeader
            dayKey="2026-09-27"
            count={2}
            averageMood={6.5}
            complete
            health={h}
                dateFormatPref="ymd"
                colors={THEME}
            />
        </OverlayProvider>
    );

    it('keeps the plain mood pill without health data', async () => {
        const view = await render(header());
        expect(view.queryByTestId('day-health-2026-09-27')).toBeNull();
        expect(view.getByTestId('day-average')).toBeTruthy();
    });

    it('colours the pulse in the mood pill by the day and opens a card with every figure and its reading', async () => {
        const view = await render(header({ ...full, sleepMinutes: 390, restingHeartRate: 90, avgHrvMillis: 15 }));
        const button = view.getByTestId('day-health-2026-09-27');
        expect(button.props.accessibilityLabel).toBe('Average mood 6.5, health fair, show details');
        expect(view.queryByTestId('day-average')).toBeNull();
        expect(JSON.stringify(view.toJSON())).toContain(HEALTH_RATING_COLORS.fair);

        await fireEvent.press(button);
        expect(view.getByTestId('day-health-card')).toBeTruthy();
        expect(view.getByText('Sunday, 2026-09-27 · average mood 6.5')).toBeTruthy();
        for (const text of ['Sleep', '6h 30m', 'Resting heart rate', '90 bpm', 'Average heart rate', '72 bpm', '15 ms']) {
            expect(view.getByText(text)).toBeTruthy();
        }
        expect(view.getByText('A bit high for rest. Stress, little sleep, caffeine or a cold can push it up.')).toBeTruthy();
        expect(
            view.getByText(
                'Varies a lot from person to person. Compare with your own usual value: lower than usual often means stress, poor sleep or alcohol.'
            )
        ).toBeTruthy();

        await fireEvent.press(view.getByLabelText('Close'));
        expect(view.queryByTestId('day-health-card')).toBeNull();
    });

    it('labels a day with only unrated figures without a verdict', () => {
        expect(dayHealthButtonLabel(null, { sleepMinutes: null, restingHeartRate: null, avgHeartRate: 64, avgHrvMillis: null })).toBe(
            'Health, show details'
        );
    });
});
