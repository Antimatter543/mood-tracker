/**
 * Re-exports the canonical date helpers from the database layer so
 * visualisation transforms don't need a parallel implementation.
 *
 * Why this matters: the previous local implementation here returned
 * "YYYY-MM-DD HH:MM:SS" strings without a timezone marker. SQLite compared
 * those lexicographically against the ISO-with-Z timestamps stored in
 * `entries.date`, which happens to work for the *exclusion* end of a range
 * but silently mis-buckets entries near midnight for users in non-UTC
 * timezones (a UTC-5 user viewing "today" would lose their evening entry
 * because it stored as next-day UTC). The canonical helpers convert local
 * midnight to UTC properly via `toISOString()` and compare apples to apples.
 */

export {
  localDateString,
  startOfLocalDay,
  endOfLocalDay,
  daysBetween,
  addDays,
} from '@/databases/dateHelpers';
