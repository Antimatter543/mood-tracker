/**
 * Tests for the screen-level expo-router error boundary
 * (components/ScreenErrorFallback.tsx + the named `ErrorBoundary` re-exports on
 * the tab screens).
 *
 * WHY: the project has shipped THREE "unhandled render throw -> whole screen
 * unmounts to white, fixed only by an app restart" incidents. The boundary turns
 * that into a recoverable inline fallback with a "Try again" button. This suite
 * proves both halves of the contract:
 *   1. when a child throws, the boundary catches it and shows the fallback;
 *   2. after the throwing condition clears, `retry` re-renders the children
 *      (the screen self-heals — no restart).
 *
 * The boundary is exercised through a faithful local re-implementation of
 * expo-router's <Try> (a class with `getDerivedStateFromError` + a `retry` that
 * clears the error state — verified against node_modules/expo-router/build/
 * views/Try.js). This mirrors exactly how expo-router wraps a screen that exports
 * `ErrorBoundary`, without dragging expo-router's untranspilable ESM into jest.
 *
 * RNTL 14 is async (render/act return Promises). A render error that ESCAPES a
 * boundary surfaces as a rejected promise; a render error that the boundary
 * CATCHES does not — render() resolves with the fallback shown.
 */
import React, { Component, type ComponentType } from 'react';
import { Text } from 'react-native';
import { render, act, fireEvent, screen } from '@testing-library/react-native';

// Mock the theme so the fallback's useThemeColors() doesn't require a
// SettingsProvider (we're testing boundary behavior, not theming). Only the
// tokens the fallback actually reads are returned.
jest.mock('@/styles/global', () => ({
  useThemeColors: () => ({
    background: '#141418',
    text: '#FFFFFF',
    textSecondary: 'rgba(211,212,213,1)',
    accent: '#4CAF50',
  }),
}));

import {
  ScreenErrorBoundary,
  ScreenErrorFallback,
} from '@/components/ScreenErrorFallback';

// Faithful local stand-in for expo-router's <Try> (see Try.js): captures a
// render throw via getDerivedStateFromError, renders the `catch` boundary with
// { error, retry }, and `retry` clears the error so children re-render.
type TryProps = {
  catch: ComponentType<{ error: Error; retry: () => Promise<void> }>;
  children: React.ReactNode;
};
class Try extends Component<TryProps, { error?: Error }> {
  state: { error?: Error } = { error: undefined };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  retry = () =>
    new Promise<void>((resolve) => {
      this.setState({ error: undefined }, () => resolve());
    });
  render() {
    const { error } = this.state;
    const { catch: Boundary, children } = this.props;
    if (!error) return <>{children}</>;
    return <Boundary error={error} retry={this.retry} />;
  }
}

// A child that throws while `shouldThrow.value` is true. Reading from a mutable
// box (not a prop) lets the test flip the condition BEFORE pressing retry, so
// the re-render after retry succeeds — modelling a transient throw that has
// since cleared (exactly the in-memory-DB-state case the txn fix also addresses).
const shouldThrow = { value: true };
function MaybeThrows() {
  if (shouldThrow.value) {
    throw new Error('boom: transient render failure');
  }
  return <Text>screen-content</Text>;
}

beforeEach(() => {
  shouldThrow.value = true;
});

describe('ScreenErrorFallback (direct render)', () => {
  it('renders the recoverable fallback UI (message + Try again button)', async () => {
    const retry = jest.fn();
    await render(
      <ScreenErrorFallback error={new Error('x')} retry={retry} />,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    // The retry control exists and is wired to the retry callback.
    const button = screen.getByTestId('error-fallback-retry');
    expect(button).toBeTruthy();
    fireEvent.press(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenErrorBoundary inside a Try (expo-router contract)', () => {
  it('catches a render throw in a child and shows the fallback (no white screen)', async () => {
    await render(
      <Try catch={ScreenErrorBoundary}>
        <MaybeThrows />
      </Try>,
    );

    // The fallback is shown instead of the throwing child.
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText('screen-content')).toBeNull();
  });

  it('recovers on retry once the throwing condition has cleared', async () => {
    await render(
      <Try catch={ScreenErrorBoundary}>
        <MaybeThrows />
      </Try>,
    );

    // Boundary is showing the fallback.
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // The transient condition clears (e.g. fresh DB read succeeds)...
    shouldThrow.value = false;

    // ...and the user taps "Try again": children re-render and the screen heals.
    await act(async () => {
      fireEvent.press(screen.getByTestId('error-fallback-retry'));
    });

    expect(screen.getByText('screen-content')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('re-throws (stays on the fallback) if the condition has NOT cleared on retry', async () => {
    await render(
      <Try catch={ScreenErrorBoundary}>
        <MaybeThrows />
      </Try>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Condition is still bad -> retry re-renders the child, which throws again,
    // and the boundary re-catches: the fallback persists (it does not crash the
    // tree or permanently nuke the app).
    await act(async () => {
      fireEvent.press(screen.getByTestId('error-fallback-retry'));
    });
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText('screen-content')).toBeNull();
  });
});
