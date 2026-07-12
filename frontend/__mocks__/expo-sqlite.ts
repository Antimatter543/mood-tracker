const createMockDatabase = () => ({
  execAsync: jest.fn().mockResolvedValue(undefined),
  runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
  getAllAsync: jest.fn().mockResolvedValue([]),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  withTransactionAsync: jest.fn().mockImplementation(async (callback: () => Promise<void>) => {
    await callback();
  }),
  withExclusiveTransactionAsync: jest.fn().mockImplementation(async (callback: () => Promise<void>) => {
    await callback();
  }),
});

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
