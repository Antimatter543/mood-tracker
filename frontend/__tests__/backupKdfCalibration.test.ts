/**
 * On-device Argon2id calibration (lib/backupKdfCalibration.ts).
 *
 * What this locks:
 *  - The params fit the time budget on the measured phone (memory first, then
 *    passes), across the whole range from very slow to very fast phones.
 *  - They NEVER drop below the OWASP floor, even when that overruns the budget.
 *  - They always pass the envelope validator, so a backup made on any phone
 *    can be opened on any other (the class-level invariant, swept over speeds).
 *  - The probe takes the FASTEST of its runs and times with the injected clock.
 */
import {
  ENCRYPTED_BACKUP_FORMAT,
  KdfParams,
  assertSupportedEnvelope,
} from '@/lib/backupCrypto';
import {
  KDF_FLOOR_PARAMS,
  KDF_PARALLELISM,
  KDF_TARGET_MS,
  MAX_CALIBRATED_MEMORY_KIB,
  calibrateKdfParams,
  paramsForBudget,
} from '@/lib/backupKdfCalibration';

const MiB = 1024;
const cost = (p: KdfParams) => p.memoryKiB * p.iterations;

describe('KDF floor', () => {
  it('is at least the OWASP Argon2id minimum (19 MiB, 2 passes)', () => {
    expect(KDF_FLOOR_PARAMS.name).toBe('argon2id');
    expect(KDF_FLOOR_PARAMS.memoryKiB).toBeGreaterThanOrEqual(19 * MiB);
    expect(KDF_FLOOR_PARAMS.iterations).toBeGreaterThanOrEqual(2);
  });

  it('targets half a second with 4 lanes', () => {
    expect(KDF_PARALLELISM).toBe(4);
    expect(KDF_TARGET_MS).toBe(500);
  });
});

/** A model with no allocation cost: `rate` KiB-passes per ms. */
const perPassOnly = (rate: number) => ({ msPerKiB: 0, msPerKiBPass: 1 / rate });

describe('paramsForBudget', () => {
  it('spends a mid-range budget on memory at 2 passes', () => {
    // 200 KiB-passes/ms x 500 ms = 100000 KiB-passes => floor(50000 / 1024) = 48 MiB x 2
    const c = paramsForBudget(perPassOnly(200));
    expect(c.params).toEqual({ name: 'argon2id', memoryKiB: 48 * MiB, iterations: 2, parallelism: KDF_PARALLELISM });
    expect(c.usedFloor).toBe(false);
    expect(c.estimatedMs).toBe(492);
  });

  it('budgets for the allocation cost too, not just the passes', () => {
    // 1/400 ms per KiB to allocate + 2 x 1/400 per pass => 500 / (3/400) = 66666 KiB => 65 MiB
    const c = paramsForBudget({ msPerKiB: 1 / 400, msPerKiBPass: 1 / 400 });
    expect(c.params.memoryKiB).toBe(65 * MiB);
    expect(c.estimatedMs).toBeLessThanOrEqual(KDF_TARGET_MS);
  });

  it('caps memory on a very fast phone and adds passes instead', () => {
    // 2000 KiB-passes/ms => 256 MiB costs 131 ms per pass => 3 passes fit
    const c = paramsForBudget(perPassOnly(2000));
    expect(c.params.memoryKiB).toBe(MAX_CALIBRATED_MEMORY_KIB);
    expect(c.params.iterations).toBe(3);
  });

  it('matches a real phone: a current flagship, 256 MiB x 3 x 4 lanes in 258 ms', () => {
    // Fitted from that phone's numbers: 64 MiB x 3 = 67 ms, 256 MiB x 3 = 258 ms.
    const c = paramsForBudget(perPassOnly((256 * MiB * 3) / 258));
    expect(c.params).toMatchObject({ memoryKiB: 256 * MiB, iterations: 5 });
    expect(c.estimatedMs).toBeLessThanOrEqual(KDF_TARGET_MS);
  });

  it('uses the floor on a phone too slow to reach it in time, and says so', () => {
    const c = paramsForBudget(perPassOnly(20)); // 500 ms buys only ~10 MiB-passes
    expect(c.params).toEqual(KDF_FLOOR_PARAMS);
    expect(c.usedFloor).toBe(true);
    expect(c.estimatedMs).toBeGreaterThan(KDF_TARGET_MS);
  });

  // Class-level invariant over the whole range a phone could measure.
  const models = [0.5, 5, 20, 50, 77.8, 100, 150, 400, 1000, 3048, 5000, 1e6].flatMap(rate => [
    perPassOnly(rate),
    { msPerKiB: 1 / rate, msPerKiBPass: 1 / rate },
  ]);
  it.each(models)('%p: within budget or at the floor, never weaker, always openable', model => {
    const c = paramsForBudget(model);
    expect(cost(c.params)).toBeGreaterThanOrEqual(cost(KDF_FLOOR_PARAMS));
    if (!c.usedFloor) {
      expect(c.estimatedMs).toBeLessThanOrEqual(KDF_TARGET_MS);
      expect(c.params.memoryKiB % MiB).toBe(0);
    }
    expect(c.params.memoryKiB).toBeLessThanOrEqual(MAX_CALIBRATED_MEMORY_KIB);
    expect(() =>
      assertSupportedEnvelope({
        format: ENCRYPTED_BACKUP_FORMAT,
        version: 1,
        _note: '',
        kdf: { ...c.params, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
        cipher: 'aes-256-gcm',
        payload: '',
      })
    ).not.toThrow();
  });
});

/** Fake deps: each probe "takes" the next duration from the list. */
function fakeDeps(durations: number[]) {
  let clock = 0;
  let run = 0;
  const probes: KdfParams[] = [];
  return {
    probes,
    deps: {
      probeMemoryKiB: 8 * MiB,
      now: () => clock,
      derive: async (params: KdfParams) => {
        probes.push(params);
        clock += durations[run++];
      },
    },
  };
}

describe('calibrateKdfParams', () => {
  it('fits allocation and per-pass cost from a 1-pass and a 3-pass probe, fastest run each', async () => {
    // 1 pass: 80 then 64 ms; 3 passes: 170 then 160 ms (8 MiB).
    // per pass = (160 - 64) / (2 x 8192) KiB; allocation = 64/8192 - per pass.
    const { deps, probes } = fakeDeps([80, 64, 170, 160]);
    const c = await calibrateKdfParams(500, deps);
    expect(probes.map(p => [p.memoryKiB, p.iterations])).toEqual([
      [8 * MiB, 1], [8 * MiB, 1], [8 * MiB, 3], [8 * MiB, 3],
    ]);
    expect(c.model.msPerKiBPass).toBeCloseTo(96 / (2 * 8192), 10);
    expect(c.model.msPerKiB).toBeCloseTo(64 / 8192 - 96 / (2 * 8192), 10);
    // 500 / (alloc + 2 x per pass) = 36571 KiB => 35 MiB x 2
    expect(c.params).toMatchObject({ memoryKiB: 35 * MiB, iterations: 2 });
  });

  it('falls back to a conservative model when timer noise makes the probes inconsistent', async () => {
    const { deps } = fakeDeps([100, 100, 90, 90]); // 3 passes "faster" than 1
    const c = await calibrateKdfParams(500, deps);
    expect(c.model).toEqual({ msPerKiB: 0, msPerKiBPass: 90 / (3 * 8 * MiB) });
  });

  it('runs real (tiny-budget) probes end to end through the native adapter', async () => {
    const c = await calibrateKdfParams(1);
    expect(c.model.msPerKiBPass).toBeGreaterThan(0);
    expect(c.params.memoryKiB).toBeGreaterThanOrEqual(KDF_FLOOR_PARAMS.memoryKiB);
  });
});
