import { argon2idAsync } from '@noble/hashes/argon2.js';

import type { KdfParams } from '@/lib/backupCrypto';

/**
 * Argon2id for backup passwords: NATIVE (expo-argon2, the reference C
 * implementation via argon2kt / Argon2Swift) in every real build, with a
 * pure-JS fallback (@noble/hashes) only where the native module is absent,
 * i.e. Expo Go, so the Go iteration loop keeps working.
 *
 * Why native, measured on a real phone (a current flagship, release build,
 * 2026-11-01): native Argon2id did 64 MiB x 3 passes x 4 lanes in 67 ms and
 * 256 MiB x 3 x 4 in 258 ms, its lanes on parallel threads. The JS version
 * runs interpreted on Hermes (no JIT) at ~7 MiB-passes/s, roughly 300x
 * slower: a 500 ms budget buys ~1 MiB x 3, so JS is not a usable production
 * path. Both produce byte-identical keys (cross-checked on that phone), so a
 * backup made by either opens with the other.
 */

interface NativeArgon2 {
  hashAsync(
    password: Uint8Array,
    salt: Uint8Array,
    options: { type: 'argon2id'; memoryCost: number; timeCost: number; parallelism: number; hashLength: number }
  ): Promise<{ raw: Uint8Array }>;
}

// expo-argon2's entry calls requireNativeModule at import time, which throws
// where the native module is not linked (Expo Go). Resolve it once, lazily.
let nativeModule: NativeArgon2 | null | undefined;
function getNative(): NativeArgon2 | null {
  if (nativeModule === undefined) {
    try {
      nativeModule = require('expo-argon2') as NativeArgon2;
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

/** True when the fast native implementation is available (any real build). */
export function hasNativeArgon2(): boolean {
  return getNative() !== null;
}

/** Derive `dkLen` bytes with Argon2id (v1.3). */
export async function argon2id(
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams,
  dkLen = 32
): Promise<Uint8Array> {
  const native = getNative();
  if (native) {
    const result = await native.hashAsync(password, salt, {
      type: 'argon2id',
      memoryCost: params.memoryKiB,
      timeCost: params.iterations,
      parallelism: params.parallelism,
      hashLength: dkLen,
    });
    return new Uint8Array(result.raw);
  }
  return argon2idAsync(password, salt, {
    m: params.memoryKiB,
    t: params.iterations,
    p: params.parallelism,
    dkLen,
    // Above any memory a file may request (backupCrypto's MAX_MEMORY_KIB).
    maxmem: 2 ** 31,
  });
}

/** Test seam: forget the resolved module so a test can swap it. */
export function __resetArgon2ForTests(): void {
  nativeModule = undefined;
}
