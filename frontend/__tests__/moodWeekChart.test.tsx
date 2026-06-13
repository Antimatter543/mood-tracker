/**
 * Render-structure tests for the custom MoodWeekChart (replaces chart-kit on
 * Home). The path MATH is exhaustively covered by chartGeometry.test.ts; this
 * guards the COMPONENT wiring the device-QA pass can't cheaply re-verify:
 *   - day labels render (one per slot), centered via absolute `left`,
 *   - the chart measures its width via onLayout then draws (width-gated render),
 *   - one SVG dot per REAL data point, none for missing days,
 *   - it never crashes on the edge shapes (single point, all-null, full week).
 *
 * jest-expo mocks react-native-svg; we count rendered svg primitives by node
 * type name from the JSON tree (Circle/Path), which is enough to assert "a dot
 * per real point" without depending on svg internals.
 */
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return {
        ...actual,
        useThemeColors: () => ({
            accent: '#4CAF50',
            cardBackground: '#111',
            text: '#fff',
            textSecondary: '#aaa',
            overlays: { tag: '#222' },
            isDark: true,
        }),
    };
});

import { MoodWeekChart } from '@/components/visualisations/MoodWeekChart';

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Count JSON nodes whose `type` (string component name) matches a substring. */
const countByType = (json: any, typeSubstr: string): number => {
    let n = 0;
    const walk = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.type === 'string' && node.type.includes(typeSubstr)) n += 1;
        const kids = node.children;
        if (Array.isArray(kids)) kids.forEach(walk);
    };
    walk(json);
    return n;
};

/** Render then fire a layout event so the chart has a measured width. */
const renderMeasured = async (data: (number | null)[], width = 300) => {
    const view = await render(<MoodWeekChart data={data} labels={LABELS} />);
    const wrap = view.getByTestId('mood-week-chart');
    await act(async () => {
        fireEvent(wrap, 'layout', {
            nativeEvent: { layout: { width, height: 130, x: 0, y: 0 } },
        });
    });
    return view;
};

describe('MoodWeekChart', () => {
    it('renders one day label per slot after layout', async () => {
        const view = await renderMeasured([5, 6, 7, 8, 6, 4, 9]);
        for (const day of LABELS) expect(view.getByText(day)).toBeTruthy();
    });

    it('draws one dot per REAL point and none for missing days', async () => {
        // 5 real, 2 missing -> 5 dots.
        const view = await renderMeasured([5, null, 7, 8, null, 4, 9]);
        expect(countByType(view.toJSON(), 'Circle')).toBe(5);
    });

    it('draws a dot for every day when the week is full', async () => {
        const view = await renderMeasured([5, 6, 7, 8, 6, 4, 9]);
        expect(countByType(view.toJSON(), 'Circle')).toBe(7);
    });

    it('single real point: exactly one dot, no crash', async () => {
        const view = await renderMeasured([null, null, null, 7, null, null, null]);
        expect(countByType(view.toJSON(), 'Circle')).toBe(1);
        // label row still present
        expect(view.getByText('Thu')).toBeTruthy();
    });

    it('all-null week: no dots, still renders labels without crashing', async () => {
        const view = await renderMeasured([null, null, null, null, null, null, null]);
        expect(countByType(view.toJSON(), 'Circle')).toBe(0);
        expect(view.getByText('Mon')).toBeTruthy();
    });

    it('does not render the SVG before it has been measured (width 0)', async () => {
        // No layout fired -> width stays 0 -> no svg dots yet (and no crash).
        const view = await render(<MoodWeekChart data={[5, 6, 7]} labels={LABELS} />);
        expect(countByType(view.toJSON(), 'Circle')).toBe(0);
    });
});
