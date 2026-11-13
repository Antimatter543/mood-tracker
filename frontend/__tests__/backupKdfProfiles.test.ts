/**
 * Strength modes for backup encryption (lib/backupKdfProfiles.ts).
 *
 * What this locks:
 *  - Compatibility keeps the 128 MiB / 6-pass ceilings; Security lifts them to
 *    the file limits, bounded by an eighth of this phone's RAM (never below
 *    Compatibility).
 *  - Every mode can only write what every phone's file check accepts: the
 *    Security ceilings and the Manual limits sit within KDF_FILE_LIMITS, and
 *    calibrated Security params pass the envelope validator.
 *  - Manual input: whole numbers in range, never cheaper than OWASP's minimum.
 *  - The benchmark times one derivation with exactly the given params and
 *    reports a failure instead of throwing.
 */
import { KDF_FILE_LIMITS, KdfParams, isValidKdfHeader } from '@/lib/backupCrypto';
import { COMPATIBILITY_CEILINGS, paramsForBudget } from '@/lib/backupKdfCalibration';
import {
  KDF_PROFILES,
  MANUAL_KDF_LIMITS,
  benchmarkKdf,
  ceilingsForProfile,
  exceedsCompatibility,
  isKdfProfile,
  manualParams,
  sameParams,
  validateManualKdf,
  formatDuration,
  keepRestoredEncryptionMessage,
  profileForAdoptedParams,
  adoptableParams,
} from '@/lib/backupKdfProfiles';

const MiB = 1024;
const GB = 1024 ** 3;

describe('ceilingsForProfile', () => {
  it('Compatibility keeps 128 MiB and 6 passes, whatever the phone', () => {
    expect(ceilingsForProfile('compatibility', 12 * GB)).toEqual({ memoryKiB: 128 * MiB, iterations: 6 });
    expect(ceilingsForProfile('compatibility', null)).toBe(COMPATIBILITY_CEILINGS);
  });

  it('Security goes up to the file limits on a phone with plenty of RAM', () => {
    expect(ceilingsForProfile('security', 12 * GB)).toEqual({
      memoryKiB: KDF_FILE_LIMITS.maxMemoryKiB,
      iterations: KDF_FILE_LIMITS.maxIterations,
    });
  });

  it('Security uses at most an eighth of RAM, but never less than Compatibility', () => {
    expect(ceilingsForProfile('security', 4 * GB).memoryKiB).toBe(512 * MiB);
    expect(ceilingsForProfile('security', 1 * GB).memoryKiB).toBe(128 * MiB);
  });

  it('Security falls back to the file limit when RAM is unknown', () => {
    expect(ceilingsForProfile('security', null).memoryKiB).toBe(KDF_FILE_LIMITS.maxMemoryKiB);
  });

  it('calibrated Security params always pass the file check, across phone speeds', () => {
    const ceilings = ceilingsForProfile('security', 16 * GB);
    for (const rate of [5, 50, 500, 5_000, 50_000, 500_000, 5_000_000]) {
      const { params } = paramsForBudget({ msPerKiB: 0, msPerKiBPass: 1 / rate }, 500, ceilings);
      expect(isValidKdfHeader({ ...params, salt: 'AAAA' })).toBe(true);
    }
  });
});

describe('Manual limits', () => {
  it('sit within the file limits, so a Manual backup opens anywhere it can be afforded', () => {
    expect(MANUAL_KDF_LIMITS.maxMemoryMiB * MiB).toBeLessThanOrEqual(KDF_FILE_LIMITS.maxMemoryKiB);
    expect(MANUAL_KDF_LIMITS.maxIterations).toBeLessThanOrEqual(KDF_FILE_LIMITS.maxIterations);
    expect(MANUAL_KDF_LIMITS.maxParallelism).toBeLessThanOrEqual(KDF_FILE_LIMITS.maxParallelism);
    const most = manualParams({
      memoryMiB: MANUAL_KDF_LIMITS.maxMemoryMiB,
      iterations: MANUAL_KDF_LIMITS.maxIterations,
      parallelism: MANUAL_KDF_LIMITS.maxParallelism,
    });
    expect(isValidKdfHeader({ ...most, salt: 'AAAA' })).toBe(true);
  });
});

describe('validateManualKdf', () => {
  const ok = { memoryMiB: 64, iterations: 3, parallelism: 4 };

  it('accepts sensible params', () => {
    expect(validateManualKdf(ok)).toBeNull();
    expect(validateManualKdf({ memoryMiB: 19, iterations: 2, parallelism: 1 })).toBeNull(); // OWASP's minimum
    expect(validateManualKdf({ memoryMiB: 46, iterations: 1, parallelism: 1 })).toBeNull(); // OWASP's one-pass minimum
  });

  it.each([
    [{ ...ok, memoryMiB: NaN }, /Memory/],
    [{ ...ok, memoryMiB: 1.5 }, /Memory/],
    [{ ...ok, memoryMiB: 18 }, /Memory/],
    [{ ...ok, memoryMiB: 1025 }, /Memory/],
    [{ ...ok, iterations: 0 }, /Passes/],
    [{ ...ok, iterations: 21 }, /Passes/],
    [{ ...ok, parallelism: 0 }, /Lanes/],
    [{ ...ok, parallelism: 9 }, /Lanes/],
    [{ memoryMiB: 19, iterations: 1, parallelism: 4 }, /recommended minimum/],
    [{ memoryMiB: 38, iterations: 1, parallelism: 4 }, /recommended minimum/],
    [{ memoryMiB: 45, iterations: 1, parallelism: 4 }, /recommended minimum/],
  ])('rejects %j', (input, message) => {
    expect(validateManualKdf(input)).toMatch(message);
  });

  it('turns MiB into KiB', () => {
    expect(manualParams(ok)).toEqual({ name: 'argon2id', memoryKiB: 64 * MiB, iterations: 3, parallelism: 4 });
  });
});

describe('benchmarkKdf', () => {
  const params: KdfParams = { name: 'argon2id', memoryKiB: 64 * MiB, iterations: 3, parallelism: 4 };

  it('times one derivation with exactly the given params', async () => {
    const times = [1000, 1312.4];
    const derive = jest.fn(async () => undefined);
    const result = await benchmarkKdf(params, { now: () => times.shift()!, derive });
    expect(derive).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledWith(params);
    expect(result).toEqual({ ok: true, params, ms: 312 });
  });

  it('reports a failed derivation instead of throwing', async () => {
    const derive = jest.fn(async () => { throw new Error('Out of memory'); });
    const result = await benchmarkKdf(params, { now: () => 0, derive });
    expect(result).toEqual({ ok: false, params, error: 'Out of memory' });
  });

  it('only counts for the same params', () => {
    expect(sameParams(params, { ...params })).toBe(true);
    expect(sameParams(params, { ...params, iterations: 4 })).toBe(false);
  });
});

describe('profiles', () => {
  it('has the three modes, each with a summary', () => {
    expect(Object.keys(KDF_PROFILES)).toEqual(['compatibility', 'security', 'manual']);
    for (const p of Object.values(KDF_PROFILES)) {
      expect(p.summary.length).toBeGreaterThan(20);
      // Plain language: the direction, no numbers.
      expect(p.summary).not.toMatch(/\d/);
    }
    expect(isKdfProfile('security')).toBe(true);
    expect(isKdfProfile('paranoid')).toBe(false);
  });
});

describe('exceedsCompatibility', () => {
  const kdf = (memoryMiB: number, iterations: number): KdfParams =>
    ({ name: 'argon2id', memoryKiB: memoryMiB * MiB, iterations, parallelism: 4 });

  it('is false up to the Compatibility ceilings, true above either', () => {
    expect(exceedsCompatibility(kdf(128, 6))).toBe(false);
    expect(exceedsCompatibility(kdf(19, 2))).toBe(false);
    expect(exceedsCompatibility(kdf(129, 2))).toBe(true);
    expect(exceedsCompatibility(kdf(64, 7))).toBe(true);
  });
});

describe('taking over a restored backup', () => {
  const standard = { name: 'argon2id', memoryKiB: 64 * 1024, iterations: 3, parallelism: 4 } as const;
  const strong = { name: 'argon2id', memoryKiB: 256 * 1024, iterations: 2, parallelism: 4 } as const;

  it('keeps params within Compatibility as Compatibility, stronger ones as Manual', () => {
    expect(profileForAdoptedParams(standard)).toBe('compatibility');
    expect(profileForAdoptedParams(strong)).toBe('manual');
  });

  it('formats the unlock time in ms, then seconds', () => {
    expect(formatDuration(0.2)).toBe('1 ms');
    expect(formatDuration(699.6)).toBe('700 ms');
    expect(formatDuration(1234)).toBe('1.2 s');
  });

  it('names the protection and the time in plain words', () => {
    expect(keepRestoredEncryptionMessage(strong, 700)).toBe(
      "The backup's password has strong protection: unlocking it took 700 ms on this phone.\n\n" +
        'Keep this password and protection for new backups?'
    );
    expect(keepRestoredEncryptionMessage(standard, 300)).toMatch(/^The backup's password has standard protection/);
  });

  it('adopts only params this app would write (OWASP minimum, whole MiB)', () => {
    expect(adoptableParams(standard)).toEqual(standard);
    expect(adoptableParams(strong)).toEqual(strong);
    expect(adoptableParams({ name: 'argon2id', memoryKiB: 19 * 1024, iterations: 2, parallelism: 4 })).not.toBeNull();
    // What a crafted file may say: valid for a FILE, weaker than any writer.
    expect(adoptableParams({ name: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 })).toBeNull();
    expect(adoptableParams({ name: 'argon2id', memoryKiB: 8, iterations: 7, parallelism: 1 })).toBeNull();
    expect(adoptableParams({ name: 'argon2id', memoryKiB: 32 * 1024, iterations: 1, parallelism: 4 })).toBeNull();
  });

  it('never calls weak params strong', () => {
    expect(keepRestoredEncryptionMessage({ name: 'argon2id', memoryKiB: 8, iterations: 7, parallelism: 1 }, 1)).toBe(
      'Keep encrypting new backups with this password?'
    );
  });
});
