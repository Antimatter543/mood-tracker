/**
 * "Technical details" for the distress PIN (Settings > Privacy & security),
 * the same pattern as the backup-encryption details: the card itself stays
 * short (switch, one sentence, a link), everything else lives here.
 *
 *   1. How it works: the distress PIN, and why nothing on the lock screen
 *      gives it away (lib/appLock.ts DISTRESS_TECH_DETAILS).
 *   2. Why the default keeps the journal: an empty mood tracker can itself
 *      raise suspicion.
 *   3. Advanced: one switch per category (lib/distressScope.ts), what is kept,
 *      and a reset to the default.
 *
 * In-tree overlay (OverlayModal), never a native <Modal> (CLAUDE.md).
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { OverlayModal } from '@/components/OverlayModal';
import { useThemeColors } from '@/styles/global';
import { APP_LOCK_COPY, DISTRESS_TECH_DETAILS } from '@/lib/appLock';
import {
    DISTRESS_CATEGORIES,
    DISTRESS_CATEGORY_COPY,
    DistressCategory,
    DistressScope,
    isDefaultScope,
    keptSummary,
} from '@/lib/distressScope';

export function DistressDetailsDialog({
    visible,
    onClose,
    scope,
    busy,
    onToggle,
    onReset,
}: {
    visible: boolean;
    onClose: () => void;
    scope: DistressScope;
    busy: boolean;
    onToggle: (category: DistressCategory, value: boolean) => void;
    onReset: () => void;
}) {
    const colors = useThemeColors();
    const styles = useMemo(() => StyleSheet.create({
        card: {
            backgroundColor: colors.cardBackground,
            width: '92%',
            maxWidth: 520,
            maxHeight: '85%',
            borderRadius: 16,
            padding: 20,
            gap: 12,
        },
        headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        title: { color: colors.text, fontSize: 20, fontWeight: 'bold', flex: 1 },
        closeButton: { padding: 4 },
        scroll: { flexGrow: 0 },
        scrollContent: { gap: 10, paddingBottom: 4 },
        sectionLabel: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 6 },
        body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
        scopeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        scopeText: { flex: 1 },
        scopeLabel: { color: colors.text, fontSize: 14, lineHeight: 18 },
        scopeDetail: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
        kept: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
        resetText: { color: colors.accent, fontSize: 14, fontWeight: '500' },
    }), [colors]);

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View style={styles.card} testID="distress-details">
                <View style={styles.headerRow}>
                    <Ionicons name="shield-checkmark" color={colors.text} size={20} />
                    <Text style={styles.title}>Technical details</Text>
                    <Pressable
                        testID="distress-details-close"
                        style={styles.closeButton}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                    >
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>

                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator
                    persistentScrollbar
                    testID="distress-details-scroll"
                >
                    {/* The content takes the touch, so a drag that starts on text
                        reaches the list instead of the overlay's card Pressable
                        (a real finger could not scroll this dialog; same cause and
                        fix as the calendar day card, #43). The switches inside
                        still take their own taps (the deepest responder wins). */}
                    <View style={styles.scrollContent} onStartShouldSetResponder={() => true} testID="distress-details-body">
                        <Text style={styles.sectionLabel}>How it works</Text>
                        {DISTRESS_TECH_DETAILS.map(line => (
                            <Text key={line} style={styles.body}>{'• '}{line}</Text>
                        ))}

                        <Text style={styles.sectionLabel}>Why the default keeps your journal</Text>
                        <Text style={styles.body} testID="distress-why-default">{APP_LOCK_COPY.distressWhyDefault}</Text>

                        <Text style={styles.sectionLabel}>Advanced: what gets erased</Text>
                        <View testID="distress-scope" style={{ gap: 10 }}>
                            {DISTRESS_CATEGORIES.map(category => (
                                <View key={category} style={styles.scopeRow}>
                                    <View style={styles.scopeText}>
                                        <Text style={styles.scopeLabel}>{DISTRESS_CATEGORY_COPY[category].label}</Text>
                                        <Text style={styles.scopeDetail}>{DISTRESS_CATEGORY_COPY[category].detail}</Text>
                                    </View>
                                    <Switch
                                        testID={`distress-scope-${category}`}
                                        accessibilityLabel={`Erase ${DISTRESS_CATEGORY_COPY[category].label}`}
                                        value={scope[category]}
                                        disabled={busy}
                                        onValueChange={v => onToggle(category, v)}
                                        trackColor={{ false: '#767577', true: '#ff4444' }}
                                        thumbColor="#f4f3f4"
                                    />
                                </View>
                            ))}
                        </View>
                        <Text style={styles.kept} testID="distress-kept">{keptSummary(scope)}</Text>
                        {!isDefaultScope(scope) ? (
                            <Pressable testID="distress-scope-reset" onPress={onReset} accessibilityRole="button">
                                <Text style={styles.resetText}>Reset to the recommended default</Text>
                            </Pressable>
                        ) : null}
                    </View>
                </ScrollView>
            </View>
        </OverlayModal>
    );
}
