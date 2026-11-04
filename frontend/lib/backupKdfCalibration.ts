import { argon2id, hasNativeArgon2 } from '@/lib/argon2';
import { KdfParams } from '@/lib/backupCrypto';

/**
 * On-device calibration of the backup password's Argon2id cost.
 *
 * Phones differ by an order of magnitude in how fast they run Argon2id, so
 * fixed params are either too weak for a fast phone or too slow for an old one.
 * Instead, the way LUKS/cryptsetup does it: time a probe derivation (silently,
 * while the password dialog is open), then pick the strongest params that THIS
 * phone derives in about `KDF_TARGET_MS`. That is the wait after tapping
 * "Turn on encryption" / "Change password" and when restoring a backup with a
 * typed password; ordinary backups never re-derive (the key is stored, see
 * lib/backupKeyStore.ts). For scale: a current flagship phone did
 * 256 MiB x 3 passes x 4 lanes in 258 ms natively, so it lands on the
 * 128 MiB ceiling with extra passes.
 *
 * The cost model (see KdfCostModel): Argon2 time is linear in memory, with a
 * per-pass part and a fixed allocation part, fitted from two probes. Memory is
 * the expensive resource for an attacker, so it is spent first: 2 passes over
 * as much memory as the budget allows, up to the memory ceiling, and only
 * then more passes, up to the pass ceiling. The ceilings depend on the
 * user's choice in "Technical details" (lib/backupKdfProfiles.ts): the
 * default `COMPATIBILITY_CEILINGS` below, or higher ones for "Security".
 *
 * The FLOOR is OWASP's minimum Argon2id configuration (19 MiB, 2 passes). A
 * phone too slow to reach it within the target uses the floor anyway and
 * waits longer: a short wait is not worth a backup that is cheap to crack.
 */

export const KDF_TARGET_MS = 500;

/** RFC 9106's 4 lanes. Native Argon2 runs them on parallel threads (~2.5x faster than 1 lane on a real phone). */
export const KDF_PARALLELISM = 4;

/** OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2. */
export const KDF_FLOOR_PARAMS: KdfParams = {
  name: 'argon2id',
  memoryKiB: 19 * 1024,
  iterations: 2,
  parallelism: KDF_PARALLELISM,
};

/** The most memory and passes the calibration may pick. */
export interface KdfCeilings {
  memoryKiB: number;
  iterations: number;
}

/**
 * Ceilings of the default "Compatibility" mode. A fast phone gets more passes
 * beyond the memory cap rather than more memory, so its backups still open on
 * a 2-3 GB phone (128 MiB is safe to allocate there; 256 MiB on top of the
 * app risks an OS kill). Passes are capped at 6 so a phone ~10x slower than
 * the one that wrote the backup still opens it in a few seconds (a flagship
 * does 128 MiB x 6 in ~260 ms). Every mode's ceilings must stay within
 * backupCrypto's KDF_FILE_LIMITS (what a FILE may ask for), pinned by a test,
 * or a phone could write a backup it cannot read.
 */
export const MAX_CALIBRATED_MEMORY_KIB = 128 * 1024;
export const MAX_CALIBRATED_ITERATIONS = 6;
export const COMPATIBILITY_CEILINGS: KdfCeilings = {
  memoryKiB: MAX_CALIBRATED_MEMORY_KIB,
  iterations: MAX_CALIBRATED_ITERATIONS,
};
const BASE_ITERATIONS = 2;

/**
 * The probe: big enough to time reliably (native: ~20 ms on a fast phone),
 * small enough to stay quick on a slow one. The JS fallback (Expo Go only) is
 * ~300x slower, so it probes far less memory.
 */
const NATIVE_PROBE_MEMORY_KIB = 64 * 1024;
const JS_PROBE_MEMORY_KIB = 2 * 1024;
const PROBE_RUNS = 2;

/**
 * Measured cost of Argon2id on this phone, linear in memory:
 *   time(m, t) = m x (msPerKiB + t x msPerKiBPass)
 * `msPerKiB` is the per-derivation cost of allocating and first touching the
 * memory, `msPerKiBPass` the cost of each pass over it. A single-pass probe
 * cannot tell them apart and, because allocation is a big share of one pass,
 * it underestimates the speed of a multi-pass derivation ~3x (seen on device).
 */
export interface KdfCostModel {
  msPerKiB: number;
  msPerKiBPass: number;
}

export interface KdfCalibration {
  params: KdfParams;
  model: KdfCostModel;
  /** Predicted derivation time for `params` on this phone. */
  estimatedMs: number;
  /** True when the phone could not reach the floor within the target. */
  usedFloor: boolean;
}

const predictMs = (m: KdfCostModel, memoryKiB: number, iterations: number) =>
  memoryKiB * (m.msPerKiB + iterations * m.msPerKiBPass);

/**
 * Pure: the strongest params for a cost model and a time target. Memory first
 * (2 passes, as much memory as fits, whole MiB), then, at the memory cap, as
 * many passes as fit. Never weaker than the floor.
 */
export function paramsForBudget(
  model: KdfCostModel,
  targetMs: number = KDF_TARGET_MS,
  ceilings: KdfCeilings = COMPATIBILITY_CEILINGS
): KdfCalibration {
  let iterations = BASE_ITERATIONS;
  let memoryKiB =
    Math.floor(targetMs / (model.msPerKiB + iterations * model.msPerKiBPass) / 1024) * 1024;
  if (memoryKiB > ceilings.memoryKiB) {
    memoryKiB = ceilings.memoryKiB;
    const affordable = Math.floor((targetMs / memoryKiB - model.msPerKiB) / model.msPerKiBPass);
    iterations = Math.min(ceilings.iterations, Math.max(BASE_ITERATIONS, affordable));
  }

  const floorCost = KDF_FLOOR_PARAMS.memoryKiB * KDF_FLOOR_PARAMS.iterations;
  const usedFloor = memoryKiB * iterations < floorCost;
  const params: KdfParams = usedFloor
    ? { ...KDF_FLOOR_PARAMS }
    : { name: 'argon2id', memoryKiB, iterations, parallelism: KDF_PARALLELISM };

  return {
    params,
    model,
    estimatedMs: Math.round(predictMs(model, params.memoryKiB, params.iterations)),
    usedFloor,
  };
}

export interface CalibrationDeps {
  /** Monotonic clock in ms. */
  now: () => number;
  /** Run one Argon2id derivation with these params (the probe). */
  derive: (params: KdfParams) => Promise<unknown>;
  /** Probe memory in KiB (depends on native vs JS). */
  probeMemoryKiB: number;
}

const PROBE_PASSWORD = new Uint8Array(16);
const PROBE_SALT = new Uint8Array(16);

const defaultDeps = (): CalibrationDeps => ({
  now: () => performance.now(),
  derive: params => argon2id(PROBE_PASSWORD, PROBE_SALT, params),
  probeMemoryKiB: hasNativeArgon2() ? NATIVE_PROBE_MEMORY_KIB : JS_PROBE_MEMORY_KIB,
});

/** Passes of the two probes; their difference isolates the per-pass cost. */
const PROBE_SHORT_PASSES = 1;
const PROBE_LONG_PASSES = 3;

/**
 * Measure this phone and return calibrated params. Two probes at the same
 * memory, 1 and 3 passes, fit the cost model. Each runs `PROBE_RUNS` times and
 * the FASTEST run counts: interruptions (GC, other threads) only ever make a
 * run slower, so the minimum is the truest speed.
 */
export async function calibrateKdfParams(
  targetMs: number = KDF_TARGET_MS,
  deps: CalibrationDeps = defaultDeps(),
  ceilings: KdfCeilings = COMPATIBILITY_CEILINGS
): Promise<KdfCalibration> {
  const time = async (iterations: number) => {
    const probe: KdfParams = {
      name: 'argon2id',
      memoryKiB: deps.probeMemoryKiB,
      iterations,
      parallelism: KDF_PARALLELISM,
    };
    let fastest = Infinity;
    for (let i = 0; i < PROBE_RUNS; i++) {
      const start = deps.now();
      await deps.derive(probe);
      fastest = Math.min(fastest, deps.now() - start);
    }
    return Math.max(fastest, 0.01);
  };

  const short = await time(PROBE_SHORT_PASSES);
  const long = await time(PROBE_LONG_PASSES);
  const m = deps.probeMemoryKiB;
  let msPerKiBPass = (long - short) / ((PROBE_LONG_PASSES - PROBE_SHORT_PASSES) * m);
  let msPerKiB = short / m - PROBE_SHORT_PASSES * msPerKiBPass;
  if (!(msPerKiBPass > 0) || msPerKiB < 0) {
    // Timer noise made the probes inconsistent: fall back to the conservative
    // all-per-pass model of the long probe (overestimates time, never underestimates).
    msPerKiBPass = long / (PROBE_LONG_PASSES * m);
    msPerKiB = 0;
  }
  return paramsForBudget({ msPerKiB, msPerKiBPass }, targetMs, ceilings);
}
