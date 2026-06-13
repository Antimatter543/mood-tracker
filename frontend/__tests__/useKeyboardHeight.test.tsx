/**
 * Unit tests for useKeyboardHeight — now backed by reanimated's
 * useAnimatedKeyboard (the native WindowInsetsAnimation source), replacing RN's
 * Keyboard.addListener which reports height 0 under Android edge-to-edge (the
 * window never resizes, so the JS event has no delta — the dead source that
 * killed the first two keyboard attempts).
 *
 * We mock the three reanimated primitives the hook uses so we can:
 *  - assert it requests the EDGE-TO-EDGE options (both translucent flags true) —
 *    the load-bearing config: with them false the nav-bar inset is wrongly
 *    subtracted from the keyboard height;
 *  - drive the (mocked) shared-value height through the bridge and assert the
 *    hook returns it as a plain JS number;
 *  - confirm it only pushes on a meaningful (rounded) change.
 *
 * Real occlusion is release-APK only (jest has no live keyboard / no native
 * WindowInsets) — goes to the device QA pass.
 */
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

// ── Mock reanimated: a controllable keyboard shared value + a reaction runner ──
const keyboardSV = { height: { value: 0 }, state: { value: 0 } };
const optionsSeen: any[] = [];
// Holds the latest registered reaction so the test can fire it after changing
// the shared value (mirrors useAnimatedReaction's prepare->react contract).
let reaction: { prepare: () => any; react: (cur: any, prev: any) => void } | null = null;

jest.mock('react-native-reanimated', () => ({
    __esModule: true,
    useAnimatedKeyboard: (opts: any) => {
        optionsSeen.push(opts);
        return keyboardSV;
    },
    useAnimatedReaction: (prepare: () => any, react: (cur: any, prev: any) => void) => {
        reaction = { prepare, react };
    },
    runOnJS: (fn: any) => fn,
}));

import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

// Probe surfaces the hook value as readable text.
function Probe() {
    const h = useKeyboardHeight();
    return <Text>{`h=${h}`}</Text>;
}
const heightText = (screen: any): string =>
    screen.container
        .queryAll((n: any) => n.type === 'Text')
        .map((n: any) => n.props.children)
        .find((c: any) => typeof c === 'string' && c.startsWith('h=')) ?? '';

// Simulate the UI-thread height changing, then the reaction firing on JS.
async function setKeyboardHeight(h: number) {
    const prev = keyboardSV.height.value;
    keyboardSV.height.value = h;
    await act(async () => {
        const cur = reaction!.prepare();
        reaction!.react(cur, Math.round(prev));
    });
}

beforeEach(() => {
    keyboardSV.height.value = 0;
    keyboardSV.state.value = 0;
    optionsSeen.length = 0;
    reaction = null;
});

describe('useKeyboardHeight (useAnimatedKeyboard-backed)', () => {
    it('requests the edge-to-edge translucent options (both flags true)', async () => {
        await render(<Probe />);
        expect(optionsSeen.length).toBeGreaterThanOrEqual(1);
        expect(optionsSeen[0]).toEqual({
            isStatusBarTranslucentAndroid: true,
            isNavigationBarTranslucentAndroid: true,
        });
    });

    it('starts at 0 (keyboard hidden)', async () => {
        const screen = await render(<Probe />);
        expect(heightText(screen)).toBe('h=0');
    });

    it('reports the native keyboard height when it opens', async () => {
        const screen = await render(<Probe />);
        await setKeyboardHeight(804);
        expect(heightText(screen)).toBe('h=804');
    });

    it('resets to 0 when the keyboard closes', async () => {
        const screen = await render(<Probe />);
        await setKeyboardHeight(804);
        expect(heightText(screen)).toBe('h=804');
        await setKeyboardHeight(0);
        expect(heightText(screen)).toBe('h=0');
    });

    it('rounds the shared-value height to an integer', async () => {
        const screen = await render(<Probe />);
        await setKeyboardHeight(803.6);
        // The reaction prepares Math.round(value) -> 804.
        expect(heightText(screen)).toBe('h=804');
    });
});
