/**
 * components/RemindersSection.tsx
 *
 * The Reminders card on the Settings screen. Replaced the old single
 * "Daily Reminder" switch + one time picker (which lived in SettingRow.tsx) with
 * a LIST: the user can keep a morning, an afternoon and an evening nudge, each
 * named, timed and switchable on its own.
 *
 * Where the pieces live:
 *   - the model + all validation/CRUD: lib/reminders.ts (pure, unit-tested)
 *   - storage: the `reminders` settings key, a JSON-encoded Reminder[]
 *   - scheduling: lib/notifications.ts. This file never schedules anything; it
 *     only writes the list. `NotificationReArm` (app/(tabs)/_layout.tsx) keys off
 *     `settings.reminders`, so every write here re-arms the OS schedule.
 *
 * Two hard rules from the project:
 *   - NEVER a react-native `<Modal>` — the editor is an in-tree `OverlayModal`.
 *   - Permission is requested ONLY from a user gesture (adding a reminder, or
 *     switching one on), never on mount.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { useThemeColors } from '@/styles/global';
import { useSettings } from '@/context/SettingsContext';
import { OverlayModal } from '@/components/OverlayModal';
import { requestNotificationPermission } from '@/lib/notifications';
import {
    DEFAULT_REMINDER_TIME,
    MAX_REMINDERS,
    REMINDER_LABEL_MAX_LENGTH,
    Reminder,
    addReminder,
    canAddReminder,
    normalizeReminderTime,
    parseReminders,
    removeReminder,
    reminderDisplayLabel,
    serializeReminders,
    sortRemindersByTime,
    updateReminder,
} from '@/lib/reminders';

/** "20:00" -> "8:00 PM" (locale-aware). Display only; storage stays 24h. */
export function formatTimeForDisplay(time: string): string {
    const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The reminder currently open in the editor. `id: null` = a not-yet-created one. */
type EditorDraft = { id: string | null; label: string; time: string };

export function RemindersSection() {
    const colors = useThemeColors();
    const styles = useStyles();
    const { settings, updateSetting } = useSettings();

    const reminders = useMemo(
        () => sortRemindersByTime(parseReminders(settings.reminders)),
        [settings.reminders]
    );

    const [draft, setDraft] = useState<EditorDraft | null>(null);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [permissionDenied, setPermissionDenied] = useState(false);

    const persist = useCallback(
        (next: readonly Reminder[]) => updateSetting('reminders', serializeReminders(next)),
        [updateSetting]
    );

    /**
     * Ask for notification permission. Returns whether we may arm a reminder.
     * Called ONLY from a gesture (toggle-on / save-a-new-one).
     */
    const ensurePermission = useCallback(async (): Promise<boolean> => {
        const granted = await requestNotificationPermission();
        setPermissionDenied(!granted);
        return granted;
    }, []);

    const handleToggle = useCallback(
        async (reminder: Reminder, enabled: boolean) => {
            // Switching OFF never needs permission; switching ON does.
            if (enabled && !(await ensurePermission())) return;
            await persist(updateReminder(reminders, reminder.id, { enabled }));
        },
        [ensurePermission, persist, reminders]
    );

    const handleDelete = useCallback(
        async (id: string) => {
            setDraft(null);
            setShowTimePicker(false);
            await persist(removeReminder(reminders, id));
        },
        [persist, reminders]
    );

    const handleSaveDraft = useCallback(async () => {
        if (!draft) return;
        const { id, label, time } = draft;
        setDraft(null);
        setShowTimePicker(false);

        if (id === null) {
            // A brand-new reminder is created ENABLED, so it needs permission.
            const granted = await ensurePermission();
            await persist(addReminder(reminders, { label, time, enabled: granted }));
            return;
        }
        await persist(updateReminder(reminders, id, { label, time }));
    }, [draft, ensurePermission, persist, reminders]);

    const handleTimePicked = useCallback(
        (event: DateTimePickerEvent, picked?: Date) => {
            // Android's picker is a dialog that dismisses itself; iOS shows an
            // inline spinner we keep open until the user leaves the editor.
            setShowTimePicker(Platform.OS === 'ios');
            if (event.type !== 'set' || !picked) return;
            setDraft(prev =>
                prev
                    ? {
                          ...prev,
                          time: `${String(picked.getHours()).padStart(2, '0')}:${String(
                              picked.getMinutes()
                          ).padStart(2, '0')}`,
                      }
                    : prev
            );
        },
        []
    );

    const atCap = !canAddReminder(reminders);

    return (
        <View style={styles.section}>
            <View style={styles.header}>
                <Ionicons name="notifications-outline" size={20} color={colors.text} />
                <Text style={styles.title}>Reminders</Text>
            </View>

            {reminders.length === 0 ? (
                <Text style={styles.emptyText} testID="reminders-empty">
                    No reminders yet. Add one for each time of day you want a nudge — a morning
                    check-in, an evening reflection.
                </Text>
            ) : (
                reminders.map(reminder => (
                    <ReminderRow
                        key={reminder.id}
                        reminder={reminder}
                        onToggle={enabled => handleToggle(reminder, enabled)}
                        onEdit={() =>
                            setDraft({
                                id: reminder.id,
                                label: reminder.label,
                                time: reminder.time,
                            })
                        }
                    />
                ))
            )}

            <Pressable
                testID="reminders-add"
                style={({ pressed }) => [
                    styles.addButton,
                    atCap && styles.addButtonDisabled,
                    pressed && !atCap && styles.pressed,
                ]}
                disabled={atCap}
                onPress={() => {
                    setPermissionDenied(false);
                    setDraft({ id: null, label: '', time: DEFAULT_REMINDER_TIME });
                }}
                accessibilityRole="button"
                accessibilityLabel="Add reminder"
            >
                <Ionicons name="add" size={18} color={atCap ? colors.textSecondary : '#fff'} />
                <Text style={[styles.addButtonText, atCap && styles.addButtonTextDisabled]}>
                    {atCap ? `Maximum ${MAX_REMINDERS} reminders` : 'Add reminder'}
                </Text>
            </Pressable>

            {permissionDenied ? (
                <Text style={styles.note} testID="reminders-permission-note">
                    Notifications are blocked for SoulSync. Enable them in your system settings to
                    get reminders.
                </Text>
            ) : (
                <Text style={styles.note}>
                    Reminders are scheduled on this device only. They need notification permission,
                    and (in Expo Go) won&apos;t fire until you run a real build.
                </Text>
            )}

            {/* In-tree overlay — NEVER a react-native <Modal> in this app. */}
            <OverlayModal visible={draft !== null} onClose={() => setDraft(null)}>
                {draft && (
                    <View style={styles.editorCard} testID="reminder-editor">
                        <Text style={styles.editorTitle}>
                            {draft.id === null ? 'New reminder' : 'Edit reminder'}
                        </Text>

                        <Text style={styles.fieldLabel}>Name</Text>
                        <TextInput
                            testID="reminder-editor-label"
                            style={styles.input}
                            value={draft.label}
                            onChangeText={label => setDraft(prev => (prev ? { ...prev, label } : prev))}
                            placeholder="Morning check-in"
                            placeholderTextColor={colors.textSecondary}
                            maxLength={REMINDER_LABEL_MAX_LENGTH}
                        />

                        <Text style={styles.fieldLabel}>Time</Text>
                        <Pressable
                            testID="reminder-editor-time"
                            style={styles.timeButton}
                            onPress={() => setShowTimePicker(true)}
                            accessibilityRole="button"
                            accessibilityLabel={`Reminder time, ${formatTimeForDisplay(draft.time)}. Tap to change.`}
                        >
                            <Text style={styles.timeButtonText}>
                                {formatTimeForDisplay(draft.time)}
                            </Text>
                            <Ionicons name="time-outline" size={20} color={colors.text} />
                        </Pressable>

                        {showTimePicker && (
                            <DateTimePicker
                                value={timeToDate(draft.time)}
                                mode="time"
                                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                onChange={handleTimePicked}
                            />
                        )}

                        <View style={styles.editorActions}>
                            {draft.id !== null && (
                                <Pressable
                                    testID="reminder-editor-delete"
                                    style={({ pressed }) => [
                                        styles.actionButton,
                                        styles.deleteButton,
                                        pressed && styles.pressed,
                                    ]}
                                    onPress={() => handleDelete(draft.id!)}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.deleteButtonText}>Delete</Text>
                                </Pressable>
                            )}
                            <Pressable
                                testID="reminder-editor-cancel"
                                style={({ pressed }) => [
                                    styles.actionButton,
                                    styles.cancelButton,
                                    pressed && styles.pressed,
                                ]}
                                onPress={() => {
                                    setShowTimePicker(false);
                                    setDraft(null);
                                }}
                                accessibilityRole="button"
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                testID="reminder-editor-save"
                                style={({ pressed }) => [
                                    styles.actionButton,
                                    styles.saveButton,
                                    pressed && styles.pressed,
                                ]}
                                onPress={handleSaveDraft}
                                accessibilityRole="button"
                            >
                                <Text style={styles.saveButtonText}>Save</Text>
                            </Pressable>
                        </View>
                    </View>
                )}
            </OverlayModal>
        </View>
    );
}

/** "HH:MM" -> a Date today at that time, for the native picker's value. */
function timeToDate(time: string): Date {
    const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
}

function ReminderRow({
    reminder,
    onToggle,
    onEdit,
}: {
    reminder: Reminder;
    onToggle: (enabled: boolean) => void;
    onEdit: () => void;
}) {
    const colors = useThemeColors();
    const styles = useStyles();
    const label = reminderDisplayLabel(reminder);

    return (
        <Pressable
            testID={`reminder-row-${reminder.id}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit reminder ${label} at ${formatTimeForDisplay(reminder.time)}`}
        >
            <View style={styles.rowText}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                    {label}
                </Text>
                <Text style={[styles.rowTime, !reminder.enabled && styles.rowTimeOff]}>
                    {formatTimeForDisplay(reminder.time)}
                    {reminder.enabled ? '' : ' · off'}
                </Text>
            </View>
            <Switch
                testID={`reminder-toggle-${reminder.id}`}
                value={reminder.enabled}
                onValueChange={onToggle}
                trackColor={{ false: '#767577', true: colors.accent }}
                thumbColor="#f4f3f4"
                accessibilityLabel={`${label} enabled`}
            />
        </Pressable>
    );
}

const useStyles = () => {
    const colors = useThemeColors();
    return useMemo(
        () =>
            StyleSheet.create({
                section: {
                    backgroundColor: colors.cardBackground,
                    borderRadius: 16,
                    padding: 16,
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                },
                header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
                title: { fontSize: 18, fontWeight: '600', color: colors.text, marginLeft: 8 },
                row: {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    // 44pt-plus touch target (Apple HIG / Material).
                    minHeight: 56,
                    backgroundColor: colors.overlays.tag,
                    borderRadius: 10,
                    marginBottom: 8,
                },
                rowText: { flex: 1, marginRight: 12 },
                rowLabel: { color: colors.text, fontSize: 16, fontWeight: '500', lineHeight: 20 },
                rowTime: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: 2 },
                rowTimeOff: { color: colors.textSecondary, fontWeight: '500' },
                emptyText: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    lineHeight: 20,
                    marginBottom: 12,
                    paddingHorizontal: 4,
                },
                addButton: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    backgroundColor: colors.accent,
                    borderRadius: 10,
                    paddingVertical: 12,
                    minHeight: 48,
                },
                addButtonDisabled: {
                    backgroundColor: colors.overlays.tag,
                },
                addButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
                addButtonTextDisabled: { color: colors.textSecondary },
                note: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    fontStyle: 'italic',
                    marginTop: 8,
                    paddingHorizontal: 4,
                },
                pressed: { opacity: 0.8 },

                // ── editor overlay ────────────────────────────────────────────
                editorCard: {
                    width: '94%',
                    backgroundColor: colors.cardBackground,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 20,
                },
                editorTitle: {
                    fontSize: 18,
                    fontWeight: '600',
                    color: colors.text,
                    marginBottom: 16,
                },
                fieldLabel: { color: colors.textSecondary, fontSize: 14, marginBottom: 6 },
                input: {
                    color: colors.text,
                    fontSize: 16,
                    backgroundColor: colors.overlays.tag,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    marginBottom: 16,
                },
                timeButton: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: colors.overlays.tag,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    marginBottom: 20,
                },
                timeButtonText: { color: colors.text, fontSize: 16 },
                editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
                actionButton: {
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    minHeight: 44,
                    justifyContent: 'center',
                    borderWidth: 1,
                },
                deleteButton: {
                    marginRight: 'auto',
                    backgroundColor: 'transparent',
                    borderColor: '#ff4444',
                },
                deleteButtonText: { color: '#ff4444', fontSize: 15, fontWeight: '500' },
                cancelButton: {
                    backgroundColor: 'transparent',
                    borderColor: colors.border,
                },
                cancelButtonText: { color: colors.text, fontSize: 15, fontWeight: '500' },
                saveButton: { backgroundColor: colors.accent, borderColor: colors.accent },
                saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
            }),
        [colors]
    );
};
