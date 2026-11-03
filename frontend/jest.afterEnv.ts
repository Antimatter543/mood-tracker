// Runs after the test framework is installed (setupFilesAfterEnv), so it can
// register hooks. Shared platform state (insets, keyboard height, scroll spies)
// starts every test at its defaults, and the app clock (lib/clock.ts) starts
// every test unfrozen.
beforeEach(() => {
  require('@/testing/platform').resetPlatform();
  require('@/testing/clock').unfreezeNow();
});
