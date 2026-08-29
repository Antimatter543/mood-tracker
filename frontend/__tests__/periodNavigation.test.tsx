/**
 * Wiring tests for period navigation: TimeframeProvider + PeriodNavigator.
 *
 * periodWindow.test.ts already proves the math. What can still break is the
 * WIRING — and every one of these is a bug a user would actually hit:
 *   - the arrows are disabled in the right states (no future, no empty history),
 *   - stepping actually moves the window the charts query, not just the label,
 *   - switching the timeframe pill returns you to the present,
 *   - the back-bound still applies once the earliest-entry query resolves, which
 *     happens AFTER first paint (so "unknown" briefly means "unbounded").
 *
 * A probe component renders the context values as text, so the assertions are on
 * the exact `periodWindow` the six timeframe-scoped charts receive, not on a
 * re-derivation of it.
 */
import React from 'react';
import { Text, Pressable } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ── "Today" is pinned so the labels/windows below are stable forever. The
//    provider reads it through todayLocalDay(); everything else stays real. ────
const TODAY = '2026-08-29';
jest.mock('@/components/visualisations/transforms/periodWindow', () => ({
    ...jest.requireActual('@/components/visualisations/transforms/periodWindow'),
    todayLocalDay: () => TODAY,
}));

// ── Mock DB. `earliestEntryIso` is mutable so each test can set how much
//    history the user has before rendering. ────────────────────────────────────
let earliestEntryIso: string | null = null;
const mockDb = {
    getFirstAsync: jest.fn(async () => ({ date: earliestEntryIso })),
    getAllAsync: jest.fn().mockResolvedValue([]),
};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));

// ── useFocusEffect models FOCUS GAIN only (mount-once), matching the pattern in
//    dbViewerLoadRace.test.tsx. ────────────────────────────────────────────────
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; the ref keeps the latest cb without re-running on identity change
            const ref = ReactActual.useRef(cb);
            ref.current = cb;
            ReactActual.useEffect(() => ref.current(), []);
        },
    };
});

jest.mock('@/context/dataRefreshStore', () => ({ useDataVersion: () => 0 }));

jest.mock('@/styles/global', () => ({
    useThemeColors: () => ({
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
    }),
}));

import PeriodNavigator from '@/components/PeriodNavigator';
import { TimeframeProvider, useTimeframe, type Timeframe } from '@/context/TimeframeContext';

/** Surfaces the context values the charts consume, plus a way to switch pills. */
const Probe: React.FC = () => {
    const { offset, periodWindow, setTimeframe } = useTimeframe();
    return (
        <>
            <Text testID="probe-offset">{String(offset)}</Text>
            <Text testID="probe-window">{`${periodWindow.startDay}..${periodWindow.endDay}`}</Text>
            <Text testID="probe-sql">{`${periodWindow.start}|${periodWindow.end}`}</Text>
            {(['week', 'year', 'alltime'] as Timeframe[]).map((tf) => (
                <Pressable key={tf} testID={`set-${tf}`} onPress={() => setTimeframe(tf)}>
                    <Text>{tf}</Text>
                </Pressable>
            ))}
        </>
    );
};

/**
 * Renders the tree and waits for the earliest-entry query to settle, so tests
 * assert the steady state rather than the brief "history unknown" one.
 */
const renderNav = async () => {
    const view = await render(
        <TimeframeProvider>
            <PeriodNavigator />
            <Probe />
        </TimeframeProvider>,
    );
    await waitFor(() => expect(mockDb.getFirstAsync).toHaveBeenCalled());
    // Flush the setState from the resolved query.
    await act(async () => {});
    return view;
};

const isDisabled = (node: any) => node.props.accessibilityState?.disabled === true;

/** RNTL 14 is async-by-default: every render/fireEvent must be awaited. */
const press = (view: any, testID: string) => fireEvent.press(view.getByTestId(testID));

beforeEach(() => {
    jest.clearAllMocks();
    earliestEntryIso = null;
});

describe('PeriodNavigator — initial state', () => {
    it('shows the current period and cannot move forward from it', async () => {
        earliestEntryIso = '2024-01-01T00:00:00.000Z';
        const view = await renderNav();

        // Default timeframe is 'month' (30 days ending today).
        expect(view.getByTestId('period-nav-label')).toHaveTextContent('Jul 31 – Aug 29');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
        expect(isDisabled(view.getByTestId('period-nav-forward'))).toBe(true);
        expect(isDisabled(view.getByTestId('period-nav-back'))).toBe(false);
    });

    it('hands the charts a whole-day UTC window for the current period', async () => {
        earliestEntryIso = '2024-01-01T00:00:00.000Z';
        const view = await renderNav();
        // Brisbane (UTC+10): local Jul 31 00:00 -> Jul 30 14:00Z.
        expect(view.getByTestId('probe-sql')).toHaveTextContent(
            '2026-07-30T14:00:00.000Z|2026-08-29T13:59:59.999Z',
        );
    });
});

describe('PeriodNavigator — stepping', () => {
    it('moves the window the charts query, not just the label', async () => {
        earliestEntryIso = '2024-01-01T00:00:00.000Z';
        const view = await renderNav();

        await press(view, 'set-week');
        expect(view.getByTestId('probe-window')).toHaveTextContent(
            '2026-08-23..2026-08-29',
        );

        await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-1');
        expect(view.getByTestId('probe-window')).toHaveTextContent(
            '2026-08-16..2026-08-22',
        );
        expect(view.getByTestId('period-nav-label')).toHaveTextContent('Aug 16 – 22');
        // Having left the present, forward opens up.
        expect(isDisabled(view.getByTestId('period-nav-forward'))).toBe(false);

        await press(view, 'period-nav-back');
        expect(view.getByTestId('period-nav-label')).toHaveTextContent('Aug 9 – 15');
    });

    it('walks back toward the present and stops there', async () => {
        earliestEntryIso = '2024-01-01T00:00:00.000Z';
        const view = await renderNav();
        await press(view, 'set-week');

        await press(view, 'period-nav-back');
        await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-2');

        await press(view, 'period-nav-forward');
        await press(view, 'period-nav-forward');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
        expect(isDisabled(view.getByTestId('period-nav-forward'))).toBe(true);

        // Pressing a disabled arrow must not smuggle the user into the future.
        await press(view, 'period-nav-forward');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
    });

    it('returns to the present when the label is tapped', async () => {
        earliestEntryIso = '2024-01-01T00:00:00.000Z';
        const view = await renderNav();
        await press(view, 'set-week');

        for (let i = 0; i < 4; i++) await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-4');

        await press(view, 'period-nav-label');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
        expect(view.getByTestId('period-nav-label')).toHaveTextContent('Aug 23 – 29');
    });
});

describe('PeriodNavigator — the earliest-entry back-bound', () => {
    it('stops at the last period containing history', async () => {
        // 2026-08-08 is 21 days back: weeks -1, -2 and -3 still reach it.
        earliestEntryIso = '2026-08-08T09:00:00.000Z';
        const view = await renderNav();
        await press(view, 'set-week');

        for (let i = 0; i < 3; i++) await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-3');
        expect(isDisabled(view.getByTestId('period-nav-back'))).toBe(true);

        await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-3');
    });

    it('keys the bound to the LOCAL day of the first entry, not the UTC one', async () => {
        // 2026-08-07T20:00Z is already Aug 8 in Brisbane. Keying it in UTC would
        // hand the user a whole extra week of empty history.
        earliestEntryIso = '2026-08-07T20:00:00.000Z';
        const view = await renderNav();
        await press(view, 'set-week');

        for (let i = 0; i < 5; i++) await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-3');
    });

    it('pins a brand-new user to the current period', async () => {
        earliestEntryIso = `${TODAY}T02:00:00.000Z`;
        const view = await renderNav();
        expect(isDisabled(view.getByTestId('period-nav-back'))).toBe(true);
        expect(isDisabled(view.getByTestId('period-nav-forward'))).toBe(true);
    });

    // The query resolves after first paint, so an offset that was legal under
    // "history unknown" can become illegal a moment later.
    it('snaps an already-paged-back offset into range when the bound arrives', async () => {
        let resolveEarliest!: (v: { date: string | null }) => void;
        mockDb.getFirstAsync.mockImplementationOnce(
            () => new Promise((resolve) => { resolveEarliest = resolve; }),
        );

        const view = await render(
            <TimeframeProvider>
                <PeriodNavigator />
                <Probe />
            </TimeframeProvider>,
        );
        await press(view, 'set-week');

        // History unknown -> navigation stays open rather than locking up.
        expect(isDisabled(view.getByTestId('period-nav-back'))).toBe(false);
        for (let i = 0; i < 6; i++) await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-6');

        await act(async () => {
            resolveEarliest({ date: '2026-08-08T09:00:00.000Z' });
        });

        expect(view.getByTestId('probe-offset')).toHaveTextContent('-3');
        expect(isDisabled(view.getByTestId('period-nav-back'))).toBe(true);
    });

    it('keeps navigation open when the earliest-entry query fails', async () => {
        mockDb.getFirstAsync.mockRejectedValueOnce(new Error('db gone'));
        const view = await renderNav();
        expect(isDisabled(view.getByTestId('period-nav-back'))).toBe(false);
    });
});

describe('PeriodNavigator — changing the timeframe', () => {
    it('returns to the present, because "5 weeks back" has no year equivalent', async () => {
        earliestEntryIso = '2020-01-01T00:00:00.000Z';
        const view = await renderNav();

        await press(view, 'set-week');
        for (let i = 0; i < 5; i++) await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-5');

        await press(view, 'set-year');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
        expect(view.getByTestId('period-nav-label')).toHaveTextContent('Aug 2025 – Aug 2026');
    });

    it('drops the chevrons entirely on All Time', async () => {
        earliestEntryIso = '2020-01-01T00:00:00.000Z';
        const view = await renderNav();

        await press(view, 'set-alltime');
        expect(view.getByTestId('period-nav-label')).toHaveTextContent('All time');
        expect(view.queryByTestId('period-nav-back')).toBeNull();
        expect(view.queryByTestId('period-nav-forward')).toBeNull();
    });
});
