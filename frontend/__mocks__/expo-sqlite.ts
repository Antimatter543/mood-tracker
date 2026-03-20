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

export type SQLiteDatabase = ReturnType<typeof createMockDatabase>;
export { createMockDatabase };
