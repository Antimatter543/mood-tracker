/**
 * components/AppLockSection.tsx
 *
 * Settings card "Privacy & security": the app lock and its distress wipe.
 * Both opt-in, default OFF (databases/settings.ts, migration 16).
 *
 *   - App lock ON needs a successful prompt first (proves the phone can unlock
 *     it, so nobody locks themselves out by accident). OFF also turns the
 *     distress wipe off.
 *   - Distress wipe is only offered while the lock is on, needs enrolled
 *     biometrics, and is turned on only after an explicit destructive warning
 *     that lists what it erases and points at backups. While on, the card shows
 *     what it erases (one switch per category, lib/distressScope.ts, all on by
 *     default), what is always kept, "Technical details" with the Android rule
 *     behind the lockout, and a backup reminder.
 *
 * Gate + lock screen: context/AppLock.tsx. Decisions + copy: lib/appLock.ts.
 * Wipe: databases/distressWipe.ts.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemeColors } from '@/styles/global';
import { useSettings } from '@/context/SettingsContext';
import { useAppLock } from '@/context/AppLock';
import { getBiometricCapabilities } from '@/lib/biometricAuth';
import {
    ANDROID_BIOMETRIC_RULE_URL,
    APP_LOCK_COPY,
    DISTRESS_TECH_DETAILS,
    appLockBlocker,
    distressWarningFor,
    distressWipeBlocker,
    EnableBlocker,
} from '@/lib/appLock';
import {
    DISTRESS_CATEGORIES,
    DISTRESS_CATEGORY_COPY,
    DistressCategory,
    erasedCategoryLabels,
    parseDistressScope,
    serializeDistressScope,
} from '@/lib/distressScope';

/** Native confirm as a promise: true = the destructive button was pressed. */
function confirmDestructive(title: string, message: string, confirmText: string): Promise<boolean> {
    return new Promise(resolve =>
        Alert.alert(
            title,
            message,
            [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
        )
    );
}

function explainBlocker(blocker: EnableBlocker): void {
    if (blocker === 'no_screen_lock') {
        Alert.alert(APP_LOCK_COPY.noScreenLockTitle, APP_LOCK_COPY.noScreenLock);
    } else {
        Alert.alert(APP_LOCK_COPY.noBiometricsTitle, APP_LOCK_COPY.noBiometrics);
    }
}

export function AppLockSection() {
    const colors = useThemeColors();
    const { settings, updateSetting } = useSettings();
    const { confirmIdentity } = useAppLock();
    const [busy, setBusy] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const scope = useMemo(() => parseDistressScope(settings.distress_wipe_scope), [settings.distress_wipe_scope]);

    const lockOn = settings.app_lock_enabled;
    const distressOn = lockOn && settings.distress_wipe_enabled;

    const styles = useMemo(() => StyleSheet.create({
        section: {
            backgroundColor: colors.cardBackground,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.border,
        },
        header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
        title: { fontSize: 18, fontWeight: '600', color: colors.text, marginLeft: 8 },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 12,
            gap: 12,
        },
        textContainer: { flex: 1 },
        label: { color: colors.text, fontSize: 16, fontWeight: '500', lineHeight: 20 },
        description: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
        warning: {
            flexDirection: 'row',
            gap: 8,
            padding: 12,
            borderRadius: 8,
            marginTop: 4,
            backgroundColor: 'rgba(255, 152, 0, 0.12)',
            borderWidth: 1,
            borderColor: 'rgba(255, 152, 0, 0.35)',
        },
        warningText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
        subheading: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 },
        scopeRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 6,
            gap: 12,
        },
        scopeLabel: { color: colors.text, fontSize: 14, lineHeight: 18 },
        scopeDetail: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
        kept: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 6 },
        detailsToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, paddingVertical: 4 },
        detailsToggleText: { color: colors.accent, fontSize: 13, fontWeight: '500' },
        detailsText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
        link: { color: colors.accent, fontSize: 12, marginTop: 8, textDecorationLine: 'underline' },
    }), [colors]);

    const toggleCategory = (category: DistressCategory, value: boolean) =>
        updateSetting('distress_wipe_scope', serializeDistressScope({ ...scope, [category]: value }));

    const onToggleLock = async (next: boolean) => {
        if (busy) return;
        setBusy(true);
        try {
            if (!next) {
                await updateSetting('distress_wipe_enabled', false);
                await updateSetting('app_lock_enabled', false);
                return;
            }
            const blocker = appLockBlocker(await getBiometricCapabilities());
            if (blocker) {
                explainBlocker(blocker);
                return;
            }
            if (await confirmIdentity()) {
                await updateSetting('app_lock_enabled', true);
            }
        } finally {
            setBusy(false);
        }
    };

    const onToggleDistress = async (next: boolean) => {
        if (busy) return;
        setBusy(true);
        try {
            if (!next) {
                await updateSetting('distress_wipe_enabled', false);
                return;
            }
            const blocker = distressWipeBlocker(await getBiometricCapabilities());
            if (blocker) {
                explainBlocker(blocker);
                return;
            }
            const ok = await confirmDestructive(
                APP_LOCK_COPY.distressWarningTitle,
                distressWarningFor(erasedCategoryLabels(scope)),
                'Turn on'
            );
            if (ok) await updateSetting('distress_wipe_enabled', true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={styles.section} testID="app-lock-section">
            <View style={styles.header}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.text} />
                <Text style={styles.title}>Privacy & security</Text>
            </View>

            <View style={styles.row}>
                <View style={styles.textContainer}>
                    <Text style={styles.label}>App lock</Text>
                    <Text style={styles.description}>{APP_LOCK_COPY.lockDescription}</Text>
                </View>
                <Switch
                    testID="app-lock-switch"
                    accessibilityLabel="App lock"
                    value={lockOn}
                    disabled={busy}
                    onValueChange={onToggleLock}
                    trackColor={{ false: '#767577', true: colors.accent }}
                    thumbColor="#f4f3f4"
                />
            </View>

            {lockOn ? (
                <View style={styles.row}>
                    <View style={styles.textContainer}>
                        <Text style={styles.label}>Distress wipe</Text>
                        <Text style={styles.description}>{APP_LOCK_COPY.distressDescription}</Text>
                    </View>
                    <Switch
                        testID="distress-wipe-switch"
                        accessibilityLabel="Distress wipe"
                        value={distressOn}
                        disabled={busy}
                        onValueChange={onToggleDistress}
                        trackColor={{ false: '#767577', true: '#ff4444' }}
                        thumbColor="#f4f3f4"
                    />
                </View>
            ) : null}

            {distressOn ? (
                <View testID="distress-scope">
                    <Text style={styles.subheading}>Erased by the distress wipe</Text>
                    {DISTRESS_CATEGORIES.map(category => (
                        <View key={category} style={styles.scopeRow}>
                            <View style={styles.textContainer}>
                                <Text style={styles.scopeLabel}>{DISTRESS_CATEGORY_COPY[category].label}</Text>
                                <Text style={styles.scopeDetail}>{DISTRESS_CATEGORY_COPY[category].detail}</Text>
                            </View>
                            <Switch
                                testID={`distress-scope-${category}`}
                                accessibilityLabel={`Erase ${DISTRESS_CATEGORY_COPY[category].label}`}
                                value={scope[category]}
                                disabled={busy}
                                onValueChange={v => toggleCategory(category, v)}
                                trackColor={{ false: '#767577', true: '#ff4444' }}
                                thumbColor="#f4f3f4"
                            />
                        </View>
                    ))}
                    <Text style={styles.kept}>{APP_LOCK_COPY.distressAlwaysKept}</Text>

                    <Pressable
                        testID="distress-details-toggle"
                        accessibilityRole="button"
                        onPress={() => setDetailsOpen(o => !o)}
                        style={styles.detailsToggle}
                    >
                        <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
                        <Text style={styles.detailsToggleText}>Technical details</Text>
                    </Pressable>
                    {detailsOpen ? (
                        <View testID="distress-details">
                            {DISTRESS_TECH_DETAILS.map(line => (
                                <Text key={line} style={styles.detailsText}>{'\u2022 '}{line}</Text>
                            ))}
                            <Text
                                style={styles.link}
                                accessibilityRole="link"
                                onPress={() => Linking.openURL(ANDROID_BIOMETRIC_RULE_URL)}
                            >
                                Android's rule: Compatibility Definition, 7.3.10 Biometric Sensors
                            </Text>
                        </View>
                    ) : null}
                </View>
            ) : null}

            {distressOn ? (
                <View style={styles.warning} testID="distress-wipe-hint">
                    <Ionicons name="warning-outline" size={18} color="#FF9800" />
                    <Text style={styles.warningText}>{APP_LOCK_COPY.distressActiveHint}</Text>
                </View>
            ) : null}
        </View>
    );
}
