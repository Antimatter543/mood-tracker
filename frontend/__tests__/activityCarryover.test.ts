/**
 * Activity Carryover — the time-decayed activity influence on the with/without
 * mood correlation (opt-in setting, default OFF).
 *
 * Covers: the weight curve, per-entry exposure (asserted through the aggregate
 * on single-day universes so count_with == exposure), the ON-mode weighted
 * split (hand-computed), OFF-mode PARITY against an independent copy of the
 * legacy binary-membership algorithm, the 36h window edge, and the total-
 * function edges. Runs under the Brisbane pin (UTC+10) like the sibling suites.
 */
import {
  aggregateActivityCorrelation,
  carryoverWeight,
  carryoverQueryBounds,
  CARRYOVER_MAX_HOURS,
  type ActivityCorrelationRawRow,
  type ActivityCorrelationRow,
} from '@/components/visualisations/transforms/activityCorrelation';
import { SETTINGS_REGISTRY } from '@/databases/settings';
import { localDateString } from '@/databases/dateHelpers';

const H = 3_600_000; // ms per hour
// Local instant for calendar day (y, m0, d) at hh:mm — under the Brisbane pin
// these are true local times (some land on the previous UTC day, which is the
// backdated / late-evening case day-keying must survive).
const at = (y: number, m0: number, d: number, hh = 0, mm = 0) =>
  new Date(y, m0, d, hh, mm, 0).toISOString();

let nextId = 1;
const row = (
  iso: string,
  mood: number,
  activity: string | null,
): ActivityCorrelationRawRow => ({
  entry_id: nextId++,
  date: iso,
  mood,
  activity_id: activity ? 1 : null,
  activity_name: activity,
});
const rowMulti = (
  id: number,
  iso: string,
  mood: number,
  activityId: number,
  activityName: string,
): ActivityCorrelationRawRow => ({
  entry_id: id,
  date: iso,
  mood,
  activity_id: activityId,
  activity_name: activityName,
});

beforeEach(() => {
  nextId = 1;
});

// ---------------------------------------------------------------------------
// carryoverWeight — the decay curve.
// ---------------------------------------------------------------------------
describe('carryoverWeight', () => {
  it('hits the specified knot values', () => {
    expect(carryoverWeight(0)).toBe(1);
    expect(carryoverWeight(12)).toBeCloseTo(0.65, 10);
    expect(carryoverWeight(24)).toBeCloseTo(0.3, 10);
    expect(carryoverWeight(30)).toBeCloseTo(0.15, 10);
    expect(carryoverWeight(36)).toBe(0);
    expect(carryoverWeight(48)).toBe(0);
  });

  it('returns 1 at or below 0 (same instant; defensive for negatives)', () => {
    expect(carryoverWeight(0)).toBe(1);
    expect(carryoverWeight(-0.0001)).toBe(1);
    expect(carryoverWeight(-100)).toBe(1);
  });

  it('is monotone non-increasing across the whole domain', () => {
    let prev = Infinity;
    for (let h = -5; h <= 48; h += 0.25) {
      const w = carryoverWeight(h);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('stays within [0, 1]', () => {
    for (let h = -5; h <= 48; h += 0.1) {
      const w = carryoverWeight(h);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('returns 0 for non-finite input', () => {
    expect(carryoverWeight(NaN)).toBe(0);
    expect(carryoverWeight(Infinity)).toBe(0);
    expect(carryoverWeight(-Infinity)).toBe(0);
  });

  it('reaches zero exactly at the forward lookback horizon', () => {
    expect(carryoverWeight(CARRYOVER_MAX_HOURS)).toBe(0);
    expect(carryoverWeight(CARRYOVER_MAX_HOURS - 0.01)).toBeGreaterThan(0);
    expect(CARRYOVER_MAX_HOURS).toBe(36);
  });
});

// ---------------------------------------------------------------------------
// exposure(E, A) — asserted THROUGH the aggregate. When the in-window universe
// is a single entry on a single day, count_with of an activity equals that
// entry's exposure to it (Σ dayExposure over the one day).
// ---------------------------------------------------------------------------
describe('exposure (via single-entry aggregate)', () => {
  it('same entry logs the activity -> exposure 1', () => {
    const rows = [row(at(2026, 5, 15, 12), 7, 'A')];
    const out = aggregateActivityCorrelation(rows, {
      carryover: true,
      windowStart: at(2026, 5, 15, 0),
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    expect(a.count_with).toBe(1);
    expect(a.count_without).toBe(0);
  });

  it('same local day (both an earlier and a later instance) -> exposure 1 for the whole day', () => {
    // Middle entry has no activity, but A is logged earlier AND later that day.
    // sameDayTerm = 1 for every entry regardless of intra-day order.
    const rows = [
      row(at(2026, 5, 15, 8), 6, 'A'), // earlier instance
      row(at(2026, 5, 15, 12), 8, null), // middle, no activity
      row(at(2026, 5, 15, 20), 4, 'A'), // later instance
    ];
    const out = aggregateActivityCorrelation(rows, {
      carryover: true,
      windowStart: at(2026, 5, 15, 0),
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    expect(a.count_with).toBe(1); // the whole day is fully "with"
    expect(a.count_without).toBe(0);
    expect(a.avg_with).toBe(6); // (6 + 8 + 4) / 3
  });

  it('next local day, 12h after logging -> decayed exposure w(12) = 0.65', () => {
    const rows = [
      row(at(2026, 5, 15, 20), 5, 'A'), // pre-window instance
      row(at(2026, 5, 16, 8), 9, null), // in-window entry, no A, 12h later
    ];
    const out = aggregateActivityCorrelation(rows, {
      carryover: true,
      windowStart: at(2026, 5, 16, 0),
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    expect(a.count_with).toBeCloseTo(0.65, 10);
    expect(a.count_without).toBeCloseTo(0.35, 10);
  });

  it('more than 36h after logging -> exposure 0', () => {
    const rows = [
      row(at(2026, 5, 14, 12), 5, 'A'), // pre-window instance
      row(at(2026, 5, 16, 6), 8, null), // in-window entry, 42h later
    ];
    const out = aggregateActivityCorrelation(rows, {
      carryover: true,
      windowStart: at(2026, 5, 16, 0),
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    expect(a.count_with).toBe(0);
    expect(a.count_without).toBe(1);
  });

  it('an instance on a LATER local day than the entry contributes 0 (forward-only)', () => {
    // June15 entry E (mood 8, no A); A logged only the NEXT day. E must see 0.
    const rows = [
      row(at(2026, 5, 15, 12), 8, null), // E — earlier day, no activity
      row(at(2026, 5, 16, 12), 2, 'A'), // A logged AFTER E
    ];
    const out = aggregateActivityCorrelation(rows, {
      carryover: true,
      windowStart: at(2026, 5, 15, 0),
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    // June16 (the A day) is fully with; June15 (E) is fully without. If the
    // future instance had leaked onto E, avg_with would be pulled toward 8.
    expect(a.avg_with).toBe(2);
    expect(a.count_with).toBe(1);
    expect(a.avg_without).toBe(8);
    expect(a.count_without).toBe(1);
  });

  it('takes the MAX weight over multiple prior instances (closest wins)', () => {
    const rows = [
      row(at(2026, 5, 15, 0), 5, 'A'), // 24h before E -> w = 0.30
      row(at(2026, 5, 15, 18), 5, 'A'), // 6h before E  -> w = 0.825
      row(at(2026, 5, 16, 0), 9, null), // in-window entry E
    ];
    const out = aggregateActivityCorrelation(rows, {
      carryover: true,
      windowStart: at(2026, 5, 16, 0),
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    // max(0.30, 0.825) = 0.825, NOT the sum and NOT the farther instance.
    expect(a.count_with).toBeCloseTo(0.825, 10);
  });
});

// ---------------------------------------------------------------------------
// ON-mode weighted split — hand-computed.
// ---------------------------------------------------------------------------
describe('aggregateActivityCorrelation carryover ON — weighted split', () => {
  it('weights a next-day entry into "with" by the decayed exposure', () => {
    // Run on June11 @ 12:00 (mood 10). A no-activity entry June12 @ 12:00
    // (mood 2) is exactly 24h later -> w(24) = 0.3 exposure.
    const rows = [
      row(at(2026, 5, 11, 12), 10, 'Run'),
      row(at(2026, 5, 12, 12), 2, null),
    ];
    const on = aggregateActivityCorrelation(rows, { carryover: true });
    const run = on.find((r) => r.activity_name === 'Run')!;
    // avg_with = (1*10 + 0.3*2) / (1 + 0.3) = 10.6 / 1.3
    expect(run.avg_with).toBeCloseTo(8.15, 2);
    expect(run.avg_without).toBeCloseTo(2, 10); // (0.7*2)/0.7
    expect(run.count_with).toBeCloseTo(1.3, 10);
    expect(run.count_without).toBeCloseTo(0.7, 10);

    // OFF mode on the same rows: June12 is purely "without".
    const off = aggregateActivityCorrelation(rows);
    const runOff = off.find((r) => r.activity_name === 'Run')!;
    expect(runOff.avg_with).toBe(10);
    expect(runOff.count_with).toBe(1);
    expect(runOff.count_without).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// OFF-mode PARITY — numerically identical to the legacy binary-membership model.
// Reference copy of the pre-carryover algorithm, compared on a rich fixture.
// ---------------------------------------------------------------------------
const legacyAggregate = (
  rows: ActivityCorrelationRawRow[],
): ActivityCorrelationRow[] => {
  const seenEntry = new Set<number>();
  const daySum = new Map<string, { sum: number; count: number }>();
  const activityDays = new Map<string, Set<string>>();
  const activityNames = new Set<string>();
  for (const r of rows ?? []) {
    if (!r || typeof r.date !== 'string') continue;
    if (typeof r.mood !== 'number' || !Number.isFinite(r.mood)) continue;
    const t = new Date(r.date).getTime();
    if (Number.isNaN(t)) continue;
    const day = localDateString(r.date);
    if (!seenEntry.has(r.entry_id)) {
      seenEntry.add(r.entry_id);
      const acc = daySum.get(day);
      if (acc) {
        acc.sum += r.mood;
        acc.count += 1;
      } else {
        daySum.set(day, { sum: r.mood, count: 1 });
      }
    }
    if (r.activity_name != null && r.activity_id != null) {
      activityNames.add(r.activity_name);
      let set = activityDays.get(r.activity_name);
      if (!set) {
        set = new Set<string>();
        activityDays.set(r.activity_name, set);
      }
      set.add(day);
    }
  }
  const dayAvg = new Map<string, number>();
  for (const [day, { sum, count }] of daySum) dayAvg.set(day, sum / count);
  const allDays = [...dayAvg.keys()];
  const out: ActivityCorrelationRow[] = [];
  for (const name of activityNames) {
    const withDays = activityDays.get(name) ?? new Set<string>();
    let sumWith = 0;
    let countWith = 0;
    let sumWithout = 0;
    let countWithout = 0;
    for (const day of allDays) {
      const avg = dayAvg.get(day)!;
      if (withDays.has(day)) {
        sumWith += avg;
        countWith += 1;
      } else {
        sumWithout += avg;
        countWithout += 1;
      }
    }
    out.push({
      activity_name: name,
      avg_with: countWith > 0 ? Math.round((sumWith / countWith) * 100) / 100 : null,
      avg_without: countWithout > 0 ? Math.round((sumWithout / countWithout) * 100) / 100 : null,
      count_with: countWith,
      count_without: countWithout,
    });
  }
  return out;
};

describe('aggregateActivityCorrelation carryover OFF — legacy parity', () => {
  // Nontrivial fixture: multiple days, a multi-entry day, a single entry with
  // two activities, activity-less days, and late-evening/backdated entries.
  const richFixture = (): ActivityCorrelationRawRow[] => {
    nextId = 1;
    return [
      row(at(2026, 5, 11, 9), 8, 'Yoga'), // June11 multi-entry day
      row(at(2026, 5, 11, 21), 6, 'Run'),
      row(at(2026, 5, 12, 23, 30), 4, 'Yoga'), // late-evening (backdated feel)
      row(at(2026, 5, 13, 12), 7, null), // activity-less day
      ...[
        rowMulti(100, at(2026, 5, 14, 8), 9, 1, 'Yoga'), // one entry, two activities
        rowMulti(100, at(2026, 5, 14, 8), 9, 2, 'Run'),
      ],
      row(at(2026, 5, 15, 20), 3, 'Run'),
      row(at(2026, 5, 16, 10), 5, null), // activity-less day
      row(at(2026, 5, 17, 22, 45), 2, 'Yoga'), // late-evening
    ];
  };

  it('matches the legacy algorithm exactly with { carryover: false }', () => {
    const rows = richFixture();
    expect(aggregateActivityCorrelation(rows, { carryover: false })).toEqual(
      legacyAggregate(rows),
    );
  });

  it('matches the legacy algorithm with the default (no options) arg', () => {
    const rows = richFixture();
    expect(aggregateActivityCorrelation(rows)).toEqual(legacyAggregate(rows));
  });

  it('a windowStart passed with carryover OFF does not change the OFF result', () => {
    // OFF mode never extends the query, but be robust: passing windowStart with
    // carryover off must still equal the legacy full-universe result (there are
    // no pre-window rows in an un-extended query anyway).
    const rows = richFixture();
    expect(
      aggregateActivityCorrelation(rows, { carryover: false, windowStart: at(2026, 5, 11, 0) }),
    ).toEqual(legacyAggregate(rows));
  });
});

// ---------------------------------------------------------------------------
// Window edge — a pre-window instance decays into the first in-window day; the
// pre-window entry is excluded from the day-mood universe.
// ---------------------------------------------------------------------------
describe('aggregateActivityCorrelation carryover ON — window edge', () => {
  const rows = () => [
    row(at(2026, 5, 10, 18), 10, 'Run'), // PRE-window instance (mood 10)
    row(at(2026, 5, 11, 6), 4, null), // in-window entry, 12h later (mood 4)
  ];
  const windowStart = at(2026, 5, 11, 0); // true window start: June11 local midnight

  it('a pre-window instance influences the first in-window day', () => {
    const out = aggregateActivityCorrelation(rows(), { carryover: true, windowStart });
    const run = out.find((r) => r.activity_name === 'Run')!;
    // 12h forward decay -> 0.65 exposure carried into the window.
    expect(run.count_with).toBeCloseTo(0.65, 10);
    // Exactly ONE in-window day in the universe.
    expect(run.count_with + run.count_without).toBeCloseTo(1, 10);
  });

  it('excludes the pre-window entry from the day-mood universe', () => {
    const out = aggregateActivityCorrelation(rows(), { carryover: true, windowStart });
    const run = out.find((r) => r.activity_name === 'Run')!;
    // Only June11 (mood 4) is in the universe. If June10 (mood 10) leaked in,
    // avg_with would be pulled toward ~7.6 and count_with toward 1.65.
    expect(run.avg_with).toBe(4);
    expect(run.avg_without).toBe(4);
  });

  it('WITHOUT windowStart the pre-window day would (wrongly) join the universe — proving the trim matters', () => {
    const out = aggregateActivityCorrelation(rows(), { carryover: true }); // no windowStart
    const run = out.find((r) => r.activity_name === 'Run')!;
    // June10 is now a full "with" day: count_with = 1 (June10) + 0.65 (June11).
    expect(run.count_with).toBeCloseTo(1.65, 10);
    expect(run.avg_with).toBeCloseTo(7.64, 2); // (1*10 + 0.65*4) / 1.65
  });
});

// ---------------------------------------------------------------------------
// Total-function edges — must never NaN or throw (carryover ON).
// ---------------------------------------------------------------------------
describe('aggregateActivityCorrelation carryover ON — edges', () => {
  it('empty input -> empty result', () => {
    expect(aggregateActivityCorrelation([], { carryover: true })).toEqual([]);
  });

  it('degenerate rows are skipped, never throw', () => {
    expect(
      aggregateActivityCorrelation(
        [{ entry_id: 1, date: 'bad', mood: 5, activity_id: 1, activity_name: 'X' } as any],
        { carryover: true },
      ),
    ).toEqual([]);
  });

  it('single day, single entry -> count_with 1, no NaN', () => {
    const out = aggregateActivityCorrelation([row(at(2026, 5, 15, 9), 6, 'A')], {
      carryover: true,
    });
    const a = out.find((r) => r.activity_name === 'A')!;
    expect(a.count_with).toBe(1);
    expect(a.count_without).toBe(0);
    expect(a.avg_with).toBe(6);
    expect(a.avg_without).toBeNull();
  });

  it('activity logged every day -> count_without 0, avg_without null, no NaN', () => {
    const rows = [
      row(at(2026, 5, 11, 9), 5, 'A'),
      row(at(2026, 5, 12, 9), 7, 'A'),
      row(at(2026, 5, 13, 9), 3, 'A'),
    ];
    const out = aggregateActivityCorrelation(rows, { carryover: true });
    const a = out.find((r) => r.activity_name === 'A')!;
    expect(a.count_without).toBe(0);
    expect(a.avg_without).toBeNull();
    expect(a.avg_with).toBe(5); // (5 + 7 + 3) / 3
    expect(Number.isFinite(a.count_with)).toBe(true);
  });

  it('produces only finite counts across a rich ON-mode fixture', () => {
    nextId = 1;
    const rows = [
      row(at(2026, 5, 11, 9), 8, 'Yoga'),
      row(at(2026, 5, 11, 21), 6, 'Run'),
      row(at(2026, 5, 12, 23, 30), 4, 'Yoga'),
      row(at(2026, 5, 13, 12), 7, null),
      row(at(2026, 5, 14, 8), 3, 'Run'),
      row(at(2026, 5, 15, 20), 9, 'Yoga'),
    ];
    const out = aggregateActivityCorrelation(rows, { carryover: true });
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(Number.isFinite(r.count_with)).toBe(true);
      expect(Number.isFinite(r.count_without)).toBe(true);
      if (r.avg_with != null) expect(Number.isFinite(r.avg_with)).toBe(true);
      if (r.avg_without != null) expect(Number.isFinite(r.avg_without)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// carryoverQueryBounds — the chart's "honor the toggle" logic (the query-window
// extension), extracted as a pure helper.
// ---------------------------------------------------------------------------
describe('carryoverQueryBounds', () => {
  const window = {
    start: '2026-06-11T00:00:00.000Z',
    end: '2026-06-18T13:59:59.999Z',
  };

  it('OFF: returns the window verbatim with no windowStart', () => {
    const b = carryoverQueryBounds(window, false);
    expect(b.queryStart).toBe(window.start);
    expect(b.queryEnd).toBe(window.end);
    expect(b.windowStart).toBeUndefined();
  });

  it('ON: pulls the query lower bound back exactly CARRYOVER_MAX_HOURS and carries the true start', () => {
    const b = carryoverQueryBounds(window, true);
    expect(b.queryEnd).toBe(window.end);
    expect(b.windowStart).toBe(window.start);
    const expectedStart = new Date(
      new Date(window.start).getTime() - CARRYOVER_MAX_HOURS * H,
    ).toISOString();
    expect(b.queryStart).toBe(expectedStart);
    // The extension equals the curve's zero horizon (nothing older can matter).
    expect(new Date(window.start).getTime() - new Date(b.queryStart).getTime()).toBe(
      CARRYOVER_MAX_HOURS * H,
    );
    expect(carryoverWeight(CARRYOVER_MAX_HOURS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Settings registry — the opt-in toggle is present and defaults OFF.
// ---------------------------------------------------------------------------
describe('activity_carryover setting', () => {
  it('is registered as a switch defaulting to false', () => {
    const cfg = SETTINGS_REGISTRY.activity_carryover;
    expect(cfg).toBeDefined();
    expect(cfg.key).toBe('activity_carryover');
    expect(cfg.type).toBe('switch');
    expect(cfg.default).toBe(false);
    expect(typeof cfg.label).toBe('string');
    expect(cfg.label.length).toBeGreaterThan(0);
  });
});
