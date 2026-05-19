/**
 * Bridges the original `dateHelpersStub` import paths to the canonical
 * implementation in `@/databases/dateHelpers`. Kept as a thin re-export so
 * we don't have to touch every call site, but new code should import
 * directly from `@/databases/dateHelpers`.
 *
 * The forms layer wants Date-returning variants of `startOfLocalDay` /
 * `endOfLocalDay` (for the native picker callback), so we map to the
 * `*Date` flavours under the original names.
 */

export {
  localDateString,
  isSameLocalDay,
  startOfLocalDayDate as startOfLocalDay,
  endOfLocalDayDate as endOfLocalDay,
} from '@/databases/dateHelpers';
