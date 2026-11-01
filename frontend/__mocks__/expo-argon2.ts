/**
 * expo-argon2 for jest: REAL Argon2id via @noble/hashes. On a real phone the
 * native module and @noble produce byte-identical keys (cross-checked on
 * device, 2026-11-01), so this stands in faithfully. `calls` records the
 * options each hash was asked for, so tests can assert the param mapping.
 * Plain functions, not jest.fn, so jest.resetAllMocks() cannot wipe them.
 */
import { argon2id } from '@noble/hashes/argon2.js';

export const calls: Record<string, unknown>[] = [];

export async function hashAsync(
  password: Uint8Array,
  salt: Uint8Array,
  options: { memoryCost: number; timeCost: number; parallelism: number; hashLength: number; type: string }
) {
  calls.push(options);
  const raw = argon2id(password, salt, {
    m: options.memoryCost,
    t: options.timeCost,
    p: options.parallelism,
    dkLen: options.hashLength,
  });
  return { raw, hex: '', encoded: '' };
}
