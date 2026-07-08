/**
 * __tests__/healthConnect.test.ts
 *
 * Foundation tests for the Health Connect data layer.
 *
 *  - The PURE helpers (lib/healthConnectPure) are tested directly with NO mock —
 *    they have zero runtime deps (type-only imports).
 *  - The native layer (lib/healthConnect) is tested for its non-Android guard
 *    (no mock needed — it returns before touching the native module) and its
 *    Android wiring (mocking react-native + react-native-health-connect inside
 *    an isolated module registry). No physical device / native build required.
 */

import {
  aggregateHealthByDay,
  averageBpm,
  computeSyncWindow,
  durationMinutes,
  hasRequiredReadAccess,
  minBpm,
  REQUIRED_READ_RECORD_TYPES,
  sleepDurationMinutes,
  sleepSessionWakeDay,
  sleepStageMinutes,
  totalSleepMinutes,
} from '../lib/healthConnectPure';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('averageBpm', () => {
  it('returns null on no records', () => {
    expect(averageBpm([])).toBeNull();
  });

  it('returns null when records have no samples', () => {
    expect(averageBpm([{ samples: [] }, { samples: [] }])).toBeNull();
  });

  it('averages a single sample', () => {
    expect(averageBpm([{ samples: [{ beatsPerMinute: 72 }] }])).toBe(72);
  });

  it('averages multiple samples within one record', () => {
    expect(
      averageBpm([
        { samples: [{ beatsPerMinute: 60 }, { beatsPerMinute: 80 }] },
      ])
    ).toBe(70);
  });

  it('averages across multiple records (flattening samples)', () => {
    expect(
      averageBpm([
        { samples: [{ beatsPerMinute: 60 }, { beatsPerMinute: 70 }] },
        { samples: [{ beatsPerMinute: 80 }] },
      ])
    ).toBe(70);
  });

  it('skips non-finite samples rather than poisoning the mean', () => {
    expect(
      averageBpm([
        {
          samples: [
            { beatsPerMinute: 60 },
            { beatsPerMinute: Number.NaN },
            { beatsPerMinute: Number.POSITIVE_INFINITY },
            { beatsPerMinute: 80 },
          ],
        },
      ])
    ).toBe(70);
  });
});

describe('durationMinutes / sleepDurationMinutes', () => {
  it('computes minutes between start and end', () => {
    expect(
      durationMinutes({
        startTime: '2026-07-06T22:00:00.000Z',
        endTime: '2026-07-07T06:00:00.000Z',
      })
    ).toBe(480); // 8h
  });

  it('handles sub-hour precision', () => {
    expect(
      durationMinutes({
        startTime: '2026-07-07T00:00:00.000Z',
        endTime: '2026-07-07T00:30:00.000Z',
      })
    ).toBe(30);
  });

  it('is exposed as sleepDurationMinutes (same function)', () => {
    expect(sleepDurationMinutes).toBe(durationMinutes);
  });

  it('returns 0 when end is not after start', () => {
    expect(
      durationMinutes({
        startTime: '2026-07-07T06:00:00.000Z',
        endTime: '2026-07-07T06:00:00.000Z',
      })
    ).toBe(0);
    expect(
      durationMinutes({
        startTime: '2026-07-07T06:00:00.000Z',
        endTime: '2026-07-07T05:00:00.000Z',
      })
    ).toBe(0);
  });

  it('returns 0 on unparseable dates', () => {
    expect(
      durationMinutes({ startTime: 'not-a-date', endTime: 'also-bad' })
    ).toBe(0);
  });
});

describe('totalSleepMinutes', () => {
  it('is 0 for no sessions', () => {
    expect(totalSleepMinutes([])).toBe(0);
  });

  it('sums session durations', () => {
    expect(
      totalSleepMinutes([
        {
          startTime: '2026-07-06T22:00:00.000Z',
          endTime: '2026-07-07T04:00:00.000Z',
        }, // 6h = 360
        {
          startTime: '2026-07-07T13:00:00.000Z',
          endTime: '2026-07-07T13:30:00.000Z',
        }, // 30m
      ])
    ).toBe(390);
  });
});

describe('sleepStageMinutes', () => {
  it('returns an empty map when there are no stages', () => {
    expect(sleepStageMinutes({})).toEqual({});
    expect(sleepStageMinutes({ stages: [] })).toEqual({});
  });

  it('rolls up minutes per numeric stage type', () => {
    // 4 = LIGHT, 5 = DEEP, 6 = REM (library SleepStageType constants)
    const rollup = sleepStageMinutes({
      stages: [
        {
          stage: 4,
          startTime: '2026-07-07T00:00:00.000Z',
          endTime: '2026-07-07T00:30:00.000Z',
        }, // 30
        {
          stage: 5,
          startTime: '2026-07-07T00:30:00.000Z',
          endTime: '2026-07-07T01:30:00.000Z',
        }, // 60
        {
          stage: 4,
          startTime: '2026-07-07T01:30:00.000Z',
          endTime: '2026-07-07T01:45:00.000Z',
        }, // +15 -> 45
        {
          stage: 6,
          startTime: '2026-07-07T01:45:00.000Z',
          endTime: '2026-07-07T02:00:00.000Z',
        }, // 15
      ],
    });
    expect(rollup).toEqual({ 4: 45, 5: 60, 6: 15 });
  });
});

describe('hasRequiredReadAccess', () => {
  it('requires a read grant for every required record type', () => {
    expect(REQUIRED_READ_RECORD_TYPES).toEqual(['SleepSession', 'HeartRate']);
  });

  it('is true when both required reads are granted', () => {
    expect(
      hasRequiredReadAccess([
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'HeartRate' },
      ])
    ).toBe(true);
  });

  it('is false when a required read is missing', () => {
    expect(
      hasRequiredReadAccess([
        { accessType: 'read', recordType: 'SleepSession' },
      ])
    ).toBe(false);
  });

  it('ignores write grants for the same record type', () => {
    expect(
      hasRequiredReadAccess([
        { accessType: 'write', recordType: 'SleepSession' },
        { accessType: 'write', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'HeartRate' },
      ])
    ).toBe(false);
  });
});

// ─── Native layer: load lib/healthConnect with a mocked platform + module ─────

type HealthConnectApi = typeof import('../lib/healthConnect');

/**
 * Load lib/healthConnect inside an isolated module registry with `react-native`
 * (Platform) — and optionally `react-native-health-connect` — mocked, then run
 * assertions against it. Everything runs INSIDE the isolate block so the lazy
 * native require resolves against the mock.
 */
async function withHealthConnect(
  platformOS: string,
  hcMock: Record<string, unknown> | null,
  run: (mod: HealthConnectApi) => Promise<void>
): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    jest.doMock('react-native', () => ({
      Platform: {
        OS: platformOS,
        select: (spec: Record<string, unknown>) =>
          spec[platformOS] ?? spec.default,
      },
    }));
    if (hcMock) {
      jest.doMock('react-native-health-connect', () => hcMock);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolated require picks up the doMocks above
    const mod = require('../lib/healthConnect') as HealthConnectApi;
    await run(mod);
  });
}

describe('healthConnect — non-Android guard (no native module touched)', () => {
  it('getStatus reports unsupported_platform', async () => {
    await withHealthConnect('ios', null, async (mod) => {
      await expect(mod.getStatus()).resolves.toBe('unsupported_platform');
    });
  });

  it('connect returns not-granted with no permissions', async () => {
    await withHealthConnect('ios', null, async (mod) => {
      await expect(mod.connect()).resolves.toEqual({
        granted: false,
        grantedPermissions: [],
      });
    });
  });

  it('readSleepAndHeartRate returns an empty summary with a correct window', async () => {
    await withHealthConnect('ios', null, async (mod) => {
      const res = await mod.readSleepAndHeartRate(48);
      const deltaHours =
        (Date.parse(res.windowEnd) - Date.parse(res.windowStart)) / 3_600_000;
      expect(deltaHours).toBeCloseTo(48, 5);
      expect(res.sleepSessions).toEqual([]);
      expect(res.totalSleepMinutes).toBe(0);
      expect(res.avgHeartRate).toBeNull();
      expect(res.heartRateSampleCount).toBe(0);
    });
  });
});

describe('healthConnect — Android path (mocked native module)', () => {
  const SdkAvailabilityStatus = {
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
    SDK_AVAILABLE: 3,
  };

  it('getStatus maps the numeric SDK status to DISTINCT provider_required vs unavailable', async () => {
    // The two "not ready" statuses must NOT collapse:
    //  - SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED (2) = provider not installed OR
    //    outdated → 'provider_required' (the actionable install-or-update case, and
    //    the status a device with NO Health Connect app actually reports).
    //  - SDK_UNAVAILABLE (1) = device can't run Health Connect at all → 'unavailable'.
    const getSdkStatus = jest
      .fn()
      .mockResolvedValueOnce(SdkAvailabilityStatus.SDK_AVAILABLE)
      .mockResolvedValueOnce(
        SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
      )
      .mockResolvedValueOnce(SdkAvailabilityStatus.SDK_UNAVAILABLE);
    await withHealthConnect(
      'android',
      { getSdkStatus, SdkAvailabilityStatus },
      async (mod) => {
        await expect(mod.getStatus()).resolves.toBe('available');
        await expect(mod.getStatus()).resolves.toBe('provider_required');
        await expect(mod.getStatus()).resolves.toBe('unavailable');
      }
    );
  });

  it('connect initializes and requests the two read permissions', async () => {
    const initialize = jest.fn().mockResolvedValue(true);
    const requestPermission = jest.fn().mockResolvedValue([
      { accessType: 'read', recordType: 'SleepSession' },
      { accessType: 'read', recordType: 'HeartRate' },
    ]);
    await withHealthConnect(
      'android',
      { initialize, requestPermission, SdkAvailabilityStatus },
      async (mod) => {
        const res = await mod.connect();
        expect(initialize).toHaveBeenCalledTimes(1);
        expect(requestPermission).toHaveBeenCalledWith([
          { accessType: 'read', recordType: 'SleepSession' },
          { accessType: 'read', recordType: 'HeartRate' },
        ]);
        expect(res.granted).toBe(true);
        expect(res.grantedPermissions).toEqual([
          { accessType: 'read', recordType: 'SleepSession' },
          { accessType: 'read', recordType: 'HeartRate' },
        ]);
      }
    );
  });

  it('connect reports not-granted when a required permission is withheld', async () => {
    const initialize = jest.fn().mockResolvedValue(true);
    const requestPermission = jest
      .fn()
      .mockResolvedValue([
        { accessType: 'read', recordType: 'SleepSession' },
      ]);
    await withHealthConnect(
      'android',
      { initialize, requestPermission, SdkAvailabilityStatus },
      async (mod) => {
        const res = await mod.connect();
        expect(res.granted).toBe(false);
      }
    );
  });

  it('readSleepAndHeartRate queries a between-window and maps results via the pure helpers', async () => {
    const sleepRecords = [
      {
        startTime: '2026-07-06T22:00:00.000Z',
        endTime: '2026-07-07T06:00:00.000Z', // 8h -> 480
        stages: [
          {
            stage: 5,
            startTime: '2026-07-06T22:00:00.000Z',
            endTime: '2026-07-06T23:00:00.000Z',
          }, // 60m deep
        ],
      },
    ];
    const heartRecords = [
      { samples: [{ beatsPerMinute: 60 }, { beatsPerMinute: 80 }] },
      { samples: [{ beatsPerMinute: 70 }] },
    ];
    const readRecords = jest.fn((recordType: string) => {
      if (recordType === 'SleepSession') {
        return Promise.resolve({ records: sleepRecords });
      }
      if (recordType === 'HeartRate') {
        return Promise.resolve({ records: heartRecords });
      }
      return Promise.resolve({ records: [] });
    });

    await withHealthConnect(
      'android',
      { readRecords, SdkAvailabilityStatus },
      async (mod) => {
        const res = await mod.readSleepAndHeartRate(24);

        // Both record types queried with a between filter spanning the window.
        expect(readRecords).toHaveBeenCalledWith('SleepSession', {
          timeRangeFilter: {
            operator: 'between',
            startTime: res.windowStart,
            endTime: res.windowEnd,
          },
        });
        expect(readRecords).toHaveBeenCalledWith('HeartRate', {
          timeRangeFilter: {
            operator: 'between',
            startTime: res.windowStart,
            endTime: res.windowEnd,
          },
        });

        expect(res.sleepSessions).toEqual([
          {
            startTime: '2026-07-06T22:00:00.000Z',
            endTime: '2026-07-07T06:00:00.000Z',
            durationMinutes: 480,
            stageMinutes: { 5: 60 },
          },
        ]);
        expect(res.totalSleepMinutes).toBe(480);
        expect(res.avgHeartRate).toBe(70); // (60+80+70)/3
        expect(res.heartRateSampleCount).toBe(3);
      }
    );
  });

  it('readSleepAndHeartRate degrades to an empty summary if a read throws', async () => {
    const readRecords = jest.fn().mockRejectedValue(new Error('read failed'));
    await withHealthConnect(
      'android',
      { readRecords, SdkAvailabilityStatus },
      async (mod) => {
        const res = await mod.readSleepAndHeartRate(24);
        expect(res.sleepSessions).toEqual([]);
        expect(res.avgHeartRate).toBeNull();
      }
    );
  });

  it('readHealthForRange queries the explicit window and flattens timestamped HR samples', async () => {
    const startISO = '2026-07-06T00:00:00.000Z';
    const endISO = '2026-07-08T00:00:00.000Z';
    const sleepRecords = [
      {
        startTime: '2026-07-06T12:00:00.000Z',
        endTime: '2026-07-06T20:00:00.000Z', // 8h -> 480
        stages: [
          {
            stage: 5,
            startTime: '2026-07-06T12:00:00.000Z',
            endTime: '2026-07-06T13:00:00.000Z',
          }, // 60m deep
        ],
      },
    ];
    const heartRecords = [
      {
        samples: [
          { time: '2026-07-06T20:30:00.000Z', beatsPerMinute: 60 },
          { time: '2026-07-06T21:00:00.000Z', beatsPerMinute: 80 },
        ],
      },
      { samples: [{ time: '2026-07-07T02:00:00.000Z', beatsPerMinute: 100 }] },
    ];
    const readRecords = jest.fn((recordType: string) => {
      if (recordType === 'SleepSession') return Promise.resolve({ records: sleepRecords });
      if (recordType === 'HeartRate') return Promise.resolve({ records: heartRecords });
      return Promise.resolve({ records: [] });
    });

    await withHealthConnect(
      'android',
      { readRecords, SdkAvailabilityStatus },
      async (mod) => {
        const res = await mod.readHealthForRange(startISO, endISO);

        expect(readRecords).toHaveBeenCalledWith('SleepSession', {
          timeRangeFilter: { operator: 'between', startTime: startISO, endTime: endISO },
        });
        expect(readRecords).toHaveBeenCalledWith('HeartRate', {
          timeRangeFilter: { operator: 'between', startTime: startISO, endTime: endISO },
        });

        expect(res.windowStart).toBe(startISO);
        expect(res.windowEnd).toBe(endISO);
        expect(res.sleepSessions).toEqual([
          {
            startTime: '2026-07-06T12:00:00.000Z',
            endTime: '2026-07-06T20:00:00.000Z',
            durationMinutes: 480,
            stageMinutes: { 5: 60 },
          },
        ]);
        // Every sample flattened, in order, with its instant preserved.
        expect(res.heartRateSamples).toEqual([
          { time: '2026-07-06T20:30:00.000Z', beatsPerMinute: 60 },
          { time: '2026-07-06T21:00:00.000Z', beatsPerMinute: 80 },
          { time: '2026-07-07T02:00:00.000Z', beatsPerMinute: 100 },
        ]);
      }
    );
  });

  it('readHealthForRange degrades to an empty (windowed) result on read failure', async () => {
    const readRecords = jest.fn().mockRejectedValue(new Error('read failed'));
    await withHealthConnect(
      'android',
      { readRecords, SdkAvailabilityStatus },
      async (mod) => {
        const res = await mod.readHealthForRange('2026-07-06T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
        expect(res.windowStart).toBe('2026-07-06T00:00:00.000Z');
        expect(res.sleepSessions).toEqual([]);
        expect(res.heartRateSamples).toEqual([]);
      }
    );
  });

  it('hasReadPermission is true only when both required reads are granted (no prompt)', async () => {
    const initialize = jest.fn().mockResolvedValue(true);
    const getGrantedPermissions = jest
      .fn()
      .mockResolvedValueOnce([
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'HeartRate' },
      ])
      .mockResolvedValueOnce([{ accessType: 'read', recordType: 'SleepSession' }]);
    await withHealthConnect(
      'android',
      { initialize, getGrantedPermissions, SdkAvailabilityStatus },
      async (mod) => {
        await expect(mod.hasReadPermission()).resolves.toBe(true);
        await expect(mod.hasReadPermission()).resolves.toBe(false);
        // Never requests permission — this must not throw a dialog.
        expect(initialize).toHaveBeenCalled();
      }
    );
  });

  it('hasReadPermission is false when the SDK fails to initialize', async () => {
    const initialize = jest.fn().mockResolvedValue(false);
    const getGrantedPermissions = jest.fn();
    await withHealthConnect(
      'android',
      { initialize, getGrantedPermissions, SdkAvailabilityStatus },
      async (mod) => {
        await expect(mod.hasReadPermission()).resolves.toBe(false);
        expect(getGrantedPermissions).not.toHaveBeenCalled();
      }
    );
  });

  it('disconnect revokes all permissions', async () => {
    const initialize = jest.fn().mockResolvedValue(true);
    const revokeAllPermissions = jest.fn().mockResolvedValue(undefined);
    await withHealthConnect(
      'android',
      { initialize, revokeAllPermissions, SdkAvailabilityStatus },
      async (mod) => {
        await expect(mod.disconnect()).resolves.toBe(true);
        expect(revokeAllPermissions).toHaveBeenCalledTimes(1);
      }
    );
  });
});

describe('healthConnect — non-Android guards on the new range/permission API', () => {
  it('readHealthForRange returns an empty windowed result off Android', async () => {
    await withHealthConnect('ios', null, async (mod) => {
      const res = await mod.readHealthForRange('2026-07-06T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
      expect(res.sleepSessions).toEqual([]);
      expect(res.heartRateSamples).toEqual([]);
    });
  });

  it('hasReadPermission and disconnect are false off Android', async () => {
    await withHealthConnect('ios', null, async (mod) => {
      await expect(mod.hasReadPermission()).resolves.toBe(false);
      await expect(mod.disconnect()).resolves.toBe(false);
    });
  });
});

// ─── PHASE 2a pure helpers: per-day aggregation + sync window ─────────────────

describe('minBpm', () => {
  it('returns null on no samples', () => {
    expect(minBpm([])).toBeNull();
  });

  it('returns the lowest finite sample (resting-HR proxy)', () => {
    expect(minBpm([{ beatsPerMinute: 72 }, { beatsPerMinute: 55 }, { beatsPerMinute: 90 }])).toBe(55);
  });

  it('skips non-finite samples', () => {
    expect(
      minBpm([
        { beatsPerMinute: Number.NaN },
        { beatsPerMinute: 61 },
        { beatsPerMinute: Number.POSITIVE_INFINITY },
      ])
    ).toBe(61);
    expect(minBpm([{ beatsPerMinute: Number.NaN }])).toBeNull();
  });
});

describe('sleepSessionWakeDay (wake-day attribution, Brisbane UTC+10)', () => {
  it('attributes a night to the local day you wake up', () => {
    // 20:00Z = 06:00 next day in Brisbane → the wake day.
    expect(sleepSessionWakeDay({ endTime: '2026-07-06T20:00:00.000Z' })).toBe('2026-07-07');
  });
});

describe('aggregateHealthByDay', () => {
  it('returns an empty array for no data', () => {
    expect(aggregateHealthByDay({ sleepSessions: [], heartRateSamples: [] })).toEqual([]);
  });

  it('buckets sleep (by wake day) + heart rate (by sample day) into per-day rows, sorted asc', () => {
    const rows = aggregateHealthByDay({
      sleepSessions: [
        {
          endTime: '2026-07-06T20:00:00.000Z', // wakes 06:00 Brisbane Jul07
          durationMinutes: 480,
          stageMinutes: { 5: 60 },
        },
      ],
      heartRateSamples: [
        { time: '2026-07-06T20:30:00.000Z', beatsPerMinute: 60 }, // Jul07
        { time: '2026-07-06T21:00:00.000Z', beatsPerMinute: 80 }, // Jul07
        { time: '2026-07-07T02:00:00.000Z', beatsPerMinute: 100 }, // Jul07
        { time: '2026-07-07T20:00:00.000Z', beatsPerMinute: 50 }, // Jul08 (06:00 Brisbane)
      ],
    });

    expect(rows).toEqual([
      {
        date: '2026-07-07',
        sleepTotalMinutes: 480,
        sleepStages: { 5: 60 },
        avgHeartRate: 80, // (60+80+100)/3
        minHeartRate: 60,
      },
      {
        date: '2026-07-08',
        sleepTotalMinutes: null, // heart-rate-only day
        sleepStages: {},
        avgHeartRate: 50,
        minHeartRate: 50,
      },
    ]);
  });

  it('sums multiple sessions + merges stage maps on the same wake day', () => {
    const rows = aggregateHealthByDay({
      sleepSessions: [
        { endTime: '2026-07-06T20:00:00.000Z', durationMinutes: 300, stageMinutes: { 4: 100, 5: 60 } },
        { endTime: '2026-07-06T22:00:00.000Z', durationMinutes: 60, stageMinutes: { 4: 20 } }, // nap, same Jul07
      ],
      heartRateSamples: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-07-07');
    expect(rows[0].sleepTotalMinutes).toBe(360);
    expect(rows[0].sleepStages).toEqual({ 4: 120, 5: 60 });
  });

  it('a sleep-only day has null heart-rate metrics', () => {
    const rows = aggregateHealthByDay({
      sleepSessions: [{ endTime: '2026-07-06T20:00:00.000Z', durationMinutes: 400, stageMinutes: {} }],
      heartRateSamples: [],
    });
    expect(rows[0].avgHeartRate).toBeNull();
    expect(rows[0].minHeartRate).toBeNull();
  });
});

describe('computeSyncWindow', () => {
  const now = new Date('2026-07-08T05:00:00.000Z');

  it('first sync reads the full lookback window', () => {
    expect(computeSyncWindow(null, now, 30)).toEqual({
      startISO: '2026-06-08T05:00:00.000Z',
      endISO: '2026-07-08T05:00:00.000Z',
    });
  });

  it('incremental sync re-reads from the start of the last-synced local day', () => {
    // last synced 2026-07-07T00:00Z → Brisbane Jul07 10:00 → start of that local
    // day is 2026-07-06T14:00Z.
    expect(computeSyncWindow('2026-07-07T00:00:00.000Z', now, 30)).toEqual({
      startISO: '2026-07-06T14:00:00.000Z',
      endISO: '2026-07-08T05:00:00.000Z',
    });
  });

  it('clamps a very old last-synced value to the full lookback', () => {
    const res = computeSyncWindow('2026-01-01T00:00:00.000Z', now, 30);
    expect(res.startISO).toBe('2026-06-08T05:00:00.000Z');
  });

  it('falls back to the full lookback when the last-synced value is in the future', () => {
    const res = computeSyncWindow('2026-07-09T05:00:00.000Z', now, 30);
    expect(res.startISO).toBe('2026-06-08T05:00:00.000Z');
  });
});
