/**
 * Unit tests for the PURE seed planner in components/generateData.ts
 * (`planSeedEntries`). No database/filesystem in the loop — this exercises the
 * decision logic only (day clustering, note-length/photo/starred mix, mood
 * range), with a fixed seeded RNG so the distribution checks are deterministic.
 *
 * QA context: Timeline scroll testing needs ~300 entries with a realistic mix
 * (multi-entry day groups, short/empty/long notes, some photos, some starred)
 * to reproduce hard flings — see the "Generate 300 Timeline QA Entries" dev
 * button in app/(tabs)/settings.tsx.
 */
import { planSeedEntries, SeedPlanEntry } from '../components/generateData';

/** Deterministic seeded PRNG (mulberry32) — same seed always yields the same
 * sequence, so the distribution assertions below are exactly reproducible. */
function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed local instant well clear of midnight, so "today" clamping never
 * spills into a neighbouring calendar day and destabilises the test. */
const NOW = new Date(2026, 8, 28, 15, 0, 0); // 2026-09-28 15:00 local

/** Group plans by local calendar day, mirroring exactly how planSeedEntries
 * itself buckets days (both run in the same process TZ during the test). */
function groupByLocalDay(plans: SeedPlanEntry[]): Map<string, SeedPlanEntry[]> {
  const groups = new Map<string, SeedPlanEntry[]>();
  for (const plan of plans) {
    const d = new Date(plan.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(plan);
    groups.set(key, bucket);
  }
  return groups;
}

describe('planSeedEntries', () => {
  it('returns exactly `count` plans', () => {
    for (const count of [0, 1, 11, 50, 300]) {
      const plans = planSeedEntries(count, NOW, createSeededRng(42));
      expect(plans).toHaveLength(count);
    }
  });

  it('never dates an entry in the future', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(7));
    for (const plan of plans) {
      expect(new Date(plan.date).getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it('produces valid ISO date strings', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(7));
    for (const plan of plans) {
      expect(plan.date).toBe(new Date(plan.date).toISOString());
    }
  });

  it('clusters entries by day: at least one day has 2+ entries and at least one has exactly 1', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(1));
    const groups = groupByLocalDay(plans);

    expect(groups.size).toBeGreaterThan(1);
    const sizes = [...groups.values()].map((g) => g.length);
    expect(sizes.some((n) => n >= 2)).toBe(true);
    expect(sizes.some((n) => n === 1)).toBe(true);
    // Every day group stays within the documented 1-4 spread.
    for (const n of sizes) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
    }
  });

  it('some days are skipped entirely (the walk spans more calendar days than it fills)', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(1));
    const groups = groupByLocalDay(plans);
    const oldest = plans.reduce((min, p) => Math.min(min, new Date(p.date).getTime()), Infinity);
    const newest = plans.reduce((max, p) => Math.max(max, new Date(p.date).getTime()), -Infinity);
    const spanDays = Math.ceil((newest - oldest) / (24 * 60 * 60 * 1000)) + 1;
    expect(groups.size).toBeLessThan(spanDays);
  });

  it('note-length buckets land within sane bounds for count=300 (~25/45/30 split)', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(123));
    const empty = plans.filter((p) => p.notes === '').length;
    const long = plans.filter((p) => p.notes.length >= 120).length; // long notes stitch 4-6 sentences
    const short = plans.length - empty - long;

    expect(empty).toBeGreaterThan(45); // ~25% of 300 = 75, generous band
    expect(empty).toBeLessThan(110);
    expect(long).toBeGreaterThan(50); // ~30% of 300 = 90
    expect(long).toBeLessThan(140);
    expect(short).toBeGreaterThan(90); // ~45% of 300 = 135
    expect(short).toBeLessThan(200);
  });

  it('photo buckets land within sane bounds for count=300 (~15% one, ~8% two-three)', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(9));
    const onePhoto = plans.filter((p) => p.photoCount === 1).length;
    const multiPhoto = plans.filter((p) => p.photoCount >= 2).length;
    const noPhoto = plans.filter((p) => p.photoCount === 0).length;

    expect(onePhoto).toBeGreaterThan(20); // ~15% of 300 = 45
    expect(onePhoto).toBeLessThan(80);
    expect(multiPhoto).toBeGreaterThan(10); // ~8% of 300 = 24
    expect(multiPhoto).toBeLessThan(60);
    expect(noPhoto).toBeGreaterThan(150);
    for (const p of plans) {
      expect(p.photoCount).toBeGreaterThanOrEqual(0);
      expect(p.photoCount).toBeLessThanOrEqual(3);
    }
  });

  it('starred share lands within sane bounds for count=300 (~10%)', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(55));
    const starred = plans.filter((p) => p.starred).length;
    expect(starred).toBeGreaterThan(15); // ~10% of 300 = 30, generous band
    expect(starred).toBeLessThan(60);
  });

  it('activity counts stay within the documented 0-4 range', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(3));
    for (const p of plans) {
      expect(Number.isInteger(p.activityCount)).toBe(true);
      expect(p.activityCount).toBeGreaterThanOrEqual(0);
      expect(p.activityCount).toBeLessThanOrEqual(4);
    }
  });

  it('moods are integers or one-decimal values within [1, 10]', () => {
    const plans = planSeedEntries(300, NOW, createSeededRng(3));
    let sawInteger = false;
    let sawDecimal = false;
    for (const p of plans) {
      expect(p.mood).toBeGreaterThanOrEqual(1);
      expect(p.mood).toBeLessThanOrEqual(10);
      const rounded = Math.round(p.mood * 10) / 10;
      expect(p.mood).toBeCloseTo(rounded, 10);
      if (Number.isInteger(p.mood)) sawInteger = true;
      else sawDecimal = true;
    }
    expect(sawInteger).toBe(true);
    expect(sawDecimal).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = planSeedEntries(300, NOW, createSeededRng(999));
    const b = planSeedEntries(300, NOW, createSeededRng(999));
    expect(a).toEqual(b);
  });

  it('defaults to Math.random when no rng is supplied', () => {
    const plans = planSeedEntries(5, NOW);
    expect(plans).toHaveLength(5);
  });
});
