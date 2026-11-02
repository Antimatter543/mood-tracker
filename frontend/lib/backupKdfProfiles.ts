import { argon2id } from '@/lib/argon2';
import { KDF_FILE_LIMITS, KdfParams } from '@/lib/backupCrypto';
import {
  COMPATIBILITY_CEILINGS,
  KDF_FLOOR_PARAMS,
  KDF_TARGET_MS,
  KdfCeilings,
} from '@/lib/backupKdfCalibration';

/**
 * The three strength modes under "Encrypt backups" > "Technical details".
 *
 *  - `compatibility` (default): the on-device calibration within
 *    COMPATIBILITY_CEILINGS (128 MiB, 6 passes), so a backup made on a fast
 *    phone still opens on a budget one.
 *  - `security`: the same ~500 ms calibration without those caps. Only the
 *    file limits (what any backup may ask for) and this phone's RAM bound it.
 *  - `manual`: the user picks the Argon2id params and must benchmark them on
 *    this phone before saving.
 *
 * The mode is stored next to the key (lib/backupKeyStore.ts), so a password
 * change keeps it. Backup files only carry the params, never the mode: any
 * phone can open any backup whose params it can afford.
 */

export type KdfProfile = 'compatibility' | 'security' | 'manual';

export const DEFAULT_KDF_PROFILE: KdfProfile = 'compatibility';

export const KDF_PROFILES: Record<KdfProfile, { title: string; summary: string }> = {
  compatibility: {
    title: 'Compatibility (default)',
    summary: 'Backups open on any phone, including budget ones. Easier to crack than Security.',
  },
  security: {
    title: 'Security',
    summary:
      'Uses as much of this phone as possible while staying quick. Much harder to crack, but backups may not open on weaker phones.',
  },
  manual: {
    title: 'Manual',
    summary: 'Choose the settings yourself and test them on this phone before saving.',
  },
};

export function isKdfProfile(value: unknown): value is KdfProfile {
  return value === 'compatibility' || value === 'security' || value === 'manual';
}

/**
 * Share of this phone's RAM that "Security" may hand to Argon2. Native Argon2
 * allocates outside the JS heap, and Android's low-memory killer looks at the
 * whole process, so a fraction of total RAM leaves room for the app and the
 * system (12 GB phone: 1.5 GB, i.e. the 1 GiB file limit; 4 GB: 512 MiB).
 */
const SECURITY_RAM_SHARE = 1 / 8;

/**
 * Pure: the calibration ceilings for an automatic mode. `totalMemoryBytes` is
 * this phone's RAM (expo-device), `null` when unknown.
 */
export function ceilingsForProfile(
  profile: Exclude<KdfProfile, 'manual'>,
  totalMemoryBytes: number | null
): KdfCeilings {
  if (profile === 'compatibility') return COMPATIBILITY_CEILINGS;
  let memoryKiB: number = KDF_FILE_LIMITS.maxMemoryKiB;
  if (totalMemoryBytes && totalMemoryBytes > 0) {
    const ramShareKiB = Math.floor((totalMemoryBytes * SECURITY_RAM_SHARE) / 1024 / 1024) * 1024;
    memoryKiB = Math.min(memoryKiB, Math.max(COMPATIBILITY_CEILINGS.memoryKiB, ramShareKiB));
  }
  return { memoryKiB, iterations: KDF_FILE_LIMITS.maxIterations };
}

/** This phone's RAM in bytes, or `null` when the platform does not say. */
export function deviceTotalMemory(): number | null {
  try {
    // Loaded here, not at the top: some test environments have no native
    // ExpoDevice module, and importing it at the top would fail every module
    // that reaches the key store (same reason as expo-constants in lib/argon2.ts).
    const { totalMemory } = require('expo-device') as typeof import('expo-device');
    return typeof totalMemory === 'number' && totalMemory > 0 ? totalMemory : null;
  } catch {
    return null;
  }
}

/** What "Manual" accepts. Upper bounds are the file limits, so any phone can at least try. */
export const MANUAL_KDF_LIMITS = {
  minMemoryMiB: KDF_FLOOR_PARAMS.memoryKiB / 1024,
  maxMemoryMiB: KDF_FILE_LIMITS.maxMemoryKiB / 1024,
  minIterations: 1,
  maxIterations: KDF_FILE_LIMITS.maxIterations,
  minParallelism: 1,
  maxParallelism: KDF_FILE_LIMITS.maxParallelism,
} as const;

/** The manual form's fields: whole MiB, passes and lanes. */
export interface ManualKdfInput {
  memoryMiB: number;
  iterations: number;
  parallelism: number;
}

export function manualParams(input: ManualKdfInput): KdfParams {
  return {
    name: 'argon2id',
    memoryKiB: input.memoryMiB * 1024,
    iterations: input.iterations,
    parallelism: input.parallelism,
  };
}

/**
 * Validation message for manual params, or `null` when they are acceptable:
 * whole numbers within MANUAL_KDF_LIMITS and never cheaper than OWASP's
 * minimum (19 MiB x 2 passes; 38 MiB x 1 pass counts the same).
 */
export function validateManualKdf(input: ManualKdfInput): string | null {
  const L = MANUAL_KDF_LIMITS;
  const whole = (n: number) => Number.isInteger(n);
  if (!whole(input.memoryMiB) || input.memoryMiB < L.minMemoryMiB || input.memoryMiB > L.maxMemoryMiB) {
    return `Memory must be a whole number from ${L.minMemoryMiB} to ${L.maxMemoryMiB} MiB.`;
  }
  if (!whole(input.iterations) || input.iterations < L.minIterations || input.iterations > L.maxIterations) {
    return `Passes must be a whole number from ${L.minIterations} to ${L.maxIterations}.`;
  }
  if (!whole(input.parallelism) || input.parallelism < L.minParallelism || input.parallelism > L.maxParallelism) {
    return `Lanes must be a whole number from ${L.minParallelism} to ${L.maxParallelism}.`;
  }
  const floorCost = KDF_FLOOR_PARAMS.memoryKiB * KDF_FLOOR_PARAMS.iterations;
  if (input.memoryMiB * 1024 * input.iterations < floorCost) {
    return 'Below the recommended minimum (19 MiB × 2 passes). Use more memory or passes.';
  }
  return null;
}

/** Above this, saving manual params needs an explicit confirmation. */
export const MANUAL_CONFIRM_ABOVE_MS = KDF_TARGET_MS;

export type KdfBenchmarkResult =
  | { ok: true; params: KdfParams; ms: number }
  | { ok: false; params: KdfParams; error: string };

export interface BenchmarkDeps {
  now: () => number;
  derive: (params: KdfParams) => Promise<unknown>;
}

const BENCH_PASSWORD = new Uint8Array(16);
const BENCH_SALT = new Uint8Array(16);

const defaultBenchmarkDeps = (): BenchmarkDeps => ({
  now: () => performance.now(),
  derive: params => argon2id(BENCH_PASSWORD, BENCH_SALT, params),
});

/**
 * Time ONE derivation with exactly these params on this phone: the wait the
 * user would get when changing the password or restoring. Never throws: a
 * failure (for example memory this phone cannot allocate) is a result.
 */
export async function benchmarkKdf(
  params: KdfParams,
  deps: BenchmarkDeps = defaultBenchmarkDeps()
): Promise<KdfBenchmarkResult> {
  const start = deps.now();
  try {
    await deps.derive(params);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    return { ok: false, params, error: message };
  }
  return { ok: true, params, ms: Math.round(deps.now() - start) };
}

/** Same params? (A benchmark only counts for exactly the params it ran.) */
export function sameParams(a: KdfParams, b: KdfParams): boolean {
  return a.memoryKiB === b.memoryKiB && a.iterations === b.iterations && a.parallelism === b.parallelism;
}

/**
 * Does a backup file ask for more than Compatibility ever writes? Restore
 * warns before deriving such a key: on a phone with less memory it may
 * freeze or crash the app, and a crafted file could use that on purpose.
 */
export function exceedsCompatibility(kdf: KdfParams): boolean {
  return kdf.memoryKiB > COMPATIBILITY_CEILINGS.memoryKiB || kdf.iterations > COMPATIBILITY_CEILINGS.iterations;
}
