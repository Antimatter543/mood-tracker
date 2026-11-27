/**
 * Choose a PIN: type it, type it again. Used for the app PIN (first time and
 * "Change app PIN") and for the distress PIN (first time and "Change distress
 * PIN"). The two PINs must always differ.
 * In-tree overlay (OverlayModal), never a native <Modal> (CLAUDE.md).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { OverlayModal } from '@/components/OverlayModal';
import { PinPad } from '@/components/PinPad';
import { useThemeColors } from '@/styles/global';
import { PIN_SETUP_COPY } from '@/lib/appLock';
import { PIN_PROBLEM_COPY, pinProblem } from '@/lib/pinLock';
import { isOtherPin } from '@/lib/pinStore';

export type PinSetupMode = keyof typeof PIN_SETUP_COPY;

export function PinSetupDialog({
    visible,
    mode,
    onCancel,
    onDone,
}: {
    visible: boolean;
    mode: PinSetupMode;
    onCancel: () => void;
    onDone: (pin: string) => void;
}) {
    const colors = useThemeColors();
    const [first, setFirst] = useState<string | null>(null);
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Every opening starts fresh.
    useEffect(() => {
        if (visible) {
            setFirst(null);
            setValue('');
            setError(null);
            setBusy(false);
        }
    }, [visible, mode]);

    const styles = useMemo(() => StyleSheet.create({
        card: {
            backgroundColor: colors.cardBackground,
            width: '92%',
            maxWidth: 420,
            borderRadius: 16,
            padding: 20,
            alignItems: 'center',
            gap: 12,
        },
        headerRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
        title: { color: colors.text, fontSize: 20, fontWeight: 'bold', flex: 1 },
        error: { color: '#ff6b6b', fontSize: 14, minHeight: 20, textAlign: 'center' },
        note: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    }), [colors]);

    const copy = PIN_SETUP_COPY[mode];

    const submit = async () => {
        if (first === null) {
            const problem = pinProblem(value);
            if (problem) {
                setError(PIN_PROBLEM_COPY[problem]);
                setValue('');
                return;
            }
            // The two PINs must always differ, whichever one is being chosen.
            const slot = mode === 'distress' || mode === 'changeDistress' ? 'distress' : 'app';
            setBusy(true);
            const clash = await isOtherPin(value, slot);
            setBusy(false);
            if (clash) {
                setError(PIN_PROBLEM_COPY[slot === 'distress' ? 'same_as_app_pin' : 'same_as_distress_pin']);
                setValue('');
                return;
            }
            setFirst(value);
            setValue('');
            setError(null);
            return;
        }
        const problem = pinProblem(first, { confirm: value });
        if (problem) {
            setError(PIN_PROBLEM_COPY[problem]);
            setFirst(null);
            setValue('');
            return;
        }
        onDone(first);
    };

    return (
        <OverlayModal visible={visible} onClose={onCancel}>
            <View style={styles.card} testID="pin-setup">
                <View style={styles.headerRow}>
                    <Text style={styles.title} testID="pin-setup-title">
                        {first === null ? copy.title : copy.confirm}
                    </Text>
                    <Pressable testID="pin-setup-close" onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel">
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>
                <PinPad value={value} onChange={v => { setValue(v); setError(null); }} onSubmit={submit} busy={busy} />
                <Text style={styles.error} testID="pin-setup-error">{error ?? ''}</Text>
                <Text style={styles.note} testID="pin-setup-note">{copy.note}</Text>
            </View>
        </OverlayModal>
    );
}
