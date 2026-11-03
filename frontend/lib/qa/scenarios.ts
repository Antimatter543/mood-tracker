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
  week: { count: 12, seed: 7, anchor: AT_NOW },
  // The Timeline scroll/fling load (same size as the dev "300" button).
  timeline300: { count: 300, seed: 300, anchor: AT_NOW },
  // Entries on both sides of a New Year (heatmap/year-label edge cases).
  yearBoundary: { count: 16, seed: 2026, anchor: yearBoundaryAnchor },
};

export interface ScenarioPlan {
  plans: SeedPlanEntry[];
  /** RNG for the I/O step (activity picks), continuing the plan's stream. */
  rng: () => number;
}

export function planScenario(name: QaScenario, now: Date): ScenarioPlan {
  const spec = SCENARIO_SPECS[name];
  const rng = seededRng(spec.seed);
  const plans = planSeedEntries(spec.count, spec.anchor(now), rng);
  return { plans, rng };
}
