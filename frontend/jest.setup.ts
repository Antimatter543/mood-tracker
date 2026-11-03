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
