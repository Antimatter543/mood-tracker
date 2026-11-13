/**
 * "After low days" (PR #48): where it shows, when it hides, and what it says.
 *
 * Product calls this pins:
 *   - it lives on Insights (after "What helps you steady"), never on Home;
 *   - with no low stretch in the last 90 days it renders NOTHING (no card,
 *     no empty message, no (i));
 *   - its words: "low stretch", "Back to 6+", "Steady at 5+", no percentages,
 *     no "episode", no "recovered / not recovered", no "worsening".
 *
 * Harness: the card loads its own window with RECOVERY_ENTRY_ACTIVITIES, so the
 * fake db answers that statement by identity and everything else with empty
 * rows. The app clock is frozen at FIXED_NOW (2026-06-15, noon local).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { RECOVERY_ENTRY_ACTIVITIES } from '@/components/visualisations/queries';
import { LOW_STRETCH_EXPLAINER, type RecoveryRawRow } from '@/components/visualisations/transforms/recoveryPatterns';
import { freezeNow } from '@/testing/clock';
import { FIXED_DAY, FIXED_NOW, addDays, localIso } from '@/testing/builders';
import { code } from '@/testing/sourceScan';
import { walkTree } from '@/testing/rntl';
import type { Settings } from '@/databases/settings';

// The detail page opens through OverlayModal, whose real host lives in the
// (tabs) layout; here it renders its children in place while visible.
jest.mock('@/components/OverlayModal', () => ({
    OverlayModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
        visible ? children : null,
}));

jest.mock('expo-router', () => {
    const ReactLocal = require('react');
    return { useFocusEffect: (cb: () => void) => ReactLocal.useEffect(cb, [cb]) };
});

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule('dark'));

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
    activity_per_entry: false,
    date_format: 'dmy',
    reminders: '[]',
};
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings, updateSetting: jest.fn() }),
}));

let recoveryRows: RecoveryRawRow[] = [];
let nextId = 1;
const entry = (daysAgo: number, mood: number): RecoveryRawRow => ({
    id: nextId++,
    date: localIso(addDays(FIXED_DAY, -daysAgo), 12),
    mood,
    aId: null,
    aName: null,
    aGroup: null,
    aIconFamily: null,
    aIconName: null,
    aPosition: null,
});

const mockDb = {
    getFirstAsync: jest.fn(async () => ({ avg_mood: 6, entry_count: 12 })),
    getAllAsync: jest.fn(async (sql: string) => (sql === RECOVERY_ENTRY_ACTIVITIES ? recoveryRows : [])),
};
jest.mock('expo-sqlite', () => ({
    useSQLiteContext: () => mockDb,
    openDatabaseSync: () => mockDb,
}));

import InsightsScreen from '@/app/(tabs)/insights';
import RecoveryAnalysisCard from '@/components/visualisations/RecoveryPatterns';

/** No lows at all: moods 5..8 over two weeks. */
const NO_LOWS = () => [entry(14, 6), entry(10, 5), entry(7, 8), entry(3, 7), entry(1, 6)];

/**
 * Two ended stretches and one current:
 *   16 May - 18 May: 3, 7, 7          -> back to 6+ in 3 days
 *   26 May - 30 May: 2, then 5 x 4    -> steady at 5+
 *   12 Jun - now:    4, 5             -> 4 days so far
 */
const WITH_LOWS = () => [
    entry(30, 3), entry(29, 7), entry(28, 7),
    entry(20, 2), entry(19, 5), entry(18, 5), entry(17, 5), entry(16, 5),
    entry(3, 4), entry(2, 5),
];

/** Every string a user can see or hear: text nodes and accessibility labels. */
const allWords = (tree: unknown): string[] => {
    const out: string[] = [];
    walkTree(tree, (node) => {
        for (const child of node.children ?? []) if (typeof child === 'string') out.push(child);
        const label = node.props?.accessibilityLabel;
        if (typeof label === 'string') out.push(label);
    });
    return out;
};

const BANNED = /episode|success|%|recovered|worsening|ongoing/i;

beforeEach(() => {
    freezeNow(FIXED_NOW);
    nextId = 1;
    mockDb.getAllAsync.mockClear();
});

describe('After low days on Insights', () => {
    it('is absent when the last 90 days have no low stretch', async () => {
        recoveryRows = NO_LOWS();
        await render(<InsightsScreen />);
        // The neighbour above it has rendered, and the card's own query ran.
        await screen.findByText('What helps you steady');
        await waitFor(() =>
            expect(mockDb.getAllAsync.mock.calls.some(([sql]) => sql === RECOVERY_ENTRY_ACTIVITIES)).toBe(true),
        );
        expect(screen.queryByText('After low days')).toBeNull();
        expect(screen.queryByText(/low stretch/i)).toBeNull();
    });

    it('shows when there is a low stretch', async () => {
        recoveryRows = WITH_LOWS();
        await render(<InsightsScreen />);
        expect(await screen.findByText('After low days')).toBeTruthy();
        expect(screen.getByText('3 low stretches in the last 90 days')).toBeTruthy();
    });

    it('queries from the local start of the day 90 days ago', async () => {
        recoveryRows = [];
        await render(<RecoveryAnalysisCard />);
        await waitFor(() => expect(mockDb.getAllAsync).toHaveBeenCalled());
        const [sql, params] = mockDb.getAllAsync.mock.calls[0] as unknown as [string, string[]];
        expect(sql).toBe(RECOVERY_ENTRY_ACTIVITIES);
        expect(params).toEqual([localIso(addDays(FIXED_DAY, -90), 0)]);
    });
});

describe('Home never shows it', () => {
    it('Home does not import or mount the card', () => {
        const home = code('app/(tabs)/index.tsx');
        expect(home).not.toMatch(/RecoveryPatterns|RecoveryAnalysis/);
    });

    it('Insights mounts it after "What helps you steady" and before the health cards', () => {
        const insights = code('app/(tabs)/insights.tsx');
        const drivers = insights.indexOf('<MoodDriversCard');
        const card = insights.indexOf('<RecoveryAnalysisCard');
        const health = insights.indexOf('<HealthMoodPagerCard');
        expect(drivers).toBeGreaterThan(-1);
        expect(card).toBeGreaterThan(drivers);
        expect(health).toBeGreaterThan(card);
    });
});

describe('the card and its detail page', () => {
    it('renders nothing at all with no lows (no (i), no empty text)', async () => {
        recoveryRows = NO_LOWS();
        const view = await render(<RecoveryAnalysisCard />);
        await waitFor(() => expect(mockDb.getAllAsync).toHaveBeenCalled());
        expect(view.toJSON()).toBeNull();
    });

    it('says what happened, in the agreed words', async () => {
        recoveryRows = WITH_LOWS();
        await render(<RecoveryAnalysisCard />);
        await screen.findByText('After low days');

        expect(screen.getByTestId('low-stretch-summary')).toHaveTextContent(
            '3 low stretches in the last 90 days',
        );
        // One stretch got back to 6+, so no "usually".
        expect(screen.getByTestId('low-stretch-typical')).toHaveTextContent('Back to 6+ in 3 days');

        expect(screen.getByText('Since 12 Jun')).toBeTruthy();
        expect(screen.getByText('4 days so far')).toBeTruthy();
        expect(screen.getByText(/^Lowest 4 . latest 5$/)).toBeTruthy();

        // Ended stretches, newest first: dates + status only.
        expect(screen.getByTestId('low-stretch-row-0')).toHaveTextContent(/26 May – 30 May\s*Steady at 5\+/);
        expect(screen.getByTestId('low-stretch-row-1')).toHaveTextContent(/16 May – 18 May\s*Back to 6\+/);

        // The row's spoken label carries the dates and the status.
        expect(screen.getByTestId('low-stretch-row-1').props.accessibilityLabel).toBe(
            'Low stretch 16 May to 18 May, back to 6+. Opens details.',
        );
    });

    it('says "usually" only once two stretches got back to 6+', async () => {
        recoveryRows = [
            entry(40, 3), entry(39, 7), entry(38, 7),
            entry(30, 2), entry(29, 4), entry(28, 6), entry(27, 6),
        ];
        await render(<RecoveryAnalysisCard />);
        expect(await screen.findByTestId('low-stretch-typical')).toHaveTextContent(
            'Usually back to 6+ in about 4 days',
        );
    });

    it('opens the detail page for a row', async () => {
        recoveryRows = WITH_LOWS();
        await render(<RecoveryAnalysisCard />);
        await fireEvent.press(await screen.findByTestId('low-stretch-row-1'));
        expect(screen.getByTestId('low-stretch-detail-title')).toHaveTextContent(
            'Low stretch, 16 May – 18 May',
        );
        expect(screen.getByTestId('low-stretch-detail-status')).toHaveTextContent('Back to 6+');
        // No activities were logged, so the coloured empty line shows.
        expect(screen.getByText('Not enough entries yet')).toBeTruthy();
    });

    it('titles a current stretch "– now"', async () => {
        recoveryRows = WITH_LOWS();
        await render(<RecoveryAnalysisCard />);
        await fireEvent.press(await screen.findByTestId('low-stretch-current'));
        expect(screen.getByTestId('low-stretch-detail-title')).toHaveTextContent('Low stretch, 12 Jun – now');
        expect(screen.getByTestId('low-stretch-detail-status')).toHaveTextContent('4 days so far');
    });

    // Device QA 2026-11-13: the shared InfoBubble draws its text in an absolute
    // popup, which the Card's overflow:hidden clipped mid-sentence on a card
    // with one row. The explanation now opens in the card's own flow, so the
    // card grows to fit it.
    it('opens its explanation inside the card, not in a popup the card can clip', async () => {
        recoveryRows = [entry(30, 3), entry(29, 7), entry(28, 7)]; // one ended row: the short card
        const view = await render(<RecoveryAnalysisCard />);
        await screen.findByText('After low days');
        expect(screen.queryByTestId('low-stretch-explainer')).toBeNull();

        const toggle = screen.getByTestId('low-stretch-explainer-toggle');
        expect(toggle.props.accessibilityLabel).toBe('How low stretches are counted');
        await fireEvent.press(toggle);

        const box = screen.getByTestId('low-stretch-explainer');
        expect(box).toHaveTextContent(LOW_STRETCH_EXPLAINER);
        // Nothing between the card and the text is taken out of the layout flow.
        const absolute: unknown[] = [];
        walkTree(view.toJSON(), (node) => {
            const flat = [node.props?.style].flat(Infinity).filter(Boolean);
            const hasText = JSON.stringify(node).includes(LOW_STRETCH_EXPLAINER.slice(0, 40));
            if (hasText && flat.some((st: { position?: string }) => st?.position === 'absolute')) {
                absolute.push(node.props?.testID ?? node.type);
            }
        });
        expect(absolute).toEqual([]);

        await fireEvent.press(screen.getByTestId('low-stretch-explainer-toggle'));
        expect(screen.queryByTestId('low-stretch-explainer')).toBeNull();
    });

    it('uses none of the retired words anywhere a user can see or hear', async () => {
        recoveryRows = WITH_LOWS();
        const view = await render(<RecoveryAnalysisCard />);
        await screen.findByText('After low days');
        await fireEvent.press(screen.getByTestId('low-stretch-explainer-toggle'));
        const words = allWords(view.toJSON());
        await fireEvent.press(screen.getByTestId('low-stretch-row-0'));
        words.push(...allWords(view.toJSON()));
        await fireEvent.press(screen.getByTestId('low-stretch-current'));
        words.push(...allWords(view.toJSON()));

        expect(words.length).toBeGreaterThan(10);
        expect(words.filter((w) => BANNED.test(w))).toEqual([]);
    });
});
