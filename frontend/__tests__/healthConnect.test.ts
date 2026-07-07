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
  averageBpm,
  durationMinutes,
  hasRequiredReadAccess,
  REQUIRED_READ_RECORD_TYPES,
  sleepDurationMinutes,
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

  it('getStatus maps the numeric SDK status', async () => {
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
        await expect(mod.getStatus()).resolves.toBe('update_required');
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
});
