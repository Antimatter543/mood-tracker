// HealthConnectSection.tsx
//
// Settings card for the opt-in Android Health Connect integration (Phase 2a).
// Renders NOTHING on iOS / web / when the feature flag is off, and shows an
// explicit "not supported" state on Android 16+ (where the library's permission
// prompt silently fails). Everything Health-Connect-touching goes through
// lib/healthConnect.ts (guarded + lazy) — this file never imports the native
// module directly.
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import {
  getStatus,
  connect,
  hasReadPermission,
  disconnect,
  openHealthConnectSettings,
  type HealthConnectStatus,
} from '@/lib/healthConnect';
import { syncHealthMetrics } from '@/lib/healthSync';
import { clearAllHealthMetrics } from '@/databases/health-metrics';
import { getSetting, updateSetting } from '@/databases/user-settings';
import {
  HEALTH_CONNECT_ENABLED,
  HEALTH_CONNECT_PLAY_MARKET_URL,
  HEALTH_CONNECT_PLAY_WEB_URL,
  HEALTH_OPT_IN_SETTING_KEY,
  HEALTH_LAST_SYNCED_SETTING_KEY,
  resolveHealthConnectPhase,
  shouldShowHealthConnect,
  type HealthConnectCardPhase,
} from '@/lib/healthConnectConfig';

/**
 * UI phase. `'loading'` is the transient state shown before the first resolve;
 * the rest come straight from {@link resolveHealthConnectPhase} and are re-derived
 * every time the Settings screen regains focus (so installing/updating Health
 * Connect and returning reflects without an app restart).
 */
type Phase = 'loading' | HealthConnectCardPhase;

/** Friendly "Last synced …" line from an ISO timestamp. */
function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Not synced yet';
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Last synced ${then.toLocaleDateString()}`;
}

export const HealthConnectSection = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();

  const [phase, setPhase] = useState<Phase>('loading');
  const [connected, setConnected] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True while a user-initiated op (connect / sync / disconnect) is mid-flight.
  // A ref, not state, so it can gate the focus re-resolve WITHOUT re-triggering
  // the memoized effect when it flips.
  const operationInFlight = useRef(false);

  // Resolve the card's state: SDK status + version gate → phase, then (if
  // available) opt-in + permission + last-synced. Wired through `useFocusEffect`
  // (NOT a mount-only effect) so returning to Settings after installing/updating
  // Health Connect re-checks and updates immediately — no app restart. Only ever
  // runs on Android (the whole section is gated off elsewhere).
  const resolveState = useCallback((): void | (() => void) => {
    // A user op is running (e.g. the OS permission dialog blurred us and we just
    // regained focus): skip so a background re-resolve can't race its state writes.
    if (operationInFlight.current) return undefined;

    let cancelled = false;

    (async () => {
      const status: HealthConnectStatus = await getStatus();
      const nextPhase = resolveHealthConnectPhase(Number(Platform.Version), status);
      if (cancelled) return;

      if (nextPhase !== 'available') {
        setPhase(nextPhase);
        return;
      }

      const optedIn = (await getSetting(db, HEALTH_OPT_IN_SETTING_KEY)) === 'true';
      const granted = optedIn ? await hasReadPermission() : false;
      const synced = await getSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY);
      if (cancelled) return;

      setConnected(optedIn && granted);
      setLastSynced(synced || null);
      setPhase('available');
    })();

    // Runs on blur/unmount — cancels a late setState from the async above.
    return () => {
      cancelled = true;
    };
  }, [db]);

  useFocusEffect(resolveState);

  const runSync = useCallback(async () => {
    const result = await syncHealthMetrics(db);
    if (result.success) {
      setLastSynced(result.syncedAt);
    } else {
      Alert.alert(
        'Sync failed',
        "We couldn't read from Health Connect just now. Please try again in a moment."
      );
    }
  }, [db]);

  const handleConnect = useCallback(async () => {
    operationInFlight.current = true;
    setBusy(true);
    try {
      const result = await connect();
      if (result.granted) {
        await updateSetting(db, HEALTH_OPT_IN_SETTING_KEY, 'true');
        setConnected(true);
        await runSync();
      } else {
        Alert.alert(
          'Permission needed',
          'SoulSync needs read access to Sleep and Heart Rate. You can grant it any time from Health Connect.'
        );
      }
    } catch {
      Alert.alert('Something went wrong', 'Could not connect to Health Connect.');
    } finally {
      setBusy(false);
      operationInFlight.current = false;
    }
  }, [db, runSync]);

  const handleSyncNow = useCallback(async () => {
    operationInFlight.current = true;
    setBusy(true);
    try {
      await runSync();
    } finally {
      setBusy(false);
      operationInFlight.current = false;
    }
  }, [runSync]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      'Turn off Health Connect',
      'This stops syncing and deletes the sleep and heart-rate data stored on this device. Your mood entries are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            operationInFlight.current = true;
            setBusy(true);
            try {
              await disconnect();
              await clearAllHealthMetrics(db);
              await updateSetting(db, HEALTH_OPT_IN_SETTING_KEY, 'false');
              await updateSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY, '');
              setConnected(false);
              setLastSynced(null);
            } catch {
              Alert.alert('Something went wrong', 'Could not turn off Health Connect.');
            } finally {
              setBusy(false);
              operationInFlight.current = false;
            }
          },
        },
      ]
    );
  }, [db]);

  const handleInstall = useCallback(async () => {
    // Prefer the Play store app (market://); fall back to the web listing.
    try {
      await Linking.openURL(HEALTH_CONNECT_PLAY_MARKET_URL);
    } catch {
      Linking.openURL(HEALTH_CONNECT_PLAY_WEB_URL).catch(() => {
        Alert.alert('Could not open Play Store', 'Please search for "Health Connect" in the Play Store.');
      });
    }
  }, []);

  const styles = useStyles(colors);

  // ── Gate: render nothing off Android / when disabled ──────────────────────
  if (!shouldShowHealthConnect(Platform.OS, HEALTH_CONNECT_ENABLED)) {
    return null;
  }

  const header = (
    <View style={styles.sectionHeader}>
      <Feather name="heart" color={colors.text} size={20} />
      <Text style={styles.sectionTitle}>Health Connect</Text>
      {connected && (
        <View style={styles.connectedBadge}>
          <Feather name="check" color={colors.accent} size={13} />
          <Text style={styles.connectedBadgeText}>Connected</Text>
        </View>
      )}
    </View>
  );

  const consentCopy = (
    <Text style={styles.description}>
      Bring last night&apos;s{' '}
      <Text style={styles.emphasis}>sleep</Text> and your{' '}
      <Text style={styles.emphasis}>heart rate</Text> into SoulSync, so you can
      see how they line up with how you feel. Reading this is optional. It&apos;s
      processed and stored <Text style={styles.emphasis}>only on this device</Text>
      {' '}— SoulSync has no account and no server, so it&apos;s never shared,
      sold, or used for ads. This isn&apos;t a medical device.
    </Text>
  );

  let body: React.ReactNode;

  if (phase === 'loading') {
    body = (
      <View style={styles.centerRow}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  } else if (phase === 'unsupported_version') {
    body = (
      <View style={styles.infoRow}>
        <Feather name="info" color={colors.textSecondary} size={16} />
        <Text style={styles.infoText}>
          Health Connect isn&apos;t supported on your Android version yet. We&apos;ll
          enable this once the integration works reliably on newer Android
          releases.
        </Text>
      </View>
    );
  } else if (phase === 'provider_required') {
    // Health Connect isn't installed (or is outdated) but the device CAN run it.
    // `getSdkStatus` can't tell "missing" from "outdated" apart, so one honest
    // install-or-update action → the Play listing (which itself shows the right
    // button). This is the state a device with no Health Connect app reports.
    body = (
      <>
        {consentCopy}
        <Text style={styles.subtle}>
          SoulSync uses the Health Connect app to read your sleep and heart rate.
          Install it (or update it, if it&apos;s already on your device) to
          continue.
        </Text>
        <PrimaryButton
          styles={styles}
          colors={colors}
          icon="download"
          label="Install Health Connect"
          onPress={handleInstall}
          disabled={busy}
        />
      </>
    );
  } else if (phase === 'unavailable') {
    // SDK_UNAVAILABLE — the device fundamentally can't run Health Connect (Android
    // too old). Installing the provider wouldn't help, so no action, just an
    // honest info line (matching the unsupported-version state's shape).
    body = (
      <View style={styles.infoRow}>
        <Feather name="info" color={colors.textSecondary} size={16} />
        <Text style={styles.infoText}>
          Health Connect isn&apos;t available on this device, so SoulSync can&apos;t
          bring in your sleep or heart rate here.
        </Text>
      </View>
    );
  } else if (connected) {
    body = (
      <>
        <Text style={styles.description}>
          Sleep and heart rate are syncing to this device only. Pull the latest
          any time.
        </Text>
        <Text style={styles.subtle}>{formatLastSynced(lastSynced)}</Text>

        <PrimaryButton
          styles={styles}
          colors={colors}
          icon="refresh-cw"
          label="Sync now"
          onPress={handleSyncNow}
          disabled={busy}
          loading={busy}
        />

        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={handleDisconnect}
          disabled={busy}
        >
          <Feather name="x-circle" color={colors.text} size={18} />
          <Text style={styles.secondaryButtonText}>Turn off &amp; delete data</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          onPress={openHealthConnectSettings}
          disabled={busy}
        >
          <Text style={styles.linkText}>Manage in Health Connect</Text>
          <Feather name="external-link" color={colors.textSecondary} size={14} />
        </Pressable>
      </>
    );
  } else {
    // available + not connected
    body = (
      <>
        {consentCopy}
        <PrimaryButton
          styles={styles}
          colors={colors}
          icon="link"
          label="Connect Health Connect"
          onPress={handleConnect}
          disabled={busy}
          loading={busy}
        />
      </>
    );
  }

  return (
    <View style={styles.section}>
      {header}
      {body}
    </View>
  );
};

/** Filled accent button matching DataManagementSection's primary button. */
function PrimaryButton({
  styles,
  colors,
  icon,
  label,
  onPress,
  disabled,
  loading,
}: {
  styles: ReturnType<typeof useStyles>;
  colors: ReturnType<typeof useThemeColors>;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <>
          <Feather name={icon} color="#fff" size={18} />
          <Text style={styles.buttonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const useStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    section: {
      backgroundColor: colors.cardBackground,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginLeft: 8,
    },
    connectedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 'auto',
      backgroundColor: colors.accentLight,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
    },
    connectedBadgeText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    description: {
      color: colors.textSecondary,
      fontSize: 14,
      marginBottom: 12,
      lineHeight: 20,
    },
    emphasis: {
      color: colors.text,
      fontWeight: '600',
    },
    subtle: {
      color: colors.textSecondary,
      fontSize: 13,
      marginBottom: 12,
      lineHeight: 18,
    },
    centerRow: {
      alignItems: 'center',
      paddingVertical: 8,
    },
    infoRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      backgroundColor: colors.overlays.tag,
      padding: 12,
      borderRadius: 8,
    },
    infoText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 8,
      minHeight: 46,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '500',
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.overlays.tag,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.overlays.tagBorder,
      marginTop: 10,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
    },
    linkText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    pressed: {
      opacity: 0.8,
    },
  });
