# Exec plan — Recycle bin + undo for deleted entries (migration 12)

Anti's ask: *"A 'bin' section / undo button for accidentally deleted entries in timeline."*

## Shape

`entries.deleted_at TEXT NULL` (UTC ISO instant, mirroring `starred_at`: the ONE
nullable column is both the flag AND the when). `NULL` = live. Deleting an entry
stamps it; nothing else changes — child rows (`entry_activities`, `entry_media`)
and the photo FILES all survive, so a restore is lossless. A purge (manual
"delete forever" or the 30-day sweep on app start) is the OLD hard-delete path:
`DELETE FROM entries` (FK cascade takes the child rows) + unlink the media files.

## Work

1. **Migration 12** — `ALTER TABLE entries ADD COLUMN deleted_at TEXT` + a PARTIAL
   index on the binned rows only (`WHERE deleted_at IS NOT NULL`), exactly the
   migration-11 pattern. Self-contained; peers own 13/14.
2. **`databases/entries.ts`** — `deleteMoodEntry` becomes the soft delete
   (`UPDATE … SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`; the extra
   predicate stops a double-tap resetting the countdown). Reads exclude binned.
3. **`databases/entry-bin.ts` (new)** — `restoreMoodEntry`, `purgeMoodEntry`,
   `purgeExpiredBinEntries`, `getBinnedEntries`, `getBinCount`, over ONE shared
   `hardDeleteEntries` helper (capture media paths → transactional DELETE →
   unlink after commit).
4. **Query-exclusion audit** — EVERY `SELECT` touching `entries` gets
   `deleted_at IS NULL`. Locked by a class-level source-scanning invariant test
   AND a real-SQLite test that runs every exported SQL constant against a DB
   whose only entry is binned.
5. **Purge on start** — `initializeDatabase` (SQLiteProvider `onInit`) awaits a
   never-throwing `purgeExpiredBinEntries`. Fresh install = one indexed SELECT.
6. **UI** — in-tree `UndoSnackbar` (mounted through `OverlayHost`, NO native
   `<Modal>`) on delete; a "Recently deleted" full-screen overlay panel reached
   from a bin button in the Timeline search bar, with per-entry Restore /
   Delete-forever, "deleted N days ago · purges in M days" copy, and an empty
   state.

## Deliberately NOT excluded / notable calls

- **Data export excludes binned entries** (sane default: a backup captures what
  the user considers their data; a restore of a "deleted" entry would surprise).
- **`ActivityEditModal` "used in N entries"** and **`groups.checkGroupHasEntries`**
  count LIVE entries only — the number must match what the user can see. Cascade
  will still strip the binned entries' links; that is a documented, minor,
  accepted effect of deleting an activity.
- **`generateData.clearAllEntries`** stays a hard `DELETE FROM entries` (dev-only
  seed reset — it is meant to nuke everything, bin included).

## Gate

`npx tsc --noEmit && npx jest --silent` from `frontend/`.
