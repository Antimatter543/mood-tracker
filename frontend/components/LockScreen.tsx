import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '@/styles/global';

/**
 * The full-window lock screen the app lock (context/AppLock.tsx) paints over the
 * whole app. Opaque on purpose: nothing of the journal shows through.
 *
 * It must look the SAME after a distress wipe as after a plain lockout, so it
 * has no state of its own beyond what the gate hands it.
 */
export function LockScreen({
    busy,
    message,
    onUnlock,
}: {
    busy: boolean;
    message: string | null;
    onUnlock: () => void;
}) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => StyleSheet.create({
        root: {
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: colors.background,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
        },
        iconWrap: {
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: colors.accentLight,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
        },
        title: {
            color: colors.text,
            fontSize: 22,
            fontWeight: '600',
            marginBottom: 8,
        },
        subtitle: {
            color: colors.textSecondary,
            fontSize: 15,
            textAlign: 'center',
            marginBottom: 32,
        },
        message: {
            color: colors.textSecondary,
            fontSize: 14,
            textAlign: 'center',
            marginTop: 16,
        },
        button: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.accent,
            paddingVertical: 14,
            paddingHorizontal: 32,
            borderRadius: 24,
            minWidth: 180,
            justifyContent: 'center',
        },
        buttonDisabled: { opacity: 0.6 },
        buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    }), [colors]);

    return (
        <View
            style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
            testID="app-lock-screen"
        >
            <View style={styles.iconWrap}>
                <Ionicons name="lock-closed-outline" size={40} color={colors.accent} />
            </View>
            <Text style={styles.title}>SoulSync is locked</Text>
            <Text style={styles.subtitle}>Unlock to see your journal.</Text>
            <Pressable
                testID="app-lock-unlock"
                accessibilityRole="button"
                accessibilityLabel="Unlock"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onUnlock}
                style={({ pressed }) => [
                    styles.button,
                    (busy || pressed) && styles.buttonDisabled,
                ]}
            >
                {busy ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Ionicons name="finger-print" size={20} color="#fff" />
                )}
                <Text style={styles.buttonText}>Unlock</Text>
            </Pressable>
            {message ? (
                <Text style={styles.message} testID="app-lock-message">{message}</Text>
            ) : null}
        </View>
    );
}
