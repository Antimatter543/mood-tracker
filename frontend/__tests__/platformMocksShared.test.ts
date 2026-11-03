/**
 * Suites use the SHARED platform mocks (frontend/testing/platform.ts, installed
 * for every suite by jest.setup.ts) instead of mocking the platform themselves.
 *
 * Shape scan, because no compiler rule can see it: a suite's own
 * `jest.mock('react-native-safe-area-context' | 'react-native-reanimated' |
 * '@/hooks/useKeyboardHeight', ...)` silently REPLACES the global mock, so
 * `setInsets` / `setKeyboardHeight` then do nothing and the suite pins whatever
 * inset or keyboard height it invented. Before the shared mocks (lane B,
 * 2026-11-03) 28 suites mocked reanimated, 23 safe-area and 22 the keyboard
 * hook, each with its own guess.
 *
 * A suite that genuinely needs its own mock goes in ALLOWED with the reason.
 */
import { code, listSourceFiles } from '@/testing/sourceScan';

const SELF = '__tests__/platformMocksShared.test.ts';

const LOCAL_PLATFORM_MOCK =
    /jest\.(mock|doMock|unmock)\(\s*['"](react-native-reanimated|react-native-safe-area-context|@\/hooks\/useKeyboardHeight)['"]/;

const ALLOWED: Record<string, string> = {
    '__tests__/useKeyboardHeight.test.tsx':
        'tests the real hook: unmocks it and drives a reanimated keyboard shared value by hand',
    '__tests__/layoutContentNotAnimated.test.tsx':
        'its reanimated mock resolves useAnimatedStyle inline so an animated container style is assertable',
    '__tests__/undoSnackbar.test.tsx':
        'its reanimated mock forwards `exiting` so the test can see the exit animation; lane D owns the file',
    '__tests__/overlayKeyboardSafeArea.test.tsx':
        'scripts the keyboard height per case with mockReturnValue; lane D owns the file (a follow-up can move it to setKeyboardHeight)',
};

describe('suites use the shared platform mocks', () => {
    const files = listSourceFiles(['__tests__']).filter((f) => f !== SELF);

    it('scans the real test tree', () => {
        expect(files.length).toBeGreaterThan(150);
        expect(files).toContain('__tests__/testingHelpers.test.tsx');
    });

    it('the pattern catches every local-mock form (positive control)', () => {
        for (const line of [
            "jest.mock('react-native-reanimated', () => ({}));",
            'jest.mock("react-native-safe-area-context", () => ({}));',
            "jest.doMock(\n    '@/hooks/useKeyboardHeight', () => ({}));",
            "jest.unmock('@/hooks/useKeyboardHeight');",
        ]) {
            expect(LOCAL_PLATFORM_MOCK.test(line)).toBe(true);
        }
        expect(LOCAL_PLATFORM_MOCK.test("jest.mock('react-native-gesture-handler')")).toBe(false);
        expect(LOCAL_PLATFORM_MOCK.test("jest.mock('@/hooks/useKeyboardHeightLabel')")).toBe(false);
    });

    it('no suite outside the allowlist mocks the platform itself', () => {
        const offenders = files.filter((f) => !(f in ALLOWED) && LOCAL_PLATFORM_MOCK.test(code(f)));
        expect(offenders).toEqual([]);
    });

    it('every allowlisted suite still needs its entry', () => {
        const stale = Object.keys(ALLOWED).filter((f) => !files.includes(f) || !LOCAL_PLATFORM_MOCK.test(code(f)));
        expect(stale).toEqual([]);
    });
});
