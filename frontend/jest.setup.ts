// Suppress console noise in tests unless debugging
if (!process.env.DEBUG_TESTS) {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

// Shared platform mocks for every suite (testing/platform.ts documents them and
// the setters a test steers them with). A suite's own jest.mock of the same
// module overrides these; jest.unmock opts back into the real module.
jest.mock('react-native-reanimated', () => require('@/testing/platform').reanimatedMock());
jest.mock('react-native-safe-area-context', () => require('@/testing/platform').safeAreaMock());
jest.mock('@/hooks/useKeyboardHeight', () => require('@/testing/platform').keyboardHeightMock());
// gesture-handler probes for reanimated (`require` + `useSharedValue`) and, if
// found, drives GestureDetector through reanimated's useEvent. The REAL package
// never loads in jest, so gesture-handler has always run its plain-JS path here;
// keep it there rather than let the stub above pass for real reanimated.
// jest loads the package's `main` (lib/commonjs); stack traces show src/ only
// because of its source maps, so the mock must name the commonjs path.
jest.mock('react-native-gesture-handler/lib/commonjs/handlers/gestures/reanimatedWrapper', () => ({
  Reanimated: undefined,
}));
