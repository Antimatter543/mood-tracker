import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '@/styles/global';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/lib/pinLock';

function Key({ id, children, onPress, style, pressedStyle, label }: {
    id: string;
    children: React.ReactNode;
    onPress: () => void;
    style: object | object[];
    pressedStyle: object;
    label: string;
}) {
    return (
        <Pressable
            testID={`pin-key-${id}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={({ pressed }) => [style, pressed && pressedStyle]}
        >
            {children}
        </Pressable>
    );
}

/**
 * The number pad for the app PIN (lock screen and PIN setup). Our own keys, not
 * the system keyboard: no suggestions, no learned input, no keyboard history,
 * and it looks the same on every phone. Dots show only the LENGTH typed.
 *
 * testIDs: pin-key-0..9, pin-key-back, pin-key-ok, pin-dots.
 */
export function PinPad({
    value,
    onChange,
    onSubmit,
    disabled = false,
    busy = false,
}: {
    value: string;
    onChange: (next: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
    busy?: boolean;
}) {
    const colors = useThemeColors();
    const styles = useMemo(() => StyleSheet.create({
        dots: { flexDirection: 'row', gap: 14, height: 18, marginBottom: 28, alignItems: 'center' },
        dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.textSecondary },
        dotFilled: { backgroundColor: colors.text, borderColor: colors.text },
        grid: { width: 264, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
        key: {
            width: 76,
            height: 76,
            borderRadius: 38,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.cardBackground,
        },
        keyPressed: { opacity: 0.6 },
        keyText: { color: colors.text, fontSize: 28, fontWeight: '500' },
        okKey: { backgroundColor: colors.accent },
        disabledKey: { opacity: 0.4 },
    }), [colors]);

    const press = (digit: string) => {
        if (disabled || busy || value.length >= PIN_MAX_LENGTH) return;
        onChange(value + digit);
    };
    const canSubmit = !disabled && !busy && value.length >= PIN_MIN_LENGTH;
    const dotCount = Math.max(PIN_MIN_LENGTH, value.length);

    return (
        <View style={{ alignItems: 'center' }}>
            <View style={styles.dots} testID="pin-dots" accessibilityLabel={`${value.length} digits entered`}>
                {Array.from({ length: dotCount }, (_, i) => (
                    <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
                ))}
            </View>
            <View style={styles.grid}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                    <Key key={d} id={d} label={d} onPress={() => press(d)} style={styles.key} pressedStyle={styles.keyPressed}>
                        <Text style={styles.keyText}>{d}</Text>
                    </Key>
                ))}
                <Key id="back" label="Delete" onPress={() => !busy && onChange(value.slice(0, -1))} style={styles.key} pressedStyle={styles.keyPressed}>
                    <Ionicons name="backspace-outline" size={26} color={colors.text} />
                </Key>
                <Key id="0" label="0" onPress={() => press('0')} style={styles.key} pressedStyle={styles.keyPressed}>
                    <Text style={styles.keyText}>0</Text>
                </Key>
                <Key
                    id="ok"
                    label="Done"
                    onPress={() => canSubmit && onSubmit()}
                    style={[styles.key, styles.okKey, !canSubmit && styles.disabledKey]}
                    pressedStyle={styles.keyPressed}
                >
                    {busy ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Ionicons name="arrow-forward" size={28} color="#fff" />
                    )}
                </Key>
            </View>
        </View>
    );
}
