/**
 * lib/argon2.ts: native expo-argon2 in real builds, @noble only where the
 * native module is missing (Expo Go, where importing expo-argon2 throws).
 *
 * What this locks:
 *  - The native module is used when present, with the params mapped 1:1
 *    (a swapped memory/time field would silently weaken every backup).
 *  - When the native module cannot be loaded, the JS fallback derives the
 *    SAME key, so backups stay portable between builds.
 */
import { argon2id as nobleArgon2id } from '@noble/hashes/argon2.js';

import type { KdfParams } from '@/lib/backupCrypto';

const PARAMS: KdfParams = { name: 'argon2id', memoryKiB: 1024, iterations: 2, parallelism: 4 };
const PW = new Uint8Array([1, 2, 3]);
const SALT = new Uint8Array(16).fill(9);
const expected = () => nobleArgon2id(PW, SALT, { m: 1024, t: 2, p: 4, dkLen: 32 });

beforeEach(() => {
  jest.resetModules();
});

it('uses the native module when it is available, mapping params 1:1', async () => {
  const native = require('expo-argon2');
  native.calls.length = 0;
  const { argon2id, hasNativeArgon2 } = require('@/lib/argon2');

  const key = await argon2id(PW, SALT, PARAMS);

  expect(hasNativeArgon2()).toBe(true);
  expect(native.calls).toEqual([
    { type: 'argon2id', memoryCost: 1024, timeCost: 2, parallelism: 4, hashLength: 32 },
  ]);
  expect(Buffer.from(key).equals(Buffer.from(expected()))).toBe(true);
});

it('falls back to JS with an identical key when the native module is missing (Expo Go)', async () => {
  jest.doMock('expo-argon2', () => {
    throw new Error("Cannot find native module 'ExpoArgon2'");
  });
  const { argon2id, hasNativeArgon2 } = require('@/lib/argon2');

  const key = await argon2id(PW, SALT, PARAMS);

  expect(hasNativeArgon2()).toBe(false);
  expect(Buffer.from(key).equals(Buffer.from(expected()))).toBe(true);
});
