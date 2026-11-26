/**
 * components/AppLockSection.tsx
 *
 * Settings card "Privacy & security": the app lock (a PIN) and the distress PIN.
 * Both opt-in, default OFF (databases/settings.ts, migration 16).
 *
 *   - App lock ON: choose a PIN (typed twice). Needs a phone screen lock, which
 *     is the way back in if the PIN is forgotten ("Forgot PIN?" on the lock
 *     screen). OFF forgets both PINs. "Change PIN" while on.
 *   - Distress PIN: only while the lock is on. A short confirmation that points
 *     at backups (a custom selection is listed in full), then choose a second
 *     PIN that must differ from the app PIN. "Technical details" (components/
 *     DistressDetailsDialog.tsx, like the backup-encryption details) explains
 *     it, why the default keeps the journal, and holds the advanced per-category
 *     switches. While set, the card keeps a backup reminder up.
 *
 * Gate + lock screen: context/AppLock.tsx. PINs: lib/pinStore.ts. Copy:
 * lib/appLock.ts. Wipe: databases/distressWipe.ts.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Feather from '@expo/vector-icons/Feather';

import { useThemeColors } from '@/styles/global';
import { useSettings } from '@/context/SettingsContext';
import { DistressDetailsDialog } from '@/components/DistressDetailsDialog';
import { PinSetupDialog, PinSetupMode } from '@/components/PinSetupDialog';
import { hasDeviceCredential } from '@/lib/deviceCredential';
import { clearAllPins, clearDistressPin, setAppPin, setDistressPin } from '@/lib/pinStore';
import { APP_LOCK_COPY, distressWarningFor } from '@/lib/appLock';
import {
    DEFAULT_DISTRESS_SCOPE,
    DistressCategory,
    isDefaultScope,
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

export function AppLockSection() {
    const colors = useThemeColors();
    const { settings, updateSetting } = useSettings();
    const [busy, setBusy] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [setup, setSetup] = useState<PinSetupMode | null>(null);
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
        kept: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 6 },
        links: { gap: 4, marginBottom: 4 },
        link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
        linkText: { color: colors.accent, fontSize: 14, fontWeight: '500' },
    }), [colors]);

    const onToggleLock = async (next: boolean) => {
        if (busy) return;
        if (!next) {
            setBusy(true);
            try {
                await clearAllPins();
                await updateSetting('distress_wipe_enabled', false);
                await updateSetting('app_lock_enabled', false);
            } finally {
                setBusy(false);
            }
            return;
        }
        if (!(await hasDeviceCredential())) {
            Alert.alert(APP_LOCK_COPY.noScreenLockTitle, APP_LOCK_COPY.noScreenLock);
            return;
        }
        setSetup('app');
    };

    const onToggleDistress = async (next: boolean) => {
        if (busy) return;
        if (!next) {
            setBusy(true);
            try {
                await clearDistressPin();
                await updateSetting('distress_wipe_enabled', false);
            } finally {
                setBusy(false);
            }
            return;
        }
        const ok = await confirmDestructive(
            APP_LOCK_COPY.distressWarningTitle,
            distressWarningFor(scope),
            'Choose PIN'
        );
        if (ok) setSetup('distress');
    };

    const onPinChosen = async (pin: string) => {
        const mode = setup;
        setSetup(null);
        setBusy(true);
        try {
            if (mode === 'distress') {
                await setDistressPin(pin);
                await updateSetting('distress_wipe_enabled', true);
            } else {
                await setAppPin(pin);
                if (mode === 'app') await updateSetting('app_lock_enabled', true);
            }
        } finally {
            setBusy(false);
        }
    };

    const toggleCategory = async (category: DistressCategory, value: boolean) => {
        // Emptying the whole journal gets its own confirmation.
        if (category === 'entries' && value) {
            const ok = await confirmDestructive(
                APP_LOCK_COPY.eraseEntriesTitle,
                APP_LOCK_COPY.eraseEntriesWarning,
                'Erase entries too'
            );
            if (!ok) return;
        }
        await updateSetting('distress_wipe_scope', serializeDistressScope({ ...scope, [category]: value }));
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
                        <Text style={styles.label}>Distress PIN</Text>
                        <Text style={styles.description}>{APP_LOCK_COPY.distressDescription}</Text>
                    </View>
                    <Switch
                        testID="distress-wipe-switch"
                        accessibilityLabel="Distress PIN"
                        value={distressOn}
                        disabled={busy}
                        onValueChange={onToggleDistress}
                        trackColor={{ false: '#767577', true: '#ff4444' }}
                        thumbColor="#f4f3f4"
                    />
                </View>
            ) : null}

            {lockOn ? (
                <View style={styles.links}>
                    {distressOn && !isDefaultScope(scope) ? (
                        <Text style={styles.kept} testID="distress-custom-scope">{APP_LOCK_COPY.distressCustomScope}</Text>
                    ) : null}
                    <Pressable
                        testID="app-lock-change-pin"
                        accessibilityRole="button"
                        onPress={() => setSetup('change')}
                        style={styles.link}
                        disabled={busy}
                    >
                        <Feather name="key" color={colors.accent} size={14} />
                        <Text style={styles.linkText}>{APP_LOCK_COPY.changePin}</Text>
                    </Pressable>
                    {/* Same pattern as backup encryption: the card stays short. */}
                    <Pressable
                        testID="distress-details-toggle"
                        accessibilityRole="button"
                        onPress={() => setDetailsOpen(true)}
                        style={styles.link}
                    >
                        <Feather name="info" color={colors.accent} size={14} />
                        <Text style={styles.linkText}>Technical details</Text>
                    </Pressable>
                </View>
            ) : null}

            <DistressDetailsDialog
                visible={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                scope={scope}
                busy={busy}
                onToggle={toggleCategory}
                onReset={() => updateSetting('distress_wipe_scope', serializeDistressScope(DEFAULT_DISTRESS_SCOPE))}
            />

            <PinSetupDialog
                visible={setup !== null}
                mode={setup ?? 'app'}
                onCancel={() => setSetup(null)}
                onDone={onPinChosen}
            />

            {distressOn ? (
                <View style={styles.warning} testID="distress-wipe-hint">
                    <Ionicons name="warning-outline" size={18} color="#FF9800" />
                    <Text style={styles.warningText}>{APP_LOCK_COPY.distressActiveHint}</Text>
                </View>
            ) : null}
        </View>
    );
}
