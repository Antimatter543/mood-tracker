import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { OverlayModal } from './OverlayModal';

/**
 * The one password dialog for encrypted backups. Modes:
 *  - `set`: turning "Encrypt backups" on (new password + repeat),
 *  - `change`: current password, then new password + repeat,
 *  - `reset`: a new password without the current one (after "I forgot it",
 *    or when the stored key can no longer be read),
 *  - `off`: current password, to turn encryption off,
 *  - `confirm`: the periodic "do you still know it?" check before a backup,
 *  - `unlock`: restoring a backup this device cannot open by itself.
 *
 * CONTROLLED like the group dialogs: the parent runs the (slow, Argon2id) key
 * derivation and feeds `busy` / `error` back down. While busy the dialog
 * cannot be dismissed, so a half-finished password change is never orphaned.
 * Renders through `OverlayModal`, never react-native's `<Modal>`.
 */

/** Shared danger red, the one colour the theme deliberately does not own. */
const DANGER = '#ff6b6b';

export type BackupPasswordDialogMode = 'set' | 'change' | 'reset' | 'off' | 'confirm' | 'unlock';

interface ModeCopy {
  title: string;
  body: string;
  submit: string;
  busy: string;
  /** Label of the existing-password field; absent = no such field. */
  currentLabel?: string;
  /** Show "New password" + "Repeat password". */
  newPassword: boolean;
}

export const BACKUP_PASSWORD_COPY: Record<BackupPasswordDialogMode, ModeCopy> = {
  set: {
    title: 'Encrypt backups',
    body: 'Backups will be locked with this password. Nobody can open them without it, and that includes us: if you forget it, those backups are lost. A long passphrase of several words is the strongest choice.',
    submit: 'Turn on encryption',
    busy: 'Securing…',
    newPassword: true,
  },
  change: {
    title: 'Change backup password',
    body: 'New backups will use the new password. Backups you already made still need the password they were made with.',
    submit: 'Change password',
    busy: 'Securing…',
    currentLabel: 'Current password',
    newPassword: true,
  },
  reset: {
    title: 'New backup password',
    body: 'New backups will use this password. Backups made before still need the password they were made with.',
    submit: 'Save password',
    busy: 'Securing…',
    newPassword: true,
  },
  off: {
    title: 'Turn off encryption',
    body: 'New backups will be saved without a password. Backups you already made stay encrypted.',
    submit: 'Turn off',
    busy: 'Checking…',
    currentLabel: 'Current password',
    newPassword: false,
  },
  confirm: {
    title: 'Confirm your backup password',
    body: 'Enter your backup password to check you still remember it.',
    submit: 'Confirm',
    busy: 'Checking…',
    currentLabel: 'Backup password',
    newPassword: false,
  },
  unlock: {
    title: 'Encrypted backup',
    body: 'This backup is encrypted. Enter the password it was made with.',
    submit: 'Unlock and restore',
    busy: 'Unlocking…',
    currentLabel: 'Backup password',
    newPassword: false,
  },
};

export interface BackupPasswordInput {
  /** The existing password ('' when the mode has no such field). */
  current: string;
  /** The new password ('' when the mode has no such field). */
  password: string;
  confirmation: string;
}

type BackupPasswordDialogProps = {
  visible: boolean;
  mode: BackupPasswordDialogMode;
  /** Key derivation in progress: inputs and buttons are locked. */
  busy: boolean;
  /** Validation / wrong-password message from the parent ('' = none). */
  error: string;
  onSubmit: (input: BackupPasswordInput) => void;
  onClose: () => void;
  /** Shows an "I forgot it" link when given. */
  onForgot?: () => void;
  /** Shows a "Skip" button when given. */
  onSkip?: () => void;
};

const SECURE_FIELD = {
  secureTextEntry: true,
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'off',
  importantForAutofill: 'no',
} as const;

export const BackupPasswordDialog = ({
  visible,
  mode,
  busy,
  error,
  onSubmit,
  onClose,
  onForgot,
  onSkip,
}: BackupPasswordDialogProps) => {
  const colors = useThemeColors();
  const styles = useStyles(colors);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // While busy the fields stay EDITABLE and input is ignored instead. Making
  // them non-editable drops their focus on Android (and with it the keyboard),
  // so after a wrong password the user had to tap the field again, and a
  // focus() afterwards races the native editable update (seen on device).
  const typeCurrent = (text: string) => { if (!busy) setCurrent(text); };
  const typePassword = (text: string) => { if (!busy) setPassword(text); };
  const typeConfirmation = (text: string) => { if (!busy) setConfirmation(text); };
  const copy = BACKUP_PASSWORD_COPY[mode];
  const canSubmit =
    !busy && (!copy.currentLabel || current.length > 0) && (!copy.newPassword || password.length > 0);

  // Never carry a typed password over into the next opening. Also clear after
  // a wrong-password attempt so the next try starts from an empty field.
  // Deliberate prop-to-state sync, same pattern as GroupRenameDialog.
  // `busy` is a dependency so a SECOND wrong password (same error text) clears too.
  useEffect(() => {
    if (!visible || (error && !busy)) {
      setCurrent('');
      setPassword('');
      setConfirmation('');
    }
  }, [visible, error, mode, busy]);

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <OverlayModal visible={visible} onClose={close} dismissOnBackdropPress={!busy}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="lock-closed" color={colors.text} size={20} />
          <Text style={styles.title}>{copy.title}</Text>
          <Pressable
            style={styles.closeButton}
            onPress={close}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Close backup password"
          >
            <Ionicons name="close" color={colors.text} size={24} />
          </Pressable>
        </View>

        <Text style={styles.body}>{copy.body}</Text>

        {copy.currentLabel ? (
          <TextInput
            style={styles.input}
            placeholder={copy.currentLabel}
            placeholderTextColor={colors.textSecondary}
            value={current}
            onChangeText={typeCurrent}
            autoFocus
            accessibilityLabel={copy.currentLabel}
            {...SECURE_FIELD}
          />
        ) : null}

        {copy.newPassword ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={colors.textSecondary}
              value={password}
              onChangeText={typePassword}
              autoFocus={!copy.currentLabel}
              accessibilityLabel="New password"
              {...SECURE_FIELD}
            />
            <TextInput
              style={styles.input}
              placeholder="Repeat password"
              placeholderTextColor={colors.textSecondary}
              value={confirmation}
              onChangeText={typeConfirmation}
              accessibilityLabel="Repeat password"
              {...SECURE_FIELD}
            />
          </>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {onForgot ? (
          <Pressable
            style={styles.forgotLink}
            onPress={onForgot}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="I forgot my backup password"
          >
            <Text style={styles.linkText}>I forgot it</Text>
          </Pressable>
        ) : null}

        <View style={styles.buttonRow}>
          {onSkip ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={onSkip}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Skip"
            >
              <Text style={styles.secondaryButtonText}>Skip</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.primaryButton, busy && styles.primaryButtonBusy]}
            onPress={() => onSubmit({ current, password, confirmation })}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={copy.submit}
          >
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.primaryButtonText}>{copy.busy}</Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>{copy.submit}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </OverlayModal>
  );
};

const useStyles = (colors: ThemeColors) =>
  useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.cardBackground,
          width: '92%',
          maxWidth: 480,
          borderRadius: 16,
          padding: 20,
          gap: 16,
        },
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        title: {
          color: colors.text,
          fontSize: 20,
          fontWeight: 'bold',
          flex: 1,
        },
        closeButton: {
          padding: 4,
        },
        body: {
          color: colors.textSecondary,
          fontSize: 14,
          lineHeight: 20,
        },
        input: {
          backgroundColor: colors.overlays.tag,
          borderRadius: 8,
          padding: 12,
          color: colors.text,
          fontSize: 16,
          borderWidth: 1,
          borderColor: colors.overlays.tagBorder,
        },
        errorText: {
          color: DANGER,
          fontSize: 14,
        },
        forgotLink: {
          alignSelf: 'flex-start',
          paddingVertical: 2,
        },
        linkText: {
          color: colors.accent,
          fontSize: 14,
          fontWeight: '500',
        },
        buttonRow: {
          flexDirection: 'row',
          gap: 12,
        },
        primaryButton: {
          flex: 1,
          backgroundColor: colors.accent,
          padding: 12,
          borderRadius: 8,
          alignItems: 'center',
        },
        primaryButtonBusy: {
          opacity: 0.8,
        },
        secondaryButton: {
          flex: 1,
          padding: 12,
          borderRadius: 8,
          alignItems: 'center',
          backgroundColor: colors.overlays.tag,
          borderWidth: 1,
          borderColor: colors.overlays.tagBorder,
        },
        secondaryButtonText: {
          color: colors.text,
          fontSize: 16,
          fontWeight: '600',
        },
        busyRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        primaryButtonText: {
          color: '#fff',
          fontSize: 16,
          fontWeight: '600',
        },
      }),
    [colors]
  );
