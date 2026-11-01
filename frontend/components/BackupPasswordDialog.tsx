import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { OverlayModal } from './OverlayModal';

/**
 * The one password dialog for encrypted backups, in three modes:
 *  - `set`: turning "Encrypt backups" on (password + confirmation),
 *  - `change`: replacing the password (password + confirmation; the old one is
 *    not shown, because it is never stored),
 *  - `unlock`: restoring a backup this device cannot open by itself.
 *
 * CONTROLLED like the group dialogs: the parent runs the (slow, Argon2id) key
 * derivation and feeds `busy` / `error` back down. While busy the dialog
 * cannot be dismissed, so a half-finished password change is never orphaned.
 * Renders through `OverlayModal`, never react-native's `<Modal>`.
 */

/** Shared danger red, the one colour the theme deliberately does not own. */
const DANGER = '#ff6b6b';

export type BackupPasswordDialogMode = 'set' | 'change' | 'unlock';

const COPY: Record<BackupPasswordDialogMode, { title: string; body: string; submit: string; busy: string }> = {
  set: {
    title: 'Encrypt backups',
    body: 'Backups will be locked with this password. Nobody can open them without it, and that includes us: if you forget it, those backups are lost. A long passphrase of several words is the strongest choice.',
    submit: 'Turn on encryption',
    busy: 'Securing…',
  },
  change: {
    title: 'Change backup password',
    body: 'New backups will use the new password. Backups you already made still need the password they were made with.',
    submit: 'Change password',
    busy: 'Securing…',
  },
  unlock: {
    title: 'Encrypted backup',
    body: 'This backup is encrypted. Enter the password it was made with.',
    submit: 'Unlock and restore',
    busy: 'Unlocking…',
  },
};

type BackupPasswordDialogProps = {
  visible: boolean;
  mode: BackupPasswordDialogMode;
  /** Key derivation in progress: inputs and buttons are locked. */
  busy: boolean;
  /** Validation / wrong-password message from the parent ('' = none). */
  error: string;
  /** `confirmation` is '' in `unlock` mode. */
  onSubmit: (password: string, confirmation: string) => void;
  onClose: () => void;
};

export const BackupPasswordDialog = ({
  visible,
  mode,
  busy,
  error,
  onSubmit,
  onClose,
}: BackupPasswordDialogProps) => {
  const colors = useThemeColors();
  const styles = useStyles(colors);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // While busy the fields stay EDITABLE and input is ignored instead. Making
  // them non-editable drops their focus on Android (and with it the keyboard),
  // so after a wrong password the user had to tap the field again, and a
  // focus() afterwards races the native editable update (seen on device).
  const typePassword = (text: string) => { if (!busy) setPassword(text); };
  const typeConfirmation = (text: string) => { if (!busy) setConfirmation(text); };
  const copy = COPY[mode];
  const needsConfirmation = mode !== 'unlock';

  // Never carry a typed password over into the next opening. Also clear after
  // a wrong-password attempt so the next try starts from an empty field.
  // Deliberate prop-to-state sync, same pattern as GroupRenameDialog.
  // `busy` is a dependency so a SECOND wrong password (same error text) clears too.
  useEffect(() => {
    if (!visible || (error && !busy)) {
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

        <TextInput
          style={styles.input}
          placeholder={mode === 'unlock' ? 'Backup password' : 'New password'}
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={typePassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          autoFocus
          accessibilityLabel={mode === 'unlock' ? 'Backup password' : 'New password'}
        />

        {needsConfirmation ? (
          <TextInput
            style={styles.input}
            placeholder="Repeat password"
            placeholderTextColor={colors.textSecondary}
            value={confirmation}
            onChangeText={typeConfirmation}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
              accessibilityLabel="Repeat password"
          />
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, busy && styles.primaryButtonBusy]}
          onPress={() => onSubmit(password, needsConfirmation ? confirmation : '')}
          disabled={busy || password.length === 0}
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
        primaryButton: {
          backgroundColor: colors.accent,
          padding: 12,
          borderRadius: 8,
          alignItems: 'center',
        },
        primaryButtonBusy: {
          opacity: 0.8,
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
