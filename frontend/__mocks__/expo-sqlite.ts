// The mock database object lives in testing/mockSqliteDb.ts so testing/fakeDb
// can build one even when a suite replaces this module with its own factory.
import { createMockDatabase } from '../testing/mockSqliteDb';

export function openDatabaseSync() {
  return createMockDatabase();
}

// The write layer (databases/writeTransaction.ts) opens its singleton write
// connection via openDatabaseAsync. Unit tests normally INJECT a mock write
// connection (__setWriteConnectionForTests) so statements land on the same mock
// they assert on; this default keeps a write from crashing if a test forgets to.
export async function openDatabaseAsync() {
  return createMockDatabase();
}

export type SQLiteDatabase = ReturnType<typeof createMockDatabase>;
export { createMockDatabase };
