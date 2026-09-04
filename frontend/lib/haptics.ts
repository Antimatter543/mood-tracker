/**
 * lib/haptics.ts
 *
 * Tiny, FULLY GUARDED wrapper around `expo-haptics`.
 *
 * Haptics are pure garnish: a missing/failing native module must never break a
 * gesture. This module therefore:
 *   - loads `expo-haptics` LAZILY through a try/catch `require` (a bare
 *     top-level import of a stripped native module throws at module-EVALUATION
 *     time, which — as `lib/notifications.ts` documents at length — can abort a
 *     whole route module and white-screen the app),
 *   - caches the resolution (module or `null`) so the require runs at most once,
 *   - swallows any throw from the native call itself,
 *   - is a no-op on web and in jest (no native runtime).
 *
 * Every export is fire-and-forget and returns `void`, never a Promise the caller
 * has to handle — a dropped haptic is not an error worth propagating.
 *
 * Used by the group move-mode drag UI (`components/forms/GroupReorder.tsx`),
 * where the buzz is the ONLY confirmation that a long-press armed the drag.
 * `react-native-sortables` has its own `hapticsEnabled` prop, but that adapter
 * targets `react-native-haptic-feedback` (not a dependency of this app), so we
 * drive the feedback ourselves from the drag callbacks.
 */

import { Platform } from 'react-native';
// Type-only import: erased at compile time, so it never pulls the native module
// in at runtime.
import type * as HapticsModule from 'expo-haptics';

let cached: typeof HapticsModule | null | undefined;

/**
 * Resolve `expo-haptics` once. Returns `null` when unavailable so callers
 * degrade to silence instead of throwing.
 */
function getHaptics(): typeof HapticsModule | null {
  if (cached !== undefined) return cached;

  if (Platform.OS === 'web') {
    cached = null;
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-haptics') as typeof HapticsModule;
  } catch {
    cached = null;
  }

  return cached;
}

/** Run a haptic call, swallowing anything the native layer throws. */
function safely(fn: (haptics: typeof HapticsModule) => void | Promise<void>): void {
  const haptics = getHaptics();
  if (!haptics) return;

  try {
    // The expo-haptics functions return Promises; a rejection here is still
    // just "no buzz", so it's caught and dropped rather than surfaced.
    void Promise.resolve(fn(haptics)).catch(() => {});
  } catch {
    // Synchronous throw from a half-initialised native module — also ignored.
  }
}

/** Drag armed / picked up. The "you are now moving this" confirmation. */
export function hapticDragStart(): void {
  safely((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium));
}

/** An item crossed another and the order changed mid-drag. Deliberately light. */
export function hapticReorderTick(): void {
  safely((h) => h.selectionAsync());
}

/**
 * A hold-to-scrub cursor moved onto a different data point
 * (`components/visualisations/MoodLineChart.tsx`). Same selection tick as
 * `hapticReorderTick` — both mean "the thing under your finger just changed to
 * the next one" — but named for its own event so the two can diverge. It fires
 * ONLY on an index change, never per pointer sample, or the hand feels a buzz.
 */
export function hapticScrubTick(): void {
  safely((h) => h.selectionAsync());
}

/** The one physical effect behind every "that landed" confirmation below. */
function lightImpact(): void {
  safely((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
}

/** Drag released. */
export function hapticDragEnd(): void {
  lightImpact();
}

/**
 * A swipe committed and the view stepped to another page/period. Named
 * separately from `hapticDragEnd` because the two are different events that may
 * want to diverge; they share the light impact today because both mean the same
 * thing to the hand: the thing you were moving has arrived.
 * Used by `hooks/usePeriodSwipe.ts` (Statistics period paging).
 */
export function hapticPageStep(): void {
  lightImpact();
}

/** Test-only: forget the cached module so a fresh require path can be asserted. */
export function __resetHapticsForTests(): void {
  cached = undefined;
}
