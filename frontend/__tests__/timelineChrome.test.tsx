/**
 * The Timeline's chrome around the entry cards (2026-09-28 redesign):
 *   - DayHeader: title in the user's date format, the day's count and average
 *     mood, and NO totals for a day that may continue on an unloaded page;
 *   - TimelineFooter: one constant height across loading / idle / end;
 *   - BackToTopPill: when it shows, and that it is a real, labelled button.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));

import { DayHeader, dayHeaderA11yLabel, entryCountLabel } from '@/components/timeline/DayHeader';
import {
    TimelineFooter,
    TIMELINE_FOOTER_HEIGHT,
    footerStateFor,
} from '@/components/timeline/TimelineFooter';
import {
    BackToTopPill,
    BACK_TO_TOP_VIEWPORTS,
    shouldShowBackToTop,
} from '@/components/timeline/BackToTopPill';
import { localDayKey } from '@/components/timeline/dateHeader';
import { moodColor } from '@/components/timeline/moodColor';

const colors: any = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    accentDark: '#388E3C',
    accentLight: 'rgba(76,175,80,0.1)',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    isDark: true,
};

const flat = (node: any) => StyleSheet.flatten(node.props.style) || {};

describe('DayHeader', () => {
    const today = localDayKey(new Date());

    it("titles today's group \"Today\" and shows the day's count and average", async () => {
        const view = await render(
            <DayHeader dayKey={today} count={3} averageMood={6.3} complete dateFormatPref="system" colors={colors} />
        );
        expect(view.getByText('Today')).toBeTruthy();
        expect(view.getByText('3 entries')).toBeTruthy();
        expect(view.getByText('6.3')).toBeTruthy();
        // The average's dot is on the same ramp as the entry nodes.
        const dots = view.container.queryAll(
            (n: any) => flat(n).backgroundColor === moodColor(6.3, colors.accent, colors.overlays.tag) && flat(n).width === 8
        );
        expect(dots.length).toBeGreaterThan(0);
    });

    it('follows the date_format setting for older days', async () => {
        const view = await render(
            <DayHeader dayKey="2025-06-09" count={1} averageMood={5} complete dateFormatPref="dmy" colors={colors} />
        );
        expect(view.getByText('Monday, 9 June 2025')).toBeTruthy();
        expect(view.getByText('1 entry')).toBeTruthy();
    });

    it('shows no totals for a day that may continue on the next page', async () => {
        const view = await render(
            <DayHeader dayKey="2025-06-09" count={2} averageMood={4} complete={false} dateFormatPref="dmy" colors={colors} />
        );
        expect(view.queryByText('2 entries')).toBeNull();
        expect(view.queryByTestId('day-average')).toBeNull();
        expect(view.getByLabelText('Monday, 9 June 2025')).toBeTruthy();
    });

    it('is an accessible header that reads the whole summary', async () => {
        const view = await render(
            <DayHeader dayKey="2025-06-09" count={2} averageMood={4.5} complete dateFormatPref="dmy" colors={colors} />
        );
        const header = view.getByTestId('day-header-2025-06-09');
        expect(header.props.accessibilityRole).toBe('header');
        expect(header.props.accessibilityLabel).toBe('Monday, 9 June 2025, 2 entries, average mood 4.5');
        expect(
            dayHeaderA11yLabel('X', { dayKey: 'k', count: 1, averageMood: null, complete: true })
        ).toBe('X, 1 entry');
    });

    it('is OPAQUE (it doubles as the pinned sticky copy) and gets an edge only when pinned', async () => {
        const view = await render(
            <DayHeader dayKey="2025-06-09" count={1} averageMood={5} complete dateFormatPref="dmy" colors={colors} />
        );
        const inList = flat(view.getByTestId('day-header-2025-06-09'));
        expect(inList.backgroundColor).toBe(colors.background);
        expect(inList.borderBottomWidth).toBeUndefined();
        await view.rerender(
            <DayHeader dayKey="2025-06-09" count={1} averageMood={5} complete dateFormatPref="dmy" colors={colors} sticky />
        );
        expect(flat(view.getByTestId('day-header-2025-06-09')).borderBottomWidth).toBeGreaterThan(0);
    });

    it('pluralises the count', () => {
        expect(entryCountLabel(0)).toBe('0 entries');
        expect(entryCountLabel(1)).toBe('1 entry');
        expect(entryCountLabel(12)).toBe('12 entries');
    });
});

describe('TimelineFooter', () => {
    it('picks its state from the pagination flags', () => {
        expect(footerStateFor(true, true, 10)).toBe('loading');
        expect(footerStateFor(false, false, 10)).toBe('end');
        expect(footerStateFor(false, true, 10)).toBe('idle');
        // An empty list shows no "start of your timeline" marker.
        expect(footerStateFor(false, false, 0)).toBe('idle');
    });

    it.each(['loading', 'end', 'idle'] as const)('is exactly TIMELINE_FOOTER_HEIGHT tall when %s', async (state) => {
        const view = await render(<TimelineFooter state={state} colors={colors} />);
        const style = flat(view.getByTestId('timeline-footer'));
        expect(style.height).toBe(TIMELINE_FOOTER_HEIGHT);
        // No min/max escape hatch that could let content change the height.
        expect(style.minHeight).toBeUndefined();
        expect(style.maxHeight).toBeUndefined();
    });
});

describe('BackToTopPill', () => {
    it(`shows only past ${BACK_TO_TOP_VIEWPORTS} viewports, and never before layout`, () => {
        expect(shouldShowBackToTop(0, 800)).toBe(false);
        expect(shouldShowBackToTop(800 * BACK_TO_TOP_VIEWPORTS, 800)).toBe(false);
        expect(shouldShowBackToTop(800 * BACK_TO_TOP_VIEWPORTS + 1, 800)).toBe(true);
        expect(shouldShowBackToTop(99_999, 0)).toBe(false);
    });

    it('is a labelled button that calls back on press', async () => {
        const onPress = jest.fn();
        const view = await render(<BackToTopPill colors={colors} onPress={onPress} />);
        await fireEvent.press(view.getByLabelText('Back to top'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
