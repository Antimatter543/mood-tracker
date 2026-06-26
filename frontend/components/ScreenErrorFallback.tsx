import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import type { ErrorBoundaryProps } from 'expo-router';

import { useThemeColors, ThemeColors } from '@/styles/global';

/**
 * Recoverable inline error fallback for a SCREEN-level expo-router
 * `ErrorBoundary` (see app/(tabs)/index.tsx).
 *
 * WHY this exists: the project has shipped THREE separate "unhandled render
 * throw -> the whole screen unmounts to a white screen, fixed only by an app
 * restart" incidents (empty-db heatmap RangeError; "Rendered more hooks").
 * Without a boundary, any render throw inside a tab screen blanks it until the
 * user force-closes and reopens the app. This component is what the user sees
 * instead: a calm, themed message plus a "Try again" button that calls
 * expo-router's `retry`, which clears the boundary's error state and re-renders
 * the screen — so a transient throw (e.g. one driven by the bad in-memory DB
 * state this branch's transaction fix also addresses) self-heals on tap, no
 * restart required.
 *
 * It is exported as its own component (not inlined in the route module) so it
 * can be unit-tested without dragging expo-router's untranspilable ESM into
 * jest — same layering discipline as components/iconRegistry.ts (lessons
 * 2026-06-13: a module's import graph is part of its API).
 *
 * Themed via `useThemeColors()`. This is safe ONLY because the boundary is
 * attached at the SCREEN level (inside the SettingsProvider that lives in
 * app/(tabs)/_layout.tsx). A layout-level boundary would render OUTSIDE that
 * provider, so `useThemeColors()` would itself throw — keep this boundary on the
 * screen, not the navigator.
 *
 * Brand rule: no emoji-as-icons — the glyph is an `@expo/vector-icons` Ionicon.
 */
export function ScreenErrorFallback({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const colors = useThemeColors();
  const styles = useStyles(colors);

  return (
    <View style={styles.container}>
      <Ionicons
        name="alert-circle-outline"
        size={48}
        color={colors.textSecondary}
      />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        This screen ran into a problem. Your data is safe — tap below to reload it.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        testID="error-fallback-retry"
        onPress={retry}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
      >
        <Ionicons name="refresh" size={18} color="#FFFFFF" />
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>

      {/* Surface the message only in dev so a developer sees the cause without
          force-quitting; production users just get the calm copy above. */}
      {__DEV__ && error?.message ? (
        <Text style={styles.devDetail} numberOfLines={4}>
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Drop-in screen-level expo-router error boundary. A route module makes itself
 * crash-recoverable by re-exporting this as `ErrorBoundary`:
 *
 *   export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorFallback';
 *
 * Keeping the wrapper here (rather than copy-pasting a 3-line component into
 * every screen) means all the data-driven tab screens share ONE boundary
 * implementation — fix it once, every screen benefits.
 */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ScreenErrorFallback error={error} retry={retry} />;
}

const useStyles = (colors: ThemeColors) =>
  useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
          gap: 12,
          backgroundColor: colors.background,
        },
        title: {
          fontSize: 20,
          fontWeight: '700',
          color: colors.text,
          letterSpacing: -0.4,
          marginTop: 4,
        },
        body: {
          fontSize: 15,
          lineHeight: 21,
          color: colors.textSecondary,
          textAlign: 'center',
        },
        button: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.accent,
          paddingVertical: 12,
          paddingHorizontal: 22,
          borderRadius: 12,
          marginTop: 8,
        },
        buttonPressed: {
          opacity: 0.85,
        },
        buttonText: {
          color: '#FFFFFF',
          fontSize: 16,
          fontWeight: '600',
        },
        devDetail: {
          marginTop: 16,
          fontSize: 12,
          color: colors.textSecondary,
          opacity: 0.7,
          textAlign: 'center',
        },
      }),
    [colors],
  );
