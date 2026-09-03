# Plan — Multiple custom reminders (Feature D)

Anti's ask: "Setting up custom reminders in the app to notify you (like say you want to have a
morning/afternoon/etc one; this'd be from settings)."

## Storage decision — JSON through the existing SETTINGS_REGISTRY (NOT a new table)

`user_settings` is the codebase's established home for settings-shaped data, and reminders are
settings-shaped: tiny (cap 10), read wholesale, never joined, never range-queried. Two decisive
reasons beyond idiom:

1. **Reactivity for free.** `SettingsContext` already loads every registry key at boot and
   re-renders the tree on `updateSetting`. `NotificationReArm` already keys its re-arm effect on
   `settings.*`. Storing the list as a `reminders` registry key means editing a reminder
   *automatically* re-arms the schedule with zero new plumbing. A `reminders` TABLE would need a
   second reactive path (its own context, or a `dataVersion` bump) invented just for ~10 rows of
   config.
2. **Write safety.** Settings writes are a single autocommit `INSERT OR REPLACE` on the read
   connection — explicitly sanctioned in `databases/CLAUDE.md`. No `withWriteTransaction` dance,
   no partial-write window for a list that is always written whole.

Cost: no DB-level schema for the JSON. Mitigated by treating the stored string as untrusted —
`parseReminders()` is a total function (bad JSON → `[]`, invalid rows dropped, bad times
normalized, ids de-duped, list capped) and is unit-tested as such.

## Model

```ts
interface Reminder { id: string; label: string; time: string /* HH:MM */; enabled: boolean }
```

Days-of-week mask: **deliberately skipped** (brief made it optional). The parser ignores unknown
fields, so adding `days` later is additive, not breaking.

## Migration 14 (backward compat, mandatory)

Reads the legacy `reminder_enabled` / `reminder_time` rows and seeds `reminders` with a single
`{ id: 'reminder-1', label: 'Daily reminder', time: <legacy>, enabled: <legacy> }`. `INSERT OR
IGNORE` so it never clobbers a list a user already has. The legacy rows stay in the table (they
are the migration's source of truth) but leave the SETTINGS_REGISTRY — nothing reads them after
this change.

> Numbering: 14 is assigned by the batch orchestrator (peers own 12/13). Until their lanes merge
> the array has a gap, which is harmless for `runMigrations` (it filters `version > user_version`)
> but breaks the old dense-numbering assertion in `migrations.test.ts`. That assertion is relaxed
> to the invariant that actually matters — **unique + strictly ascending** — plus an explicit
> duplicate-version guard, which is the real merge hazard.

## Scheduling — reconcile, don't toggle

`reconcileReminders()` replaces `scheduleOrSkipDailyReminder()` as the single public entry point,
still called from `NotificationReArm` on mount + every foreground.

- Pure planner `planReminderSchedule({ reminders, scheduledIdentifiers, streak, todayKey,
  entryDates })` → `{ toCancel, toSchedule }`. 100% unit-testable, no native module.
- Every enabled reminder is cancel-then-scheduled by its own stable identifier
  (`soulsync-reminder-<id>`), so re-arming is idempotent and never accumulates duplicates.
- Anything OURS that is scheduled but no longer desired (deleted or disabled reminders) is
  cancelled. Foreign identifiers are never touched.
- The legacy `soulsync-daily-reminder` identifier is ALWAYS in `toCancel` — it can never be a
  desired identifier, and cancelling it unconditionally means correctness does not depend on
  `getAllScheduledNotificationsAsync()` succeeding (it is wrapped in try/catch → `[]`).

The lazy `getNotifications()` guard and every no-op-in-Expo-Go path are preserved verbatim;
permissions are still requested only on a user gesture (adding a reminder / flipping one on).

## UI

`components/RemindersSection.tsx` (new file — lifts the old `RemindersSection` out of the already
551-line `SettingRow.tsx`): list rows (label · time · enabled switch), tap to edit, add/delete,
cap 10. Editing happens in an `OverlayModal` dialog (never a native `<Modal>`); the time itself is
picked with `@react-native-community/datetimepicker`, the same primitive `components/forms/
DatePicker.tsx` uses.

## Verification split

- jest/tsc: model CRUD + validation + cap, legacy migration (mock **and** real `node:sqlite`),
  reconciliation planning, UI rendering/interaction.
- Release build ONLY: that a notification actually FIRES at the scheduled time (expo-notifications'
  native module is stripped from Expo Go on Android — every public fn no-ops there by design).
