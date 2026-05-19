/**
 * Facade re-export for the database layer.
 *
 * This file used to be one 640-line catch-all. It's now a thin re-export
 * so existing call sites — `import { addMoodEntry } from '@/databases/database'`
 * — keep working while the actual implementations live in focused modules.
 *
 * New code is free to import directly from the focused modules (e.g.
 * `@/databases/entries`) if it prefers.
 */

// Lifecycle: init, reset, version constant, V1 schema/seed helpers used
// by migrations.
export {
  DATABASE_VERSION,
  initializeDatabase,
  resetDatabase,
  createInitialSchema,
  seedActivitiesV1,
} from '@/databases/lifecycle';

// Entries: mood entries CRUD.
export {
  addMoodEntry,
  getMoodEntries,
  filterValidActivityIds,
} from '@/databases/entries';

// Activities: per-activity CRUD plus bulk reorder.
export {
  getActivities,
  addActivity,
  updateActivity,
  deleteActivity,
  updateActivityPositions,
} from '@/databases/activities';

// Activity groups.
export {
  addActivityGroup,
  deleteActivityGroup,
  checkGroupHasEntries,
} from '@/databases/groups';

// User-settings table operations. (The settings *registry* lives in
// `@/databases/settings`; that's a different file on purpose so UI code
// can import the registry without pulling in SQLite.)
export {
  initializeSettingsTable,
  getSetting,
  updateSetting,
} from '@/databases/user-settings';
