import { planSeedEntries, type SeedPlanEntry } from '@/components/generateData';
import type { QaScenario } from './index';

/**
 * The QA seed fixtures, as PURE plans. Each scenario is a fixed (count, RNG
 * seed, anchor) triple fed to the SAME `planSeedEntries` the dev buttons use, so
 * the QA data has the production-shaped mix (day clusters, note lengths,
 * photos, stars) and the real activity catalogue the migrations seed. Same
 * scenario + same `now` = byte-identical plans, which is what screenshot
 * goldens need. (App code may not import `@/testing`, so the jest builders are
 * not reused here: `planSeedEntries` IS the production-derived generator.)
 */

/** Deterministic 32-bit PRNG (mulberry32). Never used for anything secret. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScenarioSpec {
  count: number;
  seed: number;
  /** Where the plan's "today" sits, given the command's `now`. */
  anchor: (now: Date) => Date;
  /**
   * Keep only entries on the last N local days ending at the anchor. The shared
   * planner randomly SKIPS days (~20%), so `count` entries alone can reach back
   * further than N days; the plan is over-generated, then trimmed to the window.
   */
  withinDays?: number;
  /**
   * Move every entry to this local hour on its own day. The planner spreads a
   * day's entries across the day on purpose, so it can never produce the one shape
   * a single-bucket screen needs. The plan is over-generated, because an entry
   * moved past `now` is dropped: a plan never holds a future entry (SeedPlanEntry.date).
   */
  atLocalHour?: number;
}

const AT_NOW = (now: Date) => now;

/**
 * Local Jan 3, 12:00 of `now`'s year, or of the previous year when `now` is
 * earlier than that. Walking back from it crosses Dec 31 -> Jan 1, and it is
 * never in the future relative to `now`.
 */
export function yearBoundaryAnchor(now: Date): Date {
  const anchor = new Date(now.getFullYear(), 0, 3, 12, 0, 0, 0);
  if (anchor.getTime() > now.getTime()) anchor.setFullYear(anchor.getFullYear() - 1);
  return anchor;
}

export const SCENARIO_SPECS: Readonly<Record<QaScenario, ScenarioSpec>> = {
  empty: { count: 0, seed: 1, anchor: AT_NOW },
  // A fresh week: every entry on one of the 7 local days ending today.
  week: { count: 10, seed: 7, anchor: AT_NOW, withinDays: 7 },
  // The Timeline scroll/fling load (same size as the dev "300" button).
  timeline300: { count: 300, seed: 300, anchor: AT_NOW },
  // Entries on both sides of a New Year (heatmap/year-label edge cases).
  yearBoundary: { count: 16, seed: 2026, anchor: yearBoundaryAnchor },
  // Every entry in the morning: Time of Day with one bucket (bd4d82d). That card
  // only speaks from 14 entries in the shown period (MIN_ENTRIES_FOR_SIGNAL), far too
  // many to add through the UI, hence a fixture. 40 entries reach well back past
  // the start of the anchor's month, so the previous month alone clears the 14.
  oneBucket: { count: 40, seed: 11, anchor: AT_NOW, atLocalHour: 8 },
};

export interface ScenarioPlan {
  plans: SeedPlanEntry[];
  /** RNG for the I/O step (activity picks), continuing the plan's stream. */
  rng: () => number;
}

export function planScenario(name: QaScenario, now: Date): ScenarioPlan {
  const spec = SCENARIO_SPECS[name];
  const rng = seededRng(spec.seed);
  const anchor = spec.anchor(now);
  if (spec.atLocalHour !== undefined) {
    const hour = spec.atLocalHour;
    const plans = planSeedEntries(spec.count * 2, anchor, rng)
      .map((p) => {
        const d = new Date(p.date);
        d.setHours(hour);
        return { ...p, date: d.toISOString() };
      })
      .filter((p) => Date.parse(p.date) <= now.getTime())
      .slice(0, spec.count);
    return { plans, rng };
  }
  if (spec.withinDays === undefined) {
    return { plans: planSeedEntries(spec.count, anchor, rng), rng };
  }
  // Over-generate (the planner walks back from the anchor, newest first), keep
  // the window, take the first `count`. Fail loud rather than seed a short week:
  // a golden built on 9 entries labelled "12" is worse than a red seed.
  const windowStart = new Date(anchor);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (spec.withinDays - 1));
  const plans = planSeedEntries(spec.count * 4, anchor, rng)
    .filter((p) => Date.parse(p.date) >= windowStart.getTime())
    .slice(0, spec.count);
  if (plans.length < spec.count) {
    throw new Error(`QA scenario ${name}: only ${plans.length}/${spec.count} entries fit ${spec.withinDays} days`);
  }
  return { plans, rng };
}
