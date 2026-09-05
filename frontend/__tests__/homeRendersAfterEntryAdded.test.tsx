/**
 * Regression test for "Home renders blank after submitting a new entry"
 * (reported on-device 2026-09-05, release build from main@44143be).
 *
 * SYMPTOM: tap the FAB, pick a mood + activities, Submit, and Home comes back
 * with nothing on it. No page header, no cards; only the tab bar and the FAB,
 * which are the two pieces of Home chrome rendered OUTSIDE `Layout`'s content
 * wrapper. Statistics showed the new entry correctly, and switching to it and
 * back did NOT bring Home back; only a process restart did.
 *
 * The blank was a NATIVE-layer failure (see
 * __tests__/layoutContentNotAnimated.test.tsx for the reanimated mechanism and
 * the fix), jest cannot reproduce it. What this test owns is the other half of
 * the claim, the half that CAN be checked deterministically: that the JS side of
 * the post-write refresh is sound. Home must survive the exact state transition
 * the bug rode in on, a `bumpDataVersion()` while Home is mounted and focused,
 * moving the database from N entries to N+1, with every card still rendered and
 * the new entry's data actually reflected.
 *
 * It is deliberately driven through the REAL `dataRefreshStore` and the REAL
 * `useDataRefresh`, not a stubbed refresh: the write path fires exactly this
 * signal, and a previous incarnation of that signal (a `refreshCount` through
 * DataContext) silently failed to reach the tab screens for over a year.
 */
import { render, screen, waitFor, act } from '@testing-library/react-native';

import { bumpDataVersion } from '@/context/dataRefreshStore';
import { localDateString } from '@/databases/dateHelpers';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// reanimated's worklet runtime is unavailable under jest. Layout itself no longer
// touches reanimated (that is the fix), but Home's ActivityExplorer reaches
// OverlayModal, which does.
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const passthrough = (props: Record<string, unknown>) => ReactLocal.createElement(View, props);
    return {
        __esModule: true,
        default: { View: passthrough, ScrollView: passthrough },
        View: passthrough,
        useSharedValue: (v: unknown) => ({ value: v }),
        useAnimatedStyle: (fn: () => unknown) => fn(),
        withTiming: (v: unknown) => v,
        withSpring: (v: unknown) => v,
        FadeIn: { duration: () => ({}) },
        FadeOut: { duration: () => ({}) },
        Easing: { out: (e: unknown) => e, cubic: (x: unknown) => x },
    };
});

// The per-activity insights overlay only mounts once an activity is TAPPED; this
// scenario never opens it, and its real implementation needs the OverlayHost
// provider that lives in the (tabs) layout.
jest.mock('@/components/OverlayModal', () => ({ OverlayModal: () => null }));

// `useDataRefresh` calls `useFocusEffect`; outside a navigator it is just "run
// this effect". Home is mounted AND focused for the whole of this scenario,
// which is precisely the case the bug occurs in.
jest.mock('expo-router', () => {
    const ReactLocal = require('react');
    return { useFocusEffect: (cb: () => void) => ReactLocal.useEffect(cb, [cb]) };
});

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return { ...actual, useThemeColors: () => actual.themeColors.dark };
});

// The FAB owns the entry form (sqlite + overlay host). It is chrome OUTSIDE the
// wrapper that blanked, so it is not what this test is about.
jest.mock('@/components/AddEntryButton', () => ({ AddEntryButton: () => null }));

/**
 * A fake database whose contents CHANGE between reads, so a refetch genuinely
 * has something new to report. `entries` is mutated by the test to simulate the
 * submit, then `bumpDataVersion()` fires the same signal `addMoodEntry` does.
 */
type FakeEntry = { date: string; mood: number };
const today = new Date();
const iso = (daysAgo: number, hour = 12) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
};

let entries: FakeEntry[] = [];

const mockDb = {
    getFirstAsync: jest.fn(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return { count: entries.length };
        // Today's average mood. Keyed with the app's own LOCAL-day helper, an
        // ISO string's own date part is UTC and drifts a day either side of
        // midnight, which would make this fake disagree with the screen.
        const todayKey = localDateString(new Date());
        const todays = entries.filter(e => localDateString(e.date) === todayKey);
        if (todays.length === 0) return { mood: null };
        return { mood: todays.reduce((a, e) => a + e.mood, 0) / todays.length };
    }),
    getAllAsync: jest.fn(async (sql: string) => {
        if (sql.includes('FROM activities a')) {
            // Top activities for the "Recent activities" card.
            return [{ name: 'Reading', icon_name: 'book', icon_family: 'Feather', count: 99 }];
        }
        if (sql.includes('activity_id')) {
            // ACTIVITY_ENTRY_COUNTS, for ActivityExplorer. A fixed, distinctive
            // count so the explorer row can never collide with the "Total
            // entries" value the assertions below key on.
            return [{ activity_id: 1, n: 99 }];
        }
        // WEEKLY_MOOD_AVERAGES / MONTHLY_DAILY_AVERAGES / RECENT_ENTRY_DATES all
        // read {date, mood} rows off the same table.
        return entries.map(e => ({ date: e.date, mood: e.mood }));
    }),
};

jest.mock('expo-sqlite', () => ({
    useSQLiteContext: () => mockDb,
    openDatabaseSync: () => mockDb,
}));

jest.mock('@/databases/activities', () => ({
    getActivities: async () => [
        { id: 1, name: 'Reading', group_id: 4, icon_family: 'Feather', icon_name: 'book', position: 0 },
    ],
}));

import Home from '@/app/(tabs)/index';
import { greetingForHour } from '@/lib/greeting';

/** The cards that make up Home. If any is missing, Home is not rendered. */
const HOME_LANDMARKS = ["Today's Mood", 'Past 7 days', 'Last 30 days', 'Explore your activities'];

describe('Home survives the post-write refresh that used to blank it', () => {
    beforeEach(() => {
        // Three days of history, none of them today, so "Today's Mood" starts empty
        // and the submitted entry visibly changes it.
        entries = [
            { date: iso(1), mood: 6 },
            { date: iso(2), mood: 7 },
            { date: iso(3), mood: 5 },
        ];
    });

    it('renders the header and every card after the entry count goes 3 -> 4', async () => {
        render(<Home />);

        const greeting = greetingForHour(new Date().getHours());

        // Baseline: Home is fully rendered against 3 entries.
        await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
        expect(screen.getByText(greeting)).toBeTruthy();
        for (const landmark of HOME_LANDMARKS) {
            expect(screen.getByText(landmark)).toBeTruthy();
        }

        // The submit: a new entry lands for TODAY, then the write path's own
        // signal fires while Home is mounted and focused.
        entries = [...entries, { date: iso(0, 9), mood: 9 }];
        await act(async () => {
            bumpDataVersion();
        });

        // The whole page must still be there, this is the assertion the bug broke.
        await waitFor(() => expect(screen.getByText('4')).toBeTruthy());
        expect(screen.getByText(greeting)).toBeTruthy();
        for (const landmark of HOME_LANDMARKS) {
            expect(screen.getByText(landmark)).toBeTruthy();
        }

        // ...and it must show the NEW data, not a stale render that merely survived:
        // today's mood card flips off its "No entry yet" empty state.
        expect(screen.queryByText('No entry yet')).toBeNull();
        expect(screen.getByText('9.0')).toBeTruthy();
    });

    it('keeps rendering across several consecutive refreshes', async () => {
        render(<Home />);
        await waitFor(() => expect(screen.getByText('3')).toBeTruthy());

        // Each refresh re-lays-out the page; the native bug surfaced on one of
        // those re-layouts, so a single transition is a thin guard.
        for (let i = 4; i <= 7; i++) {
            entries = [...entries, { date: iso(0, 8 + i), mood: 5 }];
            await act(async () => {
                bumpDataVersion();
            });
            await waitFor(() => expect(screen.getByText(String(i))).toBeTruthy());
            for (const landmark of HOME_LANDMARKS) {
                expect(screen.getByText(landmark)).toBeTruthy();
            }
        }
    });
});
