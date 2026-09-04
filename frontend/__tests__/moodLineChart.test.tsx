/**
 * Render tests for MoodLineChart — the WIRING between the pure geometry
 * (covered exhaustively in lineChartGeometry.test.ts / chartGeometry.test.ts)
 * and what actually reaches the screen.
 *
 * What only a render test can see:
 *  - the chart draws NOTHING until onLayout reports a width (it measures, it
 *    never guesses from SCREEN_WIDTH), and everything appears once it does;
 *  - the axis is DRAWN here (unlike the Home card), with one gridline per tick;
 *  - a day with no entry gets NO dot and a dashed bridge — absence must read as
 *    "no data", never as a bad day;
 *  - an all-null series and an EMPTY series both render without throwing.
 *    Empty-database is a real code path in this app (CLAUDE.md), and a chart
 *    that throws on it white-screens the whole Statistics tab.
 *
 * Follows the useThemeColors mock pattern of metricMoodCard.test.tsx, so no
 * SettingsProvider is needed.
 */
import { fireEvent, render } from '@testing-library/react-native';

// reanimated's worklets runtime is unavailable under jest. The chart only uses
// it for the tooltip's fade-in leaf, so shim exactly that surface (same pattern
// as recentlyDeletedPanel.test.tsx).
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const anim = { duration: () => anim };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        FadeIn: anim,
    };
});

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

import MoodLineChart, {
    type MoodLinePoint,
} from '@/components/visualisations/MoodLineChart';

const CHART_WIDTH = 320;

const day = (n: number): string => `2026-09-${String(n).padStart(2, '0')}`;

/** Mixed series: real / real / GAP / real / real. */
const mixed: MoodLinePoint[] = [
    { date: day(1), value: 4 },
    { date: day(2), value: 6.5 },
    { date: day(3), value: null },
    { date: day(4), value: 8 },
    { date: day(5), value: 3 },
];

// RNTL 14: `render` and `fireEvent` are ASYNC. An un-awaited call silently
// does nothing and reads as a broken component, every helper here awaits.
type View = Awaited<ReturnType<typeof render>>;

const renderChart = (props: Partial<React.ComponentProps<typeof MoodLineChart>> = {}) =>
    render(<MoodLineChart series={mixed} {...props} />);

/**
 * Y-axis labels, read off the SVG <Text> nodes. react-native-svg text is NOT
 * reachable through `queryByText`, so an assertion phrased that way would pass
 * forever whatever the axis said — the vacuous-assertion trap in
 * tasks/lessons.md. Reading the node's own children is non-vacuous: the
 * "fixed 0..10" case below proves these labels really do come back.
 */
// react-native-svg renders text into a TSpan grandchild, so the string is
// reachable through neither `queryByText` nor the node's own props. The chart
// therefore also puts each value on the label's accessibilityLabel (which
// screen readers want anyway) — that is what we read here.
const gridLabels = (view: View): string[] =>
    view
        .queryAllByTestId('mood-line-chart-grid-label')
        .map((n) => String(n.props.accessibilityLabel));

/** The SVG only mounts once the wrapper has measured a real width. */
const measure = async (view: View, testID = 'mood-line-chart') => {
    await fireEvent(view.getByTestId(testID), 'layout', {
        nativeEvent: { layout: { width: CHART_WIDTH, height: 240 } },
    });
};

describe('MoodLineChart — measurement gate', () => {
    it('draws nothing before onLayout, and the line after it', async () => {
        const view = await renderChart();
        // Unmeasured: no plot content at all (never a guessed screen width).
        expect(view.queryByTestId('mood-line-chart-line')).toBeNull();
        expect(view.queryAllByTestId('mood-line-chart-dot')).toHaveLength(0);

        await measure(view);

        expect(view.queryByTestId('mood-line-chart-line')).not.toBeNull();
        expect(view.queryAllByTestId('mood-line-chart-dot').length).toBeGreaterThan(0);
    });
});

describe('MoodLineChart — the drawn axis', () => {
    it('renders one gridline per tick of the fixed 0..10 scale', async () => {
        const view = await renderChart({ domain: 'fixed' });
        await measure(view);
        // 0/2/4/6/8/10 — the scale is DRAWN on Statistics, unlike the Home card.
        expect(view.queryAllByTestId('mood-line-chart-grid')).toHaveLength(6);
        expect(gridLabels(view)).toEqual(['0', '2', '4', '6', '8', '10']);
    });

    it('a fitted domain zooms in: its axis no longer spans 0..10', async () => {
        const tight: MoodLinePoint[] = [
            { date: day(1), value: 6.2 },
            { date: day(2), value: 6.6 },
            { date: day(3), value: 6.4 },
        ];
        const view = await render(<MoodLineChart series={tight} domain="fit" />);
        await measure(view);
        // The whole point of "Fit" — the low end of the scale is gone.
        const labels = gridLabels(view);
        expect(labels.length).toBeGreaterThan(1);
        expect(labels).not.toContain('0');
        // The axis brackets the data instead of dwarfing it.
        expect(Number(labels[0])).toBeLessThanOrEqual(6.2);
        expect(Number(labels[labels.length - 1])).toBeGreaterThanOrEqual(6.6);
    });
});

describe('MoodLineChart — missing days', () => {
    it('dots only the REAL points and bridges the gap with a dashed path', async () => {
        const view = await renderChart();
        await measure(view);
        // 4 real values in `mixed`, one null.
        expect(view.queryAllByTestId('mood-line-chart-dot')).toHaveLength(4);
        expect(view.queryAllByTestId('mood-line-chart-gap')).toHaveLength(1);
    });

    it('fills under the WHOLE shape, bridges included, as ONE region', async () => {
        const view = await renderChart();
        await measure(view);
        const d = String(view.getByTestId('mood-line-chart-area').props.d);
        // Statistics opts into `areaSpansGaps`. Closing the fill under each
        // solid run instead (the Home card's default) drew a narrow column
        // under every consecutive pair — a sparse month read as BARS, not as a
        // trend area. One M/Z pair is the lock on that.
        expect((d.match(/M/g) ?? [])).toHaveLength(1);
        expect((d.match(/Z/g) ?? [])).toHaveLength(1);
    });

    it('never colours a missing day red — the gap is drawn in the mood ramp', async () => {
        const view = await renderChart();
        await measure(view);
        const gap = view.getAllByTestId('mood-line-chart-gap')[0];
        // Red for "missing" was the old chart-kit behaviour and read as a bad
        // day. The bridge is painted from the same gradient as the line.
        expect(String(gap.props.stroke)).not.toMatch(/e74c3c|red/i);
    });
});

describe('MoodLineChart — degenerate series never throw', () => {
    it('renders an ALL-NULL series with no dots and no line', async () => {
        const allNull: MoodLinePoint[] = [1, 2, 3].map((n) => ({ date: day(n), value: null }));
        const view = await render(<MoodLineChart series={allNull} />);
        await expect(measure(view)).resolves.not.toThrow();
        expect(view.queryAllByTestId('mood-line-chart-dot')).toHaveLength(0);
        expect(view.queryByTestId('mood-line-chart-line')).toBeNull();
        // The axis still renders, so the card doesn't collapse to nothing.
        expect(view.queryAllByTestId('mood-line-chart-grid')).toHaveLength(6);
    });

    it('renders an EMPTY series (fresh install) without throwing', async () => {
        const view = await render(<MoodLineChart series={[]} />);
        await expect(measure(view)).resolves.not.toThrow();
        expect(view.queryAllByTestId('mood-line-chart-dot')).toHaveLength(0);
    });

    it('renders a SINGLE point without throwing', async () => {
        const view = await render(<MoodLineChart series={[{ date: day(1), value: 7 }]} />);
        await expect(measure(view)).resolves.not.toThrow();
        expect(view.queryAllByTestId('mood-line-chart-dot')).toHaveLength(1);
    });
});

describe('MoodLineChart — overlay + labels', () => {
    it('draws the moving-average overlay when one is supplied, and not otherwise', async () => {
        const withOverlay = await render(
            <MoodLineChart series={mixed} overlay={[4, 5, 6, 6.5, 5.5]} />
        );
        await measure(withOverlay);
        expect(withOverlay.queryByTestId('mood-line-chart-overlay')).not.toBeNull();

        const without = await render(<MoodLineChart series={mixed} />);
        await measure(without);
        expect(without.queryByTestId('mood-line-chart-overlay')).toBeNull();
    });

    it('renders only the NON-EMPTY x labels, so a sparse axis stays sparse', async () => {
        const labels = ['Mon', '', '', '', 'Fri'];
        const view = await render(
            <MoodLineChart series={mixed} xLabelFor={(i) => labels[i] ?? ''} />
        );
        await measure(view);
        expect(view.queryByText('Mon')).not.toBeNull();
        expect(view.queryByText('Fri')).not.toBeNull();
    });

    it('no tooltip is shown until something is scrubbed', async () => {
        const view = await render(
            <MoodLineChart series={mixed} tooltip={() => <></>} />
        );
        await measure(view);
        expect(view.queryByTestId('mood-line-chart-tooltip')).toBeNull();
    });
});
