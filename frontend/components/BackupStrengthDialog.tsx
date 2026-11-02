import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { KdfHeader, KdfParams } from '@/lib/backupCrypto';
import {
  KDF_PROFILES,
  KdfBenchmarkResult,
  KdfProfile,
  MANUAL_CONFIRM_ABOVE_MS,
  MANUAL_KDF_LIMITS,
  ManualKdfInput,
  benchmarkKdf,
  manualParams,
  sameParams,
  validateManualKdf,
} from '@/lib/backupKdfProfiles';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { OverlayModal } from './OverlayModal';

/**
 * "Encrypt backups" > "Technical details": what the stored key is made with,
 * and the choice of strength mode (lib/backupKdfProfiles.ts).
 *
 * Manual params can only be saved after a benchmark of EXACTLY those params
 * succeeded on this phone: until then the one button reads "Run benchmark",
 * and editing a field turns it back. A benchmark
 * slower than MANUAL_CONFIRM_ABOVE_MS needs a confirmation. Saving hands the
 * choice to the parent, which asks for the password and derives the key
 * again (useBackupEncryption.openStrengthChange).
 */

const PROFILE_ORDER: KdfProfile[] = ['compatibility', 'security', 'manual'];

const PROFILE_LABEL: Record<KdfProfile, string> = {
  compatibility: 'Compatibility',
  security: 'Security',
  manual: 'Manual',
};

/** "Argon2id, 48 MiB × 2 passes, 4 lanes". */
export function describeKdf(kdf: KdfParams | KdfHeader): string {
  const mib = Math.round(kdf.memoryKiB / 1024);
  return `Argon2id, ${mib} MiB × ${kdf.iterations} ${kdf.iterations === 1 ? 'pass' : 'passes'}, ${kdf.parallelism} ${kdf.parallelism === 1 ? 'lane' : 'lanes'}`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

type BackupStrengthDialogProps = {
  visible: boolean;
  kdf: KdfHeader;
  profile: KdfProfile;
  onClose: () => void;
  /** Save the choice; `params` only for Manual. */
  onSave: (profile: KdfProfile, params: KdfParams | null) => void;
};

const toFields = (kdf: KdfParams) => ({
  memoryMiB: String(Math.round(kdf.memoryKiB / 1024)),
  iterations: String(kdf.iterations),
  parallelism: String(kdf.parallelism),
});

const parseFields = (fields: ReturnType<typeof toFields>): ManualKdfInput => ({
  // Number('') is 0 and Number('1.5') is 1.5: both fail validation, as they should.
  memoryMiB: fields.memoryMiB.trim() === '' ? NaN : Number(fields.memoryMiB),
  iterations: fields.iterations.trim() === '' ? NaN : Number(fields.iterations),
  parallelism: fields.parallelism.trim() === '' ? NaN : Number(fields.parallelism),
});

export const BackupStrengthDialog = ({ visible, kdf, profile, onClose, onSave }: BackupStrengthDialogProps) => {
  const colors = useThemeColors();
  const styles = useStyles(colors);
  const [selected, setSelected] = useState<KdfProfile>(profile);
  const [fields, setFields] = useState(() => toFields(kdf));
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmark, setBenchmark] = useState<KdfBenchmarkResult | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  // Picking Manual adds its fields at the bottom of the scroll area, usually
  // below the fold: scroll to them once they are laid out.
  const revealManual = useRef(false);

  // Every opening starts from what is stored. Deliberate prop-to-state sync,
  // same pattern as BackupPasswordDialog.
  useEffect(() => {
    if (visible) {
      revealManual.current = profile === 'manual';
      setSelected(profile);
      setFields(toFields(kdf));
      setBenchmark(null);
    }
  }, [visible, profile, kdf]);

  const input = parseFields(fields);
  const inputError = validateManualKdf(input);
  const params = inputError ? null : manualParams(input);
  // A result only counts for exactly the params it ran with.
  const result = benchmark && params && sameParams(benchmark.params, params) ? benchmark : null;

  const unchanged =
    selected === profile && (selected !== 'manual' || (params !== null && sameParams(params, kdf)));
  // Manual can only be saved once a benchmark of exactly these values succeeded.
  const needsBenchmark = selected === 'manual' && !result?.ok;
  const canSave = !benchmarking && !unchanged && !needsBenchmark;

  const setField = (name: keyof typeof fields) => (text: string) =>
    setFields(current => ({ ...current, [name]: text.replace(/[^0-9]/g, '') }));

  const runBenchmark = async () => {
    if (!params || benchmarking) return;
    setBenchmarking(true);
    try {
      setBenchmark(await benchmarkKdf(params));
    } finally {
      setBenchmarking(false);
    }
  };

  const save = () => {
    if (!canSave) return;
    if (selected !== 'manual') {
      onSave(selected, null);
      return;
    }
    if (!params || !result?.ok) return;
    if (result.ms <= MANUAL_CONFIRM_ABOVE_MS) {
      onSave('manual', params);
      return;
    }
    Alert.alert(
      'Slow settings',
      `These settings took ${formatMs(result.ms)} on this phone. Changing the password and restoring a backup will take about that long here, and longer on slower phones. Use them anyway?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use anyway', onPress: () => onSave('manual', params) },
      ]
    );
  };

  const close = () => {
    if (!benchmarking) onClose();
  };

  const benchmarkLine = (() => {
    if (benchmarking) return null;
    if (inputError) return { text: inputError, error: true };
    if (!result) return null;
    if (!result.ok) return { text: `Benchmark failed: ${result.error}`, error: true };
    return { text: `Took ${formatMs(result.ms)} on this phone.`, error: false };
  })();

  return (
    <OverlayModal visible={visible} onClose={close} dismissOnBackdropPress={!benchmarking}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="shield-checkmark" color={colors.text} size={20} />
          <Text style={styles.title}>Technical details</Text>
          <Pressable
            style={styles.closeButton}
            onPress={close}
            disabled={benchmarking}
            accessibilityRole="button"
            accessibilityLabel="Close technical details"
          >
            <Ionicons name="close" color={colors.text} size={24} />
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (!revealManual.current) return;
            revealManual.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.body}>
            <Text style={styles.emphasis}>Now: </Text>
            {`${PROFILE_LABEL[profile]}, ${describeKdf(kdf)}. Encryption: AES-256-GCM. Only a key derived from your password is stored, in this phone's secure storage. The password itself is never stored.`}
          </Text>

          <Text style={styles.sectionLabel}>Password hashing strength</Text>
          {PROFILE_ORDER.map(option => {
            const isSelected = option === selected;
            return (
              <Pressable
                key={option}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => {
                  if (option === 'manual' && selected !== 'manual') revealManual.current = true;
                  setSelected(option);
                }}
                disabled={benchmarking}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={KDF_PROFILES[option].title}
              >
                <Ionicons
                  name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                  color={isSelected ? colors.accent : colors.textSecondary}
                  size={20}
                />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{KDF_PROFILES[option].title}</Text>
                  <Text style={styles.optionSummary}>{KDF_PROFILES[option].summary}</Text>
                </View>
              </Pressable>
            );
          })}

          {selected === 'manual' ? (
            <View style={styles.fieldRow}>
              {(
                [
                  ['memoryMiB', 'Memory (MiB)', `${MANUAL_KDF_LIMITS.minMemoryMiB}–${MANUAL_KDF_LIMITS.maxMemoryMiB}`],
                  ['iterations', 'Passes', `${MANUAL_KDF_LIMITS.minIterations}–${MANUAL_KDF_LIMITS.maxIterations}`],
                  ['parallelism', 'Lanes', `${MANUAL_KDF_LIMITS.minParallelism}–${MANUAL_KDF_LIMITS.maxParallelism}`],
                ] as const
              ).map(([name, label, range]) => (
                <View key={name} style={styles.field}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <TextInput
                    style={styles.input}
                    value={fields[name]}
                    onChangeText={setField(name)}
                    editable={!benchmarking}
                    keyboardType="number-pad"
                    placeholder={range}
                    placeholderTextColor={colors.textSecondary}
                    accessibilityLabel={label}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.footnote}>
            Saving asks for your backup password. Backups you already made keep their settings.
          </Text>
        </ScrollView>

        {/* Outside the scroll area: with the number keyboard up, the benchmark
            and its result must stay visible without scrolling the dialog. */}
        {selected === 'manual' && benchmarkLine ? (
          <Text style={[styles.benchmarkText, benchmarkLine.error && styles.errorText]}>{benchmarkLine.text}</Text>
        ) : null}
        {/* ONE button. Manual shows "Run benchmark" until a benchmark of
            exactly the typed values succeeded, then "Save"; editing a value
            turns it back. A failed benchmark leaves "Run benchmark" to retry. */}
        {needsBenchmark ? (
          <Pressable
            style={[styles.primaryButton, (!params || benchmarking) && styles.disabled]}
            onPress={() => { void runBenchmark(); }}
            disabled={!params || benchmarking}
            accessibilityRole="button"
            accessibilityLabel="Run benchmark"
          >
            {benchmarking ? (
              <View style={styles.busyRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.primaryButtonText}>Benchmarking…</Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>Run benchmark</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryButton, !canSave && styles.disabled]}
            onPress={save}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save encryption settings"
          >
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
        )}
      </View>
    </OverlayModal>
  );
};

/** Shared danger red, the one colour the theme deliberately does not own. */
const DANGER = '#ff6b6b';

const useStyles = (colors: ThemeColors) =>
  useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.cardBackground,
          width: '92%',
          maxWidth: 520,
          maxHeight: '85%',
          borderRadius: 16,
          padding: 20,
          gap: 12,
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
        scroll: {
          flexGrow: 0,
        },
        scrollContent: {
          gap: 12,
        },
        body: {
          color: colors.textSecondary,
          fontSize: 14,
          lineHeight: 20,
        },
        emphasis: {
          color: colors.text,
          fontWeight: '600',
        },
        sectionLabel: {
          color: colors.text,
          fontSize: 16,
          fontWeight: '600',
          marginTop: 4,
        },
        option: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.overlays.tagBorder,
          backgroundColor: colors.overlays.tag,
        },
        optionSelected: {
          borderColor: colors.accent,
        },
        optionText: {
          flex: 1,
          gap: 2,
        },
        optionTitle: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
        },
        optionSummary: {
          color: colors.textSecondary,
          fontSize: 13,
          lineHeight: 18,
        },
        fieldRow: {
          flexDirection: 'row',
          gap: 8,
        },
        field: {
          flex: 1,
          gap: 4,
        },
        fieldLabel: {
          color: colors.textSecondary,
          fontSize: 13,
        },
        input: {
          backgroundColor: colors.overlays.tag,
          borderRadius: 8,
          padding: 10,
          color: colors.text,
          fontSize: 16,
          borderWidth: 1,
          borderColor: colors.overlays.tagBorder,
        },
        benchmarkText: {
          color: colors.textSecondary,
          fontSize: 13,
          lineHeight: 18,
        },
        errorText: {
          color: DANGER,
        },
        footnote: {
          color: colors.textSecondary,
          fontSize: 13,
          lineHeight: 18,
        },
        busyRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        primaryButton: {
          backgroundColor: colors.accent,
          padding: 12,
          borderRadius: 8,
          alignItems: 'center',
        },
        primaryButtonText: {
          color: '#fff',
          fontSize: 16,
          fontWeight: '600',
        },
        disabled: {
          opacity: 0.5,
        },
      }),
    [colors]
  );
