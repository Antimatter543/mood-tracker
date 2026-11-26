import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '@/styles/global';
import { PinPad } from '@/components/PinPad';

/**
 * The full-window lock screen of the app lock (context/AppLock.tsx). Opaque on
 * purpose: nothing of the journal shows through.
 *
 * It must look and behave the SAME with and without a distress PIN, so it has
 * no state of its own beyond what the gate hands it: the typed PIN, whether a
 * check is running ("Unlocking…"), and one status line.
 */
export function LockScreen({
    pin,
    onPinChange,
    onSubmit,
    busy,
    waiting,
    message,
    onForgot,
}: {
    pin: string;
    onPinChange: (next: string) => void;
    onSubmit: () => void;
    busy: boolean;
    waiting: boolean;
    message: string | null;
    onForgot: () => void;
}) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => StyleSheet.create({
        root: {
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: colors.background,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 24,
        },
        icon: { marginBottom: 12 },
        title: { color: colors.text, fontSize: 22, fontWeight: '600', marginBottom: 6 },
        subtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 24 },
        message: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', minHeight: 20, marginTop: 18 },
        forgot: { marginTop: 10, padding: 8 },
        forgotText: { color: colors.accent, fontSize: 14, fontWeight: '500' },
    }), [colors]);

    return (
        <View
            style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
            testID="app-lock-screen"
        >
            <Ionicons name="lock-closed-outline" size={36} color={colors.accent} style={styles.icon} />
            <Text style={styles.title}>SoulSync is locked</Text>
            <Text style={styles.subtitle}>{busy ? 'Unlocking…' : 'Enter your PIN'}</Text>
            <PinPad value={pin} onChange={onPinChange} onSubmit={onSubmit} busy={busy} disabled={waiting} />
            <Text style={styles.message} testID="app-lock-message">{message ?? ''}</Text>
            <Pressable
                testID="app-lock-forgot"
                accessibilityRole="button"
                onPress={onForgot}
                disabled={busy}
                style={styles.forgot}
            >
                <Text style={styles.forgotText}>Forgot PIN?</Text>
            </Pressable>
        </View>
    );
}
