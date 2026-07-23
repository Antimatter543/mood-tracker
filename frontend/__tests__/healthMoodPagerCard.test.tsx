/**
 * Component tests for HealthMoodPagerCard — the single swipeable card that
 * replaced the four separate Health Connect metric↔mood cards on Insights.
 *
 * Pane SELECTION math is covered exhaustively by healthPanes.test.ts; this
 * guards the COMPONENT wiring a device pass can't cheaply re-verify:
 *   - only metrics WITH data get a pane (data-less metrics excluded entirely),
 *   - one metric → a single static card, no arrows/dots,
 *   - the left arrow is disabled on the first pane / the right on the last,
 *   - tapping an arrow moves the visible pane (index → dot + arrow state).
 *
 * Follows the useThemeColors mock + manual onLayout-fire pattern of
 * moodMetricOverlayCard.test.tsx / metricMoodCard.test.tsx (no SettingsProvider,
 * and jest never auto-fires onLayout so the viewport width is fed by hand).
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

import HealthMoodPagerCard, {
    type HealthMoodPagerCardProps,
} from '@/components/visualisations/HealthMoodPagerCard';
import type { MetricMoodCorrelation } from '@/components/visualisations/transforms/healthMoodCorrelation';

// A valid "not enough data" correlation — the pane renders its "keep logging"
// body. Which state a pane shows is MetricMoodCard's concern (covered there);
// here we only care about pane presence + paging chrome, so the calm state is
// enough and keeps the fixtures tiny.
const emptyCorr: MetricMoodCorrelation = {
    status: 'notEnoughData',
    pairCount: 0,
    pairs: [],
};

const props = (
    flags: Partial<
        Pick<
            HealthMoodPagerCardProps,
            'hasSleepData' | 'hasHeartRateData' | 'hasRestingHrData' | 'hasHrvData'
        >
    >
): HealthMoodPagerCardProps => ({
    hasSleepData: false,
    hasHeartRateData: false,
    hasRestingHrData: false,
    hasHrvData: false,
    sleepMood: emptyCorr,
    heartRateMood: emptyCorr,
    restingHeartRateMood: emptyCorr,
    hrvMood: emptyCorr,
    ...flags,
});

type Rendered = Awaited<ReturnType<typeof render>>;

/** Render then feed the viewport a width (jest never fires onLayout itself). */
const renderMeasured = async (p: HealthMoodPagerCardProps): Promise<Rendered> => {
    const view = await render(<HealthMoodPagerCard {...p} />);
    const viewport = view.queryByTestId('health-pager-viewport');
    if (viewport) {
        await act(async () => {
            fireEvent(viewport, 'layout', {
                nativeEvent: { layout: { width: 320, height: 220, x: 0, y: 0 } },
            });
        });
    }
    return view;
};

const isDisabled = (view: Rendered, testID: string): boolean =>
    view.getByTestId(testID).props.accessibilityState?.disabled === true;

const isSelected = (view: Rendered, testID: string): boolean =>
    view.getByTestId(testID).props.accessibilityState?.selected === true;

describe('HealthMoodPagerCard', () => {
    it('renders a pane only for metrics WITH data (data-less metrics excluded)', async () => {
        // Sleep + HRV present; the two heart-rate metrics have no data.
        const view = await renderMeasured(props({ hasSleepData: true, hasHrvData: true }));

        expect(view.getByTestId('health-pane-sleep')).toBeTruthy();
        expect(view.getByTestId('health-pane-hrv')).toBeTruthy();
        expect(view.queryByTestId('health-pane-heartRate')).toBeNull();
        expect(view.queryByTestId('health-pane-restingHr')).toBeNull();

        // Two panes → paging chrome is present.
        expect(view.getByTestId('health-pager-prev')).toBeTruthy();
        expect(view.getByTestId('health-pager-next')).toBeTruthy();
        expect(view.getByTestId('health-pager-dot-0')).toBeTruthy();
        expect(view.getByTestId('health-pager-dot-1')).toBeTruthy();
    });

    it('a single metric renders one static card — no arrows, no dots', async () => {
        const view = await renderMeasured(props({ hasSleepData: true }));

        // The pane body is present…
        expect(view.getByText('Sleep & mood')).toBeTruthy();
        // …but no pager chrome.
        expect(view.queryByTestId('health-pager-prev')).toBeNull();
        expect(view.queryByTestId('health-pager-next')).toBeNull();
        expect(view.queryByTestId('health-pager-dot-0')).toBeNull();
        // Single-pane path renders no scrolling viewport either.
        expect(view.queryByTestId('health-pager-viewport')).toBeNull();
    });

    it('on the first pane: left arrow disabled, right enabled, first dot active', async () => {
        const view = await renderMeasured(
            props({ hasSleepData: true, hasHeartRateData: true, hasRestingHrData: true })
        );

        expect(isDisabled(view, 'health-pager-prev')).toBe(true);
        expect(isDisabled(view, 'health-pager-next')).toBe(false);
        expect(isSelected(view, 'health-pager-dot-0')).toBe(true);
        expect(isSelected(view, 'health-pager-dot-1')).toBe(false);
        expect(isSelected(view, 'health-pager-dot-2')).toBe(false);
    });

    it('on the last pane: right arrow disabled, left enabled, last dot active', async () => {
        const view = await renderMeasured(
            props({ hasSleepData: true, hasHeartRateData: true, hasRestingHrData: true })
        );

        // Page to the end (3 panes → two Next taps).
        await act(async () => {
            fireEvent.press(view.getByTestId('health-pager-next'));
        });
        await act(async () => {
            fireEvent.press(view.getByTestId('health-pager-next'));
        });

        expect(isDisabled(view, 'health-pager-next')).toBe(true);
        expect(isDisabled(view, 'health-pager-prev')).toBe(false);
        expect(isSelected(view, 'health-pager-dot-2')).toBe(true);
        expect(isSelected(view, 'health-pager-dot-0')).toBe(false);
    });

    it('tapping the arrows moves the visible pane (index → dots + arrow state)', async () => {
        const view = await renderMeasured(
            props({ hasSleepData: true, hasHeartRateData: true, hasRestingHrData: true })
        );

        // Start on pane 0.
        expect(isSelected(view, 'health-pager-dot-0')).toBe(true);
        expect(isDisabled(view, 'health-pager-prev')).toBe(true);

        // Next → pane 1.
        await act(async () => {
            fireEvent.press(view.getByTestId('health-pager-next'));
        });
        expect(isSelected(view, 'health-pager-dot-1')).toBe(true);
        expect(isSelected(view, 'health-pager-dot-0')).toBe(false);
        expect(isDisabled(view, 'health-pager-prev')).toBe(false);

        // Prev → back to pane 0.
        await act(async () => {
            fireEvent.press(view.getByTestId('health-pager-prev'));
        });
        expect(isSelected(view, 'health-pager-dot-0')).toBe(true);
        expect(isDisabled(view, 'health-pager-prev')).toBe(true);
    });
});
