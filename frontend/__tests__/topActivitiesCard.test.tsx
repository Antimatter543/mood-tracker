/**
 * TopActivitiesCard ("What lifts your mood" on Insights).
 *
 * Regression for PR #24: the empty-state hint ("Log activities alongside your
 * mood...") must render when no activity lifts mood. The first cut of the
 * multi-activity change used `slice(0, 3) ?? fallback`, and slice never yields
 * null, so new users saw a blank card. Covers 0, 1 and 3 activities.
 *
 * Follows the useThemeColors mock pattern of healthMoodPagerCard.test.tsx.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule('dark'));

import { computePeriodWindow, formatPeriodLabel, PeriodWindow } from '@/components/visualisations/transforms/periodWindow';
import TopActivitiesCard from '@/components/visualisations/TopActivitiesCard';
import { ActivityCorrelationResult } from '@/components/visualisations/transforms/activityCorrelation';
import { Settings } from '@/databases/settings';
import { FIXED_DAY, FIXED_NOW, FIXED_NOW_ISO } from '@/testing/builders';
import { Activity, ActivityGroup } from '@/components/types';
import { makeDb, MockDb } from '@/testing/fakeDb';
import { freezeNow } from '@/testing/clock';
import { CoOccurringRow } from '@/components/visualisations/transforms/activityDetail';
import { CO_OCCURRING_ACTIVITIES_IN_RANGE, ENTRIES_FOR_ACTIVITY_IN_RANGE } from '@/components/visualisations/queries';
import { SQLiteDatabase } from 'expo-sqlite';

// `useDataRefresh` calls `useFocusEffect`; outside a navigator it is "run this effect".
jest.mock('expo-router', () => {
    const ReactLocal = require('react');
    return { useFocusEffect: (cb: () => void) => ReactLocal.useEffect(cb, [cb]) };
});

// The detail page opens through OverlayModal, whose real host lives in the
// (tabs) layout; here it renders its children in place while visible.
jest.mock('@/components/OverlayModal', () => ({
    OverlayModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
        visible ? children : null,
}));

// The FAB (page chrome, owns the entry form) is not what this suite is about.
jest.mock('@/components/AddEntryButton', () => ({ AddEntryButton: () => null }));

// A fixed date style, so "16 May" reads the same on every machine.
const mockSettings: Settings = {
    fab_position: 'right',
    theme_mode: 'dark',
    theme: 'dark',
    mood_precision: 'low',
    show_mood_benchmarks: true,
    activity_carryover: false,
    date_format: 'dmy',
    reminders: '[]',
};

jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings, updateSetting: jest.fn() }),
}));

/** The fake database's activities tables. */
const rows = new Map<number, Activity>();
const entryRows: { id: number; date: string; mood: number }[] = [{id: 1, date: FIXED_NOW_ISO, mood: 5}];
const groups = [{id: 1, name: 'Activities', sort_order: 1}]
const coRows: CoOccurringRow[] = [];

const walk: Activity = {
    id: 5,
    name: 'Walking',
    group_id: 1,
    position: 1,
    icon_family: 'Feather',
    icon_name: 'activity',
} as Activity;

const read: Activity = {
    id: 6,
    name: 'Reading',
    group_id: 1,
    position: 1,
    icon_family: 'Feather',
    icon_name: 'activity',
} as Activity;

const cook: Activity = {
    id: 7,
    name: 'Cooking',
    group_id: 1,
    position: 1,
    icon_family: 'Feather',
    icon_name: 'activity',
} as Activity;

rows.set(walk.id, walk);
rows.set(read.id, read);
rows.set(cook.id, cook);


function mockReadActivity(params: unknown[] | number): Activity | null {
    const id = Number(Array.isArray(params) ? params[0] : params);
    const row = rows.get(id);
    return row ? { ...row } : null;
}

function mockReadGroup(params: unknown[] | number): ActivityGroup | null {
    const id = Number(Array.isArray(params) ? params[0] : params);
    return groups[id - 1];
}

let mockCurrentDb: MockDb;
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockCurrentDb }));

jest.mock('@/databases/activities', () => ({
    getActivity: (_: SQLiteDatabase, id: number) => mockReadActivity(id),
}));

const mockRefetchEntries = jest.fn();
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: mockRefetchEntries }),
}));

function installDb(): MockDb {
    const db = makeDb();
    db.getAllAsync.mockImplementation(async (sql: string) => {
        if (sql === ENTRIES_FOR_ACTIVITY_IN_RANGE) return entryRows;
        if (sql === CO_OCCURRING_ACTIVITIES_IN_RANGE) return coRows;
        if (/FROM activity_groups/.test(sql)) return groups;
        return [];
    });
    const first = (sql: string, ...rest: unknown[]) => {
        if (/FROM activities WHERE id = \?/.test(sql))
            return mockReadActivity(rest.length === 1 && Array.isArray(rest[0]) ? (rest[0] as unknown[]) : rest);
        if (/FROM activity_groups WHERE id = \?/.test(sql))
            return mockReadGroup(rest.length === 1 && Array.isArray(rest[0]) ? (rest[0] as unknown[]) : rest);
        if (/COUNT\(\*\)/.test(sql))
            return { count: entryRows.length };
        return null;
    };
    db.getFirstAsync.mockImplementation(async (sql: string, ...rest: unknown[]) => first(sql, ...rest));
    return db;
}

const mockPeriodWindow = jest.fn<PeriodWindow, []>();
const mockPeriodLabel = jest.fn<string, []>();
jest.mock('@/context/TimeframeContext', () => ({
    useTimeframe: () => ({
        periodWindow: mockPeriodWindow(),
        periodLabel: mockPeriodLabel(),
    }),
}));


beforeEach(() => {
    freezeNow(FIXED_NOW);
    mockCurrentDb = installDb();
    mockPeriodWindow.mockReturnValue(computePeriodWindow('month', 0, FIXED_DAY));
    mockPeriodLabel.mockReturnValue(formatPeriodLabel('month', 0, FIXED_DAY, 'ymd'));
});


const EMPTY_HINT = /Log activities alongside your mood/;

const correlation = (id: number, name: string, delta: number): ActivityCorrelationResult => ({
    activity_id: id,
    activity_name: name,
    avg_with: 4 + delta,
    avg_without: 4,
    delta,
    count_with: 5,
    count_without: 5,
    isMeaningful: true,
});

describe('TopActivitiesCard', () => {
    it('shows the title and the empty-state hint when there are no activities', async () => {
        const { getByText } = await render(<TopActivitiesCard activities={[]} />);
        expect(getByText('What lifts your mood')).toBeTruthy();
        expect(getByText(EMPTY_HINT)).toBeTruthy();
    });

    it('renders one sentence and no empty hint for a single activity', async () => {
        const { getByText, queryByText, queryAllByText } = await render(
            <TopActivitiesCard activities={[correlation(5, 'Walking', 1.5)]} />
        );
        expect(getByText('Walking')).toBeTruthy();
        expect(getByText('+1.5')).toBeTruthy(); // delta, 1 decimal
        expect(getByText('5.5')).toBeTruthy(); // avgWith
        expect(queryAllByText(/When you log/)).toHaveLength(1);
        expect(queryByText(EMPTY_HINT)).toBeNull();
    });

    it('renders one sentence per activity for three', async () => {
        const { getAllByText, getByText, queryByText } = await render(
            <TopActivitiesCard
                activities={[correlation(5, 'Walking', 1.5), correlation(6, 'Reading', 1.0), correlation(7, 'Cooking', 0.5)]}
            />
        );
        expect(getAllByText(/When you log/)).toHaveLength(3);
        ['Walking', 'Reading', 'Cooking'].forEach((n) => expect(getByText(n)).toBeTruthy());
        expect(queryByText(EMPTY_HINT)).toBeNull();
    });

    it('opens activity details when activity tapped', async () => {
        await render(
            <TopActivitiesCard
                activities={[correlation(5, 'Walking', 1.5)]}
            />
        );
        
        await act(async () => {
            const details = screen.getByRole('button', { name: /^Show activity details for Walking/i})
            fireEvent.press(details);
        });

        // Title should be Run now and Walk should not be present (as coRows is empty)
        await waitFor(() => expect(screen.getByTestId('activity-detail-title')?.children[0]?.toString()).toBe('Walking'));
        await waitFor(() => expect(screen.getByText(`${entryRows.length} ${entryRows.length == 1 ? 'entry' : 'entries'}`)).toBeTruthy());
        await waitFor(() => expect(screen.getByText('How often your mood on Walking lands at each level.')).toBeTruthy());
    });    
});
